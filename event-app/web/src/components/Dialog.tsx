import { useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * In-page replacements for window.confirm / window.prompt, which look out of place on a
 * phone and are blocked in some embedded browsers. Mount <DialogHost /> once.
 */
type Request =
  | { kind: 'confirm'; message: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; initial: string; inputMode?: 'numeric'; resolve: (v: string | null) => void };

let show: ((r: Request) => void) | null = null;

export function ask(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ kind: 'confirm', message, confirmLabel: opts.confirmLabel ?? 'OK', danger: opts.danger ?? false, resolve });
  });
}

export function askText(message: string, initial = '', opts: { inputMode?: 'numeric' } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    show({ kind: 'prompt', message, initial, inputMode: opts.inputMode, resolve });
  });
}

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    show = (r) => {
      setText(r.kind === 'prompt' ? r.initial : '');
      setReq(r);
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    (req.kind === 'prompt' ? inputRef.current : okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!req) return null;
  const close = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok ? text : null);
    setReq(null);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    close(true);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={() => close(false)}>
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="card w-full max-w-sm space-y-4 shadow-xl"
      >
        <p className="whitespace-pre-line text-sm">{req.message}</p>
        {req.kind === 'prompt' && (
          <input
            ref={inputRef}
            id="dialog-input"
            className="input"
            inputMode={req.inputMode}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => close(false)}>
            Cancel
          </button>
          <button ref={okRef} className={req.kind === 'confirm' && req.danger ? 'btn-danger' : 'btn-primary'}>
            {req.kind === 'confirm' ? req.confirmLabel : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
