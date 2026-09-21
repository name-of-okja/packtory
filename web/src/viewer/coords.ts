import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene } from "../../../shared/types.ts"
import { equipmentHeight, floorElevation } from "../../../shared/types.ts"

/**
 * 씬 좌표는 평면도 기준으로 X 오른쪽, Y 위쪽이다. Babylon 은 Y 가 높이이므로
 * 씬의 Y 가 Babylon 의 Z 가 된다. **뒤집는 곳은 여기 하나뿐이다** —
 * 여기저기서 뒤집으면 어디가 뒤집혔는지 못 찾는다.
 */
export function toBabylon(x: number, y: number, elevation: number): Vector3 {
  return new Vector3(x, elevation, y)
}

/** 모든 층·구역·설비를 담는 상자. 전체보기와 카메라 거리 계산에 쓴다 */
export function sceneBounds(scene: Scene): { min: Vector3; max: Vector3 } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  let maxY = 0
  for (const sec of scene.sections) {
    const [x, y, w, h] = sec.rect
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + w)
    minZ = Math.min(minZ, y); maxZ = Math.max(maxZ, y + h)
    maxY = Math.max(maxY, floorElevation(scene, sec.floor))
  }
  for (const e of scene.equipment) {
    const sec = scene.sections.find((s) => s.id === e.section)
    if (!sec) continue
    maxY = Math.max(maxY, floorElevation(scene, sec.floor) + equipmentHeight(e))
  }
  if (!Number.isFinite(minX)) return { min: new Vector3(0, 0, 0), max: new Vector3(40, 6, 25) }
  return { min: new Vector3(minX, 0, minZ), max: new Vector3(maxX, maxY, maxZ) }
}
