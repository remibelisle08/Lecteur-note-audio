import { href } from '../routes';

export function BackLink({ to = href({ name: 'library' }), label = 'Mes cours' }: { to?: string; label?: string }) {
  return (
    <a className="back-link" href={to}>
      ← {label}
    </a>
  );
}
