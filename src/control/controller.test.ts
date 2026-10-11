import { describe, expect, it } from 'vitest';
import { decodeMidi, parseMapping, validateBridgeUrl } from './controller';

describe('controller inputs', () => {
  it('decodes channels, CC, note-off, and zero-velocity note-on without SysEx', () => {
    expect(decodeMidi(new Uint8Array([0xb2, 7, 127]))).toEqual({ channel: 3, type: 'cc', number: 7, event: { type: 'value', value: 1 } });
    expect(decodeMidi(new Uint8Array([0x90, 60, 127]))?.event.type).toBe('press');
    expect(decodeMidi(new Uint8Array([0x90, 60, 0]))?.event.type).toBe('release');
    expect(decodeMidi(new Uint8Array([0x80, 60, 100]))?.event.type).toBe('release');
    expect(decodeMidi(new Uint8Array([0xf0, 60, 100]))).toBeNull();
    expect(decodeMidi(new Uint8Array([0xb0, 128, 1]))).toBeNull();
  });
  it('validates mapping IDs and reconstructs only known fields', () => {
    const input = { id: 'pause', name: 'Pause', action: { type: 'transport', command: 'pause' }, token: 'not persisted' };
    expect(parseMapping(input)).not.toHaveProperty('token');
    expect(() => parseMapping({ ...input, id: '../bad' })).toThrow();
    expect(() => parseMapping({ ...input, midi: { deviceId: 'a', type: 'cc', channel: 17, number: 0 } })).toThrow();
  });
  it('allows secure remote and loopback bridges but not credential-bearing URLs', () => {
    expect(validateBridgeUrl('wss://example.com/control-ws')).toBe('wss://example.com/control-ws');
    expect(validateBridgeUrl('ws://127.0.0.1:8933/control-ws')).toContain('127.0.0.1');
    expect(() => validateBridgeUrl('ws://example.com/control-ws')).toThrow();
    expect(() => validateBridgeUrl('wss://example.com/control-ws?token=secret')).toThrow();
  });
});