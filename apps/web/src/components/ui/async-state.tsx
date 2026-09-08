import { CircleAlert, Inbox, LoaderCircle } from 'lucide-react';

export function AsyncState({ kind, title, description, onRetry }: {
  kind: 'loading' | 'error' | 'empty';
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  const Icon = kind === 'loading' ? LoaderCircle : kind === 'error' ? CircleAlert : Inbox;
  return (
    <div className="async-state" role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading'}>
      <Icon aria-hidden="true" className={kind === 'loading' ? 'motion-safe:animate-spin' : ''} />
      <p className="font-semibold text-ink">{title}</p>
      {description && <p>{description}</p>}
      {kind === 'error' && onRetry && <button type="button" className="button button-outline" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}
