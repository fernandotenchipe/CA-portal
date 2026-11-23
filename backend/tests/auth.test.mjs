import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../dist/app.js";
import { AuthService } from "../dist/services/auth-service.js";
import { SupabaseTokenVerifier } from "../dist/services/supabase-token-verifier.js";
import { PostgresAuthUserRepository } from "../dist/repositories/auth-user-repository.js";
import { hasPermission } from "../dist/middleware/authorization.js";
import { withActorTransaction } from "../dist/services/actor-transaction.js";

const userId = "b0d673b0-c76b-4ca1-96c2-b053fce62eca";
const otherUserId = "e63ed092-2b5b-4cc5-9c86-9606ef9f0ad0";
const fixedNow = 1_800_000_000;
const issuer = "https://project.supabase.co/auth/v1";

const adminUser = {
  id: userId,
  nombre: "Administración de prueba",
  rol: { codigo: "ADMINISTRACION", nombre: "Administración" },
  permisos: ["auditoria.consultar"],
};

const salesUser = {
  id: otherUserId,
  nombre: "Ventas de prueba",
  rol: { codigo: "VENTAS", nombre: "Ventas" },
  permisos: [],
};

function claims(overrides = {}) {
  return {
    sub: userId,
    iss: issuer,
    aud: "authenticated",
    exp: fixedNow + 600,
    iat: fixedNow - 10,
    role: "authenticated",
    ...overrides,
  };
}

function createVerifier(response) {
  const calls = [];
  const verifier = new SupabaseTokenVerifier(
    () => fixedNow,
    {
      issuer,
      audience: "authenticated",
      authClient: {
        async getClaims(token) {
          calls.push(token);
          return typeof response === "function" ? response(token) : response;
        },
      },
    },
  );
  return { verifier, calls };
}

async function withHttpApp(app, callback) {
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const { port } = app.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
  }
}

describe("Supabase JWT claims verifier", () => {
  it("accepts verified claims and returns only the UUID identity", async () => {
    const { verifier, calls } = createVerifier({ data: { claims: claims() }, error: null });
    assert.deepEqual(await verifier.verify("verified-token"), { id: userId });
    assert.deepEqual(calls, ["verified-token"]);
  });

  it("rejects a token rejected by Supabase, including an invalid signature", async () => {
    const { verifier } = createVerifier({ data: null, error: { status: 401 } });
    assert.equal(await verifier.verify("tampered-token"), null);
  });

  it("rejects expired tokens", async () => {
    const { verifier } = createVerifier({
      data: { claims: claims({ exp: fixedNow - 1 }) },
      error: null,
    });
    assert.equal(await verifier.verify("expired-token"), null);
  });

  it("rejects wrong issuer, audience, subject, role, and future claims", async () => {
    for (const override of [
      { iss: "https://other.supabase.co/auth/v1" },
      { aud: "anon" },
      { sub: "not-a-uuid" },
      { role: "service_role" },
      { iat: fixedNow + 120 },
      { nbf: fixedNow + 120 },
    ]) {
      const { verifier } = createVerifier({ data: { claims: claims(override) }, error: null });
      assert.equal(await verifier.verify("claim-mismatch"), null);
    }
  });

  it("treats Auth provider failures as unavailable instead of accepting the token", async () => {
    const { verifier } = createVerifier({ data: null, error: { status: 503 } });
    await assert.rejects(verifier.verify("any-token"));
  });
});

describe("Auth API and profile authorization", () => {
  let app;
  before(() => {
    const authService = {
      async authenticate(token) {
        if (token === "active-admin") return { status: "authenticated", user: adminUser };
        if (token === "active-sales") return { status: "authenticated", user: salesUser };
        if (token === "no-profile" || token === "inactive-profile") return { status: "forbidden" };
        return { status: "invalid_token" };
      },
    };
    app = createApp(authService);
  });

  after(async () => {
    if (app?.listening) await new Promise((resolve) => app.close(resolve));
  });

  it("returns 401 without a bearer token", async () => {
    await withHttpApp(app, async (base) => {
      const response = await fetch(`${base}/api/auth/me`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Autenticación requerida." });
    });
  });

  it("returns 401 for invalid, expired, or manipulated tokens", async () => {
    await withHttpApp(app, async (base) => {
      for (const token of ["invalid", "expired", "tampered"]) {
        const response = await fetch(`${base}/api/auth/check`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 401);
      }
    });
  });

  it("returns 403 when the Auth identity has no active application profile", async () => {
    await withHttpApp(app, async (base) => {
      for (const token of ["no-profile", "inactive-profile"]) {
        const response = await fetch(`${base}/api/auth/me`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 403);
      }
    });
  });

  it("returns safe profile information for an active user and a lightweight check", async () => {
    await withHttpApp(app, async (base) => {
      const meResponse = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: "Bearer active-admin" },
      });
      assert.equal(meResponse.status, 200);
      assert.deepEqual(await meResponse.json(), {
        id: userId,
        nombre: "Administración de prueba",
        rol: adminUser.rol,
        permisos: ["auditoria.consultar"],
      });
      assert.equal(meResponse.headers.get("cache-control"), "no-store");

      const checkResponse = await fetch(`${base}/api/auth/check`, {
        headers: { authorization: "Bearer active-admin" },
      });
      assert.equal(checkResponse.status, 200);
      assert.deepEqual(await checkResponse.json(), { authenticated: true, active: true });
    });
  });

  it("does not trust user or role headers supplied by the caller", async () => {
    await withHttpApp(app, async (base) => {
      const response = await fetch(`${base}/api/auth/me`, {
        headers: {
          authorization: "Bearer active-sales",
          "x-user-id": userId,
          "x-role": "ADMINISTRACION",
          "x-permissions": "auditoria.consultar",
        },
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.id, otherUserId);
      assert.equal(body.rol.codigo, "VENTAS");
      assert.deepEqual(body.permisos, []);
    });
  });

  it("returns generic service errors without exposing internal exceptions", async () => {
    const failingApp = createApp({ authenticate: async () => { throw new Error("postgres password detail"); } });
    await withHttpApp(failingApp, async (base) => {
      const response = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: "Bearer active-admin" },
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Servicio de autenticación temporalmente no disponible.",
      });
    });
  });
});

