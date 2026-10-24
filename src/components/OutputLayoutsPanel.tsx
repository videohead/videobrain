import { useCallback, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Monitor,
  ChevronDown,
  ChevronUp,
  Settings,
} from 'lucide-react';
import type { OutputLayout, SurfaceLayout } from '../store/contracts';
import {
  createMeshWarp,
  validateOutputLayouts,
} from '../engine/surfaceLayout';
import { OPERATOR_REGISTRY } from '../graph';

interface OutputLayoutsPanelProps {
  outputLayouts: readonly OutputLayout[];
  onChange: (layouts: readonly OutputLayout[]) => void;
  graphDocument: {
    nodes: Array<{ id: string; kind: string }>;
    edges: Array<{
      source: { nodeId: string; portId: string };
      target: { nodeId: string; portId: string };
    }>;
  };
  onOpenPresentation: (outputId: string) => void;
}

function createDefaultOutput(): OutputLayout {
  return {
    id: `output-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: 'Output',
    width: 1920,
    height: 1080,
    layoutX: 0,
    layoutY: 0,
    surfaces: [],
    blend: undefined,
  };
}

function createDefaultSurface(outputId: string, sourceNodeId: string): SurfaceLayout {
  return {
    id: `surface-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sourceNodeId,
    sourceUvRegion: { u0: 0, v0: 0, u1: 1, v1: 1 },
    warp: createMeshWarp(3, 3),
    maskPaths: [],
    outputId,
    layerIndex: 0,
    visible: true,
    blend: 'normal',
    opacity: 1,
  };
}

const hasFrameOutput = (kind: string): boolean =>
  kind in OPERATOR_REGISTRY &&
  OPERATOR_REGISTRY[kind as keyof typeof OPERATOR_REGISTRY].outputs.some(
    (port) => port.type === 'frame.rgba',
  );

const hasRoutedDisplaySource = (
  nodeId: string,
  graphDocument: OutputLayoutsPanelProps['graphDocument'],
): boolean =>
  graphDocument.edges.some(
    (edge) => edge.target.nodeId === nodeId && edge.target.portId === 'source',
  );

