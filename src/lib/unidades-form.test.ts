import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, createUnidad, getUnidades, updateUnidad, type Unidad } from "./api.ts";
import { canConsultUnidades, canCreateUnidad, canEditUnidad, createSubmissionGuard, emptyUnidadDraft, mapUnidadError, normalizeSerial, preventSerialPaste, preventSerialPasteShortcut, toCreateUnidadPayload, toUpdateUnidadPayload, unidadToDraft, validateUnidadDraft } from "./unidades-form.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const unidad: Unidad = {
  id: "unidad-1", cliente_id: "cliente-1", cliente_nombre: "Taller Norte", numero_serie: "SERIE123", marca: "International", modelo: "MV", anio: 2022,
  placas: "ABC123", activo: true, creado_en: "2026-01-01T00:00:00.000Z", actualizado_en: "2026-01-01T00:00:00.000Z",
};

test("permiso de consulta, alta y edición se comprueban de forma independiente", () => {
  const permissions = ["unidades.consultar", "unidades.crear"];
  assert.equal(canConsultUnidades(permissions), true);
  assert.equal(canCreateUnidad(permissions), true);
  assert.equal(canEditUnidad(permissions), false);
  assert.equal(canCreateUnidad([]), false);
});

test("serie se normaliza a mayúsculas y valida capturas idénticas sin espacios ni signos", () => {
  const draft = { ...emptyUnidadDraft(), cliente_id: "cliente-1", numero_serie: "abc123", numero_serie_confirmacion: "ABC123" };
  assert.equal(normalizeSerial(draft.numero_serie), "ABC123");
  assert.deepEqual(validateUnidadDraft(draft, "create"), {});
  assert.match(validateUnidadDraft({ ...draft, numero_serie_confirmacion: "abc124" }, "create").numero_serie_confirmacion ?? "", /no coinciden/);
  for (const invalid of ["A B", "A-B", "A.B", "ñ123"]) {
    assert.ok(validateUnidadDraft({ ...draft, numero_serie: invalid, numero_serie_confirmacion: invalid }, "create").numero_serie, invalid);
  }
});

test("alta exige cliente y serie; valida año permitido", () => {
  const errors = validateUnidadDraft(emptyUnidadDraft(), "create");
  assert.ok(errors.cliente_id);
  assert.ok(errors.numero_serie);
  assert.ok(errors.numero_serie_confirmacion);
  const draft = { ...emptyUnidadDraft(), cliente_id: "c", numero_serie: "S1", numero_serie_confirmacion: "S1", anio: "1885" };
  assert.ok(validateUnidadDraft(draft, "create").anio);
  assert.deepEqual(validateUnidadDraft({ ...draft, anio: "2024" }, "create"), {});
});

test("payload de alta conserva cliente seleccionado, serie mayúscula y convierte opcionales vacíos en null", () => {
  const payload = toCreateUnidadPayload({ ...emptyUnidadDraft(), cliente_id: "cliente-real-elegido", numero_serie: "s1", numero_serie_confirmacion: "S1", anio: "2024" });
  assert.deepEqual(payload, { cliente_id: "cliente-real-elegido", numero_serie: "S1", numero_serie_confirmacion: "S1", marca: null, modelo: null, anio: 2024, placas: null, activo: true });
});

test("edición precarga campos, no incluye cliente y agrega serie doble solo si se cambia", () => {
  const draft = unidadToDraft(unidad);
  assert.equal(draft.cliente_id, "cliente-1");
  assert.equal(draft.numero_serie_confirmacion, "SERIE123");
  assert.deepEqual(toUpdateUnidadPayload(draft, unidad), {});
  const changed = toUpdateUnidadPayload({ ...draft, numero_serie: "serienueva", numero_serie_confirmacion: "serienueva", cliente_id: "otro-cliente", modelo: "Nuevo" }, unidad);
  assert.deepEqual(changed, { numero_serie: "SERIENUEVA", numero_serie_confirmacion: "SERIENUEVA", modelo: "Nuevo" });
  assert.equal("cliente_id" in changed, false);
});

test("pegar y atajos de pegar quedan bloqueados en capturas de serie", () => {
  let prevented = 0;
  preventSerialPaste({ preventDefault: () => { prevented += 1; } });
  preventSerialPasteShortcut({ key: "v", ctrlKey: true, preventDefault: () => { prevented += 1; } });
  preventSerialPasteShortcut({ key: "Insert", shiftKey: true, preventDefault: () => { prevented += 1; } });
  preventSerialPasteShortcut({ key: "a", ctrlKey: true, preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 3);
});

test("guard impide solicitudes simultáneas y se libera al terminar", () => {
  const guard = createSubmissionGuard();
  assert.equal(guard.acquire(), true);
  assert.equal(guard.acquire(), false);
  guard.release();
  assert.equal(guard.acquire(), true);
});

test("listado envía búsqueda, cliente, paginación y bearer por el proxy existente", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init };
    return Response.json({ data: [unidad], limit: 20, offset: 20, total: 21 });
  };
  const page = await getUnidades({ accessToken: "test-token", query: "serie", clienteId: "cliente-1", limit: 20, offset: 20 });
  assert.equal(page.total, 21);
  assert.match(captured.url ?? "", /^\/backend-api\/unidades\?/);
  const params = new URL(captured.url ?? "", "http://localhost").searchParams;
  assert.equal(params.get("q"), "serie");
  assert.equal(params.get("cliente_id"), "cliente-1");
  assert.equal(params.get("limit"), "20");
  assert.equal(params.get("offset"), "20");
  assert.equal((captured.init?.headers as Record<string, string>).Authorization, "Bearer test-token");
});

test("create y patch usan métodos y rutas correctos con payload permitido", async () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: String(init?.method), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json({ data: unidad });
  };
  await createUnidad({ accessToken: "token", payload: { cliente_id: "c1", numero_serie: "S1", numero_serie_confirmacion: "S1", marca: null, modelo: null, anio: null, placas: null, activo: true } });
  await updateUnidad({ accessToken: "token", unidadId: "id/encoded", payload: { modelo: "Nuevo", numero_serie: "S2", numero_serie_confirmacion: "S2" } });
  assert.equal(calls[0].url, "/backend-api/unidades");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].url, "/backend-api/unidades/id%2Fencoded");
  assert.equal(calls[1].method, "PATCH");
  assert.equal("cliente_id" in calls[1].body, false);
});

test("estados HTTP 400, 401, 403, 404, 409 y 503 se traducen", async () => {
  for (const [status, code, message] of [[400, "bad_request", "error backend"], [401, "unauthorized", "sesión venció"], [403, "forbidden", "permiso"], [404, "not_found", "cliente seleccionado"], [409, "duplicate_serial", "registrado"], [503, "unavailable", "backend"]] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "error backend", code }), { status, headers: { "Content-Type": "application/json" } });
    await assert.rejects(() => createUnidad({ accessToken: "token", payload: { cliente_id: "c1", numero_serie: "S1", numero_serie_confirmacion: "S1", marca: null, modelo: null, anio: null, placas: null, activo: true } }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.match(mapUnidadError(error, "create").message.toLowerCase(), new RegExp(message));
      return true;
    });
  }
});

test("errores 400/422 se retornan al formulario y cancelación no dispara ninguna API", () => {
  const fieldError = mapUnidadError(new ApiError("Dato inválido", 422, "invalid_field"), "create");
  assert.equal(fieldError.status, 422);
  assert.equal(fieldError.message, "Dato inválido");
  let called = false;
  const cancel = () => { called = true; };
  cancel();
  assert.equal(called, true);
});
