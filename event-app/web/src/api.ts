import type { EventState } from '../../server/tournament';
import type { EventRow } from '../../server/db/client';
import type { Viewer } from '../../server/auth';

export type { EventState, EventRow, Viewer };
export type RoundView = EventState['rounds'][number];
export type MatchView = RoundView['matches'][number];
export type StandingView = EventState['standings'][number];
export type EventListItem = EventRow & { registered: number };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText);
  return data as T;
}

export const STATUS_LABEL: Record<EventRow['status'], string> = {
  draft: 'Draft',
  registration: 'Registration open',
  checkin: 'Check-in',
  swiss: 'In progress',
  topcut: 'Top cut',
  complete: 'Complete',
};

export const STATUS_STYLE: Record<EventRow['status'], string> = {
  draft: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  registration: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  checkin: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  swiss: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300',
  topcut: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/50 dark:text-fuchsia-300',
  complete: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export type PaymentView = NonNullable<EventState['registrations'][number]['payment']>;

export function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const record = (s: StandingView) => `${s.wins}-${s.losses}-${s.draws}`;

export function formatDate(date: string, time?: string) {
  if (!date) return 'Date TBA';
  const d = new Date(`${date}T${time || '00:00'}`);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? `${day} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : day;
}

export function resultText(m: MatchView) {
  if (!m.p2) return 'Bye';
  if (m.resultStatus === 'pending') return '—';
  return `${m.p1Games}-${m.p2Games}${m.draws ? `-${m.draws}` : ''}`;
}
