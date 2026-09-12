export type FramePacingMode = 'display' | '60-fps' | '30-fps';

export interface FramePacingOption {
  value: FramePacingMode;
  label: string;
  description: string;
}

export const FRAME_PACING_OPTIONS: readonly FramePacingOption[] = [
  {
    value: 'display',
    label: 'Display sync',
    description: 'Render once per browser display callback.',
  },
  {
    value: '60-fps',
    label: '60 fps',
    description: 'Cap monitor rendering at 60 frames per second.',
  },
  {
    value: '30-fps',
    label: '30 fps',
    description: 'Cap monitor rendering at 30 frames per second.',
  },
];

const FIXED_FRAME_RATES: Readonly<
  Record<Exclude<FramePacingMode, 'display'>, number>
> = {
  '60-fps': 60,
  '30-fps': 30,
};

// A small allowance avoids dropping a frame solely because a browser rounds a
// requestAnimationFrame timestamp just below the ideal fixed-rate boundary.
const FRAME_BOUNDARY_TOLERANCE_MS = 0.25;

export class FramePacer {
  private mode: FramePacingMode;
  private nextFrameTimestamp: number | null = null;
  private previousTimestamp: number | null = null;

  constructor(mode: FramePacingMode) {
    this.mode = mode;
  }

  setMode(mode: FramePacingMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.reset();
  }

  reset(): void {
    this.nextFrameTimestamp = null;
    this.previousTimestamp = null;
  }

  shouldRender(timestamp: number): boolean {
    if (!Number.isFinite(timestamp)) {
      return false;
    }

    if (
      this.previousTimestamp !== null &&
      timestamp < this.previousTimestamp
    ) {
      this.reset();
    }
    this.previousTimestamp = timestamp;

    if (this.mode === 'display') {
      return true;
    }

    const frameDuration = 1000 / FIXED_FRAME_RATES[this.mode];
    if (this.nextFrameTimestamp === null) {
      this.nextFrameTimestamp = timestamp + frameDuration;
      return true;
    }
    if (
      timestamp + FRAME_BOUNDARY_TOLERANCE_MS <
      this.nextFrameTimestamp
    ) {
      return false;
    }

    const lateBy = Math.max(0, timestamp - this.nextFrameTimestamp);
    const elapsedFrameSlots =
      Math.floor(
        (lateBy + FRAME_BOUNDARY_TOLERANCE_MS) / frameDuration,
      ) + 1;
    this.nextFrameTimestamp += elapsedFrameSlots * frameDuration;
    return true;
  }
}

const DEFAULT_RATE_WINDOW_MS = 1000;
const DEFAULT_STALL_RESET_MS = 250;
const MAX_RATE_SAMPLES = 512;

export class RollingFrameRate {
  private readonly timestamps: number[] = [];
  private frameRate = 0;

  constructor(
    private readonly windowMs = DEFAULT_RATE_WINDOW_MS,
    private readonly stallResetMs = DEFAULT_STALL_RESET_MS,
  ) {}

  get value(): number {
    return this.frameRate;
  }

  reset(): void {
    this.timestamps.length = 0;
    this.frameRate = 0;
  }

  sample(timestamp: number): number {
    if (!Number.isFinite(timestamp)) {
      return this.frameRate;
    }

    const previous = this.timestamps.at(-1);
    if (
      previous !== undefined &&
      (timestamp < previous || timestamp - previous > this.stallResetMs)
    ) {
      this.reset();
    }

    this.timestamps.push(timestamp);
    const cutoff = timestamp - this.windowMs;
    while (
      this.timestamps.length > 2 &&
      (this.timestamps[1] ?? timestamp) <= cutoff
    ) {
      this.timestamps.shift();
    }
    while (this.timestamps.length > MAX_RATE_SAMPLES) {
      this.timestamps.shift();
    }

    if (this.timestamps.length < 2) {
      this.frameRate = 0;
      return this.frameRate;
    }

    const first = this.timestamps[0] ?? timestamp;
    const last = this.timestamps.at(-1) ?? timestamp;
    const duration = last - first;
    this.frameRate =
      duration > 0
        ? ((this.timestamps.length - 1) * 1000) / duration
        : this.frameRate;
    return this.frameRate;
  }
}
