"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePortalAuth } from "@/components/portal-auth";
import { Icon } from "@/components/icon";
import { ApiError, createTrabajo, finalizeDocumentoCorto, finalizeTrabajo, getAllClientes, getAllUnidadesForCliente, getDocumentoCorto, getTrabajos, updateDocumentoCorto, updateTrabajo, type Cliente, type DocumentoCorto, type Trabajo, type Unidad } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { canEditTrabajo, canFinalizeTrabajo, canUseHojas, canUseTrabajos, createSubmissionGuard, emptyTrabajoDraft, hojaToDraft, mapHojaError, toTrabajoPayload, toUpdateHojaPayload, unitsForCliente, validateHojaDraft, validateTrabajoDraft, trabajoToDraft, type HojaDraft, type HojaField, type TrabajoDraft, type TrabajoField } from "@/lib/hojas-form";

async function token() {
  const supabase = getSupabaseBrowserClient(); if (!supabase) throw new ApiError("No está configurada la conexión de autenticación.", 0);
  const { data, error } = await supabase.auth.getSession(); if (error) throw new ApiError("No se pudo recuperar la sesión de Supabase.", 0);
  if (!data.session?.access_token) throw new ApiError("La sesión venció. Inicia sesión nuevamente.", 401);
  return { accessToken: data.session.access_token, supabase };
}
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value)) : "—";
const money = (value: string | null) => value === null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value));

