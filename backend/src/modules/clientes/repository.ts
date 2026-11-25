import type { Pool, PoolClient, QueryResult } from "pg";
import { HttpError } from "../../errors.js";
import { withActorTransaction } from "../../services/actor-transaction.js";
import { getDatabasePool } from "../../services/database.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { ClienteCreateInput, ClienteUpdateInput } from "../../validations/index.js";
import type { ClienteListFilters, ClienteRecord, Page } from "../../types/business.js";

type SqlConnection = Pick<Pool, "query" | "connect">;
type SqlExecutor = Pick<PoolClient, "query">;
type ClienteRow = Omit<ClienteRecord, "creado_en" | "actualizado_en"> & {
  creado_en: Date | string;
  actualizado_en: Date | string;
};

const fields = ["nombre", "razon_social", "rfc", "correo", "telefono", "activo"] as const;
type EditableField = (typeof fields)[number];

const selectColumns = `id, nombre, razon_social, rfc, correo, telefono, activo, creado_en, actualizado_en`;

export class ClienteRepository {
  constructor(private readonly injectedPool?: SqlConnection) {}

  private pool(): SqlConnection {
    return this.injectedPool ?? getDatabasePool();
  }

  async list(filters: ClienteListFilters): Promise<Page<ClienteRecord>> {
    const pool = this.pool();
    const where: string[] = [];
    const values: unknown[] = [];
    if (filters.q) {
      values.push(filters.q.toLocaleLowerCase("es-MX"));
      where.push(`position($${values.length} in lower(concat_ws(' ', nombre, razon_social, rfc, correo, telefono))) > 0`);
    }
    if (filters.activo !== null) {
      values.push(filters.activo);
      where.push(`activo = $${values.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM public.clientes ${whereSql}`,
      values,
    );
    const rows = await pool.query<ClienteRow>(
      `SELECT ${selectColumns} FROM public.clientes ${whereSql}
       ORDER BY lower(nombre), id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, filters.offset],
    );
    return {
      data: rows.rows,
      limit: filters.limit,
      offset: filters.offset,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async getById(id: string): Promise<ClienteRecord | null> {
    const result = await this.pool().query<ClienteRow>(
      `SELECT ${selectColumns} FROM public.clientes WHERE id = $1::uuid`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async create(input: ClienteCreateInput, actor: AuthenticatedUser): Promise<ClienteRecord> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      if (input.rfc) await this.assertRfcAvailable(client, input.rfc);
      const result = await client.query<ClienteRow>(
        `INSERT INTO public.clientes (nombre, razon_social, rfc, correo, telefono, activo)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${selectColumns}`,
        [input.nombre, input.razon_social ?? null, input.rfc ?? null, input.correo ?? null, input.telefono ?? null, input.activo ?? true],
      );
      return result.rows[0];
    }, pool);
  }

  async update(id: string, input: ClienteUpdateInput, actor: AuthenticatedUser): Promise<ClienteRecord | null> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const existing = await client.query<ClienteRow>(
        `SELECT ${selectColumns} FROM public.clientes WHERE id = $1::uuid FOR UPDATE`,
        [id],
      );
      const current = existing.rows[0];
      if (!current) return null;

      const changes = fields.filter((field) => Object.hasOwn(input, field) && input[field] !== current[field]);
      if (changes.length === 0) return current;
      if (Object.hasOwn(input, "rfc") && input.rfc) await this.assertRfcAvailable(client, input.rfc, id);

      const assignments = changes.map((field, index) => `${field} = $${index + 1}`);
      const values = changes.map((field) => input[field]);
      values.push(id);
      const result = await client.query<ClienteRow>(
        `UPDATE public.clientes SET ${assignments.join(", ")}, actualizado_en = clock_timestamp()
         WHERE id = $${values.length}::uuid RETURNING ${selectColumns}`,
        values,
      );
      return result.rows[0] ?? null;
    }, pool);
  }

  private async assertRfcAvailable(executor: SqlExecutor, rfc: string, excludeId?: string): Promise<void> {
    const normalized = rfc.trim().toLocaleLowerCase("es-MX");
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`cliente:rfc:${normalized}`]);
    const result: QueryResult<{ id: string }> = await executor.query(
      `SELECT id FROM public.clientes
       WHERE rfc IS NOT NULL AND lower(btrim(rfc)) = $1
         AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [normalized, excludeId ?? null],
    );
    if (result.rows.length > 0) {
      throw new HttpError(409, "Ya existe un cliente con ese RFC.", "duplicate_rfc");
    }
  }
}
