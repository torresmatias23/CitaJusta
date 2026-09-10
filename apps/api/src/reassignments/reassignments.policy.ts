import type { Prisma } from '../generated/prisma/client.js';

export const candidateSelect = {
  id: true, userId: true, institutionId: true, serviceId: true, branchId: true,
  priorityId: true, enteredAt: true, updatedAt: true, deadlineDate: true,
  minimumNoticeMinutes: true, allowsOtherBranches: true,
  status: { select: { id: true, code: true, isFinal: true } },
  user: { select: { status: true, deletedAt: true } },
  priority: { select: { institutionId: true, code: true, level: true, active: true } },
  branch: { select: { institutionId: true } },
  preference: { select: {
    acceptsAnyProfessional: true, acceptsAnyTime: true, acceptsWeekend: true,
    preferredDays: { select: { dayOfWeek: true }, orderBy: { dayOfWeek: 'asc' } },
    timeRanges: { select: { startTime: true, endTime: true }, orderBy: { startTime: 'asc' } },
  } },
  preferredBranches: { select: { branchId: true, branch: { select: { institutionId: true } } }, orderBy: { preferenceOrder: 'asc' } },
} as const satisfies Prisma.WaitlistEntrySelect;
export type CandidateEntry = Prisma.WaitlistEntryGetPayload<{ select: typeof candidateSelect }>;
export interface EvaluationSlot {
  institutionId: string; serviceId: string; branchId: string; sourceUserId: string;
  startsAt: Date; endsAt: Date; timeZone: string;
}

export function localTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  const day = `${value('year')}-${value('month')}-${value('day')}`;
  return { date: day, weekday: new Date(`${day}T12:00:00Z`).getUTCDay() || 7,
    seconds: Number(value('hour')) * 3600 + Number(value('minute')) * 60 + Number(value('second')) + date.getUTCMilliseconds() / 1000 };
}
const seconds = (date: Date) => date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;

// Lower configured level wins; no invented numeric scoring formula.
export function compareCandidates(a: CandidateEntry, b: CandidateEntry) {
  return a.priority.level - b.priority.level || a.enteredAt.getTime() - b.enteredAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function exclusionReason(entry: CandidateEntry, slot: EvaluationSlot, now: Date): string | null {
  if (entry.institutionId !== slot.institutionId || entry.serviceId !== slot.serviceId ||
      (entry.branch && entry.branch.institutionId !== slot.institutionId)) return 'INCOHERENT_CONTEXT';
  if (entry.preference?.acceptsAnyProfessional === false) return 'SPECIFIC_PROFESSIONAL_UNDEFINED';
  if (entry.userId === slot.sourceUserId) return 'SOURCE_USER';
  if (entry.user.status !== 'ACTIVE' || entry.user.deletedAt) return 'USER_UNAVAILABLE';
  if (!entry.priority.active || entry.priority.institutionId !== slot.institutionId) return 'PRIORITY_UNAVAILABLE';
  const preference = entry.preference;
  if (!preference) return 'PREFERENCES_UNDEFINED';
  const preferredBranch = entry.preferredBranches.some((branch) => branch.branchId === slot.branchId && branch.branch.institutionId === slot.institutionId);
  if (entry.branchId !== slot.branchId && !preferredBranch && !entry.allowsOtherBranches) return 'BRANCH_INCOMPATIBLE';
  const start = localTime(slot.startsAt, slot.timeZone); const end = localTime(slot.endsAt, slot.timeZone);
  if (entry.deadlineDate && start.date > entry.deadlineDate.toISOString().slice(0, 10)) return 'DEADLINE_EXCEEDED';
  if (slot.startsAt.getTime() - now.getTime() < entry.minimumNoticeMinutes * 60_000) return 'INSUFFICIENT_NOTICE';
  if (preference.preferredDays.length === 0) return 'DAYS_UNDEFINED';
  if (!preference.preferredDays.some((day) => day.dayOfWeek === start.weekday)) return 'DAY_INCOMPATIBLE';
  if (start.date !== end.date || end.seconds <= start.seconds) return 'TIME_INCOMPATIBLE';
  if (preference.timeRanges.length === 0) return preference.acceptsAnyTime ? null : 'TIME_UNDEFINED';
  if (!preference.timeRanges.some((range) => seconds(range.startTime) <= start.seconds && seconds(range.endTime) >= end.seconds)) return 'TIME_INCOMPATIBLE';
  return null;
}

export function preferenceSnapshot(entry: CandidateEntry): Prisma.InputJsonObject {
  return {
    statusId: entry.status.id, statusCode: entry.status.code, enteredAt: entry.enteredAt.toISOString(),
    branchId: entry.branchId, preferredBranchIds: entry.preferredBranches.map((branch) => branch.branchId),
    allowsOtherBranches: entry.allowsOtherBranches, minimumNoticeMinutes: entry.minimumNoticeMinutes,
    deadlineDate: entry.deadlineDate?.toISOString() ?? null,
    priorityCode: entry.priority.code, priorityActive: entry.priority.active,
    preferences: entry.preference ? {
      acceptsAnyProfessional: entry.preference.acceptsAnyProfessional,
      acceptsAnyTime: entry.preference.acceptsAnyTime, acceptsWeekend: entry.preference.acceptsWeekend,
      preferredDays: entry.preference.preferredDays.map((day) => day.dayOfWeek),
      timeRanges: entry.preference.timeRanges.map((range) => ({ start: range.startTime.toISOString().slice(11, 19), end: range.endTime.toISOString().slice(11, 19) })),
    } : null,
  };
}
