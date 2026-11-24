// WebGL2 渲染器：等值面（半透明多层）、粮面、电缆、测点、仓壁线框、剖面
import type { McMesh } from '../core/mc_tables'
import type { Bounds } from '../core/geometry'

interface GlProgram {
  program: WebGLProgram
  attribs: Record<string, number>
  uniforms: Record<string, WebGLUniformLocation | null>
}

interface IsoLayer {
  vao: WebGLVertexArrayObject
  indexCount: number
  color: [number, number, number, number]
}

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * world;
}`

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec4 uColor;
uniform vec3 uCamPos;
out vec4 outColor;
void main(){
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(uCamPos - vWorld);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0);
  vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
  float diff = max(dot(n, lightDir), 0.0) * 0.55 + 0.45;
  vec3 col = uColor.rgb * diff + fresnel * 0.25;
  outColor = vec4(col, uColor.a);
}`

const LINE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main(){ gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }`

const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main(){ outColor = uColor; }`

const POINT_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uPointSize;
void main(){
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
  gl_PointSize = uPointSize;
}`

const POINT_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  if(dot(d,d) > 0.25) discard;
  outColor = uColor;
}`

const compile = (gl: WebGL2RenderingContext, type: number, src: string): WebGLShader => {
  const sh = gl.createShader(type) as WebGLShader
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader 编译失败: ' + gl.getShaderInfoLog(sh))
  }
  return sh
}

const makeProgram = (gl: WebGL2RenderingContext, vs: string, fs: string): GlProgram => {
  const program = gl.createProgram() as WebGLProgram
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('program 链接失败: ' + gl.getProgramInfoLog(program))
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const uc = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < uc; i++) {
    const info = gl.getActiveUniform(program, i)
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name)
  }
  return { program, attribs: {}, uniforms }
}

// 列主序 4x4 矩阵
const mat4 = {
  identity: (): Float32Array => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  multiply: (a: Float32Array, b: Float32Array): Float32Array => {
    const out = new Float32Array(16)
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
      }
    }
    return out
  },
  perspective: (fovy: number, aspect: number, near: number, far: number): Float32Array => {
    const f = 1 / Math.tan(fovy / 2)
    const nf = 1 / (near - far)
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ])
  },
  lookAt: (eye: number[], center: number[], up: number[]): Float32Array => {
    const zx = eye[0] - center[0]
    const zy = eye[1] - center[1]
    const zz = eye[2] - center[2]
    let zl = Math.hypot(zx, zy, zz)
    const z = [zx / zl, zy / zl, zz / zl]
    const xx = up[1] * z[2] - up[2] * z[1]
    const xy = up[2] * z[0] - up[0] * z[2]
    const xz = up[0] * z[1] - up[1] * z[0]
    const xl = Math.hypot(xx, xy, xz)
    const x = [xx / xl, xy / xl, xz / xl]
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
      1,
    ])
  },
}

export interface CameraState {
  yaw: number
  pitch: number
  distance: number
  target: [number, number, number]
}

export class GrainRenderer {
  private gl: WebGL2RenderingContext
  private meshProgram: GlProgram
  private lineProgram: GlProgram
  private pointProgram: GlProgram
  private isoLayers: IsoLayer[] = []
  private lineVao: WebGLVertexArrayObject | null = null
  private lineCount = 0
  private pointVao: WebGLVertexArrayObject | null = null
  private pointCount = 0
  private pointColor: [number, number, number, number] = [0.4, 0.45, 0.55, 1]
  private bounds: Bounds
  private model = mat4.identity()
  public camera: CameraState

