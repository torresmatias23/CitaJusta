export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: AuthenticatedPrincipal;
}
