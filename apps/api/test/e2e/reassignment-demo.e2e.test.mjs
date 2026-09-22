import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { developmentClient } from '../../scripts/development-runtime.mjs';
import { reassignmentDemoDomain } from '../../scripts/seed-reassignment-demo.mjs';
import { validateEnvironment } from '../../dist/config/environment.validation.js';
import { prepareReassignmentDemo, reassignmentDemoIdentity } from '../../dist/database/reassignment-demo.js';
import { demo } from '../../dist/database/development.js';

test('local demo uses real services, isolates recipients/scenarios and resumes without duplicate effects', { timeout: 120_000 }, async (t) => {
  const prisma = developmentClient(); // Same local/development safeguards as CLI; never overrides NODE_ENV.
  const recipientId = randomUUID(); const foreignId = randomUUID();
  const email = `demo-tooling-test-${recipientId}@example.invalid`;
  const identities = ['reject', 'accept'].map((scenario) => reassignmentDemoIdentity(recipientId, scenario));
  const domain = reassignmentDemoDomain(prisma, new ConfigService(validateEnvironment(process.env)));
  const options = { connectionString: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, email, scenario: 'reject' };
  const calls = [];
  for (const [key, method] of [['catalog', 'createService'], ['professionals', 'create'], ['availability', 'create'], ['appointments', 'reserve'], ['appointments', 'cancel'], ['waitlist', 'enter'], ['preferences', 'replace'], ['reassignments', 'generate']]) {
    const original = domain[key][method].bind(domain[key]);
    domain[key][method] = (...args) => { calls.push(`${key}.${method}`); return original(...args); };
  }
  let reject; let accept;
  try {
    for (const [id, address] of [[recipientId, email], [foreignId, `demo-tooling-test-${foreignId}@example.invalid`]]) {
      await prisma.user.create({ data: { id, email: address, passwordHash: '!TEST_NO_LOGIN!', firstNames: 'Prueba', lastNames: 'Tooling', status: 'ACTIVE' } });
    }
    const recipientBefore = await prisma.user.findUniqueOrThrow({ where: { id: recipientId } });
    const foreignBefore = await prisma.user.findUniqueOrThrow({ where: { id: foreignId } });
    await t.test('first run generates PENDING through booking, cancellation, preferences and HU-009', async () => {
      reject = await prepareReassignmentDemo(prisma, domain, options);
      assert.equal(reject.reused, false); assert.equal(reject.offer.status, 'PENDING');
      for (const expected of ['catalog.createService', 'professionals.create', 'availability.create', 'appointments.reserve', 'appointments.cancel', 'waitlist.enter', 'preferences.replace']) assert.ok(calls.includes(expected), expected);
      assert.ok(!calls.includes('reassignments.generate'), 'HU-025 already generated the first offer in cancellation');
      const stored = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: reject.offer.id }, include: { candidate: true, reassignment: { include: { agendaSlot: true, appointment: { include: { status: true, historyEntries: true } } } } } });
      assert.equal(stored.candidate.userId, recipientId);
      assert.equal(stored.reassignment.agendaSlot.status, 'RELEASED');
      assert.equal(stored.reassignment.appointment.status.code, 'CANCELADA');
      assert.equal(stored.reassignment.appointment.historyEntries.length, 2);
      assert.ok(stored.expiresAt > stored.createdAt);
      assert.ok((await domain.offers.findMine({ userId: recipientId, sessionId: randomUUID() })).data.some((o) => o.id === reject.offer.id));
      assert.deepEqual((await domain.offers.findMine({ userId: foreignId, sessionId: randomUUID() })).data, []);
    });
    await t.test('second PENDING run preserves offer/process/slot/history/preferences exactly and does not call writes again', async () => {
      const snapshot = () => prisma.appointmentOffer.findUniqueOrThrow({ where: { id: reject.offer.id }, include: {
        candidate: { include: { waitlistEntry: { include: { preference: true } } } },
        reassignment: { include: { agendaSlot: true, appointment: { include: { historyEntries: true } } } },
      } });
      const before = await snapshot(); const count = calls.length;
      const second = await prepareReassignmentDemo(prisma, domain, options);
      assert.equal(second.reused, true); assert.deepEqual(second.offer, reject.offer);
      assert.equal(calls.length, count); assert.deepEqual(await snapshot(), before);
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: before.agendaSlotId, status: 'PENDING' } }), 1);
    });
    await t.test('incompatible catalog and foreign enrollment stop without overwriting', async () => {
      const serviceId = reject.offer.service.id;
      const before = await prisma.service.findUniqueOrThrow({ where: { id: serviceId } });
      await prisma.service.update({ where: { id: serviceId }, data: { description: 'OWNED BY SOMEONE ELSE' } });
      try {
        await assert.rejects(prepareReassignmentDemo(prisma, domain, options), /Colisión/);
        assert.equal((await prisma.service.findUniqueOrThrow({ where: { id: serviceId } })).description, 'OWNED BY SOMEONE ELSE');
      } finally { await prisma.service.update({ where: { id: serviceId }, data: { description: before.description, updatedAt: before.updatedAt } }); }
      const foreignEntry = await domain.waitlist.enter({ serviceId, branchId: demo.branch.id }, { userId: foreignId, sessionId: randomUUID() });
      try { await assert.rejects(prepareReassignmentDemo(prisma, domain, options), /solicitudes ajenas/); }
      finally { await prisma.waitlistEntry.delete({ where: { id: foreignEntry.data.id } }); }
    });
    await t.test('accept scenario is separate; public recipient account, password, roles and sessions untouched', async () => {
      accept = await prepareReassignmentDemo(prisma, domain, { ...options, scenario: 'accept' });
      assert.notEqual(accept.offer.id, reject.offer.id); assert.notEqual(accept.offer.service.id, reject.offer.service.id);
      assert.notEqual(accept.offer.professional.id, reject.offer.professional.id);
      assert.equal((await prepareReassignmentDemo(prisma, domain, { ...options, scenario: 'accept' })).offer.id, accept.offer.id);
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: recipientId } }), recipientBefore);
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: foreignId } }), foreignBefore);
      assert.equal(await prisma.userRole.count({ where: { userId: recipientId } }), 0);
      assert.equal(await prisma.authSession.count({ where: { userId: recipientId } }), 0);
    });
    await t.test('elapsed PENDING is reported without renewing timestamps or generating a replacement', async () => {
      const stored = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: reject.offer.id } });
      try {
        await prisma.appointmentOffer.update({ where: { id: stored.id }, data: { createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) } });
        const count = calls.length;
        const elapsed = await prepareReassignmentDemo(prisma, domain, options);
        assert.equal(elapsed.offer.id, stored.id); assert.equal(elapsed.offer.status, 'PENDING'); assert.equal(elapsed.elapsed, true);
        assert.equal(calls.length, count);
        assert.ok(Date.parse(elapsed.offer.expiresAt) < Date.now());
      } finally { await prisma.appointmentOffer.update({ where: { id: stored.id }, data: { createdAt: stored.createdAt, expiresAt: stored.expiresAt } }); }
    });
    await t.test('a finalized test offer is reported as consumed, never revived (test identity only)', async () => {
      await domain.reassignments.rejectOffer(reject.offer.id, { userId: recipientId, sessionId: randomUUID() });
      const consumed = await prepareReassignmentDemo(prisma, domain, options);
      assert.equal(consumed.reused, true); assert.equal(consumed.offer.status, 'REJECTED');
      assert.equal(consumed.offer.id, reject.offer.id);
    });
  } finally {
    try {
      // Only this random test recipient's two scenario resources. Shared demo foundation is reusable.
      const services = await prisma.service.findMany({ where: { institutionId: demo.institution.id, code: { in: identities.map((i) => i.code) } }, select: { id: true } });
      const serviceIds = services.map((s) => s.id);
      const professionals = await prisma.professional.findMany({ where: { userId: { in: identities.map((i) => i.professionalUserId) } }, select: { id: true } });
      const professionalIds = professionals.map((p) => p.id);
      const availabilities = await prisma.availability.findMany({ where: { serviceId: { in: serviceIds } }, select: { id: true } });
      const processes = await prisma.reassignment.findMany({ where: { serviceId: { in: serviceIds } }, select: { id: true } });
      const offers = await prisma.appointmentOffer.findMany({ where: { reassignmentId: { in: processes.map((p) => p.id) } }, select: { id: true } });
      const appointments = await prisma.appointment.findMany({ where: { serviceId: { in: serviceIds } }, select: { id: true } });
      const appointmentIds = appointments.map((a) => a.id);
      await prisma.appointmentOffer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
      await prisma.reassignmentCandidate.deleteMany({ where: { reassignmentId: { in: processes.map((p) => p.id) } } });
      await prisma.reassignment.deleteMany({ where: { id: { in: processes.map((p) => p.id) } } });
      await prisma.appointmentHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
      await prisma.cancellation.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      await prisma.agendaSlot.deleteMany({ where: { availabilityId: { in: availabilities.map((a) => a.id) } } });
      await prisma.availability.deleteMany({ where: { id: { in: availabilities.map((a) => a.id) } } });
      await prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntry: { userId: recipientId, serviceId: { in: serviceIds } } } } });
      await prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntry: { userId: recipientId, serviceId: { in: serviceIds } } } } });
      await prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntry: { userId: recipientId, serviceId: { in: serviceIds } } } });
      await prisma.waitlistPreference.deleteMany({ where: { waitlistEntry: { userId: recipientId, serviceId: { in: serviceIds } } } });
      await prisma.waitlistEntry.deleteMany({ where: { userId: { in: [recipientId, foreignId] }, serviceId: { in: serviceIds } } });
      await prisma.professionalBranch.deleteMany({ where: { professionalId: { in: professionalIds } } });
      await prisma.professionalService.deleteMany({ where: { professionalId: { in: professionalIds } } });
      await prisma.professional.deleteMany({ where: { id: { in: professionalIds } } });
      await prisma.serviceBranch.deleteMany({ where: { serviceId: { in: serviceIds } } });
      await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
      const resourceIds = [...serviceIds, ...professionalIds, ...availabilities.map((a) => a.id), ...processes.map((p) => p.id), ...offers.map((o) => o.id), ...appointmentIds];
      await prisma.auditEvent.deleteMany({ where: { resourceId: { in: resourceIds }, institutionId: demo.institution.id } });
      await prisma.notification.deleteMany({ where: { recipientUserId: { in: [recipientId, foreignId, ...identities.flatMap((i) => [i.sourceId, i.professionalUserId])] } } });
      await prisma.user.deleteMany({ where: { id: { in: [recipientId, foreignId, ...identities.flatMap((i) => [i.sourceId, i.professionalUserId])] } } });
      assert.equal(await prisma.service.count({ where: { id: { in: serviceIds } } }), 0);
      assert.equal(await prisma.user.count({ where: { id: recipientId } }), 0);
    } finally { await prisma.$disconnect(); }
  }
});
