import { test } from "node:test"
import assert from "node:assert/strict"
import { MockAdapter } from "../src/adapters/mock.ts"
import { loadScene } from "../src/scene.ts"
import { derive, type SegMemory, type ValueMap } from "../src/derive.ts"
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

test("굶주림 구간(conv-5)은 in 이 멈추고 in == out 이 되어 구간이 빈다 — idle 의 전제조건", () => {
  // STARVE_PLAN: conv-5 는 120초 주기의 40~95초에서 in 정지
  const at40 = run(40)
  const at60 = run(60)
  assert.equal(at40.get("conv-5.in"), at60.get("conv-5.in"), "굶주린 동안 in 이 움직였다")
  assert.equal(
    at60.get("conv-5.in"), at60.get("conv-5.out"),
    "in 이 멈췄는데 out 이 못 따라가 구간이 안 비었다 — 그러면 wip > 0 로 남아 idle 이 아니라 stalled 로 보인다",
  )
})

test("state 태그를 직접 쓰지 않는다 — 판정 코드가 데모에서 실행되어야 한다", () => {
  const seen = run(60)
  for (const tag of seen.keys()) {
    assert.ok(!tag.endsWith(".state"), `모의 어댑터가 ${tag} 를 직접 썼다`)
    assert.ok(!tag.endsWith(".wip"), `모의 어댑터가 ${tag} 를 직접 썼다`)
  }
})

/**
 * 완료 기준 8 의 합격 신호(스펙 §11) — "빨갛게 꽉 찬 conv-3 과 회색으로 텅
 * 빈 conv-5 가 나란히" 뜨는 겹침이 실제로 존재하는지. BLOCK_PLAN·STARVE_PLAN·
 * BLOCK_CYCLE_S·DRAIN_FACTOR·rateOf·scene.json 의 stallSec, mock.ts 의
 * out ≤ in 상한 중 하나만 바뀌어도 이 겹침이 사라질 수 있는데, 그 중 어느
 * 것도 이 사실 자체를 단언하지 않으면 회귀를 아무도 못 잡는다 — 이 테스트가
 * 유일하게 "데모의 중심 장면"을 코드로 지킨다.
 *
 * MockAdapter.tick() 과 실제 derive() 를 가짜 시계로 220초 돌려 매 틱마다
 * conv-3.state/conv-5.state 를 살펴본다. 실측 겹침 창은 50.0s~90.0s(1주기)와
 * 170.0s~210.0s(2주기) — 120초 주기가 그대로 반복되는지까지 확인한다.
 */
test("conv-3 이 stalled 이면서 conv-5 가 idle 인 겹침이 20초 이상 있고, 다음 주기에도 반복된다", () => {
  let clock = 0
  const adapter = new MockAdapter(scene, { now: () => clock })
  const values: ValueMap = new Map()
  let mem = new Map<string, SegMemory>()
  const overlapSec = new Set<number>()

  for (let t = 0; t <= 220_000; t += 100) {
    clock = t
    adapter.tick((tag, v) => values.set(tag, { v, q: "good" }))
    const { tags, next } = derive(scene.segments, values, mem, clock, scene.stallSec)
    mem = next
    for (const tv of tags) values.set(tv.tag, { v: tv.v, q: tv.q })

    const conv3 = tags.find((tv) => tv.tag === "conv-3.state")?.v
    const conv5 = tags.find((tv) => tv.tag === "conv-5.state")?.v
    if (conv3 === "stalled" && conv5 === "idle") overlapSec.add(Math.floor(t / 1000))
  }

  const overlapDurationIn = (fromSec: number, toSec: number) =>
    [...overlapSec].filter((s) => s >= fromSec && s < toSec).length

  const cycle1 = overlapDurationIn(50, 90)
  const cycle2 = overlapDurationIn(170, 210)
  assert.ok(cycle1 >= 20, `1주기(50~90s) 겹침이 20초 미만이다: ${cycle1}s`)
  assert.ok(cycle2 >= 20, `2주기(170~210s) 겹침이 20초 미만이다: ${cycle2}s`)
})
