import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignalTests } from './SignalTests';

afterEach(() => vi.useRealTimers());
describe('signal test readouts', () => {
  it('counts leading/trailing edges without treating initial high as an edge', () => {
    vi.useFakeTimers(); const tests = new SignalTests();
    tests.edge('edge', true, true, 0, 150);
    expect(tests.snapshot('edge').rising).toBe(0);
    tests.edge('edge', false, true, 1, 150);
    tests.edge('edge', true, true, 2, 150);
    tests.edge('edge', true, true, 2, 150);
    expect(tests.snapshot('edge')).toMatchObject({ rising: 1, falling: 1, flash: true, lastTime: 2 });
    vi.advanceTimersByTime(200);
    expect(tests.snapshot('edge').flash).toBe(false);
    tests.reset();
  });
  it('deduplicates incoming bangs and fires manually at the same transport time', () => {
    const tests = new SignalTests(); const event = { id: 'a', time: 1, sequence: 0 };
    expect(tests.bang('bang', [event, event], true, 1, 100)).toHaveLength(1);
    expect(tests.bang('bang', [event], true, 1, 100)).toHaveLength(0);
    tests.fire('bang'); tests.fire('bang');
    expect(tests.bang('bang', [], false, 1, 100)).toHaveLength(2);
    expect(tests.snapshot('bang').count).toBe(3);
    tests.clearCounts('bang');
    expect(tests.bang('bang', [event], true, 1, 100)).toHaveLength(0);
    tests.reset();
  });
  it('keeps numeric values unscaled and bounds only the text preview', () => {
    const tests = new SignalTests();
    tests.number('number', -123.456, true);
    tests.text('text', 'x'.repeat(3000), true);
    expect(tests.snapshot('number').value).toBe(-123.456);
    expect(tests.snapshot('text').text).toHaveLength(2048);
    tests.retain(new Set());
    expect(tests.snapshot('number').connected).toBe(false);
    tests.reset();
  });
});