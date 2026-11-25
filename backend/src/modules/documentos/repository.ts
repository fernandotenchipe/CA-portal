import type { Pool, PoolClient } from "pg";
import { HttpError } from "../../errors.js";
import { withActorTransaction } from "../../services/actor-transaction.js";
import { getDatabasePool } from "../../services/database.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { DocumentoCortoRecord, DocumentoListFilters, Page } from "../../types/business.js";
import type { DocumentoCreateInput, DocumentoUpdateInput } from "../../validations/index.js";

type SqlConnection = Pick<Pool, "query" | "connect">;
type SqlExecutor = Pick<PoolClient, "query">;
type DocumentoRow = DocumentoCortoRecord;

const selectColumns = `d.id, d.folio_fisico, d.folio_fisico_normalizado, d.unidad_id,
  u.cliente_id, c.nombre AS cliente_nombre, u.numero_serie, d.estado_trabajo,
  d.finalizado_en, d.observaciones, d.fecha_documento, d.creado_en,
  d.actualizado_en, d.cancelado_en`;
const joinSql = `FROM public.documentos_cortos d
  JOIN public.unidades u ON u.id = d.unidad_id
  JOIN public.clientes c ON c.id = u.cliente_id`;
const editableFields = ["folio_fisico", "unidad_id", "observaciones", "fecha_documento"] as const;

export class DocumentoRepository {
  constructor(private readonly injectedPool?: SqlConnection) {}

  private pool(): SqlConnection { return this.injectedPool ?? getDatabasePool(); }

