import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { AvailabilityAdministrationController } from '../dist/availability/availability-administration.controller.js';
import { AvailabilityAdministrationReadService } from '../dist/availability/availability-administration-read.service.js';
import { availabilityQuerySchema, blockQuerySchema, parseReadQuery } from '../dist/availability/availability-administration-read.schemas.js';
import { administrationContext } from '../dist/availability/availability-administration.schemas.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), permissions: ['availability.read'], roleCodes: [] };
const named = () => ({ id: randomUUID(), name: 'Historical' });
const query = { date: '2026-09-26' };
const status = code => error => error.getStatus?.() === code;
function fixture() {
  const row = { id: randomUUID(), date: new Date(`${query.date}T00:00Z`), startTime: new Date('1970-01-01T09:00Z'), endTime: new Date('1970-01-01T10:00Z'),
    active: false, capacity: 1, origin: 'MANUAL', branch: named(), service: named(), attentionPoint: named(),
    professional: { id: randomUUID(), titleOrFunction: null, user: { firstNames: 'Demo', lastNames: 'Professional' } },
    createdAt: new Date(), updatedAt: new Date(), startsAt: new Date('2026-09-26T03:00Z'), endsAt: new Date('2026-09-27T03:00Z'), type: 'MANUAL', reason: null };
  const prisma = { institution: { findUnique: mock.fn(async () => ({ timeZone: 'America/Santiago' })) },
    branch: { findFirst: mock.fn(async () => ({ id: row.branch.id })) }, service: { findFirst: mock.fn(async () => ({ id: row.service.id })) },
    professional: { findFirst: mock.fn(async () => ({ id: row.professional.id })) },
    availability: { findMany: mock.fn(async () => [row, { ...row, id: randomUUID(), active: true }]) },
    scheduleBlock: { findMany: mock.fn(async () => [row, { ...row, branch: null, professional: null, attentionPoint: null }]) } };
  return { prisma, row, service: new AvailabilityAdministrationReadService(prisma) };
}
test('HU032 both GETs require availability.read and reject missing institutional/identity context', () => {
  for (const name of ['find', 'blocks']) assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AvailabilityAdministrationController.prototype[name]), ['availability.read']);
  assert.throws(() => administrationContext({}), status(401));
  assert.throws(() => administrationContext({ principal: { userId: context.userId }, authorization: { ...context, institutionId: undefined } }), status(400));
});
test('HU032 strict query/date/body; blocks do not accept serviceId', () => {
  for (const schema of [availabilityQuerySchema, blockQuerySchema]) {
    for (const q of [{}, { date: '2026-02-30' }, { ...query, institutionId: context.institutionId }, { ...query, userId: context.userId }, { ...query, branchId: 'invalid' }]) assert.throws(() => parseReadQuery(schema, q), status(400));
    for (const body of [{ userId: context.userId }, [], null, '']) assert.throws(() => parseReadQuery(schema, query, body), status(400));
    assert.deepEqual(parseReadQuery(schema, query, {}), query);
  }
  assert.throws(() => parseReadQuery(blockQuerySchema, { ...query, serviceId: randomUUID() }), status(400));
});
test('HU032 availability ownership filters preserve inactive history, civil date and stable order; explicit DTO', async () => {
  const { service, row, prisma } = fixture();
  const result = await service.find({ ...query, branchId: row.branch.id, serviceId: row.service.id, professionalId: row.professional.id }, context);
  const args = prisma.availability.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(args.orderBy, [{ startTime: 'asc' }, { id: 'asc' }]);
  assert.equal(args.where.date.toISOString(), `${query.date}T00:00:00.000Z`);
  for (const relation of ['branch', 'service', 'professional']) {
    assert.deepEqual(args.where[relation], { institutionId: context.institutionId });
    assert.deepEqual(prisma[relation].findFirst.mock.calls[0].arguments[0].where, { id: row[relation].id, institutionId: context.institutionId });
  }
  assert.equal(Object.hasOwn(args.where, 'active'), false);
  assert.deepEqual(result.data.map(r => r.active), [false, true]);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id','date','startTime','endTime','timeZone','active','capacity','origin','branch','service','professional','attentionPoint','createdAt','updatedAt'].sort());
  assert.equal(result.data[0].timeZone, 'America/Santiago'); assert.equal(result.data[0].startTime, '09:00');
  assert.deepEqual(Object.keys(result.data[0].professional).sort(), ['id','firstNames','lastNames','titleOrFunction'].sort());
  assert.equal(JSON.stringify(args.select).includes('lockVersion'), false); assert.equal(JSON.stringify(args.select).includes('createdByUserId'), false);
});
for (const method of ['find', 'blocks']) test(`HU032 ${method} fixed branch and nondisclosing filters`, async () => {
  const { service, prisma, row } = fixture();
  await assert.rejects(service[method](query, { ...context, institutionId: undefined }), status(400));
  await assert.rejects(service[method]({ ...query, branchId: randomUUID() }, { ...context, branchId: row.branch.id }), status(404));
  await service[method](query, { ...context, branchId: row.branch.id });
  assert.equal(prisma[method === 'find' ? 'availability' : 'scheduleBlock'].findMany.mock.calls[0].arguments[0].where.branchId, row.branch.id);
  for (const [model, key] of [['branch','branchId'], ['professional','professionalId'], ...(method === 'find' ? [['service','serviceId']] : [])]) {
    prisma[model].findFirst.mock.mockImplementationOnce(async () => null);
    await assert.rejects(service[method]({ ...query, [key]: randomUUID() }, context), status(404));
  }
});
test('HU032 block intersection uses institutional boundaries, tenant checks and optional public relations', async () => {
  const { service, prisma, row } = fixture();
  const result = await service.blocks({ ...query, professionalId: row.professional.id }, context);
  const args = prisma.scheduleBlock.findMany.mock.calls[0].arguments[0];
  assert.equal(args.where.institutionId, context.institutionId);
  assert.equal(args.where.professionalId, row.professional.id);
  assert.equal(args.where.startsAt.lt.toISOString(), '2026-09-27T03:00:00.000Z');
  assert.equal(args.where.endsAt.gt.toISOString(), '2026-09-26T03:00:00.000Z');
  assert.deepEqual(args.orderBy, [{ startsAt: 'asc' }, { id: 'asc' }]);
  assert.deepEqual(args.where.AND[1], { OR: [{ professionalId: null }, { professional: { institutionId: context.institutionId } }] });
  assert.equal(result.data[1].professional, null);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id','branch','professional','attentionPoint','type','reason','startsAt','endsAt','createdAt'].sort());
});

test('HU032 block boundaries use real 23/25-hour institutional days', async () => {
  const { service, prisma } = fixture();
  prisma.institution.findUnique.mock.mockImplementation(async () => ({ timeZone: 'America/New_York' }));
  for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
    await service.blocks({ date }, context);
    const { where } = prisma.scheduleBlock.findMany.mock.calls.at(-1).arguments[0];
    assert.equal((where.startsAt.lt - where.endsAt.gt) / 3_600_000, hours);
  }
});
