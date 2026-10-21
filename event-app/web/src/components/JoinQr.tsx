import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/** "ABC234" → "ABC-234", easier to read aloud and type. */
export const formatJoinCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

let serverInfo: Promise<{ publicUrls: string[]; configured: boolean }> | null = null;

/**
 * The address players' phones should open. On the store computer the app is often opened as
 * localhost, which a phone can't reach, so use the computer's Wi-Fi address instead.
 */
export function useJoinUrl(code: string | null) {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    serverInfo ??= api('/api/server-info').catch(() => ({ publicUrls: [], configured: false }));
    serverInfo.then((info) => {
      const local = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname) || location.protocol === 'file:';
      const useServer = info.publicUrls[0] && (info.configured || local);
      setBase(useServer ? info.publicUrls[0] : location.origin);
    });
  }, []);
  return code && base ? `${base}/join/${code}` : null;
}

export function QrCode({ text, size = 240, label }: { text: string; size?: number; label: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [text]);
  // Always dark-on-white with a quiet zone, whatever the page theme, so phones can read it.
  return (
    <div
      role="img"
      aria-label={label}
      className="rounded-lg bg-white p-3 [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size, maxWidth: '100%' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** QR code + event code + address: what staff hold up for players to scan. */
export function JoinQr({ code, eventName, size = 240 }: { code: string; eventName: string; size?: number }) {
  const url = useJoinUrl(code);
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the address is selectable text below.
    }
  };
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <QrCode text={url} size={size} label={`QR code to join ${eventName}`} />
      <div>
        <div className="label">Event code</div>
        <div className="font-mono text-3xl font-black tracking-widest">{formatJoinCode(code)}</div>
      </div>
      <div className="flex max-w-full items-center gap-2 text-xs text-slate-500">
        <span className="min-w-0 select-all break-all font-mono">{url}</span>
        <button className="btn-secondary btn-sm shrink-0" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
