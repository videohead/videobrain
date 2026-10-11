export const PARTICLE_VERTEX = `#version 300 es
precision highp float;
uniform float uMix;
uniform float uCount;
uniform float uScatter;
uniform float uSeed;
out vec2 vUv;
out float vFade;
void main() {
  float side = ceil(sqrt(uCount));
  float instance = float(gl_InstanceID);
  vec2 cell = vec2(mod(instance, side), floor(instance / side));
  vec2 corners[6] = vec2[6](vec2(0,0), vec2(1,0), vec2(0,1), vec2(0,1), vec2(1,0), vec2(1,1));
  vec2 corner = corners[gl_VertexID];
  vUv = (cell + corner) / side;
  float random = fract(sin(instance * 127.1 + uSeed * 311.7) * 43758.5453);
  float progress = smoothstep(0.0, 1.0, uMix);
  float angle = random * 6.2831853;
  vec2 shift = vec2(cos(angle), sin(angle)) * progress * uScatter;
  shift.y -= progress * progress * uScatter * 0.4;
  vec2 center = (cell + 0.5) / side;
  vec2 position = center + (corner - 0.5) / side * (1.0 - progress) + shift;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
  vFade = 1.0 - progress;
}
`;
export const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
in vec2 vUv;
in float vFade;
out vec4 outColor;
void main() {
  vec4 color = texture(uSource, vUv);
  float alpha = color.a * vFade;
  outColor = vec4(color.rgb * alpha, alpha);
}
`;

export class ParticleTransition {
  private program: WebGLProgram;
  private vertexArray: WebGLVertexArrayObject;

  constructor(private gl: WebGL2RenderingContext) {
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const vertexArray = gl.createVertexArray();
    if (!program || !vertexArray) {
      if (program) gl.deleteProgram(program);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      throw new Error('Particle transition GPU allocation failed.');
    }
    try {
      for (const [type, code] of [[gl.VERTEX_SHADER, PARTICLE_VERTEX], [gl.FRAGMENT_SHADER, PARTICLE_FRAGMENT]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Particle shader allocation failed.');
        shaders.push(shader);
        gl.shaderSource(shader, code); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Particle shader failed.');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Particle program failed.');
    } catch (error) {
      gl.deleteProgram(program); gl.deleteVertexArray(vertexArray); throw error;
    } finally { shaders.forEach((shader) => gl.deleteShader(shader)); }
    this.program = program;
    this.vertexArray = vertexArray;
  }

  render(source: WebGLTexture, mix: number, density: number, scatter: number, seed: number) {
    const gl = this.gl;
    const count = Math.floor(density) ** 2;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uSource'), 0);
    for (const [name, value] of Object.entries({ uMix: mix, uCount: count, uScatter: scatter, uSeed: seed })) gl.uniform1f(gl.getUniformLocation(this.program, name), value);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    try { gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count); }
    finally { gl.disable(gl.BLEND); gl.bindVertexArray(null); }
  }

  dispose() { this.gl.deleteProgram(this.program); this.gl.deleteVertexArray(this.vertexArray); }
}