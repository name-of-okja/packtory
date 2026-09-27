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
import { pathSampler, segmentPoints, worldAt } from "./viewer/coords.ts"
import Labels from "./Labels.tsx"
import type { Segment } from "../../shared/types.ts"
import type { LayoutMode } from "../../shared/layout.ts"
import type { Engine } from "@babylonjs/core/Engines/engine"

const params = new URLSearchParams(location.search)
/**
 * 기본(stack)이 아닌 배치를 이만큼 아무도 안 만지면 기본으로 돌아간다.
 * 누가 계단 배치로 바꿔 놓고 가면 다음 사람은 이상한 화면을 본다 — 카메라
 * 기울기를 잠근 것과 같은 이유다. `?idleMs=` 는 확인용(체크리스트)이다.
 */
const IDLE_RESET_MS = Number(params.get("idleMs")) || 5 * 60_000
/** `?layout=stair` 로 계단 배치에서 시작한다. 헤드리스 스크린샷(tools/shot.mjs)은
 *  버튼을 못 누르므로 확인용이다. 이것도 IDLE_RESET_MS 뒤에는 기본으로 돌아간다 */
const START_MODE: LayoutMode = params.get("layout") === "stair" ? "stair" : "stack"
const SHOW_FPS = params.has("fps")

/** `?fps` 일 때만 구석에 뜬다. 성능 측정용 (스펙 6장) */
function Fps({ engine }: { engine: Engine | undefined }) {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    if (!engine) return
    const id = setInterval(() => setFps(engine.getFps()), 500)
    return () => clearInterval(id)
  }, [engine])
  return <div className="fps">{fps.toFixed(0)} fps</div>
}

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [selection, setSelection] = useState<Selection>(null)
  const [ctx, setCtx] = useState<ViewerCtx | null>(null)
  const [mode, setMode] = useState<LayoutMode>(START_MODE)
  const camRef = useRef<IsoCamera | null>(null)
  const flowRef = useRef<Flow | null>(null)
  const andonRef = useRef<Andons | null>(null)

  useEffect(() => {
    flowRef.current?.setValues(values)
    andonRef.current?.setValues(values)
  }, [values])

  useEffect(() => {
    if (mode === "stack") return
    let timer = setTimeout(() => setMode("stack"), IDLE_RESET_MS)
    const poke = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setMode("stack"), IDLE_RESET_MS)
    }
    const events = ["pointerdown", "pointermove", "wheel", "keydown"] as const
    for (const e of events) window.addEventListener(e, poke, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, poke)
    }
  }, [mode])

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const goTo = (seg: Segment) => {
    const pts = segmentPoints(data.scene, seg, mode)
    // 구간 한가운데로 간다. 끝점으로 가면 긴 구간이 화면 가장자리에 걸린다.
    // pts[Math.floor(pts.length / 2)] 는 중점이 아니다 — via 없는 2점 직선
    // 구간은 length=2, floor(1)=1 로 끝점(pts[1])을 고른다. 호 길이 기준으로
    // 진짜 중점을 잡아야 한다.
    const mid = pathSampler(pts).at(0.5)
    camRef.current?.flyTo(mid)
  }

  const goSection = (id: string) => {
    const sec = data.scene.sections.find((s) => s.id === id)
    if (!sec) return
    const [x, y, w, h] = sec.rect
    camRef.current?.flyTo(worldAt(data.scene, sec.floor, x + w / 2, y + h / 2, 0, mode))
  }

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <AlertBar scene={data.scene} values={values} onGo={goTo} />
      <div className="viewer-wrap">
        <Viewer
          scene={data.scene}
          mode={mode}
          onReady={(c) => {
            const { bscene, cam } = c
            camRef.current = cam
            const statics = buildStatic(bscene, data.scene, mode)
            const flow = createFlow(bscene, data.scene, mode)
            const andons = createAndons(bscene, data.scene, statics.equipmentById, mode)
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
        <Labels ctx={ctx} scene={data.scene} values={values} mode={mode} onSection={goSection} />
        {SHOW_FPS && <Fps engine={ctx?.engine} />}
        <div className="viewer-controls">
          <button title="왼쪽으로 회전" onClick={() => camRef.current?.rotate(-1)}>⟲</button>
          <button title="오른쪽으로 회전" onClick={() => camRef.current?.rotate(1)}>⟳</button>
          <button title="전체보기" onClick={() => camRef.current?.home()}>⌂</button>
          <button
            title={mode === "stack" ? "계단 배치로 보기" : "적층 배치로 보기"}
            onClick={() => setMode(mode === "stack" ? "stair" : "stack")}
          >
            {mode === "stack" ? "⋰" : "≡"}
          </button>
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
