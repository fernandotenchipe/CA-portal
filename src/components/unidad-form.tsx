"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { ApiError, createUnidad, getClientes, updateUnidad, type Cliente, type Unidad } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { createSubmissionGuard, emptyUnidadDraft, mapUnidadError, normalizeSerial, preventSerialPaste, preventSerialPasteShortcut, toCreateUnidadPayload, toUpdateUnidadPayload, unidadToDraft, validateUnidadDraft, type UnidadDraft, type UnidadField, type UnidadFieldErrors } from "@/lib/unidades-form";
import { Icon } from "@/components/icon";

const lookupLimit = 100;

async function accessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ApiError("No está configurada la conexión de autenticación.", 0);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError("No se pudo recuperar la sesión de Supabase.", 0);
  if (!data.session?.access_token) throw new ApiError("La sesión venció. Inicia sesión nuevamente.", 401);
  return data.session.access_token;
}

export function UnidadForm({ unidad, onCancel, onSaved }: { unidad: Unidad | null; onCancel: () => void; onSaved: (saved: Unidad) => void }) {
  const editing = unidad !== null;
  const [draft, setDraft] = useState<UnidadDraft>(() => unidad ? unidadToDraft(unidad) : emptyUnidadDraft());
  const [customers, setCustomers] = useState<Cliente[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<UnidadFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const guard = useRef(createSubmissionGuard());

  useEffect(() => {
    if (editing) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      async function load() {
        setLoadingCustomers(true);
        setCustomerError(null);
        try {
          const token = await accessToken();
          const result = await getClientes({ accessToken: token, query: customerQuery.trim(), limit: lookupLimit, offset: 0, signal: controller.signal });
          if (active) setCustomers(result.data.filter((cliente) => cliente.activo));
        } catch (error) {
          if (active && !controller.signal.aborted) setCustomerError(error instanceof Error ? error.message : "No se pudieron cargar los clientes.");
        } finally {
          if (active) setLoadingCustomers(false);
        }
      }
      void load();
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [customerQuery, editing]);

  function updateField(field: UnidadField, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: field === "numero_serie" || field === "numero_serie_confirmacion" ? normalizeSerial(String(value)) : value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  function serialPasteProps(field: "numero_serie" | "numero_serie_confirmacion") {
    return {
      onPaste: (event: ClipboardEvent<HTMLInputElement>) => preventSerialPaste(event),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => preventSerialPasteShortcut(event),
      onDrop: (event: React.DragEvent<HTMLInputElement>) => event.preventDefault(),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => updateField(field, event.currentTarget.value),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !guard.current.acquire()) return;
    const fieldErrors = validateUnidadDraft(draft, editing ? "edit" : "create");
    setErrors(fieldErrors);
    setFormError(null);
    if (Object.keys(fieldErrors).length > 0) { guard.current.release(); return; }
    setSubmitting(true);
    try {
      const token = await accessToken();
      const saved = editing
        ? await updateUnidad({ accessToken: token, unidadId: unidad.id, payload: toUpdateUnidadPayload(draft, unidad) })
        : await createUnidad({ accessToken: token, payload: toCreateUnidadPayload(draft) });
      onSaved(saved);
    } catch (error) {
      const mapped = mapUnidadError(error, editing ? "edit" : "create");
      setErrors(mapped.fieldErrors);
      setFormError(mapped.message);
    } finally {
      setSubmitting(false);
      guard.current.release();
    }
  }

  function fieldError(field: UnidadField) {
    return errors[field] ? <small className="field-error" id={`unidad-${field}-error`}>{errors[field]}</small> : null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onCancel(); }}>
      <section aria-labelledby="unidad-form-title" aria-modal="true" className="cliente-dialog" role="dialog">
        <header className="cliente-dialog-header">
          <div><p className="page-eyebrow">Directorio de unidades</p><h2 id="unidad-form-title">{editing ? "Editar unidad" : "Registrar unidad"}</h2><p>{editing ? "Actualiza los datos permitidos. El cliente asociado no se puede cambiar." : "Vincula un camión a un cliente y captura su número de serie."}</p></div>
          <button aria-label="Cerrar formulario" className="icon-button" disabled={submitting} onClick={onCancel} type="button"><Icon name="close" size={18} /></button>
        </header>
        <form noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="cliente-form-fields">
            <div className="cliente-form-field">
              <label htmlFor="unidad-cliente">Cliente <span className="field-requirement">{editing ? "No modificable" : "Obligatorio"}</span></label>
              {editing
                ? <input aria-label="Cliente asociado (no editable)" disabled id="unidad-cliente" value={unidad.cliente_nombre} />
                : <>
                    <input aria-label="Buscar cliente" autoComplete="off" id="unidad-cliente-search" onChange={(event) => setCustomerQuery(event.currentTarget.value)} placeholder="Buscar cliente por nombre o RFC" value={customerQuery} />
                    <select aria-describedby={errors.cliente_id ? "unidad-cliente_id-error" : undefined} aria-invalid={Boolean(errors.cliente_id)} disabled={loadingCustomers || Boolean(customerError)} id="unidad-cliente" onChange={(event) => updateField("cliente_id", event.currentTarget.value)} value={draft.cliente_id}>
                      <option value="">{loadingCustomers ? "Cargando clientes…" : "Selecciona un cliente"}</option>
                      {customers.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}{cliente.rfc ? ` · ${cliente.rfc}` : ""}</option>)}
                    </select>
                    {customerError && <small className="field-error">{customerError}</small>}
                    {!loadingCustomers && !customerError && customers.length === 0 && <small className="field-hint">No se encontraron clientes activos con esa búsqueda.</small>}
                  </>}
              {fieldError("cliente_id")}
            </div>
            <div className="cliente-form-field">
              <label htmlFor="unidad-serie">Número de serie <span className="field-requirement">{editing ? "Si se cambia, confirma ambas capturas" : "Obligatorio"}</span></label>
              <input aria-describedby={errors.numero_serie ? "unidad-numero_serie-error" : "unidad-serial-hint"} aria-invalid={Boolean(errors.numero_serie)} autoCapitalize="characters" autoComplete="off" id="unidad-serie" maxLength={80} onChange={serialPasteProps("numero_serie").onChange} onDrop={serialPasteProps("numero_serie").onDrop} onKeyDown={serialPasteProps("numero_serie").onKeyDown} onPaste={serialPasteProps("numero_serie").onPaste} placeholder="Ej. 1HGBH41JXMN109186" spellCheck={false} value={draft.numero_serie} />
              {!errors.numero_serie && <small className="field-hint" id="unidad-serial-hint">Solo letras A–Z y números 0–9. No se permite pegar.</small>}{fieldError("numero_serie")}
            </div>
            <div className="cliente-form-field">
              <label htmlFor="unidad-serie-confirmacion">Confirmar número de serie <span className="field-requirement">{editing ? "Obligatorio para corregir serie" : "Obligatorio"}</span></label>
              <input aria-describedby={errors.numero_serie_confirmacion ? "unidad-numero_serie_confirmacion-error" : undefined} aria-invalid={Boolean(errors.numero_serie_confirmacion)} autoCapitalize="characters" autoComplete="off" id="unidad-serie-confirmacion" maxLength={80} onChange={serialPasteProps("numero_serie_confirmacion").onChange} onDrop={serialPasteProps("numero_serie_confirmacion").onDrop} onKeyDown={serialPasteProps("numero_serie_confirmacion").onKeyDown} onPaste={serialPasteProps("numero_serie_confirmacion").onPaste} placeholder="Vuelve a capturar el número" spellCheck={false} value={draft.numero_serie_confirmacion} />
              {fieldError("numero_serie_confirmacion")}
            </div>
            <TextField label="Marca" field="marca" value={draft.marca} onChange={updateField} />
            <TextField label="Modelo" field="modelo" value={draft.modelo} onChange={updateField} />
            <TextField error={errors.anio} label="Año" field="anio" value={draft.anio} onChange={updateField} inputMode="numeric" />
            <TextField label="Placas" field="placas" value={draft.placas} onChange={updateField} />
            <label className="cliente-active-control"><input checked={draft.activo} onChange={(event) => updateField("activo", event.currentTarget.checked)} type="checkbox" /><span><strong>Unidad activa</strong><small>Disponible en operaciones del taller</small></span></label>
          </div>
          {formError && <div className="form-error-banner" role="alert"><Icon name="info" size={17} /><div><strong>No se pudo guardar la unidad</strong><p>{formError}</p></div></div>}
          <footer className="cliente-dialog-footer"><button className="button-secondary" disabled={submitting} onClick={onCancel} type="button">Cancelar</button><button className="button-primary" disabled={submitting || (!editing && (loadingCustomers || Boolean(customerError)))} type="submit">{submitting && <i className="button-spinner" />}{submitting ? "Guardando…" : editing ? "Guardar cambios" : "Registrar unidad"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function TextField({ label, field, value, onChange, error, inputMode }: { label: string; field: "marca" | "modelo" | "anio" | "placas"; value: string; onChange: (field: UnidadField, value: string) => void; error?: string; inputMode?: "numeric" }) {
  const id = `unidad-${field}`;
  return <div className="cliente-form-field"><label htmlFor={id}>{label}<span className="field-requirement">Opcional</span></label><input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} id={id} inputMode={inputMode} maxLength={field === "anio" ? 4 : 100} onChange={(event) => onChange(field, event.currentTarget.value)} type="text" value={value} />{error && <small className="field-error" id={`${id}-error`}>{error}</small>}</div>;
}
