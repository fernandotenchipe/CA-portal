import { HttpError } from "../errors.js";
import type { DocumentoListFilters } from "../types/business.js";

export interface ClienteCreateInput {
  nombre: string;
  razon_social?: string | null;
  rfc?: string | null;
  correo?: string | null;
  telefono?: string | null;
  activo?: boolean;
}

export type ClienteUpdateInput = Partial<ClienteCreateInput>;

export interface UnidadCreateInput {
  cliente_id: string;
  numero_serie: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  placas?: string | null;
  activo?: boolean;
}

export type UnidadUpdateInput = Omit<Partial<UnidadCreateInput>, "cliente_id">;

export interface ListQuery {
  q: string | null;
  limit: number;
  offset: number;
  activo: boolean | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const serieCapturePattern = /^[A-Za-z0-9]+$/;
const seriePattern = /^[A-Z0-9]+$/;

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "El cuerpo debe ser un objeto JSON.", "invalid_body");
  }
  return value as Record<string, unknown>;
}

function allowKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `Campo no permitido: ${unknown[0]}.`, "unknown_field");
  }
}

function requiredText(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(422, `${key} es obligatorio.`, "required_field");
  }
  return value.trim();
}

function optionalText(value: unknown, key: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(422, `${key} debe ser texto o null.`, "invalid_field");
  }
  return value.trim() || null;
}

function optionalBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(422, `${key} debe ser booleano.`, "invalid_field");
  }
  return value;
}

function optionalYear(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1886 || (value as number) > 2200) {
    throw new HttpError(422, "anio debe ser un entero entre 1886 y 2200, o null.", "invalid_year");
  }
  return value as number;
}

function parseEmail(value: unknown): string | null {
  const email = optionalText(value, "correo");
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, "correo no tiene un formato válido.", "invalid_email");
  }
  return email;
}

export function validateClienteCreate(value: unknown): ClienteCreateInput {
  const input = objectValue(value);
  allowKeys(input, ["nombre", "razon_social", "rfc", "correo", "telefono", "activo"]);
  if (!Object.hasOwn(input, "nombre")) {
    throw new HttpError(422, "nombre es obligatorio.", "required_field");
  }

  const result: ClienteCreateInput = { nombre: requiredText(input.nombre, "nombre") };
  if (Object.hasOwn(input, "razon_social")) result.razon_social = optionalText(input.razon_social, "razon_social");
  if (Object.hasOwn(input, "rfc")) result.rfc = optionalText(input.rfc, "rfc");
  if (Object.hasOwn(input, "correo")) result.correo = parseEmail(input.correo);
  if (Object.hasOwn(input, "telefono")) result.telefono = optionalText(input.telefono, "telefono");
  if (Object.hasOwn(input, "activo")) result.activo = optionalBoolean(input.activo, "activo");
  return result;
}

export function validateClienteUpdate(value: unknown): ClienteUpdateInput {
  const input = objectValue(value);
  allowKeys(input, ["nombre", "razon_social", "rfc", "correo", "telefono", "activo"]);
  if (Object.keys(input).length === 0) {
    throw new HttpError(400, "Envía al menos un campo para actualizar.", "empty_update");
  }

  const result: ClienteUpdateInput = {};
  if (Object.hasOwn(input, "nombre")) result.nombre = requiredText(input.nombre, "nombre");
  if (Object.hasOwn(input, "razon_social")) result.razon_social = optionalText(input.razon_social, "razon_social");
  if (Object.hasOwn(input, "rfc")) result.rfc = optionalText(input.rfc, "rfc");
  if (Object.hasOwn(input, "correo")) result.correo = parseEmail(input.correo);
  if (Object.hasOwn(input, "telefono")) result.telefono = optionalText(input.telefono, "telefono");
  if (Object.hasOwn(input, "activo")) result.activo = optionalBoolean(input.activo, "activo");
  return result;
}

export function validateUuid(value: string, field = "id"): string {
  if (!uuidPattern.test(value)) {
    throw new HttpError(400, `${field} no es un UUID válido.`, "invalid_id");
  }
  return value.toLowerCase();
}

