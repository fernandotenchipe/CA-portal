import type { Cliente, CreateClientePayload, UpdateClientePayload } from "./api";

export interface ClienteDraft {
  nombre: string;
  razon_social: string;
  rfc: string;
  correo: string;
  telefono: string;
  activo: boolean;
}

export type ClienteFormField = keyof ClienteDraft;
export type ClienteFieldErrors = Partial<Record<ClienteFormField, string>>;

export function canCreateCliente(permisos: readonly string[]): boolean {
  return permisos.includes("clientes.crear");
}

export function canEditCliente(permisos: readonly string[]): boolean {
  return permisos.includes("clientes.editar");
}

export function clienteToDraft(cliente: Cliente): ClienteDraft {
  return {
    nombre: cliente.nombre,
    razon_social: cliente.razon_social ?? "",
    rfc: cliente.rfc ?? "",
    correo: cliente.correo ?? "",
    telefono: cliente.telefono ?? "",
    activo: cliente.activo,
  };
}

export function emptyClienteDraft(): ClienteDraft {
  return {
    nombre: "",
    razon_social: "",
    rfc: "",
    correo: "",
    telefono: "",
    activo: true,
  };
}

export function validateClienteDraft(draft: ClienteDraft): ClienteFieldErrors {
  const errors: ClienteFieldErrors = {};
  if (!draft.nombre.trim()) errors.nombre = "El nombre del cliente es obligatorio.";
  const correo = draft.correo.trim();
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    errors.correo = "Escribe un correo válido, por ejemplo nombre@empresa.com.";
  }
  return errors;
}

function optionalValue(value: string): string | null {
  return value.trim() || null;
}

export function toCreateClientePayload(draft: ClienteDraft): CreateClientePayload {
  return {
    nombre: draft.nombre.trim(),
    razon_social: optionalValue(draft.razon_social),
    rfc: optionalValue(draft.rfc),
    correo: optionalValue(draft.correo),
    telefono: optionalValue(draft.telefono),
    activo: draft.activo,
  };
}

export function toUpdateClientePayload(draft: ClienteDraft, original: Cliente): UpdateClientePayload {
  const originalDraft = clienteToDraft(original);
  const normalized = toCreateClientePayload(draft);
  const changes: UpdateClientePayload = {};
  if (draft.nombre !== originalDraft.nombre) changes.nombre = normalized.nombre;
  if (draft.razon_social !== originalDraft.razon_social) changes.razon_social = normalized.razon_social;
  if (draft.rfc !== originalDraft.rfc) changes.rfc = normalized.rfc;
  if (draft.correo !== originalDraft.correo) changes.correo = normalized.correo;
  if (draft.telefono !== originalDraft.telefono) changes.telefono = normalized.telefono;
  if (draft.activo !== originalDraft.activo) changes.activo = normalized.activo;
  return changes;
}

export function createSubmissionGuard() {
  let inFlight = false;
  return {
    acquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
  };
}

export async function createAndNotify(
  create: () => Promise<Cliente>,
  onCreated: (cliente: Cliente) => void,
): Promise<Cliente> {
  const cliente = await create();
  onCreated(cliente);
  return cliente;
}

export async function updateAndNotify(
  update: () => Promise<Cliente>,
  onUpdated: (cliente: Cliente) => void,
): Promise<Cliente> {
  const cliente = await update();
  onUpdated(cliente);
  return cliente;
}

export function cancelClienteForm(onCancel: () => void): void {
  onCancel();
}

export function mapClienteCreateError(error: unknown): {
  status: number;
  message: string;
  fieldErrors: ClienteFieldErrors;
} {
  const apiError = error instanceof Error ? error as Error & { status?: unknown; code?: unknown } : null;
  const status = typeof apiError?.status === "number" ? apiError.status : 0;
  const code = typeof apiError?.code === "string" ? apiError.code : "";
  const message = apiError?.message || "No se pudo registrar el cliente.";

  if (status === 409 && code === "duplicate_rfc") {
    return { status, message: "Ya existe un cliente con ese RFC.", fieldErrors: { rfc: "Este RFC ya está registrado." } };
  }
  if ((status === 400 || status === 422) && code === "invalid_email") {
    return { status, message: "Revisa el correo indicado.", fieldErrors: { correo: message } };
  }
  if ((status === 400 || status === 422) && code === "required_field" && message.startsWith("nombre")) {
    return { status, message: "El nombre del cliente es obligatorio.", fieldErrors: { nombre: message } };
  }
  return { status, message, fieldErrors: {} };
}
