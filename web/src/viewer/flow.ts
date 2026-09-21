import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder"
// thinInstanceSetBuffer 등은 Mesh 프로토타입에 사이드이펙트로 덧붙는 확장이다.
// 배럴(Meshes/index)을 거치지 않는 개별 임포트에서는 이 파일을 직접 임포트하지
// 않으면 메서드 자체가 없어 런타임에 "thinInstanceSetBuffer is not a function" 으로 죽는다.
import "@babylonjs/core/Meshes/thinInstanceMesh"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import { Matrix } from "@babylonjs/core/Maths/math.vector"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Scene, SegState, TagValue } from "../../../shared/types.ts"
import { segState, segWip } from "../state.ts"
import { pathSampler, segmentPoints } from "./coords.ts"

/** 눈에 보이는 이동 속도 (미터/초). 구간 길이와 무관하게 같아 보이게 한다 */
const SPEED = 3
/** 구간당 최대 렌더 개수. capacity 가 커도 브라우저가 죽으면 안 된다 */
const MAX_ITEMS = 60

type SegFlow = {
  sampler: ReturnType<typeof pathSampler>
  capacity: number
  /** 0..1, 흐를 때만 증가 */
  phase: number
  count: number
  state: SegState
}

export type Flow = {
  setValues(values: Map<string, TagValue>): void
  dispose(): void
}

export function createFlow(bscene: BScene, scene: Scene): Flow {
  const mat = new StandardMaterial("item", bscene)
  mat.diffuseColor = new Color3(0.82, 0.86, 0.92)
  mat.specularColor = Color3.Black()

  // 상자 하나를 thin instance 로 복제한다 — 몇백 개여도 드로우콜 하나다
  const proto = CreateBox("items", { size: 0.38 }, bscene)
  proto.material = mat
  proto.isPickable = false
  proto.thinInstanceEnablePicking = false

  const flows = new Map<string, SegFlow>()
  for (const seg of scene.segments) {
    flows.set(seg.id, {
      sampler: pathSampler(segmentPoints(scene, seg)),
      capacity: seg.capacity ?? 20,
      phase: 0,
      count: 0,
      state: "unknown",
    })
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  let buf = new Float32Array(0)

  const rebuild = () => {
    let total = 0
    for (const f of flows.values()) total += f.count
    if (buf.length !== total * 16) buf = new Float32Array(total * 16)

    let o = 0
    for (const f of flows.values()) {
      // 간격은 capacity 로 고정이다. 개수로 나누면 물건이 하나 생길 때마다
      // 기존 물건이 전부 자리를 옮겨 화면이 튄다.
      const gap = 1 / f.capacity
      for (let i = 0; i < f.count; i++) {
        const p = f.sampler.at(f.phase - i * gap)
        Matrix.Translation(p.x, p.y, p.z).copyToArray(buf, o)
        o += 16
      }
    }
    proto.thinInstanceSetBuffer("matrix", buf, 16)
    proto.setEnabled(total > 0)
  }

  const onFrame = () => {
    if (reduced) return
    const dt = bscene.getEngine().getDeltaTime() / 1000
    let moved = false
    for (const f of flows.values()) {
      // 멈춘 구간은 위상을 안 올린다 → 물건이 그 자리에 얼어붙는다
      if (f.state !== "running" || f.count === 0) continue
      f.phase = (f.phase + (SPEED * dt) / f.sampler.length) % 1
      moved = true
    }
    if (moved) rebuild()
  }
  bscene.onBeforeRenderObservable.add(onFrame)

  return {
    setValues(values) {
      for (const [id, f] of flows) {
        f.state = segState(id, values)
        const wip = segWip(id, values)
        // capacity 를 넘겨 그려봐야 앞선 물건과 겹쳐 안 보인다.
        // 넘는 수량은 Task 9 의 +N 라벨이 말한다.
        f.count = f.state === "unknown" ? 0 : Math.min(wip, f.capacity, MAX_ITEMS)
      }
      rebuild()
    },
    dispose() {
      bscene.onBeforeRenderObservable.removeCallback(onFrame)
      proto.dispose()
      mat.dispose()
    },
  }
}
