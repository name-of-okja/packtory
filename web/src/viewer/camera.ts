import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera"
import { Camera } from "@babylonjs/core/Cameras/camera"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene as BScene } from "@babylonjs/core/scene"

/**
 * 수평에서 35.26° 올려다본 각. Babylon 의 beta 는 +Y 축에서 재므로 54.74°,
 * 라디안으로 0.9553. 진짜 아이소메트릭(1:1:1) 각이다.
 * **바꿀 수 없다** — 기울일 수 있으면 누군가 기울여 놓고 가고,
 * 다음 사람이 이상한 화면을 본다.
 */
const BETA = 0.9553
/** 네 모서리. 45°에서 90°씩 */
const ALPHAS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
/** 드래그가 이보다 움직였으면 클릭이 아니라 팬이다 (CSS 픽셀) */
export const DRAG_SLOP = 4

export type IsoCamera = {
  camera: ArcRotateCamera
  rotate(dir: -1 | 1): void
  home(): void
  flyTo(target: Vector3): void
  /** 마지막 포인터 조작이 팬이었는지 — 클릭 오발동을 막는다 */
  didPan(): boolean
  dispose(): void
}

export function createCamera(
  scene: BScene,
  canvas: HTMLCanvasElement,
  bounds: { min: Vector3; max: Vector3 },
): IsoCamera {
  const center = bounds.min.add(bounds.max).scale(0.5)
  const span = bounds.max.subtract(bounds.min)
  const fit = Math.max(span.x, span.z, span.y * 2) * 0.75

  let alphaIdx = 0
  let zoom = fit
  let moved = false

  const camera = new ArcRotateCamera("iso", ALPHAS[0], BETA, 200, center, scene)
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = -1000
  camera.maxZ = 2000
  // 기본 입력을 전부 뗀다. 기울기·자유회전이 붙으면 각도 고정이 깨진다.
  camera.inputs.clear()

  const applyZoom = () => {
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    camera.orthoTop = zoom / 2
    camera.orthoBottom = -zoom / 2
    camera.orthoLeft = (-zoom * aspect) / 2
    camera.orthoRight = (zoom * aspect) / 2
  }
  applyZoom()

  // ── 팬: 화면 평면에서 끈다 ──────────────────────────────
  let drag: { x: number; y: number; target: Vector3 } | null = null
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, target: camera.target.clone() }
    moved = false
    canvas.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_SLOP) moved = true
    const px = (e.clientX - drag.x) / Math.max(canvas.clientWidth, 1)
    const py = (e.clientY - drag.y) / Math.max(canvas.clientHeight, 1)
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    // 화면 오른쪽·위 방향을 월드 벡터로 바꿔 그만큼 target 을 민다
    const right = camera.getDirection(Vector3.Right())
    const up = camera.getDirection(Vector3.Up())
    camera.target = drag.target
      .subtract(right.scale(px * zoom * aspect))
      .subtract(up.scale(-py * zoom))
  }
  const onUp = () => { drag = null }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    zoom = Math.min(Math.max(zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 4), fit * 4)
    applyZoom()
  }
  const onResize = () => applyZoom()

  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerup", onUp)
  canvas.addEventListener("pointercancel", onUp)
  canvas.addEventListener("wheel", onWheel, { passive: false })
  window.addEventListener("resize", onResize)

  // ── 보간 ────────────────────────────────────────────────
  let anim: { from: number; to: number; t0: number; dur: number; kind: "alpha" } |
            { from: Vector3; to: Vector3; t0: number; dur: number; kind: "target" } | null = null

  const tick = () => {
    if (!anim) return
    const k = Math.min((performance.now() - anim.t0) / anim.dur, 1)
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2 // easeInOutQuad
    if (anim.kind === "alpha") camera.alpha = anim.from + (anim.to - anim.from) * e
    else camera.target = Vector3.Lerp(anim.from, anim.to, e)
    if (k >= 1) anim = null
  }
  scene.onBeforeRenderObservable.add(tick)

  return {
    camera,
    rotate(dir) {
      const from = camera.alpha
      alphaIdx = (alphaIdx + dir + ALPHAS.length) % ALPHAS.length
      // 짧은 쪽으로 돈다
      let to = ALPHAS[alphaIdx]
      while (to - from > Math.PI) to -= 2 * Math.PI
      while (from - to > Math.PI) to += 2 * Math.PI
      anim = { kind: "alpha", from, to, t0: performance.now(), dur: 200 }
    },
    home() {
      zoom = fit
      applyZoom()
      anim = { kind: "target", from: camera.target.clone(), to: center, t0: performance.now(), dur: 400 }
    },
    flyTo(target) {
      anim = { kind: "target", from: camera.target.clone(), to: target, t0: performance.now(), dur: 400 }
    },
    didPan: () => moved,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      canvas.removeEventListener("wheel", onWheel)
      window.removeEventListener("resize", onResize)
      scene.onBeforeRenderObservable.removeCallback(tick)
    },
  }
}
