import { describe, expect, it } from 'vitest';
import { buildShaderSource, DEFAULT_SHADER_SOURCE, MAX_SHADER_SOURCE_LENGTH, validateShaderSource } from './shaderSource';

describe('constrained GLSL source', () => {
  it('accepts the default body and declares the fixed uniform interface', () => {
    expect(validateShaderSource(DEFAULT_SHADER_SOURCE).operations).toBeGreaterThan(0);
    expect(buildShaderSource(DEFAULT_SHADER_SOURCE)).toContain('uniform float uValue4;');
  });
  it.each([
    'for (int index=0; index<100; index++) {}', 'while (true) {}',
    'do {} while (true);', 'discard;', 'float values[100];',
    'outColor = texture(sampler, vUv);', 'outColor = shade(vUv);',
    'gl_FragDepth = 0.0;', '} void other() {} void replaced() {',
    '#define VALUE 1.0\noutColor = vec4(VALUE);', 'uniform float extra;',
  ])('rejects unsupported syntax: %s', (source) => {
    expect(() => validateShaderSource(source)).toThrow();
  });
  it('bounds source size, total syntax, and nesting', () => {
    expect(() => validateShaderSource(' '.repeat(MAX_SHADER_SOURCE_LENGTH + 1))).toThrow(/characters/);
    expect(() => validateShaderSource('outColor += vec4(0.1);\n'.repeat(100))).toThrow(/syntax nodes|operations/);
    expect(() => validateShaderSource(`outColor = vec4(${'sin('.repeat(40)}0.0${')'.repeat(40)});`)).toThrow(/nesting/);
  });
});