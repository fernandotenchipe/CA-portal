import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createApp } from "../dist/app.js";
import { HttpError } from "../dist/errors.js";
import { ClientesModule } from "../dist/modules/clientes/index.js";
import { UnidadesModule } from "../dist/modules/unidades/index.js";

const actor = {
  id: "b0d673b0-c76b-4ca1-96c2-b053fce62eca",
  nombre: "Administración de prueba",
  rol: { codigo: "ADMINISTRACION", nombre: "Administración" },
  permisos: [
    "clientes.consultar", "clientes.crear", "clientes.editar",
    "unidades.consultar", "unidades.crear", "unidades.editar",
  ],
};
const clientId = "c19c8143-d70a-4f2b-a07b-fb7a4b7bb021";
const unitId = "e1e96de7-4821-4527-9ff8-6776793a91db";

async function withHttpApp(app, callback) {
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const { port } = app.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
  }
}

function createAuthService() {
  return {
    async authenticate(token) {
      if (token === "valid") return { status: "authenticated", user: actor };
      if (token === "read-only") return { status: "authenticated", user: { ...actor, rol: { codigo: "VENTAS", nombre: "Ventas" }, permisos: ["clientes.consultar", "unidades.consultar"] } };
      if (token.startsWith("matrix:")) {
        const codigo = token.slice("matrix:".length);
        const names = { ADMINISTRACION: "Administración", VENTAS: "Ventas", LOGISTICA: "Logística", OTRO: "Otro" };
        return { status: "authenticated", user: { ...actor, rol: { codigo, nombre: names[codigo] ?? codigo }, permisos: [
          "clientes.consultar", "clientes.crear", "clientes.editar",
          "unidades.consultar", "unidades.crear", "unidades.editar",
        ] } };
      }
      if (token.startsWith("missing:")) {
        const missingPermission = token.slice("missing:".length);
        return { status: "authenticated", user: { ...actor, rol: { codigo: "VENTAS", nombre: "Ventas" }, permisos: [
          "clientes.consultar", "clientes.crear", "clientes.editar",
          "unidades.consultar", "unidades.crear", "unidades.editar",
        ].filter((permission) => permission !== missingPermission) } };
      }
      if (token === "inactive") return { status: "forbidden" };
      return { status: "invalid_token" };
    },
  };
}

function createModules({ clientRows = [], unitRows = [] } = {}) {
  const state = { clientRows, unitRows, calls: [] };
  const clients = new ClientesModule({
    async list(filters) { state.calls.push(["clientes.list", filters]); return { data: state.clientRows, limit: filters.limit, offset: filters.offset, total: state.clientRows.length }; },
    async getById(id) { state.calls.push(["clientes.getById", id]); return state.clientRows.find((row) => row.id === id) ?? null; },
    async create(input, user) {
      state.calls.push(["clientes.create", input, user.id]);
      if (input.rfc === "DUPLICADO") throw new HttpError(409, "Ya existe un cliente con ese RFC.", "duplicate_rfc");
      const row = { id: clientId, activo: true, razon_social: null, rfc: null, correo: null, telefono: null, ...input };
      state.clientRows.push(row);
      return row;
    },
    async update(id, input, user) {
      state.calls.push(["clientes.update", id, input, user.id]);
      const index = state.clientRows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      state.clientRows[index] = { ...state.clientRows[index], ...input };
      return state.clientRows[index];
    },
  });
  const units = new UnidadesModule({
    async list(filters) { state.calls.push(["unidades.list", filters]); return { data: state.unitRows, limit: filters.limit, offset: filters.offset, total: state.unitRows.length }; },
    async getById(id) { state.calls.push(["unidades.getById", id]); return state.unitRows.find((row) => row.id === id) ?? null; },
    async create(input, user) {
      state.calls.push(["unidades.create", input, user.id]);
      if (input.numero_serie === "DUPLICADA1") throw new HttpError(409, "El número de serie ya está registrado.", "duplicate_serial");
      const row = { id: unitId, cliente_nombre: "Cliente de prueba", activo: true, marca: null, modelo: null, anio: null, placas: null, ...input };
      state.unitRows.push(row);
      return row;
    },
    async update(id, input, user) {
      state.calls.push(["unidades.update", id, input, user.id]);
      const index = state.unitRows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      state.unitRows[index] = { ...state.unitRows[index], ...input };
      return state.unitRows[index];
    },
  });
  return { state, clientes: clients, unidades: units };
}

