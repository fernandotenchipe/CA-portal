import type { CreateUnidadPayload, Unidad, UpdateUnidadPayload } from "./api";

export interface UnidadDraft {
  cliente_id: string;
  numero_serie: string;
  numero_serie_confirmacion: string;
  marca: string;
  modelo: string;
  anio: string;
  placas: string;
  activo: boolean;
}

export type UnidadField = keyof UnidadDraft;
export type UnidadFieldErrors = Partial<Record<UnidadField, string>>;

export function canConsultUnidades(permisos: readonly string[]): boolean {
  return permisos.includes("unidades.consultar");
}

export function canCreateUnidad(permisos: readonly string[]): boolean {
  return permisos.includes("unidades.crear");
}

export function canEditUnidad(permisos: readonly string[]): boolean {
  return permisos.includes("unidades.editar");
}

export function emptyUnidadDraft(): UnidadDraft {
  return { cliente_id: "", numero_serie: "", numero_serie_confirmacion: "", marca: "", modelo: "", anio: "", placas: "", activo: true };
}

export function unidadToDraft(unidad: Unidad): UnidadDraft {
  return {
    cliente_id: unidad.cliente_id,
    numero_serie: unidad.numero_serie,
    numero_serie_confirmacion: unidad.numero_serie,
    marca: unidad.marca ?? "",
    modelo: unidad.modelo ?? "",
    anio: unidad.anio === null ? "" : String(unidad.anio),
    placas: unidad.placas ?? "",
    activo: unidad.activo,
  };
}

export function normalizeSerial(value: string): string {
  return value.toUpperCase();
}

export function validateUnidadDraft(draft: UnidadDraft, mode: "create" | "edit"): UnidadFieldErrors {
  const errors: UnidadFieldErrors = {};
  if (mode === "create" && !draft.cliente_id) errors.cliente_id = "Selecciona un cliente.";
  const serial = normalizeSerial(draft.numero_serie);
  const confirmation = normalizeSerial(draft.numero_serie_confirmacion);
  if (mode === "create" || draft.numero_serie || draft.numero_serie_confirmacion) {
    if (!serial) errors.numero_serie = "El número de serie es obligatorio.";
    else if (!/^[A-Z0-9]+$/.test(serial)) errors.numero_serie = "Usa únicamente letras A–Z y números 0–9, sin espacios ni guiones.";
    if (!confirmation) errors.numero_serie_confirmacion = "Confirma el número de serie.";
    else if (!/^[A-Z0-9]+$/.test(confirmation)) errors.numero_serie_confirmacion = "Usa únicamente letras A–Z y números 0–9, sin espacios ni guiones.";
    else if (serial !== confirmation) errors.numero_serie_confirmacion = "Los números de serie no coinciden.";
  }
  const anio = draft.anio.trim();
  if (anio && (!/^\d{4}$/.test(anio) || Number(anio) < 1886 || Number(anio) > 2200)) {
    errors.anio = "Escribe un año entre 1886 y 2200.";
  }
  return errors;
}

function optionalString(value: string): string | null {
  return value.trim() || null;
}

export function toCreateUnidadPayload(draft: UnidadDraft): CreateUnidadPayload {
  return {
    cliente_id: draft.cliente_id,
    numero_serie: normalizeSerial(draft.numero_serie),
    numero_serie_confirmacion: normalizeSerial(draft.numero_serie_confirmacion),
    marca: optionalString(draft.marca),
    modelo: optionalString(draft.modelo),
    anio: draft.anio.trim() ? Number(draft.anio) : null,
    placas: optionalString(draft.placas),
    activo: draft.activo,
  };
}

export function toUpdateUnidadPayload(draft: UnidadDraft, original: Unidad): UpdateUnidadPayload {
  const changes: UpdateUnidadPayload = {};
  if (draft.numero_serie && normalizeSerial(draft.numero_serie) !== original.numero_serie) {
    changes.numero_serie = normalizeSerial(draft.numero_serie);
    changes.numero_serie_confirmacion = normalizeSerial(draft.numero_serie_confirmacion);
  }
  if (draft.marca !== (original.marca ?? "")) changes.marca = optionalString(draft.marca);
  if (draft.modelo !== (original.modelo ?? "")) changes.modelo = optionalString(draft.modelo);
  if (draft.anio !== (original.anio === null ? "" : String(original.anio))) changes.anio = draft.anio.trim() ? Number(draft.anio) : null;
  if (draft.placas !== (original.placas ?? "")) changes.placas = optionalString(draft.placas);
  if (draft.activo !== original.activo) changes.activo = draft.activo;
  return changes;
}

export function preventSerialPaste(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

export function preventSerialPasteShortcut(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault: () => void }): void {
  if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") || (event.shiftKey && event.key === "Insert")) event.preventDefault();
}

export function createSubmissionGuard() {
  let inFlight = false;
  return {
    acquire() { if (inFlight) return false; inFlight = true; return true; },
    release() { inFlight = false; },
  };
}

export function mapUnidadError(error: unknown, mode: "create" | "edit"): { status: number; message: string; fieldErrors: UnidadFieldErrors } {
  const err = error instanceof Error ? error as Error & { status?: unknown; code?: unknown } : null;
  const status = typeof err?.status === "number" ? err.status : 0;
  const code = typeof err?.code === "string" ? err.code : "";
  if (status === 409 && code === "duplicate_serial") {
    return { status, message: "Ese número de serie ya está registrado.", fieldErrors: { numero_serie: "Este número de serie ya está registrado." } };
  }
  if (status === 404 && mode === "create") return { status, message: "El cliente seleccionado ya no está disponible. Actualiza la página y vuelve a seleccionarlo.", fieldErrors: { cliente_id: "El cliente ya no está disponible." } };
  if (status === 400 || status === 422) return { status, message: err?.message || "Revisa los datos de la unidad.", fieldErrors: {} };
  if (status === 401) return { status, message: "La sesión venció. Inicia sesión nuevamente.", fieldErrors: {} };
  if (status === 403) return { status, message: mode === "create" ? "Tu cuenta no tiene permiso para registrar unidades." : "Tu cuenta no tiene permiso para editar unidades.", fieldErrors: {} };
  if (status === 404) return { status, message: "La unidad ya no existe o dejó de estar disponible.", fieldErrors: {} };
  if (status === 503 || status === 502 || status === 504 || status === 0) return { status, message: "No se pudo conectar con el backend. Verifica que esté disponible; la lista se actualizará antes de reintentar.", fieldErrors: {} };
  return { status, message: err?.message || "No se pudo guardar la unidad.", fieldErrors: {} };
}
