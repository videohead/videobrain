import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Pencil, Upload } from 'lucide-react';
import {
  MAX_VECTOR_BYTES,
  validateVectorArtwork,
} from '../graph/vectorArtwork';

const VectorShapeEditor = lazy(() => import('./VectorShapeEditor'));

export function VectorArtworkControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (artwork: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => {
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(validateVectorArtwork(value))}`;
    } catch {
      return null;
    }
  }, [value]);

  async function importArtwork(file: File) {
    setLoading(true);
    try {
      if (file.size > MAX_VECTOR_BYTES)
        throw new Error('SVG artwork exceeds the 150 KB limit.');
      onChange(validateVectorArtwork(await file.text()));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The SVG file could not be imported.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="vector-artwork-control nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {preview ? (
        <img
          className="vector-artwork-preview"
          src={preview}
          alt="Vector artwork"
        />
      ) : (
        <p role="status">Invalid SVG artwork</p>
      )}
      <div className="vector-artwork-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => setEditing(true)}
        >
          <Pencil size={14} /> Edit artwork
        </button>
        <button
          type="button"
          className="icon-button"
          title="Import SVG"
          aria-label="Import SVG"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={16} />
        </button>
      </div>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="Import SVG artwork"
        disabled={loading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importArtwork(file);
        }}
      />
      {loading && <span role="status">Importing SVG...</span>}
      {error && (
        <p className="vector-error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <Suspense fallback={<span role="status">Loading editor...</span>}>
          <VectorShapeEditor
            value={value}
            onCancel={() => setEditing(false)}
            onApply={(artwork) => {
              onChange(artwork);
              setError(null);
              setEditing(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
