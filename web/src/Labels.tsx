import { useEffect, useState } from "react"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, TagValue } from "../../shared/types.ts"
import { equipmentHeight } from "../../shared/types.ts"
import type { LayoutMode } from "../../shared/layout.ts"
import { segState, segStallMs, segWip, formatStall } from "./state.ts"
import { worldAt, segmentPoints, pathSampler } from "./viewer/coords.ts"
import { projectToScreen } from "./viewer/project.ts"
import { SHOW_BELOW, zoomOf } from "./viewer/camera.ts"
import type { ViewerCtx } from "./viewer/Viewer.tsx"

type Item = { key: string; text: string; x: number; y: number; cls: string }
type Badge = { id: string; text: string; x: number; y: number; stalled: number }

export default function Labels({ ctx, scene, values, mode, onSection }: {
  ctx: ViewerCtx | null
  scene: Scene
  values: Map<string, TagValue>
  mode: LayoutMode
  /** 구역 배지를 눌렀을 때 */
  onSection: (sectionId: string) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [badges, setBadges] = useState<Badge[]>([])

  useEffect(() => {
    if (!ctx) return
    const { bscene } = ctx

    const recompute = () => {
      // 멀리서는 정지 구간 라벨과 구역 배지만, 가까이서는 화면 안의 모든 라벨.
      // 대형 씬은 전체보기에서 구간 500 개다 — 전부 띄우면 글자 더미에 빨강이 묻힌다.
      const far = zoomOf(bscene) > SHOW_BELOW
      const out: Item[] = []

      if (!far) {
        for (const e of scene.equipment) {
          const sec = scene.sections.find((s) => s.id === e.section)
          if (!sec) continue
          const p = projectToScreen(bscene, worldAt(scene, sec.floor, e.pos[0], e.pos[1], equipmentHeight(e) + 0.4, mode))
          if (p.visible) out.push({ key: `eq:${e.id}`, text: e.label, x: p.x, y: p.y, cls: "lbl-eq" })
        }
      }

      const stalledIn = new Map<string, number>()
      for (const seg of scene.segments) {
        const st = segState(seg.id, values)
        if (st === "stalled") stalledIn.set(seg.section, (stalledIn.get(seg.section) ?? 0) + 1)
        if (far && st !== "stalled") continue

        // pts[Math.floor(pts.length / 2)] 는 중점이 아니다 — via 없는 2점
        // 직선 구간은 length=2, floor(1)=1 로 끝점을 고른다. 끝점은 신호등이
        // 서 있는 자리라 라벨이 바로 옆 설비 라벨과 겹친다. 호 길이 기준
        // 중점을 써야 한다.
        const mid = pathSampler(segmentPoints(scene, seg, mode)).at(0.5)
        const wip = segWip(seg.id, values)
        const cap = seg.capacity ?? 20
        const over = wip - Math.min(wip, cap)

        // 화면 밖이면 투영 결과를 버린다 — DOM 에 넣지 않는다
        const p = projectToScreen(bscene, new Vector3(mid.x, mid.y + 1.2, mid.z))
        if (!p.visible) continue
        out.push({ key: `sg:${seg.id}`, text: seg.label, x: p.x, y: p.y, cls: "lbl-seg" })
        if (over > 0)
          out.push({ key: `ov:${seg.id}`, text: `+${over}`, x: p.x, y: p.y - 16, cls: "lbl-over" })
        if (st === "stalled")
          out.push({ key: `st:${seg.id}`, text: formatStall(segStallMs(seg.id, values)), x: p.x, y: p.y - 32, cls: "lbl-stall" })
      }

      const bs: Badge[] = []
      if (far) {
        for (const sec of scene.sections) {
          const [x, y, w, h] = sec.rect
          const p = projectToScreen(bscene, worldAt(scene, sec.floor, x + w / 2, y + h / 2, 0.5, mode))
          if (!p.visible) continue
          const n = stalledIn.get(sec.id) ?? 0
          bs.push({ id: sec.id, text: `${sec.label} · ${n ? `정지 ${n}` : "정상"}`, x: p.x, y: p.y, stalled: n })
        }
      }

      setItems(out)
      setBadges(bs)
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
  }, [ctx, scene, values, mode])

  return (
    <>
      {/* 배지는 누를 수 있어야 하므로 aria-hidden 인 라벨 층과 따로 둔다. 라벨보다
          먼저 그려 아래에 깐다 — 정지 시간 라벨이 배지에 가리면 안 된다 */}
      <div className="badges">
        {badges.map((b) => (
          <button
            key={b.id}
            className={b.stalled ? "badge stalled" : "badge"}
            style={{ transform: `translate(${b.x}px, ${b.y}px) translate(-50%, -50%)` }}
            onClick={() => onSection(b.id)}
          >
            {b.text}
          </button>
        ))}
      </div>
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
    </>
  )
}
