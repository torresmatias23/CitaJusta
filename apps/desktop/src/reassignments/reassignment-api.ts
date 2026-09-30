import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { named, record, text, uuid } from '../agenda/agenda-api.ts';
import { uuidPattern } from '../catalog/catalog-api.ts';

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Respuesta inválida.');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Respuesta inválida.');
  return value;
}
function instant(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Fecha inválida.');
  return result;
}
function nullable<T>(value: unknown, decode: (value: unknown) => T): T | null { return value === null ? null : decode(value); }
function optional<T>(value: unknown, decode: (value: unknown) => T): T | undefined { return value === undefined ? undefined : decode(value); }
function array<T>(value: unknown, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Respuesta inválida.');
  return value.map(decode);
}
function criteria(value: unknown) {
  const r = record(value);
  return {
    timeZone: optional(r.timeZone, text), startsAt: optional(r.startsAt, instant), endsAt: optional(r.endsAt, instant),
    branchId: optional(r.branchId, uuid), professionalId: optional(r.professionalId, uuid),
    offerTtlMinutes: optional(r.offerTtlMinutes, number), actorUserId: optional(r.actorUserId, uuid),
    emptyPreferences: optional(r.emptyPreferences, text), explicitDaysOverrideWeekendFlag: optional(r.explicitDaysOverrideWeekendFlag, boolean),
  };
}
function preferences(value: unknown) {
  const r = record(value);
  return { acceptsAnyProfessional: boolean(r.acceptsAnyProfessional), acceptsAnyTime: boolean(r.acceptsAnyTime), acceptsWeekend: boolean(r.acceptsWeekend),
    preferredDays: array(r.preferredDays, number), timeRanges: array(r.timeRanges, value => { const row = record(value); return { start: text(row.start), end: text(row.end) }; }) };
}
function evaluationContext(value: unknown) {
  const r = record(value);
  return { statusCode: optional(r.statusCode, text), enteredAt: optional(r.enteredAt, instant), branchId: optional(r.branchId, value => nullable(value, uuid)),
    preferredBranchIds: optional(r.preferredBranchIds, value => array(value, uuid)), allowsOtherBranches: optional(r.allowsOtherBranches, boolean),
    minimumNoticeMinutes: optional(r.minimumNoticeMinutes, number), deadlineDate: optional(r.deadlineDate, value => nullable(value, instant)),
    priorityCode: optional(r.priorityCode, text), priorityActive: optional(r.priorityActive, boolean), preferences: optional(r.preferences, value => nullable(value, preferences)) };
}
function candidate(value: unknown) {
  const r = record(value), s = record(r.snapshot);
  return { id: uuid(r.id), waitlistEntryId: uuid(r.waitlistEntryId), recipient: { id: uuid(record(r.recipient).id) },
    evaluationStatus: text(r.evaluationStatus), rankingPosition: nullable(r.rankingPosition, number), exclusionReasonCode: nullable(r.exclusionReasonCode, text),
    evaluatedAt: nullable(r.evaluatedAt, instant), createdAt: instant(r.createdAt), snapshot: {
      priorityLevel: nullable(s.priorityLevel, number), entryUpdatedAt: nullable(s.entryUpdatedAt, instant), totalScore: nullable(s.totalScore, text),
      scoreFactors: array(s.scoreFactors, value => {
        const factor = record(value);
        if (factor.code === 'PRIORITY_LEVEL') return { code: 'PRIORITY_LEVEL' as const, value: number(factor.value) };
        if (factor.code === 'ENTERED_AT') return { code: 'ENTERED_AT' as const, value: instant(factor.value) };
        throw new Error('Factor inválido.');
      }), evaluationContext: evaluationContext(s.evaluationContext),
    } };
}
function offer(value: unknown) {
  const r = record(value);
  return { id: uuid(r.id), candidateId: uuid(r.candidateId), recipient: { id: uuid(record(r.recipient).id) }, attemptNumber: number(r.attemptNumber),
    status: text(r.status), expectedSlotVersion: number(r.expectedSlotVersion), lockVersion: number(r.lockVersion),
    createdAt: instant(r.createdAt), expiresAt: instant(r.expiresAt), respondedAt: nullable(r.respondedAt, instant), resolvedAt: nullable(r.resolvedAt, instant),
    respondedByUserId: nullable(r.respondedByUserId, uuid), resolutionReasonCode: nullable(r.resolutionReasonCode, text) };
}
export function parseReassignment(value: unknown) {
  const r = record(value), slot = record(r.agendaSlot), appointment = record(r.appointment), cancellation = record(r.originCancellation), evaluation = record(r.evaluation);
  const initiation = record(evaluation.initiation);
  if (initiation.kind !== 'AUTHORIZED_REQUEST' && initiation.kind !== 'NOT_RECORDED') throw new Error('Inicio inválido.');
  return {
    id: uuid(r.id), status: text(r.status), institution: named(r.institution), branch: named(r.branch), service: named(r.service),
    policy: nullable(r.policy, value => { const p = record(value); return { id: uuid(p.id), version: number(p.version), rankingStrategy: text(p.rankingStrategy), offerTtlMinutes: number(p.offerTtlMinutes) }; }),
    agendaSlot: { id: uuid(slot.id), status: text(slot.status), startsAt: instant(slot.startsAt), endsAt: instant(slot.endsAt), lockVersion: number(slot.lockVersion) },
    appointment: { id: uuid(appointment.id), status: text(appointment.status), origin: text(appointment.origin), currentUserId: uuid(appointment.currentUserId), startsAt: instant(appointment.startsAt), endsAt: instant(appointment.endsAt) },
    originCancellation: { id: uuid(cancellation.id), cancelledAt: instant(cancellation.cancelledAt), actorUserId: nullable(cancellation.actorUserId, uuid) },
    evaluation: { ruleCode: nullable(evaluation.ruleCode, text), scoringVersion: nullable(evaluation.scoringVersion, text), criteriaSnapshot: criteria(evaluation.criteriaSnapshot),
      initiation: { kind: initiation.kind, actorUserId: nullable(initiation.actorUserId, uuid) } },
    initialSlotVersion: number(r.initialSlotVersion), lockVersion: number(r.lockVersion), closureReasonCode: nullable(r.closureReasonCode, text),
    detectedAt: instant(r.detectedAt), startedAt: nullable(r.startedAt, instant), finishedAt: nullable(r.finishedAt, instant),
    createdAt: instant(r.createdAt), updatedAt: instant(r.updatedAt), observedAt: instant(r.observedAt),
    candidates: array(r.candidates, candidate), offers: array(r.offers, offer), pendingOfferId: nullable(r.pendingOfferId, uuid), activeOfferId: nullable(r.activeOfferId, uuid),
  };
}
export type Reassignment = ReturnType<typeof parseReassignment>;
export function canReadReassignments(user: UserProfile) { return Boolean(user.context.institutionId) && user.permissions.includes('reassignments.read'); }
export function reassignmentError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Introduce un UUID de proceso válido.';
    if (error.status === 401) return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (error.status === 403) return 'No tienes permiso para consultar reasignaciones en este contexto.';
    if (error.status === 404) return 'El proceso no está disponible en tu contexto.';
  }
  return 'No pudimos consultar el proceso. Revisa la conexión y vuelve a intentar.';
}
export function createReassignmentApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return { async find(id: string, signal: AbortSignal) {
    if (!canReadReassignments(user)) throw new ApiError(403);
    if (typeof id !== 'string' || !uuidPattern.test(id)) throw new ApiError(400);
    const result = parseReassignment(record(await api.request(`reassignments/${id}`, { institutionContext, signal })).data);
    if (result.id !== id || result.institution.id !== institutionContext.institutionId || (institutionContext.branchId && result.branch.id !== institutionContext.branchId)) throw new ApiError(404);
    return result;
  } };
}
