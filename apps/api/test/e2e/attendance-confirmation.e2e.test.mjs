import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, getE2ePort } from './local-environment.mjs';
import { assertE2EFixtureDatabase } from '../../scripts/e2e-docker-environment.mjs';

test('RF016 real isolated PostgreSQL confirmation, ownership epochs and serialized races', { timeout: 150000 }, async t => {
  loadApiEnvironment();
  const [{ AppModule }, { configureApplication }, { PrismaService }, { AuditService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'), import('../../dist/audit/audit.service.js'),
  ]);
  const prefix = `e2e_rf016+${randomUUID()}-`, institutionId = randomUUID(), branchId = randomUUID(), serviceId = randomUUID(), professionalId = randomUUID(),
    availabilityId = randomUUID(), statusId = randomUUID(), finalStatusId = randomUUID(), roleId = randomUUID();
  const ownedUsers = [], emails = [], appointmentIds = [], permissionIds = [];
  const app = await NestFactory.create(AppModule, { logger: false }); let prisma, base, number = 0;
  const futureBase = new Date(); futureBase.setUTCDate(futureBase.getUTCDate() + 7); futureBase.setUTCHours(8, 0, 0, 0);
  async function request(method, path, token, body, headers = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function register(name) {
    const credentials = { email: `${prefix}${name}@example.test`, password: `Rf016-${randomUUID()}-Aa1!` }; emails.push(credentials.email);
    const created = await request('POST', '/auth/register', undefined, { ...credentials, firstName: 'Confirmation', lastName: 'Fixture' });
    assert.equal(created.status, 201); ownedUsers.push(created.body.id);
    const pair = await request('POST', '/auth/login', undefined, credentials); assert.equal(pair.status, 200);
    return { id: created.body.id, token: pair.body.accessToken, credentials };
  }
  const confirm = (row, user, body, headers) => request('POST', `/appointments/${row.id}/confirm-attendance`, user?.token, body, headers);
  const mine = user => request('GET', '/appointments/me', user.token);
  async function fixture(user, overrides = {}) {
    const startsAt = new Date(+futureBase + (++number) * 1800000), endsAt = new Date(+startsAt + 1800000);
    const slot = await prisma.agendaSlot.create({ data: { id: randomUUID(), availabilityId, startsAt, endsAt, status: 'RESERVED' } });
    const row = await prisma.appointment.create({ data: { id: randomUUID(), institutionId, branchId, serviceId, professionalId, agendaSlotId: slot.id,
      userId: user.id, statusId, startsAt, endsAt, origin: 'WEB', ...overrides } }); appointmentIds.push(row.id);
    await prisma.appointmentHistory.create({ data: { id: randomUUID(), appointmentId: row.id, newStatusId: row.statusId, newUserId: user.id, actorUserId: user.id } });
    return row;
  }
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService); await assertE2EFixtureDatabase(prisma);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const owner = await register('owner'), other = await register('other'), operator = await register('operator');
    await prisma.institution.create({ data: { id: institutionId, name: prefix } });
    await prisma.branch.create({ data: { id: branchId, institutionId, code: prefix, name: 'Confirmation fixture' } });
    await prisma.service.create({ data: { id: serviceId, institutionId, code: prefix, name: 'Confirmation fixture', durationMinutes: 30, requiresConfirmation: true } });
    await prisma.serviceBranch.create({ data: { branchId, serviceId } });
    await prisma.professional.create({ data: { id: professionalId, institutionId, userId: operator.id } });
    await prisma.professionalBranch.create({ data: { professionalId, branchId } }); await prisma.professionalService.create({ data: { professionalId, serviceId } });
    await prisma.availability.create({ data: { id: availabilityId, branchId, serviceId, professionalId, date: new Date(futureBase.toISOString().slice(0, 10)), startTime: new Date('1970-01-01T00:00:00Z'), endTime: new Date('1970-01-01T23:59:00Z') } });
    // Only owned fixture catalogs. Never change the pre-existing AGENDADA configuration.
    await prisma.appointmentStatus.createMany({ data: [
      { id: statusId, code: prefix, name: 'Confirmation fixture', active: true, isFinal: false, allowsConfirmation: true },
      { id: finalStatusId, code: `${prefix}FINAL`, name: 'Final fixture', active: true, isFinal: true },
    ] });
    let permission = await prisma.permission.findUnique({ where: { code: 'appointments.attendance' } });
    if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code: 'appointments.attendance', module: 'appointments', action: 'attendance' } }); permissionIds.push(permission.id); }
    await prisma.role.create({ data: { id: roleId, code: prefix, name: 'Confirmation fixture', scope: 'INSTITUTION' } });
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    await prisma.userRole.create({ data: { id: randomUUID(), userId: operator.id, roleId, institutionId } });

    await t.test('own eligible appointment confirms once, persists across sessions and changes no appointment/slot/history', async () => {
      const row = await fixture(owner), slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: row.agendaSlotId } });
      const history = await prisma.appointmentHistory.findMany({ where: { appointmentId: row.id } });
      assert.equal((await mine(owner)).body.data.find(item => item.id === row.id).attendanceConfirmation.canConfirm, true);
      const response = await confirm(row, owner); assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.body.data).sort(), ['appointmentId', 'confirmed', 'confirmedAt'].sort());
      assert.deepEqual(await confirm(row, owner), response);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: row.id } }), row);
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: row.agendaSlotId } }), slot);
      assert.deepEqual(await prisma.appointmentHistory.findMany({ where: { appointmentId: row.id } }), history);
      assert.equal(await prisma.confirmation.count({ where: { appointmentId: row.id } }), 1);
      const confirmation = await prisma.confirmation.findFirstOrThrow({ where: { appointmentId: row.id } });
      assert.equal(confirmation.userId, owner.id); assert.equal(confirmation.confirmed, true); assert.equal(confirmation.channel, 'INTERNAL'); assert.equal(confirmation.comment, null);
      const login = await request('POST', '/auth/login', undefined, owner.credentials); assert.equal(login.status, 200);
      const actual = (await mine({ ...owner, token: login.body.accessToken })).body.data.find(item => item.id === row.id);
      assert.deepEqual(actual.attendanceConfirmation, { required: true, confirmed: true, confirmedAt: response.body.data.confirmedAt, canConfirm: false });
    });
    await t.test('auth, strict request and context isolation preserve indistinguishable missing/foreign responses', async () => {
      const row = await fixture(owner);
      assert.equal((await confirm(row)).status, 401);
      const missing = await confirm({ id: randomUUID() }, other), foreign = await confirm(row, other);
      assert.equal(missing.status, 404); assert.deepEqual(foreign, missing);
      for (const body of [{ userId: other.id }, { confirmed: false }, { institutionId }, { channel: 'EMAIL' }, { comment: 'no' }]) assert.equal((await confirm(row, owner, body)).status, 400);
      assert.equal((await request('POST', `/appointments/${row.id}/confirm-attendance?userId=${other.id}`, owner.token)).status, 400);
      assert.equal((await request('POST', '/appointments/bad/confirm-attendance', owner.token)).status, 400);
      assert.equal((await confirm(row, owner, undefined, { 'x-institution-id': institutionId, 'x-branch-id': randomUUID() })).status, 400);
      assert.equal(await prisma.confirmation.count({ where: { appointmentId: row.id } }), 0);
    });
    await t.test('service/status gates, final/past/deleted records and inconsistent slots deny confirmation', async () => {
      const row = await fixture(owner);
      await prisma.service.update({ where: { id: serviceId }, data: { requiresConfirmation: false } });
      assert.equal((await confirm(row, owner)).status, 409);
      assert.equal((await mine(owner)).body.data.find(item => item.id === row.id).attendanceConfirmation.required, false);
      await prisma.service.update({ where: { id: serviceId }, data: { requiresConfirmation: true } });
      await prisma.appointmentStatus.update({ where: { id: statusId }, data: { allowsConfirmation: false } }); assert.equal((await confirm(row, owner)).status, 409);
      await prisma.appointmentStatus.update({ where: { id: statusId }, data: { allowsConfirmation: true } });
      await prisma.appointment.update({ where: { id: row.id }, data: { statusId: finalStatusId } }); assert.equal((await confirm(row, owner)).status, 409);
      await prisma.appointment.update({ where: { id: row.id }, data: { statusId, startsAt: new Date(0) } }); assert.equal((await confirm(row, owner)).status, 409);
      await prisma.appointment.update({ where: { id: row.id }, data: { startsAt: row.startsAt } });
      await prisma.agendaSlot.update({ where: { id: row.agendaSlotId }, data: { status: 'RELEASED' } }); assert.equal((await confirm(row, owner)).status, 409);
      await prisma.appointment.update({ where: { id: row.id }, data: { deletedAt: new Date() } }); assert.equal((await confirm(row, owner)).status, 404);
      assert.equal(await prisma.confirmation.count({ where: { appointmentId: row.id } }), 0);
    });
    await t.test('simultaneous confirmations produce one record, one audit and the same successful DTO', async () => {
      const row = await fixture(owner);
      const result = await Promise.all([confirm(row, owner), confirm(row, owner)]);
      assert.deepEqual(result.map(item => item.status), [200, 200]); assert.deepEqual(result[0].body, result[1].body);
      assert.equal(await prisma.confirmation.count({ where: { appointmentId: row.id } }), 1);
      assert.equal(await prisma.auditEvent.count({ where: { resourceId: row.id, actionCode: 'APPOINTMENT_ATTENDANCE_CONFIRMED' } }), 1);
    });
    await t.test('audit outage rolls real INSERT back and a later retry can confirm', async () => {
      const row = await fixture(owner), original = AuditService.record; let inserted = false;
      const spy = t.mock.method(AuditService, 'record', async (tx, input) => {
        if (input.actionCode !== 'APPOINTMENT_ATTENDANCE_CONFIRMED') return original(tx, input);
        inserted = await tx.confirmation.count({ where: { appointmentId: row.id } }) === 1; throw new Error('private fixture failure');
      });
      try { const response = await confirm(row, owner); assert.equal(response.status, 500); assert.ok(inserted); assert.ok(!JSON.stringify(response.body).includes('private')); }
      finally { spy.mock.restore(); }
      assert.equal(await prisma.confirmation.count({ where: { appointmentId: row.id } }), 0);
      assert.equal((await confirm(row, owner)).status, 200);
    });
    await t.test('concurrent status change never leaves an actionable final appointment or mutates its slot', async () => {
      for (let i = 0; i < 3; i++) {
        const row = await fixture(owner), slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: row.agendaSlotId } });
        const [response] = await Promise.all([confirm(row, owner), prisma.$transaction(tx => tx.appointment.update({ where: { id: row.id }, data: { statusId: finalStatusId } }), { isolationLevel: 'Serializable' })]);
        assert.ok([200, 409].includes(response.status)); assert.equal((await confirm(row, owner)).status, 409);
        const count = await prisma.confirmation.count({ where: { appointmentId: row.id } }); assert.equal(count, response.status === 200 ? 1 : 0);
        assert.equal((await mine(owner)).body.data.find(item => item.id === row.id).attendanceConfirmation.canConfirm, false);
        assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: row.agendaSlotId } }), slot);
      }
    });
    await t.test('historical positive records are preserved but A -> B -> A cannot inherit the earlier confirmation', async () => {
      const row = await fixture(owner); assert.equal((await confirm(row, owner)).status, 200);
      const previous = await prisma.confirmation.findFirstOrThrow({ where: { appointmentId: row.id } });
      async function transfer(from, to) {
        await prisma.$transaction(async tx => {
          await tx.appointment.update({ where: { id: row.id }, data: { userId: to.id } });
          await tx.appointmentHistory.create({ data: { id: randomUUID(), appointmentId: row.id, previousStatusId: statusId, newStatusId: statusId,
            previousUserId: from.id, newUserId: to.id, reason: 'RF016_FIXTURE_OWNERSHIP' } });
        }, { isolationLevel: 'Serializable' });
      }
      await transfer(owner, other);
      assert.equal((await mine(other)).body.data.find(item => item.id === row.id).attendanceConfirmation.confirmed, false);
      assert.equal((await confirm(row, owner)).status, 404);
      await transfer(other, owner);
      const current = (await mine(owner)).body.data.find(item => item.id === row.id).attendanceConfirmation;
      assert.equal(current.confirmed, false); assert.equal(current.canConfirm, true);
      assert.equal((await confirm(row, owner)).status, 200); assert.equal(await prisma.confirmation.count({ where: { appointmentId: row.id } }), 2);
      assert.deepEqual(await prisma.confirmation.findUniqueOrThrow({ where: { id: previous.id } }), previous);
    });
    await t.test('HU017 attendance still records the effective outcome without consuming or rewriting confirmation', async () => {
      const row = await fixture(owner); assert.equal((await confirm(row, owner)).status, 200);
      const positive = await prisma.confirmation.findFirstOrThrow({ where: { appointmentId: row.id } });
      const scheduled = await prisma.appointmentStatus.findUniqueOrThrow({ where: { code: 'AGENDADA' } });
      await prisma.appointment.update({ where: { id: row.id }, data: { statusId: scheduled.id } });
      const actual = await request('POST', `/appointments/${row.id}/attendance`, operator.token, { status: 'ATENDIDA' }, { 'x-institution-id': institutionId });
      assert.equal(actual.status, 200); assert.equal(actual.body.data.status.code, 'ATENDIDA');
      assert.deepEqual(await prisma.confirmation.findUniqueOrThrow({ where: { id: positive.id } }), positive);
      assert.equal((await confirm(row, owner)).status, 409);
    });
    await t.test('revoked sessions and inactive accounts cannot confirm; catalog changes do not hide owned history', async () => {
      const disabled = await register('disabled'), row = await fixture(disabled);
      await prisma.authSession.updateMany({ where: { userId: disabled.id }, data: { revokedAt: new Date() } }); assert.equal((await confirm(row, disabled)).status, 401);
      const login = await request('POST', '/auth/login', undefined, disabled.credentials); assert.equal(login.status, 200); disabled.token = login.body.accessToken;
      await prisma.user.update({ where: { id: disabled.id }, data: { status: 'INACTIVE' } }); assert.equal((await confirm(row, disabled)).status, 401);
      await prisma.service.update({ where: { id: serviceId }, data: { active: false } });
      const records = (await mine(owner)).body.data; assert.ok(records.length > 0); assert.ok(records.every(item => !item.attendanceConfirmation.canConfirm));
      const audits = await prisma.auditEvent.findMany({ where: { institutionId, actionCode: 'APPOINTMENT_ATTENDANCE_CONFIRMED' } });
      assert.ok(audits.length); assert.ok(audits.every(row => row.actorUserId === owner.id));
      assert.doesNotMatch(JSON.stringify(audits), /password|comment|firstName|email|confirmedAt/);
    });
  } finally {
    if (prisma) {
      try {
        await assertE2EFixtureDatabase(prisma);
        const users = await prisma.user.findMany({ where: { id: { in: ownedUsers } }, select: { email: true } });
        assert.ok(users.every(user => emails.includes(user.email) && user.email.startsWith(prefix)));
        const institution = await prisma.institution.findUnique({ where: { id: institutionId } }); if (institution) assert.equal(institution.name, prefix);
        const scope = { id: { in: appointmentIds }, institutionId };
        await prisma.confirmation.deleteMany({ where: { appointment: scope, userId: { in: ownedUsers } } });
        await prisma.appointmentHistory.deleteMany({ where: { appointment: scope } }); await prisma.appointment.deleteMany({ where: scope });
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: [statusId, finalStatusId] }, code: { startsWith: prefix } } });
        await prisma.agendaSlot.deleteMany({ where: { availabilityId } }); await prisma.availability.deleteMany({ where: { id: availabilityId, branchId } });
        await prisma.professionalBranch.deleteMany({ where: { professionalId, branchId } }); await prisma.professionalService.deleteMany({ where: { professionalId, serviceId } });
        await prisma.professional.deleteMany({ where: { id: professionalId, institutionId } }); await prisma.serviceBranch.deleteMany({ where: { serviceId, branchId } });
        await prisma.service.deleteMany({ where: { id: serviceId, institutionId } }); await prisma.branch.deleteMany({ where: { id: branchId, institutionId } });
        await prisma.auditEvent.deleteMany({ where: { OR: [{ institutionId }, { actorUserId: { in: ownedUsers } }] } });
        await prisma.userRole.deleteMany({ where: { roleId, userId: { in: ownedUsers } } }); await prisma.rolePermission.deleteMany({ where: { roleId } });
        await prisma.role.deleteMany({ where: { id: roleId, code: prefix } }); await prisma.permission.deleteMany({ where: { id: { in: permissionIds } } });
        await prisma.institution.deleteMany({ where: { id: institutionId, name: prefix } }); await prisma.authSession.deleteMany({ where: { userId: { in: ownedUsers } } });
        await prisma.user.deleteMany({ where: { id: { in: ownedUsers }, email: { startsWith: prefix } } });
        assert.equal(await prisma.confirmation.count({ where: { appointmentId: { in: appointmentIds } } }), 0);
        assert.equal(await prisma.appointmentStatus.count({ where: { id: { in: [statusId, finalStatusId] } } }), 0);
        assert.equal(await prisma.institution.count({ where: { id: institutionId } }), 0);
        assert.equal(await prisma.auditEvent.count({ where: { institutionId } }), 0); assert.equal(await prisma.user.count({ where: { email: { startsWith: prefix } } }), 0);
      } finally { await app.close(); }
    } else await app.close();
  }
});
