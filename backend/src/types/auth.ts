export interface AuthenticatedUser {
  id: string;
  nombre: string;
  rol: {
    codigo: string;
    nombre: string;
  };
  permisos: string[];
}

export type AuthenticationResult =
  | { status: "authenticated"; user: AuthenticatedUser }
  | { status: "invalid_token" }
  | { status: "forbidden" };

export interface AuthServiceContract {
  authenticate(accessToken: string): Promise<AuthenticationResult>;
}
