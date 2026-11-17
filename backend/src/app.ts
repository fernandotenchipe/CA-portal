import { createServer } from "node:http";

export const app = createServer((_request, response) => {
  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ message: "El backend aún no tiene rutas." }));
});
