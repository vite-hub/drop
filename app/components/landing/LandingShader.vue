<script setup lang="ts">
// A field of dots that swell and fade as slow noise drifts across it, and gather under the pointer. One WebGL quad,
// drawn only while it's on screen. Reduced motion draws one still frame; without WebGL the canvas stays empty.
const canvas = useTemplateRef<HTMLCanvasElement>("canvas")
const colorMode = useColorMode()
const motion = usePreferredReducedMotion()
const visible = useElementVisibility(canvas)

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

// Simplex noise by Ian McEwan and Ashima Arts (MIT).
const FRAGMENT = `
precision mediump float;
uniform vec2 size;
uniform float time;
uniform float ratio;
uniform vec2 pointer;
uniform vec3 color;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float noise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m * m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 a0 = x - floor(x + 0.5);
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  const float gap = 16.0;
  vec2 position = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y) / ratio;
  vec2 center = (floor(position / gap) + 0.5) * gap;
  float wave = noise(center * 0.0035 + vec2(time * 0.045, time * -0.03)) * 0.7
    + noise(center * 0.011 - time * 0.07) * 0.3;
  float level = smoothstep(0.05, 0.8, wave * 0.5 + 0.5);
  level = max(level, (1.0 - smoothstep(0.0, 170.0, distance(center, pointer))) * 0.85);
  float radius = mix(0.55, 2.3, level);
  float disc = 1.0 - smoothstep(radius - 0.7, radius + 0.7, distance(position, center));
  float alpha = disc * mix(0.05, 0.3, level);
  gl_FragColor = vec4(color * alpha, alpha);
}
`

const pointer = { x: -9999, y: -9999 }
let gl: WebGLRenderingContext | null = null
let uniforms: Record<"size" | "time" | "ratio" | "pointer" | "color", WebGLUniformLocation | null> | null = null
let started = 0

function setup(element: HTMLCanvasElement) {
  gl = element.getContext("webgl", { antialias: false, premultipliedAlpha: true })
  if (!gl) return
  const program = gl.createProgram()!
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return void (gl = null)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const location = gl.getAttribLocation(program, "p")
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  uniforms = {
    size: gl.getUniformLocation(program, "size"),
    time: gl.getUniformLocation(program, "time"),
    ratio: gl.getUniformLocation(program, "ratio"),
    pointer: gl.getUniformLocation(program, "pointer"),
    color: gl.getUniformLocation(program, "color"),
  }
  started = performance.now()
}

function draw() {
  const element = canvas.value
  if (!element || !gl || !uniforms) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.round(element.clientWidth * ratio)
  const height = Math.round(element.clientHeight * ratio)
  if (element.width !== width || element.height !== height) {
    element.width = width
    element.height = height
    gl.viewport(0, 0, width, height)
  }
  const shade = colorMode.value === "dark" ? 1 : 0
  gl.uniform2f(uniforms.size, width, height)
  gl.uniform1f(uniforms.time, motion.value === "reduce" ? 12 : (performance.now() - started) / 1000)
  gl.uniform1f(uniforms.ratio, ratio)
  gl.uniform2f(uniforms.pointer, pointer.x, pointer.y)
  gl.uniform3f(uniforms.color, shade, shade, shade)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

const { pause, resume } = useRafFn(draw, { immediate: false })
onMounted(() => {
  if (canvas.value) setup(canvas.value)
  watch([visible, motion], () => (visible.value && motion.value !== "reduce" ? resume() : (pause(), draw())), {
    immediate: true,
  })
})
useResizeObserver(canvas, draw)
watch(() => colorMode.value, draw)
useEventListener(
  "pointermove",
  (event: PointerEvent) => {
    if (!canvas.value) return
    const rect = canvas.value.getBoundingClientRect()
    pointer.x = event.clientX - rect.left
    pointer.y = event.clientY - rect.top
  },
  { passive: true },
)
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" class="pointer-events-none" />
</template>
