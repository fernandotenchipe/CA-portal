import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError, publicDatabaseError } from "../dist/errors.js";
import { DocumentoRepository } from "../dist/modules/documentos/repository.js";
import { TrabajoRepository } from "../dist/modules/documentos/trabajos-repository.js";

const actor = { id: "b0d673b0-c76b-4ca1-96c2-b053fce62eca", nombre: "Operador", rol: { codigo: "LOGISTICA", nombre: "Logística" }, permisos: [] };
const docId = "e1e96de7-4821-4527-9ff8-6776793a91db";
const unitId = "c19c8143-d70a-4f2b-a07b-fb7a4b7bb021";
const clientId = "52e7eb99-1ff0-49e6-aa5e-6f65ca143dd4";
const workId = "d7d0f55e-1bc8-4cb8-a937-44eac9eb6594";
const documentRow = { id: docId, folio_fisico: "AB-001", folio_fisico_normalizado: "AB-001", unidad_id: unitId, cliente_id: clientId, cliente_nombre: "Taller", numero_serie: "SERIE1", estado_trabajo: "en_construccion", finalizado_en: null, observaciones: null, fecha_documento: null, creado_en: new Date(0), actualizado_en: new Date(0), cancelado_en: null };
const workRow = { id: workId, documento_corto_id: docId, numero_orden: 4, descripcion: "Reparar caja", estado: "en_construccion", finalizado_en: null, cantidad: "2.500", unidad_medida: "piezas", precio_unitario: "100.25", importe: "250.63", observaciones: null, creado_en: new Date(0), actualizado_en: new Date(0), eliminado_en: null };

