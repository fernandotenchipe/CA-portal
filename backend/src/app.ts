import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpError, publicDatabaseError } from "./errors.js";
import { authenticateBearer } from "./middleware/authentication.js";
import { businessPermissions, hasPermission } from "./middleware/authorization.js";
import { AuthService } from "./services/auth-service.js";
import { ClientesModule } from "./modules/clientes/index.js";
import { UnidadesModule } from "./modules/unidades/index.js";
import { DocumentosModule } from "./modules/documentos/index.js";
import { TrabajosModule } from "./modules/documentos/trabajos.js";
import type { AuthServiceContract, AuthenticatedUser } from "./types/auth.js";
import type { ClienteModuleContract, DocumentoModuleContract, TrabajoModuleContract, UnidadModuleContract } from "./types/business.js";
import { normalizeNumeroSerie, parseDocumentoListQuery, parseListQuery, validateUuid } from "./validations/index.js";

const maxBodyBytes = 32 * 1024;

interface AppDependencies {
  clientes?: ClienteModuleContract;
  unidades?: UnidadModuleContract;
  documentos?: DocumentoModuleContract;
  trabajos?: TrabajoModuleContract;
}

type BusinessRoute =
  | { resource: "clientes"; action: "list" | "get" | "create" | "update"; id?: string; permission: string }
  | { resource: "unidades"; action: "list" | "get" | "create" | "update"; id?: string; clientId?: string; permission: string }
  | { resource: "documentos_cortos"; action: "list" | "get" | "create" | "update" | "finalize"; id?: string; permission: string }
  | { resource: "trabajos"; action: "list" | "create" | "update" | "finalize"; id?: string; documentId?: string; permission: string };

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Authorization",
  });
  response.end(JSON.stringify(body));
}

function requestSegments(path: string): string[] {
  try {
    return path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "La ruta contiene codificación inválida.", "invalid_path");
  }
}

function resolveBusinessRoute(segments: string[], method: string): BusinessRoute | null {
  if (segments[0] !== "api") return null;
  const verb = method.toUpperCase();
  const [resource, id, nested] = segments.slice(1);

  if (resource === "clientes") {
    if (segments.length === 2 && verb === "GET") return { resource, action: "list", permission: businessPermissions.clientes.consultar };
    if (segments.length === 2 && verb === "POST") return { resource, action: "create", permission: businessPermissions.clientes.crear };
    if (segments.length === 3 && verb === "GET") return { resource, action: "get", id, permission: businessPermissions.clientes.consultar };
    if (segments.length === 3 && verb === "PATCH") return { resource, action: "update", id, permission: businessPermissions.clientes.editar };
    if (segments.length === 4 && nested === "unidades" && verb === "GET") {
      return { resource: "unidades", action: "list", clientId: id, permission: businessPermissions.unidades.consultar };
    }
    if (segments.length === 2 || segments.length === 3 || (segments.length === 4 && nested === "unidades")) {
      throw new HttpError(405, "Método no permitido.", "method_not_allowed");
    }
  }

  if (resource === "unidades") {
    if (segments.length === 2 && verb === "GET") return { resource, action: "list", permission: businessPermissions.unidades.consultar };
    if (segments.length === 2 && verb === "POST") return { resource, action: "create", permission: businessPermissions.unidades.crear };
    if (segments.length === 3 && verb === "GET") return { resource, action: "get", id, permission: businessPermissions.unidades.consultar };
    if (segments.length === 3 && verb === "PATCH") return { resource, action: "update", id, permission: businessPermissions.unidades.editar };
    if (segments.length === 2 || segments.length === 3) {
      throw new HttpError(405, "Método no permitido.", "method_not_allowed");
    }
  }

  if (resource === "documentos-cortos") {
    if (segments.length === 2 && verb === "GET") return { resource: "documentos_cortos", action: "list", permission: businessPermissions.documentosCortos.consultar };
    if (segments.length === 2 && verb === "POST") return { resource: "documentos_cortos", action: "create", permission: businessPermissions.documentosCortos.crear };
    if (segments.length === 3 && verb === "GET") return { resource: "documentos_cortos", action: "get", id, permission: businessPermissions.documentosCortos.consultar };
    if (segments.length === 3 && verb === "PATCH") return { resource: "documentos_cortos", action: "update", id, permission: businessPermissions.documentosCortos.editar };
    if (segments.length === 4 && nested === "finalizar" && verb === "POST") return { resource: "documentos_cortos", action: "finalize", id, permission: businessPermissions.documentosCortos.editar };
    if (segments.length === 4 && nested === "trabajos" && verb === "GET") return { resource: "trabajos", action: "list", documentId: id, permission: businessPermissions.trabajos.consultar };
    if (segments.length === 4 && nested === "trabajos" && verb === "POST") return { resource: "trabajos", action: "create", documentId: id, permission: businessPermissions.trabajos.crear };
    if (segments.length === 2 || segments.length === 3 || (segments.length === 4 && ["finalizar", "trabajos"].includes(nested ?? ""))) {
      throw new HttpError(405, "Método no permitido.", "method_not_allowed");
    }
  }

  if (resource === "trabajos") {
    if (segments.length === 3 && verb === "PATCH") return { resource: "trabajos", action: "update", id, permission: businessPermissions.trabajos.editar };
    if (segments.length === 4 && nested === "finalizar" && verb === "POST") return { resource: "trabajos", action: "finalize", id, permission: businessPermissions.trabajos.editar };
    if (segments.length === 3 || (segments.length === 4 && nested === "finalizar")) {
      throw new HttpError(405, "Método no permitido.", "method_not_allowed");
    }
  }
  return null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "El cuerpo debe enviarse como application/json.", "unsupported_media_type");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBodyBytes) {
      throw new HttpError(413, "El cuerpo de la solicitud excede el tamaño permitido.", "body_too_large");
    }
    chunks.push(buffer);
  }
  if (totalBytes === 0) throw new HttpError(400, "El cuerpo JSON está vacío.", "empty_body");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "El cuerpo no contiene JSON válido.", "invalid_json");
  }
}

