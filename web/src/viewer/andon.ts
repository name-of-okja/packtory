import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder"
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Color3 } from "@babylonjs/core/Maths/math.color"
// EffectLayer(HighlightLayer 의 기반)는 씬 컴포넌트를 사이드이펙트 임포트로
// 등록해야 동작한다 — Task 6 의 thinInstanceMesh 와 같은 종류의 함정이다.
// 빠뜨리면 "EffectLayerSceneComponent needs to be imported" 로 런타임에만 죽고
// 타입체크·빌드는 통과한다(실측: 화면이 통째로 비었다).
import "@babylonjs/core/Layers/effectLayerSceneComponent"
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer"
import type { Mesh } from "@babylonjs/core/Meshes/mesh"
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Scene, SegState, TagValue } from "../../../shared/types.ts"
import { equipmentHeight } from "../../../shared/types.ts"
import { floorOrigin, type LayoutMode } from "../../../shared/layout.ts"
import { lampVisibleFar, segState } from "../state.ts"
import { segmentPoints } from "./coords.ts"
import { SHOW_BELOW, zoomOf } from "./camera.ts"
import type { MeshMeta } from "./build.ts"

/**
 * 적층 신호등. 구간의 출구 끝에 세운다 — 막힘이 드러나는 자리가 거기다.
 * 기둥이라 위에서도 옆에서도 다른 설비 뒤에서도 보인다. 평면 색칠은 3D 에서
 * 카메라 각도에 따라 사라지지만 수직 요소는 사라지지 않는다.
 * 그리고 현장 사람이 이미 읽을 줄 아는 물건이다.
 */
const MIN_POLE = 3

const LAMP: Record<SegState, { color: Color3; blinkHz: number }> = {
  running: { color: new Color3(0.30, 0.85, 0.42), blinkHz: 0 },
  stalled: { color: new Color3(1.00, 0.25, 0.25), blinkHz: 1 },
  idle:    { color: new Color3(0.18, 0.20, 0.24), blinkHz: 0 },
  unknown: { color: new Color3(0.90, 0.90, 0.90), blinkHz: 0.5 },
}

const WARN_GLOW = new Color3(0.88, 0.54, 0.18)

/** 이력이 필요 없는 순간 판정이라 클라이언트가 계산한다 (스펙 6장) */
function isWarning(scene: Scene, eqId: string, values: Map<string, TagValue>): boolean {
  const eq = scene.equipment.find((e) => e.id === eqId)
  if (!eq) return false
  return eq.tags.some((t) => {
    if (t.warn === undefined) return false
    const v = values.get(`${eq.id}.${t.key}`)
    return typeof v?.v === "number" && v.q === "good" && v.v >= t.warn
  })
}

type One = { lamp: Mesh; pole: Mesh; mat: StandardMaterial; state: SegState }

export type Andons = {
  setValues(values: Map<string, TagValue>): void
  dispose(): void
}

