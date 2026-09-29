import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { createAgendaModel } from '../agenda/agenda-model.ts';
import type { AgendaState } from '../agenda/agenda-model.ts';
import type { AgendaFilters } from '../agenda/agenda-api.ts';
import { attendanceError, attendancePermissions, canRecordAttendance, createAttendanceApi } from './attendance-api.ts';
import type { AttendanceStatus } from './attendance-api.ts';

export type AttendanceState = { agenda: AgendaState; busyId: string | null; feedback: string; failed: boolean };
export function createAttendanceModel(api: ApiClient, user: UserProfile) {
  // Compose the existing read model: filters, catalogs, timezone, decoding and stale-read protection remain in HU-031.
  const agenda = createAgendaModel(api, user), client = createAttendanceApi(api, user);
  let state: AttendanceState = { agenda: agenda.getSnapshot(), busyId: null, feedback: '', failed: false };
  let active = true, lifecycle = 0, viewRevision = 0, writeController = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AttendanceState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const observe = () => agenda.subscribe(() => update({ agenda: agenda.getSnapshot() }));
  let unsubscribe = observe();
  return {
    permissions: attendancePermissions(user), branchContext: agenda.branchContext,
    canRecord: (item: Parameters<typeof canRecordAttendance>[1]) => canRecordAttendance(user, item),
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => state,
    activate() {
      active = true; lifecycle++; writeController = new AbortController(); unsubscribe(); unsubscribe = observe();
      update({ agenda: agenda.getSnapshot(), busyId: null, feedback: '', failed: false });
      return agenda.activate();
    },
    dispose() {
      active = false; lifecycle++; viewRevision++; writeController.abort(); unsubscribe(); agenda.dispose();
      state = { agenda: agenda.getSnapshot(), busyId: null, feedback: '', failed: false };
    },
    reloadCatalogs: agenda.reloadCatalogs,
    setFilters(patch: Partial<AgendaFilters>) {
      if (!active) return;
      viewRevision++; update({ feedback: '', failed: false }); agenda.setFilters(patch);
    },
    consult() {
      if (!active) return Promise.resolve();
      viewRevision++; update({ feedback: '', failed: false }); return agenda.consult();
    },
    async record(appointmentId: string, status: AttendanceStatus) {
      const item = state.agenda.items.find(item => item.id === appointmentId);
      if (!active || state.busyId || state.agenda.status !== 'ready' || !item || !canRecordAttendance(user, item)) return false;
      const epoch = lifecycle, revision = viewRevision, signal = writeController.signal;
      const current = () => active && lifecycle === epoch && !signal.aborted;
      update({ busyId: appointmentId, feedback: '', failed: false });
      try {
        await client.record(appointmentId, status, signal);
        if (!current() || revision !== viewRevision) return false;
        update({ feedback: status === 'ATENDIDA' ? 'Asistencia registrada.' : 'Inasistencia registrada.' });
        await agenda.consult();
        return current() && revision === viewRevision;
      } catch (error) {
        if (current() && revision === viewRevision) update({ feedback: attendanceError(error), failed: true });
        return false;
      } finally { if (current()) update({ busyId: null }); }
    },
  };
}
