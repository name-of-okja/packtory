import type { Scene, SegState, Segment, TagValue } from "../../shared/types.ts"
import { isLift } from "../../shared/types.ts"
import { pathLength, segmentPath, toSvgY, type Bounds, type Selection } from "./geom.ts"

/** 구간당 화면에 그리는 점의 최대 개수. 500개가 쌓여도 브라우저가 죽으면 안 된다. */
const MAX_DOTS = 30
/** 점의 눈에 보이는 속도 (미터/초). 구간 길이와 무관하게 같아 보이도록 duration 을 길이에서 뽑는다. */
const VISUAL_SPEED = 3

export function segState(id: string, values: Map<string, TagValue>): SegState {
  const v = values.get(`${id}.state`)
  return (typeof v?.v === "string" ? v.v : "unknown") as SegState
}

export function segWip(id: string, values: Map<string, TagValue>): number {
  const v = values.get(`${id}.wip`)
  return typeof v?.v === "number" ? v.v : 0
}

export function segStallMs(id: string, values: Map<string, TagValue>): number {
  const v = values.get(`${id}.stallMs`)
  return typeof v?.v === "number" ? v.v : 0
}

export const STATE_LABEL: Record<SegState, string> = {
  running: "가동", stalled: "정지", idle: "대기", unknown: "불명",
}

export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  floorId: string
  bounds: Bounds
  /** 확대 상태에서만 구간 라벨을 띄운다 (Map 이 내려준다) */
  zoomedIn: boolean
  selection: Selection
  onSelect: (s: Selection) => void
  /** 리프트를 클릭하면 상대 층으로 전환한다 (스펙 8장·완료 기준 10) */
  onFloorChange: (floorId: string) => void
}

export default function Segments({ scene, values, floorId, bounds, zoomedIn, selection, onSelect, onFloorChange }: Props) {
  const flat = scene.segments.filter(
    (s) => !isLift(s) && s.from.floor === floorId,
  )
  // 리프트는 양쪽 층 지도 모두에 마커로 나타난다
  const lifts = scene.segments.filter(
    (s) => isLift(s) && (s.from.floor === floorId || s.to.floor === floorId),
  )

  return (
    <>
      {flat.map((seg) => {
        const d = segmentPath(seg, bounds)!
        const state = segState(seg.id, values)
        const wip = segWip(seg.id, values)
        // 점 i 의 위상은 (t/dur + i/capacity) mod 1 이라 i 와 i+capacity 는 정확히
        // 겹친다. capacity 를 넘겨 그려봐야 보이지 않는 원만 쌓이므로 거기서 끊는다.
        // 그래서 구간은 "꽉 차면 꽉 차 보이고" 그 위는 숫자가 말한다 — capacity 가
        // 제 뜻대로 쓰이는 셈이다. MAX_DOTS 는 그 위의 안전 상한으로 남는다.
        const cap = Math.min(seg.capacity ?? 20, MAX_DOTS)
        const dots = state === "unknown" ? 0 : Math.min(wip, cap)
        const dur = pathLength(seg) / VISUAL_SPEED
        // 점 간격을 capacity 로 고정한다. n 으로 나누면 점이 늘 때마다
        // 기존 점들의 delay 가 바뀌어 화면 전체가 튄다.
        const gap = dur / (seg.capacity ?? 20)
        const sel = selection?.kind === "segment" && selection.id === seg.id

        return (
          <g
            key={seg.id}
            className={`segment${sel ? " selected" : ""}`}
            data-state={state}
            onClick={(e) => { e.stopPropagation(); onSelect({ kind: "segment", id: seg.id }) }}
          >
            <title>{`${seg.label}\n${STATE_LABEL[state]} · WIP ${wip}`}</title>
            <path className="rail-hit" d={d} />
            <path className="rail" d={d} />
            {Array.from({ length: dots }, (_, i) => (
              <circle
                key={i}
                className="item"
                r={0.35}
                style={{
                  offsetPath: `path("${d}")`,
                  animationDuration: `${dur}s`,
                  animationDelay: `${-i * gap}s`,
                }}
              />
            ))}
            {wip > dots && (
              <text className="overflow" x={seg.to.x} y={toSvgY(seg.to.y, bounds) - 1}>
                +{wip - dots}
              </text>
            )}
            {zoomedIn && (
              <text
                className="segment-label"
                x={(seg.from.x + seg.to.x) / 2}
                y={toSvgY((seg.from.y + seg.to.y) / 2, bounds) - 0.8}
              >
                {seg.label}
              </text>
            )}
          </g>
        )
      })}

      {lifts.map((seg) => {
        const here = seg.from.floor === floorId ? seg.from : seg.to
        const other = seg.from.floor === floorId ? seg.to : seg.from
        const up = (scene.floors.find((f) => f.id === other.floor)?.order ?? 0)
          > (scene.floors.find((f) => f.id === here.floor)?.order ?? 0)
        const state = segState(seg.id, values)
        const wip = segWip(seg.id, values)

        return (
          <g
            key={`${seg.id}-${floorId}`}
            className="lift"
            data-state={state}
            // 스펙 8장 "클릭하면 상대 층으로 전환한다" / 완료 기준 10. 모달을 열지 않는다 —
            // 수치는 아래 마커 라벨과 호버 툴팁에 이미 있다.
            onClick={(e) => { e.stopPropagation(); onFloorChange(other.floor) }}
          >
            <title>{`${seg.label}\n${STATE_LABEL[state]} · WIP ${wip} · ${other.floor} 연결`}</title>
            <circle cx={here.x} cy={toSvgY(here.y, bounds)} r={1.1} />
            <text x={here.x} y={toSvgY(here.y, bounds) + 0.45} className="lift-arrow">
              {up ? "▲" : "▼"}
            </text>
            <text x={here.x} y={toSvgY(here.y, bounds) - 1.6} className="lift-label">
              {other.floor} · {wip}
            </text>
          </g>
        )
      })}
    </>
  )
}
