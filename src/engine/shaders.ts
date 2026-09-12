import type { NodeKind } from '../graph';

export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;

const plasma = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uScale;
uniform float uEnergy;
uniform float uHue;

vec3 palette(float t) {
  vec3 phase = vec3(0.00, 0.23, 0.47) + uHue;
  return 0.5 + 0.5 * cos(6.2831853 * (t + phase));
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  float t = uTime;
  float a = sin((p.x + p.y * 0.35) * uScale + t * 1.31);
  float b = sin(length(p + vec2(sin(t * 0.31), cos(t * 0.27)) * 0.22) * uScale * 2.3 - t);
  float c = cos((p.y - p.x * 0.28) * uScale * 1.37 - t * 0.73);
  float field = (a + b + c) / 3.0;
  field += sin((p.x * p.y) * uScale * 4.0 + t) * uEnergy;
  vec3 color = palette(field * 0.19 + t * 0.025);
  float vignette = 1.0 - smoothstep(0.18, 0.95, length(p));
  outColor = vec4(color * (0.68 + vignette * 0.42), 1.0);
}
`;

const cells = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uScale;
uniform float uContrast;

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv * uScale;
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float nearest = 1.0;
  float secondNearest = 1.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 seed = hash22(cell + neighbor);
      seed = 0.5 + 0.45 * sin(uTime + 6.2831853 * seed);
      float distanceToSeed = length(neighbor + seed - local);
      if (distanceToSeed < nearest) {
        secondNearest = nearest;
        nearest = distanceToSeed;
      } else if (distanceToSeed < secondNearest) {
        secondNearest = distanceToSeed;
      }
    }
  }

  float ridge = pow(clamp(secondNearest - nearest, 0.0, 1.0), uContrast);
  vec3 cool = vec3(0.015, 0.08, 0.18);
  vec3 hot = vec3(0.98, 0.24, 0.52);
  vec3 color = mix(cool, hot, smoothstep(0.01, 0.28, ridge));
  color += vec3(0.04, 0.30, 0.42) * (1.0 - nearest) * 0.55;
  outColor = vec4(color, 1.0);
}
`;

const videoInput = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uSourceSize;
uniform vec2 uResolution;
uniform float uFit;
uniform float uMirror;

void main() {
  vec2 uv = vUv;
  float sourceAspect = uSourceSize.x / max(uSourceSize.y, 1.0);
  float outputAspect = uResolution.x / max(uResolution.y, 1.0);

  if (uFit < 0.5) {
    if (sourceAspect > outputAspect) {
      uv.x = (uv.x - 0.5) * outputAspect / sourceAspect + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * sourceAspect / outputAspect + 0.5;
    }
  } else if (uFit < 1.5) {
    if (sourceAspect > outputAspect) {
      uv.y = (uv.y - 0.5) * sourceAspect / outputAspect + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * outputAspect / sourceAspect + 0.5;
    }
  }

  if (uMirror > 0.5) {
    uv.x = 1.0 - uv.x;
  }
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  outColor = texture(uSource, uv);
}
`;

const videoModel = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform sampler2D uGenerated;
uniform vec2 uResolution;
uniform float uHasSource;
uniform float uHasGenerated;
uniform float uTime;
uniform float uStrength;
uniform float uGuidance;
uniform float uSeed;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + uSeed * 0.001);
  return fract(p.x * p.y);
}

vec3 palette(float value) {
  vec3 phase = vec3(0.02, 0.28, 0.58) + uSeed * 0.0001;
  return 0.5 + 0.5 * cos(6.2831853 * (value + phase));
}

void main() {
  if (uHasGenerated > 0.5) {
    outColor = texture(uGenerated, vUv);
    return;
  }

  vec2 p = vUv - 0.5;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  float grain = hash21(
    floor(vUv * uResolution.xy * 0.22) + floor(uTime * 12.0)
  );
  float field =
    sin((p.x * 3.1 + p.y * 2.3) * 3.0 + uTime * 0.77) +
    cos(
      length(p + vec2(sin(uTime * 0.19), cos(uTime * 0.23)) * 0.3) *
      17.0
    );
  vec3 preview = palette(field * 0.08 + grain * 0.12 + uTime * 0.018);

  if (uHasSource > 0.5) {
    vec2 drift = vec2(
      sin(vUv.y * 18.0 + uTime),
      cos(vUv.x * 15.0 - uTime * 0.83)
    ) * uStrength * 0.008;
    vec3 source = texture(
      uSource,
      clamp(vUv + drift, 0.0, 1.0)
    ).rgb;
    float levels = mix(32.0, 7.0, clamp(uStrength, 0.0, 1.0));
    source = floor(source * levels + 0.5) / levels;
    float contrast = 1.0 + min(uGuidance, 8.0) * 0.035;
    source = (source - 0.5) * contrast + 0.5;
    preview = mix(
      source,
      preview * (0.45 + source * 0.8),
      uStrength * 0.34
    );
  }

  outColor = vec4(clamp(preview, 0.0, 1.0), 1.0);
}
`;