function OutputLayoutCard({
  layout,
  availableSources,
  onUpdate,
  onRemove,
  onAddSurface,
  onOpenPresentation,
}: {
  layout: OutputLayout;
  availableSources: Array<{ id: string; kind: string }>;
  onUpdate: (layout: OutputLayout) => void;
  onRemove: () => void;
  onAddSurface: () => void;
  onOpenPresentation: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const updateLayout = useCallback((partial: Partial<OutputLayout>) => {
    onUpdate({ ...layout, ...partial });
  }, [layout, onUpdate]);

  const updateSurface = useCallback((surfaceId: string, partial: Partial<SurfaceLayout>) => {
    const surfaces = layout.surfaces.map((s) =>
      s.id === surfaceId ? { ...s, ...partial } : s
    );
    onUpdate({ ...layout, surfaces });
  }, [layout, onUpdate]);

  const removeSurface = useCallback((surfaceId: string) => {
    const surfaces = layout.surfaces.filter((s) => s.id !== surfaceId);
    onUpdate({ ...layout, surfaces });
  }, [layout, onUpdate]);

  const validation = useMemo(() => validateOutputLayouts([layout]), [layout]);

  return (
    <div className="output-layout-card">
      <div className="output-layout-header">
        <button
          type="button"
          className="icon-button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="output-layout-title">
          <input
            type="text"
            value={layout.name}
            onChange={(e) => updateLayout({ name: e.target.value })}
            placeholder="Output name"
            className="output-layout-name"
          />
          <span className="output-layout-dimensions">
            {layout.width}×{layout.height}
          </span>
        </div>
        <div className="output-layout-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onOpenPresentation}
            title="Open presentation window"
            disabled={layout.surfaces.length === 0}
          >
            <Monitor size={16} />
            <span className="sr-only">Open presentation window</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onRemove}
            title="Remove output"
          >
            <Trash2 size={16} />
            <span className="sr-only">Remove output</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="output-layout-content">
          <div className="output-layout-fields">
            <div className="output-layout-field">
              <label htmlFor={`output-width-${layout.id}`}>Width</label>
              <input
                id={`output-width-${layout.id}`}
                type="number"
                value={layout.width}
                onChange={(e) => updateLayout({ width: Number(e.target.value) })}
                min={1}
                max={7680}
                step={1}
              />
            </div>
            <div className="output-layout-field">
              <label htmlFor={`output-height-${layout.id}`}>Height</label>
              <input
                id={`output-height-${layout.id}`}
                type="number"
                value={layout.height}
                onChange={(e) => updateLayout({ height: Number(e.target.value) })}
                min={1}
                max={7680}
                step={1}
              />
            </div>
            <div className="output-layout-field">
              <label htmlFor={`output-layoutX-${layout.id}`}>Layout X</label>
              <input
                id={`output-layoutX-${layout.id}`}
                type="number"
                value={layout.layoutX}
                onChange={(e) => updateLayout({ layoutX: Number(e.target.value) })}
                step={1}
              />
            </div>
            <div className="output-layout-field">
              <label htmlFor={`output-layoutY-${layout.id}`}>Layout Y</label>
              <input
                id={`output-layoutY-${layout.id}`}
                type="number"
                value={layout.layoutY}
                onChange={(e) => updateLayout({ layoutY: Number(e.target.value) })}
                step={1}
              />
            </div>
          </div>

          {validation.errors.length > 0 && (
            <div className="output-layout-errors">
              {validation.errors.map((error, i) => (
                <div key={i} className="output-layout-error">{error}</div>
              ))}
            </div>
          )}

          <div className="output-layout-surfaces">
            <div className="surfaces-header">
              <h4>Surfaces ({layout.surfaces.length})</h4>
              <button
                type="button"
                className="icon-button small"
                onClick={onAddSurface}
                disabled={availableSources.length === 0}
              >
                <Plus size={14} />
                <span>Add Surface</span>
              </button>
            </div>

            {layout.surfaces.length === 0 ? (
              <p className="empty-surfaces">
                No surfaces. Add a surface to map a frame source to this output.
              </p>
            ) : (
              <ul className="surfaces-list">
                {layout.surfaces.map((surface) => (
                  <li key={surface.id} className="surface-item">
                    <SurfaceItem
                      surface={surface}
                      availableSources={availableSources}
                      onUpdate={updateSurface}
                      onRemove={() => removeSurface(surface.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SurfaceItem({
  surface,
  availableSources,
  onUpdate,
  onRemove,
}: {
  surface: SurfaceLayout;
  availableSources: Array<{ id: string; kind: string }>;
  onUpdate: (surfaceId: string, partial: Partial<SurfaceLayout>) => void;
  onRemove: () => void;
}) {
  const sourceNode = availableSources.find((s) => s.id === surface.sourceNodeId);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="surface-item-card">
      <div className="surface-item-header">
        <button
          type="button"
          className="icon-button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse surface' : 'Expand surface'}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="surface-item-title">
          Surface
        </span>
        <span className="surface-item-source">
          {sourceNode ? `${sourceNode.kind} (${sourceNode.id})` : 'No source'}
        </span>
        <div className="surface-item-actions">
          <button
            type="button"
            className="icon-button small"
            onClick={() => onUpdate(surface.id, { visible: !surface.visible })}
            title={surface.visible ? 'Hide' : 'Show'}
          >
            {surface.visible ? <Monitor size={14} /> : <Monitor size={14} style={{ opacity: 0.3 }} />}
          </button>
          <button
            type="button"
            className="icon-button small"
            onClick={onRemove}
            title="Remove surface"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="surface-item-fields">
          <div className="surface-field">
            <label htmlFor={`surface-source-${surface.id}`}>Source Node</label>
            <select
              id={`surface-source-${surface.id}`}
              value={surface.sourceNodeId}
              onChange={(e) => onUpdate(surface.id, { sourceNodeId: e.target.value })}
            >
              <option value="">Select source...</option>
              {availableSources.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.kind} ({src.id})
                </option>
              ))}
            </select>
          </div>

          <div className="surface-field">
            <label htmlFor={`surface-layer-${surface.id}`}>Layer Index</label>
            <input
              id={`surface-layer-${surface.id}`}
              type="number"
              value={surface.layerIndex}
              onChange={(e) => onUpdate(surface.id, { layerIndex: Number(e.target.value) })}
              min={0}
              step={1}
            />
          </div>

          <div className="surface-field">
            <label htmlFor={`surface-opacity-${surface.id}`}>Opacity</label>
            <input
              id={`surface-opacity-${surface.id}`}
              type="number"
              value={surface.opacity}
              onChange={(e) => onUpdate(surface.id, { opacity: Number(e.target.value) })}
              min={0}
              max={1}
              step={0.01}
            />
          </div>

          <div className="surface-field">
            <label htmlFor={`surface-blend-${surface.id}`}>Blend Mode</label>
            <select
              id={`surface-blend-${surface.id}`}
              value={surface.blend}
              onChange={(e) => onUpdate(surface.id, { blend: e.target.value as SurfaceLayout['blend'] })}
            >
              <option value="normal">Normal</option>
              <option value="add">Add</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
            </select>
          </div>

          <div className="surface-field">
            <label htmlFor={`surface-visible-${surface.id}`}>Visible</label>
            <input
              id={`surface-visible-${surface.id}`}
              type="checkbox"
              checked={surface.visible}
              onChange={(e) => onUpdate(surface.id, { visible: e.target.checked })}
            />
          </div>

          <div className="surface-field">
            <label>UV Region</label>
            <div className="uv-region-inputs">
              <input
                type="number"
                value={surface.sourceUvRegion.u0}
                onChange={(e) => onUpdate(surface.id, { sourceUvRegion: { ...surface.sourceUvRegion, u0: Number(e.target.value) } })}
                min={0} max={1} step={0.01} placeholder="u0"
              />
              <input
                type="number"
                value={surface.sourceUvRegion.v0}
                onChange={(e) => onUpdate(surface.id, { sourceUvRegion: { ...surface.sourceUvRegion, v0: Number(e.target.value) } })}
                min={0} max={1} step={0.01} placeholder="v0"
              />
              <input
                type="number"
                value={surface.sourceUvRegion.u1}
                onChange={(e) => onUpdate(surface.id, { sourceUvRegion: { ...surface.sourceUvRegion, u1: Number(e.target.value) } })}
                min={0} max={1} step={0.01} placeholder="u1"
              />
              <input
                type="number"
                value={surface.sourceUvRegion.v1}
                onChange={(e) => onUpdate(surface.id, { sourceUvRegion: { ...surface.sourceUvRegion, v1: Number(e.target.value) } })}
                min={0} max={1} step={0.01} placeholder="v1"
              />
            </div>
          </div>

          <div className="surface-warp-section">
            <div className="surface-warp-header">
              <span>Mesh Warp ({surface.warp?.rows ?? 0}×{surface.warp?.cols ?? 0})</span>
              <div className="warp-controls">
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => onUpdate(surface.id, { warp: createMeshWarp(3, 3) })}
                  title="Reset warp"
                >
                  <Settings size={14} />
                </button>
              </div>
            </div>
            <p className="surface-warp-hint">
              Use the Surface Mapping Editor for visual warp editing.
            </p>
          </div>

          <div className="surface-mask-section">
            <div className="surface-mask-header">
              <span>Mask Paths ({surface.maskPaths.length})</span>
            </div>
            <p className="surface-mask-hint">
              Use the Surface Mapping Editor for visual mask editing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function OutputLayoutsPanel({
  outputLayouts,
  onChange,
  graphDocument,
  onOpenPresentation,
}: OutputLayoutsPanelProps) {
  const availableSources = useMemo(() =>
    graphDocument.nodes
      .filter((node) =>
        hasFrameOutput(node.kind) ||
        (node.kind === 'display' && hasRoutedDisplaySource(node.id, graphDocument))
      )
      .map((node) => ({ id: node.id, kind: node.kind })),
    [graphDocument]
  );

  const updateLayout = useCallback((updatedLayout: OutputLayout) => {
    onChange(outputLayouts.map((layout) =>
      layout.id === updatedLayout.id ? updatedLayout : layout
    ));
  }, [outputLayouts, onChange]);

  const addOutput = useCallback(() => {
    const newLayout = createDefaultOutput();
    onChange([...outputLayouts, newLayout]);
  }, [outputLayouts, onChange]);

  const removeOutput = useCallback((outputId: string) => {
    onChange(outputLayouts.filter((layout) => layout.id !== outputId));
  }, [outputLayouts, onChange]);

  const addSurface = useCallback((outputId: string) => {
    if (availableSources.length === 0) return;
    const initialSource = availableSources.find((source) => source.kind === 'display') ?? availableSources[0];
    if (!initialSource) return;
    const newLayouts = outputLayouts.map((layout) => {
      if (layout.id === outputId) {
        const surface = createDefaultSurface(outputId, initialSource.id);
        return { ...layout, surfaces: [...layout.surfaces, surface] };
      }
      return layout;
    });
    onChange(newLayouts);
  }, [outputLayouts, availableSources, onChange]);

  return (
    <section className="output-layouts-panel">
      <div className="panel-header">
        <h3>Output Layouts</h3>
        <button
          type="button"
          className="primary-button"
          onClick={addOutput}
        >
          <Plus size={14} /> Add Output
        </button>
      </div>

      {outputLayouts.length === 0 ? (
        <div className="output-layouts-empty">
          <p>No output layouts defined.</p>
          <p className="hint">Add an output layout to map graph surfaces to physical displays.</p>
        </div>
      ) : (
        <div className="output-layouts-list">
          {outputLayouts.map((layout) => (
            <OutputLayoutCard
              key={layout.id}
              layout={layout}
              availableSources={availableSources}
              onUpdate={updateLayout}
              onRemove={() => removeOutput(layout.id)}
              onAddSurface={() => addSurface(layout.id)}
              onOpenPresentation={() => onOpenPresentation(layout.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}