import { useEffect, useRef, useState } from "react"
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

  // 살아있는 영역이 알려야 할 것은 "정지가 새로 생겼다/풀렸다" 이지
  // "초가 바뀌었다" 가 아니다. role="status" 는 암묵적으로 aria-atomic="true"
  // 라서, 칩 하나의 타이머가 500ms 마다 갱신될 때마다 스크린리더가 막대
  // 전체를 다시 읽는다 — 정지가 둘이면 두 배로 읽는다. 그래서 칩에서는
  // 살아있는 영역을 떼고, 아래 announcer 가 "집합이 바뀐 순간" 에만 말한다.
  const ids = stalled.map(({ seg }) => seg.id).join(",")
  const [announcement, setAnnouncement] = useState("")
  const prevIds = useRef<string | null>(null)

  useEffect(() => {
    // 첫 렌더에서는 알리지 않는다 — 화면을 켠 순간 읽어줄 이유가 없다.
    if (prevIds.current === null) { prevIds.current = ids; return }
    if (prevIds.current === ids) return
    prevIds.current = ids
    setAnnouncement(
      stalled.length === 0
        ? "정상 가동으로 복귀"
        : `정지 ${stalled.length}건: ${stalled.map(({ seg }) => seg.label).join(", ")}`,
    )
  }, [ids, stalled])

  // 살아있는 영역은 내용이 바뀌기 **전에** 이미 DOM 에 있어야 한다. 새로 삽입된
  // 영역의 초기 내용은 안 읽어주는 AT 가 있기 때문이다. 두 분기 안에 각각 쓰면
  // JSX 가 형제 위치로 대조하므로 ok↔정지 전환 때마다 언마운트·재마운트된다 —
  // 그래서 분기 바깥, 프래그먼트의 첫 자식으로 고정한다. position: absolute 라
  // 그리드 트랙을 만들지 않으므로 레이아웃에는 영향이 없다.
  const announcer = (
    <span className="sr-only" aria-live="polite">{announcement}</span>
  )

  return (
    <>
      {announcer}
      {stalled.length === 0 ? (
        <div className="alert-bar ok">정상 가동</div>
      ) : (
        <div className="alert-bar">
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
      )}
    </>
  )
}
