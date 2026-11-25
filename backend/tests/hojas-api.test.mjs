import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../dist/app.js";
import { DocumentosModule } from "../dist/modules/documentos/index.js";
import { TrabajosModule } from "../dist/modules/documentos/trabajos.js";

const actor = { id: "b0d673b0-c76b-4ca1-96c2-b053fce62eca", nombre: "Operador", rol: { codigo: "LOGISTICA", nombre: "Logística" }, permisos: [
  "documentos_cortos.consultar", "documentos_cortos.crear", "documentos_cortos.editar",
  "trabajos.consultar", "trabajos.crear", "trabajos.editar",
] };
const docId = "e1e96de7-4821-4527-9ff8-6776793a91db";
const unitId = "c19c8143-d70a-4f2b-a07b-fb7a4b7bb021";
const workId = "d7d0f55e-1bc8-4cb8-a937-44eac9eb6594";
const documentRow = { id: docId, folio_fisico: "AB-001", folio_fisico_normalizado: "AB-001", unidad_id: unitId, cliente_id: "52e7eb99-1ff0-49e6-aa5e-6f65ca143dd4", cliente_nombre: "Carrocerías Demo", numero_serie: "SERIE1", estado_trabajo: "en_construccion", finalizado_en: null, observaciones: null, fecha_documento: null, creado_en: new Date(0), actualizado_en: new Date(0), cancelado_en: null };
const workRow = { id: workId, documento_corto_id: docId, numero_orden: 1, descripcion: "Reparar caja", estado: "en_construccion", finalizado_en: null, cantidad: null, unidad_medida: null, precio_unitario: null, importe: null, observaciones: null, creado_en: new Date(0), actualizado_en: new Date(0) };

function modules() {
  const calls = [];
  const docsRepo = {
    async list(filters) { calls.push(["documents.list", filters]); return { data: [documentRow], limit: filters.limit, offset: filters.offset, total: 1 }; },
    async getById(id) { calls.push(["documents.get", id]); return id === docId ? documentRow : null; },
    async create(input, user) { calls.push(["documents.create", input, user.id]); return { ...documentRow, folio_fisico: input.folio_fisico }; },
    async update(id, input, user) { calls.push(["documents.update", id, input, user.id]); return { ...documentRow, ...input }; },
    async finalize(id, user) { calls.push(["documents.finalize", id, user.id]); return { ...documentRow, estado_trabajo: "finalizado", finalizado_en: new Date(1) }; },
  };
  const jobsRepo = {
    async listByDocument(id) { calls.push(["works.list", id]); return [workRow]; },
    async create(id, input, user) { calls.push(["works.create", id, input, user.id]); return { ...workRow, documento_corto_id: id, ...input }; },
    async update(id, input, user) { calls.push(["works.update", id, input, user.id]); return { ...workRow, ...input }; },
    async finalize(id, user) { calls.push(["works.finalize", id, user.id]); return { ...workRow, estado: "finalizado", finalizado_en: new Date(1) }; },
  };
  return { calls, documentos: new DocumentosModule(docsRepo), trabajos: new TrabajosModule(jobsRepo) };
}

function authService() {
  return { async authenticate(token) {
    if (token === "valid") return { status: "authenticated", user: actor };
    if (token === "no-permissions") return { status: "authenticated", user: { ...actor, permisos: [] } };
    if (token.startsWith("matrix:")) {
      const [, roleCode, permission] = token.split(":");
      return { status: "authenticated", user: { ...actor, rol: { codigo: roleCode, nombre: roleCode }, permisos: [permission] } };
    }
    if (token === "inactive") return { status: "forbidden" };
    return { status: "invalid_token" };
  } };
}

async function withApp(dependencies, callback) {
  const app = createApp(authService(), dependencies);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  try { await callback(`http://127.0.0.1:${app.address().port}`); }
  finally { await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())); }
}

