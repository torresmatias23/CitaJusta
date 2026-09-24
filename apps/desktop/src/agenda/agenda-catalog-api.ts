import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { list, named, record, text, uuid } from './agenda-api.ts';
import type { Named } from './agenda-api.ts';

export type AgendaCatalogs = { branches: Named[]; services: Named[]; professionals: Named[] };
export function mergeOptions(existing: Named[], additions: Named[]): Named[] {
  return [...new Map([...existing, ...additions].map(item => [item.id, item])).values()];
}

// Lecturas públicas autenticadas: sólo ayudas de selección, nunca autoridad sobre la agenda.
export function createAgendaCatalogApi(api: ApiClient, user: UserProfile) {
  const institutionId = uuid(user.context.institutionId);
  const branchContext = user.context.branchId ? uuid(user.context.branchId) : undefined;
  return {
    async timeZone(signal: AbortSignal): Promise<string> {
      const row = record(record(await api.request(`institutions/${institutionId}`, { signal })).data);
      if (uuid(row.id) !== institutionId) throw new Error('Institución inválida.');
      const timeZone = text(row.timeZone);
      new Intl.DateTimeFormat('es-CL', { timeZone }).format();
      return timeZone;
    },
    async options(signal: AbortSignal): Promise<AgendaCatalogs> {
      const branches = list(await api.request(`institutions/${institutionId}/branches`, { signal }), value => {
        if (uuid(record(value).institutionId) !== institutionId) throw new Error('Sede inválida.');
        return named(value);
      }).filter(branch => !branchContext || branch.id === branchContext);
      const groups = await Promise.all(branches.map(async branch => {
        const [services, professionals] = await Promise.all([
          api.request(`branches/${branch.id}/services`, { signal }),
          api.request(`branches/${branch.id}/professionals`, { signal }),
        ]);
        const own = (value: unknown) => {
          const row = record(value);
          if (uuid(record(row.institution).id) !== institutionId) throw new Error('Relación inválida.');
          return row;
        };
        return { services: list(services, value => named(own(value))), professionals: list(professionals, value => {
          const row = own(value); return { id: uuid(row.id), name: `${text(row.firstNames)} ${text(row.lastNames)}` };
        }) };
      }));
      return { branches, services: mergeOptions([], groups.flatMap(group => group.services)),
        professionals: mergeOptions([], groups.flatMap(group => group.professionals)) };
    },
  };
}