const solid = `#version 300 es
precision highp float;

out vec4 outColor;

uniform vec4 uColor;

void main() {
  outColor = clamp(uColor, 0.0, 1.0);
}
`;

const transform2d = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform vec2 uTranslate;
uniform float uScale;
uniform float uRotation;
uniform vec2 uPivot;
uniform float uEdgeMode;

vec2 mirrorUv(vec2 uv) {
  return 1.0 - abs(mod(uv, 2.0) - 1.0);
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 position = vUv - uPivot;
  position.x *= aspect;
  position -= vec2(uTranslate.x * aspect, uTranslate.y);

  float cosine = cos(uRotation);
  float sine = sin(uRotation);
  position = vec2(
    cosine * position.x + sine * position.y,
    -sine * position.x + cosine * position.y
  ) / max(uScale, 0.0001);
  position.x /= aspect;
  vec2 sourceUv = position + uPivot;

  if (uEdgeMode < 0.5) {
    if (
      any(lessThan(sourceUv, vec2(0.0))) ||
      any(greaterThan(sourceUv, vec2(1.0)))
    ) {
      outColor = vec4(0.0);
      return;
    }
  } else if (uEdgeMode < 1.5) {
    sourceUv = clamp(sourceUv, 0.0, 1.0);
  } else if (uEdgeMode < 2.5) {
    sourceUv = fract(sourceUv);
  } else {
    sourceUv = mirrorUv(sourceUv);
  }

  outColor = texture(uSource, sourceUv);
}
`;

const projectorMapping = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec4 uMapRow0;
uniform vec4 uMapRow1;
uniform vec4 uMapRow2;
uniform float uEdgeMode;

vec2 mirrorUv(vec2 uv) {
  return 1.0 - abs(mod(uv, 2.0) - 1.0);
}

void main() {
  mat3 inverseMap = mat3(
    vec3(uMapRow0.xyz),
    vec3(uMapRow1.xyz),
    vec3(uMapRow2.xyz)
  );
  vec3 mapped = inverseMap * vec3(vUv, 1.0);
  float w = mapped.z;
  vec2 sourceUv = abs(w) > 0.00001 ? mapped.xy / w : vec2(2.0);

  if (uEdgeMode < 0.5) {
    if (
      any(lessThan(sourceUv, vec2(0.0))) ||
      any(greaterThan(sourceUv, vec2(1.0)))
    ) {
      outColor = vec4(0.0);
      return;
    }
  } else if (uEdgeMode < 1.5) {
    sourceUv = clamp(sourceUv, 0.0, 1.0);
  } else if (uEdgeMode < 2.5) {
    sourceUv = fract(sourceUv);
  } else {
    sourceUv = mirrorUv(sourceUv);
  }

  outColor = texture(uSource, sourceUv);
}
`;

const warp = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform float uTime;
uniform float uAmount;
uniform float uFrequency;

void main() {
  vec2 uv = vUv;
  float xWave = sin(uv.y * uFrequency * 6.2831853 + uTime * 1.17);
  float yWave = cos(uv.x * uFrequency * 6.2831853 - uTime * 0.83);
  vec2 offset = vec2(xWave, yWave) * uAmount * 0.075;
  vec4 source = texture(uSource, fract(uv + offset));
  vec3 color = source.rgb;
  float split = uAmount * 0.012;
  color.r = texture(uSource, fract(uv + offset + vec2(split, 0.0))).r;
  color.b = texture(uSource, fract(uv + offset - vec2(split, 0.0))).b;
  outColor = vec4(color, source.a);
}
`;

const blur = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uRadius;

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  float spacing = clamp(uRadius, 0.0, 24.0) * 0.5;
  vec4 accumulated = vec4(0.0);

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y)) * texel * spacing;
      vec4 sampleColor = texture(uSource, clamp(vUv + offset, 0.0, 1.0));
      accumulated.rgb += sampleColor.rgb * sampleColor.a;
      accumulated.a += sampleColor.a;
    }
  }

  float alpha = accumulated.a / 25.0;
  vec3 premultiplied = accumulated.rgb / 25.0;
  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

const threshold = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform float uChannel;
uniform float uLevel;
uniform float uSoftness;
uniform float uInvert;

float selectedChannel(vec4 value) {
  if (uChannel < 0.5) {
    return dot(value.rgb, vec3(0.2126, 0.7152, 0.0722));
  }
  if (uChannel < 1.5) {
    return value.r;
  }
  if (uChannel < 2.5) {
    return value.g;
  }
  if (uChannel < 3.5) {
    return value.b;
  }
  return value.a;
}

void main() {
  float value = selectedChannel(texture(uSource, vUv));
  float softness = clamp(uSoftness, 0.0, 0.5);
  float matte = softness > 0.00001
    ? smoothstep(uLevel - softness, uLevel + softness, value)
    : step(uLevel, value);
  matte = mix(matte, 1.0 - matte, step(0.5, uInvert));
  outColor = vec4(vec3(clamp(matte, 0.0, 1.0)), 1.0);
}
`;

