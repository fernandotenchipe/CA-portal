import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, createDocumentoCorto, createTrabajo, finalizeDocumentoCorto, finalizeTrabajo, getAllClientes, getDocumentosCortos, getTrabajos, updateDocumentoCorto, updateTrabajo, type DocumentoCorto, type Trabajo, type Unidad } from "./api.ts";
import { canEditTrabajo, canFinalizeTrabajo, canUseHojas, canUseTrabajos, createSubmissionGuard, emptyHojaDraft, emptyTrabajoDraft, mapHojaError, normalizeFolio, toCreateHojaPayload, toTrabajoPayload, toUpdateHojaPayload, unitsForCliente, validateHojaDraft, validateTrabajoDraft } from "./hojas-form.ts";

const doc: DocumentoCorto = { id: "d-1", folio_fisico: "AB-001", folio_fisico_normalizado: "AB-001", unidad_id: "u-1", cliente_id: "c-1", cliente_nombre: "Cliente", numero_serie: "SERIE1", estado_trabajo: "en_construccion", finalizado_en: null, observaciones: null, fecha_documento: null, creado_en: "2026-11-25", actualizado_en: "2026-11-25", cancelado_en: null };
const work: Trabajo = { id: "t-1", documento_corto_id: doc.id, numero_orden: 1, descripcion: "Reparación", estado: "en_construccion", finalizado_en: null, cantidad: "2", unidad_medida: "pieza", precio_unitario: "100.00", importe: "200.00", observaciones: null, creado_en: "2026-11-25", actualizado_en: "2026-11-25" };

