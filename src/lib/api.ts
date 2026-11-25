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
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
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
    const messages: Record<number, string> = {
      401: "La sesión venció. Inicia sesión nuevamente.",
      403: options.forbiddenMessage ?? "No tienes permiso para consultar clientes.",
      502: "El backend no está disponible temporalmente. Inténtalo de nuevo.",
      503: "El backend no está disponible temporalmente. Inténtalo de nuevo.",
      504: "El backend tardó demasiado en responder. Inténtalo de nuevo.",
    };
    throw new ApiError(messages[response.status] ?? "No se pudo cargar la información de clientes.", response.status);
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
