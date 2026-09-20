import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReassignmentDemoInput, prepareReassignmentDemo, reassignmentDemoIdentity } from '../dist/database/reassignment-demo.js';

const options = { connectionString: 'postgresql://USER:PASSWORD@localhost/citajusta_dev', nodeEnv: 'development', email: 'person@example.test', scenario: 'reject' };
test('demo CLI requires a scenario and normalized recipient email, never a userId', () => {
  assert.deepEqual(parseReassignmentDemoInput(['--scenario=reject'], ' Person@Example.test '), { scenario: 'reject', email: 'person@example.test' });
  assert.equal(parseReassignmentDemoInput(['--scenario=accept'], options.email).scenario, 'accept');
  for (const args of [[], ['--scenario=other'], ['--scenario=reject', '--userId=123']]) assert.throws(() => parseReassignmentDemoInput(args, options.email));
  for (const email of [undefined, '', '123', 'private\nvalue']) assert.throws(() => parseReassignmentDemoInput(['--scenario=reject'], email), (e) => !e.message.includes('private'));
});

test('demo rejects production/unsafe DB before any persistence or domain call', async () => {
  const prisma = { $transaction() { assert.fail('must not access DB'); } };
  for (const override of [{ nodeEnv: 'production' }, { nodeEnv: 'test' }, { connectionString: undefined },
    { connectionString: options.connectionString.replace('localhost', 'remote') },
    { connectionString: options.connectionString.replace('citajusta_dev', 'citajusta_shadow') },
    { connectionString: `${options.connectionString}?host=remote` }]) {
    await assert.rejects(prepareReassignmentDemo(prisma, {}, { ...options, ...override }), (e) => !e.message.includes('PASSWORD'));
  }
});

test('real DB name and concurrent tool lock are checked before recipient lookup', async () => {
  for (const [database, acquired] of [['wrong', true], ['citajusta_dev', false]]) {
    const prisma = { $transaction: (fn) => fn({ $queryRaw: async (parts) => parts.join('').includes('current_database') ? [{ database }] : [{ acquired }] }),
      user: { findUnique() { assert.fail('must not lookup recipient'); } } };
    await assert.rejects(prepareReassignmentDemo(prisma, {}, options));
  }
});

test('missing/inactive/deleted recipient fails before seed or any write', async () => {
  for (const recipient of [null, { id: 'x', status: 'PENDING', deletedAt: null }, { id: 'x', status: 'ACTIVE', deletedAt: new Date() }]) {
    const prisma = { $transaction: (fn) => fn({ $queryRaw: async (parts) => parts.join('').includes('current_database') ? [{ database: 'citajusta_dev' }] : [{ acquired: true }] }),
      user: { findUnique: async ({ where, select }) => { assert.equal(where.email, options.email); assert.equal(select.passwordHash, undefined); return recipient; } } };
    await assert.rejects(prepareReassignmentDemo(prisma, {}, options), /debe existir y estar ACTIVE/);
  }
});

test('scenario namespace is stable and isolated by recipient and scenario', () => {
  const reject = reassignmentDemoIdentity('recipient-a', 'reject');
  assert.deepEqual(reassignmentDemoIdentity('recipient-a', 'reject'), reject);
  const accept = reassignmentDemoIdentity('recipient-a', 'accept');
  const other = reassignmentDemoIdentity('recipient-b', 'reject');
  for (const item of [accept, other]) {
    assert.notEqual(item.code, reject.code); assert.notEqual(item.sourceId, reject.sourceId); assert.notEqual(item.professionalUserId, reject.professionalUserId);
  }
  assert.ok(reject.code.startsWith('DEMO-')); assert.ok(reject.code.length <= 50);
});
