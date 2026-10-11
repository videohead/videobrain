export type StreamProtocol = 'hls' | 'dash' | 'whep';
export type StreamInputState = 'idle' | 'connecting' | 'live' | 'buffering' | 'error';

export interface StreamInputSettings {
  url: string;
  protocol: StreamProtocol;
  stunServer: string;
}

export function validateStreamUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) endpoint without embedded credentials.');
  }
  if (location.protocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('An HTTPS page requires an HTTPS stream endpoint.');
  }
  return url.href;
}

export class StreamInputSession {
  readonly video = document.createElement('video');
  private readonly abort = new AbortController();
  private closed = false;
  private releasePlayer: (() => void) | null = null;
  private peer: RTCPeerConnection | null = null;
  private resourceUrl: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly settings: StreamInputSettings,
    private readonly update: (state: StreamInputState, error: string | null) => void,
  ) {
    this.video.crossOrigin = 'anonymous';
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.onplaying = () => {
      if (this.closed) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.update('live', null);
    };
    this.video.onwaiting = () => {
      if (!this.closed) this.update('buffering', null);
    };
    this.video.onerror = () => this.fail('Stream playback failed. Check the codec, URL, and CORS headers.');
    this.video.onended = () => this.fail('The stream ended. Connect again to restart.');
  }

  async start(): Promise<void> {
    if (this.closed) return;
    this.update('connecting', null);
    this.timer = setTimeout(() => this.fail('Stream connection timed out. Check the endpoint and network.'), 30_000);
    try {
      const url = validateStreamUrl(this.settings.url);
      if (this.settings.protocol === 'whep') {
        await this.startWhep(url);
      } else if (this.settings.protocol === 'hls') {
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
          this.video.src = url;
          await this.video.play();
        } else {
          const { default: Hls } = await import('hls.js');
          if (this.closed) return;
          if (!Hls.isSupported()) throw new Error('HLS playback is not supported in this browser.');
          const player = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 30, backBufferLength: 10, lowLatencyMode: true });
          this.releasePlayer = () => player.destroy();
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) this.fail('HLS playback failed. Check the manifest, segments, codec, and CORS headers.');
          });
          player.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!this.closed) void this.video.play().catch(() => this.fail('Playback was blocked. Connect again to retry.'));
          });
          player.attachMedia(this.video);
          player.loadSource(url);
        }
      } else {
        const { MediaPlayer } = await import('dashjs');
        if (this.closed) return;
        if (!('MediaSource' in window)) throw new Error('MPEG-DASH requires Media Source Extensions.');
        const player = MediaPlayer().create();
        this.releasePlayer = () => player.reset();
        player.on(MediaPlayer.events.ERROR, () => this.fail('DASH playback failed. Check the manifest, segments, codec, and CORS headers.'));
        player.initialize(this.video, url, true);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'The stream could not be connected.');
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.releasePlayer?.();
    this.releasePlayer = null;
    this.peer?.getReceivers().forEach((receiver) => receiver.track?.stop());
    this.peer?.close();
    this.peer = null;
    this.deleteResource();
    this.video.onplaying = null;
    this.video.onwaiting = null;
    this.video.onerror = null;
    this.video.onended = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.load();
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.dispose();
    this.update('error', message);
  }

  private deleteResource(): void {
    if (!this.resourceUrl) return;
    const url = this.resourceUrl;
    this.resourceUrl = null;
    void fetch(url, { method: 'DELETE', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => undefined);
  }

  private async startWhep(url: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC is unavailable in this browser.');
    const stunServer = this.settings.stunServer.trim();
    if (stunServer && !/^stuns?:[^\s]+$/.test(stunServer)) throw new Error('Use a stun: or stuns: server URL.');
    const peer = new RTCPeerConnection({ iceServers: stunServer ? [{ urls: stunServer }] : [] });
    this.peer = peer;
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = (event) => {
      if (this.closed) { event.track.stop(); return; }
      if (event.track.kind !== 'video') return;
      this.video.srcObject = new MediaStream([event.track]);
      event.track.onended = () => this.fail('The WebRTC video track ended. Connect again to retry.');
      void this.video.play().catch(() => this.fail('Playback was blocked. Connect again to retry.'));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') this.fail('WebRTC connection failed. Check ICE connectivity and the STUN server.');
      else if (peer.connectionState === 'disconnected' && !this.closed) this.update('buffering', null);
      else if (peer.connectionState === 'connected' && !this.closed && this.video.readyState >= 2) this.update('live', null);
    };
    await peer.setLocalDescription(await peer.createOffer());
    if (this.closed) return;
    if (peer.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          peer.removeEventListener('icegatheringstatechange', gathered);
          this.abort.signal.removeEventListener('abort', cancelled);
        };
        const gathered = () => {
          if (peer.iceGatheringState === 'complete') { cleanup(); resolve(); }
        };
        const cancelled = () => { cleanup(); reject(new Error('Connection cancelled.')); };
        peer.addEventListener('icegatheringstatechange', gathered);
        this.abort.signal.addEventListener('abort', cancelled, { once: true });
        if (this.abort.signal.aborted) cancelled();
        else gathered();
      });
    }
    if (this.closed) return;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
      body: peer.localDescription?.sdp,
      signal: this.abort.signal,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const resource = response.headers.get('Location');
    if (resource) {
      const resolved = new URL(resource, url);
      if (resolved.origin === new URL(url).origin && !resolved.username && !resolved.password) this.resourceUrl = resolved.href;
    }
    if (this.closed) { this.deleteResource(); return; }
    if (response.status !== 201) throw new Error(`WHEP negotiation failed (HTTP ${response.status}).`);
    if (!this.resourceUrl) throw new Error('WHEP requires a same-origin Location header exposed by CORS.');
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/sdp')) throw new Error('The WHEP endpoint did not return an SDP answer.');
    const answer = await response.text();
    if (!this.closed) await peer.setRemoteDescription({ type: 'answer', sdp: answer });
  }
}