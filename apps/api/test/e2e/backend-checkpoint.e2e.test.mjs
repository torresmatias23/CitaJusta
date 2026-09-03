import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { test } from 'node:test';
import {
  FIXTURE_EMAIL_PREFIX,
  assertCheckpointIsClean,
  cleanupCheckpointFixtures,
  createCheckpointFixtures,
  ids,
  professionalIds,
  rbac,
  slotIds,
} from './fixture.mjs';

const API_ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));
const LOCAL_DATABASE_NAMES = /^citajusta_(dev|test|e2e)(_[a-z0-9-]+)?$/i;

function loadApiEnvironment() {
  try {
    loadEnvFile(API_ENV_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT' || !process.env.DATABASE_URL) {
      throw new Error('E2E environment could not be loaded');
    }
  }
}

function assertSafeLocalDatabaseUrl(connectionString) {
  if (typeof connectionString !== 'string') {
    throw new Error('E2E safety check failed: DATABASE_URL is required');
  }

  let url;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('E2E safety check failed: DATABASE_URL is invalid');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const isPostgresql =
    url.protocol === 'postgresql:' || url.protocol === 'postgres:';

  if (
    !isPostgresql ||
    !localHosts.has(url.hostname.toLowerCase()) ||
    !LOCAL_DATABASE_NAMES.test(databaseName) ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'E2E safety check failed: only an allowlisted local PostgreSQL database is accepted',
    );
  }
}

function getE2ePort() {
  if (process.env.E2E_PORT === undefined) {
    return 0;
  }

  const port = Number(process.env.E2E_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === 3_000) {
    throw new Error('E2E_PORT must be a valid non-3000 port');
  }

  return port;
}

async function request(baseUrl, endpoint, options = {}) {
  const headers = { ...options.headers };

  if (options.accessToken) {
    headers.authorization = `Bearer ${options.accessToken}`;
  }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const responseText = await response.text();
  let body = null;

  if (responseText.length > 0) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = responseText;
    }
  }

  return { status: response.status, body };
}

function expectStatus(response, expected, phase, endpoint) {
  assert.equal(
    response.status,
    expected,
    `${phase} | ${endpoint} | status esperado ${expected}, recibido ${response.status}`,
  );
}

function assertUuid(value, phase) {
  assert.equal(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
    true,
    `${phase}: UUID esperado`,
  );
}

function assertArray(value, phase) {
  assert.equal(Array.isArray(value), true, `${phase}: se esperaba un array`);
}

function assertFieldAbsent(value, field, phase) {
  assert.equal(
    Object.hasOwn(value, field),
    false,
    `${phase}: el campo interno ${field} no debe exponerse`,
  );
}

function idsFromData(response, phase) {
  assertArray(response.body?.data, phase);
  return new Set(response.body.data.map((item) => item.id));
}

function expectFixtureMembership(actualIds, expectedPresent, expectedAbsent, phase) {
  for (const id of expectedPresent) {
    assert.equal(actualIds.has(id), true, `${phase}: falta fixture esperado ${id}`);
  }

  for (const id of expectedAbsent) {
    assert.equal(actualIds.has(id), false, `${phase}: apareció fixture excluido ${id}`);
  }
}

function readTokenPair(response, phase) {
  assert.equal(
    typeof response.body?.accessToken,
    'string',
    `${phase}: accessToken ausente`,
  );
  assert.equal(
    response.body.accessToken.length > 0,
    true,
    `${phase}: accessToken vacío`,
  );
  assert.equal(
    typeof response.body?.refreshToken,
    'string',
    `${phase}: refreshToken ausente`,
  );
  assert.equal(
    response.body.refreshToken.length > 0,
    true,
    `${phase}: refreshToken vacío`,
  );
  assert.equal(response.body?.tokenType, 'Bearer', `${phase}: tokenType inválido`);
  assert.equal(
    Number.isInteger(response.body?.accessTokenExpiresIn) &&
      response.body.accessTokenExpiresIn > 0,
    true,
    `${phase}: TTL de access token inválido`,
  );
  assert.equal(
    Number.isInteger(response.body?.refreshTokenExpiresIn) &&
      response.body.refreshTokenExpiresIn > 0,
    true,
    `${phase}: TTL de refresh token inválido`,
  );

  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.status === 200) {
        return;
      }
    } catch {
      // The listener may need another short event-loop turn.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('E2E API did not become healthy');
}

