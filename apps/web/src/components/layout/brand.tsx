import { Link } from 'react-router';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="CitaJusta, inicio">
      <img
        src="/images/logo-citajusta.png"
        alt="CitaJusta"
        width={2000}
        height={2000}
        className="brand-image"
      />
    </Link>
  );
}
