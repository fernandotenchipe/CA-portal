import { createServer } from "node:http";
import { authenticateBearer } from "./middleware/authentication.js";
import { AuthService } from "./services/auth-service.js";
import type { AuthServiceContract } from "./types/auth.js";

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Authorization",
  });
  response.end(JSON.stringify(body));
}

export function createApp(authService: AuthServiceContract = new AuthService()) {
  return createServer(async (request, response) => {
    let path: string;
    try {
      path = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      sendJson(response, 400, { error: "Solicitud inválida." });
      return;
    }

    if (path !== "/api/auth/me" && path !== "/api/auth/check") {
      sendJson(response, 404, { error: "Recurso no encontrado." });
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Método no permitido." });
      return;
    }

    try {
      const authentication = await authenticateBearer(request.headers.authorization, authService);

      if (authentication.status === "missing_token" || authentication.status === "invalid_token") {
        sendJson(response, 401, { error: "Autenticación requerida." });
        return;
      }
      if (authentication.status === "forbidden") {
        sendJson(response, 403, { error: "Acceso no autorizado." });
        return;
      }

      if (path === "/api/auth/check") {
        sendJson(response, 200, { authenticated: true, active: true });
        return;
      }

      const { user } = authentication;
      sendJson(response, 200, {
        id: user.id,
        nombre: user.nombre,
        rol: user.rol,
        permisos: user.permisos,
      });
    } catch {
      sendJson(response, 503, { error: "Servicio de autenticación temporalmente no disponible." });
    }
  });
}

export const app = createApp();
