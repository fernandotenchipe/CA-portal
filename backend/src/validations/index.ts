import { HttpError } from "../errors.js";

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
