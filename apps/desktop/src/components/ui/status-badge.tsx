import type { ReactNode } from 'react';

const tones: Record<string, string> = {
  AGENDADA: 'info', ATENDIDA: 'success', ACTIVE: 'success',
  INASISTENCIA: 'warning', SUSPENDED: 'warning', CANCELADA: 'danger',
};

export function StatusBadge({ code, children }: { code: string; children: ReactNode }) {
  return <span className={`status-badge tone-${tones[code] ?? 'neutral'}`}>{children}</span>;
}
