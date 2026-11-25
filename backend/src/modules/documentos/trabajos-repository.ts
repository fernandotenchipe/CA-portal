import type { Pool, PoolClient } from "pg";
import { HttpError } from "../../errors.js";
import { withActorTransaction } from "../../services/actor-transaction.js";
import { getDatabasePool } from "../../services/database.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { TrabajoRecord } from "../../types/business.js";
import type { TrabajoCreateInput, TrabajoUpdateInput } from "../../validations/index.js";

type SqlConnection = Pick<Pool, "query" | "connect">;
type SqlExecutor = Pick<PoolClient, "query">;
const selectColumns = `id, documento_corto_id, numero_orden, descripcion, estado, finalizado_en,
  cantidad::text AS cantidad, unidad_medida, precio_unitario::text AS precio_unitario,
  importe::text AS importe, observaciones, creado_en, actualizado_en`;
type TrabajoRow = TrabajoRecord & { eliminado_en: Date | string | null };
const editableFields = ["descripcion", "cantidad", "unidad_medida", "precio_unitario", "observaciones"] as const;

export class TrabajoRepository {
  constructor(private readonly injectedPool?: SqlConnection) {}

  private pool(): SqlConnection { return this.injectedPool ?? getDatabasePool(); }

  async listByDocument(documentId: string): Promise<TrabajoRecord[]> {
    const result = await this.pool().query<TrabajoRecord>(
      `SELECT ${selectColumns} FROM public.trabajos
       WHERE documento_corto_id = $1::uuid AND eliminado_en IS NULL
       ORDER BY numero_orden, id`, [documentId],
    );
    return result.rows;
  }

  async create(documentId: string, input: TrabajoCreateInput, actor: AuthenticatedUser): Promise<TrabajoRecord> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      await this.lockEditableDocument(client, documentId);
      const nextOrder = await client.query<{ numero_orden: number }>(
        `SELECT coalesce(max(numero_orden), 0) + 1 AS numero_orden
         FROM public.trabajos WHERE documento_corto_id = $1::uuid`, [documentId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.trabajos
          (documento_corto_id, numero_orden, descripcion, cantidad, unidad_medida, precio_unitario, observaciones)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [documentId, nextOrder.rows[0].numero_orden, input.descripcion, input.cantidad ?? null,
          input.unidad_medida ?? null, input.precio_unitario ?? null, input.observaciones ?? null],
      );
      const created = await this.getByIdOn(client, inserted.rows[0].id);
      if (!created) throw new Error("El trabajo insertado no pudo consultarse dentro de su transacción.");
      return this.toRecord(created);
    }, pool);
  }

  async update(id: string, input: TrabajoUpdateInput, actor: AuthenticatedUser): Promise<TrabajoRecord | null> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const documentId = await this.findParentId(client, id);
      if (!documentId) return null;
      const document = await this.lockDocument(client, documentId);
      const current = await this.getByIdOn(client, id, true);
      if (!current || current.eliminado_en) return null;
      this.assertNotCanceled(document);
      if (document.estado_trabajo !== "en_construccion") {
        throw new HttpError(409, "La hoja está finalizada; los trabajos solo pueden finalizarse.", "document_read_only");
      }
      if (current.estado !== "en_construccion") {
        throw new HttpError(409, "El trabajo está finalizado y solo puede consultarse.", "work_read_only");
      }

      const changes = editableFields.filter((field) => Object.hasOwn(input, field)
        && !this.valuesEqual(field, input[field], current[field]));
      if (!changes.length) return this.toRecord(current);
      const assignments = changes.map((field, index) => `${field} = $${index + 1}`);
      const values = changes.map((field) => input[field]);
      values.push(id);
      await client.query(
        `UPDATE public.trabajos SET ${assignments.join(", ")}, actualizado_en = clock_timestamp()
         WHERE id = $${values.length}::uuid`, values,
      );
      const updated = await this.getByIdOn(client, id);
      return updated ? this.toRecord(updated) : null;
    }, pool);
  }

  async finalize(id: string, actor: AuthenticatedUser): Promise<TrabajoRecord | null> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const documentId = await this.findParentId(client, id);
      if (!documentId) return null;
      const document = await this.lockDocument(client, documentId);
      const current = await this.getByIdOn(client, id, true);
      if (!current || current.eliminado_en) return null;
      this.assertNotCanceled(document);
      if (current.estado === "finalizado") return this.toRecord(current);
      await client.query(
        `UPDATE public.trabajos SET estado = 'finalizado', actualizado_en = clock_timestamp()
         WHERE id = $1::uuid`, [id],
      );
      const updated = await this.getByIdOn(client, id);
      return updated ? this.toRecord(updated) : null;
    }, pool);
  }

  private async lockEditableDocument(executor: SqlExecutor, documentId: string): Promise<{ estado_trabajo: string; cancelado_en: Date | string | null }> {
    const document = await this.lockDocument(executor, documentId);
    this.assertNotCanceled(document);
    if (document.estado_trabajo !== "en_construccion") {
      throw new HttpError(409, "No se pueden agregar trabajos a una hoja finalizada.", "document_read_only");
    }
    return document;
  }

  private async lockDocument(executor: SqlExecutor, documentId: string) {
    const result = await executor.query<{ estado_trabajo: string; cancelado_en: Date | string | null }>(
      `SELECT estado_trabajo, cancelado_en FROM public.documentos_cortos
       WHERE id = $1::uuid FOR UPDATE`, [documentId],
    );
    if (!result.rows[0]) throw new HttpError(404, "No existe la hoja de trabajo indicada.", "document_not_found");
    return result.rows[0];
  }

  private assertNotCanceled(document: { cancelado_en: Date | string | null }): void {
    if (document.cancelado_en !== null) throw new HttpError(409, "La hoja está cancelada y sus trabajos no se pueden modificar.", "document_canceled");
  }

  private async findParentId(executor: SqlExecutor, id: string): Promise<string | null> {
    const result = await executor.query<{ documento_corto_id: string; eliminado_en: Date | string | null }>(
      "SELECT documento_corto_id, eliminado_en FROM public.trabajos WHERE id = $1::uuid", [id],
    );
    return result.rows[0] && result.rows[0].eliminado_en === null ? result.rows[0].documento_corto_id : null;
  }

  private async getByIdOn(executor: SqlExecutor, id: string, forUpdate = false): Promise<TrabajoRow | null> {
    const result = await executor.query<TrabajoRow>(
      `SELECT ${selectColumns}, eliminado_en FROM public.trabajos
       WHERE id = $1::uuid${forUpdate ? " FOR UPDATE" : ""}`, [id],
    );
    return result.rows[0] ?? null;
  }

  private valuesEqual(field: typeof editableFields[number], inputValue: unknown, currentValue: unknown): boolean {
    if ((field === "cantidad" || field === "precio_unitario") && inputValue !== null && currentValue !== null) {
      return Number(inputValue) === Number(currentValue);
    }
    return inputValue === currentValue;
  }

  private toRecord(row: TrabajoRow): TrabajoRecord {
    const { eliminado_en: _eliminadoEn, ...record } = row;
    void _eliminadoEn;
    return record;
  }
}
