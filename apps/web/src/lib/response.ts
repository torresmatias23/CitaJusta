// Validación de transporte: no reproduce reglas de autorización ni de negocio.
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta de API inválida.');
  return value as Record<string, unknown>;
}

export function textField(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Respuesta de API inválida.');
  return value;
}

export function uuidField(value: unknown): string {
  const result = textField(value);
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(result)) throw new Error('Identificador inválido.');
  return result;
}

export function listData<T>(value: unknown, parse: (item: unknown) => T): T[] {
  const data = record(value)['data'];
  if (!Array.isArray(data)) throw new Error('Respuesta de API inválida.');
  return data.map(parse);
}

export function timestampField(value: unknown): string {
  const result = textField(value);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Fecha de API inválida.');
  return result;
}
