import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { generate } from "../../tools/gen-scene.ts"
import { validateScene } from "../src/scene.ts"
import { downstream, topoOrder } from "../../shared/graph.ts"
import type { Scene } from "../../shared/types.ts"

const SEEDS = [1, 2, 3, 42]

function upstream(down: Map<string, string[]>) {
  const up = new Map<string, string[]>([...down.keys()].map((id) => [id, []]))
  for (const [id, ds] of down) for (const d of ds) up.get(d)!.push(id)
  return up
}
function reach(starts: string[], next: Map<string, string[]>) {
  const seen = new Set(starts)
  const stack = [...starts]
  while (stack.length) for (const n of next.get(stack.pop()!)!) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  return seen
}

for (const seed of SEEDS) {
  const s: Scene = generate(seed)
  const down = downstream(s)
  const up = upstream(down)

  test(`seed ${seed}: 검증 에러 0`, () => {
    assert.deepEqual(validateScene(s).errors, [])
  })

  test(`seed ${seed}: 규모 — 5층, 구간 400~500, 설비 250~350`, () => {
    assert.equal(s.floors.length, 5)
    assert.ok(s.segments.length >= 400 && s.segments.length <= 500, `구간 ${s.segments.length}`)
    assert.ok(s.equipment.length >= 250 && s.equipment.length <= 350, `설비 ${s.equipment.length}`)
  })

  test(`seed ${seed}: 순환 없음`, () => {
    assert.ok("order" in topoOrder(down))
  })

  test(`seed ${seed}: 모든 구간이 source 에서 닿고 sink 로 빠진다`, () => {
    const sources = s.segments.filter((g) => up.get(g.id)!.length === 0).map((g) => g.id)
    const sinks = s.segments.filter((g) => down.get(g.id)!.length === 0).map((g) => g.id)
    assert.equal(sources.length, 10, "입고 도크 8 + 연결 브리지 2")
    assert.equal(sinks.length, 4, "출고 도크 4")
    assert.equal(reach(sources, down).size, s.segments.length, "source 에서 안 닿는 구간이 있다")
    assert.equal(reach(sinks, up).size, s.segments.length, "sink 로 안 빠지는 구간이 있다")
  })

  test(`seed ${seed}: next 는 실재 구간을 가리키고, 이어진 두 구간의 끝점이 같다`, () => {
    const byId = new Map(s.segments.map((g) => [g.id, g]))
    for (const g of s.segments)
      for (const n of g.next ?? []) {
        const h = byId.get(n)
        assert.ok(h, `${g.id} → 없는 ${n}`)
        assert.deepEqual(h.from, g.to, `${g.id} → ${n} 끝점이 떨어져 있다`)
      }
  })

  test(`seed ${seed}: 합류·분기 차수 3 이하`, () => {
    for (const [id, ds] of down) assert.ok(ds.length <= 3, `${id} 분기 ${ds.length}`)
    for (const [id, us] of up) assert.ok(us.length <= 3, `${id} 합류 ${us.length}`)
  })
}

test("같은 시드 → 같은 출력, 다른 시드 → 다른 출력", () => {
  assert.equal(JSON.stringify(generate(1)), JSON.stringify(generate(1)))
  assert.notEqual(JSON.stringify(generate(1)), JSON.stringify(generate(2)))
})

test("커밋된 scene.large.json 은 seed 1 의 출력과 같다 — 생성기를 고치고 다시 안 돌린 채 커밋하면 걸린다", () => {
  const committed = readFileSync(new URL("../../scene.large.json", import.meta.url), "utf8")
  assert.equal(committed, JSON.stringify(generate(1), null, 2) + "\n")
})
