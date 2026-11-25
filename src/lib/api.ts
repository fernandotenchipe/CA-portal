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
  options: { forbiddenMessage?: string } = {},
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
    404: "El cliente ya no existe o dejó de estar disponible.",
    409: serverMessage ?? "El registro entra en conflicto con información existente.",
    422: serverMessage ?? "Revisa los campos marcados e inténtalo de nuevo.",
    502: "El backend no está disponible temporalmente. Inténtalo de nuevo.",
    503: "El backend no está disponible temporalmente. Inténtalo de nuevo.",
    504: "El backend tardó demasiado en responder. Inténtalo de nuevo.",
  };
  return new ApiError(messages[response.status] ?? "No se pudo completar la operación.", response.status, code);
}

async function authenticatedGet<T>(
  path: string,
  accessToken: string,
  options: { forbiddenMessage?: string; signal?: AbortSignal } = {},
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
