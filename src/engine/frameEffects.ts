const header = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform sampler2D uMap;
uniform vec2 uResolution;

vec4 straightColor(vec3 premultiplied, float alpha) {
  return vec4(alpha > 0.00001 ? premultiplied / alpha : vec3(0.0), alpha);
}
float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
float softGate(float value, float threshold, float softness) {
  return softness <= 0.0 ? step(threshold, value)
    : smoothstep(threshold - softness, threshold + softness, value);
}
vec2 edgeUv(vec2 uv, float mode) {
  if (mode > 2.5) return 1.0 - abs(mod(uv, 2.0) - 1.0);
  if (mode > 1.5) return fract(uv);
  return clamp(uv, 0.0, 1.0);
}
vec4 sampleSource(vec2 uv, float mode) {
  if (mode < 0.5 && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))) return vec4(0.0);
  return texture(uSource, edgeUv(uv, mode));
}
`;

export const FRAME_EFFECT_SHADERS = {
  levels: `${header}
uniform float uBlack;
uniform float uWhite;
uniform float uGamma;
uniform float uLift;
uniform float uGain;
void main() {
  vec4 source = texture(uSource, vUv);
  vec3 color = clamp((source.rgb - uBlack) / max(uWhite - uBlack, 0.0001), 0.0, 1.0);
  color = pow(color, vec3(1.0 / max(uGamma, 0.01)));
  outColor = vec4(clamp(color * uGain + uLift, 0.0, 1.0), source.a);
}
`,
  hsv: `${header}
