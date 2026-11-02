import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const empty = z.object({}).strict();
const acknowledgement = z.object({ versionId: z.string().uuid() }).strict();
export function validatePrivacyRead(query: unknown, body: unknown): void {
  if (!empty.safeParse(query).success || (body !== undefined && !empty.safeParse(body).success)) {
    throw new BadRequestException('Invalid privacy notice request');
  }
}
export function parsePrivacyAcknowledgement(query: unknown, body: unknown) {
  const parsed = acknowledgement.safeParse(body);
  if (!empty.safeParse(query).success || !parsed.success) throw new BadRequestException('Invalid privacy notice request');
  return parsed.data;
}
