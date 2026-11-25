import type { AuthenticatedUser } from "../types/auth.js";

export function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  if (permission === "auditoria.consultar" && user.rol.codigo !== "ADMINISTRACION") {
    return false;
  }
  if (businessPermissionSet.has(permission) && !businessRoleCodes.has(user.rol.codigo)) {
    return false;
  }
  if (hojasTrabajosPermissionSet.has(permission) && !hojasTrabajosRoleCodes.has(user.rol.codigo)) {
    return false;
  }
  return user.permisos.includes(permission);
}

const businessRoleCodes = new Set(["ADMINISTRACION", "VENTAS", "LOGISTICA"]);
const businessPermissionSet = new Set([
  "clientes.consultar", "clientes.crear", "clientes.editar",
  "unidades.consultar", "unidades.crear", "unidades.editar",
]);
const hojasTrabajosRoleCodes = businessRoleCodes;
const hojasTrabajosPermissionSet = new Set([
  "documentos_cortos.consultar", "documentos_cortos.crear", "documentos_cortos.editar",
  "trabajos.consultar", "trabajos.crear", "trabajos.editar",
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
  documentosCortos: {
    consultar: "documentos_cortos.consultar",
    crear: "documentos_cortos.crear",
    editar: "documentos_cortos.editar",
  },
  trabajos: {
    consultar: "trabajos.consultar",
    crear: "trabajos.crear",
    editar: "trabajos.editar",
  },
} as const;
