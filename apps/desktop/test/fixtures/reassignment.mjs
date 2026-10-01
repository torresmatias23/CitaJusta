export const id = n => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const at = '2030-10-01T12:00:00.000Z';
export const profile = { id: id(1), firstName: 'Control', lastName: 'Test', email: 'controlled@example.test', status: 'ACTIVE', context: { institutionId: id(2) }, permissions: ['reassignments.read'], roles: [] };
export function processFixture() {
  return {
    id: id(3), status: 'OFFERING', institution: { id: id(2), name: 'Institución controlada' }, branch: { id: id(4), name: 'Sede controlada' }, service: { id: id(5), name: 'Atención controlada' },
    policy: { id: id(6), version: 2, rankingStrategy: 'PRIORITY_FIFO', offerTtlMinutes: 10 },
    agendaSlot: { id: id(7), status: 'OFFERED', startsAt: at, endsAt: '2030-10-01T12:30:00.000Z', lockVersion: 3 },
    appointment: { id: id(8), status: 'CANCELADA', origin: 'WEB', currentUserId: id(1), startsAt: at, endsAt: '2030-10-01T12:30:00.000Z' },
    originCancellation: { id: id(9), cancelledAt: at, actorUserId: id(1) },
    evaluation: { ruleCode: 'COMPATIBILITY', scoringVersion: 'v1', criteriaSnapshot: { timeZone: 'America/Santiago', startsAt: at, endsAt: at, branchId: id(4), professionalId: id(10), offerTtlMinutes: 10, actorUserId: id(1), emptyPreferences: 'EXCLUDED', explicitDaysOverrideWeekendFlag: true }, initiation: { kind: 'AUTHORIZED_REQUEST', actorUserId: id(1) } },
    initialSlotVersion: 1, lockVersion: 2, closureReasonCode: null, detectedAt: at, startedAt: at, finishedAt: null, createdAt: at, updatedAt: at, observedAt: at,
    candidates: [{ id: id(11), waitlistEntryId: id(12), recipient: { id: id(1) }, evaluationStatus: 'ELIGIBLE', rankingPosition: 2, exclusionReasonCode: null, evaluatedAt: at, createdAt: at,
      snapshot: { priorityLevel: 1, entryUpdatedAt: at, totalScore: '123.450000', scoreFactors: [{ code: 'PRIORITY_LEVEL', value: 1 }, { code: 'ENTERED_AT', value: at }],
        evaluationContext: { statusCode: 'ACTIVE', enteredAt: at, branchId: null, preferredBranchIds: [id(4)], allowsOtherBranches: false, minimumNoticeMinutes: 30, deadlineDate: null, priorityCode: 'STANDARD', priorityActive: true,
          preferences: { acceptsAnyProfessional: true, acceptsAnyTime: false, acceptsWeekend: false, preferredDays: [1, 3], timeRanges: [{ start: '09:00', end: '12:00' }] } } } },
      { id: id(13), waitlistEntryId: id(14), recipient: { id: id(15) }, evaluationStatus: 'EXCLUDED', rankingPosition: null, exclusionReasonCode: 'SPECIFIC_PROFESSIONAL_UNDEFINED', evaluatedAt: null, createdAt: at,
        snapshot: { priorityLevel: 1, entryUpdatedAt: at, totalScore: null, scoreFactors: [], evaluationContext: {} } }],
    offers: [{ id: id(16), candidateId: id(11), recipient: { id: id(1) }, attemptNumber: 1, status: 'PENDING', expectedSlotVersion: 3, lockVersion: 0, createdAt: at, expiresAt: '2030-10-01T12:10:00.000Z', respondedAt: null, resolvedAt: null, respondedByUserId: null, resolutionReasonCode: null }],
    pendingOfferId: id(16), activeOfferId: id(16),
  };
}
