import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function Card({ title, icon: Icon, tone, children, id }: {
  title: string;
  icon: LucideIcon;
  tone: 'teal' | 'blue' | 'amber' | 'purple';
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className={`dashboard-card card-${tone}`} id={id} aria-label={title}>
      <h2 className="card-heading"><Icon size={23} aria-hidden="true" />{title}</h2>
      <div className="card-content">{children}</div>
    </section>
  );
}
