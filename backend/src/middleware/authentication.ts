import type { AuthServiceContract, AuthenticationResult } from "../types/auth.js";

export function readBearerToken(authorization: string | string[] | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export async function authenticateBearer(
  authorization: string | string[] | undefined,
  authService: AuthServiceContract,
): Promise<AuthenticationResult | { status: "missing_token" }> {
  const token = readBearerToken(authorization);
  if (!token) return { status: "missing_token" };
  return authService.authenticate(token);
}
