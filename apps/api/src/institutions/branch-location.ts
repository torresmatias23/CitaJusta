import type { Prisma } from '../generated/prisma/client.js';

export const branchLocationSelect = {
  addressLine1: true, addressLine2: true, municipality: true, region: true,
  country: true, latitude: true, longitude: true,
} as const satisfies Prisma.BranchSelect;

export function branchLocation(branch: Prisma.BranchGetPayload<{ select: typeof branchLocationSelect }>) {
  return {
    addressLine1: branch.addressLine1 ?? null, addressLine2: branch.addressLine2 ?? null,
    municipality: branch.municipality ?? null, region: branch.region ?? null, country: branch.country ?? null,
    latitude: branch.latitude?.toNumber() ?? null, longitude: branch.longitude?.toNumber() ?? null,
  };
}
