import type { ReactNode } from 'react';
import { STATUS_LABEL, STATUS_STYLE, type EventRow } from '../api';

export function StatusPill({ status }: { status: EventRow['status'] }) {
  return <span className={`pill ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
      {error}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-print -mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
      {tabs.map(([key, label]) => (
        <button key={key} className={`tab ${value === key ? 'tab-active' : ''}`} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card py-3">
      <div className="label">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
