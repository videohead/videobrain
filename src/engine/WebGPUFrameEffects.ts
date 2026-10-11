export const WEBGPU_FULLSCREEN = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let position = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var output: VertexOutput;
  output.position = vec4f(position * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(position.x, 1.0 - position.y);
  return output;
}
`;

const header = `${WEBGPU_FULLSCREEN}
struct Parameters { values: array<vec4f, 4> }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var map: texture_2d<f32>;
@group(0) @binding(2) var frameSampler: sampler;
@group(0) @binding(3) var<uniform> parameters: Parameters;
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(source, frameSampler, vec2f(uv.x, 1.0 - uv.y), 0.0);
}
fn mapAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(map, frameSampler, vec2f(uv.x, 1.0 - uv.y), 0.0);
}
fn luminance(color: vec3f) -> f32 { return dot(color, vec3f(0.2126, 0.7152, 0.0722)); }
fn straightColor(color: vec3f, alpha: f32) -> vec4f {
  return vec4f(select(vec3f(0.0), color / max(alpha, 0.00001), alpha > 0.00001), alpha);
}
fn softGate(value: f32, threshold: f32, softness: f32) -> f32 {
  if (softness <= 0.0) { return step(threshold, value); }
  return smoothstep(threshold - softness, threshold + softness, value);
}
fn edgeUv(uv: vec2f, mode: f32) -> vec2f {
  if (mode > 2.5) { return 1.0 - abs((uv - 2.0 * floor(uv / 2.0)) - 1.0); }
  if (mode > 1.5) { return fract(uv); }
  return clamp(uv, vec2f(0.0), vec2f(1.0));
}
fn sampleSource(uv: vec2f, mode: f32) -> vec4f {
  if (mode < 0.5 && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return vec4f(0.0); }
  return sourceAt(edgeUv(uv, mode));
}
fn chrominance(color: vec3f) -> vec2f { return vec2f(color.b, color.r) - luminance(color); }
fn sampleLuma(uv: vec2f, offset: vec2f) -> f32 {
  let color = sourceAt(clamp(uv + offset / parameters.values[0].xy, vec2f(0.0), vec2f(1.0)));
  return luminance(color.rgb) * color.a;
}
fn channel(color: vec4f, index: f32) -> f32 {
  if (index < 0.5) { return color.r; }
  if (index < 1.5) { return color.g; }
  if (index < 2.5) { return color.b; }
  if (index < 3.5) { return color.a; }
  if (index < 4.5) { return luminance(color.rgb); }
  return select(1.0, 0.0, index < 5.5);
}
`;

function effect(params: readonly string[], body: string) {
  const bindings = params.map((name, index) => `let ${name} = parameters.values[${1 + Math.floor(index / 4)}][${index % 4}];`).join('\n');
  return { params, code: `${header}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let uv = vec2f(input.uv.x, 1.0 - input.uv.y);
  let resolution = parameters.values[0].xy;
  let color = sourceAt(uv);
  ${bindings}
  ${body}
}` };
}

export const WEBGPU_FRAME_EFFECTS = {
  levels: effect(['black', 'white', 'gamma', 'lift', 'gain'], `
    let normalized = clamp((color.rgb - black) / max(white - black, 0.0001), vec3f(0.0), vec3f(1.0));
    let corrected = pow(normalized, vec3f(1.0 / max(gamma, 0.01)));
    return vec4f(clamp(corrected * gain + lift, vec3f(0.0), vec3f(1.0)), color.a);`),
  hsv: effect(['mode', 'hue', 'saturation', 'brightness'], `
    let highest = max(color.r, max(color.g, color.b));
    let lowest = min(color.r, min(color.g, color.b));
    let chroma = highest - lowest;
    var sourceHue = 0.0;
    if (chroma > 0.00001) {
      if (highest == color.r) { sourceHue = (color.g - color.b) / chroma; }
      else if (highest == color.g) { sourceHue = (color.b - color.r) / chroma + 2.0; }
      else { sourceHue = (color.r - color.g) / chroma + 4.0; }
      sourceHue /= 6.0;
    }
    let lightness = (highest + lowest) * 0.5;
    let sourceSaturation = select(chroma / max(1.0 - abs(2.0 * lightness - 1.0), 0.00001), chroma / max(highest, 0.00001), mode < 0.5);
    let adjustedSaturation = clamp(sourceSaturation * saturation, 0.0, 1.0);
    let value = clamp(select(lightness, highest, mode < 0.5) + brightness, 0.0, 1.0);
    let adjustedChroma = select((1.0 - abs(2.0 * value - 1.0)) * adjustedSaturation, value * adjustedSaturation, mode < 0.5);
    let wheel = clamp(abs(fract(vec3f(sourceHue + hue) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
    let adjusted = wheel * adjustedChroma + select(value - adjustedChroma * 0.5, value - adjustedChroma, mode < 0.5);
    return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);`),
  lumaKey: effect(['threshold', 'softness', 'invert'], `
    var matte = softGate(luminance(color.rgb), threshold, softness);
    if (invert > 0.5) { matte = 1.0 - matte; }
    return vec4f(color.rgb, color.a * matte);`),
  chromaKey: effect(['red', 'green', 'blue', 'tolerance', 'softness', 'spill'], `
    let key = vec3f(red, green, blue);
    let distanceToKey = length(chrominance(color.rgb) - chrominance(key));
    var matte = step(tolerance, distanceToKey);
    if (softness > 0.0) { matte = smoothstep(tolerance, tolerance + softness, distanceToKey); }
    let keyChroma = key - vec3f(luminance(key));
    let projection = max(dot(color.rgb - vec3f(luminance(color.rgb)), keyChroma), 0.0) / max(dot(keyChroma, keyChroma), 0.00001);
    let adjusted = color.rgb - keyChroma * projection * spill * (1.0 - matte);
    return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a * matte);`),
  crossfade: effect(['mix', 'curve'], `
    let other = mapAt(uv);
    var amount = clamp(mix, 0.0, 1.0);
    if (curve > 0.5 && curve < 1.5) { amount = amount * amount * (3.0 - 2.0 * amount); }
    else if (curve > 1.5 && curve < 2.5) { amount *= amount; }
    else if (curve > 2.5) { amount = 1.0 - (1.0 - amount) * (1.0 - amount); }
    return straightColor(color.rgb * color.a * (1.0 - amount) + other.rgb * other.a * amount, color.a * (1.0 - amount) + other.a * amount);`),
  displace: effect(['amountX', 'amountY', 'center', 'edgeMode'], `
    var field = vec2f(0.0);
    if (parameters.values[0].z > 0.5) { field = mapAt(uv).rg - center; }
    return sampleSource(uv + field * vec2f(amountX, amountY), edgeMode);`),
  edge: effect(['strength', 'invert'], `
    let topLeft = sampleLuma(uv, vec2f(-1.0, 1.0));
    let top = sampleLuma(uv, vec2f(0.0, 1.0));
    let topRight = sampleLuma(uv, vec2f(1.0, 1.0));
    let left = sampleLuma(uv, vec2f(-1.0, 0.0));
    let right = sampleLuma(uv, vec2f(1.0, 0.0));
    let bottomLeft = sampleLuma(uv, vec2f(-1.0, -1.0));
    let bottom = sampleLuma(uv, vec2f(0.0, -1.0));
    let bottomRight = sampleLuma(uv, vec2f(1.0, -1.0));
    let gradient = vec2f(-topLeft - 2.0 * left - bottomLeft + topRight + 2.0 * right + bottomRight, topLeft + 2.0 * top + topRight - bottomLeft - 2.0 * bottom - bottomRight);
    var value = clamp(length(gradient) * strength, 0.0, 1.0);
    if (invert > 0.5) { value = 1.0 - value; }
    return vec4f(vec3f(value), color.a);`),
  pixelate: effect(['size'], `
    let blockSize = vec2f(max(size, 1.0));
    let origin = floor(uv * resolution / blockSize) * blockSize;
    let center = (origin + min(origin + blockSize, resolution)) * 0.5;
    return sourceAt(center / resolution);`),
  kaleidoscope: effect(['mode', 'repeatX', 'repeatY', 'segments', 'rotation', 'centerX', 'centerY'], `
    var point = uv - vec2f(centerX, centerY);
    let aspect = resolution.x / max(resolution.y, 1.0);
    point.x *= aspect;
    let angle = radians(rotation);
    point = mat2x2f(cos(angle), -sin(angle), sin(angle), cos(angle)) * point;
    if (mode > 1.5) {
      let sector = 6.28318530718 / max(floor(segments), 2.0);
      var polar = 0.0;
      if (length(point) > 0.00001) { polar = atan2(point.y, point.x); }
      let shifted = polar + sector * 0.5;
      polar = abs(shifted - sector * floor(shifted / sector) - sector * 0.5);
      point = length(point) * vec2f(cos(polar), sin(polar));
    }
    point.x /= aspect;
    let repeated = point * vec2f(repeatX, repeatY) + 0.5;
    return sampleSource(repeated, select(3.0, 2.0, mode < 0.5));`),
  channelShuffle: effect(['red', 'green', 'blue', 'alpha'], `
    return vec4f(channel(color, red), channel(color, green), channel(color, blue), channel(color, alpha));`),
};

export type WebGPUFrameEffectKind = keyof typeof WEBGPU_FRAME_EFFECTS;