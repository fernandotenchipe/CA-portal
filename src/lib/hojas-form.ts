import type { CreateDocumentoPayload, DocumentoCorto, Trabajo, TrabajoPayload, Unidad, UpdateDocumentoPayload } from "./api";

export interface HojaDraft {
  folio_fisico: string;
  cliente_id: string;
  unidad_id: string;
  observaciones: string;
  fecha_documento: string;
}

export interface TrabajoDraft {
  descripcion: string;
  cantidad: string;
  unidad_medida: string;
  precio_unitario: string;
  observaciones: string;
}

export type HojaField = keyof HojaDraft;
export type TrabajoField = keyof TrabajoDraft;
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export const emptyHojaDraft = (): HojaDraft => ({ folio_fisico: "", cliente_id: "", unidad_id: "", observaciones: "", fecha_documento: "" });
export const emptyTrabajoDraft = (): TrabajoDraft => ({ descripcion: "", cantidad: "", unidad_medida: "", precio_unitario: "", observaciones: "" });
export function unitsForCliente(unidades: readonly Unidad[], clienteId: string): Unidad[] { return unidades.filter((unidad) => unidad.cliente_id === clienteId); }

export function canUseHojas(permissions: readonly string[], roleCode: string, operation: "consultar" | "crear" | "editar"): boolean {
  return ["ADMINISTRACION", "VENTAS", "LOGISTICA"].includes(roleCode.toLocaleUpperCase("es-MX")) && permissions.includes(`documentos_cortos.${operation}`);
}

export function canUseTrabajos(permissions: readonly string[], roleCode: string, operation: "consultar" | "crear" | "editar"): boolean {
  return ["ADMINISTRACION", "VENTAS", "LOGISTICA"].includes(roleCode.toLocaleUpperCase("es-MX")) && permissions.includes(`trabajos.${operation}`);
}

export function normalizeFolio(value: string): string {
  return value.toLocaleUpperCase("es-MX").replace(/\s+/gu, "");
}

export function validateHojaDraft(draft: HojaDraft): FieldErrors<HojaField> {
  const errors: FieldErrors<HojaField> = {};
  const folio = normalizeFolio(draft.folio_fisico);
  if (!folio) errors.folio_fisico = "El folio físico es obligatorio.";
  else if (!/^[A-Z0-9-]+$/.test(folio)) errors.folio_fisico = "Usa únicamente letras A–Z, números y guiones.";
  if (!draft.cliente_id) errors.cliente_id = "Selecciona un cliente.";
  if (!draft.unidad_id) errors.unidad_id = "Selecciona una unidad del cliente.";
  if (draft.fecha_documento && !/^\d{4}-\d{2}-\d{2}$/.test(draft.fecha_documento)) errors.fecha_documento = "Usa una fecha válida.";
  return errors;
}

export function toCreateHojaPayload(draft: HojaDraft): CreateDocumentoPayload {
  return { folio_fisico: normalizeFolio(draft.folio_fisico), cliente_id: draft.cliente_id, unidad_id: draft.unidad_id, observaciones: draft.observaciones.trim() || null, fecha_documento: draft.fecha_documento || null };
}

export function hojaToDraft(documento: DocumentoCorto): HojaDraft {
  return { folio_fisico: documento.folio_fisico, cliente_id: documento.cliente_id, unidad_id: documento.unidad_id, observaciones: documento.observaciones ?? "", fecha_documento: documento.fecha_documento ?? "" };
}

export function toUpdateHojaPayload(draft: HojaDraft, original: DocumentoCorto): UpdateDocumentoPayload {
  const changes: UpdateDocumentoPayload = {};
  if (normalizeFolio(draft.folio_fisico) !== original.folio_fisico_normalizado) changes.folio_fisico = normalizeFolio(draft.folio_fisico);
  if (original.estado_trabajo === "en_construccion" && !original.cancelado_en) {
    if (draft.cliente_id !== original.cliente_id || draft.unidad_id !== original.unidad_id) {
      changes.cliente_id = draft.cliente_id;
      changes.unidad_id = draft.unidad_id;
    }
    if (draft.observaciones !== (original.observaciones ?? "")) changes.observaciones = draft.observaciones.trim() || null;
    if (draft.fecha_documento !== (original.fecha_documento ?? "")) changes.fecha_documento = draft.fecha_documento || null;
  }
  return changes;
}

