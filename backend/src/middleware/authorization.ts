import type { AuthenticatedUser } from "../types/auth.js";

export function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  if (permission === "auditoria.consultar" && user.rol.codigo !== "ADMINISTRACION") {
    return false;
  }
  return user.permisos.includes(permission);
}
