import { z } from 'zod';
import { institutionalPageFields, parseInstitutionalListing } from '../common/institutional-listing.schemas.js';

const schema = z.object({
  ...institutionalPageFields('users'),
  q: z.string().trim().min(2).max(120).optional(),
}).strict();

export type InstitutionalUsersQuery = z.infer<typeof schema>;

export function parseInstitutionalUsersQuery(query: unknown, body: unknown): InstitutionalUsersQuery {
  return parseInstitutionalListing(schema, query, body);
}
