import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, createCliente, updateCliente, type CreateClientePayload } from "./api.ts";
import {
  cancelClienteForm,
  createAndNotify,
  createSubmissionGuard,
  canCreateCliente,
  canEditCliente,
  clienteToDraft,
  emptyClienteDraft,
  mapClienteCreateError,
  toUpdateClientePayload,
  toCreateClientePayload,
  updateAndNotify,
  validateClienteDraft,
} from "./clientes-form.ts";

const basePayload: CreateClientePayload = {
  nombre: "Cliente de prueba",
  razon_social: null,
  rfc: null,
  correo: null,
  telefono: null,
  activo: true,
};

const cliente = {
  id: "c19c8143-d70a-4f2b-a07b-fb7a4b7bb021",
  nombre: basePayload.nombre,
  razon_social: null,
  rfc: null,
  correo: null,
  telefono: null,
  activo: true,
  creado_en: "2026-11-25T12:00:00.000Z",
  actualizado_en: "2026-11-25T12:00:00.000Z",
};

describe("Formulario de clientes", () => {
  it("habilita el registro solo con el permiso clientes.crear", () => {
    assert.equal(canCreateCliente(["clientes.consultar", "clientes.crear"]), true);
    assert.equal(canCreateCliente(["clientes.consultar"]), false);
    assert.equal(canCreateCliente([]), false);
  });

  it("precarga los campos editables del cliente existente", () => {
    assert.deepEqual(clienteToDraft({ ...cliente, razon_social: "Carrocerías Norte", rfc: "ABC123456XY1", correo: "ventas@norte.mx", telefono: "555 0101", activo: false }), {
      nombre: cliente.nombre,
      razon_social: "Carrocerías Norte",
      rfc: "ABC123456XY1",
      correo: "ventas@norte.mx",
      telefono: "555 0101",
      activo: false,
    });
  });

  it("habilita Editar solo con clientes.editar", () => {
    assert.equal(canEditCliente(["clientes.consultar", "clientes.editar"]), true);
    assert.equal(canEditCliente(["clientes.consultar"]), false);
    assert.equal(canEditCliente([]), false);
  });

  it("requiere nombre y muestra error de correo específico", () => {
    const draft = emptyClienteDraft();
    assert.equal(validateClienteDraft(draft).nombre, "El nombre del cliente es obligatorio.");

    draft.nombre = "  Taller Norte  ";
    draft.correo = "no-es-correo";
    assert.equal(validateClienteDraft(draft).correo, "Escribe un correo válido, por ejemplo nombre@empresa.com.");

    draft.correo = "contacto@taller.mx";
    assert.deepEqual(validateClienteDraft(draft), {});
  });

  it("recorta textos opcionales, convierte vacíos a null y conserva activo", () => {
    const draft = emptyClienteDraft();
    draft.nombre = "  Taller Norte  ";
    draft.razon_social = " Carrocerías Norte SA de CV ";
    draft.rfc = "  ABC123456XY1 ";
    draft.correo = " contacto@taller.mx ";
    draft.telefono = " 555 0101 ";
    draft.activo = false;

    assert.deepEqual(toCreateClientePayload(draft), {
      nombre: "Taller Norte",
      razon_social: "Carrocerías Norte SA de CV",
      rfc: "ABC123456XY1",
      correo: "contacto@taller.mx",
      telefono: "555 0101",
      activo: false,
    });

    draft.razon_social = " ";
    draft.rfc = "";
    draft.correo = "";
    draft.telefono = "   ";
    assert.deepEqual(toCreateClientePayload(draft), { ...basePayload, nombre: "Taller Norte", activo: false });
  });

  it("mapea RFC duplicado al campo RFC", () => {
    const mapped = mapClienteCreateError(new ApiError("Ya existe un cliente con ese RFC.", 409, "duplicate_rfc"));
    assert.equal(mapped.status, 409);
    assert.equal(mapped.fieldErrors.rfc, "Este RFC ya está registrado.");
  });

  it("evita dos envíos simultáneos", async () => {
    const guard = createSubmissionGuard();
    let releaseOperation!: () => void;
    const operation = new Promise<void>((resolve) => { releaseOperation = resolve; });
    let sends = 0;
    const sendOnce = async () => {
      if (!guard.acquire()) return;
      try {
        sends += 1;
        await operation;
      } finally {
        guard.release();
      }
    };

    const first = sendOnce();
    const second = sendOnce();
    assert.equal(sends, 1);
    releaseOperation();
    await Promise.all([first, second]);
    assert.equal(sends, 1);
    assert.equal(guard.acquire(), true);
    guard.release();
  });

  it("notifica al directorio solo después de un registro exitoso", async () => {
    let refreshedWith = "";
    const result = await createAndNotify(async () => cliente, (created) => { refreshedWith = created.nombre; });
    assert.equal(result.id, cliente.id);
    assert.equal(refreshedWith, cliente.nombre);

    let calledAfterFailure = false;
    await assert.rejects(createAndNotify(async () => { throw new Error("falló"); }, () => { calledAfterFailure = true; }));
    assert.equal(calledAfterFailure, false);
  });

  it("genera un PATCH solo con los campos que cambiaron y omite un formulario sin cambios", () => {
    const original = { ...cliente, razon_social: "Carrocerías Norte", correo: "ventas@norte.mx" };
    const draft = clienteToDraft(original);
    assert.deepEqual(toUpdateClientePayload(draft, original), {});
    draft.nombre = "Cliente actualizado";
    draft.correo = "";
    assert.deepEqual(toUpdateClientePayload(draft, original), {
      nombre: "Cliente actualizado",
      correo: null,
    });
  });

  it("cancela el formulario sin ejecutar la operación de guardado", () => {
    let cancelled = false;
    const calls = { save: 0 };
    const formActions = {
      cancel: () => cancelClienteForm(() => { cancelled = true; }),
      submit: () => { calls.save += 1; },
    };
    formActions.cancel();
    assert.equal(cancelled, true);
    assert.equal(calls.save, 0);
  });

  it("refresca el directorio solo después de una edición exitosa", async () => {
    let refreshedWith = "";
    const updated = { ...cliente, nombre: "Cliente actualizado" };
    const result = await updateAndNotify(async () => updated, (saved) => { refreshedWith = saved.nombre; });
    assert.equal(result.nombre, "Cliente actualizado");
    assert.equal(refreshedWith, "Cliente actualizado");

    let calledAfterFailure = false;
    await assert.rejects(updateAndNotify(async () => { throw new Error("falló"); }, () => { calledAfterFailure = true; }));
    assert.equal(calledAfterFailure, false);
  });
});

