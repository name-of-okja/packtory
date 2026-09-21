import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, Segment } from "../../../shared/types.ts"
import { equipmentHeight, floorElevation, isLift } from "../../../shared/types.ts"

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

/** 컨베이어 벨트면 높이. 바닥에 붙어 있으면 물건이 바닥을 미끄러지는 것처럼 보인다 */
export const BELT_Y = 0.8

/**
 * 구간의 월드 점열. 리프트는 출발점에서 올라가는 세로 기둥 다음 도착 층의
 * 가로 구간이고, 평면 구간은 from → via… → to 의 폴리라인이다.
 */
export function segmentPoints(scene: Scene, seg: Segment): Vector3[] {
  const fromY = floorElevation(scene, seg.from.floor) + BELT_Y
  const toY = floorElevation(scene, seg.to.floor) + BELT_Y
  if (isLift(seg)) {
    // 스펙은 리프트를 "두 층을 잇는 세로 기둥" 으로 규정한다(구성 요소 표, 완료 기준 10).
    // 두 끝을 그냥 직선으로 이으면 데모 씬의 lift-1 처럼 수평 33m·수직 6m 인
    // 경우 2도짜리 사면이 돼서 옆 컨베이어와 구별이 안 된다 — 층을 잇는다는
    // 것이 화면에서 읽히지 않는다. 출발점에서 수직으로 올린 뒤 도착 층에서 보낸다.
    const pts = [
      toBabylon(seg.from.x, seg.from.y, fromY),
      toBabylon(seg.from.x, seg.from.y, toY),
    ]
    // 수직으로만 올라가는 리프트면 가로 구간을 더하지 않는다 — 길이 0 인 구간을
    // 넣으면 CreateTube 가 법선을 못 구해 메시가 깨진다.
    if (seg.from.x !== seg.to.x || seg.from.y !== seg.to.y) {
      pts.push(toBabylon(seg.to.x, seg.to.y, toY))
    }
    return pts
  }
  return [
    toBabylon(seg.from.x, seg.from.y, fromY),
    ...(seg.via ?? []).map(([x, y]) => toBabylon(x, y, fromY)),
    toBabylon(seg.to.x, seg.to.y, toY),
  ]
}

/**
 * 폴리라인 위를 0..1 로 훑는다. 물건 배치에 쓴다.
 * t 는 순환값이다 — Task 6 이 `phase - i * gap` 으로 물건마다 위상을 어긋나게
 * 놓기 때문에 t 가 일상적으로 음수가 된다. `((t % 1) + 1) % 1` 로 [0,1) 에
 * 되감아서, 경로 끝을 넘어간 물건이 시작으로 이어지게 한다. 클램프로 바꾸면
 * t<0 인 물건이 전부 시작점 한 점에 쌓인다.
 */
export function pathSampler(points: Vector3[]): { length: number; at(t: number): Vector3 } {
  const segLen: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = Vector3.Distance(points[i - 1], points[i])
    segLen.push(d)
    total += d
  }
  return {
    length: Math.max(total, 0.001),
    at(t: number) {
      const want = ((t % 1) + 1) % 1 * total
      let acc = 0
      for (let i = 0; i < segLen.length; i++) {
        if (acc + segLen[i] >= want) {
          const k = segLen[i] === 0 ? 0 : (want - acc) / segLen[i]
          return Vector3.Lerp(points[i], points[i + 1], k)
        }
        acc += segLen[i]
      }
      return points[points.length - 1].clone()
    },
  }
}
