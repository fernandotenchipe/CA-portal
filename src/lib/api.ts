export interface AuthProfile {
  id: string;
  nombre: string;
  rol: { codigo: string; nombre: string };
  permisos: string[];
}

export interface Cliente {
  id: string;
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  correo: string | null;
  telefono: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

export interface Unidad {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  numero_serie: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  placas: string | null;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

export type EstadoTrabajo = "en_construccion" | "finalizado";

export interface DocumentoCorto {
  id: string;
  folio_fisico: string;
  folio_fisico_normalizado: string;
  unidad_id: string;
  cliente_id: string;
  cliente_nombre: string;
  numero_serie: string;
  estado_trabajo: EstadoTrabajo;
  finalizado_en: string | null;
  observaciones: string | null;
  fecha_documento: string | null;
  creado_en: string;
  actualizado_en: string;
  cancelado_en: string | null;
}

export interface Trabajo {
  id: string;
  documento_corto_id: string;
  numero_orden: number;
  descripcion: string;
  estado: EstadoTrabajo;
  finalizado_en: string | null;
  cantidad: string | null;
  unidad_medida: string | null;
  precio_unitario: string | null;
  importe: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface ApiPage<T> {
  data: T[];
  limit: number;
  offset: number;
  total: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function responseError(
  response: Response,
  options: { forbiddenMessage?: string; notFoundMessage?: string } = {},
): Promise<ApiError> {
  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    // A proxy error may not include a JSON body.
  }

  const errorBody = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as { error?: unknown; code?: unknown }
    : {};
  const code = typeof errorBody.code === "string" ? errorBody.code : undefined;
  const serverMessage = typeof errorBody.error === "string" ? errorBody.error : undefined;
  const messages: Record<number, string> = {
    400: serverMessage ?? "Revisa la información e inténtalo de nuevo.",
    401: "La sesión venció. Inicia sesión nuevamente.",
    403: options.forbiddenMessage ?? "No tienes permiso para realizar esta operación.",
    404: options.notFoundMessage ?? "El cliente ya no existe o dejó de estar disponible.",
    409: serverMessage ?? "El registro entra en conflicto con información existente.",
    422: serverMessage ?? "Revisa los campos marcados e inténtalo de nuevo.",
    502: "El backend no está disponible temporalmente. Inténtalo de nuevo.",
    503: "El backend no está disponible temporalmente. Inténtalo de nuevo.",
    504: "El backend tardó demasiado en responder. Inténtalo de nuevo.",
  };
  return new ApiError(messages[response.status] ?? "No se pudo completar la operación.", response.status, code);
}

export function getUnidades({
  accessToken,
  query,
  clienteId,
  limit,
  offset,
  signal,
}: {
  accessToken: string;
  query: string;
  clienteId: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<ApiPage<Unidad>> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query) params.set("q", query);
  if (clienteId) params.set("cliente_id", clienteId);
  return authenticatedGet<ApiPage<Unidad>>(`/unidades?${params.toString()}`, accessToken, {
    signal,
    forbiddenMessage: "Tu cuenta no tiene permiso para consultar unidades.",
    notFoundMessage: "No se encontró el directorio solicitado.",
  });
}

export interface CreateUnidadPayload {
  cliente_id: string;
  numero_serie: string;
  numero_serie_confirmacion: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  placas: string | null;
  activo: boolean;
}

export type UpdateUnidadPayload = Partial<Omit<CreateUnidadPayload, "cliente_id">>;

async function writeUnidad<T extends Unidad>({
  path,
  method,
  accessToken,
  payload,
  signal,
}: {
  path: string;
  method: "POST" | "PATCH";
  accessToken: string;
  payload: CreateUnidadPayload | UpdateUnidadPayload;
  signal?: AbortSignal;
}): Promise<Unidad> {
  let response: Response;
  try {
    response = await fetch(`/backend-api${path}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new ApiError("No se pudo conectar con el backend. No fue posible confirmar los cambios; vuelve a cargar la unidad antes de reintentar.", 0);
  }

  if (!response.ok) {
    throw await responseError(response, {
      forbiddenMessage: method === "POST"
        ? "Tu cuenta no tiene permiso para registrar unidades."
        : "Tu cuenta no tiene permiso para editar unidades.",
      notFoundMessage: "La unidad o el cliente ya no existe o dejó de estar disponible.",
    });
  }

  try {
    const result = await response.json() as { data?: T };
    if (!result.data?.id) throw new Error("Missing unit");
    return result.data;
  } catch {
    throw new ApiError("El backend respondió, pero no se pudieron confirmar los cambios de la unidad.", response.status);
  }
}

export function createUnidad({
  accessToken,
  payload,
  signal,
}: {
  accessToken: string;
  payload: CreateUnidadPayload;
  signal?: AbortSignal;
}): Promise<Unidad> {
  return writeUnidad({ path: "/unidades", method: "POST", accessToken, payload, signal });
}

export function updateUnidad({
  accessToken,
  unidadId,
  payload,
  signal,
}: {
  accessToken: string;
  unidadId: string;
  payload: UpdateUnidadPayload;
  signal?: AbortSignal;
}): Promise<Unidad> {
  return writeUnidad({ path: `/unidades/${encodeURIComponent(unidadId)}`, method: "PATCH", accessToken, payload, signal });
}

async function authenticatedGet<T>(
  path: string,
  accessToken: string,
  options: { forbiddenMessage?: string; notFoundMessage?: string; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/backend-api${path}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: options.signal,
    });
  } catch {
    throw new ApiError("No se pudo conectar con el backend. Verifica que el servicio esté disponible e inténtalo de nuevo.", 0);
  }

  if (!response.ok) {
    throw await responseError(response, options);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ApiError("El backend devolvió una respuesta que no se pudo leer.", response.status);
  }
}

export async function verifyAccessToken(accessToken: string): Promise<AuthProfile> {
  const [check, profile] = await Promise.all([
    authenticatedGet<{ authenticated: boolean; active: boolean }>("/auth/check", accessToken, {
      forbiddenMessage: "Tu cuenta no tiene un perfil activo en el portal.",
    }),
    authenticatedGet<AuthProfile>("/auth/me", accessToken, {
      forbiddenMessage: "Tu cuenta no tiene un perfil activo en el portal.",
    }),
  ]);
  if (!check.authenticated || !check.active) throw new ApiError("La sesión no está activa.", 403);
  return profile;
}

export function getClientes({
  accessToken,
  query,
  limit,
  offset,
  signal,
}: {
  accessToken: string;
  query: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<ApiPage<Cliente>> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query) params.set("q", query);
  return authenticatedGet<ApiPage<Cliente>>(`/clientes?${params.toString()}`, accessToken, { signal });
}

export async function getAllClientes({ accessToken, signal }: { accessToken: string; signal?: AbortSignal }): Promise<Cliente[]> {
  const first = await getClientes({ accessToken, query: "", limit: 100, offset: 0, signal });
  const rows = [...first.data];
  while (rows.length < first.total) {
    const next = await getClientes({ accessToken, query: "", limit: 100, offset: rows.length, signal });
    if (!next.data.length) break;
    rows.push(...next.data);
  }
  return rows;
}

export async function getAllUnidadesForCliente({ accessToken, clienteId, signal }: { accessToken: string; clienteId: string; signal?: AbortSignal }): Promise<Unidad[]> {
  const first = await getUnidades({ accessToken, query: "", clienteId, limit: 100, offset: 0, signal });
  const rows = [...first.data];
  while (rows.length < first.total) {
    const next = await getUnidades({ accessToken, query: "", clienteId, limit: 100, offset: rows.length, signal });
    if (!next.data.length) break;
    rows.push(...next.data);
  }
  return rows;
}

export interface CreateClientePayload {
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  correo: string | null;
  telefono: string | null;
  activo: boolean;
}

export type UpdateClientePayload = Partial<CreateClientePayload>;

export async function createCliente({
  accessToken,
  payload,
  signal,
}: {
  accessToken: string;
  payload: CreateClientePayload;
  signal?: AbortSignal;
}): Promise<Cliente> {
  let response: Response;
  try {
    response = await fetch("/backend-api/clientes", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el backend. No fue posible confirmar el registro; revisa el directorio antes de volver a enviarlo.",
      0,
    );
  }

  if (!response.ok) {
    throw await responseError(response, {
      forbiddenMessage: "Tu cuenta no tiene permiso para registrar clientes.",
    });
  }

  try {
    const result = await response.json() as { data?: Cliente };
    if (!result.data?.id) throw new Error("Missing created client");
    return result.data;
  } catch {
    throw new ApiError("El backend respondió, pero no se pudo confirmar el cliente registrado.", response.status);
  }
}

export async function updateCliente({
  accessToken,
  clienteId,
  payload,
  signal,
}: {
  accessToken: string;
  clienteId: string;
  payload: UpdateClientePayload;
  signal?: AbortSignal;
}): Promise<Cliente> {
  let response: Response;
  try {
    response = await fetch(`/backend-api/clientes/${encodeURIComponent(clienteId)}`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el backend. No fue posible confirmar los cambios; vuelve a cargar el cliente antes de reintentar.",
      0,
    );
  }

  if (!response.ok) {
    throw await responseError(response, {
      forbiddenMessage: "Tu cuenta no tiene permiso para editar clientes.",
    });
  }

  try {
    const result = await response.json() as { data?: Cliente };
    if (!result.data?.id) throw new Error("Missing updated client");
    return result.data;
  } catch {
    throw new ApiError("El backend respondió, pero no se pudieron confirmar los cambios.", response.status);
  }
}

export interface DocumentoFilters {
  q?: string;
  folioFisico?: string;
  clienteId?: string;
  unidadId?: string;
  estado?: EstadoTrabajo | "";
  cancelada?: boolean | "";
  limit: number;
  offset: number;
  signal?: AbortSignal;
}

export interface CreateDocumentoPayload {
  folio_fisico: string;
  unidad_id: string;
  cliente_id: string;
  observaciones: string | null;
  fecha_documento: string | null;
}

export type UpdateDocumentoPayload = Partial<Omit<CreateDocumentoPayload, "cliente_id">> & { cliente_id?: string };

export interface TrabajoPayload {
  descripcion: string;
  cantidad: number | null;
  unidad_medida: string | null;
  precio_unitario: number | null;
  observaciones: string | null;
}

export function getDocumentosCortos({ accessToken, ...filters }: { accessToken: string } & DocumentoFilters): Promise<ApiPage<DocumentoCorto>> {
  const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
  if (filters.q) params.set("q", filters.q);
  if (filters.folioFisico) params.set("folio_fisico", filters.folioFisico);
  if (filters.clienteId) params.set("cliente_id", filters.clienteId);
  if (filters.unidadId) params.set("unidad_id", filters.unidadId);
  if (filters.estado) params.set("estado_trabajo", filters.estado);
  if (filters.cancelada !== undefined && filters.cancelada !== "") params.set("cancelada", String(filters.cancelada));
  return authenticatedGet<ApiPage<DocumentoCorto>>(`/documentos-cortos?${params}`, accessToken, {
    signal: filters.signal,
    forbiddenMessage: "Tu cuenta no tiene permiso para consultar hojas de trabajo.",
    notFoundMessage: "No se encontró el listado de hojas de trabajo.",
  });
}

export async function getDocumentoCorto({ accessToken, documentoId, signal }: { accessToken: string; documentoId: string; signal?: AbortSignal }): Promise<DocumentoCorto> {
  const result = await authenticatedGet<{ data?: DocumentoCorto }>(`/documentos-cortos/${encodeURIComponent(documentoId)}`, accessToken, {
    signal, forbiddenMessage: "Tu cuenta no tiene permiso para consultar hojas de trabajo.", notFoundMessage: "La hoja ya no existe o dejó de estar disponible.",
  });
  if (!result.data?.id) throw new ApiError("El backend devolvió una hoja que no se pudo leer.", 502);
  return result.data;
}

async function writePortal<T>({ path, method, accessToken, payload, permission, signal }: {
  path: string; method: "POST" | "PATCH"; accessToken: string; payload?: unknown; permission: string; signal?: AbortSignal;
}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/backend-api${path}`, {
      method, cache: "no-store", headers: { Authorization: `Bearer ${accessToken}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal,
    });
  } catch {
    throw new ApiError("No se pudo conectar con el backend. No fue posible confirmar los cambios; vuelve a cargar la información antes de reintentar.", 0);
  }
  if (!response.ok) throw await responseError(response, { forbiddenMessage: `Tu cuenta no tiene permiso para ${permission}.`, notFoundMessage: "La hoja o el trabajo ya no existe o dejó de estar disponible." });
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new ApiError("El backend respondió, pero no se pudo leer el resultado.", response.status); }
}

export async function createDocumentoCorto({ accessToken, payload }: { accessToken: string; payload: CreateDocumentoPayload }): Promise<DocumentoCorto> {
  const result = await writePortal<{ data?: DocumentoCorto }>({ path: "/documentos-cortos", method: "POST", accessToken, payload, permission: "registrar hojas" });
  if (!result.data?.id) throw new ApiError("No se pudo confirmar el registro de la hoja.", 502);
  return result.data;
}

export async function updateDocumentoCorto({ accessToken, documentoId, payload }: { accessToken: string; documentoId: string; payload: UpdateDocumentoPayload }): Promise<DocumentoCorto> {
  const result = await writePortal<{ data?: DocumentoCorto }>({ path: `/documentos-cortos/${encodeURIComponent(documentoId)}`, method: "PATCH", accessToken, payload, permission: "editar hojas" });
  if (!result.data?.id) throw new ApiError("No se pudo confirmar la actualización de la hoja.", 502);
  return result.data;
}

export async function finalizeDocumentoCorto({ accessToken, documentoId }: { accessToken: string; documentoId: string }): Promise<DocumentoCorto> {
  const result = await writePortal<{ data?: DocumentoCorto }>({ path: `/documentos-cortos/${encodeURIComponent(documentoId)}/finalizar`, method: "POST", accessToken, permission: "finalizar hojas" });
  if (!result.data?.id) throw new ApiError("No se pudo confirmar la finalización de la hoja.", 502);
  return result.data;
}

export async function getTrabajos({ accessToken, documentoId, signal }: { accessToken: string; documentoId: string; signal?: AbortSignal }): Promise<Trabajo[]> {
  const result = await authenticatedGet<{ data?: Trabajo[] }>(`/documentos-cortos/${encodeURIComponent(documentoId)}/trabajos`, accessToken, {
    signal, forbiddenMessage: "Tu cuenta no tiene permiso para consultar los trabajos.", notFoundMessage: "La hoja ya no existe o dejó de estar disponible.",
  });
  if (!Array.isArray(result.data)) throw new ApiError("El backend devolvió una lista de trabajos que no se pudo leer.", 502);
  return result.data;
}

export async function createTrabajo({ accessToken, documentoId, payload }: { accessToken: string; documentoId: string; payload: TrabajoPayload }): Promise<Trabajo> {
  const result = await writePortal<{ data?: Trabajo }>({ path: `/documentos-cortos/${encodeURIComponent(documentoId)}/trabajos`, method: "POST", accessToken, payload, permission: "agregar trabajos" });
  if (!result.data?.id) throw new ApiError("No se pudo confirmar el trabajo agregado.", 502);
  return result.data;
}

export async function updateTrabajo({ accessToken, trabajoId, payload }: { accessToken: string; trabajoId: string; payload: Partial<TrabajoPayload> }): Promise<Trabajo> {
  const result = await writePortal<{ data?: Trabajo }>({ path: `/trabajos/${encodeURIComponent(trabajoId)}`, method: "PATCH", accessToken, payload, permission: "editar trabajos" });
  if (!result.data?.id) throw new ApiError("No se pudo confirmar la actualización del trabajo.", 502);
  return result.data;
}

export async function finalizeTrabajo({ accessToken, trabajoId }: { accessToken: string; trabajoId: string }): Promise<Trabajo> {
  const result = await writePortal<{ data?: Trabajo }>({ path: `/trabajos/${encodeURIComponent(trabajoId)}/finalizar`, method: "POST", accessToken, permission: "finalizar trabajos" });
  if (!result.data?.id) throw new ApiError("No se pudo confirmar la finalización del trabajo.", 502);
  return result.data;
}
