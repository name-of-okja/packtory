import { test } from "node:test"
import assert from "node:assert/strict"
import { MockAdapter, type MockOptions } from "../src/adapters/mock.ts"
import { loadScene } from "../src/scene.ts"
import { derive, type SegMemory, type ValueMap } from "../src/derive.ts"
import type { Scene, SegState, Value } from "../../shared/types.ts"

const small = loadScene(new URL("../../scene.json", import.meta.url).pathname)
const large = loadScene(new URL("../../scene.large.json", import.meta.url).pathname)

/**
 * 모의 어댑터와 진짜 derive 를 가짜 시계로 돌린다. 매 틱 콜백에 상태표를 준다.
 * derive 는 허브처럼 500ms 마다 돈다.
 */
function simulate(scene: Scene, seconds: number, opts: MockOptions,
  each?: (t: number, states: Map<string, SegState>, counters: Map<string, Value>) => void) {
  let clock = 0
  const adapter = new MockAdapter(scene, { ...opts, now: () => clock })
  const values: ValueMap = new Map()
  const counters = new Map<string, Value>()
  const states = new Map<string, SegState>()
  let mem = new Map<string, SegMemory>()
  for (let t = 0; t <= seconds * 1000; t += 100) {
    clock = t
    adapter.tick((tag, v) => { values.set(tag, { v, q: "good" }); counters.set(tag, v) })
    if (t % 500 === 0) {
      const { tags, next } = derive(scene.segments, values, mem, t, scene.stallSec)
      mem = next
      for (const tv of tags) if (tv.tag.endsWith(".state")) states.set(tv.tag.slice(0, -6), tv.v as SegState)
    }
    each?.(t, states, counters)
  }
  return { states, counters }
}

/** 합류 s1, s2 → m → x. m 을 막으면 s1·s2 는 차서 stalled, x 는 굶어 idle */
function merge(): Scene {
  const seg = (id: string, fx: number, fy: number, tx: number, ty: number, next?: string[]) => ({
    id, label: id, section: "a", capacity: 8,
    from: { floor: "1F", x: fx, y: fy }, to: { floor: "1F", x: tx, y: ty },
    ...(next && { next }),
  })
  return {
    version: 4, name: "t", stallSec: 10,
    floors: [{ id: "1F", label: "1층", order: 1 }],
    sections: [{ id: "a", label: "A", floor: "1F", rect: [0, 0, 100, 100], cameras: [] }],
    equipment: [],
    segments: [seg("s1", 0, 10, 20, 20, ["m"]), seg("s2", 0, 30, 20, 20, ["m"]), seg("m", 20, 20, 40, 20, ["x"]), seg("x", 40, 20, 60, 20)],
    cameras: [],
  }
}

test("모든 구간에 in/out 카운터를 내보낸다", () => {
  const { counters } = simulate(large, 1, {})
  for (const seg of large.segments) {
    assert.ok(counters.has(`${seg.id}.in`), `${seg.id}.in 이 없다`)
    assert.ok(counters.has(`${seg.id}.out`), `${seg.id}.out 이 없다`)
  }
})

test("장비 태그도 내보낸다", () => {
  const { counters } = simulate(small, 1, {})
  assert.equal(typeof counters.get("filler-1.speed"), "number")
  assert.equal(typeof counters.get("filler-1.temp"), "number")
})

test("state·wip 태그를 직접 쓰지 않는다 — 판정 코드가 데모에서 실행되어야 한다", () => {
  const { counters } = simulate(small, 5, {})
  for (const tag of counters.keys())
    assert.ok(!tag.endsWith(".state") && !tag.endsWith(".wip"), `모의 어댑터가 ${tag} 를 직접 썼다`)
})

test("막힘이 없으면 대형 씬 10분 동안 stalled 가 한 번도 없다 — 랜덤만으로 빨강이 생기면 안 된다", () => {
  const seen = new Set<string>()
  simulate(large, 600, { blocks: [] }, (_t, states) => {
    for (const [id, st] of states) if (st === "stalled") seen.add(id)
  })
  assert.deepEqual([...seen], [])
})

