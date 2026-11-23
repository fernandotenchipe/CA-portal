const parsedPort = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error("PORT debe ser un número entre 1 y 65535.");
}

export const env = {
  port: parsedPort,
  databaseUrl: process.env.DATABASE_URL,
  databaseSslCaPath: process.env.DATABASE_SSL_CA_PATH,
  supabaseUrl: process.env.SUPABASE_URL,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  supabaseJwtAudience: process.env.SUPABASE_JWT_AUDIENCE || "authenticated",
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 5),
  databaseConnectionTimeoutMs: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10_000),
};

if (!Number.isInteger(env.databasePoolMax) || env.databasePoolMax < 1 || env.databasePoolMax > 20) {
  throw new Error("DATABASE_POOL_MAX debe ser un entero entre 1 y 20.");
}

if (!Number.isInteger(env.databaseConnectionTimeoutMs) || env.databaseConnectionTimeoutMs < 1) {
  throw new Error("DATABASE_CONNECTION_TIMEOUT_MS debe ser un entero positivo.");
}
