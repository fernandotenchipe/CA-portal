import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { env } from "../config/env.js";

let pool: Pool | undefined;

/** Pool PostgreSQL para el proceso persistente del backend. */
export function getDatabasePool(): Pool {
  if (!env.databaseUrl) {
    throw new Error("Falta DATABASE_URL. Configúrala en backend/.env antes de conectar.");
  }

  // node-postgres reemplaza el objeto `ssl` si la URL contiene sslmode,
  // sslrootcert, sslcert o sslkey. Retiramos esos parámetros para que la
  // configuración verificada construida aquí sea siempre la que se aplique.
  const connectionUrl = new URL(env.databaseUrl);
  if (connectionUrl.protocol !== "postgres:" && connectionUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL debe usar el protocolo postgres:// o postgresql://.");
  }

  const sslUrlParameters = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);
  for (const key of [...connectionUrl.searchParams.keys()]) {
    if (sslUrlParameters.has(key.toLowerCase())) {
      connectionUrl.searchParams.delete(key);
    }
  }

  const ca = env.databaseSslCaPath ? readFileSync(env.databaseSslCaPath, "utf8") : undefined;

  pool ??= new Pool({
    connectionString: connectionUrl.toString(),
    max: env.databasePoolMax,
    connectionTimeoutMillis: env.databaseConnectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    // Con TLS verificado, `pg` compara el certificado con el hostname de
    // DATABASE_URL. `ca` agrega la raíz Supabase cuando no está en el trust store.
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    application_name: "ca-portal-backend",
  });

  return pool;
}

export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    const currentPool = pool;
    pool = undefined;
    await currentPool.end();
  }
}
