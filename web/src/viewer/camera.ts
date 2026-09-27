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
/**
 * 이 배율(화면 세로에 담기는 미터)보다 멀면 "멀리서 보기" 다. 멀리서는 정지
 * 구간의 신호등·라벨과 구역 배지만 남긴다 (스펙 6장 밀도 제어). 라벨과
 * 신호등이 같은 문턱을 써야 하므로 여기 하나만 둔다.
 */
export const SHOW_BELOW = 60

/** 지금 화면 세로에 담기는 미터 */
export function zoomOf(scene: BScene): number {
  return (scene.activeCamera?.orthoTop ?? 0) * 2
}

/** 칩을 눌러 날아갈 때의 줌. SHOW_BELOW(60)보다 확실히 아래여야
 *  도착해서 이름과 정지 시간을 읽을 수 있다 */
const FLY_ZOOM = 30

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
  // 전체보기 배율(화면 세로에 담기는 미터). 바닥 상자를 이 시점으로 투영했을 때
  // 화면 세로 폭은 (span.x + span.z)·cos45°·sin35.26° + span.y·cos35.26°, 가로 폭은
  // (span.x + span.z)·cos45° 다. 둘 다 담기게 잡고 20% 여백을 둔다. 예전 어림식
  // (max(span) × 0.75)은 층을 높이 쌓은 대형 씬 적층에서 위아래가, 옆으로 늘어놓은
  // 계단 배치에서 양 끝 층이 잘렸다 (실측). 화면 비율은 그때그때 잰다 — 창 크기가
  // 바뀐 뒤 ⌂ 를 누르면 새 비율로 맞아야 한다.
  const fit = () => {
    const floor = span.x + span.z
    const tall = floor * 0.408 + span.y * 0.816
    const wide = floor * 0.707
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    return Math.max(tall, wide / aspect) * 1.2
  }

  let alphaIdx = 0
  let zoom = fit()
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
    // camera.target = X (setter) 는 ArcRotateCamera.setTarget 을 cloneAlphaBetaRadius
    // 기본값(false)으로 부르는 것과 같다 — 그러면 현재 position 과 새 target 으로
    // alpha·beta·radius 를 rebuildAnglesAndRadius() 로 다시 계산해 버려 고정해 둔
    // 기울기(BETA)가 드래그할 때마다 조금씩 틀어진다. cloneAlphaBetaRadius=true 를
    // 넘겨 alpha/beta/radius 는 그대로 두고 target 만 옮긴다.
    camera.setTarget(
      drag.target.subtract(right.scale(px * zoom * aspect)).subtract(up.scale(-py * zoom)),
      false, false, true,
    )
  }
  const onUp = () => { drag = null }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    zoom = Math.min(Math.max(zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 4), fit() * 4)
    applyZoom()
  }
  const onResize = () => applyZoom()

  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerup", onUp)
  canvas.addEventListener("pointercancel", onUp)
  // 휠은 캔버스가 아니라 그 부모(뷰어 영역)에서 받는다. 멀리서 보기의 구역 배지는
  // 누를 수 있어야 해서 캔버스 위에 떠 있고 포인터를 가로챈다 — 캔버스에 붙이면
  // 확대하려고 커서를 댄 바로 그 배지 위에서 휠이 안 먹는다.
  const wheelTarget = canvas.parentElement ?? canvas
  wheelTarget.addEventListener("wheel", onWheel, { passive: false })
  window.addEventListener("resize", onResize)

  // ── 보간 ────────────────────────────────────────────────
  // alpha 회전과 target(팬+줌) 보간을 슬롯 두 개로 나눈다. 슬롯이 하나면 회전
  // 보간 도중 칩·home 을 눌렀을 때(또는 그 반대 순서)로 서로를 덮어써, 도는
  // 애니메이션이 중간값에서 버려지고 방위각이 45°/135°/225°/315° 가 아닌
  // 자리에 영원히 멈춘다. 두 슬롯은 서로 안 건드리므로 동시에 진행돼도(도는
  // 동시에 날아가도) 맞는 동작이다.
  const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) // easeInOutQuad

  let animAlpha: { from: number; to: number; t0: number; dur: number } | null = null
  let animTarget: { from: Vector3; to: Vector3; zoomFrom: number; zoomTo: number; t0: number; dur: number } | null = null

  // 첫 프레임에서 전체보기 배율을 다시 잰다. 카메라를 만드는 순간은 레이아웃이
  // 자리 잡기 전이라 캔버스 비율이 첫 프레임과 다를 수 있다.
  let fitted = false
  const tick = () => {
    if (!fitted) {
      fitted = true
      zoom = fit()
      applyZoom()
    }
    if (animAlpha) {
      const k = Math.min((performance.now() - animAlpha.t0) / animAlpha.dur, 1)
      camera.alpha = animAlpha.from + (animAlpha.to - animAlpha.from) * ease(k)
      if (k >= 1) animAlpha = null
    }
    if (animTarget) {
      const k = Math.min((performance.now() - animTarget.t0) / animTarget.dur, 1)
      const e = ease(k)
      // camera.target = X (setter) 는 cloneAlphaBetaRadius 기본값(false)으로
      // setTarget 을 불러 현재 position 과 새 target 으로 alpha·beta·radius 를
      // rebuildAnglesAndRadius() 로 다시 계산해 버린다 — 그러면 보간 프레임마다
      // 고정 기울기(BETA)가 조금씩 틀어진다. cloneAlphaBetaRadius=true 로
      // alpha/beta/radius 는 그대로 두고 target 만 옮긴다.
      camera.setTarget(Vector3.Lerp(animTarget.from, animTarget.to, e), false, false, true)
      zoom = animTarget.zoomFrom + (animTarget.zoomTo - animTarget.zoomFrom) * e
      applyZoom()
      if (k >= 1) animTarget = null
    }
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
      animAlpha = { from, to, t0: performance.now(), dur: 200 }
    },
    home() {
      // zoom·target 을 한 애니메이션에 실어 한 동작으로 돌아가게 한다.
      // 예전엔 zoom 을 즉시 바꾸고 target 만 보간해 2단으로 움직였다.
      animTarget = {
        from: camera.target.clone(), to: center,
        zoomFrom: zoom, zoomTo: fit(),
        t0: performance.now(), dur: 400,
      }
    },
    flyTo(target) {
      // 스펙은 팬+줌이다. 팬만 하면 넓게 본 상태에서 눌렀을 때 그 구간이
      // 가운데로 오기만 하고 라벨 문턱(SHOW_BELOW) 위라 이름도
      // 정지 시간도 안 읽힌다 — 칩을 누르는 이유가 사라진다.
      // 이미 그보다 가까이 보고 있으면 물러나지 않는다.
      animTarget = {
        from: camera.target.clone(), to: target,
        zoomFrom: zoom, zoomTo: Math.min(zoom, FLY_ZOOM),
        t0: performance.now(), dur: 400,
      }
    },
    didPan: () => moved,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      wheelTarget.removeEventListener("wheel", onWheel)
      window.removeEventListener("resize", onResize)
      scene.onBeforeRenderObservable.removeCallback(tick)
    },
  }
}