function request(url, method = "GET", body, token = "valid") {
  return fetch(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("Hojas cortas y trabajos API", () => {
  it("consulta hojas con folio normalizado, cliente, unidad y filtros de estado", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      const response = await request(`${base}/api/documentos-cortos?folio_fisico=ab%20-%20001&cliente_id=${documentRow.cliente_id}&unidad_id=${unitId}&estado_trabajo=en_construccion&cancelada=false&limit=5&offset=10`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.data[0].cliente_nombre, "Carrocerías Demo");
      assert.equal(body.total, 1);
      const filters = deps.calls.find(([name]) => name === "documents.list")[1];
      assert.equal(filters.folio_fisico, "AB-001");
      assert.equal(filters.cliente_id, documentRow.cliente_id);
      assert.equal(filters.unidad_id, unitId);
      assert.equal(filters.estado_trabajo, "en_construccion");
      assert.equal(filters.cancelada, false);
    });
  });

  it("crea y edita hojas validando folio/campos, y finaliza con el actor de Auth", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      const created = await request(`${base}/api/documentos-cortos`, "POST", { folio_fisico: " ab - 001 ", unidad_id: unitId, cliente_id: documentRow.cliente_id, fecha_documento: "2026-11-25" });
      assert.equal(created.status, 201);
      const createCall = deps.calls.find(([name]) => name === "documents.create");
      assert.equal(createCall[1].folio_fisico, "AB - 001");
      assert.equal(createCall[1].cliente_id, documentRow.cliente_id);
      assert.equal(createCall[2], actor.id);

      const patched = await request(`${base}/api/documentos-cortos/${docId}`, "PATCH", { folio_fisico: "ab 002", observaciones: " Revisar medidas " });
      assert.equal(patched.status, 200);
      const patchCall = deps.calls.find(([name]) => name === "documents.update");
      assert.deepEqual(patchCall[2], { folio_fisico: "AB 002", observaciones: "Revisar medidas" });
      assert.equal(patchCall[3], actor.id);

      const finalized = await request(`${base}/api/documentos-cortos/${docId}/finalizar`, "POST");
      assert.equal(finalized.status, 200);
      assert.equal((await finalized.json()).data.estado_trabajo, "finalizado");
      assert.deepEqual(deps.calls.find(([name]) => name === "documents.finalize").slice(1), [docId, actor.id]);
    });
  });

  it("valida folio, UUID, fechas y estados sin ejecutar mutaciones inválidas", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      for (const folio of ["", "A.B", "ñ-1", "   "]) {
        const response = await request(`${base}/api/documentos-cortos`, "POST", { folio_fisico: folio, unidad_id: unitId });
        assert.equal(response.status, 422, folio);
      }
      const invalidDate = await request(`${base}/api/documentos-cortos`, "POST", { folio_fisico: "A-1", unidad_id: unitId, fecha_documento: "2026-02-30" });
      assert.equal(invalidDate.status, 422);
      const invalidFilter = await request(`${base}/api/documentos-cortos?estado_trabajo=pausado`);
      assert.equal(invalidFilter.status, 400);
      const invalidActiveFilter = await request(`${base}/api/documentos-cortos?activo=true`);
      assert.equal(invalidActiveFilter.status, 400);
      assert.equal(deps.calls.some(([name]) => name === "documents.create"), false);
    });
  });

  it("lista, agrega, edita y finaliza trabajos con las claves de permiso respectivas", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      const listed = await request(`${base}/api/documentos-cortos/${docId}/trabajos`);
      assert.equal(listed.status, 200);
      assert.equal((await listed.json()).data[0].documento_corto_id, docId);

      const created = await request(`${base}/api/documentos-cortos/${docId}/trabajos`, "POST", { descripcion: "  Instalar redilas ", cantidad: 2.5, unidad_medida: "piezas", precio_unitario: 100.25 });
      assert.equal(created.status, 201);
      const createCall = deps.calls.find(([name]) => name === "works.create");
      assert.equal(createCall[2].descripcion, "Instalar redilas");
      assert.equal(createCall[2].cantidad, 2.5);
      assert.equal(createCall[3], actor.id);

      const updated = await request(`${base}/api/trabajos/${workId}`, "PATCH", { observaciones: "Listo para inspección" });
      assert.equal(updated.status, 200);
      assert.equal(deps.calls.find(([name]) => name === "works.update")[2].observaciones, "Listo para inspección");

      const finalized = await request(`${base}/api/trabajos/${workId}/finalizar`, "POST");
      assert.equal(finalized.status, 200);
      assert.equal((await finalized.json()).data.estado, "finalizado");
      assert.deepEqual(deps.calls.find(([name]) => name === "works.finalize").slice(1), [workId, actor.id]);
    });
  });

  it("rechaza entradas inválidas de trabajo y no admite estados inventados", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      for (const [payload, expectedStatus] of [[{ descripcion: " " }, 422], [{ descripcion: "Pintar", cantidad: 0 }, 422], [{ descripcion: "Pintar", cantidad: 1.1234 }, 422], [{ descripcion: "Pintar", precio_unitario: -1 }, 422], [{ descripcion: "Pintar", precio_unitario: 1_000_000_000_000 }, 422], [{ descripcion: "Pintar", estado: "pausado" }, 400]]) {
        const response = await request(`${base}/api/documentos-cortos/${docId}/trabajos`, "POST", payload);
        assert.equal(response.status, expectedStatus);
      }
      assert.equal(deps.calls.some(([name]) => name === "works.create"), false);
    });
  });

  it("exige JWT, perfil activo y permiso específico sin asumir roles", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      assert.equal((await request(`${base}/api/documentos-cortos`, "GET", undefined, null)).status, 401);
      assert.equal((await request(`${base}/api/documentos-cortos`, "GET", undefined, "inactive")).status, 403);
      for (const [method, path, body] of [
        ["GET", "/api/documentos-cortos", undefined],
        ["POST", "/api/documentos-cortos", { folio_fisico: "A-1", unidad_id: unitId }],
        ["PATCH", `/api/documentos-cortos/${docId}`, { observaciones: "cambio" }],
        ["POST", `/api/documentos-cortos/${docId}/finalizar`, undefined],
        ["GET", `/api/documentos-cortos/${docId}/trabajos`, undefined],
        ["POST", `/api/documentos-cortos/${docId}/trabajos`, { descripcion: "Pintar" }],
        ["PATCH", `/api/trabajos/${workId}`, { descripcion: "Pintar" }],
        ["POST", `/api/trabajos/${workId}/finalizar`, undefined],
      ]) {
        assert.equal((await request(`${base}${path}`, method, body, "no-permissions")).status, 403, `${method} ${path}`);
      }
    });
    assert.equal(deps.calls.length, 0);
  });

  it("aplica la matriz exacta a los tres roles autorizados y niega grants accidentales a otros", async () => {
    const operations = [
      ["GET", "/api/documentos-cortos", undefined, "documentos_cortos.consultar", 200],
      ["POST", "/api/documentos-cortos", { folio_fisico: "A-1", unidad_id: unitId }, "documentos_cortos.crear", 201],
      ["PATCH", `/api/documentos-cortos/${docId}`, { observaciones: "cambio" }, "documentos_cortos.editar", 200],
        ["POST", `/api/documentos-cortos/${docId}/finalizar`, undefined, "documentos_cortos.editar", 200],
      ["GET", `/api/documentos-cortos/${docId}/trabajos`, undefined, "trabajos.consultar", 200],
      ["POST", `/api/documentos-cortos/${docId}/trabajos`, { descripcion: "Pintar" }, "trabajos.crear", 201],
      ["PATCH", `/api/trabajos/${workId}`, { observaciones: "cambio" }, "trabajos.editar", 200],
        ["POST", `/api/trabajos/${workId}/finalizar`, undefined, "trabajos.editar", 200],
    ];
    const deps = modules();
    await withApp(deps, async (base) => {
      for (const role of ["ADMINISTRACION", "VENTAS", "LOGISTICA"]) {
        for (const [method, path, body, permission, expected] of operations) {
          const response = await request(`${base}${path}`, method, body, `matrix:${role}:${permission}`);
          assert.equal(response.status, expected, `${role} ${permission} ${method} ${path}`);
        }
      }
      for (const [method, path, body, permission] of operations) {
        const response = await request(`${base}${path}`, method, body, `matrix:OTRO:${permission}`);
        assert.equal(response.status, 403, `OTRO con grant accidental ${permission} ${method} ${path}`);
      }
    });
  });

  it("no revela IDs de actores ni campos de contacto en las hojas y trabajos", async () => {
    const deps = modules();
    await withApp(deps, async (base) => {
      const response = await request(`${base}/api/documentos-cortos/${docId}`);
      const json = JSON.stringify(await response.json());
      assert.equal(json.includes("creado_por"), false);
      assert.equal(json.includes("finalizado_por"), false);
      assert.equal(json.includes("correo"), false);
      assert.equal(json.includes("telefono"), false);
    });
  });
});
