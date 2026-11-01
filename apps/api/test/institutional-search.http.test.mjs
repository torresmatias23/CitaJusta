import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { configureApplication } from '../dist/app.configuration.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { InstitutionalUsersController } from '../dist/users/institutional-users.controller.js';
import { InstitutionalUsersService } from '../dist/users/institutional-users.service.js';
import { InstitutionalWaitlistController } from '../dist/waitlist/institutional-waitlist.controller.js';
import { InstitutionalWaitlistService } from '../dist/waitlist/institutional-waitlist.service.js';
import { UsersController } from '../dist/users/users.controller.js';
import { UsersService } from '../dist/users/users.service.js';
import { WaitlistController } from '../dist/waitlist/waitlist.controller.js';
import { WaitlistService } from '../dist/waitlist/waitlist.service.js';
import { WaitlistPreferencesService } from '../dist/waitlist/waitlist-preferences.service.js';

// Isolated local HTTP, real JWT/authorization/validation; storage is a double, NOT PostgreSQL E2E.
const institutionId = randomUUID(), foreignInstitution = randomUUID(), branchId = randomUUID(), otherBranch = randomUUID();
const secret = randomBytes(32).toString('hex'), jwt = new JwtService(), sessions = new Map(), grants = new Map();
function actor(scope, permissions, institution = institutionId, branch = null) {
  const id = randomUUID(), sid = randomUUID();
  sessions.set(sid, { userId: id, revokedAt: null, expiresAt: new Date(Date.now() + 300_000) });
  grants.set(id, scope ? [{ active: true, validFrom: null, validTo: null, institutionId: institution, branchId: branch,
    role: { code: 'TEST', active: true, scope, permissions: permissions.map(code => ({ permission: { code } })) } }] : []);
  return jwt.sign({ sub: id, sid }, { secret, algorithm: 'HS256', expiresIn: 300 });
}
const admin = actor('INSTITUTION', ['users.read', 'waitlist.read']);
const branchActor = actor('BRANCH', ['users.read', 'waitlist.read'], institutionId, branchId);
const foreignActor = actor('INSTITUTION', ['users.read', 'waitlist.read'], foreignInstitution);
const usersOnly = actor('INSTITUTION', ['users.read']);
const unrelated = actor('INSTITUTION', ['agenda.read', 'reassignments.read', 'professionals.create']);
const globalActor = actor('GLOBAL', ['users.read', 'waitlist.read'], null);
let app, origin, reads = 0;
const db = {
  user: { findUnique: async () => ({ status: 'ACTIVE', deletedAt: null }), findFirst: async () => null, findMany: async () => { reads++; return []; } },
  waitlistEntry: { findFirst: async () => null, findMany: async () => { reads++; return []; } },
  authSession: { findUnique: async ({ where }) => sessions.get(where.id) },
  institution: { findUnique: async ({ where }) => [institutionId, foreignInstitution].includes(where.id) ? { id: where.id } : null },
  branch: {
    findUnique: async ({ where }) => [branchId, otherBranch].includes(where.id) ? { institutionId } : null,
    findFirst: async ({ where }) => [branchId, otherBranch].includes(where.id) && where.institutionId === institutionId ? { id: where.id } : null,
  },
  userRole: { findMany: async ({ where }) => grants.get(where.userId) ?? [] },
};
before(async () => {
  class FixtureModule {}
  Module({ controllers: [UsersController, WaitlistController, InstitutionalUsersController, InstitutionalWaitlistController],
    providers: [AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard, AuthorizationService,
      InstitutionalUsersService, InstitutionalWaitlistService,
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: PrismaService, useValue: db },
      { provide: UsersService, useValue: { getMe: async () => ({ data: { id: 'own-profile' } }) } },
      { provide: WaitlistService, useValue: { findMine: async () => ({ data: [] }) } },
      { provide: WaitlistPreferencesService, useValue: { get: async () => ({ data: { preferredDays: [] } }) } },
    ] })(FixtureModule);
  app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  configureApplication(app); await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
});
after(async () => { await app?.close(); });
const request = (path, token = admin, scope = { 'x-institution-id': institutionId }) => fetch(`${origin}/${path}`, {
  headers: { ...scope, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(5000),
});

test('HTTP administrative routes return JSON/no-store/200 using real guards', async () => {
  for (const route of ['users/administration?q=Ana', 'waitlist/administration?status=ACTIVE']) {
    const response = await request(route); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { data: [], page: { nextCursor: null } });
  }
});
test('HTTP denies anonymous, malformed JWT and unrelated permissions without listing reads', async () => {
  const before = reads;
  for (const route of ['users/administration', 'waitlist/administration']) {
    assert.equal((await request(route, null)).status, 401);
    assert.equal((await request(route, 'invalid')).status, 401);
    assert.equal((await request(route, unrelated)).status, 403);
  }
  assert.equal(reads, before);
});
test('HTTP context headers cannot grant another institution or branch access', async () => {
  const before = reads;
  for (const route of ['users/administration', 'waitlist/administration']) {
    assert.equal((await request(route, foreignActor)).status, 403);
    assert.equal((await request(route, branchActor)).status, 403);
    assert.equal((await request(route, branchActor, { 'x-institution-id': institutionId, 'x-branch-id': otherBranch })).status, 403);
    assert.equal((await request(route, admin, { 'x-institution-id': 'invalid' })).status, 400);
    assert.equal((await request(`${route}?branchId=${otherBranch}`, branchActor, { 'x-institution-id': institutionId, 'x-branch-id': branchId })).status, 404);
  }
  assert.equal(reads, before);
  assert.equal((await request('users/administration', branchActor, { 'x-institution-id': institutionId, 'x-branch-id': branchId })).status, 200);
});
test('HTTP permissions remain independent and GLOBAL does not permit an unscoped listing', async () => {
  assert.equal((await request('users/administration', usersOnly)).status, 200);
  assert.equal((await request('waitlist/administration', usersOnly)).status, 403);
  for (const route of ['users/administration', 'waitlist/administration']) {
    assert.equal((await request(route, globalActor, {})).status, 400);
    assert.equal((await request(route, globalActor)).status, 200);
  }
});
test('HTTP strict filters reject injection, arrays, malformed cursors and unbounded limits', async () => {
  for (const route of ['users/administration', 'waitlist/administration']) {
    for (const query of [`institutionId=${foreignInstitution}`, 'limit=101', 'limit=1&limit=2', 'cursor=bad!', 'branchId=invalid']) {
      assert.equal((await request(`${route}?${query}`)).status, 400);
    }
  }
});
test('HTTP personal endpoints and preferences route remain distinct and compatible', async () => {
  assert.deepEqual(await (await request('users/me')).json(), { data: { id: 'own-profile' } });
  assert.deepEqual(await (await request('waitlist')).json(), { data: [] });
  assert.equal((await request('waitlist?status=ACTIVE')).status, 400);
  assert.deepEqual(await (await request(`waitlist/${randomUUID()}/preferences`)).json(), { data: { preferredDays: [] } });
});
test('HTTP storage failures preserve sanitized 500 JSON and no-store', async () => {
  const original = db.user.findMany;
  db.user.findMany = async () => { throw new Error('private storage detail'); };
  try {
    const response = await request('users/administration'); assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); assert.equal(body.message, 'Unable to list institutional users');
    assert.equal(JSON.stringify(body).includes('private'), false);
  } finally { db.user.findMany = original; }
});
