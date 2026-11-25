import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../dist/errors.js";
import { ClienteRepository } from "../dist/modules/clientes/repository.js";
import { UnidadRepository } from "../dist/modules/unidades/repository.js";

const actor = {
  id: "b0d673b0-c76b-4ca1-96c2-b053fce62eca",
  nombre: "Administración de prueba",
  rol: { codigo: "ADMINISTRACION", nombre: "Administración" },
  permisos: ["clientes.crear", "clientes.editar", "unidades.crear", "unidades.editar"],
};
const clientId = "c19c8143-d70a-4f2b-a07b-fb7a4b7bb021";
const unitId = "e1e96de7-4821-4527-9ff8-6776793a91db";

function poolWithHandler(handler) {
  const log = [];
  let releaseCount = 0;
  const client = {
    async query(sql, values = []) {
      log.push({ sql: String(sql), values });
      return handler(String(sql), values);
    },
    release(error) { log.push({ sql: "RELEASE", values: [error] }); releaseCount += 1; },
  };
  return {
    log,
    get releaseCount() { return releaseCount; },
    async query(sql, values = []) { log.push({ sql: String(sql), values }); return handler(String(sql), values); },
    async connect() { return client; },
  };
}

const clientRow = {
  id: clientId, nombre: "Cliente Uno", razon_social: null, rfc: null, correo: null,
  telefono: null, activo: true, creado_en: new Date(0), actualizado_en: new Date(0),
};

describe("Business repositories use actor transactions", () => {
  it("records customer updates with the authenticated actor and skips no-op writes", async () => {
    const updatedRow = { ...clientRow, nombre: "Cliente Dos" };
    const pool = poolWithHandler((sql) => {
      if (sql.includes("SELECT id, nombre, razon_social")) return { rows: [clientRow] };
      if (sql.includes("UPDATE public.clientes")) return { rows: [updatedRow] };
      return { rows: [] };
    });
    const repository = new ClienteRepository(pool);

    const updated = await repository.update(clientId, { nombre: "Cliente Dos" }, actor);
    assert.equal(updated.nombre, "Cliente Dos");
    const actorContext = pool.log.find((entry) => entry.sql.includes("set_config('app.actor_tipo'"));
    assert.deepEqual(actorContext.values, [actor.id]);
    assert.equal(pool.log.some((entry) => entry.sql.includes("UPDATE public.clientes")), true);
    assert.equal(pool.log.at(-2).sql, "COMMIT");
    assert.equal(pool.releaseCount, 1);

    const noOpPool = poolWithHandler((sql) => sql.includes("SELECT id, nombre, razon_social") ? { rows: [clientRow] } : { rows: [] });
    const noOp = await new ClienteRepository(noOpPool).update(clientId, { nombre: "Cliente Uno" }, actor);
    assert.equal(noOp.nombre, "Cliente Uno");
    assert.equal(noOpPool.log.some((entry) => entry.sql.includes("UPDATE public.clientes")), false);
  });

  it("checks the supplied customer RFC under a transaction lock before inserting", async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes("SELECT id FROM public.clientes") && sql.includes("lower(btrim(rfc))")) return { rows: [{ id: clientId }] };
      return { rows: [] };
    });
    await assert.rejects(
      new ClienteRepository(pool).create({ nombre: "Otro", rfc: "RFC123" }, actor),
      (error) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(pool.log.some((entry) => entry.sql.includes("pg_advisory_xact_lock")), true);
    assert.equal(pool.log.some((entry) => entry.sql.includes("INSERT INTO public.clientes")), false);
    assert.equal(pool.log.at(-2).sql, "ROLLBACK");
    assert.equal(pool.log.find((entry) => entry.sql.includes("set_config('app.actor_tipo'")).values[0], actor.id);
    assert.equal(pool.releaseCount, 1);
  });

  it("creates a unit linked to an existing client and sets the actor before the insert", async () => {
    const unitRow = {
      id: unitId, cliente_id: clientId, numero_serie: "CA901", marca: null, modelo: null,
      anio: null, placas: null, activo: true, creado_en: new Date(0), actualizado_en: new Date(0),
    };
    const pool = poolWithHandler((sql) => {
      if (sql.includes("SELECT id FROM public.clientes")) return { rows: [{ id: clientId }] };
      if (sql.includes("SELECT id FROM public.unidades")) return { rows: [] };
      if (sql.includes("INSERT INTO public.unidades")) return { rows: [unitRow] };
      if (sql.includes("SELECT nombre FROM public.clientes")) return { rows: [{ nombre: "Cliente Uno" }] };
      return { rows: [] };
    });
    const result = await new UnidadRepository(pool).create({ cliente_id: clientId, numero_serie: "CA901" }, actor);
    assert.equal(result.cliente_nombre, "Cliente Uno");
    const actorIndex = pool.log.findIndex((entry) => entry.sql.includes("set_config('app.actor_tipo'"));
    const insertIndex = pool.log.findIndex((entry) => entry.sql.includes("INSERT INTO public.unidades"));
    assert.ok(actorIndex >= 0 && actorIndex < insertIndex);
    assert.deepEqual(pool.log[actorIndex].values, [actor.id]);
    assert.equal(pool.log.at(-2).sql, "COMMIT");
    assert.equal(pool.releaseCount, 1);
  });

  it("refuses duplicate unit serials before insert and rolls back", async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes("SELECT id FROM public.clientes")) return { rows: [{ id: clientId }] };
      if (sql.includes("SELECT id FROM public.unidades")) return { rows: [{ id: unitId }] };
      return { rows: [] };
    });
    await assert.rejects(
      new UnidadRepository(pool).create({ cliente_id: clientId, numero_serie: "CA901" }, actor),
      (error) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(pool.log.some((entry) => entry.sql.includes("INSERT INTO public.unidades")), false);
    assert.equal(pool.log.at(-2).sql, "ROLLBACK");
    assert.equal(pool.releaseCount, 1);
  });
});
