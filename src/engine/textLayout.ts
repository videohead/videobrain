export const MAX_TEXT_LENGTH = 4_000;
export const MAX_TEXT_LINES = 128;

export function wrapText(
  text: string,
  width: number,
  mode: 'word' | 'character' | 'none',
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = (value: string) => Array.from(segmenter.segment(value), ({ segment }) => segment);
  for (const paragraph of text.slice(0, MAX_TEXT_LENGTH).replace(/\r\n?/g, '\n').split('\n')) {
    if (lines.length >= MAX_TEXT_LINES) break;
    if (mode === 'none' || paragraph === '') {
      lines.push(paragraph);
      continue;
    }
    const tokens = mode === 'character' ? graphemes(paragraph) : paragraph.match(/\S+|\s+/gu) ?? [];
    let line = '';
    for (const token of tokens) {
      if (lines.length >= MAX_TEXT_LINES) break;
      if (measure(line + token) <= width) {
        line += token;
        continue;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (mode === 'word' && /^\s+$/u.test(token)) continue;
      for (const character of graphemes(token)) {
        if (line && measure(line + character) > width) {
          lines.push(line);
          line = '';
          if (lines.length >= MAX_TEXT_LINES) break;
        }
        line += character;
      }
    }
    if (lines.length < MAX_TEXT_LINES) lines.push(line.trimEnd());
  }
  return lines;
}