export type PasswordLinkType = "invite" | "recovery";

export type ParsedAuthCallback =
  | { status: "session"; type: PasswordLinkType; accessToken: string; refreshToken: string }
  | { status: "code"; type: PasswordLinkType; code: string; flowId?: string }
  | { status: "expired"; type?: PasswordLinkType }
  | { status: "invalid"; type?: PasswordLinkType }
  | { status: "no-session"; type?: PasswordLinkType };

export function parseAuthCallback(href: string): ParsedAuthCallback {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  const rawType = query.get("type") ?? fragment.get("type");
  const type: PasswordLinkType | undefined = rawType === "invite" || rawType === "recovery" ? rawType : undefined;
  const callbackParams = new URLSearchParams(url.hash.slice(1));
  query.forEach((value, key) => callbackParams.set(key, value));
  const errorCode = callbackParams.get("error_code");
  const hasAuthError = callbackParams.has("error") || callbackParams.has("error_description");

  if (errorCode === "otp_expired") return { status: "expired", ...(type ? { type } : {}) };
  if (hasAuthError || errorCode) return { status: "invalid", ...(type ? { type } : {}) };

  const code = query.get("code");
  if (code) {
    // Supabase PKCE password-recovery callbacks may not include `type`.
    const flowId = query.get("sb_flow_id");
    return { status: "code", type: type ?? "recovery", code, ...(flowId ? { flowId } : {}) };
  }

  if (type !== "invite" && type !== "recovery") {
    return fragment.has("access_token") || fragment.has("refresh_token")
      ? { status: "invalid" }
      : { status: "no-session" };
  }

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (!accessToken || !refreshToken) return { status: "no-session", type };

  return { status: "session", type, accessToken, refreshToken };
}

export async function validateAuthCallbackSession(
  client: {
    auth: {
      setSession: (session: { access_token: string; refresh_token: string }) => Promise<{ error: unknown | null }>;
      exchangeCodeForSession: (code: string, options?: { flowId?: string }) => Promise<{ error: unknown | null }>;
      getUser: () => Promise<{ data: { user: unknown | null }; error: unknown | null }>;
    };
  },
  callback: Extract<ParsedAuthCallback, { status: "session" | "code" }>,
): Promise<boolean> {
  try {
    const sessionResult = callback.status === "code"
      ? await client.auth.exchangeCodeForSession(callback.code, callback.flowId ? { flowId: callback.flowId } : undefined)
      : await client.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
        });
    const sessionError = sessionResult.error;
    if (sessionError) return false;

    const { data, error } = await client.auth.getUser();
    return !error && Boolean(data.user);
  } catch {
    return false;
  }
}
