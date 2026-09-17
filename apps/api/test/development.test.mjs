import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDevelopmentTarget, checkDevelopment, demo, migrationsMatch, seedDevelopment } from '../dist/database/development.js';
import { provisionFixtureWaitlist } from './e2e/waitlist-catalog.fixture.mjs';

const url = 'postgresql://USER:PASSWORD@localhost:5432/citajusta_dev';
const migration = { name: 'migration', checksum: 'checksum' };
function fixture(initial = {}) {
  let state = { institution: [], branch: [], service: [], serviceBranch: [], waitlistStatus: [], priority: [], appointmentStatus: [], ...structuredClone(initial) };
  const writes = [];
  const commands = [];
  const models = Object.fromEntries(Object.keys(state).map((model) => [model, {
    async findUnique({ where }) { return state[model].find((row) => Object.entries(where.institutionId_code ?? where.serviceId_branchId ?? where).every(([key, value]) => row[key] === value)) ?? null; },
    async findUniqueOrThrow(args) { const row = await models[model].findUnique(args); if (!row) throw new Error('Not found'); return row; },
    async findMany({ where } = {}) { return state[model].filter((row) => !where || Object.entries(where).every(([key, value]) => value && typeof value === 'object' ? value.in.includes(row[key]) : row[key] === value)); },
    async create({ data }) { writes.push(model); const row = { ...data }; if (model === 'serviceBranch') row.active ??= true; state[model].push(row); return row; },
    async createMany({ data }) { for (const row of data) if (!state[model].some((existing) => existing.code === row.code)) await models[model].create({ data: row }); },
    async deleteMany({ where }) { state[model] = state[model].filter((row) => !where.id.in.includes(row.id)); },
  }]));
  const tx = { ...models,
    async $executeRaw(parts) { commands.push(parts.join('')); },
    async $queryRaw(parts) { const sql = parts.join(''); commands.push(sql); return sql.includes('current_database') ? [{ database: 'citajusta_dev' }] : [{ migration_name: migration.name, checksum: migration.checksum, finished_at: new Date(), rolled_back_at: null }]; },
  };
  const prisma = { ...models, async $transaction(operation) { const before = structuredClone(state); try { return await operation(tx); } catch (error) { state = before; throw error; } } };
  return { prisma, writes, commands, snapshot: () => structuredClone(state) };
}

test('seed admite exclusivamente base local de desarrollo, sin overrides de conexión', () => {
  assert.equal(assertDevelopmentTarget(url, 'development'), 'citajusta_dev');
  assert.equal(assertDevelopmentTarget(`${url}?schema=public`, undefined), 'citajusta_dev');
  for (const bad of [undefined, 'SENSITIVE_VALUE', url.replace('localhost', 'remote.example'), url.replace('citajusta_dev', 'citajusta_shadow'), url.replace('citajusta_dev', 'production'), `${url}?host=remote`, `${url}?options=SENSITIVE_VALUE`, `${url}?dbname=production`]) {
    assert.throws(() => assertDevelopmentTarget(bad, 'development'), (error) => !error.message.includes('PASSWORD') && !error.message.includes('SENSITIVE_VALUE'));
  }
  for (const env of ['production', 'test', 'staging']) assert.throws(() => assertDevelopmentTarget(url, env));
});

test('seed crea catálogo y STANDARD institucional; segunda ejecución no altera el resultado', async () => {
  const f = fixture();
  await seedDevelopment(f.prisma, url, 'development');
  const first = f.snapshot();
  await seedDevelopment(f.prisma, url, 'development');
  assert.deepEqual(f.snapshot(), first);
  assert.equal(first.priority.length, 1);
  assert.equal(first.priority[0].institutionId, demo.institution.id);
  assert.equal(first.priority[0].code, 'STANDARD');
  assert.equal(first.serviceBranch.length, 1);
  assert.deepEqual(first.waitlistStatus.map((row) => row.code).sort(), ['ACTIVE', 'FULFILLED', 'WITHDRAWN']);
});

