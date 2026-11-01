import { z } from 'zod';
import { institutionalPageFields, parseInstitutionalListing } from '../common/institutional-listing.schemas.js';

const schema = z.object({
  ...institutionalPageFields('waitlist'),
  // Codes belong to the existing configurable catalog, not a new status enum.
  status: z.string().trim().min(1).max(60).optional(),
  serviceId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
}).strict();

export type InstitutionalWaitlistQuery = z.infer<typeof schema>;

export function parseInstitutionalWaitlistQuery(query: unknown, body: unknown): InstitutionalWaitlistQuery {
  return parseInstitutionalListing(schema, query, body);
}
