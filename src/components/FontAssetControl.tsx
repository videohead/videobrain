import { useEffect, useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { decodeFontAsset, MAX_FONT_BYTES } from '../graph/fontAsset';

export function FontAssetControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { request.current += 1; }, [value]);

  async function importFont(file: File) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      if (file.size > MAX_FONT_BYTES) throw new Error('Font exceeds the 384 KB limit.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const signature = String.fromCharCode(...bytes.slice(0, 4));
      const format = ({ wOF2: 'woff2', wOFF: 'woff', OTTO: 'otf', '\u0000\u0001\u0000\u0000': 'ttf' } as Record<string, string>)[signature];
      if (!format) throw new Error('Choose a WOFF2, WOFF, TTF, or OTF font file.');
      const encoded = `data:font/${format};base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
      decodeFontAsset(encoded);
      if (typeof FontFace === 'undefined') throw new Error('Custom fonts are unavailable in this browser.');
      await new FontFace('VideoBrainFontValidation', bytes.buffer).load();
      if (request.current !== current) return;
      setLoading(false);
      onChange(encoded);
    } catch (caught) {
      if (request.current === current) setError(caught instanceof Error ? caught.message : 'The font could not be imported.');
    } finally {
      if (request.current === current) setLoading(false);
    }
  }

  return (
    <div className="font-asset-control nodrag nopan nowheel" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <div className="vector-artwork-actions">
        <span>{loading ? 'Loading font...' : value ? 'Embedded font' : 'Built-in fonts'}</span>
        <button className="icon-button" type="button" title="Import font" aria-label="Import font" disabled={loading} onClick={() => input.current?.click()}><Upload size={14} /></button>
        <button className="icon-button" type="button" title="Remove font" aria-label="Remove font" disabled={!value || loading} onClick={() => { setError(null); onChange(''); }}><Trash2 size={14} /></button>
      </div>
      <input ref={input} className="sr-only" type="file" accept=".woff2,.woff,.ttf,.otf" aria-label="Import font asset" disabled={loading} onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void importFont(file);
      }} />
      {error && <p className="vector-error" role="alert">{error}</p>}
    </div>
  );
}