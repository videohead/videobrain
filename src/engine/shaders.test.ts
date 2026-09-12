import { describe, expect, it } from 'vitest';

import { OPERATOR_DEFINITIONS, type NodeKind } from '../graph';
import { FRAME_FRAGMENT_SHADERS } from './shaders';

function shaderFor(kind: NodeKind): string {
  const shader = FRAME_FRAGMENT_SHADERS[kind];
  expect(shader, `${kind} shader`).toBeTypeOf('string');
  return shader ?? '';
}

describe('frame shader alpha contracts', () => {
  it('registers a shader for every frame and display operator', () => {
    const renderKinds = OPERATOR_DEFINITIONS.filter(
      ({ domain }) => domain === 'frame' || domain === 'display',
    ).map(({ kind }) => kind);

    expect(
      renderKinds.filter((kind) => FRAME_FRAGMENT_SHADERS[kind] === undefined),
    ).toEqual([]);
  });

  it('preserves source alpha through coordinate and color processors', () => {
    const warp = shaderFor('warp');
    const colorGrade = shaderFor('colorGrade');

    expect(warp).toContain('vec4 source = texture(uSource');
    expect(warp).toContain('outColor = vec4(color, source.a);');
    expect(colorGrade).toContain('vec4 source = texture(uSource');
    expect(colorGrade).toContain('outColor = vec4(clamp(color, 0.0, 1.0), source.a);');
  });

  it('accumulates Trails color in premultiplied form and fades its alpha', () => {
    const trails = shaderFor('trails');

    expect(trails).toContain('previous.a * feedback');
    expect(trails).toContain('current.rgb * current.a');
    expect(trails).toContain('previous.rgb * previous.a * feedback');
    expect(trails).toContain('outColor = vec4(clamp(color, 0.0, 1.0), alpha);');
  });

  it('rotates aspect-correct Spiral Feedback history and composites straight alpha safely', () => {
    const spiral = shaderFor('feedbackSpiral');

    expect(spiral).toContain('position.x *= aspect;');
    expect(spiral).toContain('-sine * position.x + cosine * position.y');
    expect(spiral).toContain('/ max(uZoomStep, 0.0001)');
    expect(spiral).toContain('position.x /= aspect;');
    expect(spiral).toContain(
      'all(greaterThanEqual(previousUv, vec2(0.0)))',
    );
    expect(spiral).toContain('previous.rgb * retainedAlpha');
    expect(spiral).toContain('current.rgb * currentAlpha');
    expect(spiral).toContain('premultiplied / alpha');
  });

  it('seeds Spiral Feedback from its source and freezes history at zero elapsed time', () => {
    const spiral = shaderFor('feedbackSpiral');

    expect(spiral).toContain('if (uHistoryReady < 0.5)');
    expect(spiral).toContain('outColor = current;');
    expect(spiral).toContain('if (uDeltaTime <= 0.0)');
    expect(spiral).toContain('outColor = texture(uPrevious, vUv);');
  });

  it('mixes every closed Strobe mode in premultiplied form', () => {
    const strobe = shaderFor('strobe');

    expect(strobe).toContain('if (uPhase < clamp(uDuty, 0.05, 0.95))');
    expect(strobe).toContain('target = vec4(0.0, 0.0, 0.0, 1.0);');
    expect(strobe).toContain('target = vec4(1.0);');
    expect(strobe).toContain('target = vec4(0.0);');
    expect(strobe).toContain('target = vec4(1.0 - source.rgb, source.a);');
    expect(strobe).toContain('source.rgb * source.a');
    expect(strobe).toContain('target.rgb * target.a');
    expect(strobe).toContain('premultiplied / alpha');
  });

  it('uses premultiplied interpolation for every Blend mode', () => {
    const blend = shaderFor('blend');

    expect(blend).toContain('combinedPremultiplied = b.rgb * b.a;');
    expect(blend).toContain('combinedAlpha = a.a + b.a - a.a * b.a;');
    expect(blend).toContain('mix(a.rgb * a.a, combinedPremultiplied, amount)');
    expect(blend).toContain('mix(a.a, combinedAlpha, amount)');
    expect(blend).not.toContain('outColor = vec4(mix(a, combined');
  });

  it('filters Blur samples in premultiplied form before returning straight alpha', () => {
    const blur = shaderFor('blur');

    expect(blur).toContain('sampleColor.rgb * sampleColor.a');
    expect(blur).toContain('premultiplied / alpha');
    expect(blur).toContain('for (int y = -2; y <= 2; y++)');
    expect(blur).toContain('for (int x = -2; x <= 2; x++)');
  });

  it('emits an opaque Threshold matte and applies Mask only to source alpha', () => {
    const threshold = shaderFor('threshold');
    const mask = shaderFor('mask');

    expect(threshold).toContain('outColor = vec4(vec3(clamp(matte, 0.0, 1.0)), 1.0);');
    expect(mask).toContain('outColor = vec4(source.rgb, source.a * factor);');
  });

  it('implements Composite rules in premultiplied color and returns straight alpha', () => {
    const composite = shaderFor('composite');

    expect(composite).toContain('background.rgb * backgroundAlpha');
    expect(composite).toContain('foreground.rgb * foregroundAlpha');
    expect(composite).toContain('premultiplied / alpha');
    expect(composite).toContain('foregroundPremultiplied * (1.0 - backgroundAlpha)');
  });
});