export function validateTrabajoDraft(draft: TrabajoDraft): FieldErrors<TrabajoField> {
  const errors: FieldErrors<TrabajoField> = {};
  if (!draft.descripcion.trim()) errors.descripcion = "La descripción del trabajo es obligatoria.";
  const checkNumber = (field: "cantidad" | "precio_unitario", value: string) => {
    if (!value.trim()) return;
    const number = Number(value);
    if (!Number.isFinite(number) || number < (field === "cantidad" ? Number.EPSILON : 0)) errors[field] = field === "cantidad" ? "La cantidad debe ser mayor que cero." : "El precio debe ser cero o mayor.";
    else if (field === "cantidad" && (value.split(".")[1]?.length ?? 0) > 3) errors[field] = "Admite hasta 3 decimales.";
    else if (field === "precio_unitario" && (value.split(".")[1]?.length ?? 0) > 2) errors[field] = "Admite hasta 2 decimales.";
  };
  checkNumber("cantidad", draft.cantidad);
  checkNumber("precio_unitario", draft.precio_unitario);
  return errors;
}

const optionalNumber = (value: string): number | null => value.trim() ? Number(value) : null;
export function toTrabajoPayload(draft: TrabajoDraft): TrabajoPayload {
  return { descripcion: draft.descripcion.trim(), cantidad: optionalNumber(draft.cantidad), unidad_medida: draft.unidad_medida.trim() || null, precio_unitario: optionalNumber(draft.precio_unitario), observaciones: draft.observaciones.trim() || null };
}

export function trabajoToDraft(trabajo: Trabajo): TrabajoDraft {
  return { descripcion: trabajo.descripcion, cantidad: trabajo.cantidad ?? "", unidad_medida: trabajo.unidad_medida ?? "", precio_unitario: trabajo.precio_unitario ?? "", observaciones: trabajo.observaciones ?? "" };
}

export function canEditTrabajo(documento: DocumentoCorto, trabajo: Trabajo): boolean {
  return documento.estado_trabajo === "en_construccion" && !documento.cancelado_en && trabajo.estado === "en_construccion";
}

export function canFinalizeTrabajo(documento: DocumentoCorto, trabajo: Trabajo): boolean {
  return !documento.cancelado_en && trabajo.estado === "en_construccion";
}

export function createSubmissionGuard() {
  let inFlight = false;
  return { acquire() { if (inFlight) return false; inFlight = true; return true; }, release() { inFlight = false; } };
}

export function mapHojaError(error: unknown, operation: "create" | "edit" | "finalize" | "work"): { status: number; message: string; folioError?: string } {
  const err = error instanceof Error ? error as Error & { status?: unknown; code?: unknown } : null;
  const status = typeof err?.status === "number" ? err.status : 0;
  const code = typeof err?.code === "string" ? err.code : "";
  if (status === 409 && (code === "physical_folio_reserved" || code === "duplicate_record")) return { status, message: "Ese folio ya fue utilizado; los folios anteriores permanecen reservados.", folioError: "Este folio ya está registrado o reservado." };
  if (status === 400 || status === 422) return { status, message: err?.message ?? "Revisa los datos e inténtalo de nuevo." };
  if (status === 401) return { status, message: "La sesión venció. Inicia sesión nuevamente." };
  if (status === 403) return { status, message: operation === "work" ? "Tu cuenta no tiene permiso para esta operación de trabajos." : "Tu cuenta no tiene permiso para esta operación de hojas." };
  if (status === 404) return { status, message: "La hoja o el trabajo ya no existe. Actualiza la información." };
  if (status === 503 || status === 502 || status === 504 || status === 0) return { status, message: "No se pudo conectar con el backend. Verifica que esté disponible; no reenvíes hasta actualizar la información." };
  return { status, message: err?.message ?? "No se pudo completar la operación." };
}
