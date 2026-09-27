import { useEffect, useRef } from "react"
import { Engine } from "@babylonjs/core/Engines/engine"
import { Scene as BScene } from "@babylonjs/core/scene"
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight"
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color"
import type { Scene } from "../../../shared/types.ts"
import type { LayoutMode } from "../../../shared/layout.ts"
import { sceneBounds } from "./coords.ts"
import { createCamera, type IsoCamera } from "./camera.ts"

export type ViewerCtx = { bscene: BScene; cam: IsoCamera; engine: Engine }

type Props = {
  scene: Scene
  /** 바뀌면 엔진째 다시 짓는다 — 모드 전환은 전부 버리고 새로 그린다 (스펙 6장) */
  mode: LayoutMode
  /** Babylon 씬이 준비되면 한 번 불린다. 반환한 정리 함수는 언마운트 때 실행된다 */
  onReady: (ctx: ViewerCtx) => (() => void) | void
}

export default function Viewer({ scene, mode, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // onReady 를 ref 에 담는다. 의존성에 넣으면 값이 갱신될 때마다
  // 엔진이 통째로 재생성된다 — 3D 씬은 React 렌더 주기와 무관해야 한다.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    const bscene = new BScene(engine)
    bscene.clearColor = new Color4(0.06, 0.07, 0.09, 1)

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), bscene)
    hemi.intensity = 0.75
    hemi.groundColor = new Color3(0.2, 0.22, 0.26)
    const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), bscene)
    sun.intensity = 0.6

    const cam = createCamera(bscene, canvas, sceneBounds(scene, mode))
    const cleanup = onReadyRef.current({ bscene, cam, engine })

    engine.runRenderLoop(() => bscene.render())
    const onResize = () => engine.resize()
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      cleanup?.()
      cam.dispose()
      bscene.dispose()
      engine.dispose()
    }
  }, [scene, mode])

  return <canvas ref={canvasRef} className="viewer" />
}
