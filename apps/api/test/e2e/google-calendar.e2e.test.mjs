import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-041 real HTTP/PostgreSQL with only Google transport mocked', { timeout: 120000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test'; process.env.GOOGLE_AUTH_ENABLED = 'false';
  process.env.GOOGLE_CALENDAR_ENABLED = 'true'; process.env.GOOGLE_CLIENT_ID = 'calendar-test.apps.googleusercontent.com';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'e2e-placeholder-not-a-real-secret';
  const origin = 'http://127.0.0.1:5173'; process.env.GOOGLE_CALENDAR_REDIRECT_URI = origin;
  const [{ AppModule }, { configureApplication }, { PrismaService }, { GoogleCalendarAdapter, GOOGLE_CALENDAR_SCOPE }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/appointments/google-calendar.adapter.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma, cleanupEnabled = false, mode = '', appointment, first, second;
  const events = new Map(), exchangeCalls = [], insertCalls = [];
  try {
    const adapter = app.get(GoogleCalendarAdapter);
    t.mock.method(adapter, 'createOAuthClient', () => ({ getToken: async ({ code }) => {
      exchangeCalls.push(code); mode = code;
      if (code === 'invalid') throw { response: { status: 400, data: { error_description: 'private-provider-code' } } };
      return { tokens: { access_token: 'private-access-token', refresh_token: 'private-refresh-token', scope: code === 'scope-denied' ? 'openid' : GOOGLE_CALENDAR_SCOPE } };
    } }));
    t.mock.method(adapter, 'sendEvent', async (event) => {
      insertCalls.push(structuredClone(event));
      if (mode === 'provider-down') return new Response('private-provider-code', { status: 503 });
      if (mode === 'network') throw new Error('private-access-token');
      if (events.has(event.id)) return new Response('private-provider-body', { status: 409 });
      events.set(event.id, event); return Response.json({ ignoredProviderData: 'private' });
    });
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function post(path, body, token, extra = {}) {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    async function register() {
      const input = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.test`, password: `E2e-${randomUUID()}-Aa1!`, firstName: 'Calendar', lastName: 'Fixture' };
      const registered = await post('/auth/register', input); assert.equal(registered.status, 201);
      const login = await post('/auth/login', { email: input.email, password: input.password }); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken };
    }
    first = await register(); second = await register(); await createCheckpointFixtures(prisma, first.id);
    await prisma.branch.update({ where: { id: ids.branchA1 }, data: { addressLine1: 'Dirección fixture', municipality: 'Santiago', region: 'Metropolitana' } });
    const booking = await post('/appointments', { agendaSlotId: ids.slotAvailable }, first.token); assert.equal(booking.status, 201);
    appointment = booking.body.data;
    const popupHeaders = { origin, 'x-requested-with': 'XmlHttpRequest' };
    const exportAppointment = (code = 'valid', token = first.token, appointmentId = appointment.id, headers = popupHeaders, body = { code }) =>
      post(`/appointments/${appointmentId}/google-calendar`, body, token, headers);
    const snapshot = async () => ({
      appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
      slot: await prisma.agendaSlot.findUniqueOrThrow({ where: { id: appointment.agendaSlotId } }),
      history: await prisma.appointmentHistory.findMany({ where: { appointmentId: appointment.id }, orderBy: { id: 'asc' } }),
      cancellations: await prisma.cancellation.count({ where: { appointmentId: appointment.id } }),
    });
    await t.test('Bearer required; UUID, strict body and forbidden query rejected without provider calls', async () => {
      assert.equal((await exportAppointment('valid', null)).status, 401);
      assert.equal((await exportAppointment('valid', first.token, 'bad-id')).status, 400);
      for (const body of [{}, { code: '' }, { code: ' ' }, { code: 'a'.repeat(4097) },
        ...['userId', 'institutionId', 'branchId', 'serviceId', 'professionalId', 'startsAt', 'endsAt', 'calendarId', 'redirectUri'].map((key) => ({ code: 'valid', [key]: ids.missing }))]) {
        assert.equal((await exportAppointment('valid', first.token, appointment.id, popupHeaders, body)).status, 400);
      }
      assert.equal((await post(`/appointments/${appointment.id}/google-calendar?userId=${second.id}`, { code: 'valid' }, first.token, popupHeaders)).status, 400);
      assert.equal(exchangeCalls.length, 0);
    });
    await t.test('popup custom header and exact Web origin required without weakening global CORS', async () => {
      for (const headers of [{}, { origin }, { ...popupHeaders, origin: 'https://evil.example' }]) assert.equal((await exportAppointment('valid', first.token, appointment.id, headers)).status, 403);
      assert.equal(exchangeCalls.length, 0);
    });
    await t.test('foreign/missing/deleted appointment have indistinguishable 404; tenant headers cannot grant ownership', async () => {
      const foreign = await exportAppointment('valid', second.token, appointment.id, { ...popupHeaders, 'x-institution-id': ids.institutionA });
      const missing = await exportAppointment('valid', second.token, ids.missing);
      assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
      await prisma.appointment.update({ where: { id: appointment.id }, data: { deletedAt: new Date() } });
      try { assert.equal((await exportAppointment()).status, 404); }
      finally { await prisma.appointment.update({ where: { id: appointment.id }, data: { deletedAt: null } }); }
      assert.equal(exchangeCalls.length, 0);
    });
    await t.test('inconsistent tenant relations are hidden and not exported', async () => {
      await prisma.professional.update({ where: { id: appointment.professionalId }, data: { institutionId: ids.institutionB } });
      try { assert.equal((await exportAppointment()).status, 404); }
      finally { await prisma.professional.update({ where: { id: appointment.professionalId }, data: { institutionId: ids.institutionA } }); }
      assert.equal(exchangeCalls.length, 0);
    });
    await t.test('CANCELADA/ATENDIDA/INASISTENCIA and past/invalid intervals reject before OAuth', async () => {
      const scheduled = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      for (const state of ['CANCELADA', 'ATENDIDA', 'INASISTENCIA']) {
        const status = await prisma.appointmentStatus.findUniqueOrThrow({ where: { code: state } });
        await prisma.appointment.update({ where: { id: appointment.id }, data: { statusId: status.id } });
        try { assert.equal((await exportAppointment()).status, 409); }
        finally { await prisma.appointment.update({ where: { id: appointment.id }, data: { statusId: scheduled.statusId } }); }
      }
      for (const data of [{ startsAt: new Date(Date.now() - 1000) }, { endsAt: scheduled.startsAt }]) {
        await prisma.appointment.update({ where: { id: appointment.id }, data });
        try { assert.equal((await exportAppointment()).status, 409); }
        finally { await prisma.appointment.update({ where: { id: appointment.id }, data: { startsAt: scheduled.startsAt, endsAt: scheduled.endsAt } }); }
      }
      assert.equal(exchangeCalls.length, 0);
    });
    await t.test('invalid code, denied scope and external failure sanitize output and preserve appointment/slot/history', async () => {
      const before = await snapshot(), auditCount = await prisma.auditEvent.count({ where: { resourceId: appointment.id } });
      for (const [code, expected] of [['invalid', 400], ['scope-denied', 403], ['provider-down', 503], ['network', 503]]) {
        const result = await exportAppointment(code); assert.equal(result.status, expected);
        assert.doesNotMatch(JSON.stringify(result.body), /private-|refresh_token|access_token/);
        assert.deepEqual(await snapshot(), before);
      }
      assert.equal(await prisma.auditEvent.count({ where: { resourceId: appointment.id } }), auditCount);
    });
    await t.test('own future AGENDADA inserts real data with institutional timezone and minimal USER audit', async () => {
      const before = await snapshot(), result = await exportAppointment(); assert.equal(result.status, 200);
      assert.deepEqual(result.body, { data: { appointmentId: appointment.id, eventId: `citajusta${appointment.id.replaceAll('-', '')}`, status: 'CREATED' } });
      assert.deepEqual(await snapshot(), before);
      const event = events.get(result.body.data.eventId), service = await prisma.service.findUniqueOrThrow({ where: { id: appointment.serviceId } });
      assert.equal(event.summary, `CitaJusta · ${service.name}`); assert.equal(event.start.dateTime, appointment.startsAt);
      assert.equal(event.end.dateTime, appointment.endsAt); assert.equal(event.start.timeZone, 'America/Santiago');
      assert.match(event.location, /Dirección fixture.*Santiago.*Metropolitana.*Chile/);
      assert.doesNotMatch(JSON.stringify(event), /private-|password|operationalNote|example.test/);
      const audit = await prisma.auditEvent.findMany({ where: { resourceId: appointment.id, actionCode: 'GOOGLE_CALENDAR_EVENT_CREATED' } });
      assert.equal(audit.length, 1); assert.equal(audit[0].actorUserId, first.id); assert.equal(audit[0].actorType, 'USER');
      assert.doesNotMatch(JSON.stringify(audit), /private-|valid|scope-denied/);
    });
    await t.test('repeat and simultaneous fresh codes return idempotent success without a second event or audit', async () => {
      const results = await Promise.all([exportAppointment('fresh-1'), exportAppointment('fresh-2')]);
      for (const result of results) { assert.equal(result.status, 200); assert.equal(result.body.data.status, 'ALREADY_EXISTS'); }
      assert.equal(events.size, 1);
      assert.equal(await prisma.auditEvent.count({ where: { resourceId: appointment.id, actionCode: 'GOOGLE_CALENDAR_EVENT_CREATED' } }), 1);
    });
    await t.test('feature disabled is a controlled 503 with no additional OAuth request', async () => {
      const { ConfigService } = await import('@nestjs/config'); const config = app.get(ConfigService);
      const before = exchangeCalls.length; config.set('GOOGLE_CALENDAR_ENABLED', false);
      try { assert.equal((await exportAppointment()).status, 503); }
      finally { config.set('GOOGLE_CALENDAR_ENABLED', true); }
      assert.equal(exchangeCalls.length, before);
    });
  } finally {
    try { if (prisma && cleanupEnabled) { await cleanupCheckpointFixtures(prisma); await assertCheckpointIsClean(prisma); } }
    finally { await app.close(); }
  }
});