describe("POST /api/clientes mediante proxy", () => {
  const originalFetch = globalThis.fetch;

  it("usa el proxy, envía bearer y solo los campos admitidos", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let authorization = "";
    let requestBody = "";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestMethod = init?.method ?? "GET";
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ data: cliente }), { status: 201, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      const created = await createCliente({ accessToken: "token-falso-de-prueba", payload: basePayload });
      assert.equal(created.id, cliente.id);
      assert.equal(requestUrl, "/backend-api/clientes");
      assert.equal(requestMethod, "POST");
      assert.equal(authorization, "Bearer token-falso-de-prueba");
      assert.deepEqual(JSON.parse(requestBody), basePayload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maneja 400, 401, 403, 409 y 503 sin hacer solicitudes reales", async () => {
    const cases = [
      { status: 400, code: "invalid_body", message: "El cuerpo debe ser un objeto JSON." },
      { status: 401, code: "invalid_token", message: "Autenticación requerida." },
      { status: 403, code: "permission_denied", message: "No tienes permiso para registrar clientes." },
      { status: 409, code: "duplicate_rfc", message: "Ya existe un cliente con ese RFC." },
      { status: 503, code: "service_unavailable", message: "Servicio temporalmente no disponible." },
    ];

    for (const testCase of cases) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: testCase.message, code: testCase.code }), {
        status: testCase.status,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
      try {
        await assert.rejects(
          createCliente({ accessToken: "token-falso-de-prueba", payload: basePayload }),
          (error: unknown) => error instanceof ApiError && error.status === testCase.status && error.code === testCase.code,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  it("traduce una falla de conexión sin perder el motivo del error", async () => {
    globalThis.fetch = (async () => { throw new TypeError("network unavailable"); }) as typeof fetch;
    try {
      await assert.rejects(
        createCliente({ accessToken: "token-falso-de-prueba", payload: basePayload }),
        (error: unknown) => error instanceof ApiError && error.status === 0 && error.message.includes("No fue posible confirmar el registro"),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("PATCH /api/clientes/:id mediante proxy", () => {
  const originalFetch = globalThis.fetch;

  it("envía el bearer y únicamente los cambios editables al cliente correcto", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let authorization = "";
    let requestBody = "";
    const updated = { ...cliente, nombre: "Cliente actualizado" };
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestMethod = init?.method ?? "GET";
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ data: updated }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      const saved = await updateCliente({
        accessToken: "token-falso-de-prueba",
        clienteId: cliente.id,
        payload: { nombre: "Cliente actualizado" },
      });
      assert.equal(saved.nombre, "Cliente actualizado");
      assert.equal(requestUrl, `/backend-api/clientes/${cliente.id}`);
      assert.equal(requestMethod, "PATCH");
      assert.equal(authorization, "Bearer token-falso-de-prueba");
      assert.deepEqual(JSON.parse(requestBody), { nombre: "Cliente actualizado" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maneja 400, 401, 403, 404, 409 y 503 sin llamadas reales", async () => {
    const cases = [400, 401, 403, 404, 409, 503].map((status) => ({
      status,
      code: status === 409 ? "duplicate_rfc" : `http_${status}`,
      message: status === 409 ? "Ya existe un cliente con ese RFC." : "Error de prueba.",
    }));

    for (const testCase of cases) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: testCase.message, code: testCase.code }), {
        status: testCase.status,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
      try {
        await assert.rejects(
          updateCliente({ accessToken: "token-falso-de-prueba", clienteId: cliente.id, payload: { nombre: "Editado" } }),
          (error: unknown) => error instanceof ApiError && error.status === testCase.status && error.code === testCase.code,
        );
        if (testCase.status === 409) {
          const mapped = mapClienteCreateError(new ApiError(testCase.message, testCase.status, testCase.code));
          assert.equal(mapped.fieldErrors.rfc, "Este RFC ya está registrado.");
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  it("no habilita editar sin permiso aunque la API mantenga el 403", async () => {
    assert.equal(canEditCliente(["clientes.consultar"]), false);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "No tienes permiso.", code: "permission_denied" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    try {
      await assert.rejects(
        updateCliente({ accessToken: "token-falso-de-prueba", clienteId: cliente.id, payload: { nombre: "Editado" } }),
        (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === "permission_denied",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
