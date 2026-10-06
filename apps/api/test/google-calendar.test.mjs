import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA, PATH_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AppointmentCalendarService, buildCalendarEvent } from '../dist/appointments/appointment-calendar.service.js';
import { GoogleCalendarAdapter, GOOGLE_CALENDAR_SCOPE, calendarEventId } from '../dist/appointments/google-calendar.adapter.js';
import { validateEnvironment } from '../dist/config/environment.validation.js';

const origin = 'http://127.0.0.1:5173', code = 'transient-authorization-code';
const configValues = { GOOGLE_CALENDAR_ENABLED: true, GOOGLE_CLIENT_ID: 'test-web.apps.googleusercontent.com',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'test-only-secret', GOOGLE_CALENDAR_REDIRECT_URI: origin };
const headers = { origin, 'x-requested-with': 'XmlHttpRequest' };
const principal = { userId: randomUUID(), sessionId: randomUUID() };
const hasStatus = (status) => (error) => error?.getStatus?.() === status;
function appointment() {
  const institutionId = randomUUID(), branchId = randomUUID(), serviceId = randomUUID(), professionalId = randomUUID();
  const startsAt = new Date(Date.now() + 86400000), endsAt = new Date(startsAt.getTime() + 1800000);
  return { id: randomUUID(), institutionId, branchId, serviceId, professionalId, attentionPointId: null, startsAt, endsAt,
    status: { code: 'AGENDADA', active: true, isFinal: false }, institution: { timeZone: 'America/Santiago' },
    branch: { institutionId, addressLine1: 'Calle Real 123', addressLine2: null, municipality: 'Santiago', region: 'Metropolitana', country: 'Chile' },
    service: { institutionId, name: 'Orientación' }, professional: { institutionId, user: { firstNames: 'Ana', lastNames: 'Pérez', email: 'private@example.test' } },
    attentionPoint: null, agendaSlot: { startsAt, endsAt, status: 'RESERVED', availability: {
      branchId, serviceId, professionalId, attentionPointId: null, branch: { institutionId } } },
    operationalNote: 'private-operational-note', email: 'private@example.test', nationalId: 'private-national-id',
  };
}
function fixture(row = appointment()) {
  const events = [], config = new ConfigService({ ...configValues }), adapter = new GoogleCalendarAdapter(config);
  const exchange = mock.fn(async () => ({ tokens: { access_token: 'private-access-token', refresh_token: 'private-refresh-token', scope: GOOGLE_CALENDAR_SCOPE } }));
  adapter.createOAuthClient = () => ({ getToken: exchange });
  const send = mock.fn(async (event) => { events.push(event); return Response.json({ private: 'provider-response' }, { status: 200 }); });
  adapter.sendEvent = send;
  const prisma = { user: { findFirst: mock.fn(async () => ({ id: principal.userId })) },
    appointment: { findFirst: mock.fn(async () => row) }, auditEvent: { create: mock.fn(async () => ({})) } };
  const service = new AppointmentCalendarService(prisma, adapter, config);
  const run = (requestHeaders = headers) => service.export(row?.id ?? randomUUID(), code, principal, requestHeaders);
  return { row, config, adapter, exchange, send, prisma, service, events, run };
}

