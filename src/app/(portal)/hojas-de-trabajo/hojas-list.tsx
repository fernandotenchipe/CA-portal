"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePortalAuth } from "@/components/portal-auth";
import { Icon } from "@/components/icon";
import { ApiError, createDocumentoCorto, getAllClientes, getAllUnidadesForCliente, getDocumentosCortos, type ApiPage, type Cliente, type DocumentoCorto, type Unidad } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { canUseHojas, createSubmissionGuard, emptyHojaDraft, mapHojaError, toCreateHojaPayload, unitsForCliente, validateHojaDraft, type HojaDraft, type HojaField } from "@/lib/hojas-form";

const pageSize = 20;
async function sessionToken() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ApiError("No está configurada la conexión de autenticación.", 0);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError("No se pudo recuperar la sesión de Supabase.", 0);
  if (!data.session?.access_token) throw new ApiError("La sesión venció. Inicia sesión nuevamente.", 401);
  return { accessToken: data.session.access_token, supabase };
}
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value)) : "—";
const errorMessage = (error: unknown) => mapHojaError(error, "create").message;

export function HojasList() {
  const router = useRouter();
  const { state, signOut } = usePortalAuth();
  const permissions = state.status === "authenticated" ? state.profile.permisos : [];
  const role = state.status === "authenticated" ? state.profile.rol.codigo : "";
  const canConsult = canUseHojas(permissions, role, "consultar");
  const canCreate = canUseHojas(permissions, role, "crear");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [unidadId, setUnidadId] = useState("");
  const [estado, setEstado] = useState<"" | "en_construccion" | "finalizado">("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState<ApiPage<DocumentoCorto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<HojaDraft>(emptyHojaDraft());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<HojaField, string>>>({});
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);
  const submissionGuard = useRef(createSubmissionGuard());

  useEffect(() => { const timer = window.setTimeout(() => { setQuery(queryInput.trim()); setPageIndex(0); }, 300); return () => window.clearTimeout(timer); }, [queryInput]);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const { accessToken } = await sessionToken();
        const page = await getDocumentosCortos({ accessToken, q: query, clienteId, unidadId, estado, limit: pageSize, offset: pageIndex * pageSize, signal: controller.signal });
        if (active) setResult(page);
      } catch (cause) { if (active && !controller.signal.aborted) setError(cause instanceof ApiError ? cause : new ApiError(errorMessage(cause), 0)); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; controller.abort(); };
  }, [query, clienteId, unidadId, estado, pageIndex, refresh]);

  useEffect(() => {
    if (!canConsult) return;
    const controller = new AbortController(); let active = true;
    async function loadOptions() {
      setLoadingOptions(true);
      try { const { accessToken } = await sessionToken(); const rows = await getAllClientes({ accessToken, signal: controller.signal }); if (active) setClientes(rows); }
      catch { if (active) setClientes([]); }
      finally { if (active) setLoadingOptions(false); }
    }
    void loadOptions(); return () => { active = false; controller.abort(); };
  }, [canConsult, refresh]);

  useEffect(() => {
    if (!clienteId && !formOpen) return;
    const targetClient = formOpen ? draft.cliente_id : clienteId;
    if (!targetClient) return;
    const controller = new AbortController(); let active = true;
    async function loadUnits() {
      try { const { accessToken } = await sessionToken(); const rows = await getAllUnidadesForCliente({ accessToken, clienteId: targetClient, signal: controller.signal }); if (active) setUnidades(rows); }
      catch { if (active) setUnidades([]); }
    }
    void loadUnits(); return () => { active = false; controller.abort(); };
  }, [clienteId, formOpen, draft.cliente_id]);

  async function reload() {
    if (error?.status === 401) { await signOut(); router.replace("/login"); return; }
    setRefresh((value) => value + 1);
  }
  function resetFilters() { setQueryInput(""); setQuery(""); setClienteId(""); setUnidadId(""); setEstado(""); setPageIndex(0); }
  function closeForm() { if (saving) return; setFormOpen(false); setDraft(emptyHojaDraft()); setFieldErrors({}); setFormError(""); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving || !submissionGuard.current.acquire()) return;
    const errors = validateHojaDraft(draft); setFieldErrors(errors); setFormError("");
    if (Object.keys(errors).length) { submissionGuard.current.release(); return; }
    setSaving(true);
    try {
      const { accessToken } = await sessionToken();
      const created = await createDocumentoCorto({ accessToken, payload: toCreateHojaPayload(draft) });
      setSuccess(`La hoja ${created.folio_fisico} quedó registrada.`); closeForm(); resetFilters(); setResult(null); setRefresh((value) => value + 1);
    } catch (cause) {
      const mapped = mapHojaError(cause, "create"); setFormError(mapped.message); if (mapped.folioError) setFieldErrors((previous) => ({ ...previous, folio_fisico: mapped.folioError }));
      if (mapped.status === 401) { await signOut(); router.replace("/login"); }
    } finally { submissionGuard.current.release(); setSaving(false); }
  }
  function setField<K extends HojaField>(field: K, value: HojaDraft[K]) { setDraft((current) => ({ ...current, [field]: value })); setFieldErrors((current) => ({ ...current, [field]: undefined })); }

  if (!canConsult) return <section className="panel access-denied"><Icon name="shield" size={24} /><h2>Sin permiso para consultar hojas de trabajo</h2><p>Se requiere “documentos_cortos.consultar” y un rol autorizado.</p></section>;
  const totalPages = result ? Math.ceil(result.total / pageSize) : 0;
  const setFilter = (callback: () => void) => { callback(); setPageIndex(0); };

  return <>
    <div className="page-heading"><div><p className="page-eyebrow">Operación de taller</p><h1 className="page-title">Hojas de trabajo</h1><p className="page-subtitle">Consulta y administra las hojas cortas de fabricación y reparación.</p></div><button className="button-primary" disabled={!canCreate} onClick={() => { setDraft(emptyHojaDraft()); setFieldErrors({}); setFormError(""); setSuccess(""); setFormOpen(true); }} title={canCreate ? "Registrar una hoja de trabajo" : "Tu cuenta no tiene permiso para registrar hojas"} type="button"><Icon name="plus" size={16} />Nueva hoja</button></div>
    {success && <div className="callout success-callout" role="status"><Icon name="check" size={16} /><span>{success}</span><button aria-label="Cerrar confirmación" className="notice-dismiss" onClick={() => setSuccess("")} type="button"><Icon name="close" size={15} /></button></div>}
    <div className="toolbar-row hoja-toolbar">
      <label className="search-field"><Icon name="search" size={16} /><input aria-label="Buscar hoja por folio, cliente o unidad" onChange={(event) => setQueryInput(event.currentTarget.value)} placeholder="Buscar folio, cliente o unidad" type="search" value={queryInput} /></label>
      <label className="hoja-filter"><span>Cliente</span><select aria-label="Filtrar por cliente" onChange={(event) => setFilter(() => setClienteId(event.currentTarget.value))} value={clienteId}><option value="">Todos</option>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>)}</select></label>
      <label className="hoja-filter"><span>Unidad</span><select aria-label="Filtrar por unidad" disabled={!clienteId} onChange={(event) => setFilter(() => setUnidadId(event.currentTarget.value))} value={unidadId}><option value="">Todas</option>{unidades.map((unidad) => <option key={unidad.id} value={unidad.id}>{unidad.numero_serie}</option>)}</select></label>
      <label className="hoja-filter"><span>Estado</span><select aria-label="Filtrar por estado" onChange={(event) => setFilter(() => setEstado(event.currentTarget.value as typeof estado))} value={estado}><option value="">Todos</option><option value="en_construccion">En construcción</option><option value="finalizado">Finalizado</option></select></label>
      <button className="button-secondary" onClick={resetFilters} type="button">Limpiar</button>
      {loadingOptions && <span className="field-hint">Cargando opciones…</span>}
    </div>
    <section aria-labelledby="hojas-title" className="panel">
      <div className="panel-header"><div><h2 id="hojas-title">Directorio de hojas</h2><p>Información consultada desde el backend</p></div><span className="status-pill"><i className="status-dot" />{loading ? "Cargando" : result ? `${result.total} ${result.total === 1 ? "hoja" : "hojas"}` : "Sin datos"}</span></div>
      <div className="table-wrap"><table className="data-table hojas-table"><thead><tr><th>Folio físico</th><th>Cliente</th><th>Unidad</th><th>Estado</th><th>Fecha</th><th>Acción</th></tr></thead><tbody>
        {loading ? <tr><td className="list-state-cell" colSpan={6}><span className="table-loading"><i className="spinner" />Cargando hojas…</span></td></tr>
          : error ? <tr><td className="list-state-cell" colSpan={6}><div className="list-error" role="alert"><Icon name={error.status === 403 ? "shield" : "info"} size={23} /><strong>{error.status === 401 ? "La sesión venció" : error.status === 403 ? "Acceso denegado" : "No se pudo cargar el directorio"}</strong><p>{error.message}</p><button className="button-primary" onClick={() => void reload()} type="button">{error.status === 401 ? "Ir al inicio de sesión" : "Reintentar"}</button></div></td></tr>
            : !result?.data.length ? <tr><td className="list-state-cell" colSpan={6}><div className="empty-state"><span className="empty-icon"><Icon name="clipboard" size={22} /></span><strong>{query || clienteId || unidadId || estado ? "No se encontraron hojas" : "Aún no hay hojas registradas"}</strong><p>{query || clienteId || unidadId || estado ? "Cambia la búsqueda o los filtros para revisar otros resultados." : "Al registrar la primera hoja, aparecerá aquí vinculada a su cliente y unidad."}</p></div></td></tr>
              : result.data.map((documento) => <tr key={documento.id}><td><span className="unit-serial">{documento.folio_fisico}</span>{documento.cancelado_en && <span className="client-secondary">Cancelada</span>}</td><td><span className="client-name">{documento.cliente_nombre}</span></td><td><span className="client-name">{documento.numero_serie}</span></td><td><span className={`status-pill hoja-state ${documento.estado_trabajo === "finalizado" ? "is-done" : "is-progress"}`}><i className="status-dot" />{documento.estado_trabajo === "finalizado" ? "Finalizada" : "En construcción"}</span></td><td>{dateLabel(documento.fecha_documento ?? documento.creado_en)}</td><td><Link className="button-secondary row-edit-button" href={`/hojas-de-trabajo/${documento.id}`}>Abrir hoja</Link></td></tr>)}
      </tbody></table></div>
      {result && !error && <div className="pagination-row"><p className="pagination-summary">Mostrando <strong>{result.data.length ? result.offset + 1 : 0}–{Math.min(result.offset + result.data.length, result.total)}</strong> de <strong>{result.total}</strong></p><div className="pagination-controls"><button className="button-secondary" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex((value) => value - 1)} type="button">Anterior</button><span className="page-number">{totalPages ? `${pageIndex + 1} / ${totalPages}` : "0 / 0"}</span><button className="button-secondary" disabled={pageIndex + 1 >= totalPages || loading} onClick={() => setPageIndex((value) => value + 1)} type="button">Siguiente</button></div></div>}
    </section>
    {formOpen && <div className="dialog-backdrop" role="presentation"><section aria-labelledby="hoja-form-title" aria-modal="true" className="cliente-dialog hoja-dialog" role="dialog"><header className="cliente-dialog-header"><div><p className="page-eyebrow">Operación de taller</p><h2 id="hoja-form-title">Nueva hoja de trabajo</h2><p>Vincula el folio físico con un cliente y una unidad existentes.</p></div><button aria-label="Cerrar formulario" className="icon-button" disabled={saving} onClick={closeForm} type="button"><Icon name="close" size={18} /></button></header>
      <form noValidate onSubmit={(event) => void submit(event)}><div className="cliente-form-fields hoja-form-fields">
        <div className="cliente-form-field"><label htmlFor="hoja-folio">Folio físico <span className="field-requirement">Obligatorio</span></label><input aria-describedby={fieldErrors.folio_fisico ? "hoja-folio-error" : "hoja-folio-hint"} aria-invalid={Boolean(fieldErrors.folio_fisico)} autoComplete="off" id="hoja-folio" onChange={(event) => setField("folio_fisico", event.currentTarget.value)} placeholder="Ej. AG-0249" value={draft.folio_fisico} /><small className="field-hint" id="hoja-folio-hint">Se guarda en mayúsculas, sin espacios y conserva los guiones.</small>{fieldErrors.folio_fisico && <small className="field-error" id="hoja-folio-error">{fieldErrors.folio_fisico}</small>}</div>
        <div className="cliente-form-field"><label htmlFor="hoja-fecha">Fecha de la hoja <span className="field-requirement">Opcional</span></label><input id="hoja-fecha" onChange={(event) => setField("fecha_documento", event.currentTarget.value)} type="date" value={draft.fecha_documento} />{fieldErrors.fecha_documento && <small className="field-error">{fieldErrors.fecha_documento}</small>}</div>
        <div className="cliente-form-field"><label htmlFor="hoja-cliente">Cliente <span className="field-requirement">Obligatorio</span></label><select aria-invalid={Boolean(fieldErrors.cliente_id)} disabled={loadingOptions} id="hoja-cliente" onChange={(event) => { setField("cliente_id", event.currentTarget.value); setField("unidad_id", ""); }} value={draft.cliente_id}><option value="">{loadingOptions ? "Cargando clientes…" : "Selecciona un cliente"}</option>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>)}</select>{fieldErrors.cliente_id && <small className="field-error">{fieldErrors.cliente_id}</small>}</div>
        <div className="cliente-form-field"><label htmlFor="hoja-unidad">Unidad <span className="field-requirement">Obligatoria</span></label><select aria-invalid={Boolean(fieldErrors.unidad_id)} disabled={!draft.cliente_id} id="hoja-unidad" onChange={(event) => setField("unidad_id", event.currentTarget.value)} value={draft.unidad_id}><option value="">{draft.cliente_id ? "Selecciona una unidad" : "Primero selecciona un cliente"}</option>{unitsForCliente(unidades, draft.cliente_id).map((unidad) => <option key={unidad.id} value={unidad.id}>{unidad.numero_serie} · {[unidad.marca, unidad.modelo].filter(Boolean).join(" ") || "Camión"}</option>)}</select>{fieldErrors.unidad_id && <small className="field-error">{fieldErrors.unidad_id}</small>}</div>
        <div className="cliente-form-field hoja-wide"><label htmlFor="hoja-observaciones">Observaciones <span className="field-requirement">Opcional</span></label><textarea id="hoja-observaciones" onChange={(event) => setField("observaciones", event.currentTarget.value)} placeholder="Notas adicionales de recepción o del servicio" rows={3} value={draft.observaciones} /></div>
      </div>{formError && <div className="form-error-banner" role="alert"><Icon name={formError.includes("permiso") ? "shield" : "info"} size={16} /><div><strong>No se pudo guardar la hoja</strong><p>{formError}</p></div></div>}<footer className="cliente-dialog-footer"><button className="button-secondary" disabled={saving} onClick={closeForm} type="button">Cancelar</button><button className="button-primary" disabled={saving} type="submit">{saving ? <><i className="button-spinner" />Guardando…</> : "Guardar hoja"}</button></footer></form>
    </section></div>}
  </>;
}
