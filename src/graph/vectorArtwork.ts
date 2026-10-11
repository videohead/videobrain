import DOMPurify from 'dompurify';

export const MAX_VECTOR_BYTES = 150_000;
export const MAX_VECTOR_ELEMENTS = 512;
export const DEFAULT_VECTOR_ARTWORK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M80 320 C80 80 432 80 432 320 L256 432 Z" fill="#ff795c"/><circle cx="256" cy="240" r="64" fill="#17191c"/></svg>';

const TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'title',
  'desc',
];
const ATTRIBUTES = [
  'xmlns',
  'id',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'fx',
  'fy',
  'fr',
  'href',
  'xlink:href',
  'preserveAspectRatio',
  'vector-effect',
  'paint-order',
];
const STYLE_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'clip-path',
  'clip-rule',
  'stop-color',
  'stop-opacity',
  'vector-effect',
  'paint-order',
]);

export function validateVectorArtwork(source: string): string {
  if (new TextEncoder().encode(source).byteLength > MAX_VECTOR_BYTES) {
    throw new Error('SVG artwork exceeds the 150 KB limit.');
  }
  if (/<!ENTITY/i.test(source))
    throw new Error('SVG entities are not supported.');
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = parsed.documentElement;
  if (
    parsed.querySelector('parsererror') ||
    root.localName !== 'svg' ||
    root.namespaceURI !== 'http://www.w3.org/2000/svg'
  ) {
    throw new Error('Choose a valid SVG document.');
  }
  const elements = [...parsed.querySelectorAll('*')];
  if (elements.length > MAX_VECTOR_ELEMENTS)
    throw new Error('SVG artwork exceeds the 512-element limit.');
  for (const element of elements) {
    if (
      !TAGS.includes(element.localName) ||
      element.namespaceURI !== root.namespaceURI
    ) {
      throw new Error(
        `Unsupported SVG element: ${element.localName}. Use static vector paths and shapes.`,
      );
    }
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim();
      if (
        /^on/i.test(attribute.name) ||
        /[\\@]/.test(value) ||
        (/href$/i.test(attribute.name) && !/^#[\w.-]+$/.test(value))
      ) {
        throw new Error('SVG scripts and external references are not allowed.');
      }
      if (/url\s*\(/i.test(value)) {
        const references = value.match(/url\s*\([^)]*\)/gi) ?? [];
        if (
          references.some(
            (reference) =>
              !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/i.test(reference),
          )
        ) {
          throw new Error('SVG external resources are not allowed.');
        }
      }
    }
    if (element.hasAttribute('style')) {
      const style = document.createElement('span').style;
      style.cssText = element.getAttribute('style') ?? '';
      for (let index = 0; index < style.length; index += 1) {
        const property = style.item(index);
        if (STYLE_PROPERTIES.has(property))
          element.setAttribute(property, style.getPropertyValue(property));
      }
      element.removeAttribute('style');
    }
  }
  if (!root.hasAttribute('viewBox')) {
    const width = Number.parseFloat(root.getAttribute('width') ?? '512');
    const height = Number.parseFloat(root.getAttribute('height') ?? '512');
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  const bounds =
    root
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  if (
    bounds.length !== 4 ||
    bounds.some(
      (value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000,
    ) ||
    (bounds[2] ?? 0) <= 0 ||
    (bounds[3] ?? 0) <= 0
  ) {
    throw new Error('SVG viewBox must have finite, positive dimensions.');
  }
  root.setAttribute('width', '512');
  root.setAttribute('height', '512');
  const sanitized = DOMPurify.sanitize(
    new XMLSerializer().serializeToString(root),
    {
      ALLOWED_TAGS: TAGS,
      ALLOWED_ATTR: ATTRIBUTES,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      PARSER_MEDIA_TYPE: 'application/xhtml+xml',
    },
  );
  if (new TextEncoder().encode(sanitized).byteLength > MAX_VECTOR_BYTES)
    throw new Error('Normalized SVG artwork exceeds the 150 KB limit.');
  return sanitized;
}

export function vectorArtworkAtSize(
  artwork: string,
  width: number,
  height: number,
): string {
  const parsed = new DOMParser().parseFromString(
    validateVectorArtwork(artwork),
    'image/svg+xml',
  );
  parsed.documentElement.setAttribute('width', String(width));
  parsed.documentElement.setAttribute('height', String(height));
  return new XMLSerializer().serializeToString(parsed.documentElement);
}
