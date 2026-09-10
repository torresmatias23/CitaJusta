// Prisma 7/adapter-pg may surface a commit failure directly from the adapter,
// rather than wrapping it in P2034. Do not classify arbitrary storage errors as retryable.
export function isTransactionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 'P2034') return true;
  if (!('name' in error) || error.name !== 'DriverAdapterError' || !('cause' in error)) return false;
  const cause = error.cause;
  return typeof cause === 'object' && cause !== null &&
    'kind' in cause && cause.kind === 'TransactionWriteConflict' &&
    'originalCode' in cause && (cause.originalCode === '40001' || cause.originalCode === '40P01');
}
