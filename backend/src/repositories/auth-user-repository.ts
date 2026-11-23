import type { Pool } from "pg";
import { getDatabasePool } from "../services/database.js";
import type { AuthenticatedUser } from "../types/auth.js";

interface AuthUserRow {
  id: string;
  nombre: string;
  rol_codigo: string;
  rol_nombre: string;
  permisos: string[];
}

export interface AuthUserRepository {
  findActiveByAuthId(authUserId: string): Promise<AuthenticatedUser | null>;
}

export class PostgresAuthUserRepository implements AuthUserRepository {
  constructor(private readonly pool?: Pick<Pool, "query">) {}

  async findActiveByAuthId(authUserId: string): Promise<AuthenticatedUser | null> {
    const pool = this.pool ?? getDatabasePool();
    const result = await pool.query<AuthUserRow>(
      `SELECT
         u.id::text AS id,
         u.nombre,
         r.codigo AS rol_codigo,
         r.nombre AS rol_nombre,
         COALESCE(
           array_agg(DISTINCT p.modulo || '.' || p.operacion)
             FILTER (WHERE p.id IS NOT NULL),
           ARRAY[]::text[]
         ) AS permisos
       FROM public.usuarios AS u
       JOIN public.roles AS r ON r.id = u.rol_id
       LEFT JOIN public.rol_permisos AS rp ON rp.rol_id = r.id
       LEFT JOIN public.permisos AS p ON p.id = rp.permiso_id
       WHERE u.id = $1::uuid
         AND u.activo IS TRUE
         AND r.activo IS TRUE
       GROUP BY u.id, u.nombre, r.codigo, r.nombre`,
      [authUserId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      nombre: row.nombre,
      rol: { codigo: row.rol_codigo, nombre: row.rol_nombre },
      permisos: row.permisos,
    };
  }
}
