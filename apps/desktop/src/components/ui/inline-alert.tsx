import type { ReactNode } from 'react';

export function InlineAlert({ failed = false, children }: { failed?: boolean; children: ReactNode }) {
  return <p className={`inline-alert ${failed ? 'tone-danger' : 'tone-success'}`} role={failed ? 'alert' : 'status'}>{children}</p>;
}