export function createAndons(
  bscene: BScene,
  scene: Scene,
  equipmentById: Map<string, AbstractMesh>,
  mode: LayoutMode,
): Andons {
  const poleMat = new StandardMaterial("pole", bscene)
  poleMat.diffuseColor = new Color3(0.18, 0.20, 0.24)
  poleMat.specularColor = Color3.Black()

  const glow = new HighlightLayer("warn", bscene)
  const glowing = new Set<string>()

  const made: One[] = []
  const created: Mesh[] = []

  for (const seg of scene.segments) {
    const pts = segmentPoints(scene, seg, mode)
    const end = pts[pts.length - 1]

    // 기둥은 구간이 실제로 서는 층(도착 층)의 설비보다 높아야 가려도 보인다.
    // 브리프 원안은 seg.section 이 가리키는 구역의 floor 로 기준을 잡았는데,
    // 리프트는 from 층 소속 구역에 등록돼 있다(scene.json 의 lift-1: section
    // "inbound" 는 1F 인데 to.floor 는 2F). 그 기준을 쓰면 기둥이 출발 층
    // 높이로 서서 램프가 도착 층 벨트보다 한참 아래(허공)에 뜬다. 구간이
    // 실제로 끝나는 도착 층(seg.to.floor)을 직접 기준으로 삼는다.
    const base = floorOrigin(scene, seg.to.floor, mode).elev
    const tallest = scene.equipment
      .filter((e) => {
        const s = scene.sections.find((sec) => sec.id === e.section)
        return s?.floor === seg.to.floor
      })
      .reduce((m, e) => Math.max(m, equipmentHeight(e)), 0)
    const poleH = Math.max(MIN_POLE, tallest + 1)

    const pole = CreateCylinder(`andonpole:${seg.id}`, { diameter: 0.12, height: poleH, tessellation: 8 }, bscene)
    pole.position.set(end.x, base + poleH / 2, end.z)
    pole.material = poleMat
    pole.isPickable = false
    created.push(pole)

    const mat = new StandardMaterial(`andon:${seg.id}`, bscene)
    mat.diffuseColor = Color3.Black()
    mat.specularColor = Color3.Black()
    mat.emissiveColor = LAMP.unknown.color

    const lamp = CreateSphere(`andon:${seg.id}`, { diameter: 0.7, segments: 10 }, bscene)
    lamp.position.set(end.x, base + poleH, end.z)
    lamp.material = mat
    // 신호등을 클릭하면 그 구간이 잡혀야 한다
    lamp.metadata = { kind: "andon", id: seg.id } satisfies MeshMeta
    created.push(lamp)

    made.push({ lamp, pole, mat, state: "unknown" })
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // 멀리서는 정지(와 불명) 신호등만 세운다. 층당 백 개 가까운 초록 기둥 사이에서 빨강
  // 몇 개를 찾으라는 화면은 이 제품의 목적과 반대다 (스펙 6장 밀도 제어).
  let far: boolean | null = null
  const applyVisibility = () => {
    for (const one of made) {
      const show = !far || lampVisibleFar(one.state)
      if (one.lamp.isEnabled() === show) continue
      one.lamp.setEnabled(show)
      one.pole.setEnabled(show)
    }
  }

  const onFrame = () => {
    // 문턱 판정은 모션 감소 설정과 무관하다 — 줌은 사용자가 바꾼다
    const nowFar = zoomOf(bscene) > SHOW_BELOW
    if (nowFar !== far) { far = nowFar; applyVisibility() }
    if (reduced) return
    const t = performance.now() / 1000
    for (const one of made) {
      const spec = LAMP[one.state]
      if (spec.blinkHz === 0) continue
      // 점멸은 재질의 emissive 만 바꾼다. 메시를 다시 만들지 않는다.
      const on = Math.floor(t * spec.blinkHz * 2) % 2 === 0
      one.mat.emissiveColor = on ? spec.color : spec.color.scale(0.15)
    }
  }
  bscene.onBeforeRenderObservable.add(onFrame)

  return {
    setValues(values) {
      for (let i = 0; i < scene.segments.length; i++) {
        const st = segState(scene.segments[i].id, values)
        made[i].state = st
        made[i].mat.emissiveColor = LAMP[st].color
      }
      applyVisibility()

      for (const [id, mesh] of equipmentById) {
        const want = isWarning(scene, id, values)
        const has = glowing.has(id)
        if (want && !has) { glow.addMesh(mesh as Mesh, WARN_GLOW); glowing.add(id) }
        else if (!want && has) { glow.removeMesh(mesh as Mesh); glowing.delete(id) }
      }
    },
    dispose() {
      bscene.onBeforeRenderObservable.removeCallback(onFrame)
      for (const m of created) m.dispose()
      for (const o of made) o.mat.dispose()
      poleMat.dispose()
      glow.dispose()
    },
  }
}
