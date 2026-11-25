export interface AuthProfile {
  id: string;
  nombre: string;
  rol: { codigo: string; nombre: string };
  permisos: string[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function authenticatedGet<T>(path: string, accessToken: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/backend-api${path}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ApiError("No se pudo conectar con el servicio de autenticación.", 0);
  }

  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "La sesión venció. Inicia sesión nuevamente.",
      403: "Tu cuenta no tiene un perfil activo en el portal.",
      503: "El servicio de autenticación no está disponible temporalmente.",
    };
    throw new ApiError(messages[response.status] ?? "No se pudo validar el acceso al portal.", response.status);
  }

  return response.json() as Promise<T>;
}

export async function verifyAccessToken(accessToken: string): Promise<AuthProfile> {
  const [check, profile] = await Promise.all([
    authenticatedGet<{ authenticated: boolean; active: boolean }>("/auth/check", accessToken),
    authenticatedGet<AuthProfile>("/auth/me", accessToken),
  ]);
  if (!check.authenticated || !check.active) throw new ApiError("La sesión no está activa.", 403);
  return profile;
}