describe("Hojas cortas y trabajos: reglas de formulario", () => {
  it("habilita cada acción solo con permiso y rol aprobado", () => {
    assert.equal(canUseHojas(["documentos_cortos.consultar"], "LOGISTICA", "consultar"), true);
    assert.equal(canUseHojas(["documentos_cortos.crear"], "VENTAS", "crear"), true);
    assert.equal(canUseHojas(["documentos_cortos.editar"], "OTRO", "editar"), false);
    assert.equal(canUseTrabajos(["trabajos.editar"], "ADMINISTRACION", "editar"), true);
    assert.equal(canUseTrabajos(["trabajos.crear"], "LOGISTICA", "editar"), false);
  });

  it("normaliza folio quitando espacios y conservando guiones", () => {
    assert.equal(normalizeFolio(" ab - 001 "), "AB-001");
    assert.deepEqual(validateHojaDraft({ ...emptyHojaDraft(), folio_fisico: " A B-02 ", cliente_id: "c1", unidad_id: "u1" }), {});
    assert.equal(validateHojaDraft({ ...emptyHojaDraft(), folio_fisico: "AB/2", cliente_id: "c1", unidad_id: "u1" }).folio_fisico, "Usa únicamente letras A–Z, números y guiones.");
  });

  it("valida datos obligatorios y construye payload sin campos extra", () => {
    assert.deepEqual(validateHojaDraft(emptyHojaDraft()), { folio_fisico: "El folio físico es obligatorio.", cliente_id: "Selecciona un cliente.", unidad_id: "Selecciona una unidad del cliente." });
    const payload = toCreateHojaPayload({ ...emptyHojaDraft(), folio_fisico: " ag - 9 ", cliente_id: "c1", unidad_id: "u1", observaciones: " nota " });
    assert.deepEqual(payload, { folio_fisico: "AG-9", cliente_id: "c1", unidad_id: "u1", observaciones: "nota", fecha_documento: null });
  });

  it("limita las unidades seleccionables al cliente elegido", () => {
    const units = [{ id: "u1", cliente_id: "c1" }, { id: "u2", cliente_id: "c2" }] as Unidad[];
    assert.deepEqual(unitsForCliente(units, "c1").map((unit) => unit.id), ["u1"]);
    assert.deepEqual(unitsForCliente(units, "inexistente"), []);
  });

  it("construye la edición permitida y reserva el folio al corregir hojas cerradas", () => {
    const draft = { ...emptyHojaDraft(), folio_fisico: " AB - 2 ", cliente_id: "c2", unidad_id: "u2", observaciones: "Nota", fecha_documento: "2026-11-25" };
    const openChanges = toUpdateHojaPayload(draft, doc);
    assert.deepEqual(openChanges, { folio_fisico: "AB-2", cliente_id: "c2", unidad_id: "u2", observaciones: "Nota", fecha_documento: "2026-11-25" });
    const closedChanges = toUpdateHojaPayload(draft, { ...doc, estado_trabajo: "finalizado" });
    assert.deepEqual(closedChanges, { folio_fisico: "AB-2" });
    assert.deepEqual(toUpdateHojaPayload({ ...draft, folio_fisico: doc.folio_fisico }, doc), { cliente_id: "c2", unidad_id: "u2", observaciones: "Nota", fecha_documento: "2026-11-25" });
  });

  it("permite editar datos de trabajo en hoja abierta y solo finalizar trabajo pendiente en hoja cerrada", () => {
    assert.equal(canEditTrabajo(doc, work), true);
    assert.equal(canFinalizeTrabajo({ ...doc, estado_trabajo: "finalizado" }, work), true);
    assert.equal(canEditTrabajo({ ...doc, estado_trabajo: "finalizado" }, work), false);
    assert.equal(canFinalizeTrabajo({ ...doc, cancelado_en: "2026-11-25" }, work), false);
    assert.equal(canFinalizeTrabajo(doc, { ...work, estado: "finalizado" }), false);
  });

  it("valida descripción, cantidad y precio sin inventar estados ni otros campos", () => {
    assert.deepEqual(validateTrabajoDraft(emptyTrabajoDraft()), { descripcion: "La descripción del trabajo es obligatoria." });
    assert.equal(validateTrabajoDraft({ ...emptyTrabajoDraft(), descripcion: "Piso", cantidad: "0" }).cantidad, "La cantidad debe ser mayor que cero.");
    assert.equal(validateTrabajoDraft({ ...emptyTrabajoDraft(), descripcion: "Piso", precio_unitario: "1.999" }).precio_unitario, "Admite hasta 2 decimales.");
    assert.deepEqual(toTrabajoPayload({ ...emptyTrabajoDraft(), descripcion: " Reparación ", cantidad: "2", precio_unitario: "0" }), { descripcion: "Reparación", cantidad: 2, unidad_medida: null, precio_unitario: 0, observaciones: null });
  });

  it("bloquea doble envío y mapea permisos, conflictos y conexión", () => {
    const guard = createSubmissionGuard(); assert.equal(guard.acquire(), true); assert.equal(guard.acquire(), false); guard.release(); assert.equal(guard.acquire(), true);
    assert.match(mapHojaError(new ApiError("reserved", 409, "physical_folio_reserved"), "create").folioError ?? "", /reservado/);
    assert.equal(mapHojaError(new ApiError("forbidden", 403), "work").status, 403);
    assert.equal(mapHojaError(new ApiError("offline", 503), "edit").status, 503);
  });
});