export function normalizeNumeroSerie(value: unknown, field = "numero_serie"): string {
  if (typeof value !== "string" || !serieCapturePattern.test(value)) {
    throw new HttpError(422, `${field} solo permite letras A-Z y números 0-9, sin espacios ni guiones.`, "invalid_serial");
  }
  const normalized = value.toUpperCase();
  if (!seriePattern.test(normalized)) {
    throw new HttpError(422, `${field} solo permite letras A-Z y números 0-9.`, "invalid_serial");
  }
  return normalized;
}

function normalizeSerialPair(serialValue: unknown, confirmationValue: unknown): string {
  const serial = normalizeNumeroSerie(serialValue, "numero_serie");
  const confirmation = normalizeNumeroSerie(confirmationValue, "numero_serie_confirmacion");
  if (serial !== confirmation) {
    throw new HttpError(422, "La confirmación del número de serie no coincide.", "serial_confirmation_mismatch");
  }
  return serial;
}

const unitFields = ["cliente_id", "numero_serie", "numero_serie_confirmacion", "marca", "modelo", "anio", "placas", "activo"];

export function validateUnidadCreate(value: unknown): UnidadCreateInput {
  const input = objectValue(value);
  allowKeys(input, unitFields);
  for (const key of ["cliente_id", "numero_serie", "numero_serie_confirmacion"]) {
    if (!Object.hasOwn(input, key)) throw new HttpError(422, `${key} es obligatorio.`, "required_field");
  }

  const result: UnidadCreateInput = {
    cliente_id: validateUuid(String(input.cliente_id), "cliente_id"),
    numero_serie: normalizeSerialPair(input.numero_serie, input.numero_serie_confirmacion),
  };
  if (Object.hasOwn(input, "marca")) result.marca = optionalText(input.marca, "marca");
  if (Object.hasOwn(input, "modelo")) result.modelo = optionalText(input.modelo, "modelo");
  if (Object.hasOwn(input, "anio")) result.anio = optionalYear(input.anio);
  if (Object.hasOwn(input, "placas")) result.placas = optionalText(input.placas, "placas");
  if (Object.hasOwn(input, "activo")) result.activo = optionalBoolean(input.activo, "activo");
  return result;
}

export function validateUnidadUpdate(value: unknown): UnidadUpdateInput {
  const input = objectValue(value);
  allowKeys(input, ["numero_serie", "numero_serie_confirmacion", "marca", "modelo", "anio", "placas", "activo"]);
  if (Object.keys(input).length === 0) {
    throw new HttpError(400, "Envía al menos un campo para actualizar.", "empty_update");
  }
  const hasSerial = Object.hasOwn(input, "numero_serie");
  const hasConfirmation = Object.hasOwn(input, "numero_serie_confirmacion");
  if (hasSerial !== hasConfirmation) {
    throw new HttpError(422, "Para cambiar el número de serie debes enviar ambas capturas.", "serial_confirmation_required");
  }

  const result: UnidadUpdateInput = {};
  if (hasSerial) result.numero_serie = normalizeSerialPair(input.numero_serie, input.numero_serie_confirmacion);
  if (Object.hasOwn(input, "marca")) result.marca = optionalText(input.marca, "marca");
  if (Object.hasOwn(input, "modelo")) result.modelo = optionalText(input.modelo, "modelo");
  if (Object.hasOwn(input, "anio")) result.anio = optionalYear(input.anio);
  if (Object.hasOwn(input, "placas")) result.placas = optionalText(input.placas, "placas");
  if (Object.hasOwn(input, "activo")) result.activo = optionalBoolean(input.activo, "activo");
  return result;
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "limit debe ser un entero entre 1 y 100.", "invalid_limit");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new HttpError(400, "offset debe ser un entero mayor o igual a 0.", "invalid_offset");
  }

  const query = params.get("q")?.trim() || null;
  if (query && query.length > 200) {
    throw new HttpError(400, "q no puede exceder 200 caracteres.", "query_too_long");
  }
  const rawActive = params.get("activo");
  if (rawActive !== null && rawActive !== "true" && rawActive !== "false") {
    throw new HttpError(400, "activo debe ser true o false.", "invalid_active_filter");
  }
  return { q: query, limit, offset, activo: rawActive === null ? null : rawActive === "true" };
}

