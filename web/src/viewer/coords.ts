import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, Segment } from "../../../shared/types.ts"
import { equipmentHeight, isLift } from "../../../shared/types.ts"
import { floorOrigin, type LayoutMode } from "../../../shared/layout.ts"

/**
 * 씬 좌표는 평면도 기준으로 X 오른쪽, Y 위쪽이다. Babylon 은 Y 가 높이이므로
 * 씬의 Y 가 Babylon 의 Z 가 된다. **뒤집는 곳은 여기 하나뿐이다** —
 * 여기저기서 뒤집으면 어디가 뒤집혔는지 못 찾는다.
 */
export function toBabylon(x: number, y: number, elevation: number): Vector3 {
  return new Vector3(x, elevation, y)
}

/**
 * 층 위의 점 (x, y) 에서 h 만큼 위의 월드 좌표. 층 원점(floorOrigin)을 더하는
 * 곳은 여기 하나뿐이다 — 층을 옆으로 미는 모드(stair)가 있으므로 높이만
 * 더해서는 안 된다.
 */
export function worldAt(scene: Scene, floorId: string, x: number, y: number, h: number, mode: LayoutMode): Vector3 {
  const o = floorOrigin(scene, floorId, mode)
  return toBabylon(x + o.dx, y + o.dy, o.elev + h)
}

/** 모든 층·구역·설비를 담는 상자. 전체보기와 카메라 거리 계산에 쓴다 */
export function sceneBounds(scene: Scene, mode: LayoutMode): { min: Vector3; max: Vector3 } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  let minY = 0, maxY = 0
  for (const sec of scene.sections) {
    const [x, y, w, h] = sec.rect
    // 층 원점은 평행이동뿐이라 rect 의 두 모서리가 곧 월드 상자의 두 모서리다
    const a = worldAt(scene, sec.floor, x, y, 0, mode)
    const b = worldAt(scene, sec.floor, x + w, y + h, 0, mode)
    minX = Math.min(minX, a.x); maxX = Math.max(maxX, b.x)
    minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, b.z)
    minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y)
  }
  for (const e of scene.equipment) {
    const sec = scene.sections.find((s) => s.id === e.section)
    if (!sec) continue
    maxY = Math.max(maxY, floorOrigin(scene, sec.floor, mode).elev + equipmentHeight(e))
  }
  if (!Number.isFinite(minX)) return { min: new Vector3(0, 0, 0), max: new Vector3(40, 6, 25) }
  return { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) }
}

/** 컨베이어 벨트면 높이. 바닥에 붙어 있으면 물건이 바닥을 미끄러지는 것처럼 보인다 */
export const BELT_Y = 0.8

/**
 * 구간의 월드 점열. 리프트는 출발점에서 올라가는 세로 기둥 다음 도착 층의
 * 가로 구간이고, 평면 구간은 from → via… → to 의 폴리라인이다.
 */
export function segmentPoints(scene: Scene, seg: Segment, mode: LayoutMode): Vector3[] {
  const start = worldAt(scene, seg.from.floor, seg.from.x, seg.from.y, BELT_Y, mode)
  const end = worldAt(scene, seg.to.floor, seg.to.x, seg.to.y, BELT_Y, mode)
  if (isLift(seg)) {
    // 스펙은 리프트를 "두 층을 잇는 세로 기둥" 으로 규정한다(구성 요소 표, 완료 기준 10).
    // 두 끝을 그냥 직선으로 이으면 데모 씬의 lift-1 처럼 수평 33m·수직 6m 인
    // 경우 2도짜리 사면이 돼서 옆 컨베이어와 구별이 안 된다 — 층을 잇는다는
    // 것이 화면에서 읽히지 않는다. 출발점에서 수직으로 올린 뒤 도착 층에서 보낸다.
    // 기둥은 출발 층 자리에서 도착 층 높이까지 곧게 선다. stair 모드에서는
    // 도착 층이 옆으로 밀려 있으므로 거기서 가로 구간이 층 사이 틈을 건넌다.
    const pts = [start, new Vector3(start.x, end.y, start.z)]
    // 수직으로만 올라가는 리프트면 가로 구간을 더하지 않는다 — 길이 0 인 구간을
    // 넣으면 CreateTube 가 법선을 못 구해 메시가 깨진다. 씬 좌표가 아니라 월드
    // 좌표로 비교한다 — stair 에서는 x, y 가 같은 리프트도 층 원점이 다르다.
    if (end.x !== start.x || end.z !== start.z) pts.push(end)
    return pts
  }
  return [
    start,
    ...(seg.via ?? []).map(([x, y]) => worldAt(scene, seg.from.floor, x, y, BELT_Y, mode)),
    end,
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
