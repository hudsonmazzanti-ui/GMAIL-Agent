import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The tools drawer: everything staff only need when something unusual happens.
 * Slides in from the right; `focus` opens and scrolls to one section.
 */
export function SideBar({
  open,
  onClose,
  title = 'Tools',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Rendered into <body> so page spacing (e.g. space-y margins) can never shift the overlay.
  return createPortal(
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-slate-950/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={title}
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white transition-[transform,visibility] dark:bg-slate-900 ${
          open ? 'visible translate-x-0 shadow-2xl' : 'invisible translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">{open && children}</div>
      </aside>
    </div>,
    document.body,
  );
}

/** One collapsible group in the side bar. */
export function ToolSection({
  id,
  title,
  hint,
  focus,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  focus?: string | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (focus === id && ref.current) {
      ref.current.open = true;
      ref.current.scrollIntoView({ block: 'start' });
    }
  }, [focus, id]);
  return (
    <details ref={ref} id={`tools-${id}`} className="group rounded-lg border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 font-semibold">
        <span>
          {title}
          {hint && <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>}
        </span>
        <span className="text-slate-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">{children}</div>
    </details>
  );
}