export interface DocumentoCreateInput {
  folio_fisico: string;
  unidad_id: string;
  cliente_id?: string;
  observaciones?: string | null;
  fecha_documento?: string | null;
}

export interface DocumentoUpdateInput {
  folio_fisico?: string;
  unidad_id?: string;
  cliente_id?: string;
  observaciones?: string | null;
  fecha_documento?: string | null;
}

export interface TrabajoCreateInput {
  descripcion: string;
  cantidad?: number | null;
  unidad_medida?: string | null;
  precio_unitario?: number | null;
  observaciones?: string | null;
}

export interface TrabajoUpdateInput {
  descripcion?: string;
  cantidad?: number | null;
  unidad_medida?: string | null;
  precio_unitario?: number | null;
  observaciones?: string | null;
}

const productionStates = ["en_construccion", "finalizado"] as const;

export function normalizeFolioFisico(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(422, "folio_fisico es obligatorio.", "required_field");
  const captured = value.trim().toUpperCase();
  const normalized = captured.replace(/\s+/gu, "");
  if (!normalized) throw new HttpError(422, "folio_fisico no puede estar vacío.", "required_field");
  if (!/^[A-Z0-9-]+$/.test(normalized)) {
    throw new HttpError(422, "folio_fisico solo permite letras A-Z, números 0-9 y guiones.", "invalid_physical_folio");
  }
  return captured;
}

export function normalizeFolioForSearch(value: unknown): string {
  return normalizeFolioFisico(value).replace(/\s+/gu, "");
}

function optionalDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(422, "fecha_documento debe usar el formato YYYY-MM-DD o null.", "invalid_date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(422, "fecha_documento no es una fecha válida.", "invalid_date");
  }
  return value;
}

function optionalPositiveNumber(value: unknown, field: string, allowZero: boolean): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new HttpError(422, `${field} debe ser ${allowZero ? "mayor o igual a cero" : "mayor que cero"}, o null.`, "invalid_number");
  }
  const maxValue = field === "cantidad" ? 999_999_999.999 : 999_999_999_999.99;
  if (value > maxValue) throw new HttpError(422, `${field} excede el rango permitido por el esquema.`, "numeric_out_of_range");
  const scale = field === "cantidad" ? 3 : 2;
  if (Number(value.toFixed(scale)) !== value) {
    throw new HttpError(422, `${field} admite hasta ${scale} decimales.`, "invalid_number_scale");
  }
  return value;
}

export function validateDocumentoCreate(value: unknown): DocumentoCreateInput {
  const input = objectValue(value);
  allowKeys(input, ["folio_fisico", "unidad_id", "cliente_id", "observaciones", "fecha_documento"]);
  if (!Object.hasOwn(input, "folio_fisico") || !Object.hasOwn(input, "unidad_id")) {
    throw new HttpError(422, "folio_fisico y unidad_id son obligatorios.", "required_field");
  }
  const result: DocumentoCreateInput = {
    folio_fisico: normalizeFolioFisico(input.folio_fisico),
    unidad_id: validateUuid(String(input.unidad_id), "unidad_id"),
  };
  if (Object.hasOwn(input, "cliente_id")) result.cliente_id = validateUuid(String(input.cliente_id), "cliente_id");
  if (Object.hasOwn(input, "observaciones")) result.observaciones = optionalText(input.observaciones, "observaciones");
  if (Object.hasOwn(input, "fecha_documento")) result.fecha_documento = optionalDate(input.fecha_documento);
  return result;
}

