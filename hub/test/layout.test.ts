import { test } from "node:test"
import assert from "node:assert/strict"
import { floorOrigin, STAIR_GAP, STAIR_RISE } from "../../shared/layout.ts"
import { floorElevation } from "../../shared/types.ts"
import { loadScene } from "../src/scene.ts"
import type { Scene } from "../../shared/types.ts"

const small = loadScene(new URL("../../scene.json", import.meta.url).pathname)

/** 층 5개, 구역이 X 0~300 을 덮는 씬 */
function five(): Scene {
  const floors = [1, 2, 3, 4, 5].map((o) => ({ id: `${o}F`, label: `${o}층`, order: o, elevation: (o - 1) * 45 }))
  return {
    ...small, floors,
    sections: floors.flatMap((f) => [
      { id: `${f.id}-a`, label: "A", floor: f.id, rect: [0, 0, 100, 200] as [number, number, number, number], cameras: [] },
      { id: `${f.id}-b`, label: "B", floor: f.id, rect: [100, 0, 200, 200] as [number, number, number, number], cameras: [] },
    ]),
  }
}

test("stack 은 옆으로 안 밀고 높이는 floorElevation 그대로 — 리팩터링 전과 같은 화면", () => {
  for (const s of [small, five()])
    for (const f of s.floors)
      assert.deepEqual(floorOrigin(s, f.id, "stack"), { dx: 0, dy: 0, elev: floorElevation(s, f.id) })
})

test("stair 는 층 순서대로 (−x, +y) 로 한 칸씩 밀고 올린다", () => {
  const s = five()
  const step = 300 + STAIR_GAP
  for (const f of s.floors) {
    const r = f.order - 1
    assert.deepEqual(floorOrigin(s, f.id, "stair"), { dx: -r * step, dy: r * step, elev: r * STAIR_RISE })
  }
})

test("stair 에서 어느 두 층도 X 범위가 겹치지 않는다", () => {
  const s = five()
  const ranges = s.floors.map((f) => {
    const { dx } = floorOrigin(s, f.id, "stair")
    return [dx, dx + 300] as const
  }).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i - 1][1] < ranges[i][0], `${i} 번째 층이 겹친다`)
})

test("stair 순번은 order 의 정렬 순위다 — order 가 0 인 지하층이나 번호가 건너뛰어도 음수로 안 밀린다", () => {
  const s: Scene = { ...small, floors: [
    { id: "3F", label: "3층", order: 3 }, { id: "B1", label: "지하", order: 0 }, { id: "1F", label: "1층", order: 1 },
  ] }
  assert.equal(floorOrigin(s, "B1", "stair").elev, 0)
  assert.equal(floorOrigin(s, "1F", "stair").elev, STAIR_RISE)
  assert.equal(floorOrigin(s, "3F", "stair").elev, 2 * STAIR_RISE)
})

test("없는 층은 원점", () => {
  assert.deepEqual(floorOrigin(five(), "9F", "stair"), { dx: 0, dy: 0, elev: 0 })
})
