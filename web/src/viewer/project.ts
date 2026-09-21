import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene as BScene } from "@babylonjs/core/scene"

/**
 * 3D 좌표를 캔버스 화면 좌표로. 글자를 3D 로 그리지 않는 이유는
 * 한글이 3D 텍스처로는 흐리고, Babylon GUI 모듈을 안 들여도 되기 때문이다.
 */
export function projectToScreen(bscene: BScene, world: Vector3): { x: number; y: number; visible: boolean } {
  const engine = bscene.getEngine()
  const cam = bscene.activeCamera
  if (!cam) return { x: 0, y: 0, visible: false }
  const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const p = Vector3.Project(world, Matrix.Identity(), bscene.getTransformMatrix(), vp)
  const dpr = engine.getHardwareScalingLevel()
  return {
    x: p.x * dpr,
    y: p.y * dpr,
    // 정사영이라 뒤로 넘어가는 일은 없지만 화면 밖은 거른다
    visible: p.x >= 0 && p.y >= 0 && p.x <= vp.width && p.y <= vp.height,
  }
}