export function validateDocumentoUpdate(value: unknown): DocumentoUpdateInput {
  const input = objectValue(value);
  allowKeys(input, ["folio_fisico", "unidad_id", "cliente_id", "observaciones", "fecha_documento"]);
  if (Object.keys(input).length === 0) throw new HttpError(400, "Envía al menos un campo para actualizar.", "empty_update");
  const result: DocumentoUpdateInput = {};
  if (Object.hasOwn(input, "folio_fisico")) result.folio_fisico = normalizeFolioFisico(input.folio_fisico);
  if (Object.hasOwn(input, "unidad_id")) result.unidad_id = validateUuid(String(input.unidad_id), "unidad_id");
  if (Object.hasOwn(input, "cliente_id")) result.cliente_id = validateUuid(String(input.cliente_id), "cliente_id");
  if (Object.hasOwn(input, "observaciones")) result.observaciones = optionalText(input.observaciones, "observaciones");
  if (Object.hasOwn(input, "fecha_documento")) result.fecha_documento = optionalDate(input.fecha_documento);
  return result;
}

export function parseDocumentoListQuery(params: URLSearchParams): DocumentoListFilters {
  const base = parseListQuery(params);
  if (params.has("activo")) throw new HttpError(400, "activo no es un filtro válido para hojas cortas.", "invalid_active_filter");
  const folioRaw = params.get("folio_fisico");
  const rawState = params.get("estado_trabajo");
  if (rawState !== null && !productionStates.includes(rawState as (typeof productionStates)[number])) {
    throw new HttpError(400, "estado_trabajo debe ser en_construccion o finalizado.", "invalid_work_state");
  }
  const rawCanceled = params.get("cancelada");
  if (rawCanceled !== null && rawCanceled !== "true" && rawCanceled !== "false") {
    throw new HttpError(400, "cancelada debe ser true o false.", "invalid_canceled_filter");
  }
  return {
    q: base.q,
    limit: base.limit,
    offset: base.offset,
    folio_fisico: folioRaw === null ? null : normalizeFolioForSearch(folioRaw),
    cliente_id: params.has("cliente_id") ? validateUuid(params.get("cliente_id") ?? "", "cliente_id") : null,
    unidad_id: params.has("unidad_id") ? validateUuid(params.get("unidad_id") ?? "", "unidad_id") : null,
    estado_trabajo: rawState as DocumentoListFilters["estado_trabajo"] ?? null,
    cancelada: rawCanceled === null ? null : rawCanceled === "true",
  };
}

export function validateTrabajoCreate(value: unknown): TrabajoCreateInput {
  const input = objectValue(value);
  allowKeys(input, ["descripcion", "cantidad", "unidad_medida", "precio_unitario", "observaciones"]);
  if (!Object.hasOwn(input, "descripcion")) throw new HttpError(422, "descripcion es obligatoria.", "required_field");
  const result: TrabajoCreateInput = { descripcion: requiredText(input.descripcion, "descripcion") };
  if (Object.hasOwn(input, "cantidad")) result.cantidad = optionalPositiveNumber(input.cantidad, "cantidad", false);
  if (Object.hasOwn(input, "unidad_medida")) result.unidad_medida = optionalText(input.unidad_medida, "unidad_medida");
  if (Object.hasOwn(input, "precio_unitario")) result.precio_unitario = optionalPositiveNumber(input.precio_unitario, "precio_unitario", true);
  if (Object.hasOwn(input, "observaciones")) result.observaciones = optionalText(input.observaciones, "observaciones");
  return result;
}

export function validateTrabajoUpdate(value: unknown): TrabajoUpdateInput {
  const input = objectValue(value);
  allowKeys(input, ["descripcion", "cantidad", "unidad_medida", "precio_unitario", "observaciones"]);
  if (Object.keys(input).length === 0) throw new HttpError(400, "Envía al menos un campo para actualizar.", "empty_update");
  const result: TrabajoUpdateInput = {};
  if (Object.hasOwn(input, "descripcion")) result.descripcion = requiredText(input.descripcion, "descripcion");
  if (Object.hasOwn(input, "cantidad")) result.cantidad = optionalPositiveNumber(input.cantidad, "cantidad", false);
  if (Object.hasOwn(input, "unidad_medida")) result.unidad_medida = optionalText(input.unidad_medida, "unidad_medida");
  if (Object.hasOwn(input, "precio_unitario")) result.precio_unitario = optionalPositiveNumber(input.precio_unitario, "precio_unitario", true);
  if (Object.hasOwn(input, "observaciones")) result.observaciones = optionalText(input.observaciones, "observaciones");
  return result;
}
