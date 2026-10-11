import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamInputSession, validateStreamUrl } from './StreamInputSession';

describe('StreamInputSession', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('rejects credential-bearing and non-HTTP endpoints', () => {
    expect(() => validateStreamUrl('javascript:alert(1)')).toThrow('HTTP(S)');
    expect(() => validateStreamUrl('https://user:secret@example.com/live')).toThrow('credentials');
    expect(validateStreamUrl(' https://example.com/live.m3u8 ')).toBe('https://example.com/live.m3u8');
  });

  it('plays native HLS with CORS and releases its source', async () => {
    const update = vi.fn();
    const session = new StreamInputSession({ url: 'https://example.com/live.m3u8', protocol: 'hls', stunServer: '' }, update);
    await session.start();
    expect(session.video.crossOrigin).toBe('anonymous');
    expect(session.video.muted).toBe(true);
    expect(session.video.src).toBe('https://example.com/live.m3u8');
    session.video.dispatchEvent(new Event('playing'));
    expect(update).toHaveBeenLastCalledWith('live', null);
    session.video.dispatchEvent(new Event('waiting'));
    expect(update).toHaveBeenLastCalledWith('buffering', null);
    session.dispose();
    expect(session.video.getAttribute('src')).toBeNull();
    session.video.dispatchEvent(new Event('playing'));
    expect(update).toHaveBeenLastCalledWith('buffering', null);
  });

  it('fails stalled connection attempts and ignores late events', async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    const session = new StreamInputSession({ url: 'https://example.com/live.m3u8', protocol: 'hls', stunServer: '' }, update);
    await session.start();
    vi.advanceTimersByTime(30_000);
    expect(update).toHaveBeenLastCalledWith('error', expect.stringContaining('timed out'));
    session.video.dispatchEvent(new Event('playing'));
    expect(update).toHaveBeenLastCalledWith('error', expect.stringContaining('timed out'));
  });

  it('negotiates receive-only WHEP and deletes its resource on disconnect', async () => {
    const close = vi.fn();
    const addTransceiver = vi.fn();
    const setRemoteDescription = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('RTCPeerConnection', class {
      iceGatheringState = 'complete';
      localDescription = { sdp: 'offer' };
      addTransceiver = addTransceiver;
      createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer' });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      setRemoteDescription = setRemoteDescription;
      getReceivers = () => [];
      close = close;
    });
    const request = vi.fn().mockResolvedValue(new Response('answer', { status: 201, headers: { Location: '/session/1', 'Content-Type': 'application/sdp' } }));
    vi.stubGlobal('fetch', request);
    const session = new StreamInputSession({ url: 'https://example.com/whep', protocol: 'whep', stunServer: '' }, vi.fn());
    await session.start();
    expect(addTransceiver).toHaveBeenCalledWith('video', { direction: 'recvonly' });
    expect(request).toHaveBeenCalledWith('https://example.com/whep', expect.objectContaining({ method: 'POST', body: 'offer', credentials: 'omit' }));
    expect(setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer' });
    session.dispose();
    expect(close).toHaveBeenCalledOnce();
    expect(request).toHaveBeenLastCalledWith('https://example.com/session/1', expect.objectContaining({ method: 'DELETE' }));
  });
});