test("합류 아래를 막으면 두 상류가 stalled, 전용 하류가 idle 이 된다", () => {
  const { states } = simulate(merge(), 60, { blocks: [{ id: "m", fromMs: 5_000, toMs: 90_000 }], dockBreaks: false })
  assert.equal(states.get("m"), "stalled")
  assert.equal(states.get("s1"), "stalled")
  assert.equal(states.get("s2"), "stalled")
  assert.equal(states.get("x"), "idle")
})

test("막힘이 풀리면 곧 전부 running 으로 돌아온다", () => {
  const { states } = simulate(merge(), 75, { blocks: [{ id: "m", fromMs: 5_000, toMs: 60_000 }], dockBreaks: false })
  for (const id of ["s1", "s2", "m", "x"]) assert.equal(states.get(id), "running", `${id} 가 안 돌아왔다`)
})

test("분기 한쪽이 막혀도 다른 쪽으로 흘러 상류는 멈추지 않는다", () => {
  const s = merge()
  // s1 이 m 과 y 로 갈라지게 바꾼다
  s.segments[0].next = ["m", "y"]
  s.segments.push({ id: "y", label: "y", section: "a", capacity: 8,
    from: { floor: "1F", x: 20, y: 20 }, to: { floor: "1F", x: 20, y: 50 } })
  const { states } = simulate(s, 60, { blocks: [{ id: "m", fromMs: 5_000, toMs: 90_000 }], dockBreaks: false })
  assert.equal(states.get("s1"), "running")
  assert.equal(states.get("y"), "running")
})

test("물건은 사라지지도 늘지도 않는다: 들어온 총량 = 나간 총량 + 전체 WIP", () => {
  const { counters } = simulate(large, 300, {})
  const n = (tag: string) => counters.get(tag) as number
  let inSrc = 0, outSink = 0, wip = 0
  const fed = new Set(large.segments.flatMap((a) => a.next ?? []))
  const feeds = new Set(large.segments.filter((a) => (a.next ?? []).length > 0).map((a) => a.id))
  for (const g of large.segments) {
    if (!fed.has(g.id)) inSrc += n(`${g.id}.in`)
    if (!feeds.has(g.id)) outSink += n(`${g.id}.out`)
    wip += n(`${g.id}.in`) - n(`${g.id}.out`)
  }
  assert.ok(inSrc > 1000, `유입이 너무 적다: ${inSrc}`)
  assert.equal(inSrc, outSink + wip)
})

test("같은 시드면 같은 카운터 열, 다른 시드면 다른 열", () => {
  const a = simulate(large, 200, { seed: 7 }).counters
  const b = simulate(large, 200, { seed: 7 }).counters
  const c = simulate(large, 200, { seed: 8 }).counters
  assert.deepEqual([...a], [...b])
  assert.notDeepEqual([...a], [...c])
})

test("대형 씬을 기본 각본으로 돌리면 빨강과 회색이 둘 다 나온다 — 데모의 중심 장면", () => {
  const stalled = new Set<string>(), idle = new Set<string>()
  simulate(large, 240, {}, (_t, states) => {
    for (const [id, st] of states) { if (st === "stalled") stalled.add(id); if (st === "idle") idle.add(id) }
  })
  assert.ok(stalled.size >= 3, `stalled 가 ${stalled.size}개 — 막힘이 상류로 번지지 않았다`)
  assert.ok(idle.size >= 1, "idle 이 한 번도 없다")
})

test("작은 씬은 이어진 체인이라 막힘이 상류로 번진다", () => {
  const { states } = simulate(small, 60, { blocks: [{ id: "conv-3", fromMs: 5_000, toMs: 90_000 }], dockBreaks: false })
  assert.equal(states.get("conv-3"), "stalled")
  assert.equal(states.get("lift-1"), "stalled")
  assert.equal(states.get("conv-5"), "idle")
})

test("구간 연결에 순환이 있으면 알아볼 수 있는 에러로 죽는다", () => {
  const s = merge()
  // x → back → m → x
  s.segments.find((g) => g.id === "x")!.next = ["back"]
  s.segments.push({ id: "back", label: "back", section: "a", next: ["m"],
    from: { floor: "1F", x: 60, y: 20 }, to: { floor: "1F", x: 20, y: 20 } })
  assert.throws(() => new MockAdapter(s), /순환이 있다: m, x, back/)
})
