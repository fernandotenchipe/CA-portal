import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthCallback, validateAuthCallbackSession } from "./auth-callback.ts";

const callbackUrl = (fragment: string) => `http://localhost:3000/auth/accept-invite#${fragment}`;

test("accepts an invite callback with both session tokens", () => {
  assert.deepEqual(
    parseAuthCallback(callbackUrl("access_token=a&refresh_token=r&type=invite")),
    { status: "session", type: "invite", accessToken: "a", refreshToken: "r" },
  );
});

test("accepts a recovery callback with both session tokens", () => {
  assert.deepEqual(
    parseAuthCallback(callbackUrl("access_token=a&refresh_token=r&type=recovery")),
    { status: "session", type: "recovery", accessToken: "a", refreshToken: "r" },
  );
});

test("accepts a PKCE callback code from the query string", () => {
  assert.deepEqual(
    parseAuthCallback("http://localhost:3000/auth/accept-invite?code=auth-code&sb_flow_id=flow-id"),
    { status: "code", type: "recovery", code: "auth-code", flowId: "flow-id" },
  );
});

test("classifies an expired Supabase email link", () => {
  assert.deepEqual(parseAuthCallback(callbackUrl("error=access_denied&error_code=otp_expired&type=recovery")), {
    status: "expired",
    type: "recovery",
  });
  assert.deepEqual(parseAuthCallback("http://localhost:3000/auth/accept-invite?error_code=otp_expired"), {
    status: "expired",
  });
});

test("classifies an invalid link without echoing its error text", () => {
  assert.deepEqual(parseAuthCallback(callbackUrl("error=access_denied&error_description=invalid")), {
    status: "invalid",
  });
  assert.deepEqual(parseAuthCallback("http://localhost:3000/auth/accept-invite?error=access_denied"), {
    status: "invalid",
  });
});

test("does not accept a link without an authentication session", () => {
  assert.deepEqual(parseAuthCallback("http://localhost:3000/auth/accept-invite"), {
    status: "no-session",
  });
  assert.deepEqual(parseAuthCallback(callbackUrl("access_token=a&type=recovery")), {
    status: "no-session",
    type: "recovery",
  });
});

test("requires Supabase to accept the session and return a user", async () => {
  const callback = parseAuthCallback(callbackUrl("access_token=a&refresh_token=r&type=recovery"));
  assert.equal(callback.status, "session");
  if (callback.status !== "session") return;

  const calls: string[] = [];
  const validClient = {
    auth: {
      setSession: async ({ access_token, refresh_token }: { access_token: string; refresh_token: string }) => {
        calls.push(`set:${access_token}:${refresh_token}`);
        return { error: null };
      },
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => {
        calls.push("getUser");
        return { data: { user: { id: "verified-user" } }, error: null };
      },
    },
  };
  assert.equal(await validateAuthCallbackSession(validClient, callback), true);
  assert.deepEqual(calls, ["set:a:r", "getUser"]);

  const noSessionClient = {
    auth: {
      setSession: async () => ({ error: new Error("invalid") }),
      exchangeCodeForSession: async () => ({ error: new Error("invalid code or missing verifier") }),
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  };
  assert.equal(await validateAuthCallbackSession(noSessionClient, callback), false);

  const unverifiedUserClient = {
    auth: {
      setSession: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: null }, error: new Error("user could not be verified") }),
    },
  };
  assert.equal(await validateAuthCallbackSession(unverifiedUserClient, callback), false);

  const pkceCallback = parseAuthCallback("http://localhost:3000/auth/accept-invite?code=auth-code&sb_flow_id=flow-id");
  assert.equal(pkceCallback.status, "code");
  if (pkceCallback.status !== "code") return;

  let exchanged = false;
  const pkceClient = {
    auth: {
      setSession: async () => ({ error: null }),
      exchangeCodeForSession: async (code: string, options?: { flowId?: string }) => {
        exchanged = code === "auth-code" && options?.flowId === "flow-id";
        return { error: null };
      },
      getUser: async () => ({ data: { user: { id: "verified-user" } }, error: null }),
    },
  };
  assert.equal(await validateAuthCallbackSession(pkceClient, pkceCallback), true);
  assert.equal(exchanged, true);

  const invalidCodeClient = {
    auth: {
      setSession: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({ error: new Error("invalid or expired code") }),
      getUser: async () => ({ data: { user: null }, error: new Error("no verified session") }),
    },
  };
  assert.equal(await validateAuthCallbackSession(invalidCodeClient, pkceCallback), false);
});
