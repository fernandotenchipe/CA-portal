import type { AuthenticatedUser } from "../types/auth.js";

export function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  if (permission === "auditoria.consultar" && user.rol.codigo !== "ADMINISTRACION") {
    return false;
  }
  if (businessPermissionSet.has(permission) && !businessRoleCodes.has(user.rol.codigo)) {
    return false;
  }
  return user.permisos.includes(permission);
}

const businessRoleCodes = new Set(["ADMINISTRACION", "VENTAS", "LOGISTICA"]);
const businessPermissionSet = new Set([
  "clientes.consultar", "clientes.crear", "clientes.editar",
  "unidades.consultar", "unidades.crear", "unidades.editar",
]);

export const businessPermissions = {
  clientes: {
    consultar: "clientes.consultar",
    crear: "clientes.crear",
    editar: "clientes.editar",
  },
  unidades: {
    consultar: "unidades.consultar",
    crear: "unidades.crear",
    editar: "unidades.editar",
  },
} as const;
