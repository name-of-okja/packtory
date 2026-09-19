import { test } from "node:test"
import assert from "node:assert/strict"
import { MockAdapter } from "../src/adapters/mock.ts"
import { loadScene } from "../src/scene.ts"
import type { TagValue, Value } from "../../shared/types.ts"

const scene = loadScene(new URL("../../scene.json", import.meta.url).pathname)

/** 100ms 틱을 기다리지 않고 시계를 직접 돌린다 */
function run(seconds: number) {
  let clock = 0
  const seen = new Map<string, Value>()
  const adapter = new MockAdapter(scene, { now: () => clock })
  const emit = (tag: string, v: Value) => { seen.set(tag, v) }
  for (let t = 0; t <= seconds * 1000; t += 100) {
    clock = t
    adapter.tick(emit)
  }
  return seen
}

test("모든 구간에 in/out 카운터를 내보낸다", () => {
  const seen = run(1)
  for (const seg of scene.segments) {
    assert.ok(seen.has(`${seg.id}.in`), `${seg.id}.in 이 없다`)
    assert.ok(seen.has(`${seg.id}.out`), `${seg.id}.out 이 없다`)
  }
})

test("장비 태그도 내보낸다", () => {
  const seen = run(1)
  assert.ok(typeof seen.get("filler-1.speed") === "number")
  assert.ok(typeof seen.get("filler-1.temp") === "number")
})

test("카운터는 단조 증가한다", () => {
  let clock = 0
  const adapter = new MockAdapter(scene, { now: () => clock })
  let last = -1
  let violated = false
  const emit = (tag: string, v: Value) => {
    if (tag !== "conv-1.in") return
    if ((v as number) < last) violated = true
    last = v as number
  }
  for (let t = 0; t <= 20_000; t += 100) { clock = t; adapter.tick(emit) }
  assert.equal(violated, false)
  assert.ok(last > 0, "카운터가 전혀 안 올랐다")
})

test("막힘 구간에서는 out 이 멈추고 in 은 계속 오른다 — 판정은 derive 가 하게 둔다", () => {
  // BLOCK_PLAN: conv-3 은 120초 주기의 30~90초에서 out 정지
  const at40 = run(40)
  const at80 = run(80)
  assert.equal(at40.get("conv-3.out"), at80.get("conv-3.out"), "막힌 동안 out 이 움직였다")
  assert.ok(
    (at80.get("conv-3.in") as number) > (at40.get("conv-3.in") as number),
    "막힌 동안 in 이 안 올랐다 — 그러면 WIP가 안 차서 stalled 가 안 뜬다",
  )
})

test("막힘이 풀리면 out 이 다시 오른다", () => {
  const at80 = run(80)
  const at110 = run(110)
  assert.ok((at110.get("conv-3.out") as number) > (at80.get("conv-3.out") as number))
})

test("state 태그를 직접 쓰지 않는다 — 판정 코드가 데모에서 실행되어야 한다", () => {
  const seen = run(60)
  for (const tag of seen.keys()) {
    assert.ok(!tag.endsWith(".state"), `모의 어댑터가 ${tag} 를 직접 썼다`)
    assert.ok(!tag.endsWith(".wip"), `모의 어댑터가 ${tag} 를 직접 썼다`)
  }
})
