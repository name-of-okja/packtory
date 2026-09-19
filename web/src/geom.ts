import type { Equipment, Scene, Segment } from "../../shared/types.ts"

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null

const MARGIN = 2 // 미터

/** 그 층 섹션들을 다 담는 사각형 + 여백 */
export function floorBounds(scene: Scene, floorId: string): Bounds {
  const rects = scene.sections.filter((s) => s.floor === floorId).map((s) => s.rect)
  if (rects.length === 0) return { minX: 0, minY: 0, maxX: 40, maxY: 25 }
  return {
    minX: Math.min(...rects.map((r) => r[0])) - MARGIN,
    minY: Math.min(...rects.map((r) => r[1])) - MARGIN,
    maxX: Math.max(...rects.map((r) => r[0] + r[2])) + MARGIN,
    maxY: Math.max(...rects.map((r) => r[1] + r[3])) + MARGIN,
  }
}

/**
 * 씬 좌표는 평면도 기준으로 Y가 위쪽인데 SVG는 아래쪽이다.
 * 뒤집지 않으면 지도가 상하 거울상이 되어 도면과 안 맞는다.
 * 변환은 이 함수 한 군데서만 한다.
 */
export function toSvgY(y: number, b: Bounds): number {
  return b.minY + b.maxY - y
}

/** 같은 층 구간의 폴리라인. 리프트(층이 다름)는 경로가 없으므로 null. */
export function segmentPath(seg: Segment, b: Bounds): string | null {
  if (seg.from.floor !== seg.to.floor) return null
  const pts: [number, number][] = [
    [seg.from.x, seg.from.y],
    ...(seg.via ?? []),
    [seg.to.x, seg.to.y],
  ]
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${toSvgY(y, b)}`).join(" ")
}

/** 경로 길이 (미터). 애니메이션 속도를 구간마다 같게 맞추는 데 쓴다. */
export function pathLength(seg: Segment): number {
  if (seg.from.floor !== seg.to.floor) return 1
  const pts: [number, number][] = [
    [seg.from.x, seg.from.y],
    ...(seg.via ?? []),
    [seg.to.x, seg.to.y],
  ]
  let len = 0
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return Math.max(len, 0.1)
}

/** 장비의 SVG 사각형 [x, y, w, h] */
export function equipmentRect(e: Equipment, b: Bounds): [number, number, number, number] {
  return [e.pos[0] - e.size[0] / 2, toSvgY(e.pos[1] + e.size[1] / 2, b), e.size[0], e.size[1]]
}
