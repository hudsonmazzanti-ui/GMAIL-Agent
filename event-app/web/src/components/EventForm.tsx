import { useState, type FormEvent } from 'react';
import type { EventRow } from '../api';

export interface EventFormValues {
  name: string;
  game: string;
  format: string;
  date: string;
  startTime: string;
  description: string;
  entryFeeNote: string;
  capacity: number | null;
  swissRounds: number | null;
  topCutSize: number;
  bestOf: number;
  roundMinutes: number;
}

export const fromRow = (e: EventRow): EventFormValues => ({
  name: e.name,
  game: e.game,
  format: e.format,
  date: e.date,
  startTime: e.start_time,
  description: e.description,
  entryFeeNote: e.entry_fee_note,
  capacity: e.capacity,
  swissRounds: e.swiss_rounds,
  topCutSize: e.top_cut_size,
  bestOf: e.best_of,
  roundMinutes: e.round_minutes,
});

const EMPTY: EventFormValues = {
  name: '',
  game: '',
  format: '',
  date: new Date().toISOString().slice(0, 10),
  startTime: '18:00',
  description: '',
  entryFeeNote: '',
  capacity: null,
  swissRounds: null,
  topCutSize: 8,
  bestOf: 3,
  roundMinutes: 50,
};

export function EventForm({
  initial,
  started = false,
  recommendedRounds,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial?: EventFormValues;
  started?: boolean;
  recommendedRounds?: number;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: EventFormValues) => void;
}) {
  const [v, setV] = useState<EventFormValues>(initial ?? EMPTY);
  const set = <K extends keyof EventFormValues>(k: K, value: EventFormValues[K]) => setV({ ...v, [k]: value });
  const num = (s: string) => (s === '' ? null : Number(s));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(v);
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="sm:col-span-2">
        <span className="label">Event name</span>
        <input className="input" required value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Friday Night Constructed" />
      </label>
      <label>
        <span className="label">Game</span>
        <input className="input" value={v.game} onChange={(e) => set('game', e.target.value)} placeholder="Magic, Pokémon, Lorcana…" />
      </label>
      <label>
        <span className="label">Format</span>
        <input className="input" value={v.format} onChange={(e) => set('format', e.target.value)} placeholder="Standard, Draft, Sealed…" />
      </label>
      <label>
        <span className="label">Date</span>
        <input className="input" type="date" value={v.date} onChange={(e) => set('date', e.target.value)} />
      </label>
      <label>
        <span className="label">Start time</span>
        <input className="input" type="time" value={v.startTime} onChange={(e) => set('startTime', e.target.value)} />
      </label>
      <label>
        <span className="label">Capacity (blank = unlimited)</span>
        <input className="input" type="number" min={2} value={v.capacity ?? ''} onChange={(e) => set('capacity', num(e.target.value))} />
      </label>
      <label>
        <span className="label">Entry fee / prizes note</span>
        <input className="input" value={v.entryFeeNote} onChange={(e) => set('entryFeeNote', e.target.value)} placeholder="$10 · packs to top 4" />
      </label>
      <label>
        <span className="label">Match length</span>
        <select className="input" disabled={started} value={v.bestOf} onChange={(e) => set('bestOf', Number(e.target.value))}>
          <option value={1}>Best of 1</option>
          <option value={3}>Best of 3</option>
          <option value={5}>Best of 5</option>
        </select>
      </label>
      <label>
        <span className="label">Round time (minutes)</span>
        <input className="input" type="number" min={5} value={v.roundMinutes} onChange={(e) => set('roundMinutes', Number(e.target.value))} />
      </label>
      <label>
        <span className="label">Swiss rounds{recommendedRounds ? ` (auto = ${recommendedRounds})` : ' (blank = auto)'}</span>
        <input
          className="input"
          type="number"
          min={1}
          placeholder="Auto from player count"
          value={v.swissRounds ?? ''}
          onChange={(e) => set('swissRounds', num(e.target.value))}
        />
      </label>
      <label>
        <span className="label">Top cut</span>
        <select className="input" value={v.topCutSize} onChange={(e) => set('topCutSize', Number(e.target.value))}>
          <option value={0}>None (Swiss only)</option>
          <option value={2}>Top 2</option>
          <option value={4}>Top 4</option>
          <option value={8}>Top 8</option>
          <option value={16}>Top 16</option>
          <option value={32}>Top 32</option>
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className="label">Description</span>
        <textarea className="input min-h-20" value={v.description} onChange={(e) => set('description', e.target.value)} />
      </label>
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
