import type { Pool, PoolClient } from "pg";
import { HttpError } from "../../errors.js";
import { withActorTransaction } from "../../services/actor-transaction.js";
import { getDatabasePool } from "../../services/database.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { Page, UnidadListFilters, UnidadRecord } from "../../types/business.js";
import type { UnidadCreateInput, UnidadUpdateInput } from "../../validations/index.js";

type SqlConnection = Pick<Pool, "query" | "connect">;
type UnidadRow = UnidadRecord;

const selectColumns = `u.id, u.cliente_id, c.nombre AS cliente_nombre, u.numero_serie,
  u.marca, u.modelo, u.anio, u.placas, u.activo, u.creado_en, u.actualizado_en`;
const editableFields = ["numero_serie", "marca", "modelo", "anio", "placas", "activo"] as const;
type EditableField = (typeof editableFields)[number];

export class UnidadRepository {
  constructor(private readonly injectedPool?: SqlConnection) {}

  private pool(): SqlConnection {
    return this.injectedPool ?? getDatabasePool();
  }

  async list(filters: UnidadListFilters): Promise<Page<UnidadRecord>> {
    const pool = this.pool();
    const where: string[] = [];
    const values: unknown[] = [];
    if (filters.cliente_id) {
      values.push(filters.cliente_id);
      where.push(`u.cliente_id = $${values.length}::uuid`);
    }
    if (filters.numero_serie) {
      values.push(filters.numero_serie);
      where.push(`u.numero_serie = $${values.length}`);
    } else if (filters.q) {
      values.push(filters.q.toLocaleLowerCase("es-MX"));
      where.push(`position($${values.length} in lower(concat_ws(' ', u.numero_serie, u.marca, u.modelo, u.placas, c.nombre))) > 0`);
    }
    if (filters.activo !== null) {
      values.push(filters.activo);
      where.push(`u.activo = $${values.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const fromSql = `FROM public.unidades u JOIN public.clientes c ON c.id = u.cliente_id ${whereSql}`;
    const count = await pool.query<{ total: string }>(`SELECT count(*)::text AS total ${fromSql}`, values);
    const rows = await pool.query<UnidadRow>(
      `SELECT ${selectColumns} ${fromSql}
       ORDER BY u.numero_serie, u.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, filters.offset],
    );
    return {
      data: rows.rows,
      limit: filters.limit,
      offset: filters.offset,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async getById(id: string): Promise<UnidadRecord | null> {
    const result = await this.pool().query<UnidadRow>(
      `SELECT ${selectColumns} FROM public.unidades u
       JOIN public.clientes c ON c.id = u.cliente_id WHERE u.id = $1::uuid`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async create(input: UnidadCreateInput, actor: AuthenticatedUser): Promise<UnidadRecord> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const customer = await client.query<{ id: string }>(
        "SELECT id FROM public.clientes WHERE id = $1::uuid",
        [input.cliente_id],
      );
      if (customer.rows.length === 0) {
        throw new HttpError(404, "No existe el cliente indicado.", "client_not_found");
      }
      await this.assertSerialAvailable(client, input.numero_serie);
      const result = await client.query<UnidadRow>(
        `INSERT INTO public.unidades (cliente_id, numero_serie, marca, modelo, anio, placas, activo)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
         RETURNING id, cliente_id, numero_serie, marca, modelo, anio, placas, activo, creado_en, actualizado_en`,
        [input.cliente_id, input.numero_serie, input.marca ?? null, input.modelo ?? null, input.anio ?? null, input.placas ?? null, input.activo ?? true],
      );
      const unit = result.rows[0];
      const customerName = await client.query<{ nombre: string }>(
        "SELECT nombre FROM public.clientes WHERE id = $1::uuid",
        [unit.cliente_id],
      );
      return { ...unit, cliente_nombre: customerName.rows[0]?.nombre ?? "" };
    }, pool);
  }

  async update(id: string, input: UnidadUpdateInput, actor: AuthenticatedUser): Promise<UnidadRecord | null> {
    const pool = this.pool();
    return withActorTransaction(actor, async (client) => {
      const existing = await client.query<UnidadRow>(
        `SELECT ${selectColumns} FROM public.unidades u
         JOIN public.clientes c ON c.id = u.cliente_id
         WHERE u.id = $1::uuid FOR UPDATE OF u`,
        [id],
      );
      const current = existing.rows[0];
      if (!current) return null;

      const changes = editableFields.filter((field) => Object.hasOwn(input, field) && input[field] !== current[field]);
      if (changes.length === 0) return current;
      if (Object.hasOwn(input, "numero_serie") && input.numero_serie) {
        await this.assertSerialAvailable(client, input.numero_serie, id);
      }

      const assignments = changes.map((field, index) => `${field} = $${index + 1}`);
      const values = changes.map((field) => input[field]);
      values.push(id);
      const result = await client.query<Omit<UnidadRow, "cliente_nombre">>(
        `UPDATE public.unidades SET ${assignments.join(", ")}, actualizado_en = clock_timestamp()
         WHERE id = $${values.length}::uuid
         RETURNING id, cliente_id, numero_serie, marca, modelo, anio, placas, activo, creado_en, actualizado_en`,
        values,
      );
      const updated = result.rows[0];
      return updated ? { ...updated, cliente_nombre: current.cliente_nombre } : null;
    }, pool);
  }

  private async assertSerialAvailable(executor: Pick<PoolClient, "query">, serial: string, excludeId?: string): Promise<void> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM public.unidades
       WHERE numero_serie = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [serial, excludeId ?? null],
    );
    if (result.rows.length > 0) {
      throw new HttpError(409, "El número de serie ya está registrado.", "duplicate_serial");
    }
  }
}