const mask = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform sampler2D uMask;
uniform float uChannel;
uniform float uAmount;
uniform float uInvert;

float selectedChannel(vec4 value) {
  if (uChannel < 0.5) {
    return dot(value.rgb, vec3(0.2126, 0.7152, 0.0722));
  }
  if (uChannel < 1.5) {
    return value.r;
  }
  if (uChannel < 2.5) {
    return value.g;
  }
  if (uChannel < 3.5) {
    return value.b;
  }
  return value.a;
}

void main() {
  vec4 source = texture(uSource, vUv);
  float matte = clamp(selectedChannel(texture(uMask, vUv)), 0.0, 1.0);
  matte = mix(matte, 1.0 - matte, step(0.5, uInvert));
  float factor = mix(1.0, matte, clamp(uAmount, 0.0, 1.0));
  outColor = vec4(source.rgb, source.a * factor);
}
`;

const composite = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uBackground;
uniform sampler2D uForeground;
uniform float uOpacity;
uniform float uOperation;

void main() {
  vec4 background = texture(uBackground, vUv);
  vec4 foreground = texture(uForeground, vUv);
  float backgroundAlpha = clamp(background.a, 0.0, 1.0);
  float foregroundAlpha = clamp(foreground.a * uOpacity, 0.0, 1.0);
  vec3 backgroundPremultiplied = background.rgb * backgroundAlpha;
  vec3 foregroundPremultiplied = foreground.rgb * foregroundAlpha;
  vec3 premultiplied;
  float alpha;

  if (uOperation < 0.5) {
    premultiplied = foregroundPremultiplied +
      backgroundPremultiplied * (1.0 - foregroundAlpha);
    alpha = foregroundAlpha + backgroundAlpha * (1.0 - foregroundAlpha);
  } else if (uOperation < 1.5) {
    premultiplied = backgroundPremultiplied +
      foregroundPremultiplied * (1.0 - backgroundAlpha);
    alpha = backgroundAlpha + foregroundAlpha * (1.0 - backgroundAlpha);
  } else if (uOperation < 2.5) {
    premultiplied = foregroundPremultiplied * backgroundAlpha;
    alpha = foregroundAlpha * backgroundAlpha;
  } else if (uOperation < 3.5) {
    premultiplied = foregroundPremultiplied * (1.0 - backgroundAlpha);
    alpha = foregroundAlpha * (1.0 - backgroundAlpha);
  } else if (uOperation < 4.5) {
    premultiplied = foregroundPremultiplied * backgroundAlpha +
      backgroundPremultiplied * (1.0 - foregroundAlpha);
    alpha = backgroundAlpha;
  } else {
    premultiplied = foregroundPremultiplied * (1.0 - backgroundAlpha) +
      backgroundPremultiplied * (1.0 - foregroundAlpha);
    alpha = foregroundAlpha * (1.0 - backgroundAlpha) +
      backgroundAlpha * (1.0 - foregroundAlpha);
  }

  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

const frameSwitch = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uD;
uniform float uIndex;

void main() {
  if (uIndex < 0.5) {
    outColor = texture(uA, vUv);
  } else if (uIndex < 1.5) {
    outColor = texture(uB, vUv);
  } else if (uIndex < 2.5) {
    outColor = texture(uC, vUv);
  } else {
    outColor = texture(uD, vUv);
  }
}
`;

const blend = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uMode;

