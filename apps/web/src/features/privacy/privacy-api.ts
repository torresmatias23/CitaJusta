import { ApiError, type ApiClient } from '../../lib/http-client';
import { record, textField, timestampField, uuidField } from '../../lib/response';

export type PrivacyNotice = { id: string; version: string; publishedOn: string; title: string; introduction: string;
  sections: { heading: string; paragraphs: string[] }[] };
export function parseNotice(value: unknown): PrivacyNotice {
  const row = record(value);
  if (!Array.isArray(row.sections) || !row.sections.length || row.sections.length > 30) throw new Error('Aviso inválido');
  const publishedOn = textField(row.publishedOn);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) throw new Error('Fecha inválida');
  return { id: uuidField(row.id), version: textField(row.version), publishedOn,
    title: textField(row.title), introduction: textField(row.introduction), sections: row.sections.map(value => {
      const section = record(value);
      if (!Array.isArray(section.paragraphs) || !section.paragraphs.length || section.paragraphs.length > 20) throw new Error('Aviso inválido');
      return { heading: textField(section.heading), paragraphs: section.paragraphs.map(textField) };
    }) };
}
export function createPrivacyApi(publicApi: ApiClient, accountApi: ApiClient) {
  return {
    async publicNotice(signal: AbortSignal) { return parseNotice(record(await publicApi.request('privacy-notice', { signal })).data); },
    async mine(signal: AbortSignal) {
      const row = record(record(await accountApi.request('users/me/privacy-notice', { signal })).data);
      return { notice: parseNotice(row.notice), acknowledgedAt: row.acknowledgedAt === null ? null : timestampField(row.acknowledgedAt) };
    },
    async acknowledge(versionId: string, signal: AbortSignal) {
      const row = record(record(await accountApi.request('users/me/privacy-notice/acknowledgement', {
        method: 'POST', body: { versionId }, signal,
      })).data);
      if (uuidField(row.versionId) !== versionId) throw new Error('Versión inesperada');
      return timestampField(row.acknowledgedAt);
    },
  };
}
export function privacyError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return 'El aviso cambió. Vuelve a cargarlo y revisa la nueva versión antes de confirmar.';
  if (error instanceof ApiError && error.status === 401) return 'Inicia sesión para consultar o registrar tu confirmación.';
  return 'No pudimos consultar o guardar la confirmación. Puedes continuar usando CitaJusta y reintentar más tarde.';
}