test('seed conserva configuración compatible, nombres/niveles de prioridad y metadatos', async () => {
  const f = fixture({ institution: [{ ...demo.institution, legalName: 'Conservar' }], priority: [{ id: 'existing', institutionId: demo.institution.id, code: 'STANDARD', name: 'Configurada', level: 17, active: true }] });
  await seedDevelopment(f.prisma, url, 'development');
  assert.equal(f.snapshot().institution[0].legalName, 'Conservar');
  assert.equal(f.snapshot().priority[0].level, 17);
  assert.equal(f.snapshot().priority[0].name, 'Configurada');
});

for (const [model, data] of [
  ['institution', { ...demo.institution, name: 'Ajena' }],
  ['branch', { ...demo.branch, institutionId: 'other' }],
  ['service', { ...demo.service, code: 'OTHER' }],
  ['service', { ...demo.service, active: false }],
]) test(`seed rechaza colisión/configuración incompatible de ${model}: ${JSON.stringify(data)}`, async () => {
  const f = fixture({ [model]: [data] });
  const before = f.snapshot();
  await assert.rejects(seedDevelopment(f.prisma, url, 'development'));
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.writes.length, 0);
});

test('catálogo incompatible revierte también los datos demo; producción no abre transacción', async () => {
  const f = fixture({ waitlistStatus: [{ id: 'existing', code: 'ACTIVE', active: false, isFinal: false }] });
  const before = f.snapshot();
  await assert.rejects(seedDevelopment(f.prisma, url, 'development'));
  assert.deepEqual(f.snapshot(), before);
  await assert.rejects(seedDevelopment({ $transaction() { assert.fail('unsafe transaction'); } }, url, 'production'));
});

test('check ejecuta READ ONLY, detecta preparación ausente y no escribe', async () => {
  const f = fixture();
  const checks = await checkDevelopment(f.prisma, url, 'development', [migration]);
  assert.equal(f.commands[0], 'SET TRANSACTION READ ONLY');
  assert.equal(f.writes.length, 0);
  assert.ok(checks.some((check) => !check.ok && check.message.includes('STANDARD')));
  assert.ok(checks.some((check) => !check.ok && check.message.includes('ACTIVE')));
});

test('check reconoce seed y detecta checksum/migración pendiente sin confundir rollback', async () => {
  const f = fixture();
  await seedDevelopment(f.prisma, url, 'development');
  const before = f.snapshot();
  const checks = await checkDevelopment(f.prisma, url, 'development', [migration]);
  assert.deepEqual(f.snapshot(), before);
  assert.ok(checks.filter((check) => /Waitlist|STANDARD|Catálogo demo/.test(check.message)).every((check) => check.ok));
  const applied = { migration_name: migration.name, checksum: migration.checksum, finished_at: new Date(), rolled_back_at: null };
  assert.equal(migrationsMatch([migration], [applied]), true);
  for (const rows of [[], [{ ...applied, checksum: 'changed' }], [{ ...applied, finished_at: null }], [{ ...applied, rolled_back_at: new Date() }]]) assert.equal(migrationsMatch([migration], rows), false);
});

test('fixture incluye FULFILLED recién creado en cleanup y preserva todos los preexistentes', async () => {
  for (const existingCodes of [[], ['ACTIVE', 'WITHDRAWN'], ['ACTIVE', 'WITHDRAWN', 'FULFILLED']]) {
    const existing = existingCodes.map((code) => ({ id: `existing-${code}`, code, active: true, isFinal: code !== 'ACTIVE' }));
    const f = fixture({ institution: [demo.institution], waitlistStatus: existing });
    const owned = [];
    await provisionFixtureWaitlist(f.prisma, demo.institution.id, owned);
    assert.equal(owned.length, 3 - existing.length);
    await f.prisma.waitlistStatus.deleteMany({ where: { id: { in: owned } } });
    assert.deepEqual(f.snapshot().waitlistStatus, existing);
  }
});