export function HojaDetail({ documentoId }: { documentoId: string }) {
  const router = useRouter(); const { state, signOut } = usePortalAuth();
  const permissions = state.status === "authenticated" ? state.profile.permisos : [];
  const role = state.status === "authenticated" ? state.profile.rol.codigo : "";
  const canRead = canUseHojas(permissions, role, "consultar"); const canEdit = canUseHojas(permissions, role, "editar");
  const canReadWorks = canUseTrabajos(permissions, role, "consultar"); const canCreateWork = canUseTrabajos(permissions, role, "crear"); const canEditWork = canUseTrabajos(permissions, role, "editar");
  const [documento, setDocumento] = useState<DocumentoCorto | null>(null); const [trabajos, setTrabajos] = useState<Trabajo[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]); const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [workError, setWorkError] = useState(""); const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0); const [editSheet, setEditSheet] = useState(false); const [sheetDraft, setSheetDraft] = useState<HojaDraft | null>(null);
  const [sheetErrors, setSheetErrors] = useState<Partial<Record<HojaField, string>>>({}); const [sheetSaving, setSheetSaving] = useState(false); const [sheetError, setSheetError] = useState("");
  const [workEditor, setWorkEditor] = useState<Trabajo | "new" | null>(null); const [workDraft, setWorkDraft] = useState<TrabajoDraft>(emptyTrabajoDraft()); const [workErrors, setWorkErrors] = useState<Partial<Record<TrabajoField, string>>>({}); const [workSaving, setWorkSaving] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"sheet" | Trabajo | null>(null); const [confirming, setConfirming] = useState(false);
  const sheetGuard = useRef(createSubmissionGuard()); const workGuard = useRef(createSubmissionGuard()); const finalizationGuard = useRef(createSubmissionGuard());

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      async function load() {
        setLoading(true); setError(""); setWorkError("");
        try {
          const { accessToken } = await token();
          const doc = await getDocumentoCorto({ accessToken, documentoId }); if (!active) return; setDocumento(doc);
          if (canReadWorks) {
            try { const rows = await getTrabajos({ accessToken, documentoId }); if (active) setTrabajos(rows); }
            catch (cause) {
              if (!active) return;
              if (cause instanceof ApiError && cause.status === 401) setError(mapHojaError(cause, "edit").message);
              else { setWorkError(mapHojaError(cause, "work").message); setTrabajos([]); }
            }
          } else { setWorkError("Tu cuenta no tiene permiso para consultar los trabajos de esta hoja."); setTrabajos([]); }
        } catch (cause) { if (active) setError(mapHojaError(cause, "edit").message); }
        finally { if (active) setLoading(false); }
      }
      void load();
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [canReadWorks, documentoId, refresh]);
  useEffect(() => {
    if (!editSheet || !documento) return;
    const controller = new AbortController(); let active = true;
    const customerId = sheetDraft?.cliente_id ?? documento.cliente_id;
    async function lookups() {
      try { const { accessToken } = await token(); const [clients, units] = await Promise.all([
        getAllClientes({ accessToken, signal: controller.signal }),
        getAllUnidadesForCliente({ accessToken, clienteId: customerId, signal: controller.signal }),
      ]); if (active) { setClientes(clients); setUnidades(units); } }
      catch { if (active) setSheetError("No se pudieron cargar clientes y unidades para editar la hoja."); }
    }
    void lookups(); return () => { active = false; controller.abort(); };
  }, [editSheet, documento, sheetDraft?.cliente_id]);

  async function retry() { if (error.includes("sesión")) { await signOut(); router.replace("/login"); } else setRefresh((v) => v + 1); }
  function startEditSheet() { if (!documento) return; setSheetDraft(hojaToDraft(documento)); setSheetErrors({}); setSheetError(""); setEditSheet(true); }
  async function saveSheet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!documento || !sheetDraft || sheetSaving || !sheetGuard.current.acquire()) return;
    const errors = validateHojaDraft(sheetDraft); setSheetErrors(errors); if (Object.keys(errors).length) { sheetGuard.current.release(); return; }
    const payload = toUpdateHojaPayload(sheetDraft, documento); if (!Object.keys(payload).length) { sheetGuard.current.release(); setEditSheet(false); return; }
    setSheetSaving(true); setSheetError("");
    try { const { accessToken } = await token(); await updateDocumentoCorto({ accessToken, documentoId, payload }); setEditSheet(false); setSuccess("Los cambios de la hoja se guardaron."); setRefresh((v) => v + 1); }
    catch (cause) { const mapped = mapHojaError(cause, "edit"); setSheetError(mapped.message); if (mapped.folioError) setSheetErrors((v) => ({ ...v, folio_fisico: mapped.folioError })); if (mapped.status === 401) { await signOut(); router.replace("/login"); } }
    finally { sheetGuard.current.release(); setSheetSaving(false); }
  }
  function startWorkEditor(work: Trabajo | "new") { setWorkEditor(work); setWorkDraft(work === "new" ? emptyTrabajoDraft() : trabajoToDraft(work)); setWorkErrors({}); setWorkError(""); }
  async function saveWork(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!documento || !workEditor || workSaving || !workGuard.current.acquire()) return;
    const errors = validateTrabajoDraft(workDraft); setWorkErrors(errors); if (Object.keys(errors).length) { workGuard.current.release(); return; }
    setWorkSaving(true); setWorkError("");
    try {
      const { accessToken } = await token();
      if (workEditor === "new") await createTrabajo({ accessToken, documentoId, payload: toTrabajoPayload(workDraft) });
      else await updateTrabajo({ accessToken, trabajoId: workEditor.id, payload: toTrabajoPayload(workDraft) });
      setWorkEditor(null); setSuccess(workEditor === "new" ? "El trabajo se agregó a la hoja." : "Los cambios del trabajo se guardaron."); setRefresh((v) => v + 1);
    } catch (cause) { const mapped = mapHojaError(cause, "work"); setWorkError(mapped.message); if (mapped.status === 401) { await signOut(); router.replace("/login"); } }
    finally { workGuard.current.release(); setWorkSaving(false); }
  }
  async function confirmFinalize() {
    if (!confirmTarget || confirming || !finalizationGuard.current.acquire()) return; setConfirming(true); setWorkError("");
    try { const { accessToken } = await token();
      if (confirmTarget === "sheet") await finalizeDocumentoCorto({ accessToken, documentoId });
      else await finalizeTrabajo({ accessToken, trabajoId: confirmTarget.id });
      setSuccess(confirmTarget === "sheet" ? "La hoja quedó finalizada." : "El trabajo quedó finalizado."); setConfirmTarget(null); setRefresh((v) => v + 1);
    } catch (cause) { const mapped = mapHojaError(cause, confirmTarget === "sheet" ? "finalize" : "work"); setWorkError(mapped.message); if (mapped.status === 401) { await signOut(); router.replace("/login"); } }
    finally { finalizationGuard.current.release(); setConfirming(false); }
  }
  function setSheetField<K extends HojaField>(field: K, value: HojaDraft[K]) { setSheetDraft((current) => current ? ({ ...current, [field]: value }) : current); setSheetErrors((current) => ({ ...current, [field]: undefined })); }
  function setWorkField<K extends TrabajoField>(field: K, value: TrabajoDraft[K]) { setWorkDraft((current) => ({ ...current, [field]: value })); setWorkErrors((current) => ({ ...current, [field]: undefined })); }

  if (!canRead) return <section className="panel access-denied"><Icon name="shield" size={24} /><h2>Sin permiso para consultar hojas</h2><p>Se requiere “documentos_cortos.consultar” y un rol autorizado.</p></section>;
  if (loading) return <section className="panel hoja-detail-state"><span className="spinner" /><p>Cargando hoja de trabajo…</p></section>;
  if (error || !documento) return <section className="panel hoja-detail-state" role="alert"><Icon name="info" size={22} /><h2>No se pudo abrir la hoja</h2><p>{error || "La hoja no está disponible."}</p><button className="button-primary" onClick={() => void retry()} type="button">Reintentar</button></section>;
  const isClosed = documento.estado_trabajo === "finalizado" || Boolean(documento.cancelado_en);
  const workEditingAllowed = !isClosed;
  const alert = (target: "sheet" | Trabajo) => target === "sheet" ? "¿Finalizar esta hoja? Al hacerlo quedará en consulta para operaciones ordinarias. Los trabajos pendientes podrán finalizarse después." : `¿Marcar como finalizado el trabajo ${target.numero_orden}?`;

  return <>
    <div className="hoja-back-row"><Link className="text-link" href="/hojas-de-trabajo">← Volver a hojas</Link></div>
    <div className="page-heading hoja-detail-heading"><div><p className="page-eyebrow">Hoja de trabajo</p><h1 className="page-title">{documento.folio_fisico}</h1><p className="page-subtitle">{documento.cliente_nombre} · {documento.numero_serie}</p></div><div className="hoja-heading-actions"><span className={`status-pill hoja-state ${documento.estado_trabajo === "finalizado" ? "is-done" : "is-progress"}`}><i className="status-dot" />{documento.cancelado_en ? "Cancelada" : documento.estado_trabajo === "finalizado" ? "Finalizada" : "En construcción"}</span>{canEdit && <button className="button-secondary" onClick={startEditSheet} type="button">{isClosed ? "Corregir folio" : "Editar hoja"}</button>}{canEdit && documento.estado_trabajo === "en_construccion" && !documento.cancelado_en && <button className="button-primary" onClick={() => setConfirmTarget("sheet")} type="button">Finalizar hoja</button>}</div></div>
    {success && <div className="callout success-callout" role="status"><Icon name="check" size={16} /><span>{success}</span><button aria-label="Cerrar confirmación" className="notice-dismiss" onClick={() => setSuccess("")} type="button"><Icon name="close" size={15} /></button></div>}
    {workError && <div className="form-error-banner" role="alert"><Icon name="info" size={16} /><div><strong>No se pudo completar la operación</strong><p>{workError}</p><button className="text-link" onClick={() => setRefresh((v) => v + 1)} type="button">Actualizar</button></div></div>}
    <section className="hoja-summary-grid"><article className="panel hoja-info-card"><p className="page-eyebrow">Datos de la hoja</p><dl><div><dt>Folio físico</dt><dd>{documento.folio_fisico}</dd></div><div><dt>Folio normalizado</dt><dd>{documento.folio_fisico_normalizado}</dd></div><div><dt>Cliente</dt><dd>{documento.cliente_nombre}</dd></div><div><dt>Número de serie</dt><dd>{documento.numero_serie}</dd></div><div><dt>Fecha de la hoja</dt><dd>{dateLabel(documento.fecha_documento)}</dd></div><div><dt>Estado</dt><dd>{documento.estado_trabajo === "finalizado" ? `Finalizada ${dateLabel(documento.finalizado_en)}` : "En construcción"}</dd></div><div className="hoja-notes"><dt>Observaciones</dt><dd>{documento.observaciones || "Sin observaciones"}</dd></div></dl></article><article className="panel hoja-detail-callout"><span className="metric-icon"><Icon name="clipboard" size={18} /></span><strong>{isClosed ? "Hoja en modo consulta" : "Registro operativo"}</strong><p>{documento.cancelado_en ? "La hoja está cancelada. No admite nuevas operaciones." : documento.estado_trabajo === "finalizado" ? "La hoja está finalizada. Los trabajos pendientes pueden concluirse individualmente." : "Puedes actualizar la hoja y administrar los trabajos según tus permisos."}</p></article></section>
    <section aria-labelledby="trabajos-title" className="panel hoja-work-panel"><div className="panel-header"><div><h2 id="trabajos-title">Trabajos de la hoja</h2><p>{canReadWorks ? `${trabajos.length} ${trabajos.length === 1 ? "trabajo" : "trabajos"} registrados` : "Vista protegida por permisos de trabajos"}</p></div>{canCreateWork && workEditingAllowed && <button className="button-primary" onClick={() => startWorkEditor("new")} type="button"><Icon name="plus" size={15} />Agregar trabajo</button>}</div>
      {!canReadWorks ? <div className="empty-state hoja-works-empty"><span className="empty-icon"><Icon name="shield" size={21} /></span><strong>Sin permiso para consultar trabajos</strong><p>Solicita “trabajos.consultar” para ver el contenido de la hoja.</p></div> : <div className="table-wrap"><table className="data-table hoja-work-table"><thead><tr><th>#</th><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{!trabajos.length ? <tr><td className="list-state-cell" colSpan={7}><div className="empty-state"><span className="empty-icon"><Icon name="briefcase" size={21} /></span><strong>Aún no hay trabajos</strong><p>{workEditingAllowed ? "Agrega los conceptos solicitados para esta hoja." : "No hay trabajos asociados a esta hoja."}</p></div></td></tr> : trabajos.map((work) => <tr key={work.id}><td>{work.numero_orden}</td><td><span className="client-name">{work.descripcion}</span>{work.observaciones && <span className="client-secondary">{work.observaciones}</span>}</td><td>{work.cantidad ? `${work.cantidad}${work.unidad_medida ? ` ${work.unidad_medida}` : ""}` : "—"}</td><td>{money(work.precio_unitario)}</td><td>{money(work.importe)}</td><td><span className={`status-pill hoja-state ${work.estado === "finalizado" ? "is-done" : "is-progress"}`}><i className="status-dot" />{work.estado === "finalizado" ? "Finalizado" : "En construcción"}</span></td><td><div className="table-actions">{canEditWork && canEditTrabajo(documento, work) && <button className="button-secondary row-edit-button" onClick={() => startWorkEditor(work)} type="button">Editar</button>}{canEditWork && canFinalizeTrabajo(documento, work) && <button className="button-secondary row-edit-button" onClick={() => setConfirmTarget(work)} type="button">Finalizar</button>}</div></td></tr>)}</tbody></table></div>}
    </section>

    {editSheet && sheetDraft && <div className="dialog-backdrop" role="presentation"><section aria-labelledby="edit-hoja-title" aria-modal="true" className="cliente-dialog hoja-dialog" role="dialog"><header className="cliente-dialog-header"><div><p className="page-eyebrow">Hoja {documento.folio_fisico}</p><h2 id="edit-hoja-title">{isClosed ? "Corregir folio físico" : "Editar hoja de trabajo"}</h2><p>{isClosed ? "Los demás campos permanecen bloqueados al finalizar o cancelar." : "Actualiza únicamente datos admitidos por el servicio."}</p></div><button aria-label="Cerrar edición" className="icon-button" disabled={sheetSaving} onClick={() => setEditSheet(false)} type="button"><Icon name="close" size={18} /></button></header><form noValidate onSubmit={(event) => void saveSheet(event)}><div className="cliente-form-fields hoja-form-fields"><div className="cliente-form-field"><label htmlFor="edit-hoja-folio">Folio físico <span className="field-requirement">Obligatorio</span></label><input aria-invalid={Boolean(sheetErrors.folio_fisico)} id="edit-hoja-folio" onChange={(event) => setSheetField("folio_fisico", event.currentTarget.value)} value={sheetDraft.folio_fisico} />{sheetErrors.folio_fisico && <small className="field-error">{sheetErrors.folio_fisico}</small>}</div>{!isClosed && <><div className="cliente-form-field"><label htmlFor="edit-hoja-fecha">Fecha de la hoja</label><input id="edit-hoja-fecha" onChange={(event) => setSheetField("fecha_documento", event.currentTarget.value)} type="date" value={sheetDraft.fecha_documento} /></div><div className="cliente-form-field"><label htmlFor="edit-hoja-cliente">Cliente</label><select id="edit-hoja-cliente" onChange={(event) => { setSheetField("cliente_id", event.currentTarget.value); setSheetField("unidad_id", ""); }} value={sheetDraft.cliente_id}>{clientes.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></div><div className="cliente-form-field"><label htmlFor="edit-hoja-unidad">Unidad</label><select id="edit-hoja-unidad" onChange={(event) => setSheetField("unidad_id", event.currentTarget.value)} value={sheetDraft.unidad_id}>{unitsForCliente(unidades, sheetDraft.cliente_id).map((unit) => <option key={unit.id} value={unit.id}>{unit.numero_serie}</option>)}</select></div><div className="cliente-form-field hoja-wide"><label htmlFor="edit-hoja-notes">Observaciones</label><textarea id="edit-hoja-notes" onChange={(event) => setSheetField("observaciones", event.currentTarget.value)} rows={3} value={sheetDraft.observaciones} /></div></>}</div>{sheetError && <div className="form-error-banner" role="alert"><Icon name="info" size={16} /><p>{sheetError}</p></div>}<footer className="cliente-dialog-footer"><button className="button-secondary" disabled={sheetSaving} onClick={() => setEditSheet(false)} type="button">Cancelar</button><button className="button-primary" disabled={sheetSaving} type="submit">{sheetSaving ? "Guardando…" : "Guardar cambios"}</button></footer></form></section></div>}

    {workEditor && <div className="dialog-backdrop" role="presentation"><section aria-labelledby="trabajo-form-title" aria-modal="true" className="cliente-dialog hoja-dialog" role="dialog"><header className="cliente-dialog-header"><div><p className="page-eyebrow">Hoja {documento.folio_fisico}</p><h2 id="trabajo-form-title">{workEditor === "new" ? "Agregar trabajo" : `Editar trabajo ${workEditor.numero_orden}`}</h2><p>Usa solo la descripción y valores admitidos por el módulo.</p></div><button aria-label="Cerrar formulario" className="icon-button" disabled={workSaving} onClick={() => setWorkEditor(null)} type="button"><Icon name="close" size={18} /></button></header><form noValidate onSubmit={(event) => void saveWork(event)}><div className="cliente-form-fields hoja-form-fields"><div className="cliente-form-field hoja-wide"><label htmlFor="trabajo-description">Descripción <span className="field-requirement">Obligatoria</span></label><input aria-invalid={Boolean(workErrors.descripcion)} id="trabajo-description" onChange={(event) => setWorkField("descripcion", event.currentTarget.value)} value={workDraft.descripcion} />{workErrors.descripcion && <small className="field-error">{workErrors.descripcion}</small>}</div><div className="cliente-form-field"><label htmlFor="trabajo-cantidad">Cantidad <span className="field-requirement">Opcional</span></label><input aria-invalid={Boolean(workErrors.cantidad)} id="trabajo-cantidad" min="0.001" onChange={(event) => setWorkField("cantidad", event.currentTarget.value)} step="0.001" type="number" value={workDraft.cantidad} />{workErrors.cantidad && <small className="field-error">{workErrors.cantidad}</small>}</div><div className="cliente-form-field"><label htmlFor="trabajo-unit">Unidad de medida <span className="field-requirement">Opcional</span></label><input id="trabajo-unit" onChange={(event) => setWorkField("unidad_medida", event.currentTarget.value)} value={workDraft.unidad_medida} /></div><div className="cliente-form-field"><label htmlFor="trabajo-price">Precio unitario <span className="field-requirement">Opcional</span></label><input aria-invalid={Boolean(workErrors.precio_unitario)} id="trabajo-price" min="0" onChange={(event) => setWorkField("precio_unitario", event.currentTarget.value)} step="0.01" type="number" value={workDraft.precio_unitario} />{workErrors.precio_unitario && <small className="field-error">{workErrors.precio_unitario}</small>}</div><div className="cliente-form-field hoja-wide"><label htmlFor="trabajo-notes">Observaciones <span className="field-requirement">Opcionales</span></label><textarea id="trabajo-notes" onChange={(event) => setWorkField("observaciones", event.currentTarget.value)} rows={3} value={workDraft.observaciones} /></div></div>{workError && <div className="form-error-banner" role="alert"><Icon name="info" size={16} /><p>{workError}</p></div>}<footer className="cliente-dialog-footer"><button className="button-secondary" disabled={workSaving} onClick={() => setWorkEditor(null)} type="button">Cancelar</button><button className="button-primary" disabled={workSaving} type="submit">{workSaving ? "Guardando…" : "Guardar trabajo"}</button></footer></form></section></div>}

    {confirmTarget && <div className="dialog-backdrop" role="presentation"><section aria-labelledby="finalize-title" aria-modal="true" className="cliente-dialog hoja-confirm-dialog" role="dialog"><header className="cliente-dialog-header"><div><p className="page-eyebrow">Confirmación</p><h2 id="finalize-title">Confirmar finalización</h2><p>{alert(confirmTarget)}</p></div></header><footer className="cliente-dialog-footer"><button className="button-secondary" disabled={confirming} onClick={() => setConfirmTarget(null)} type="button">Cancelar</button><button className="button-primary" disabled={confirming} onClick={() => void confirmFinalize()} type="button">{confirming ? "Procesando…" : "Confirmar"}</button></footer></section></div>}
  </>;
}