describe("Auth service profile resolution", () => {
  it("looks up the database profile using only the verified subject", async () => {
    const lookups = [];
    const authService = new AuthService(
      { async verify(token) { assert.equal(token, "signed-access-token"); return { id: userId }; } },
      { async findActiveByAuthId(id) { lookups.push(id); return adminUser; } },
    );

    assert.deepEqual(await authService.authenticate("signed-access-token"), {
      status: "authenticated",
      user: adminUser,
    });
    assert.deepEqual(lookups, [userId]);
  });

  it("rejects an Auth identity with no active application profile", async () => {
    const authService = new AuthService(
      { async verify() { return { id: userId }; } },
      { async findActiveByAuthId() { return null; } },
    );
    assert.deepEqual(await authService.authenticate("valid-token"), { status: "forbidden" });
  });
});

describe("Database profile and permission policy", () => {
  it("uses a parameterized UUID lookup and requires active user and role", async () => {
    const seen = {};
    const repository = new PostgresAuthUserRepository({
      async query(sql, values) {
        seen.sql = sql;
        seen.values = values;
        return {
          rows: [{
            id: userId,
            nombre: "Administración de prueba",
            rol_codigo: "ADMINISTRACION",
            rol_nombre: "Administración",
            permisos: ["auditoria.consultar"],
          }],
        };
      },
    });
    const user = await repository.findActiveByAuthId(userId);
    assert.equal(user.id, userId);
    assert.deepEqual(seen.values, [userId]);
    assert.match(seen.sql, /u\.activo IS TRUE/);
    assert.match(seen.sql, /r\.activo IS TRUE/);
    assert.match(seen.sql, /rol_permisos/);
  });

  it("permits a database-backed permission and denies missing permission", () => {
    assert.equal(hasPermission(adminUser, "auditoria.consultar"), true);
    assert.equal(hasPermission(salesUser, "clientes.consultar"), false);
  });

  it("restricts detailed audit permission to Administration", () => {
    const nonAdminWithErroneousGrant = {
      ...salesUser,
      permisos: ["auditoria.consultar"],
    };
    assert.equal(hasPermission(adminUser, "auditoria.consultar"), true);
    assert.equal(hasPermission(nonAdminWithErroneousGrant, "auditoria.consultar"), false);
  });
});

describe("Actor transaction isolation", () => {
  it("sets each active user's actor locally and releases the pooled connection", async () => {
    const queries = [];
    let releases = 0;
    const client = {
      async query(text, values) { queries.push({ text, values }); },
      release() { releases += 1; },
    };
    const pool = { async connect() { return client; } };

    await withActorTransaction(adminUser, async (tx) => {
      assert.equal(tx, client);
      await tx.query("SELECT $1::uuid", [adminUser.id]);
    }, pool);
    await withActorTransaction(salesUser, async (tx) => {
      await tx.query("SELECT $1::uuid", [salesUser.id]);
    }, pool);

    const actorQueries = queries.filter(({ text }) => text.includes("set_config"));
    assert.deepEqual(actorQueries.map(({ values }) => values), [[userId], [otherUserId]]);
    assert.equal(actorQueries.every(({ text }) => text.includes("'usuario', true")), true);
    assert.equal(queries.filter(({ text }) => text === "BEGIN").length, 2);
    assert.equal(queries.filter(({ text }) => text === "COMMIT").length, 2);
    assert.equal(releases, 2);
  });

  it("rolls back and releases when an operation fails", async () => {
    const queries = [];
    let releases = 0;
    const client = {
      async query(text) { queries.push(text); },
      release() { releases += 1; },
    };
    const pool = { async connect() { return client; } };

    await assert.rejects(
      withActorTransaction(adminUser, async () => { throw new Error("operation failed"); }, pool),
      /operation failed/,
    );
    assert.deepEqual(queries, [
      "BEGIN",
      "SELECT set_config('app.actor_tipo', 'usuario', true), set_config('app.actor_id', $1, true)",
      "ROLLBACK",
    ]);
    assert.equal(releases, 1);
  });

  it("discards the client if rollback fails so actor state cannot leak", async () => {
    const queries = [];
    let discardedWith;
    const rollbackError = new Error("connection state is uncertain");
    const client = {
      async query(text) {
        queries.push(text);
        if (text === "ROLLBACK") throw rollbackError;
      },
      release(error) { discardedWith = error; },
    };
    const pool = { async connect() { return client; } };

    await assert.rejects(withActorTransaction(adminUser, async () => { throw new Error("operation failed"); }, pool));
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.equal(discardedWith, rollbackError);
  });
});
