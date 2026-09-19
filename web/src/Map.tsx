import { useEffect, useRef, useState } from "react"
import type { Scene, TagValue } from "../../shared/types.ts"
import type { Equipment } from "../../shared/types.ts"
import { equipmentRect, floorBounds, toSvgY, type Bounds, type Selection } from "./geom.ts"

type ViewBox = [number, number, number, number]

function fit(b: Bounds): ViewBox {
  return [b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY]
}

/** 장비 경고: warn 이 설정된 태그 중 하나라도 임계 이상이면 참. 이력이 필요 없는 순간 판정이라 여기서 계산한다. */
export function equipmentWarn(scene: Scene, eqId: string, values: Map<string, TagValue>): boolean {
  const eq = scene.equipment.find((e) => e.id === eqId)
  if (!eq) return false
  return eq.tags.some((t) => {
    if (t.warn === undefined) return false
    const v = values.get(`${eq.id}.${t.key}`)
    return typeof v?.v === "number" && v.q === "good" && v.v >= t.warn
  })
}

/**
 * 호버 툴팁. SVG `<title>` 은 브라우저가 알아서 띄우므로 툴팁 컴포넌트를
 * 만들지 않는다 — 스펙 8장의 "값은 호버 툴팁" 은 이 한 줄로 끝난다.
 */
function equipmentTip(e: Equipment, values: Map<string, TagValue>): string {
  const lines = e.tags.map((t) => {
    const v = values.get(`${e.id}.${t.key}`)
    return `${t.label} ${v?.v ?? "—"}${t.unit ?? ""}`
  })
  return [e.label, ...lines].join("\n")
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  floorId: string
  selection: Selection
  onSelect: (s: Selection) => void
  /** AlertBar 가 특정 구간으로 화면을 옮길 때 쓴다 */
  panTo: { x: number; y: number; nonce: number } | null
  children?: (b: Bounds, zoomedIn: boolean) => React.ReactNode
}

export default function Map({ scene, values, floorId, selection, onSelect, panTo, children }: Props) {
  const b = floorBounds(scene, floorId)
  const [vb, setVb] = useState<ViewBox>(() => fit(b))
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; vb: ViewBox } | null>(null)

  // 이상 칩은 층 전환과 이동을 같은 렌더에서 요청한다. 아래 두 effect 중
  // 층 전환 쪽이 먼저 돌아 전체보기로 덮어쓰면 이동이 없던 일이 되므로
  // nonce 로 비켜간다.
  const lastPan = useRef(0)

  // 층이 바뀌면 전체보기로 되돌린다
  useEffect(() => {
    if (panTo && panTo.nonce !== lastPan.current) return // 아래 effect 가 처리한다
    setVb(fit(floorBounds(scene, floorId)))
  }, [floorId, scene])

  // 이상 칩이 요청한 위치로 이동 (줌 배율은 유지)
  useEffect(() => {
    if (!panTo || panTo.nonce === lastPan.current) return
    lastPan.current = panTo.nonce
    setVb(([, , w, h]) => [panTo.x - w / 2, toSvgY(panTo.y, b) - h / 2, w, h])
  }, [panTo?.nonce])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    // 커서가 가리키는 지점을 고정한 채 확대/축소
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
    setVb(([x, y, w, h]) => {
      const nw = Math.min(Math.max(w * k, 2), 500)
      const nh = nw * (h / w)
      return [x + (w - nw) * fx, y + (h - nh) * fy, nw, nh]
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const svg = svgRef.current
    if (!d || !svg) return
    const r = svg.getBoundingClientRect()
    const dx = ((e.clientX - d.x) / r.width) * d.vb[2]
    const dy = ((e.clientY - d.y) / r.height) * d.vb[3]
    setVb([d.vb[0] - dx, d.vb[1] - dy, d.vb[2], d.vb[3]])
  }
  const onPointerUp = () => { drag.current = null }

  const sections = scene.sections.filter((s) => s.floor === floorId)
  const sectionIds = new Set(sections.map((s) => s.id))
  const equipment = scene.equipment.filter((e) => sectionIds.has(e.section))
  /** 확대했을 때만 장비·구간 라벨을 띄운다. 축소 상태에서는 구역 이름만 남는다. */
  const zoomedIn = (b.maxX - b.minX) / vb[2] > 1.4

  return (
    <div className="map">
      <svg
        ref={svgRef}
        viewBox={vb.join(" ")}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {sections.map((s) => {
          const [x, y, w, h] = s.rect
          return (
            <g key={s.id} className="section" onClick={() => onSelect({ kind: "section", id: s.id })}>
              <title>{s.label}</title>
              <rect x={x} y={toSvgY(y + h, b)} width={w} height={h} rx={0.5} />
              <text x={x + 0.8} y={toSvgY(y + h, b) + 1.8} className="section-label">
                {s.label}
                {s.cameras.length > 0 ? ` 📹×${s.cameras.length}` : ""}
              </text>
            </g>
          )
        })}

        {/* 구간은 Task 7에서 children 으로 들어온다 */}
        {children?.(b, zoomedIn)}

        {equipment.map((e) => {
          const [x, y, w, h] = equipmentRect(e, b)
          const warn = equipmentWarn(scene, e.id, values)
          const sel = selection?.kind === "equipment" && selection.id === e.id
          return (
            <g
              key={e.id}
              className={`equipment${warn ? " warn" : ""}${sel ? " selected" : ""}`}
              onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "equipment", id: e.id }) }}
            >
              <title>{equipmentTip(e, values)}</title>
              <rect x={x} y={y} width={w} height={h} rx={0.3} />
              {zoomedIn && <text x={x + w / 2} y={y + h + 1.2} className="equipment-label">{e.label}</text>}
            </g>
          )
        })}
      </svg>

      <div className="map-controls">
        <button title="전체보기" onClick={() => setVb(fit(b))}>⌂</button>
        <button title="확대" onClick={() => setVb(([x, y, w, h]) => [x + w * 0.075, y + h * 0.075, w * 0.85, h * 0.85])}>+</button>
        <button title="축소" onClick={() => setVb(([x, y, w, h]) => [x - w * 0.075, y - h * 0.075, w * 1.15, h * 1.15])}>−</button>
      </div>
    </div>
  )
}