function parseError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const databaseError = error as { code?: string };
  if (typeof databaseError?.code === "string") return publicDatabaseError(error);
  return new HttpError(500, "No se pudo completar la operación.", "internal_error");
}

function jsonError(response: ServerResponse, error: unknown): void {
  const httpError = parseError(error);
  sendJson(response, httpError.status, { error: httpError.message, code: httpError.code });
}

async function dispatchBusinessRoute(
  route: BusinessRoute,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  user: AuthenticatedUser,
  clientes: ClienteModuleContract,
  unidades: UnidadModuleContract,
  documentos: DocumentoModuleContract,
  trabajos: TrabajoModuleContract,
): Promise<void> {
  if (!hasPermission(user, route.permission)) {
    sendJson(response, 403, { error: "No tienes permiso para realizar esta operación.", code: "permission_denied" });
    return;
  }

  if (route.resource === "documentos_cortos") {
    if (route.action === "list") {
      sendJson(response, 200, await documentos.list(parseDocumentoListQuery(url.searchParams)));
      return;
    }
    if (route.action === "create") {
      sendJson(response, 201, { data: await documentos.create(await readJsonBody(request), user) });
      return;
    }
    const id = validateUuid(route.id ?? "", "documento_corto_id");
    if (route.action === "get") {
      const result = await documentos.getById(id);
      if (!result) throw new HttpError(404, "No existe la hoja de trabajo indicada.", "document_not_found");
      sendJson(response, 200, { data: result });
      return;
    }
    const result = route.action === "finalize"
      ? await documentos.finalize(id, user)
      : await documentos.update(id, await readJsonBody(request), user);
    if (!result) throw new HttpError(404, "No existe la hoja de trabajo indicada.", "document_not_found");
    sendJson(response, 200, { data: result });
    return;
  }

  if (route.resource === "trabajos") {
    if (route.action === "list" || route.action === "create") {
      const documentId = validateUuid(route.documentId ?? "", "documento_corto_id");
      const document = await documentos.getById(documentId);
      if (!document) throw new HttpError(404, "No existe la hoja de trabajo indicada.", "document_not_found");
      if (route.action === "list") {
        sendJson(response, 200, { data: await trabajos.listByDocument(documentId) });
        return;
      }
      sendJson(response, 201, { data: await trabajos.create(documentId, await readJsonBody(request), user) });
      return;
    }
    const id = validateUuid(route.id ?? "", "trabajo_id");
    const result = route.action === "finalize"
      ? await trabajos.finalize(id, user)
      : await trabajos.update(id, await readJsonBody(request), user);
    if (!result) throw new HttpError(404, "No existe el trabajo indicado.", "work_not_found");
    sendJson(response, 200, { data: result });
    return;
  }

  if (route.resource === "clientes") {
    if (route.action === "list") {
      sendJson(response, 200, await clientes.list(parseListQuery(url.searchParams)));
      return;
    }
    if (route.action === "create") {
      sendJson(response, 201, { data: await clientes.create(await readJsonBody(request), user) });
      return;
    }
    const id = validateUuid(route.id ?? "", "cliente_id");
    if (route.action === "get") {
      const result = await clientes.getById(id);
      if (!result) throw new HttpError(404, "No existe el cliente indicado.", "client_not_found");
      sendJson(response, 200, { data: result });
      return;
    }
    const result = await clientes.update(id, await readJsonBody(request), user);
    if (!result) throw new HttpError(404, "No existe el cliente indicado.", "client_not_found");
    sendJson(response, 200, { data: result });
    return;
  }

  if (route.action === "list") {
    const filters = parseListQuery(url.searchParams);
    const clientIdParam = route.clientId ?? url.searchParams.get("cliente_id");
    const clientId = clientIdParam === null || clientIdParam === undefined
      ? undefined
      : validateUuid(clientIdParam, "cliente_id");
    const serialParam = url.searchParams.get("numero_serie");
    if (serialParam !== null && filters.q !== null) {
      throw new HttpError(400, "Usa q o numero_serie, no ambos en la misma búsqueda.", "ambiguous_search");
    }
    const numeroSerie = serialParam === null ? undefined : normalizeNumeroSerie(serialParam);
    if (route.clientId) {
      const client = await clientes.getById(clientId!);
      if (!client) throw new HttpError(404, "No existe el cliente indicado.", "client_not_found");
    }
    sendJson(response, 200, await unidades.list({ ...filters, cliente_id: clientId, numero_serie: numeroSerie }));
    return;
  }
  if (route.action === "get") {
    const id = validateUuid(route.id ?? "", "unidad_id");
    const result = await unidades.getById(id);
    if (!result) throw new HttpError(404, "No existe la unidad indicada.", "unit_not_found");
    sendJson(response, 200, { data: result });
    return;
  }
  if (route.action === "create") {
    sendJson(response, 201, { data: await unidades.create(await readJsonBody(request), user) });
    return;
  }
  const id = validateUuid(route.id ?? "", "unidad_id");
  const result = await unidades.update(id, await readJsonBody(request), user);
  if (!result) throw new HttpError(404, "No existe la unidad indicada.", "unit_not_found");
  sendJson(response, 200, { data: result });
}

