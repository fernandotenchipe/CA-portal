import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "./database.js";
import type { AuthenticatedUser } from "../types/auth.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs a future audited operation with the active, authenticated profile as
 * actor. Callers must pass a user resolved by AuthService, never request data.
 */
export async function withActorTransaction<T>(
  user: AuthenticatedUser,
  operation: (client: PoolClient) => Promise<T>,
  pool: Pick<Pool, "connect"> = getDatabasePool(),
): Promise<T> {
  if (!uuidPattern.test(user.id)) {
    throw new Error("El perfil autenticado tiene un identificador inválido.");
  }

  const client = await pool.connect();
  let transactionOpen = false;
  let discardClient: Error | undefined;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      "SELECT set_config('app.actor_tipo', 'usuario', true), set_config('app.actor_id', $1, true)",
      [user.id],
    );

    const result = await operation(client);
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // A client with uncertain transaction state must not return to the pool.
        discardClient = rollbackError instanceof Error ? rollbackError : new Error("Rollback failed.");
      }
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}
