import { useEffect, useRef, useState } from "react"
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"
import AlertBar from "./AlertBar.tsx"
import Modal from "./Modal.tsx"
import Viewer from "./viewer/Viewer.tsx"
import type { IsoCamera } from "./viewer/camera.ts"
import type { ViewerCtx } from "./viewer/Viewer.tsx"
import type { Selection } from "./state.ts"
import { buildStatic } from "./viewer/build.ts"
import { createFlow, type Flow } from "./viewer/flow.ts"
import { createAndons, type Andons } from "./viewer/andon.ts"
import { attachPicking } from "./viewer/pick.ts"
import Labels from "./Labels.tsx"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [selection, setSelection] = useState<Selection>(null)
  const [ctx, setCtx] = useState<ViewerCtx | null>(null)
  const camRef = useRef<IsoCamera | null>(null)
  const flowRef = useRef<Flow | null>(null)
  const andonRef = useRef<Andons | null>(null)

  useEffect(() => {
    flowRef.current?.setValues(values)
    andonRef.current?.setValues(values)
  }, [values])

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <AlertBar scene={data.scene} values={values} onGo={() => {}} />
      <div className="viewer-wrap">
        <Viewer
          scene={data.scene}
          onReady={(c) => {
            const { bscene, cam } = c
            camRef.current = cam
            const statics = buildStatic(bscene, data.scene)
            const flow = createFlow(bscene, data.scene)
            const andons = createAndons(bscene, data.scene, statics.equipmentById)
            flowRef.current = flow
            andonRef.current = andons
            const detach = attachPicking(bscene, cam, setSelection)
            setCtx(c)
            return () => {
              detach()
              flow.dispose(); andons.dispose(); statics.dispose()
              flowRef.current = null; andonRef.current = null; camRef.current = null
              setCtx(null)
            }
          }}
        />
        <Labels ctx={ctx} scene={data.scene} values={values} />
        <div className="viewer-controls">
          <button title="왼쪽으로 회전" onClick={() => camRef.current?.rotate(-1)}>⟲</button>
          <button title="오른쪽으로 회전" onClick={() => camRef.current?.rotate(1)}>⟳</button>
          <button title="전체보기" onClick={() => camRef.current?.home()}>⌂</button>
        </div>
      </div>
      <Modal
        scene={data.scene}
        values={values}
        go2rtcBase={data.go2rtcBase}
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  )
}
