import type { Scene, SegState, TagValue } from "../../shared/types.ts"
import { STATE_LABEL, segState } from "./Segment.tsx"

/**
 * 그 층에서 가장 나쁜 상태. 리프트는 양쪽 층에 다 걸리므로 두 층 모두에 반영된다 —
 * 층간 반송기가 막히면 어느 층을 보고 있든 알아야 하기 때문이다.
 *
 * unknown 은 {id}.state 태그가 없거나 문자열이 아닐 때 나온다 — 센서/통신 두절이거나
 * 스냅샷이 아직 안 온 상태다. 즉 "조용한 정상" 이 아니라 "이 구간이 뭘 하는지 모른다" 이고,
 * 실제로는 막혀 있는데 시스템이 모를 뿐일 수 있다. 따라서 running 보다 우선한다.
 */
export function floorState(scene: Scene, floorId: string, values: Map<string, TagValue>): SegState {
  const on = scene.segments.filter((s) => s.from.floor === floorId || s.to.floor === floorId)
  const states = on.map((s) => segState(s.id, values))
  if (states.includes("stalled")) return "stalled"
  if (states.includes("unknown")) return "unknown"
  if (states.includes("running")) return "running"
  return "idle"
}

/**
 * 배지는 모양으로 먼저 구분되고 색은 거들 뿐이다.
 * 🟢🔴⚪⚫  는 전부 같은 "채워진 원" 이라 색을 빼면 넷이 구별되지 않는다.
 * 하필 이 화면에서 제일 중요한 가동/정지가 초록/빨강 쌍인데, 그게 가장 흔한
 * 색각 이상에서 구분이 안 되는 조합이다. 모양과 한국어 낱말을 같이 붙인다.
 */
const BADGE: Record<SegState, string> = {
  running: "●",
  stalled: "▲",
  idle: "○",
  unknown: "?",
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
            // 스크린리더는 이 한 줄만 읽는다. 안쪽 글리프는 aria-hidden 이다 —
            // "●" 를 유니코드 이름으로 읽어주면 아무 도움이 안 된다.
            aria-label={`${f.label} ${STATE_LABEL[st]}`}
            onClick={() => onChange(f.id)}
          >
            <span className="floor-id">{f.id}</span>
            <span className="floor-badge" aria-hidden="true">{BADGE[st]}</span>
            <span className="floor-state" aria-hidden="true">{STATE_LABEL[st]}</span>
          </button>
        )
      })}
    </nav>
  )
}