function poolWithHandler(handler) {
  const log = [];
  let releaseCount = 0;
  const client = {
    async query(sql, values = []) {
      const entry = { sql: String(sql), values };
      log.push(entry);
      return handler(entry.sql, values);
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

describe("Repositorios de hojas y trabajos con transacción auditada", () => {
  it("crea una hoja con la unidad/cliente correcto y deja reservas y auditoría al trigger", async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes("SELECT cliente_id FROM public.unidades")) return { rows: [{ cliente_id: clientId }] };
      if (sql.includes("INSERT INTO public.documentos_cortos")) return { rows: [{ id: docId }] };
      if (sql.includes("SELECT d.id") && sql.includes("WHERE d.id = $1::uuid")) return { rows: [documentRow] };
      return { rows: [] };
    });
    const result = await new DocumentoRepository(pool).create({ folio_fisico: "AB - 001", unidad_id: unitId, cliente_id: clientId }, actor);
    assert.equal(result.id, docId);
    const actorIndex = pool.log.findIndex(({ sql }) => sql.includes("set_config('app.actor_tipo'"));
    const insertIndex = pool.log.findIndex(({ sql }) => sql.includes("INSERT INTO public.documentos_cortos"));
    assert.ok(actorIndex >= 0 && actorIndex < insertIndex);
    assert.equal(pool.log[actorIndex].values[0], actor.id);
    assert.equal(pool.log.some(({ sql }) => sql.includes("INSERT INTO public.folios_fisicos_reservados")), false);
    assert.equal(pool.log.some(({ sql }) => sql.includes("INSERT INTO public.auditoria")), false);
    assert.equal(pool.log.at(-2).sql, "COMMIT");
    assert.equal(pool.releaseCount, 1);
  });

  it("rechaza discrepancia cliente-unidad y revierte antes de insertar", async () => {
    const pool = poolWithHandler((sql) => sql.includes("SELECT cliente_id FROM public.unidades") ? { rows: [{ cliente_id: "otro-cliente" }] } : { rows: [] });
    await assert.rejects(new DocumentoRepository(pool).create({ folio_fisico: "A-1", unidad_id: unitId, cliente_id: clientId }, actor),
      (error) => error instanceof HttpError && error.status === 409 && error.code === "unit_customer_mismatch");
    assert.equal(pool.log.some(({ sql }) => sql.includes("INSERT INTO public.documentos_cortos")), false);
    assert.equal(pool.log.at(-2).sql, "ROLLBACK");
    assert.equal(pool.releaseCount, 1);
  });

  it("corrige el folio solo mediante UPDATE de la hoja para que el trigger reserve el histórico", async () => {
    let current = { ...documentRow, estado_trabajo: "finalizado", finalizado_en: new Date(1) };
    const pool = poolWithHandler((sql, values) => {
      if (sql.includes("SELECT d.id") && sql.includes("FOR UPDATE OF d")) return { rows: [current] };
      if (sql.includes("UPDATE public.documentos_cortos")) {
        current = { ...current, folio_fisico: values[0], folio_fisico_normalizado: values[0].replace(/\s+/g, "").toUpperCase() };
        return { rows: [] };
      }
      if (sql.includes("SELECT d.id") && sql.includes("WHERE d.id = $1::uuid")) return { rows: [current] };
      return { rows: [] };
    });
    const result = await new DocumentoRepository(pool).update(docId, { folio_fisico: "AB - 002" }, actor);
    assert.equal(result.folio_fisico, "AB - 002");
    const update = pool.log.find(({ sql }) => sql.includes("UPDATE public.documentos_cortos"));
    assert.match(update.sql, /folio_fisico = \$1/);
    assert.equal(pool.log.some(({ sql }) => sql.includes("UPDATE public.folios_fisicos_reservados")), false);
    assert.equal(pool.log.some(({ sql }) => sql.includes("INSERT INTO public.folios_fisicos_reservados")), false);
    assert.equal(pool.log.at(-2).sql, "COMMIT");
  });

  it("mantiene de consulta hojas finalizadas/canceladas salvo corrección de folio", async () => {
    for (const current of [
      { ...documentRow, estado_trabajo: "finalizado", finalizado_en: new Date(1) },
      { ...documentRow, cancelado_en: new Date(1) },
    ]) {
      const pool = poolWithHandler((sql) => sql.includes("SELECT d.id") && sql.includes("FOR UPDATE OF d") ? { rows: [current] } : { rows: [] });
      await assert.rejects(new DocumentoRepository(pool).update(docId, { observaciones: "Cambio ordinario" }, actor),
        (error) => error instanceof HttpError && error.status === 409 && error.code === "document_read_only");
      assert.equal(pool.log.some(({ sql }) => sql.includes("UPDATE public.documentos_cortos")), false);
      assert.equal(pool.log.at(-2).sql, "ROLLBACK");
    }
  });

  it("bloquea hoja y asigna finalización en PostgreSQL sin revisar ni exigir trabajos", async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes("SELECT d.id") && sql.includes("FOR UPDATE OF d")) return { rows: [documentRow] };
      if (sql.includes("UPDATE public.documentos_cortos")) return { rows: [] };
      if (sql.includes("SELECT d.id") && sql.includes("WHERE d.id = $1::uuid")) return { rows: [{ ...documentRow, estado_trabajo: "finalizado", finalizado_en: new Date(1) }] };
      return { rows: [] };
    });
    const result = await new DocumentoRepository(pool).finalize(docId, actor);
    assert.equal(result.estado_trabajo, "finalizado");
    assert.equal(pool.log.some(({ sql }) => sql.includes("FROM public.trabajos")), false);
    assert.equal(pool.log.some(({ sql }) => sql.includes("set_config('app.actor_tipo'")), true);
    assert.equal(pool.log.some(({ sql }) => sql.includes("UPDATE public.documentos_cortos SET estado_trabajo = 'finalizado'")), true);
  });

  it("traduce duplicados de folios reservados y orden único a 409", () => {
    const folio = publicDatabaseError({ code: "23505", constraint: "folios_reservados_normalizado_uq" });
    assert.equal(folio.status, 409);
    assert.equal(folio.code, "physical_folio_reserved");
    const order = publicDatabaseError({ code: "23505", constraint: "trabajos_orden_documento_uq" });
    assert.equal(order.status, 409);
    assert.equal(order.code, "work_order_conflict");
  });

  it("asigna orden incremental bajo bloqueo de hoja y deja la auditoría al trigger", async () => {
    let insertedValues;
    const pool = poolWithHandler((sql, values) => {
      if (sql.includes("SELECT estado_trabajo, cancelado_en")) return { rows: [{ estado_trabajo: "en_construccion", cancelado_en: null }] };
      if (sql.includes("coalesce(max(numero_orden)")) return { rows: [{ numero_orden: 5 }] };
      if (sql.includes("INSERT INTO public.trabajos")) { insertedValues = values; return { rows: [{ id: workId }] }; }
      if (sql.includes("SELECT id, documento_corto_id") && sql.includes("eliminado_en")) return { rows: [workRow] };
      return { rows: [] };
    });
    const created = await new TrabajoRepository(pool).create(docId, { descripcion: "Instalar puertas", cantidad: 2, precio_unitario: 0 }, actor);
    assert.equal(created.numero_orden, 4);
    assert.equal(insertedValues[1], 5);
    assert.equal(pool.log.findIndex(({ sql }) => sql.includes("set_config('app.actor_tipo'")) < pool.log.findIndex(({ sql }) => sql.includes("INSERT INTO public.trabajos")), true);
    assert.equal(pool.log.some(({ sql }) => sql.includes("INSERT INTO public.auditoria")), false);
    assert.equal(pool.log.at(-2).sql, "COMMIT");
  });

  it("no edita trabajo finalizado o contenido bajo hoja finalizada", async () => {
    for (const documentState of ["finalizado", "en_construccion"]) {
      const pool = poolWithHandler((sql) => {
        if (sql.startsWith("SELECT documento_corto_id")) return { rows: [{ documento_corto_id: docId, eliminado_en: null }] };
        if (sql.includes("SELECT estado_trabajo, cancelado_en")) return { rows: [{ estado_trabajo: documentState, cancelado_en: null }] };
        if (sql.includes("SELECT id, documento_corto_id") && sql.includes("eliminado_en")) return { rows: [{ ...workRow, estado: "finalizado" }] };
        return { rows: [] };
      });
      await assert.rejects(new TrabajoRepository(pool).update(workId, { descripcion: "Cambiar" }, actor), (error) => error instanceof HttpError && error.status === 409);
      assert.equal(pool.log.some(({ sql }) => sql.includes("UPDATE public.trabajos")), false);
      assert.equal(pool.log.at(-2).sql, "ROLLBACK");
    }
  });

  it("permite únicamente finalizar el hijo pendiente bajo hoja finalizada", async () => {
    let updated = false;
    const pool = poolWithHandler((sql) => {
      if (sql.startsWith("SELECT documento_corto_id")) return { rows: [{ documento_corto_id: docId, eliminado_en: null }] };
      if (sql.includes("SELECT estado_trabajo, cancelado_en")) return { rows: [{ estado_trabajo: "finalizado", cancelado_en: null }] };
      if (sql.includes("SELECT id, documento_corto_id") && sql.includes("eliminado_en")) return { rows: [{ ...workRow, estado: updated ? "finalizado" : "en_construccion" }] };
      if (sql.includes("UPDATE public.trabajos SET estado = 'finalizado'")) { updated = true; return { rows: [] }; }
      return { rows: [] };
    });
    const result = await new TrabajoRepository(pool).finalize(workId, actor);
    assert.equal(result.estado, "finalizado");
    const update = pool.log.find(({ sql }) => sql.includes("UPDATE public.trabajos SET estado = 'finalizado'"));
    assert.ok(update);
    assert.equal(update.sql.includes("descripcion ="), false);
    assert.equal(update.sql.includes("finalizado_por"), false);
    assert.equal(update.sql.includes("finalizado_en"), false);
    assert.equal(pool.log.some(({ sql }) => sql.includes("set_config('app.actor_tipo'")), true);
    assert.equal(pool.log.at(-2).sql, "COMMIT");
  });
});
