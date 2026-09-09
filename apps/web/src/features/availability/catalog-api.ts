import type { ApiClient } from '../../lib/http-client.ts';
import { listData, record, textField, uuidField } from '../../lib/response.ts';

export interface NamedResource { id: string; name: string }
export interface Institution extends NamedResource { timeZone: string }
export interface Branch extends NamedResource { institutionId: string }
export interface Service extends NamedResource { institution: NamedResource }

function named(value: unknown): NamedResource {
  const item = record(value);
  return { id: uuidField(item['id']), name: textField(item['name']) };
}

export function createCatalogApi(api: ApiClient) {
  return {
    async institutions(signal?: AbortSignal): Promise<Institution[]> {
      return listData(await api.request('institutions', signal ? { signal } : {}), (value) => ({ ...named(value), timeZone: textField(record(value)['timeZone']) }));
    },
    async branches(institutionId: string, signal?: AbortSignal): Promise<Branch[]> {
      return listData(await api.request(`institutions/${uuidField(institutionId)}/branches`, signal ? { signal } : {}), (value) => ({ ...named(value), institutionId: uuidField(record(value)['institutionId']) }));
    },
    async services(branchId: string, signal?: AbortSignal): Promise<Service[]> {
      return listData(await api.request(`branches/${uuidField(branchId)}/services`, signal ? { signal } : {}), (value) => ({ ...named(value), institution: named(record(value)['institution']) }));
    },
  };
}