function jsonRequest(url, token, method = "GET", body) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Clientes y unidades API", () => {
  it("aplica la matriz aprobada en todas las rutas: tres roles permitidos y cualquier otro rol denegado", async () => {
    const routes = [
      ["GET", "/api/clientes", undefined, "clientes.consultar"],
      ["POST", "/api/clientes", { nombre: "Cliente matriz" }, "clientes.crear"],
      ["GET", `/api/clientes/${clientId}`, undefined, "clientes.consultar"],
      ["PATCH", `/api/clientes/${clientId}`, { telefono: "555" }, "clientes.editar"],
      ["GET", `/api/clientes/${clientId}/unidades`, undefined, "unidades.consultar"],
      ["GET", "/api/unidades", undefined, "unidades.consultar"],
      ["POST", "/api/unidades", { cliente_id: clientId, numero_serie: "MATRIZ1", numero_serie_confirmacion: "MATRIZ1" }, "unidades.crear"],
      ["GET", `/api/unidades/${unitId}`, undefined, "unidades.consultar"],
      ["PATCH", `/api/unidades/${unitId}`, { marca: "Matriz" }, "unidades.editar"],
    ];

    for (const codigo of ["ADMINISTRACION", "VENTAS", "LOGISTICA"]) {
      const modules = createModules({
        clientRows: [{ id: clientId, nombre: "Cliente de matriz" }],
        unitRows: [{ id: unitId, cliente_id: clientId, numero_serie: "MATRIZ1", cliente_nombre: "Cliente de matriz" }],
      });
      const app = createApp(createAuthService(), modules);
      await withHttpApp(app, async (base) => {
        for (const [method, path, body] of routes) {
          const response = await jsonRequest(`${base}${path}`, `matrix:${codigo}`, method, body);
          assert.ok(response.status >= 200 && response.status < 300, `${codigo} ${method} ${path}: ${response.status}`);
        }
      });
    }

    const missingPermissionModules = createModules({
      clientRows: [{ id: clientId, nombre: "Cliente de matriz" }],
      unitRows: [{ id: unitId, cliente_id: clientId, numero_serie: "MATRIZ1", cliente_nombre: "Cliente de matriz" }],
    });
    const missingPermissionApp = createApp(createAuthService(), missingPermissionModules);
    await withHttpApp(missingPermissionApp, async (base) => {
      for (const [method, path, body, permission] of routes) {
        const response = await jsonRequest(`${base}${path}`, `missing:${permission}`, method, body);
        assert.equal(response.status, 403, `VENTAS sin ${permission}: ${method} ${path}`);
        assert.equal((await response.json()).code, "permission_denied");
      }
    });

    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      for (const [method, path, body] of routes) {
        const response = await jsonRequest(`${base}${path}`, "matrix:OTRO", method, body);
        assert.equal(response.status, 403, `OTRO ${method} ${path}`);
        assert.equal((await response.json()).code, "permission_denied");
      }
    });
    assert.equal(modules.state.calls.length, 0);
  });

  it("requiere token válido y perfil activo en todas las rutas de negocio", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const missing = await fetch(`${base}/api/clientes`);
      assert.equal(missing.status, 401);
      const inactive = await jsonRequest(`${base}/api/unidades`, "inactive");
      assert.equal(inactive.status, 403);
    });
    assert.equal(modules.state.calls.length, 0);
  });

  it("deniega escrituras si el token no tiene permiso en la matriz", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const response = await jsonRequest(`${base}/api/clientes`, "read-only", "POST", { nombre: "Cliente" });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "permission_denied");
    });
    assert.equal(modules.state.calls.length, 0);
  });

  it("lista y busca clientes con parámetros validados", async () => {
    const modules = createModules({ clientRows: [{ id: clientId, nombre: "Carrocería Demo" }] });
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const response = await jsonRequest(`${base}/api/clientes?q=demo&limit=10&offset=0`, "valid");
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data[0].id, clientId);
      assert.deepEqual(modules.state.calls[0], ["clientes.list", { q: "demo", limit: 10, offset: 0, activo: null }]);

      const invalidLimit = await jsonRequest(`${base}/api/clientes?limit=500`, "valid");
      assert.equal(invalidLimit.status, 400);
    });
  });

  it("crea, consulta y actualiza un cliente usando solo columnas permitidas", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const create = await jsonRequest(`${base}/api/clientes`, "valid", "POST", {
        nombre: "  Taller Norte  ", correo: "contacto@example.com", razon_social: null,
      });
      assert.equal(create.status, 201);
      assert.equal((await create.json()).data.nombre, "Taller Norte");
      assert.deepEqual(modules.state.calls[0], ["clientes.create", {
        nombre: "Taller Norte", correo: "contacto@example.com", razon_social: null,
      }, actor.id]);

      const get = await jsonRequest(`${base}/api/clientes/${clientId}`, "valid");
      assert.equal(get.status, 200);
      assert.equal((await get.json()).data.nombre, "Taller Norte");

      const update = await jsonRequest(`${base}/api/clientes/${clientId}`, "valid", "PATCH", { telefono: "555 0101" });
      assert.equal(update.status, 200);
      assert.equal((await update.json()).data.telefono, "555 0101");

      const spoofActor = await jsonRequest(`${base}/api/clientes/${clientId}`, "valid", "PATCH", { nombre: "Cambio", creado_por: actor.id });
      assert.equal(spoofActor.status, 400);
    });
  });

  it("rechaza RFC duplicado cuando el valor viene informado", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const response = await jsonRequest(`${base}/api/clientes`, "valid", "POST", { nombre: "Otro cliente", rfc: "DUPLICADO" });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "duplicate_rfc");
    });
  });

  it("normaliza y confirma la serie dos veces al crear una unidad", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const response = await jsonRequest(`${base}/api/unidades`, "valid", "POST", {
        cliente_id: clientId, numero_serie: "ca900abc", numero_serie_confirmacion: "CA900ABC", anio: 2024,
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).data.numero_serie, "CA900ABC");
      assert.equal(modules.state.calls[0][2], actor.id);
      assert.equal(modules.state.calls[0][1].numero_serie, "CA900ABC");
    });
  });

  it("rechaza serie inválida y capturas diferentes sin llamar al repositorio", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const invalid = await jsonRequest(`${base}/api/unidades`, "valid", "POST", {
        cliente_id: clientId, numero_serie: "CA-900", numero_serie_confirmacion: "CA-900",
      });
      assert.equal(invalid.status, 422);
      assert.equal((await invalid.json()).code, "invalid_serial");

      const mismatch = await jsonRequest(`${base}/api/unidades`, "valid", "POST", {
        cliente_id: clientId, numero_serie: "CA900", numero_serie_confirmacion: "CA901",
      });
      assert.equal(mismatch.status, 422);
      assert.equal((await mismatch.json()).code, "serial_confirmation_mismatch");

      const noConfirmation = await jsonRequest(`${base}/api/unidades/${unitId}`, "valid", "PATCH", { numero_serie: "CA901" });
      assert.equal(noConfirmation.status, 422);
    });
    assert.equal(modules.state.calls.length, 0);
  });

  it("devuelve conflicto para una serie duplicada y valida asociaciones", async () => {
    const modules = createModules();
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const duplicate = await jsonRequest(`${base}/api/unidades`, "valid", "POST", {
        cliente_id: clientId, numero_serie: "DUPLICADA1", numero_serie_confirmacion: "duplicada1",
      });
      assert.equal(duplicate.status, 409);
      assert.equal((await duplicate.json()).code, "duplicate_serial");

      const invalidClient = await jsonRequest(`${base}/api/unidades`, "valid", "POST", {
        cliente_id: "no-es-uuid", numero_serie: "SERIE1", numero_serie_confirmacion: "SERIE1",
      });
      assert.equal(invalidClient.status, 400);
    });
  });

  it("consulta unidades por cliente, serie y detalle", async () => {
    const modules = createModules({
      clientRows: [{ id: clientId, nombre: "Cliente" }],
      unitRows: [{ id: unitId, cliente_id: clientId, numero_serie: "CA900ABC", cliente_nombre: "Cliente" }],
    });
    const app = createApp(createAuthService(), modules);
    await withHttpApp(app, async (base) => {
      const bySerial = await jsonRequest(`${base}/api/unidades?numero_serie=ca900abc`, "valid");
      assert.equal(bySerial.status, 200);
      assert.equal((await bySerial.json()).data[0].numero_serie, "CA900ABC");

      const byClient = await jsonRequest(`${base}/api/clientes/${clientId}/unidades`, "valid");
      assert.equal(byClient.status, 200);
      const relatedList = modules.state.calls.find(([name, filters]) => name === "unidades.list" && filters.cliente_id === clientId);
      assert.ok(relatedList);

      const detail = await jsonRequest(`${base}/api/unidades/${unitId}`, "valid");
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).data.id, unitId);
    });
  });
});
