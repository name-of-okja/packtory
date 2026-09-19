import { useState } from "react"
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"
import Map from "./Map.tsx"
import type { Selection } from "./geom.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [floorId, setFloorId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const scene = data.scene
  const floors = [...scene.floors].sort((a, b) => b.order - a.order)
  const current = floorId ?? floors[0].id

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <Map
        scene={scene}
        values={values}
        floorId={current}
        selection={selection}
        onSelect={setSelection}
        panTo={null}
      />
    </div>
  )
}
