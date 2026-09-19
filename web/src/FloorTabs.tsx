import type { Scene, SegState, TagValue } from "../../shared/types.ts"
import { segState } from "./Segment.tsx"

/**
 * 그 층에서 가장 나쁜 상태. 리프트는 양쪽 층에 다 걸리므로 두 층 모두에 반영된다 —
 * 층간 반송기가 막히면 어느 층을 보고 있든 알아야 하기 때문이다.
 */
export function floorState(scene: Scene, floorId: string, values: Map<string, TagValue>): SegState {
  const on = scene.segments.filter((s) => s.from.floor === floorId || s.to.floor === floorId)
  const states = on.map((s) => segState(s.id, values))
  if (states.includes("stalled")) return "stalled"
  if (states.includes("running")) return "running"
  if (states.includes("unknown")) return "unknown"
  return "idle"
}

const BADGE: Record<SegState, string> = {
  running: "🟢",
  stalled: "🔴",
  idle: "⚪",
  unknown: "⚫",
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  current: string
  onChange: (floorId: string) => void
}

export default function FloorTabs({ scene, values, current, onChange }: Props) {
  const floors = [...scene.floors].sort((a, b) => b.order - a.order)
  return (
    <nav className="floor-tabs" aria-label="층 선택">
      {floors.map((f) => {
        const st = floorState(scene, f.id, values)
        return (
          <button
            key={f.id}
            className={`floor-tab${f.id === current ? " current" : ""}`}
            data-state={st}
            aria-current={f.id === current}
            onClick={() => onChange(f.id)}
          >
            <span className="floor-id">{f.id}</span>
            <span className="floor-badge" aria-label={st}>{BADGE[st]}</span>
          </button>
        )
      })}
    </nav>
  )
}
