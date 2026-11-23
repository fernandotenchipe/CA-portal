import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

export interface VerifiedIdentity {
  id: string;
}

interface VerifiedClaims {
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  role?: unknown;
}

interface ClaimsAuthClient {
  getClaims(accessToken: string): Promise<{
    data: { claims: VerifiedClaims } | null;
    error: { status?: number } | null;
  }>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupabaseTokenVerifier {
  private authClient: ClaimsAuthClient | undefined;
  private issuer: string | undefined;
  private readonly audience: string;

  constructor(
    private readonly now: () => number = () => Date.now() / 1000,
    testConfiguration?: { authClient: ClaimsAuthClient; issuer: string; audience?: string },
  ) {
    this.authClient = testConfiguration?.authClient;
    this.issuer = testConfiguration?.issuer;
    this.audience = testConfiguration?.audience ?? env.supabaseJwtAudience;
  }

  async verify(accessToken: string): Promise<VerifiedIdentity | null> {
    const { authClient, issuer } = this.getConfiguration();
    const { data, error } = await authClient.getClaims(accessToken);

    if (error) {
      const status = error.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return null;
      }
      throw new Error("Supabase Auth no está disponible.");
    }

    const claims = data?.claims;
    if (!claims || !this.hasValidClaims(claims, issuer)) {
      return null;
    }

    return { id: claims.sub as string };
  }

  private getConfiguration(): { authClient: ClaimsAuthClient; issuer: string } {
    if (this.authClient && this.issuer) {
      return { authClient: this.authClient, issuer: this.issuer };
    }

    if (!env.supabaseUrl || !env.supabasePublishableKey) {
      throw new Error("Falta configurar Supabase Auth.");
    }

    const url = new URL(env.supabaseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("SUPABASE_URL debe usar HTTPS.");
    }

    const client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    this.authClient = {
      getClaims: (token) => client.auth.getClaims(token),
    };
    this.issuer = `${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
    return { authClient: this.authClient, issuer: this.issuer };
  }

  private hasValidClaims(claims: VerifiedClaims, issuer: string): boolean {
    const now = this.now();
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

    return (
      typeof claims.sub === "string" &&
      uuidPattern.test(claims.sub) &&
      claims.iss === issuer &&
      audiences.includes(this.audience) &&
      claims.role === "authenticated" &&
      typeof claims.exp === "number" &&
      Number.isFinite(claims.exp) &&
      claims.exp > now &&
      (claims.iat === undefined ||
        (typeof claims.iat === "number" && Number.isFinite(claims.iat) && claims.iat <= now + 60)) &&
      (claims.nbf === undefined ||
        (typeof claims.nbf === "number" && Number.isFinite(claims.nbf) && claims.nbf <= now + 60))
    );
  }
}
