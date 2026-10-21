import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DEMO } from '../env';

/** Opens an in-app page (projector, print slips) in a new tab; the demo opens it in place instead. */
export function NewTabLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  if (DEMO) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

/** CSV exports are plain downloads from the store server; the demo has no server to download from. */
export function DownloadLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (DEMO) {
    return (
      <span className={`${className ?? ''} cursor-not-allowed opacity-50`} title="CSV downloads work in the store install">
        {children}
      </span>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
