import type { Scene, TagValue } from "../../shared/types.ts"
import { formatStall, segStallMs, segState } from "./Segment.tsx"

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  onGo: (floorId: string, x: number, y: number) => void
}

/**
 * 정지 중인 구간만 칩으로 띄운다. 칩을 누르면 화면이 거기로 데려간다 —
 * 신입이 찾을 필요가 없는 것이 이 제품의 핵심이다.
 */
export default function AlertBar({ scene, values, onGo }: Props) {
  const stalled = scene.segments
    .filter((s) => segState(s.id, values) === "stalled")
    .map((s) => ({ seg: s, ms: segStallMs(s.id, values) }))
    .sort((a, b) => b.ms - a.ms)

  if (stalled.length === 0) {
    return <div className="alert-bar ok">정상 가동</div>
  }

  return (
    <div className="alert-bar" role="status">
      {stalled.map(({ seg, ms }) => {
        const section = scene.sections.find((x) => x.id === seg.section)
        return (
          <button
            key={seg.id}
            className="chip"
            onClick={() => onGo(seg.from.floor, seg.from.x, seg.from.y)}
          >
            ⚠ {section?.label ?? seg.section} {seg.label} 정지 {formatStall(ms)}
          </button>
        )
      })}
    </div>
  )
}