  constructor(canvas: HTMLCanvasElement, bounds: Bounds) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('当前浏览器不支持 WebGL2')
    this.gl = gl
    this.bounds = bounds
    this.meshProgram = makeProgram(gl, VERT, FRAG)
    this.lineProgram = makeProgram(gl, LINE_VERT, LINE_FRAG)
    this.pointProgram = makeProgram(gl, POINT_VERT, POINT_FRAG)
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    const cz = (bounds.minZ + bounds.maxZ) / 2
    this.camera = { yaw: 0.7, pitch: 0.5, distance: Math.max(bounds.maxX, bounds.maxY) * 1.4, target: [cx, cy, cz * 0.5] }
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.clearColor(0.96, 0.97, 0.98, 1)
  }

  resize = (width: number, height: number): void => {
    const gl = this.gl
    const dpr = Math.min(window.devicePixelRatio, 2)
    gl.canvas.width = Math.floor(width * dpr)
    gl.canvas.height = Math.floor(height * dpr)
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
  }

  // 装载一层等值面
  setIsoMesh = (mesh: McMesh, color: [number, number, number, number]): void => {
    const gl = this.gl
    const vao = gl.createVertexArray() as WebGLVertexArrayObject
    gl.bindVertexArray(vao)
    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    const nrmBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)
    const idxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    this.isoLayers.push({ vao, indexCount: mesh.indices.length, color })
  }

  clearIsoLayers = (): void => {
    const gl = this.gl
    for (const layer of this.isoLayers) gl.deleteVertexArray(layer.vao)
    this.isoLayers = []
  }

  // 线段（粮面网格、电缆、仓壁）
  setLines = (positions: Float32Array, color: [number, number, number, number]): void => {
    const gl = this.gl
    if (this.lineVao) gl.deleteVertexArray(this.lineVao)
    this.lineVao = gl.createVertexArray()
    gl.bindVertexArray(this.lineVao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.lineCount = positions.length / 3
    this.lineColor = color
  }

  private lineColor: [number, number, number, number] = [0.5, 0.55, 0.65, 1]

  // 测点
  setPoints = (positions: Float32Array, color: [number, number, number, number]): void => {
    const gl = this.gl
    if (this.pointVao) gl.deleteVertexArray(this.pointVao)
    this.pointVao = gl.createVertexArray()
    gl.bindVertexArray(this.pointVao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.pointCount = positions.length / 3
    this.pointColor = color
  }

  private eyePosition = (): number[] => {
    const { yaw, pitch, distance, target } = this.camera
    const cp = Math.cos(pitch)
    return [
      target[0] + distance * cp * Math.cos(yaw),
      target[1] + distance * cp * Math.sin(yaw),
      target[2] + distance * Math.sin(pitch),
    ]
  }

  render = (): void => {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const aspect = canvas.width / canvas.height
    const proj = mat4.perspective((50 * Math.PI) / 180, aspect, 0.1, 1000)
    const eye = this.eyePosition()
    const view = mat4.lookAt(eye, this.camera.target, [0, 0, 1])
    const viewProj = mat4.multiply(proj, view)

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // 不透明：线、点
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    if (this.lineVao && this.lineCount > 1) {
      gl.useProgram(this.lineProgram.program)
      gl.uniformMatrix4fv(this.lineProgram.uniforms.uViewProj, false, viewProj)
      gl.uniformMatrix4fv(this.lineProgram.uniforms.uModel, false, this.model)
      gl.uniform4fv(this.lineProgram.uniforms.uColor, this.lineColor)
      gl.bindVertexArray(this.lineVao)
      gl.drawArrays(gl.LINES, 0, this.lineCount)
    }
    if (this.pointVao && this.pointCount > 0) {
      gl.useProgram(this.pointProgram.program)
      gl.uniformMatrix4fv(this.pointProgram.uniforms.uViewProj, false, viewProj)
      gl.uniformMatrix4fv(this.pointProgram.uniforms.uModel, false, this.model)
      gl.uniform4fv(this.pointProgram.uniforms.uColor, this.pointColor)
      gl.uniform1f(this.pointProgram.uniforms.uPointSize, 7)
      gl.bindVertexArray(this.pointVao)
      gl.drawArrays(gl.POINTS, 0, this.pointCount)
    }

    // 半透明等值面：从低阈值（外层）到高阈值（内层），深度只读
    if (this.isoLayers.length > 0) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      gl.useProgram(this.meshProgram.program)
      gl.uniformMatrix4fv(this.meshProgram.uniforms.uViewProj, false, viewProj)
      gl.uniformMatrix4fv(this.meshProgram.uniforms.uModel, false, this.model)
      gl.uniform3fv(this.meshProgram.uniforms.uCamPos, new Float32Array(eye))
      for (const layer of this.isoLayers) {
        gl.uniform4fv(this.meshProgram.uniforms.uColor, layer.color)
        gl.bindVertexArray(layer.vao)
        gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_INT, 0)
      }
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }
    gl.bindVertexArray(null)
  }

  dispose = (): void => {
    const ext = this.gl.getExtension('WEBGL_lose_context')
    ext?.loseContext()
  }

  // 读取当前帧为 PNG dataURL，用于巡仓报告截图
  captureDataUrl = (): string => {
    const gl = this.gl
    this.render()
    const pixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4)
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    // WebGL 原点在左下，Canvas 在左上，需垂直翻转
    const flipped = new Uint8ClampedArray(pixels.length)
    const rowBytes = gl.canvas.width * 4
    for (let row = 0; row < gl.canvas.height; row++) {
      const src = (gl.canvas.height - 1 - row) * rowBytes
      flipped.set(pixels.subarray(src, src + rowBytes), row * rowBytes)
    }
    const c = document.createElement('canvas')
    c.width = gl.canvas.width
    c.height = gl.canvas.height
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    ctx.putImageData(new ImageData(flipped, c.width, c.height), 0, 0)
    return c.toDataURL('image/png')
  }
}
