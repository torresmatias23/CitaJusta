import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const emptyInput = z.object({}).strict();
const entryInput = z.object({
  serviceId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
}).strict();

const entryParams = z.object({ waitlistEntryId: z.string().uuid() }).strict();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const preferencesInput = z.object({
  preferredDays: z.array(z.number().int().min(1).max(7)),
  timeRanges: z.array(z.object({ start: time, end: time }).strict()),
  preferredBranchIds: z.array(z.string().uuid().transform((id) => id.toLowerCase())),
  allowsOtherBranches: z.boolean(),
  acceptsAnyProfessional: z.boolean(),
}).strict().superRefine((input, context) => {
  if (new Set(input.preferredDays).size !== input.preferredDays.length ||
      new Set(input.preferredBranchIds).size !== input.preferredBranchIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate preferences' });
  }
  const ranges = [...input.timeRanges].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (range.start >= range.end || (index > 0 && range.start < ranges[index - 1].end)) {
      context.addIssue({ code: 'custom', message: 'Invalid, duplicate or overlapping time ranges' });
    }
  }
});

export type WaitlistPreferencesInput = z.infer<typeof preferencesInput>;

export function parseWaitlistEntryParams(params: unknown) {
  const result = entryParams.safeParse(params);
  if (!result.success) throw new BadRequestException('Invalid waitlist entry id');
  return result.data;
}

export function parseWaitlistPreferences(body: unknown, query: unknown): WaitlistPreferencesInput {
  const result = preferencesInput.safeParse(body);
  if (!result.success || !emptyInput.safeParse(query).success) {
    throw new BadRequestException('Invalid waitlist preferences');
  }
  return result.data;
}

export function parseWaitlistEntry(body: unknown, query: unknown) {
  const result = entryInput.safeParse(body);
  if (!result.success || !emptyInput.safeParse(query).success) {
    throw new BadRequestException('Invalid waitlist input');
  }
  return result.data;
}

export function parseWaitlistListing(query: unknown, body: unknown) {
  if (!emptyInput.safeParse(query).success || !emptyInput.optional().safeParse(body).success) {
    throw new BadRequestException('Waitlist listing does not accept filters or body fields');
  }
}
