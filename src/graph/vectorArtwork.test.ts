import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VECTOR_ARTWORK,
  MAX_VECTOR_BYTES,
  validateVectorArtwork,
  vectorArtworkAtSize,
} from './vectorArtwork';
import { createGraphNode, parseGraphDocument } from './model';
import { GRAPH_SCHEMA_VERSION } from './types';

const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`;

describe('vector artwork validation', () => {
  it('round-trips project artwork and rejects unsafe project imports', () => {
    const node = createGraphNode('vectorShape', { x: 0, y: 0 });
    const project = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: [node],
      edges: [],
    };
    expect(parseGraphDocument(JSON.parse(JSON.stringify(project)))).toEqual(
      project,
    );
    node.params.artwork = svg('<script>alert(1)</script>');
    expect(() => parseGraphDocument(project)).toThrow('params.artwork');
  });

  it('round-trips curves, compound paths, and safe presentation styles', () => {
    const result = validateVectorArtwork(
      svg(
        '<path d="M0 0 C10 20 30 40 50 50 Z" style="fill: #ff0000; stroke-width: 2; stroke: #ffffff"/>',
      ),
    );
    expect(result).toContain('C10 20 30 40 50 50');
    expect(result).toContain('stroke-width="2"');
    expect(result).not.toContain('style=');
    expect(validateVectorArtwork(result)).toBe(result);
  });

  it('keeps internal gradient references and sizes rasterization without changing the viewBox', () => {
    expect(
      validateVectorArtwork(
        svg(
          '<defs><linearGradient id="color"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="100" height="100" fill="url(#color)"/>',
        ),
      ),
    ).toContain('url(#color)');
    const result = vectorArtworkAtSize(DEFAULT_VECTOR_ARTWORK, 640, 360);
    expect(result).toContain('width="640"');
    expect(result).toContain('height="360"');
    expect(result).toContain('viewBox="0 0 512 512"');
  });

  it.each([
    '<script>alert(1)</script>',
    '<foreignObject/>',
    '<image href="https://example.org/image.png"/>',
    '<use href="#shape"/>',
    '<animate attributeName="opacity"/>',
    '<path onload="alert(1)"/>',
    '<path fill="url(https://example.org/image.svg)"/>',
    '<path style="fill: url(https://example.org/image.svg)"/>',
    '<defs><linearGradient href="https://example.org/image.svg"/></defs>',
  ])('rejects active or external SVG content: %s', (content) => {
    expect(() => validateVectorArtwork(svg(content))).toThrow();
  });

  it('rejects malformed, oversized, and unbounded documents', () => {
    expect(() => validateVectorArtwork('<svg>')).toThrow();
    expect(() =>
      validateVectorArtwork(' '.repeat(MAX_VECTOR_BYTES + 1)),
    ).toThrow('150 KB');
    expect(() => validateVectorArtwork(svg('<g/>'.repeat(513)))).toThrow(
      '512-element',
    );
    expect(() =>
      validateVectorArtwork(svg('').replace('100 100', '0 100')),
    ).toThrow('viewBox');
  });
});
