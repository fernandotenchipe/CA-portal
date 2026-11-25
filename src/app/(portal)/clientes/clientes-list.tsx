"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { usePortalAuth } from "@/components/portal-auth";
import { ApiError, getClientes, type ApiPage, type Cliente } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icon";

const pageSize = 20;

function readableDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("No se pudo cargar la información de clientes.", 0);
}

export function ClientesList() {
  const router = useRouter();
  const { signOut } = usePortalAuth();
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState<ApiPage<Cliente> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = queryInput.trim();
      setQuery(nextQuery);
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadClients() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new ApiError("No está configurada la conexión de autenticación.", 0);

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw new ApiError("No se pudo recuperar la sesión de Supabase.", 0);
        if (!sessionData.session?.access_token) throw new ApiError("La sesión venció. Inicia sesión nuevamente.", 401);

        let page: ApiPage<Cliente>;
        try {
          page = await getClientes({
            accessToken: sessionData.session.access_token,
            query,
            limit: pageSize,
            offset: pageIndex * pageSize,
            signal: controller.signal,
          });
        } catch (requestError) {
          const apiError = asApiError(requestError);
          if (apiError.status !== 401 || controller.signal.aborted) throw apiError;

          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !refreshed.session?.access_token) throw apiError;
          page = await getClientes({
            accessToken: refreshed.session.access_token,
            query,
            limit: pageSize,
            offset: pageIndex * pageSize,
            signal: controller.signal,
          });
        }

        if (active) setResult(page);
      } catch (requestError) {
        if (active && !controller.signal.aborted) setError(asApiError(requestError));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadClients();
    return () => {
      active = false;
      controller.abort();
    };
  }, [pageIndex, query, retryCount]);

  const totalPages = result ? Math.ceil(result.total / pageSize) : 0;
  const firstVisible = result && result.data.length > 0 ? result.offset + 1 : 0;
  const lastVisible = result ? Math.min(result.offset + result.data.length, result.total) : 0;

  async function leaveExpiredSession() {
    await signOut();
    router.replace("/login");
  }

  return (
    <>
      <div className="toolbar-row">
        <label className="search-field">
          <Icon name="search" size={16} />
          <input
            aria-label="Buscar cliente"
            onChange={(event) => setQueryInput(event.currentTarget.value)}
            placeholder="Buscar por nombre, RFC, correo o teléfono"
            type="search"
            value={queryInput}
          />
        </label>
        <p className="list-hint">Busca en nombre, razón social y datos de contacto.</p>
      </div>

      <section aria-labelledby="clientes-list-title" className="panel">
        <div className="panel-header">
          <div><h2 id="clientes-list-title">Directorio de clientes</h2><p>Listado actualizado desde el sistema</p></div>
          <span className="status-pill" aria-live="polite">
            <i className="status-dot" />
            {loading ? "Cargando" : result ? `${result.total} ${result.total === 1 ? "cliente" : "clientes"}` : "Sin datos"}
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Razón social</th>
                <th scope="col">Teléfono</th>
                <th scope="col">Correo</th>
                <th scope="col">Estado</th>
                <th scope="col">Registro</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="list-state-cell" colSpan={6}><span aria-label="Cargando clientes" className="table-loading"><i className="spinner" />Cargando clientes…</span></td></tr>
              ) : error ? (
                <tr>
                  <td className="list-state-cell" colSpan={6}>
                    <div className="list-error" role="alert">
                      <span className="empty-icon"><Icon name={error.status === 401 || error.status === 403 ? "shield" : "activity"} size={21} /></span>
                      <strong>{error.status === 401 ? "Sesión no disponible" : error.status === 403 ? "Acceso denegado" : "No se pudo cargar el listado"}</strong>
                      <p>{error.message}</p>
                      {error.status === 401
                        ? <button className="button-primary" onClick={() => void leaveExpiredSession()}>Iniciar sesión nuevamente</button>
                        : <button className="button-secondary" onClick={() => setRetryCount((count) => count + 1)}>Reintentar</button>}
                    </div>
                  </td>
                </tr>
              ) : result?.data.length ? (
                result.data.map((cliente) => (
                  <tr key={cliente.id}>
                    <td><strong className="client-name">{cliente.nombre}</strong>{cliente.rfc && <span className="client-secondary">RFC: {cliente.rfc}</span>}</td>
                    <td>{cliente.razon_social || <span className="muted-value">—</span>}</td>
                    <td>{cliente.telefono || <span className="muted-value">—</span>}</td>
                    <td>{cliente.correo || <span className="muted-value">—</span>}</td>
                    <td><span className={`status-pill client-status ${cliente.activo ? "is-active" : "is-inactive"}`}><i className="status-dot" />{cliente.activo ? "Activo" : "Inactivo"}</span></td>
                    <td>{readableDate(cliente.creado_en)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    <EmptyState
                      icon="users"
                      title={query ? "No encontramos clientes" : "Aún no hay clientes registrados"}
                      description={query ? "Prueba con otro nombre, RFC, correo o teléfono." : "Cuando se registren clientes, aparecerán en este directorio."}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {result && !error && result.total > 0 && (
          <nav aria-label="Paginación de clientes" className="pagination-row">
            <span className="pagination-summary">Mostrando <strong>{firstVisible}–{lastVisible}</strong> de <strong>{result.total}</strong></span>
            <div className="pagination-controls">
              <button aria-label="Página anterior" className="button-secondary" disabled={loading || pageIndex === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>← Anterior</button>
              <span aria-live="polite" className="page-number">{pageIndex + 1} / {totalPages}</span>
              <button aria-label="Página siguiente" className="button-secondary" disabled={loading || pageIndex + 1 >= totalPages} onClick={() => setPageIndex((page) => page + 1)}>Siguiente →</button>
            </div>
          </nav>
        )}
      </section>
    </>
  );
}