  async list(filters: DocumentoListFilters): Promise<Page<DocumentoCortoRecord>> {
    const pool = this.pool();
    const where: string[] = [];
    const values: unknown[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (filters.folio_fisico) {
      const parameter = bind(filters.folio_fisico);
      where.push(`EXISTS (SELECT 1 FROM public.folios_fisicos_reservados fr
        WHERE fr.documento_corto_id = d.id AND fr.folio_normalizado = ${parameter})`);
    }
    if (filters.q) {
      const textParameter = bind(filters.q.toLocaleLowerCase("es-MX"));
      const folioParameter = bind(filters.q.replace(/\s+/gu, "").toLocaleUpperCase("es-MX"));
      where.push(`(position(${folioParameter} in d.folio_fisico_normalizado) > 0
        OR position(${textParameter} in lower(concat_ws(' ', u.numero_serie, c.nombre, u.marca, u.modelo))) > 0)`);
    }
    if (filters.cliente_id) where.push(`c.id = ${bind(filters.cliente_id)}::uuid`);
    if (filters.unidad_id) where.push(`d.unidad_id = ${bind(filters.unidad_id)}::uuid`);
    if (filters.estado_trabajo) where.push(`d.estado_trabajo = ${bind(filters.estado_trabajo)}`);
    if (filters.cancelada !== null) where.push(`(d.cancelado_en IS NOT NULL) = ${bind(filters.cancelada)}`);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await pool.query<{ total: string }>(`SELECT count(*)::text AS total ${joinSql} ${whereSql}`, values);
    const rows = await pool.query<DocumentoRow>(
      `SELECT ${selectColumns} ${joinSql} ${whereSql}
       ORDER BY d.creado_en DESC, d.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, filters.offset],
    );
    return { data: rows.rows, limit: filters.limit, offset: filters.offset, total: Number(count.rows[0]?.total ?? 0) };
  }

  async getById(id: string): Promise<DocumentoCortoRecord | null> {
    return this.getByIdOn(this.pool(), id);
  }

  async create(input: DocumentoCreateInput, actor: AuthenticatedUser): Promise<DocumentoCortoRecord> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      await this.assertUnitRelation(client, input.unidad_id, input.cliente_id);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.documentos_cortos
          (folio_fisico, unidad_id, observaciones, fecha_documento, creado_por)
         VALUES ($1, $2::uuid, $3, $4::date, $5::uuid) RETURNING id`,
        [input.folio_fisico, input.unidad_id, input.observaciones ?? null, input.fecha_documento ?? null, actor.id],
      );
      const created = await this.getByIdOn(client, inserted.rows[0].id);
      if (!created) throw new Error("La hoja insertada no pudo consultarse dentro de su transacción.");
      return created;
    }, pool);
  }

  async update(id: string, input: DocumentoUpdateInput, actor: AuthenticatedUser): Promise<DocumentoCortoRecord | null> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const locked = await client.query<DocumentoRow>(
        `SELECT ${selectColumns} ${joinSql} WHERE d.id = $1::uuid FOR UPDATE OF d`, [id],
      );
      const current = locked.rows[0];
      if (!current) return null;
      if (Object.hasOwn(input, "cliente_id")) {
        await this.assertUnitRelation(client, input.unidad_id ?? current.unidad_id, input.cliente_id);
      } else if (Object.hasOwn(input, "unidad_id")) {
        await this.assertUnitRelation(client, input.unidad_id!);
      }

      const changes = editableFields.filter((field) => Object.hasOwn(input, field) && input[field] !== current[field]);
      const effectiveChanges = changes.filter((field) => field !== "folio_fisico"
        || (input.folio_fisico as string).replace(/\s+/gu, "").toUpperCase() !== current.folio_fisico_normalizado);
      if (effectiveChanges.length === 0) return current;
      const folioOnly = effectiveChanges.every((field) => field === "folio_fisico");
      if ((current.estado_trabajo === "finalizado" || current.cancelado_en !== null) && !folioOnly) {
        throw new HttpError(409, "La hoja está finalizada o cancelada; solo se permite corregir su folio.", "document_read_only");
      }

      const assignments = effectiveChanges.map((field, index) => `${field} = $${index + 1}${field === "unidad_id" ? "::uuid" : field === "fecha_documento" ? "::date" : ""}`);
      const values = effectiveChanges.map((field) => input[field]);
      values.push(id);
      await client.query(
        `UPDATE public.documentos_cortos SET ${assignments.join(", ")}, actualizado_en = clock_timestamp()
         WHERE id = $${values.length}::uuid`, values,
      );
      return this.getByIdOn(client, id);
    }, pool);
  }

  async finalize(id: string, actor: AuthenticatedUser): Promise<DocumentoCortoRecord | null> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const current = await client.query<DocumentoRow>(
        `SELECT ${selectColumns} ${joinSql} WHERE d.id = $1::uuid FOR UPDATE OF d`, [id],
      );
      const document = current.rows[0];
      if (!document) return null;
      if (document.cancelado_en !== null) throw new HttpError(409, "No se puede finalizar una hoja cancelada.", "document_canceled");
      if (document.estado_trabajo === "finalizado") return document;
      await client.query(
        "UPDATE public.documentos_cortos SET estado_trabajo = 'finalizado', actualizado_en = clock_timestamp() WHERE id = $1::uuid",
        [id],
      );
      return this.getByIdOn(client, id);
    }, pool);
  }

  private async assertUnitRelation(executor: SqlExecutor, unitId: string, clientId?: string): Promise<void> {
    const result = await executor.query<{ cliente_id: string }>(
      `SELECT cliente_id FROM public.unidades WHERE id = $1::uuid FOR SHARE`, [unitId],
    );
    if (!result.rows[0]) throw new HttpError(404, "No existe la unidad indicada.", "unit_not_found");
    if (clientId && result.rows[0].cliente_id !== clientId) {
      throw new HttpError(409, "La unidad no pertenece al cliente indicado.", "unit_customer_mismatch");
    }
  }

  private async getByIdOn(executor: SqlExecutor, id: string): Promise<DocumentoCortoRecord | null> {
    const result = await executor.query<DocumentoRow>(
      `SELECT ${selectColumns} ${joinSql} WHERE d.id = $1::uuid`, [id],
    );
    return result.rows[0] ?? null;
  }
}
