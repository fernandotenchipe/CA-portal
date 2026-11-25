"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createCliente, updateCliente, type Cliente, type CreateClientePayload, type UpdateClientePayload } from "@/lib/api";
import {
  cancelClienteForm,
  createAndNotify,
  createSubmissionGuard,
  clienteToDraft,
  emptyClienteDraft,
  mapClienteCreateError,
  toUpdateClientePayload,
  toCreateClientePayload,
  updateAndNotify,
  validateClienteDraft,
  type ClienteDraft,
  type ClienteFormField,
  type ClienteFieldErrors,
} from "@/lib/clientes-form";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { usePortalAuth } from "@/components/portal-auth";
import { Icon } from "@/components/icon";

interface ClienteFormProps {
  mode: "create" | "edit";
  cliente?: Cliente;
  onCancel: () => void;
  onSaved: (cliente: Cliente) => void;
}

function TextField({
  label,
  optional = true,
  value,
  error,
  onChange,
  inputRef,
  type = "text",
  autoComplete,
  inputMode,
  disabled = false,
}: {
  label: string;
  optional?: boolean;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  type?: "text" | "tel";
  autoComplete?: string;
  inputMode?: "email" | "tel";
  disabled?: boolean;
}) {
  const id = `cliente-${label.toLocaleLowerCase("es-MX").replaceAll(" ", "-")}`;
  const errorId = `${id}-error`;
  return (
    <div className="cliente-form-field">
      <label htmlFor={id}>{label}<span className="field-requirement">{optional ? "Opcional" : "Obligatorio"}</span></label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        disabled={disabled}
        id={id}
        inputMode={inputMode}
        onChange={(event) => onChange(event.currentTarget.value)}
        ref={inputRef}
        type={type}
        value={value}
      />
      {error && <span className="field-error" id={errorId}>{error}</span>}
    </div>
  );
}

