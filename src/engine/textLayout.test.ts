import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LINES, wrapText } from './textLayout';
import { decodeFontAsset, MAX_FONT_DATA_LENGTH } from '../graph/fontAsset';

describe('text layout and font assets', () => {
  const measure = (value: string) => value.length * 10;

  it('wraps words, breaks long words, and preserves explicit empty lines', () => {
    expect(wrapText('one two\n\nabcdefgh', 40, 'word', measure)).toEqual(['one', 'two', '', 'abcd', 'efgh']);
    expect(wrapText('one two', 40, 'none', measure)).toEqual(['one two']);
    expect(wrapText('abcdef', 20, 'character', measure)).toEqual(['ab', 'cd', 'ef']);
  });

  it('preserves grapheme clusters and bounds pathological layouts', () => {
    const combined = 'e\u0301';
    expect(wrapText(combined.repeat(2), 10, 'character', measure)).toEqual([combined, combined]);
    expect(wrapText('x'.repeat(4000), 1, 'character', measure)).toHaveLength(MAX_TEXT_LINES);
  });

  it('accepts embedded font bytes but rejects URLs, bad signatures, and oversized assets', () => {
    expect(decodeFontAsset('')).toBeNull();
    expect(decodeFontAsset(`data:font/woff2;base64,${btoa('wOF2font')}`)?.length).toBe(8);
    for (const value of ['https://example.org/font.woff2', 'data:font/woff2;base64,AAAA', 'x'.repeat(MAX_FONT_DATA_LENGTH + 1)]) {
      expect(() => decodeFontAsset(value)).toThrow();
    }
  });
});