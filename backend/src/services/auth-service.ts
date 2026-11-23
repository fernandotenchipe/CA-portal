import type { AuthUserRepository } from "../repositories/auth-user-repository.js";
import { PostgresAuthUserRepository } from "../repositories/auth-user-repository.js";
import { SupabaseTokenVerifier, type VerifiedIdentity } from "./supabase-token-verifier.js";
import type { AuthServiceContract, AuthenticationResult } from "../types/auth.js";

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<VerifiedIdentity | null>;
}

export class AuthService implements AuthServiceContract {
  constructor(
    private readonly verifier: AccessTokenVerifier = new SupabaseTokenVerifier(),
    private readonly profiles: AuthUserRepository = new PostgresAuthUserRepository(),
  ) {}

  async authenticate(accessToken: string): Promise<AuthenticationResult> {
    const identity = await this.verifier.verify(accessToken);
    if (!identity) return { status: "invalid_token" };

    const user = await this.profiles.findActiveByAuthId(identity.id);
    if (!user) return { status: "forbidden" };

    return { status: "authenticated", user };
  }
}