export function ClienteForm({ mode, cliente, onCancel, onSaved }: ClienteFormProps) {
  const router = useRouter();
  const { signOut } = usePortalAuth();
  const editing = mode === "edit";
  const [draft, setDraft] = useState<ClienteDraft>(() => cliente ? clienteToDraft(cliente) : emptyClienteDraft());
  const [fieldErrors, setFieldErrors] = useState<ClienteFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const submissionGuard = useRef(createSubmissionGuard());

  useEffect(() => {
    nameInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) cancelClienteForm(onCancel);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function updateDraft(field: ClienteFormField, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
    setErrorStatus(null);
  }

  async function submitWithSession(payload: ReturnType<typeof toCreateClientePayload> | ReturnType<typeof toUpdateClientePayload>) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new ApiError("No está configurada la conexión de autenticación.", 0);

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new ApiError("No se pudo recuperar la sesión de Supabase.", 0);
    if (!sessionData.session?.access_token) throw new ApiError("La sesión venció. Inicia sesión nuevamente.", 401);

    const send = (accessToken: string) => {
      if (editing) {
        if (!cliente) throw new ApiError("No se encontró el cliente que se intenta editar.", 404);
        return updateCliente({ accessToken, clienteId: cliente.id, payload: payload as UpdateClientePayload });
      }
      return createCliente({ accessToken, payload: payload as CreateClientePayload });
    };

    try {
      return await send(sessionData.session.access_token);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session?.access_token) throw error;
      return send(refreshed.session.access_token);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateClienteDraft(draft);
    setFieldErrors(errors);
    setFormError(null);
    setErrorStatus(null);
    if (Object.keys(errors).length > 0 || !submissionGuard.current.acquire()) return;

    setSubmitting(true);
    submittingRef.current = true;
    try {
      if (editing && !cliente) throw new ApiError("No se encontró el cliente que se intenta editar.", 404);
      const payload = editing && cliente
        ? toUpdateClientePayload(draft, cliente)
        : toCreateClientePayload(draft);
      if (editing && Object.keys(payload).length === 0) {
        setFormError("No hiciste cambios en la información del cliente.");
        setErrorStatus(null);
        return;
      }
      const save = () => submitWithSession(payload);
      if (editing) await updateAndNotify(save, onSaved);
      else await createAndNotify(save, onSaved);
    } catch (error) {
      const mapped = mapClienteCreateError(error);
      setFieldErrors(mapped.fieldErrors);
      setFormError(mapped.message);
      setErrorStatus(mapped.status);
    } finally {
      submissionGuard.current.release();
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function leaveExpiredSession() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) cancelClienteForm(onCancel); }}>
      <section aria-labelledby="cliente-form-title" aria-modal="true" className="cliente-dialog" role="dialog">
        <header className="cliente-dialog-header">
          <div>
            <p className="page-eyebrow">Directorio</p>
            <h2 id="cliente-form-title">{editing ? "Editar cliente" : "Registrar cliente"}</h2>
            <p>{editing ? "Actualiza la información del cliente seleccionado." : "Completa los datos de contacto para agregarlo al directorio."}</p>
          </div>
          <button aria-label="Cerrar formulario" className="icon-button" disabled={submitting} onClick={() => cancelClienteForm(onCancel)} type="button"><Icon name="close" size={18} /></button>
        </header>

        <form noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="cliente-form-fields">
            <TextField
              autoComplete="organization"
              disabled={submitting}
              error={fieldErrors.nombre}
              inputRef={nameInput}
              label="Nombre del cliente"
              onChange={(value) => updateDraft("nombre", value)}
              optional={false}
              value={draft.nombre}
            />
            <TextField
              autoComplete="organization"
              disabled={submitting}
              error={fieldErrors.razon_social}
              label="Razón social"
              onChange={(value) => updateDraft("razon_social", value)}
              value={draft.razon_social}
            />
            <TextField
              error={fieldErrors.rfc}
              disabled={submitting}
              label="RFC"
              onChange={(value) => updateDraft("rfc", value)}
              value={draft.rfc}
            />
            <TextField
              autoComplete="email"
              error={fieldErrors.correo}
              disabled={submitting}
              inputMode="email"
              label="Correo electrónico"
              onChange={(value) => updateDraft("correo", value)}
              value={draft.correo}
            />
            <TextField
              autoComplete="tel"
              error={fieldErrors.telefono}
              disabled={submitting}
              inputMode="tel"
              label="Teléfono"
              onChange={(value) => updateDraft("telefono", value)}
              type="tel"
              value={draft.telefono}
            />
            <label className="cliente-active-control">
              <input checked={draft.activo} disabled={submitting} onChange={(event) => updateDraft("activo", event.currentTarget.checked)} type="checkbox" />
              <span><strong>Cliente activo <em className="field-requirement">Opcional</em></strong><small>Podrá seleccionarse en futuras operaciones.</small></span>
            </label>
          </div>

          {formError && (
            <div className="form-error-banner" role="alert">
              <Icon name={errorStatus === 401 || errorStatus === 403 ? "shield" : "activity"} size={17} />
              <div><strong>{errorStatus === 401 ? "La sesión requiere atención" : errorStatus === 403 ? "Permiso insuficiente" : errorStatus === 404 ? "Cliente no disponible" : errorStatus === 409 ? "RFC duplicado" : errorStatus === 503 ? "Servicio no disponible" : "Revisa la información"}</strong><p>{formError}</p>
                {errorStatus === 401 && <button className="text-link" onClick={() => void leaveExpiredSession()} type="button">Iniciar sesión nuevamente</button>}
              </div>
            </div>
          )}

          <footer className="cliente-dialog-footer">
            <button className="button-secondary" disabled={submitting} onClick={() => cancelClienteForm(onCancel)} type="button">Cancelar</button>
            <button className="button-primary" disabled={submitting} type="submit">
              {submitting ? <><i className="button-spinner" />Guardando…</> : editing ? "Guardar cambios" : "Registrar cliente"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
