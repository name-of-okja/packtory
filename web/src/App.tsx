import { useRef, useState } from "react"
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"
import Map from "./Map.tsx"
import Segments from "./Segment.tsx"
import FloorTabs from "./FloorTabs.tsx"
import AlertBar from "./AlertBar.tsx"
import type { Selection } from "./geom.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [floorId, setFloorId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [panTo, setPanTo] = useState<{ x: number; y: number; nonce: number } | null>(null)

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const scene = data.scene
  const floors = [...scene.floors].sort((a, b) => b.order - a.order)
  const current = floorId ?? floors[0].id

  // Date.now() 를 쓰면 같은 밀리초 안의 두 번째 활성화(키 반복 등)가 같은 값을
  // 내고, Map 의 `panTo.nonce === lastPan.current` 가드가 이미 처리한 것으로
  // 보고 삼킨다 — nonce 가 존재하는 단 하나의 이유가 바로 그 경우다.
  const nonceRef = useRef(0)

  // 층 전환과 이동을 한 번에. nonce 가 있어야 같은 칩을 연달아 눌러도 다시 움직인다.
  const goTo = (f: string, x: number, y: number) => {
    setFloorId(f)
    nonceRef.current += 1
    setPanTo({ x, y, nonce: nonceRef.current })
  }

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <AlertBar scene={scene} values={values} onGo={goTo} />
      <div className="body">
        <FloorTabs scene={scene} values={values} current={current} onChange={setFloorId} />
        <Map
          scene={scene}
          values={values}
          floorId={current}
          selection={selection}
          onSelect={setSelection}
          panTo={panTo}
        >
          {(b, zoomedIn) => (
            <Segments
              scene={scene}
              values={values}
              floorId={current}
              bounds={b}
              zoomedIn={zoomedIn}
              selection={selection}
              onSelect={setSelection}
            />
          )}
        </Map>
      </div>
    </div>
  )
}
