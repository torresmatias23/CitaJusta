import type { ApiClient } from '../../lib/http-client.ts';
import { listData, record, textField, timestampField, uuidField } from '../../lib/response.ts';

export interface AvailabilitySlot {
  id: string;
  startsAt: string;
  endsAt: string;
  professional: { id: string; firstNames: string; lastNames: string; titleOrFunction: string | null };
}

export interface AvailabilityQuery {
  institutionId: string;
  branchId: string;
  serviceId: string;
  from: string;
  to: string;
}

export function parseSearchQuery(params: URLSearchParams): AvailabilityQuery | null {
  try {
    const query = {
      institutionId: uuidField(params.get('institutionId')),
      branchId: uuidField(params.get('branchId')),
      serviceId: uuidField(params.get('serviceId')),
      from: timestampField(params.get('from')),
      to: timestampField(params.get('to')),
    };
    if (Date.parse(query.from) >= Date.parse(query.to)) return null;
    return query;
  } catch { return null; }
}

export function createAvailabilityApi(api: ApiClient) {
  return {
    async find(query: AvailabilityQuery, signal?: AbortSignal): Promise<AvailabilitySlot[]> {
      const options = { query: { from: timestampField(query.from), to: timestampField(query.to) }, ...(signal ? { signal } : {}) };
      return listData(await api.request(`branches/${uuidField(query.branchId)}/services/${uuidField(query.serviceId)}/availability`, options), (value) => {
        const item = record(value);
        const professional = record(item['professional']);
        return {
          id: uuidField(item['id']), startsAt: timestampField(item['startsAt']), endsAt: timestampField(item['endsAt']),
          professional: { id: uuidField(professional['id']), firstNames: textField(professional['firstNames']), lastNames: textField(professional['lastNames']), titleOrFunction: professional['titleOrFunction'] === null ? null : textField(professional['titleOrFunction']) },
        };
      });
    },
  };
}