export function createApp(
  authService: AuthServiceContract = new AuthService(),
  dependencies: AppDependencies = {},
) {
  const clientes = dependencies.clientes ?? new ClientesModule();
  const unidades = dependencies.unidades ?? new UnidadesModule();
  const documentos = dependencies.documentos ?? new DocumentosModule();
  const trabajos = dependencies.trabajos ?? new TrabajosModule();

  return createServer(async (request, response) => {
    let url: URL;
    let segments: string[];
    try {
      url = new URL(request.url ?? "/", "http://localhost");
      segments = requestSegments(url.pathname);
    } catch (error) {
      jsonError(response, error instanceof HttpError ? error : new HttpError(400, "Solicitud inválida.", "invalid_request"));
      return;
    }

    if (segments[0] !== "api") {
      sendJson(response, 404, { error: "Recurso no encontrado.", code: "not_found" });
      return;
    }

    try {
      let authentication;
      try {
        authentication = await authenticateBearer(request.headers.authorization, authService);
      } catch {
        sendJson(response, 503, { error: "Servicio de autenticación temporalmente no disponible." });
        return;
      }
      if (authentication.status === "missing_token" || authentication.status === "invalid_token") {
        sendJson(response, 401, { error: "Autenticación requerida." });
        return;
      }
      if (authentication.status === "forbidden") {
        sendJson(response, 403, { error: "Acceso no autorizado." });
        return;
      }

      const path = `/${segments.join("/")}`;
      const method = (request.method ?? "GET").toUpperCase();
      if (path === "/api/auth/check" || path === "/api/auth/me") {
        if (method !== "GET") {
          sendJson(response, 405, { error: "Método no permitido.", code: "method_not_allowed" });
          return;
        }
        if (path === "/api/auth/check") {
          sendJson(response, 200, { authenticated: true, active: true });
          return;
        }
        const { user } = authentication;
        sendJson(response, 200, { id: user.id, nombre: user.nombre, rol: user.rol, permisos: user.permisos });
        return;
      }

      const route = resolveBusinessRoute(segments, method);
      if (!route) {
        sendJson(response, 404, { error: "Recurso no encontrado.", code: "not_found" });
        return;
      }
      await dispatchBusinessRoute(route, url, request, response, authentication.user, clientes, unidades, documentos, trabajos);
    } catch (error) {
      jsonError(response, error);
    }
  });
}

export const app = createApp();
