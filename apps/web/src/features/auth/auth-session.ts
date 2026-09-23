export { createAuthSession, authErrorMessage } from '@citajusta/client-core';
export type { LoginInput, RegisterInput, UserProfile, AuthSnapshot, AuthSession } from '@citajusta/client-core';

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/';
  const url = new URL(value, 'https://citajusta.invalid');
  if (url.origin !== 'https://citajusta.invalid' || ['/login', '/registro'].includes(url.pathname)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
