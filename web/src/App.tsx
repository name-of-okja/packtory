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
import { pathSampler, segmentPoints } from "./viewer/coords.ts"
import Labels from "./Labels.tsx"
import type { Segment } from "../../shared/types.ts"

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

  const goTo = (seg: Segment) => {
    const pts = segmentPoints(data.scene, seg)
    // 구간 한가운데로 간다. 끝점으로 가면 긴 구간이 화면 가장자리에 걸린다.
    // pts[Math.floor(pts.length / 2)] 는 중점이 아니다 — via 없는 2점 직선
    // 구간은 length=2, floor(1)=1 로 끝점(pts[1])을 고른다. 호 길이 기준으로
    // 진짜 중점을 잡아야 한다.
    const mid = pathSampler(pts).at(0.5)
    camRef.current?.flyTo(mid)
  }

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <AlertBar scene={data.scene} values={values} onGo={goTo} />
      <div className="viewer-wrap">
        <Viewer
          scene={data.scene}
          onReady={(c) => {
            const { bscene, cam } = c
            camRef.current = cam
            const statics = buildStatic(bscene, data.scene)
            const flow = createFlow(bscene, data.scene)
            const andons = createAndons(bscene, data.scene, statics.equipmentById)
            // 씬이 늦게 준비되면(HTTP 가 WS 보다 늦게 오면) 이 시점에 이미
            // 최신 값이 와 있을 수 있다. 허브는 변경분만 푸시하므로(cache.ts)
            // 라인이 멈춰 있으면 다음 값이 영영 안 온다 — 여기서 한 번 먹여
            // 둬야 신호등이 접속 직후부터 정확하다.
            flow.setValues(values); andons.setValues(values)
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
