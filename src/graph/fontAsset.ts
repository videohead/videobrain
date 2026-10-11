export const MAX_FONT_BYTES = 384_000;
export const MAX_FONT_DATA_LENGTH = 512_064;

export function decodeFontAsset(value: string): Uint8Array | null {
  if (value === '') return null;
  if (value.length > MAX_FONT_DATA_LENGTH) throw new Error('Font exceeds the 384 KB limit.');
  const match = /^data:font\/(woff2|woff|ttf|otf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[2]) throw new Error('Choose a WOFF2, WOFF, TTF, or OTF font file.');
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error('Invalid font data.');
  }
  if (binary.length > MAX_FONT_BYTES) throw new Error('Font exceeds the 384 KB limit.');
  const signature = binary.slice(0, 4);
  const signatures: Record<string, string> = { woff2: 'wOF2', woff: 'wOFF', ttf: '\u0000\u0001\u0000\u0000', otf: 'OTTO' };
  if (signature !== signatures[match[1] ?? '']) throw new Error('Font contents do not match the declared format.');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}