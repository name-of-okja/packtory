import { useState } from "react"
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

  // 층 전환과 이동을 한 번에. nonce 가 있어야 같은 칩을 연달아 눌러도 다시 움직인다.
  const goTo = (f: string, x: number, y: number) => {
    setFloorId(f)
    setPanTo({ x, y, nonce: Date.now() })
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
