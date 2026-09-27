import type { Scene } from "./types.ts"
import { floorElevation } from "./types.ts"

/** 층을 늘어놓는 방식. stack = 제자리에 벌려 쌓기(기본), stair = 옆으로도 밀어 계단처럼 */
export type LayoutMode = "stack" | "stair"

/** 계단 배치에서 이웃한 층 사이의 가로 틈 (미터) */
export const STAIR_GAP = 20
/** 계단 배치에서 한 층 오를 때마다 높아지는 만큼 (미터) */
export const STAIR_RISE = 10

/**
 * 층의 원점 — 층 위의 점 (x, y) 는 (x + dx, y + dy) 에, 높이 elev 에 놓인다.
 * **층을 어디에 그릴지는 여기서만 정한다.** 지오메트리·신호등·물건·라벨·
 * 피킹·flyTo 가 전부 이것을 거쳐야 모드를 바꿔도 서로 어긋나지 않는다.
 *
 * stair 의 순번은 order 의 정렬 순위다(스펙의 order − 1 은 order 가 1 부터
 * 빈틈없을 때 이것과 같다). order 가 0 인 지하층이나 번호가 건너뛴 층이 있어도
 * 층끼리 겹치거나 음수 쪽으로 밀리지 않는다.
 */
export function floorOrigin(scene: Scene, floorId: string, mode: LayoutMode): { dx: number; dy: number; elev: number } {
  if (mode === "stack") return { dx: 0, dy: 0, elev: floorElevation(scene, floorId) }
  const rank = [...scene.floors].sort((a, b) => a.order - b.order).findIndex((f) => f.id === floorId)
  if (rank < 0) return { dx: 0, dy: 0, elev: 0 }
  // 층 가로폭은 모든 구역을 덮는 X 범위다. 층마다 달라도 가장 넓은 것으로
  // 한 칸을 잡아야 어느 층끼리도 겹치지 않는다.
  let minX = Infinity, maxX = -Infinity
  for (const s of scene.sections) {
    minX = Math.min(minX, s.rect[0])
    maxX = Math.max(maxX, s.rect[0] + s.rect[2])
  }
  const step = (Number.isFinite(minX) ? maxX - minX : 0) + STAIR_GAP
  // (−x, +y) 로 민다. 기본 시점(방위각 45°)에서 이 방향이 화면 오른쪽이라 층이
  // 1층부터 왼쪽→오른쪽으로 한 줄로 서고, STAIR_RISE 만큼씩 올라간다. +x 로 밀면
  // 화면 왼쪽 아래로 내려가 위층일수록 화면 아래에 그려진다 (실측). X 로 한 칸씩
  // 떨어지므로 어느 두 층도 겹치지 않는다.
  return { dx: -rank * step, dy: rank * step, elev: rank * STAIR_RISE }
}
