import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = Symbol('require-permissions');

export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);
