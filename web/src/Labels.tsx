import { useEffect, useState } from "react"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, TagValue } from "../../shared/types.ts"
import { equipmentHeight, floorElevation } from "../../shared/types.ts"
import { segState, segStallMs, segWip, formatStall } from "./state.ts"
import { toBabylon, segmentPoints } from "./viewer/coords.ts"
import { projectToScreen } from "./viewer/project.ts"
import type { ViewerCtx } from "./viewer/Viewer.tsx"

type Item = { key: string; text: string; x: number; y: number; cls: string }

/** 이 배율보다 멀면 라벨을 숨긴다. 멀리서는 신호등만 남는다 */
const SHOW_BELOW = 60

export default function Labels({ ctx, scene, values }: {
  ctx: ViewerCtx | null
  scene: Scene
  values: Map<string, TagValue>
}) {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    if (!ctx) return
    const { bscene, cam } = ctx

    const recompute = () => {
      const zoom = (cam.camera.orthoTop ?? 0) * 2
      if (zoom > SHOW_BELOW) { setItems([]); return }

      const out: Item[] = []

      for (const e of scene.equipment) {
        const sec = scene.sections.find((s) => s.id === e.section)
        if (!sec) continue
        const top = floorElevation(scene, sec.floor) + equipmentHeight(e) + 0.4
        const p = projectToScreen(bscene, toBabylon(e.pos[0], e.pos[1], top))
        if (p.visible) out.push({ key: `eq:${e.id}`, text: e.label, x: p.x, y: p.y, cls: "lbl-eq" })
      }

      for (const seg of scene.segments) {
        const pts = segmentPoints(scene, seg)
        const mid = pts[Math.floor(pts.length / 2)]
        const st = segState(seg.id, values)
        const wip = segWip(seg.id, values)
        const cap = seg.capacity ?? 20
        const over = wip - Math.min(wip, cap)

        const p = projectToScreen(bscene, new Vector3(mid.x, mid.y + 1.2, mid.z))
        if (!p.visible) continue
        out.push({ key: `sg:${seg.id}`, text: seg.label, x: p.x, y: p.y, cls: "lbl-seg" })
        if (over > 0)
          out.push({ key: `ov:${seg.id}`, text: `+${over}`, x: p.x, y: p.y - 16, cls: "lbl-over" })
        if (st === "stalled")
          out.push({ key: `st:${seg.id}`, text: formatStall(segStallMs(seg.id, values)), x: p.x, y: p.y - 32, cls: "lbl-stall" })
      }

      setItems(out)
    }

    // 카메라가 움직이면 라벨도 따라가야 하므로 렌더 루프에 붙인다.
    // React 상태를 프레임마다 갱신하면 비싸므로 100ms 로 솎는다 —
    // 라벨은 한 프레임 늦어도 아무도 모른다.
    let last = 0
    const obs = bscene.onAfterRenderObservable.add(() => {
      const now = performance.now()
      if (now - last < 100) return
      last = now
      recompute()
    })
    return () => { bscene.onAfterRenderObservable.remove(obs) }
  }, [ctx, scene, values])

  return (
    <div className="labels" aria-hidden="true">
      {items.map((i) => (
        // left/top 은 레이아웃(리플로우)을 강제한다. transform 은 컴포지터만
        // 건드리므로 라벨이 매 프레임 움직여도 값싸다 — position 은 0,0 에
        // 고정해 두고 transform 으로만 옮긴다.
        <span key={i.key} className={i.cls} style={{ transform: `translate(${i.x}px, ${i.y}px) translate(-50%, -100%)` }}>
          {i.text}
        </span>
      ))}
    </div>
  )
}