test('Calendar env defaults disabled and identity login needs no client secret', () => {
  const env = { DATABASE_URL: 'postgresql://user:password@localhost:5432/citajusta_dev',
    JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), GOOGLE_AUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: configValues.GOOGLE_CLIENT_ID };
  assert.equal(validateEnvironment(env).GOOGLE_CALENDAR_ENABLED, false);
  const enabled = { ...env, ...configValues, GOOGLE_CALENDAR_ENABLED: 'true' };
  assert.equal(validateEnvironment(enabled).GOOGLE_CALENDAR_ENABLED, true);
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REDIRECT_URI']) {
    assert.throws(() => validateEnvironment({ ...enabled, [key]: '' }), /Invalid environment configuration/);
  }
  for (const value of ['http://external.example', `${origin}/path`, `${origin}/`, 'https://user:secret@example.test', `${origin}?secret=hidden`]) {
    assert.throws(() => validateEnvironment({ ...enabled, GOOGLE_CALENDAR_REDIRECT_URI: value }), (error) => {
      assert.match(error.message, /GOOGLE_CALENDAR_REDIRECT_URI/); assert.ok(!error.message.includes(value)); return true;
    });
  }
});
test('endpoint remains protected and strict, accepting only UUID/code and no tenant/body overrides', async () => {
  const calendar = { export: mock.fn(async () => ({ data: {} })) }, controller = new AppointmentsController({}, calendar);
  const handler = AppointmentsController.prototype.exportCalendar;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController), [AccessTokenGuard]);
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':appointmentId/google-calendar');
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 200);
  const id = randomUUID();
  await controller.exportCalendar({ appointmentId: id }, {}, { code }, { principal, headers });
  assert.deepEqual(calendar.export.mock.calls[0].arguments, [id, code, principal, headers]);
  assert.throws(() => controller.exportCalendar({ appointmentId: id }, {}, { code }, {}), hasStatus(401));
  for (const body of [{}, { code: '' }, { code: ' ' }, { code: 'a'.repeat(4097) }, ...['userId', 'institutionId', 'branchId', 'serviceId', 'professionalId', 'startsAt', 'endsAt', 'status', 'calendarId', 'redirectUri'].map((key) => ({ code, [key]: id }))]) {
    assert.throws(() => controller.exportCalendar({ appointmentId: id }, {}, body, { principal, headers }), hasStatus(400));
  }
  assert.throws(() => controller.exportCalendar({ appointmentId: 'invalid' }, {}, { code }, { principal, headers }), hasStatus(400));
  assert.throws(() => controller.exportCalendar({ appointmentId: id }, { userId: id }, { code }, { principal, headers }), hasStatus(400));
  assert.equal(calendar.export.mock.callCount(), 1);
});
test('event ID is stable, nonpersonal, lowercase base32hex and namespaced only by UUID', () => {
  const id = randomUUID();
  assert.equal(calendarEventId(id), calendarEventId(id.toUpperCase()));
  assert.match(calendarEventId(id), /^[0-9a-v]{5,1024}$/);
  assert.equal(calendarEventId(id), `citajusta${id.replaceAll('-', '')}`);
  assert.notEqual(calendarEventId(id), calendarEventId(randomUUID()));
  assert.throws(() => calendarEventId('email@example.test'));
});
test('disabled/config unavailable prevents queries or Google calls', async () => {
  const f = fixture(); f.config.set('GOOGLE_CALENDAR_ENABLED', false);
  await assert.rejects(f.run(), hasStatus(503));
  assert.equal(f.prisma.appointment.findFirst.mock.callCount(), 0); assert.equal(f.exchange.mock.callCount(), 0);
});
test('popup requires exact configured origin and X-Requested-With before exchange', async () => {
  const f = fixture();
  for (const bad of [{}, { origin }, { ...headers, origin: 'https://evil.example' }, { ...headers, 'x-requested-with': ['XmlHttpRequest'] }]) await assert.rejects(f.run(bad), hasStatus(403));
  assert.equal(f.prisma.appointment.findFirst.mock.callCount(), 0); assert.equal(f.exchange.mock.callCount(), 0);
});
test('export scopes both reads to active owner, exposes a minimal result and changes no appointment/slot/history', async () => {
  const f = fixture(); const result = await f.run();
  assert.deepEqual(result, { data: { appointmentId: f.row.id, eventId: calendarEventId(f.row.id), status: 'CREATED' } });
  assert.equal(f.prisma.appointment.findFirst.mock.callCount(), 2);
  for (const call of f.prisma.appointment.findFirst.mock.calls) assert.deepEqual(call.arguments[0].where, { id: f.row.id, userId: principal.userId, deletedAt: null });
  assert.deepEqual(f.exchange.mock.calls[0].arguments, [{ code, redirect_uri: origin }]);
  assert.doesNotMatch(JSON.stringify(result), /private-|transient-/);
  const audit = f.prisma.auditEvent.create.mock.calls[0].arguments[0].data;
  assert.equal(audit.actionCode, 'GOOGLE_CALENDAR_EVENT_CREATED'); assert.equal(audit.actorUserId, principal.userId);
  assert.equal(audit.resourceId, f.row.id); assert.doesNotMatch(JSON.stringify(audit), /private-|transient-|example.test/);
});
test('inactive/deleted owner cannot export', async () => {
  const f = fixture(); f.prisma.user.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(f.run(), hasStatus(401)); assert.equal(f.exchange.mock.callCount(), 0);
});
for (const label of ['missing', 'foreign', 'deleted']) test(`${label} appointment is indistinguishable 404, no OAuth`, async () => {
  const f = fixture(null); await assert.rejects(f.run(), hasStatus(404)); assert.equal(f.exchange.mock.callCount(), 0);
});
for (const state of ['CANCELADA', 'ATENDIDA', 'INASISTENCIA', 'UNKNOWN']) test(`${state} is not exportable`, async () => {
  const f = fixture(); f.row.status.code = state;
  await assert.rejects(f.run(), hasStatus(409)); assert.equal(f.exchange.mock.callCount(), 0);
});
test('past, invalid interval, inactive/final status and nonreserved/mismatched slot are rejected', async () => {
  for (const mutate of [
    (r) => { r.startsAt = new Date(Date.now() - 1); }, (r) => { r.endsAt = r.startsAt; },
    (r) => { r.startsAt = new Date('invalid'); }, (r) => { r.status.active = false; },
    (r) => { r.status.isFinal = true; }, (r) => { r.agendaSlot.status = 'RELEASED'; },
    (r) => { r.agendaSlot.endsAt = new Date(r.endsAt.getTime() + 1); },
  ]) { const f = fixture(); mutate(f.row); await assert.rejects(f.run(), hasStatus(409)); assert.equal(f.exchange.mock.callCount(), 0); }
});
test('all institution and slot/availability/attention-point incoherences return non-disclosing 404', async () => {
  for (const mutate of [
    ...['branch', 'service', 'professional'].map((relation) => (r) => { r[relation].institutionId = randomUUID(); }),
    (r) => { r.agendaSlot.availability.branch.institutionId = randomUUID(); },
    ...['branchId', 'serviceId', 'professionalId', 'attentionPointId'].map((key) => (r) => { r.agendaSlot.availability[key] = randomUUID(); }),
    (r) => { r.attentionPoint = { branchId: randomUUID() }; },
  ]) { const f = fixture(); mutate(f.row); await assert.rejects(f.run(), hasStatus(404)); assert.equal(f.exchange.mock.callCount(), 0); }
});
test('event uses real service/professional/timezone/address only, no user PII or operational note', () => {
  const r = appointment(), event = buildCalendarEvent(r);
  assert.equal(event.summary, 'CitaJusta · Orientación');
  assert.deepEqual(event.start, { dateTime: r.startsAt.toISOString(), timeZone: 'America/Santiago' });
  assert.deepEqual(event.end, { dateTime: r.endsAt.toISOString(), timeZone: 'America/Santiago' });
  assert.equal(event.location, 'Calle Real 123, Santiago, Metropolitana, Chile');
  assert.match(event.description, /Ana Pérez.*Consulta CitaJusta/); assert.doesNotMatch(JSON.stringify(event), /private-/);
  for (const key of Object.keys(r.branch)) if (key !== 'institutionId') r.branch[key] = null;
  assert.equal(buildCalendarEvent(r).location, undefined);
});
test('invalid institutional timezone fails safely before OAuth', async () => {
  const f = fixture(); f.row.institution.timeZone = 'invalid';
  await assert.rejects(f.run(), hasStatus(503)); assert.equal(f.exchange.mock.callCount(), 0);
});
test('invalid OAuth code is sanitized, creates no event/audit and preserves original appointment', async () => {
  const f = fixture(), before = structuredClone(f.row);
  f.exchange.mock.mockImplementation(async () => { throw { response: { status: 400, data: { error_description: code } } }; });
  await assert.rejects(f.run(), (error) => { assert.equal(error.getStatus(), 400); assert.ok(!JSON.stringify(error.getResponse()).includes(code)); return true; });
  assert.deepEqual(f.row, before); assert.equal(f.send.mock.callCount(), 0); assert.equal(f.prisma.auditEvent.create.mock.callCount(), 0);
});
test('missing/excess-only Calendar scopes fail before insertion', async () => {
  for (const scope of [undefined, 'openid email', 'https://www.googleapis.com/auth/calendar']) {
    const f = fixture(); f.exchange.mock.mockImplementation(async () => ({ tokens: { access_token: 'private-access-token', scope } }));
    await assert.rejects(f.run(), hasStatus(403)); assert.equal(f.send.mock.callCount(), 0);
  }
});
test('OAuth network/5xx and unexpected provider errors are 503, never generic conflicts or leaked objects', async () => {
  for (const failure of [new Error(code), { response: { status: 503, data: code } }]) {
    const f = fixture(); f.exchange.mock.mockImplementation(async () => { throw failure; });
    await assert.rejects(f.run(), hasStatus(503)); assert.equal(f.send.mock.callCount(), 0);
  }
});
test('Calendar network/5xx/429 errors are sanitized and never mutate appointment or audit success', async () => {
  for (const status of [500, 503, 429, 'network']) {
    const f = fixture(), before = structuredClone(f.row);
    f.send.mock.mockImplementation(async () => { if (status === 'network') throw new Error('private-access-token'); return new Response(code, { status }); });
    await assert.rejects(f.run(), hasStatus(503)); assert.deepEqual(f.row, before); assert.equal(f.prisma.auditEvent.create.mock.callCount(), 0);
  }
});
test('duplicate deterministic ID is success ALREADY_EXISTS without another success audit', async () => {
  const f = fixture(); f.send.mock.mockImplementation(async () => new Response('private-provider-body', { status: 409 }));
  assert.deepEqual(await f.run(), { data: { appointmentId: f.row.id, eventId: calendarEventId(f.row.id), status: 'ALREADY_EXISTS' } });
  assert.equal(f.prisma.auditEvent.create.mock.callCount(), 0);
});
test('cancellation/transfer during exchange is revalidated before sending Calendar event', async () => {
  for (const transfer of [false, true]) {
    const f = fixture(); f.exchange.mock.mockImplementation(async () => {
      if (transfer) f.prisma.appointment.findFirst.mock.mockImplementation(async () => null); else f.row.status.code = 'CANCELADA';
      return { tokens: { access_token: 'private-access-token', scope: GOOGLE_CALENDAR_SCOPE } };
    });
    await assert.rejects(f.run(), hasStatus(transfer ? 404 : 409)); assert.equal(f.send.mock.callCount(), 0);
  }
});
test('OAuth transport has bounded timeout, no retries and no persistent credentials', async () => {
  const adapter = new GoogleCalendarAdapter(new ConfigService(configValues)), client = adapter.createOAuthClient();
  const interceptor = [...client.transporter.interceptors.request].at(-1);
  const options = await interceptor.resolved({});
  assert.equal(options.timeout, 10000); assert.equal(options.retry, false); assert.ok(options.signal);
  assert.deepEqual(client.credentials, {});
});
test('audit outage cannot undo an external creation and logs only a fixed non-sensitive warning', async () => {
  const f = fixture(); f.prisma.auditEvent.create.mock.mockImplementation(async () => { throw new Error(code); });
  const warn = mock.method(f.service.logger, 'warn');
  assert.equal((await f.run()).data.status, 'CREATED');
  assert.deepEqual(warn.mock.calls[0].arguments, ['Google Calendar export audit unavailable']);
  warn.mock.restore();
});
