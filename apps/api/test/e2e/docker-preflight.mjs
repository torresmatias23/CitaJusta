import { initializeE2EProcess, loopbackFetch } from '../../scripts/e2e-docker-environment.mjs';

await initializeE2EProcess();
globalThis.fetch = loopbackFetch(globalThis.fetch);
