import simplexSource from 'glsl-noise/simplex/3d.glsl?raw';
import noiseLicense from 'glsl-noise/LICENSE?raw';

export const NOISE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
/* ${noiseLicense} */
${simplexSource.replace('#pragma glslify: export(snoise)', '')}
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uScale;
uniform float uSeed;
uniform float uMode;
uniform float uFractalType;
uniform float uOctaves;
uniform float uPersistence;
uniform float uLacunarity;
uniform float uContrast;
uniform float uBrightness;
uniform float uAlpha;

float hashValue(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.yzx + 33.33);
  return fract((point.x + point.y) * point.z);
}

float valueNoise(vec3 point) {
  vec3 cell = floor(point);
  vec3 fraction = fract(point);
  fraction = fraction * fraction * fraction * (fraction * (fraction * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(hashValue(cell), hashValue(cell + vec3(1,0,0)), fraction.x),
        mix(hashValue(cell + vec3(0,1,0)), hashValue(cell + vec3(1,1,0)), fraction.x), fraction.y),
    mix(mix(hashValue(cell + vec3(0,0,1)), hashValue(cell + vec3(1,0,1)), fraction.x),
        mix(hashValue(cell + vec3(0,1,1)), hashValue(cell + vec3(1,1,1)), fraction.x), fraction.y), fraction.z);
}

float cellularNoise(vec3 point) {
  vec2 cell = floor(point.xy);
  vec2 local = fract(point.xy);
  float nearest = 10.0;
  for (int row = -1; row <= 1; row++) {
    for (int column = -1; column <= 1; column++) {
      vec2 neighbor = vec2(float(column), float(row));
      vec2 seed = vec2(hashValue(vec3(cell + neighbor, uSeed)), hashValue(vec3(cell + neighbor, uSeed + 19.0)));
      vec2 center = 0.5 + 0.45 * sin(point.z + seed * 6.28318530718);
      nearest = min(nearest, length(neighbor + center - local));
    }
  }
  return clamp(nearest, 0.0, 1.0);
}

void main() {
  vec2 coordinate = (vUv - 0.5) * uResolution / min(uResolution.x, uResolution.y) * uScale;
  vec3 point = vec3(coordinate, uTime) + vec3(mod(uSeed, 251.0), mod(floor(uSeed / 251.0), 251.0), mod(uSeed * 0.37, 251.0));
  vec3 color;
  if (uMode < 0.5) {
    color = vec3(valueNoise(point));
  } else if (uMode < 1.5) {
    color = vec3(0.5 + 0.5 * snoise(point));
  } else if (uMode < 2.5) {
    color = vec3(cellularNoise(point));
  } else if (uMode < 3.5) {
    float derivativeX = (snoise(point + vec3(0.01,0,0)) - snoise(point - vec3(0.01,0,0))) / 0.02;
    float derivativeY = (snoise(point + vec3(0,0.01,0)) - snoise(point - vec3(0,0.01,0))) / 0.02;
    vec2 curl = vec2(derivativeY, -derivativeX);
    color = vec3(0.5 + 0.5 * curl / (1.0 + abs(curl)), 0.5);
  } else {
    float total = 0.0;
    float weight = 1.0;
    float totalWeight = 0.0;
    for (int octave = 0; octave < 6; octave++) {
      if (float(octave) >= uOctaves) break;
      float sampleValue = snoise(point);
      if (uFractalType > 1.5) sampleValue = pow(1.0 - abs(sampleValue), 2.0);
      else if (uFractalType > 0.5) sampleValue = abs(sampleValue);
      else sampleValue = sampleValue * 0.5 + 0.5;
      total += sampleValue * weight;
      totalWeight += weight;
      weight *= uPersistence;
      point *= uLacunarity;
    }
    color = vec3(total / max(totalWeight, 0.00001));
  }
  outColor = vec4(clamp((color - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0), uAlpha);
}
`;