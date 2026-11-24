// 轨道相机控制：左键旋转、右键平移、滚轮缩放
import type { CameraState } from './renderer'

export const attachOrbitControls = (
  canvas: HTMLCanvasElement,
  camera: CameraState,
  onChange: () => void,
): (() => void) => {
  let dragging: 'rotate' | 'pan' | null = null
  let lastX = 0
  let lastY = 0

  const onDown = (ev: PointerEvent) => {
    dragging = ev.button === 2 ? 'pan' : 'rotate'
    lastX = ev.clientX
    lastY = ev.clientY
    canvas.setPointerCapture(ev.pointerId)
  }
  const onMove = (ev: PointerEvent) => {
    if (!dragging) return
    const dx = ev.clientX - lastX
    const dy = ev.clientY - lastY
    lastX = ev.clientX
    lastY = ev.clientY
    if (dragging === 'rotate') {
      camera.yaw -= dx * 0.008
      camera.pitch += dy * 0.008
      const limit = Math.PI / 2 - 0.05
      camera.pitch = Math.max(-limit, Math.min(limit, camera.pitch))
    } else {
      const scale = camera.distance * 0.0012
      camera.target[0] -= dx * scale * Math.cos(camera.yaw)
      camera.target[1] += dx * scale * Math.sin(camera.yaw)
      camera.target[2] += dy * scale
    }
    onChange()
  }
  const onUp = (ev: PointerEvent) => {
    dragging = null
    try {
      canvas.releasePointerCapture(ev.pointerId)
    } catch {
      // 指针已释放
    }
  }
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
    camera.distance *= 1 + Math.sign(ev.deltaY) * 0.08
    camera.distance = Math.max(2, Math.min(200, camera.distance))
    onChange()
  }
  const onContext = (ev: Event) => ev.preventDefault()

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', onContext)

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('contextmenu', onContext)
  }
}
