"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePortalAuth } from "@/components/portal-auth";
import { UnidadForm } from "@/components/unidad-form";
import { Icon } from "@/components/icon";
import { ApiError, getClientes, getUnidades, type ApiPage, type Cliente, type Unidad } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { canConsultUnidades, canCreateUnidad, canEditUnidad } from "@/lib/unidades-form";

const pageSize = 20;
function asApiError(error: unknown) { return error instanceof ApiError ? error : new ApiError("No se pudo cargar la información de unidades.", 0); }
async function sessionToken() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ApiError("No está configurada la conexión de autenticación.", 0);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError("No se pudo recuperar la sesión de Supabase.", 0);
  if (!data.session?.access_token) throw new ApiError("La sesión venció. Inicia sesión nuevamente.", 401);
  return { accessToken: data.session.access_token, supabase };
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function UnidadesList() {
  const router = useRouter();
  const { state, signOut } = usePortalAuth();
  const permissions = state.status === "authenticated" ? state.profile.permisos : [];
  const canConsult = canConsultUnidades(permissions);
  const canCreate = canCreateUnidad(permissions);
  const canEdit = canEditUnidad(permissions);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState<ApiPage<Unidad> | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [clienteError, setClienteError] = useState<ApiError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Unidad | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryInput.trim()); setPageIndex(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const { accessToken, supabase } = await sessionToken();
        let page: ApiPage<Unidad>;
        try {
          page = await getUnidades({ accessToken, query, clienteId, limit: pageSize, offset: pageIndex * pageSize, signal: controller.signal });
        } catch (requestError) {
          const apiError = asApiError(requestError);
          if (apiError.status !== 401 || controller.signal.aborted) throw apiError;
          const { data, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !data.session?.access_token) throw apiError;
          page = await getUnidades({ accessToken: data.session.access_token, query, clienteId, limit: pageSize, offset: pageIndex * pageSize, signal: controller.signal });
        }
        if (active) setResult(page);
      } catch (requestError) {
        if (active && !controller.signal.aborted) setError(asApiError(requestError));
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [query, clienteId, pageIndex, retryCount]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function loadClientes() {
      setLoadingClientes(true); setClienteError(null);
      try {
        const { accessToken } = await sessionToken();
        const page = await getClientes({ accessToken, query: "", limit: 100, offset: 0, signal: controller.signal });
        if (active) setClientes(page.data.filter((cliente) => cliente.activo));
      } catch (requestError) { if (active && !controller.signal.aborted) setClienteError(asApiError(requestError)); }
      finally { if (active) setLoadingClientes(false); }
    }
    void loadClientes();
    return () => { active = false; controller.abort(); };
  }, [retryCount]);

  const totalPages = result ? Math.ceil(result.total / pageSize) : 0;
  const firstVisible = result?.data.length ? result.offset + 1 : 0;
  const lastVisible = result ? Math.min(result.offset + result.data.length, result.total) : 0;

  async function retry() {
    if (error?.status === 401 || clienteError?.status === 401) { await signOut(); router.replace("/login"); return; }
    setRetryCount((value) => value + 1);
  }
  function saved(unidad: Unidad) {
    const wasEditing = editing !== null;
    setFormOpen(false); setEditing(null);
    setSuccessNotice(wasEditing ? `Se actualizaron los datos de la unidad ${unidad.numero_serie}.` : `Se registró la unidad ${unidad.numero_serie} correctamente.`);
    setQueryInput(""); setQuery(""); setClienteId(""); setPageIndex(0); setResult(null);
    setRetryCount((value) => value + 1);
  }

  if (!canConsult) return <section className="panel access-denied"><Icon name="shield" size={24} /><h2>Sin permiso para consultar unidades</h2><p>Solicita a Administración el acceso “unidades.consultar”.</p></section>;

  return <>
    <div className="page-heading"><div><p className="page-eyebrow">Directorio</p><h1 className="page-title">Unidades</h1><p className="page-subtitle">Consulta los camiones registrados y su relación con los clientes atendidos por el taller.</p></div><button className="button-primary" disabled={!canCreate} onClick={() => { setEditing(null); setSuccessNotice(null); setFormOpen(true); }} title={canCreate ? "Registrar una unidad" : "Tu cuenta no tiene permiso para registrar unidades"} type="button"><Icon name="plus" size={16} />Nueva unidad</button></div>
    {successNotice && <div className="callout success-callout" role="status"><Icon name="check" size={16} /><span>{successNotice}</span><button aria-label="Cerrar confirmación" className="notice-dismiss" onClick={() => setSuccessNotice(null)} type="button"><Icon name="close" size={15} /></button></div>}
    <div className="toolbar-row units-toolbar"><label className="search-field"><Icon name="search" size={16} /><input aria-label="Buscar unidad por número de serie" onChange={(event) => setQueryInput(event.currentTarget.value)} placeholder="Buscar por serie, marca, modelo o placas" type="search" value={queryInput} /></label><label className="units-filter"><Icon name="filter" size={16} /><span>Cliente</span><select aria-label="Filtrar por cliente" disabled={loadingClientes || Boolean(clienteError)} onChange={(event) => { setClienteId(event.currentTarget.value); setPageIndex(0); }} value={clienteId}><option value="">{loadingClientes ? "Cargando…" : "Todos los clientes"}</option>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>)}</select></label><p className="list-hint">La búsqueda usa los campos descriptivos disponibles en la API.</p></div>
    <section aria-labelledby="unidades-list-title" className="panel">
      <div className="panel-header"><div><h2 id="unidades-list-title">Directorio de unidades</h2><p>Consulta actualizada desde el sistema</p></div><span className="status-pill" aria-live="polite"><i className="status-dot" />{loading ? "Cargando" : result ? `${result.total} ${result.total === 1 ? "unidad" : "unidades"}` : "Sin datos"}</span></div>
      {clienteError && <div className="list-error-panel" role="alert"><p>No se pudo cargar la lista de clientes para el filtro. {clienteError.message}</p><button className="button-secondary" onClick={() => void retry()} type="button">Reintentar</button></div>}
      <div className="table-wrap"><table className="data-table units-table"><thead><tr><th scope="col">Unidad</th><th scope="col">Número de serie</th><th scope="col">Cliente</th><th scope="col">Marca y modelo</th><th scope="col">Año</th><th scope="col">Placas</th><th scope="col">Estado</th><th scope="col">Registro</th><th scope="col">Acciones</th></tr></thead><tbody>
        {loading ? <tr><td className="list-state-cell" colSpan={9}><span aria-label="Cargando unidades" className="table-loading"><i className="spinner" />Cargando unidades…</span></td></tr>
          : error ? <tr><td className="list-state-cell" colSpan={9}><div className="list-error" role="alert"><Icon name={error.status === 403 ? "shield" : "info"} size={23} /><strong>{error.status === 401 ? "La sesión venció" : error.status === 403 ? "Acceso denegado" : "No se pudo cargar el directorio"}</strong><p>{error.message}</p><button className="button-primary" onClick={() => void retry()} type="button">{error.status === 401 ? "Iniciar sesión" : "Reintentar"}</button></div></td></tr>
            : !result?.data.length ? <tr><td className="list-state-cell" colSpan={9}><div className="empty-state"><span className="empty-icon"><Icon name="truck" size={22} /></span><strong>{query || clienteId ? "No se encontraron unidades" : "Aún no hay unidades registradas"}</strong><p>{query || clienteId ? "Prueba con otra búsqueda o cambia el filtro de cliente." : "Cuando registres un camión, aparecerá aquí vinculado a su cliente."}</p></div></td></tr>
              : result.data.map((unidad) => <tr key={unidad.id}><td><span className="client-name">{[unidad.marca, unidad.modelo].filter(Boolean).join(" ") || "Camión"}</span><span className="client-secondary">Actualizado {dateLabel(unidad.actualizado_en)}</span></td><td><span className="unit-serial">{unidad.numero_serie}</span></td><td><span className="client-name">{unidad.cliente_nombre}</span></td><td>{[unidad.marca, unidad.modelo].filter(Boolean).join(" ") || <span className="muted-value">Sin datos</span>}</td><td>{unidad.anio ?? <span className="muted-value">—</span>}</td><td>{unidad.placas || <span className="muted-value">—</span>}</td><td><span className={`status-pill client-status ${unidad.activo ? "is-active" : "is-inactive"}`}><i className="status-dot" />{unidad.activo ? "Activa" : "Inactiva"}</span></td><td>{dateLabel(unidad.creado_en)}</td><td><button className="button-secondary row-edit-button" disabled={!canEdit} onClick={() => { setEditing(unidad); setSuccessNotice(null); setFormOpen(true); }} title={canEdit ? "Editar unidad" : "Tu cuenta no tiene permiso para editar unidades"} type="button">Editar</button></td></tr>)}
      </tbody></table></div>
      {result && !error && <div className="pagination-row"><p className="pagination-summary">Mostrando <strong>{firstVisible}–{lastVisible}</strong> de <strong>{result.total}</strong></p><div className="pagination-controls"><button className="button-secondary" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((value) => value - 1)} type="button">Anterior</button><span className="page-number">{totalPages ? `${pageIndex + 1} / ${totalPages}` : "0 / 0"}</span><button className="button-secondary" disabled={pageIndex + 1 >= totalPages || loading} onClick={() => setPageIndex((value) => value + 1)} type="button">Siguiente</button></div></div>}
    </section>
    {formOpen && <UnidadForm key={editing?.id ?? "new"} onCancel={() => { setFormOpen(false); setEditing(null); }} onSaved={saved} unidad={editing} />}
  </>;
}