uniform float uMode;
uniform float uHue;
uniform float uSaturation;
uniform float uBrightness;
void main() {
  vec4 source = texture(uSource, vUv);
  float highest = max(source.r, max(source.g, source.b));
  float lowest = min(source.r, min(source.g, source.b));
  float chroma = highest - lowest;
  float hue = 0.0;
  if (chroma > 0.00001) {
    if (highest == source.r) hue = (source.g - source.b) / chroma;
    else if (highest == source.g) hue = (source.b - source.r) / chroma + 2.0;
    else hue = (source.r - source.g) / chroma + 4.0;
    hue /= 6.0;
  }
  float lightness = (highest + lowest) * 0.5;
  float saturation = uMode < 0.5 ? chroma / max(highest, 0.00001)
    : chroma / max(1.0 - abs(2.0 * lightness - 1.0), 0.00001);
  saturation = clamp(saturation * uSaturation, 0.0, 1.0);
  float value = clamp((uMode < 0.5 ? highest : lightness) + uBrightness, 0.0, 1.0);
  float adjustedChroma = uMode < 0.5 ? value * saturation
    : (1.0 - abs(2.0 * value - 1.0)) * saturation;
  vec3 wheel = clamp(abs(fract(vec3(hue + uHue) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  vec3 color = wheel * adjustedChroma + (uMode < 0.5 ? value - adjustedChroma : value - adjustedChroma * 0.5);
  outColor = vec4(clamp(color, 0.0, 1.0), source.a);
}
`,
  lumaKey: `${header}
uniform float uThreshold;
uniform float uSoftness;
uniform float uInvert;
void main() {
  vec4 source = texture(uSource, vUv);
  float matte = softGate(luminance(source.rgb), uThreshold, uSoftness);
  if (uInvert > 0.5) matte = 1.0 - matte;
  outColor = vec4(source.rgb, source.a * matte);
}
`,
  chromaKey: `${header}
uniform float uRed;
uniform float uGreen;
uniform float uBlue;
uniform float uTolerance;
uniform float uSoftness;
uniform float uSpill;
vec2 chrominance(vec3 color) {
  float luma = luminance(color);
  return vec2(color.b - luma, color.r - luma);
}
void main() {
  vec4 source = texture(uSource, vUv);
  vec3 key = vec3(uRed, uGreen, uBlue);
  float distanceToKey = length(chrominance(source.rgb) - chrominance(key));
  float matte = uSoftness <= 0.0 ? step(uTolerance, distanceToKey)
    : smoothstep(uTolerance, uTolerance + uSoftness, distanceToKey);
  vec3 keyChroma = key - vec3(luminance(key));
  float projection = max(dot(source.rgb - vec3(luminance(source.rgb)), keyChroma), 0.0)
    / max(dot(keyChroma, keyChroma), 0.00001);
  vec3 color = source.rgb - keyChroma * projection * uSpill * (1.0 - matte);
  outColor = vec4(clamp(color, 0.0, 1.0), source.a * matte);
}
`,
  crossfade: `${header}
uniform float uMix;
uniform float uCurve;
void main() {
  vec4 source = texture(uSource, vUv);
  vec4 target = texture(uMap, vUv);
  float amount = clamp(uMix, 0.0, 1.0);
  if (uCurve > 0.5 && uCurve < 1.5) amount = amount * amount * (3.0 - 2.0 * amount);
  else if (uCurve > 1.5 && uCurve < 2.5) amount *= amount;
  else if (uCurve > 2.5) amount = 1.0 - (1.0 - amount) * (1.0 - amount);
  outColor = straightColor(mix(source.rgb * source.a, target.rgb * target.a, amount), mix(source.a, target.a, amount));
}
`,
  displace: `${header}
uniform float uAmountX;
uniform float uAmountY;
uniform float uCenter;
uniform float uEdgeMode;
uniform float uHasMap;
void main() {
  vec2 field = uHasMap > 0.5 ? texture(uMap, vUv).rg - vec2(uCenter) : vec2(0.0);
  outColor = sampleSource(vUv + field * vec2(uAmountX, uAmountY), uEdgeMode);
}
`,
  edge: `${header}
uniform float uStrength;
uniform float uInvert;
float sampleLuma(vec2 offset) {
  vec4 color = texture(uSource, clamp(vUv + offset / uResolution, 0.0, 1.0));
  return luminance(color.rgb) * color.a;
}
void main() {
  float topLeft = sampleLuma(vec2(-1.0, 1.0));
  float top = sampleLuma(vec2(0.0, 1.0));
  float topRight = sampleLuma(vec2(1.0, 1.0));
  float left = sampleLuma(vec2(-1.0, 0.0));
  float right = sampleLuma(vec2(1.0, 0.0));
  float bottomLeft = sampleLuma(vec2(-1.0, -1.0));
  float bottom = sampleLuma(vec2(0.0, -1.0));
  float bottomRight = sampleLuma(vec2(1.0, -1.0));
  vec2 gradient = vec2(-topLeft - 2.0 * left - bottomLeft + topRight + 2.0 * right + bottomRight,
    topLeft + 2.0 * top + topRight - bottomLeft - 2.0 * bottom - bottomRight);
  float value = clamp(length(gradient) * uStrength, 0.0, 1.0);
  if (uInvert > 0.5) value = 1.0 - value;
  outColor = vec4(vec3(value), texture(uSource, vUv).a);
}
`,
  pixelate: `${header}
uniform float uSize;
void main() {
  vec2 size = vec2(max(uSize, 1.0));
  vec2 origin = floor(vUv * uResolution / size) * size;
  vec2 center = (origin + min(origin + size, uResolution)) * 0.5;
  outColor = texture(uSource, center / uResolution);
}
`,
  kaleidoscope: `${header}
uniform float uMode;
uniform float uRepeatX;
uniform float uRepeatY;
uniform float uSegments;
uniform float uRotation;
uniform float uCenterX;
uniform float uCenterY;
void main() {
  vec2 point = vUv - vec2(uCenterX, uCenterY);
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  point.x *= aspect;
  float angle = radians(uRotation);
  point = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * point;
  if (uMode > 1.5) {
    float sector = 6.28318530718 / max(floor(uSegments), 2.0);
    float polar = length(point) > 0.00001 ? atan(point.y, point.x) : 0.0;
    polar = abs(mod(polar + sector * 0.5, sector) - sector * 0.5);
    point = length(point) * vec2(cos(polar), sin(polar));
  }
  point.x /= aspect;
  vec2 uv = point * vec2(uRepeatX, uRepeatY) + 0.5;
  outColor = sampleSource(uv, uMode < 0.5 ? 2.0 : 3.0);
}
`,
  channelShuffle: `${header}
uniform float uRed;
uniform float uGreen;
uniform float uBlue;
uniform float uAlpha;
float channel(vec4 source, float index) {
  if (index < 0.5) return source.r;
  if (index < 1.5) return source.g;
  if (index < 2.5) return source.b;
  if (index < 3.5) return source.a;
  if (index < 4.5) return luminance(source.rgb);
  return index < 5.5 ? 0.0 : 1.0;
}
void main() {
  vec4 source = texture(uSource, vUv);
  outColor = vec4(channel(source, uRed), channel(source, uGreen), channel(source, uBlue), channel(source, uAlpha));
}
`,
};