describe("Cliente API de hojas y trabajos (fetch simulado)", () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  function mockResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
  it("envía filtros y paginación con sesión al proxy", async () => {
    globalThis.fetch = async (input, init) => { calls.push({ url: String(input), init }); return mockResponse({ data: [], limit: 10, offset: 20, total: 0 }); };
    const response = await getDocumentosCortos({ accessToken: "mock-session", q: "AB-1", clienteId: "c1", unidadId: "u1", estado: "finalizado", limit: 10, offset: 20 });
    const call = calls.at(-1)!; const url = new URL(call.url, "http://localhost");
    assert.equal(response.total, 0); assert.equal(url.pathname, "/backend-api/documentos-cortos");
    assert.equal(url.searchParams.get("q"), "AB-1"); assert.equal(url.searchParams.get("cliente_id"), "c1"); assert.equal(url.searchParams.get("unidad_id"), "u1");
    assert.equal(url.searchParams.get("estado_trabajo"), "finalizado"); assert.equal(url.searchParams.get("offset"), "20");
    assert.equal(new Headers(call.init?.headers).get("Authorization"), "Bearer mock-session");
  });

  it("recorre páginas del API para cargar todos los clientes existentes", async () => {
    let requestCount = 0;
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init }); requestCount++;
      const url = new URL(String(input), "http://localhost"); const offset = Number(url.searchParams.get("offset"));
      const row = { id: `c${offset}`, nombre: `Cliente ${offset}`, razon_social: null, rfc: null, correo: null, telefono: null, activo: true, creado_en: "2026-11-25", actualizado_en: "2026-11-25" };
      return mockResponse({ data: [row], limit: 100, offset, total: 2 });
    };
    const clients = await getAllClientes({ accessToken: "mock" });
    assert.equal(clients.length, 2); assert.equal(requestCount, 2);
    assert.equal(new URL(calls.at(-1)!.url, "http://localhost").searchParams.get("offset"), "1");
  });

  it("registra y finaliza hojas usando endpoints protegidos, sin enviar identidad del actor", async () => {
    globalThis.fetch = async (input, init) => { calls.push({ url: String(input), init }); return mockResponse({ data: doc }); };
    await createDocumentoCorto({ accessToken: "mock", payload: { folio_fisico: "AB-001", unidad_id: "u1", cliente_id: "c1", observaciones: null, fecha_documento: null } });
    const created = calls.at(-1)!; assert.equal(created.url, "/backend-api/documentos-cortos"); assert.equal(created.init?.method, "POST");
    assert.equal(JSON.parse(String(created.init?.body)).actor_id, undefined);
    await finalizeDocumentoCorto({ accessToken: "mock", documentoId: doc.id });
    assert.equal(calls.at(-1)?.url, `/backend-api/documentos-cortos/${doc.id}/finalizar`); assert.equal(calls.at(-1)?.init?.method, "POST");
    await updateDocumentoCorto({ accessToken: "mock", documentoId: doc.id, payload: { folio_fisico: "AB-2" } });
    assert.equal(calls.at(-1)?.url, `/backend-api/documentos-cortos/${doc.id}`); assert.equal(calls.at(-1)?.init?.method, "PATCH");
  });

  it("consulta trabajos y actualiza trabajos por su endpoint propio", async () => {
    globalThis.fetch = async (input, init) => { calls.push({ url: String(input), init }); return !init?.method && String(input).endsWith("/trabajos") ? mockResponse({ data: [work] }) : mockResponse({ data: work }); };
    assert.deepEqual(await getTrabajos({ accessToken: "mock", documentoId: doc.id }), [work]);
    await createTrabajo({ accessToken: "mock", documentoId: doc.id, payload: { descripcion: "Reparación", cantidad: 1, unidad_medida: null, precio_unitario: 20, observaciones: null } });
    assert.equal(calls.at(-1)?.url, `/backend-api/documentos-cortos/${doc.id}/trabajos`); assert.equal(calls.at(-1)?.init?.method, "POST");
    await updateTrabajo({ accessToken: "mock", trabajoId: work.id, payload: { descripcion: "Ajuste" } });
    assert.equal(calls.at(-2)?.url, `/backend-api/documentos-cortos/${doc.id}/trabajos`); assert.equal(calls.at(-1)?.url, `/backend-api/trabajos/${work.id}`);
    await finalizeTrabajo({ accessToken: "mock", trabajoId: work.id });
    assert.equal(calls.at(-1)?.url, `/backend-api/trabajos/${work.id}/finalizar`); assert.equal(calls.at(-1)?.init?.method, "POST");
  });

  it("propaga 401, 403, 404, 409 y 503 para estados visibles en interfaz", async () => {
    for (const status of [401, 403, 404, 409, 503]) {
      globalThis.fetch = async () => mockResponse({ error: "API test" }, status);
      await assert.rejects(getDocumentosCortos({ accessToken: "mock", limit: 20, offset: 0 }), (error: unknown) => error instanceof ApiError && error.status === status);
    }
  });
  it("restaura fetch global al final de los tests", () => { globalThis.fetch = originalFetch; assert.equal(typeof globalThis.fetch, "function"); });
});
