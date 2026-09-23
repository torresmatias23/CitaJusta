import type { RefreshTokenStorage } from '@citajusta/client-core';

export function createMemorySessionStorage(): RefreshTokenStorage {
  let token: string | undefined;
  return {
    read: () => token,
    write(value) { token = value; },
    clear() { token = undefined; },
  };
}
