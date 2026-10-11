import { parse } from '@shaderfrog/glsl-parser/index.js';

export const MAX_SHADER_SOURCE_LENGTH = 4_096;
export const DEFAULT_SHADER_SOURCE = `vec2 point = vUv * 2.0 - 1.0;
float wave = 0.5 + 0.5 * cos(length(point) * 12.0 - uTime + uValue1);
outColor = vec4(wave, vUv.y, uValue2, uValue4);`;

const NODE_TYPES = new Set([
  'compound_statement', 'declaration_statement', 'declarator_list',
  'fully_specified_type', 'type_specifier', 'keyword', 'declaration',
  'identifier', 'literal', 'expression_statement', 'assignment',
  'function_call', 'float_constant', 'int_constant', 'bool_constant',
  'binary', 'unary', 'group', 'ternary', 'postfix', 'field_selection',
]);
const TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'const']);
const FUNCTIONS = new Set([
  'float', 'int', 'bool', 'vec2', 'vec3', 'vec4',
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'trunc', 'round', 'ceil', 'fract', 'mod',
  'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
  'length', 'distance', 'dot', 'cross', 'normalize', 'reflect', 'refract',
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function callName(value: unknown): string | null {
  if (!record(value)) return null;
  if (value.type === 'identifier' && typeof value.identifier === 'string') return value.identifier;
  if (value.type === 'keyword' && typeof value.token === 'string') return value.token;
  return callName(value.specifier);
}

export function validateShaderSource(source: string): { nodes: number; operations: number } {
  if (source.length > MAX_SHADER_SOURCE_LENGTH) throw new Error('Shader source exceeds 4096 characters.');
  if (source.includes('#')) throw new Error('Preprocessor directives are not allowed.');
  const ast = parse(`void main() {\n${source}\n}`, { quiet: true });
  const entry = ast.program[0];
  if (ast.program.length !== 1 || entry?.type !== 'function' || entry.prototype.header.name.identifier !== 'main') {
    throw new Error('Provide only a fragment body, without extra functions.');
  }
  let nodes = 0;
  let operations = 0;
  function visit(value: unknown, depth: number): void {
    if (depth > 32) throw new Error('Shader nesting exceeds 32.');
    if (Array.isArray(value)) { value.forEach((child) => visit(child, depth + 1)); return; }
    if (!record(value)) return;
    if (typeof value.type === 'string') {
      if (!NODE_TYPES.has(value.type)) throw new Error(`Unsupported GLSL construct: ${value.type}. Loops, functions, and arrays are not allowed.`);
      if (++nodes > 512) throw new Error('Shader exceeds 512 syntax nodes.');
      if (['function_call', 'binary', 'unary', 'assignment', 'ternary', 'postfix'].includes(value.type)) {
        if (++operations > 128) throw new Error('Shader exceeds 128 operations.');
      }
      if (value.type === 'keyword' && !TYPES.has(String(value.token))) throw new Error(`Unsupported GLSL type or qualifier: ${String(value.token)}.`);
      if (value.type === 'identifier' && String(value.identifier).startsWith('gl_')) throw new Error('GL built-in variables are not available.');
      if (value.type === 'function_call' && !FUNCTIONS.has(callName(value.identifier) ?? '')) throw new Error('Only supported GLSL math functions and vector constructors are allowed.');
    }
    if (value.quantifier) throw new Error('Arrays are not allowed.');
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'location' && key !== 'whitespace') visit(child, depth + 1);
    }
  }
  visit(entry.body, 0);
  return { nodes, operations };
}

export function buildShaderSource(source: string): string {
  validateShaderSource(source);
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uValue1;
uniform float uValue2;
uniform float uValue3;
uniform float uValue4;
void main() {
  outColor = vec4(0.0);
#line 1
${source}
  if (any(isnan(outColor)) || any(isinf(outColor))) outColor = vec4(0.0);
  outColor = clamp(outColor, 0.0, 1.0);
}`;
}