async function expectMe(
  baseUrl,
  accessToken,
  headers,
  expectedContext,
  expectedRoles,
  expectedPermissions,
  phase,
) {
  const endpoint = '/api/v1/users/me';
  const response = await request(baseUrl, endpoint, { accessToken, headers });
  expectStatus(response, 200, phase, endpoint);
  assert.deepEqual(response.body?.data?.context, expectedContext, `${phase}: contexto`);
  assert.deepEqual(
    response.body?.data?.roles,
    [...expectedRoles].sort(),
    `${phase}: roles`,
  );
  assert.deepEqual(
    response.body?.data?.permissions,
    [...expectedPermissions].sort(),
    `${phase}: permisos`,
  );

  return response.body.data;
}

function queryRange(from, to) {
  return new URLSearchParams({ from, to }).toString();
}

test(
  'backend E2E checkpoint uses real Nest HTTP, Prisma and local PostgreSQL',
  { timeout: 120_000 },
  async () => {
    let app;
    let prisma;
    let cleanupEnabled = false;
    let failure;

    try {
      loadApiEnvironment();
      assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
      process.env.NODE_ENV = 'test';

      const [{ AppModule }, { configureApplication }, { PrismaService }] =
        await Promise.all([
          import('../../dist/app.module.js'),
          import('../../dist/app.configuration.js'),
          import('../../dist/database/prisma.service.js'),
        ]);

      app = await NestFactory.create(AppModule, { logger: false });
      configureApplication(app);
      await app.listen(getE2ePort(), '127.0.0.1');

      const address = app.getHttpServer().address();
      assert.equal(
        typeof address,
        'object',
        'E2E bootstrap: no se pudo resolver el puerto',
      );
      assert.equal(
        address.port === 3_000,
        false,
        'E2E bootstrap: el puerto resuelto no debe ser 3000',
      );
      const baseUrl = `http://127.0.0.1:${address.port}`;
      prisma = app.get(PrismaService);

      await cleanupCheckpointFixtures(prisma);
      cleanupEnabled = true;
      await waitForHealth(baseUrl);

      const health = await request(baseUrl, '/health');
      expectStatus(health, 200, 'Health', '/health');
      assert.deepEqual(health.body, { status: 'ok' });

      const versionedHealth = await request(baseUrl, '/api/v1/health');
      expectStatus(versionedHealth, 404, 'Versionado', '/api/v1/health');

      const legacyAuth = await request(baseUrl, '/auth/login', {
        method: 'POST',
        body: {},
      });
      expectStatus(legacyAuth, 404, 'Versionado', '/auth/login');

      const unauthenticatedMe = await request(baseUrl, '/api/v1/users/me');
      expectStatus(
        unauthenticatedMe,
        401,
        'Users/me sin token',
        '/api/v1/users/me',
      );

      const invalidTokenMe = await request(baseUrl, '/api/v1/users/me', {
        accessToken: 'invalid-e2e-token',
      });
      expectStatus(
        invalidTokenMe,
        401,
        'Users/me token inválido',
        '/api/v1/users/me',
      );

      const unauthenticatedCatalog = await request(
        baseUrl,
        '/api/v1/institutions',
      );
      expectStatus(
        unauthenticatedCatalog,
        401,
        'Institutions sin token',
        '/api/v1/institutions',
      );

      const runId = randomUUID().replaceAll('-', '');
      const normalizedEmail = `${FIXTURE_EMAIL_PREFIX}${runId}@example.com`;
      const registrationBody = {
        email: `  ${normalizedEmail.toUpperCase()}  `,
        password: `E2e-${randomUUID()}-Aa1!`,
        firstName: 'Checkpoint',
        lastName: 'E2E User',
      };
      const registerEndpoint = '/api/v1/auth/register';
      const registration = await request(baseUrl, registerEndpoint, {
        method: 'POST',
        body: registrationBody,
      });
      expectStatus(registration, 201, 'Auth register', registerEndpoint);
      assertUuid(registration.body?.id, 'Auth register');
      assert.equal(registration.body?.email, normalizedEmail);
      assert.equal(registration.body?.status, 'ACTIVE');
      assertFieldAbsent(registration.body, 'passwordHash', 'Auth register');
      const registeredUserId = registration.body.id;

      const persistedUser = await prisma.user.findUnique({
        where: { id: registeredUserId },
        select: { email: true, status: true },
      });
      assert.equal(persistedUser?.email, normalizedEmail);
      assert.equal(persistedUser?.status, 'ACTIVE');

      const duplicateRegistration = await request(baseUrl, registerEndpoint, {
        method: 'POST',
        body: registrationBody,
      });
      expectStatus(
        duplicateRegistration,
        409,
        'Auth register duplicado',
        registerEndpoint,
      );

      const loginEndpoint = '/api/v1/auth/login';
      const wrongPassword = await request(baseUrl, loginEndpoint, {
        method: 'POST',
        body: { email: normalizedEmail, password: `Wrong-${randomUUID()}` },
      });
      expectStatus(wrongPassword, 401, 'Auth login inválido', loginEndpoint);

      const login = await request(baseUrl, loginEndpoint, {
        method: 'POST',
        body: {
          email: normalizedEmail,
          password: registrationBody.password,
        },
      });
      expectStatus(login, 200, 'Auth login', loginEndpoint);
      const firstPair = readTokenPair(login, 'Auth login');

      const refreshEndpoint = '/api/v1/auth/refresh';
      const refresh = await request(baseUrl, refreshEndpoint, {
        method: 'POST',
        body: { refreshToken: firstPair.refreshToken },
      });
      expectStatus(refresh, 200, 'Auth refresh', refreshEndpoint);
      const currentPair = readTokenPair(refresh, 'Auth refresh');
      assert.equal(
        currentPair.refreshToken === firstPair.refreshToken,
        false,
        'Auth refresh: el token debe rotar',
      );

      const replayedRefresh = await request(baseUrl, refreshEndpoint, {
        method: 'POST',
        body: { refreshToken: firstPair.refreshToken },
      });
      expectStatus(
        replayedRefresh,
        401,
        'Auth refresh anterior',
        refreshEndpoint,
      );

      const availabilityRange = await createCheckpointFixtures(
        prisma,
        registeredUserId,
      );

      const globalMe = await expectMe(
        baseUrl,
        currentPair.accessToken,
        {},
        {},
        [rbac.roles.global],
        [rbac.permissions.global],
        'RBAC global',
      );
      assert.equal(globalMe.id, registeredUserId);
      assert.equal(globalMe.email, normalizedEmail);
      assert.equal(globalMe.status, 'ACTIVE');
      for (const field of [
        'passwordHash',
        'refreshToken',
        'authSessions',
        'sessions',
      ]) {
        assertFieldAbsent(globalMe, field, 'Users/me');
      }

      await expectMe(
        baseUrl,
        currentPair.accessToken,
        { 'x-institution-id': ids.institutionA },
        { institutionId: ids.institutionA },
        [rbac.roles.global, rbac.roles.institution],
        [rbac.permissions.global, rbac.permissions.institution],
        'RBAC institución A',
      );

      await expectMe(
        baseUrl,
        currentPair.accessToken,
        { 'x-branch-id': ids.branchA1 },
        { branchId: ids.branchA1 },
        [rbac.roles.global, rbac.roles.branch],
        [rbac.permissions.global, rbac.permissions.branch],
        'RBAC sede A1',
      );

      await expectMe(
        baseUrl,
        currentPair.accessToken,
        {
          'x-institution-id': ids.institutionA,
          'x-branch-id': ids.branchA1,
        },
        { institutionId: ids.institutionA, branchId: ids.branchA1 },
        [rbac.roles.global, rbac.roles.institution, rbac.roles.branch],
        [
          rbac.permissions.global,
          rbac.permissions.institution,
          rbac.permissions.branch,
        ],
        'RBAC institución A y sede A1',
      );

      await expectMe(
        baseUrl,
        currentPair.accessToken,
        {
          'x-institution-id': ids.institutionB,
          'x-branch-id': ids.branchB1,
        },
        { institutionId: ids.institutionB, branchId: ids.branchB1 },
        [rbac.roles.global],
        [rbac.permissions.global],
        'RBAC aislamiento institución B',
      );

      const inconsistentContext = await request(baseUrl, '/api/v1/users/me', {
        accessToken: currentPair.accessToken,
        headers: {
          'x-institution-id': ids.institutionA,
          'x-branch-id': ids.branchB1,
        },
      });
      expectStatus(
        inconsistentContext,
        400,
        'RBAC contexto cross-tenant',
        '/api/v1/users/me',
      );

      const invalidContext = await request(baseUrl, '/api/v1/users/me', {
        accessToken: currentPair.accessToken,
        headers: { 'x-institution-id': 'invalid-uuid' },
      });
      expectStatus(
        invalidContext,
        400,
        'RBAC UUID inválido',
        '/api/v1/users/me',
      );

      const institutionsEndpoint = '/api/v1/institutions';
      const institutions = await request(baseUrl, institutionsEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(institutions, 200, 'Institutions listado', institutionsEndpoint);
      expectFixtureMembership(
        idsFromData(institutions, 'Institutions listado'),
        [ids.institutionA, ids.institutionB],
        [ids.institutionInactive],
        'Institutions listado',
      );

      const institutionDetailEndpoint = `${institutionsEndpoint}/${ids.institutionA}`;
      const institutionDetail = await request(baseUrl, institutionDetailEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        institutionDetail,
        200,
        'Institution detalle',
        institutionDetailEndpoint,
      );
      assert.equal(institutionDetail.body?.data?.id, ids.institutionA);

      const invalidInstitutionEndpoint = `${institutionsEndpoint}/invalid-uuid`;
      const invalidInstitution = await request(baseUrl, invalidInstitutionEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        invalidInstitution,
        400,
        'Institution UUID inválido',
        invalidInstitutionEndpoint,
      );

      const missingInstitutionEndpoint = `${institutionsEndpoint}/${ids.missing}`;
      const missingInstitution = await request(baseUrl, missingInstitutionEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        missingInstitution,
        404,
        'Institution inexistente',
        missingInstitutionEndpoint,
      );

      const inactiveInstitutionEndpoint = `${institutionsEndpoint}/${ids.institutionInactive}`;
      const inactiveInstitution = await request(
        baseUrl,
        inactiveInstitutionEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        inactiveInstitution,
        404,
        'Institution inactiva',
        inactiveInstitutionEndpoint,
      );

      const branchesEndpoint = `${institutionsEndpoint}/${ids.institutionA}/branches`;
      const branches = await request(baseUrl, branchesEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(branches, 200, 'Branches listado', branchesEndpoint);
      expectFixtureMembership(
        idsFromData(branches, 'Branches listado'),
        [ids.branchA1, ids.branchA2],
        [ids.branchB1, ids.branchInactive],
        'Branches listado',
      );

      const missingBranchesEndpoint = `${institutionsEndpoint}/${ids.missing}/branches`;
      const missingBranches = await request(baseUrl, missingBranchesEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        missingBranches,
        404,
        'Branches institución inexistente',
        missingBranchesEndpoint,
      );

      const servicesEndpoint = '/api/v1/services';
      const services = await request(baseUrl, servicesEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(services, 200, 'Services listado', servicesEndpoint);
      const serviceListIds = idsFromData(services, 'Services listado');
      expectFixtureMembership(
        serviceListIds,
        [ids.serviceA, ids.serviceA2, ids.serviceB],
        [ids.serviceInactive],
        'Services listado',
      );
      const serviceA2Summary = services.body.data.find(
        (service) => service.id === ids.serviceA2,
      );
      assert.equal(
        serviceA2Summary?.category,
        null,
        'Services listado: categoría inactiva no debe exponerse',
      );

      const serviceDetailEndpoint = `${servicesEndpoint}/${ids.serviceA}`;
      const serviceDetail = await request(baseUrl, serviceDetailEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(serviceDetail, 200, 'Service detalle', serviceDetailEndpoint);
      assert.equal(serviceDetail.body?.data?.category?.id, ids.categoryActive);
      const requirementIds = new Set(
        serviceDetail.body?.data?.requirements?.map((item) => item.id),
      );
      expectFixtureMembership(
        requirementIds,
        [ids.requirementActive],
        [ids.requirementInactive],
        'Service requisitos',
      );
      assertFieldAbsent(serviceDetail.body.data, 'deletedAt', 'Service detalle');
      assertFieldAbsent(serviceDetail.body.data, 'active', 'Service detalle');

      const branchServicesEndpoint = `/api/v1/branches/${ids.branchA1}/services`;
      const branchServices = await request(baseUrl, branchServicesEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        branchServices,
        200,
        'Services por sede',
        branchServicesEndpoint,
      );
      expectFixtureMembership(
        idsFromData(branchServices, 'Services por sede'),
        [ids.serviceA],
        [ids.serviceA2, ids.serviceB, ids.serviceInactive],
        'Services por sede',
      );

      const professionalsEndpoint = '/api/v1/professionals';
      const professionals = await request(baseUrl, professionalsEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        professionals,
        200,
        'Professionals listado',
        professionalsEndpoint,
      );
      expectFixtureMembership(
        idsFromData(professionals, 'Professionals listado'),
        [
          ids.professionalA,
          ids.professionalA2,
          ids.professionalA3,
          ids.professionalB,
        ],
        [ids.professionalInactive],
        'Professionals listado',
      );

      const branchProfessionalsEndpoint = `/api/v1/branches/${ids.branchA1}/professionals`;
      const branchProfessionals = await request(
        baseUrl,
        branchProfessionalsEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        branchProfessionals,
        200,
        'Professionals por sede',
        branchProfessionalsEndpoint,
      );
      expectFixtureMembership(
        idsFromData(branchProfessionals, 'Professionals por sede'),
        [ids.professionalA, ids.professionalA3],
        [ids.professionalA2, ids.professionalB, ids.professionalInactive],
        'Professionals por sede',
      );

      const serviceProfessionalsEndpoint = `/api/v1/services/${ids.serviceA}/professionals`;
      const serviceProfessionals = await request(
        baseUrl,
        serviceProfessionalsEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        serviceProfessionals,
        200,
        'Professionals por servicio',
        serviceProfessionalsEndpoint,
      );
      expectFixtureMembership(
        idsFromData(serviceProfessionals, 'Professionals por servicio'),
        [ids.professionalA, ids.professionalA2],
        [ids.professionalA3, ids.professionalB, ids.professionalInactive],
        'Professionals por servicio',
      );

      const compatibleProfessionalsEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/professionals`;
      const compatibleProfessionals = await request(
        baseUrl,
        compatibleProfessionalsEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        compatibleProfessionals,
        200,
        'Professionals compatibles',
        compatibleProfessionalsEndpoint,
      );
      const compatibleFixtureIds = compatibleProfessionals.body.data
        .map((item) => item.id)
        .filter((id) => professionalIds.includes(id));
      assert.deepEqual(compatibleFixtureIds, [ids.professionalA]);

      const inactiveProfessionalEndpoint = `${professionalsEndpoint}/${ids.professionalInactive}`;
      const inactiveProfessional = await request(
        baseUrl,
        inactiveProfessionalEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        inactiveProfessional,
        404,
        'Professional inactivo',
        inactiveProfessionalEndpoint,
      );

      const range = queryRange(availabilityRange.from, availabilityRange.to);
      const availabilityEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${range}`;
      const availability = await request(baseUrl, availabilityEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(availability, 200, 'Availability listado', availabilityEndpoint);
      const returnedFixtureSlots = availability.body.data
        .map((item) => item.id)
        .filter((id) => slotIds.includes(id));
      assert.deepEqual(returnedFixtureSlots, [ids.slotAvailable]);
      const availableSlot = availability.body.data.find(
        (item) => item.id === ids.slotAvailable,
      );
      assert.equal(availableSlot?.professional?.id, ids.professionalA);
      for (const field of [
        'lockVersion',
        'blockedUntilAt',
        'status',
        'availabilityId',
      ]) {
        assertFieldAbsent(availableSlot, field, 'Availability response');
      }

      const professionalAvailabilityEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/professionals/${ids.professionalA}/availability?${range}`;
      const professionalAvailability = await request(
        baseUrl,
        professionalAvailabilityEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        professionalAvailability,
        200,
        'Availability por profesional',
        professionalAvailabilityEndpoint,
      );
      const professionalFixtureSlots = professionalAvailability.body.data
        .map((item) => item.id)
        .filter((id) => slotIds.includes(id));
      assert.deepEqual(professionalFixtureSlots, [ids.slotAvailable]);

      const incompatibleProfessionalEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/professionals/${ids.professionalA2}/availability?${range}`;
      const incompatibleProfessional = await request(
        baseUrl,
        incompatibleProfessionalEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        incompatibleProfessional,
        404,
        'Availability profesional incompatible',
        incompatibleProfessionalEndpoint,
      );

      const unavailableServiceEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA2}/availability?${range}`;
      const unavailableService = await request(
        baseUrl,
        unavailableServiceEndpoint,
        { accessToken: currentPair.accessToken },
      );
      expectStatus(
        unavailableService,
        404,
        'Availability servicio no habilitado',
        unavailableServiceEndpoint,
      );

      const invalidRangeEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${queryRange('invalid-date', availabilityRange.to)}`;
      const invalidRange = await request(baseUrl, invalidRangeEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        invalidRange,
        400,
        'Availability from inválido',
        invalidRangeEndpoint,
      );

      const reversedRangeEndpoint = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${queryRange(availabilityRange.to, availabilityRange.from)}`;
      const reversedRange = await request(baseUrl, reversedRangeEndpoint, {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        reversedRange,
        400,
        'Availability from mayor o igual a to',
        reversedRangeEndpoint,
      );

      const logoutEndpoint = '/api/v1/auth/logout';
      const logout = await request(baseUrl, logoutEndpoint, {
        method: 'POST',
        body: { refreshToken: currentPair.refreshToken },
      });
      expectStatus(logout, 204, 'Auth logout', logoutEndpoint);

      const refreshAfterLogout = await request(baseUrl, refreshEndpoint, {
        method: 'POST',
        body: { refreshToken: currentPair.refreshToken },
      });
      expectStatus(
        refreshAfterLogout,
        401,
        'Auth refresh tras logout',
        refreshEndpoint,
      );

      const accessAfterLogout = await request(baseUrl, '/api/v1/users/me', {
        accessToken: currentPair.accessToken,
      });
      expectStatus(
        accessAfterLogout,
        200,
        'Access token tras logout',
        '/api/v1/users/me',
      );
    } catch (error) {
      failure = error;
    }

    if (prisma && cleanupEnabled) {
      try {
        await cleanupCheckpointFixtures(prisma);
        await assertCheckpointIsClean(prisma);
      } catch (error) {
        if (!failure) {
          failure = new Error('E2E cleanup failed', { cause: error });
        } else if (failure instanceof Error) {
          failure.message = `${failure.message}; E2E cleanup also failed`;
        }
      }
    }

    if (app) {
      try {
        await app.close();
      } catch (error) {
        if (!failure) {
          failure = new Error('E2E API shutdown failed', { cause: error });
        } else if (failure instanceof Error) {
          failure.message = `${failure.message}; E2E API shutdown also failed`;
        }
      }
    }

    if (failure) {
      throw failure;
    }
  },
);
