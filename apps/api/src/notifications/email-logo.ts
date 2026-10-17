import { readFileSync } from 'node:fs';
import { z } from 'zod';

const maxBytes = 256 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const emailLogoAttachmentSchema = z.object({
  filename: z.literal('logo-citajusta.png'),
  content_type: z.literal('image/png'),
  content_id: z.literal('citajusta-logo'),
  content: z.string().min(12).max(Math.ceil(maxBytes / 3) * 4).refine((value) => {
    const bytes = Buffer.from(value, 'base64');
    return bytes.length <= maxBytes && bytes.subarray(0, 8).equals(pngSignature) && bytes.toString('base64') === value;
  }),
}).strict();

export function loadEmailLogo(read: (path: URL) => Buffer = readFileSync) {
  let bytes: Buffer;
  try {
    // Resolves to apps/api/assets from both src/notifications and dist/notifications.
    bytes = read(new URL('../../assets/logo-citajusta.png', import.meta.url));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (bytes.length > maxBytes || !bytes.subarray(0, 8).equals(pngSignature)) throw new Error('Invalid static email logo');
  return { filename: 'logo-citajusta.png', content_type: 'image/png', content_id: 'citajusta-logo', content: bytes.toString('base64') } as const;
}