void main() {
  vec4 a = texture(uA, vUv);
  vec4 b = texture(uB, vUv);
  vec3 combinedColor;
  vec3 combinedPremultiplied;
  float combinedAlpha;

  if (uMode < 0.5) {
    combinedPremultiplied = b.rgb * b.a;
    combinedAlpha = b.a;
  } else if (uMode < 1.5) {
    combinedColor = 1.0 - (1.0 - a.rgb) * (1.0 - b.rgb);
  } else if (uMode < 2.5) {
    combinedColor = min(a.rgb + b.rgb, 1.0);
  } else {
    combinedColor = a.rgb * b.rgb;
  }

  if (uMode >= 0.5) {
    combinedAlpha = a.a + b.a - a.a * b.a;
    combinedPremultiplied =
      a.rgb * a.a * (1.0 - b.a) +
      b.rgb * b.a * (1.0 - a.a) +
      combinedColor * a.a * b.a;
  }

  float amount = clamp(uMix, 0.0, 1.0);
  float alpha = mix(a.a, combinedAlpha, amount);
  vec3 premultiplied = mix(a.rgb * a.a, combinedPremultiplied, amount);
  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

const trails = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform sampler2D uPrevious;
uniform float uFeedback;

void main() {
  vec4 current = texture(uSource, vUv);
  vec2 drift = (vUv - 0.5) * 0.0025;
  vec4 previous = texture(uPrevious, clamp(vUv + drift, 0.0, 1.0));
  float feedback = clamp(uFeedback, 0.0, 0.995);
  float alpha = max(current.a, previous.a * feedback);
  vec3 premultiplied = max(
    current.rgb * current.a,
    previous.rgb * previous.a * feedback
  );
  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
`;

const feedbackSpiral = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform sampler2D uPrevious;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uRotationStep;
uniform float uZoomStep;
uniform float uRetention;
uniform float uDeltaTime;
uniform float uHistoryReady;

void main() {
  vec4 current = texture(uSource, vUv);
  if (uHistoryReady < 0.5) {
    outColor = current;
    return;
  }

  if (uDeltaTime <= 0.0) {
    outColor = texture(uPrevious, vUv);
    return;
  }

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 position = vUv - uCenter;
  position.x *= aspect;
  float cosine = cos(uRotationStep);
  float sine = sin(uRotationStep);
  position = vec2(
    cosine * position.x + sine * position.y,
    -sine * position.x + cosine * position.y
  ) / max(uZoomStep, 0.0001);
  position.x /= aspect;
  vec2 previousUv = position + uCenter;

  vec4 previous = vec4(0.0);
  if (
    all(greaterThanEqual(previousUv, vec2(0.0))) &&
    all(lessThanEqual(previousUv, vec2(1.0)))
  ) {
    previous = texture(uPrevious, previousUv);
  }

  float retainedAlpha = previous.a * clamp(uRetention, 0.0, 1.0);
  float currentAlpha = current.a * (1.0 - retainedAlpha);
  float alpha = retainedAlpha + currentAlpha;
  vec3 premultiplied =
    previous.rgb * retainedAlpha + current.rgb * currentAlpha;
  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

const strobe = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform float uPhase;
uniform float uDuty;
uniform float uAmount;
uniform float uClosedMode;

void main() {
  vec4 source = texture(uSource, vUv);
  if (uPhase < clamp(uDuty, 0.05, 0.95)) {
    outColor = source;
    return;
  }

  vec4 target;
  if (uClosedMode < 0.5) {
    target = vec4(0.0, 0.0, 0.0, 1.0);
  } else if (uClosedMode < 1.5) {
    target = vec4(1.0);
  } else if (uClosedMode < 2.5) {
    target = vec4(0.0);
  } else {
    target = vec4(1.0 - source.rgb, source.a);
  }

  float amount = clamp(uAmount, 0.0, 1.0);
  float alpha = mix(source.a, target.a, amount);
  vec3 premultiplied = mix(
    source.rgb * source.a,
    target.rgb * target.a,
    amount
  );
  vec3 color = alpha > 0.00001 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

const colorGrade = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform float uHue;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;

vec3 rotateHue(vec3 color, float angle) {
  vec3 axis = normalize(vec3(1.0));
  float cosine = cos(angle);
  float sine = sin(angle);
  return color * cosine + cross(axis, color) * sine + axis * dot(axis, color) * (1.0 - cosine);
}

void main() {
  vec4 source = texture(uSource, vUv);
  vec3 color = source.rgb;
  color *= exp2(uExposure);
  color = (color - 0.5) * uContrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, uSaturation);
  color = rotateHue(color, uHue * 6.2831853);
  color = color / (1.0 + max(color, vec3(0.0)) * 0.18);
  outColor = vec4(clamp(color, 0.0, 1.0), source.a);
}
`;

const display = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;

void main() {
  outColor = texture(uSource, vUv);
}
`;

export const FRAME_FRAGMENT_SHADERS: Partial<Record<NodeKind, string>> = {
  videoInput,
  file: videoInput,
  videoModel,
  solid,
  plasma,
  cells,
  transform2d,
  projectorMapping,
  warp,
  blur,
  threshold,
  mask,
  composite,
  frameSwitch,
  sourceSelector: frameSwitch,
  blend,
  trails,
  feedbackSpiral,
  strobe,
  colorGrade,
  display,
};
