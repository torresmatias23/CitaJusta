import assert from 'node:assert/strict';
import { mock } from 'node:test';

// Contract double only. PostgreSQL row locking is covered by the separate E2E.
export function privacyStorage() {
  const users = new Map(), sessions = new Map(), events = [];
  let tail = Promise.resolve();
  const db = {
    user: {
      findUnique: async ({ where }) => users.get(where.id) ?? null,
      findFirst: async ({ where }) => { const user = users.get(where.id); return user?.status === 'ACTIVE' && user.deletedAt === null ? { id: where.id } : null; },
    },
    authSession: { findUnique: async ({ where }) => sessions.get(where.id) ?? null },
    auditEvent: {
      findFirst: mock.fn(async ({ where }) => events.filter(event => Object.entries(where).every(([key, value]) => (event[key] ?? null) === value))
        .sort((a, b) => a.occurredAt - b.occurredAt)[0] ?? null),
      create: mock.fn(async ({ data }) => { const event = { ...data, occurredAt: new Date() }; events.push(event); return { id: event.id }; }),
    },
    $queryRaw: mock.fn(async query => {
      assert.match(query.sql, /SELECT id FROM usuarios WHERE id = \?::uuid FOR UPDATE/);
      return users.has(query.values[0]) ? [{ id: query.values[0] }] : [];
    }),
    $transaction: mock.fn(async (work, options) => {
      assert.equal(options.isolationLevel, 'ReadCommitted');
      let release; const next = new Promise(resolve => { release = resolve; });
      const previous = tail; tail = next; await previous;
      try { return await work(db); } finally { release(); }
    }),
  };
  return { db, users, sessions, events };
}
