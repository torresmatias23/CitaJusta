import type { AuthenticatedRequest } from '../../auth/types/authenticated-principal.js';

export interface InstitutionContext {
  institutionId?: string;
  branchId?: string;
}

export interface AuthorizationContext extends InstitutionContext {
  userId: string;
  roleCodes: string[];
  permissions: string[];
}

export interface AuthorizedRequest extends AuthenticatedRequest {
  authorization?: AuthorizationContext;
}
