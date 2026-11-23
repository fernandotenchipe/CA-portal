import { closeDatabasePool, getDatabasePool } from "../services/database.js";

try {
  const result = await getDatabasePool().query<{ ok: number }>("SELECT 1 AS ok");
  if (result.rows[0]?.ok !== 1) {
    throw new Error("PostgreSQL no devolvió el resultado esperado de SELECT 1.");
  }
  console.log("Conexión PostgreSQL correcta (SELECT 1).");
} catch (error) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error(`Falló la comprobación PostgreSQL: ${message}`);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
