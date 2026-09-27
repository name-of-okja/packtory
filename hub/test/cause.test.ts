import { test } from "node:test"
import assert from "node:assert/strict"
import { classify, withCause } from "../src/cause.ts"
import { MockAdapter } from "../src/adapters/mock.ts"
import { derive, type SegMemory, type ValueMap } from "../src/derive.ts"
import { loadScene } from "../src/scene.ts"
import { downstream, topoOrder } from "../../shared/graph.ts"
import type { SegState, TagValue } from "../../shared/types.ts"

/** "a>b,c" 꼴의 연결을 받아 classify 를 돌린다. 순서는 적은 순서대로(상류가 먼저) */
function run(links: string[], states: Record<string, SegState>, stall: Record<string, number> = {}, full: string[] = []) {
  const down = new Map<string, string[]>()
  for (const l of links) {
    const [id, to] = l.split(">")
    down.set(id, to ? to.split(",") : [])
  }
  const order = [...down.keys()]
  const r = classify(down, order, new Map(Object.entries(states)), new Map(Object.entries(stall)), new Set(full))
  return (id: string) => r.get(id)!
}

test("체인: 끝의 정지만 원인, 그 상류는 영향이고 root 가 끝을 가리킨다", () => {
  const c = run(["a>b", "b>c", "c"], { a: "stalled", b: "stalled", c: "stalled" })
  assert.deepEqual(c("c"), { state: "stalled", root: "" })
  assert.deepEqual(c("b"), { state: "blocked", root: "c" })
  assert.deepEqual(c("a"), { state: "blocked", root: "c" })
})

test("하류가 running 이면 원인이다 — 하류에 여지가 있는데 못 내보낸다", () => {
  const c = run(["a>b", "b"], { a: "stalled", b: "running" })
  assert.equal(c("a").state, "stalled")
})

test("하류가 꽉 찬 채 running 이면 영향이고, 그 아래의 원인을 물려받는다", () => {
  // a → b(꽉 참, 조금씩 움직임) → c(막힘). 합류점 아래에서 흔하다
  const c = run(["a>b", "b>c", "c"], { a: "stalled", b: "running", c: "stalled" }, {}, ["b"])
  assert.deepEqual(c("a"), { state: "blocked", root: "c" })
  assert.deepEqual(c("b"), { state: "running", root: "" }, "꽉 찬 running 은 초록 그대로")
})

test("꽉 찬 running 아래에 원인이 없으면 영향이되 root 는 비어 있다 — 정체일 뿐 고장이 아니다", () => {
  const c = run(["a>b", "b>c", "c"], { a: "stalled", b: "running", c: "running" }, {}, ["b"])
  assert.deepEqual(c("a"), { state: "blocked", root: "" })
})

test("합류: 두 상류가 같은 원인을 기다린다", () => {
  const c = run(["s1>m", "s2>m", "m>x", "x"], { s1: "stalled", s2: "stalled", m: "stalled", x: "idle" })
  assert.deepEqual(c("m"), { state: "stalled", root: "" })
  assert.deepEqual(c("s1"), { state: "blocked", root: "m" })
  assert.deepEqual(c("s2"), { state: "blocked", root: "m" })
})

test("분기 한쪽만 멈췄으면 상류는 원인 — 다른 쪽으로 보낼 수 있는데 못 보낸다", () => {
  const c = run(["a>b,y", "b", "y"], { a: "stalled", b: "stalled", y: "running" })
  assert.equal(c("a").state, "stalled")
})

test("하류가 idle 인데 꽉 찬 채 멈췄으면 원인 — 고장은 그 사이에 있다", () => {
  const c = run(["a>b", "b"], { a: "stalled", b: "idle" })
  assert.equal(c("a").state, "stalled")
})

test("하류가 unknown 이면 원인으로 둔다 — 센서가 끊긴 곳을 노랑 뒤에 숨기지 않는다", () => {
  const c = run(["a>b", "b"], { a: "stalled", b: "unknown" })
  assert.equal(c("a").state, "stalled")
})

test("출구가 멈췄으면 원인", () => {
  assert.equal(run(["a"], { a: "stalled" })("a").state, "stalled")
})

test("하류마다 원인이 다르면 더 오래 멈춘 원인을 root 로", () => {
  const c = run(["a>b,c", "b", "c"], { a: "stalled", b: "stalled", c: "stalled" }, { b: 20_000, c: 90_000 })
  assert.deepEqual(c("a"), { state: "blocked", root: "c" })
})

test("stalled 가 아닌 것은 그대로 둔다", () => {
  const c = run(["a>b", "b"], { a: "running", b: "stalled" })
  assert.deepEqual(c("a"), { state: "running", root: "" })
})

test("withCause: state 를 바꾸고 구간마다 root 태그를 더한다", () => {
  const tv = (tag: string, v: TagValue["v"]): TagValue => ({ tag, v, ts: 1, q: "good" })
  const out = withCause(
    [tv("a.wip", 8), tv("a.state", "stalled"), tv("a.stallMs", 30_000),
     tv("b.wip", 8), tv("b.state", "stalled"), tv("b.stallMs", 40_000)],
    new Map([["a", ["b"]], ["b", []]]), ["a", "b"], new Map([["a", 8], ["b", 8]]),
  )
  const get = (tag: string) => out.find((t) => t.tag === tag)?.v
  assert.equal(get("a.state"), "blocked")
  assert.equal(get("a.root"), "b")
  assert.equal(get("b.state"), "stalled")
  assert.equal(get("b.root"), "")
  assert.equal(get("a.wip"), 8, "다른 태그는 그대로")
})

/**
 * 정답 대조 (스펙 8장). 전파 mock 은 자기가 어디를 막았는지 안다. 대형 씬을 20분
 * 돌리며 매 판정(0.5초)마다 둘을 본다:
 *  ① 지금 막힌 구간이 stalled 면 원인이다 — 단, 그 막힌 구간이 다른 막힘의 상류면
 *     영향으로 보이는 것이 알려진 한계다.
 *  ② 원인은 지금 막힌 구간이거나, 풀린 지 stallSec 이내인 막힘의 상류뿐이다.
 *
 * 카운터만으로는 가를 수 없는 순간이 드물게 있다: 정체된 합류점에서 몫을 못 받는
 * 상류와 진짜로 멈춘 구간은 둘 다 "out 이 안 변하고 하류는 꽉 찬 채 조금씩 움직인다".
 * 실측으로 20분·원인 판정 약 4000번에 0~4번, 전부 판정 한 번(0.5초)짜리였다. 그래서
 * 오판은 원인 판정의 0.5% 이하, 그리고 **같은 구간이 두 번 잇달아 틀리지 않는다**
 * (깜빡임이지 계속 켜진 가짜 빨강이 아니다)를 요구한다.
 */
test("정답 대조: 대형 씬 20분, 원인 판정이 mock 이 막은 곳과 맞는다", () => {
  const scene = loadScene(new URL("../../scene.large.json", import.meta.url).pathname)
  const down = downstream(scene)
  const topo = topoOrder(down)
  assert.ok("order" in topo)
  const order = topo.order
  const capacity = new Map(scene.segments.map((g) => [g.id, g.capacity ?? 20]))
  const up = new Map<string, string[]>(order.map((id) => [id, []]))
  for (const [id, ds] of down) for (const d of ds) up.get(d)!.push(id)
  const ancestorsMemo = new Map<string, Set<string>>()
  const ancestors = (id: string) => {
    let a = ancestorsMemo.get(id)
    if (a) return a
    a = new Set<string>()
    const stack = [...up.get(id)!]
    while (stack.length) { const u = stack.pop()!; if (!a.has(u)) { a.add(u); stack.push(...up.get(u)!) } }
    ancestorsMemo.set(id, a)
    return a
  }

  let clock = 0
  const adapter = new MockAdapter(scene, { now: () => clock })
  const values: ValueMap = new Map()
  let mem = new Map<string, SegMemory>()
  const releasedAt = new Map<string, number>()
  let prevBlocked = new Set<string>()
  const wrong: string[] = []
  // 직전 판정에서 틀린 구간들 — 두 번 잇달아 틀리면 깜빡임이 아니다
  let wrongPrev = new Set<string>()
  const sticky: string[] = []
  let roots = 0, blockedSeen = 0

  for (let t = 0; t <= 20 * 60_000; t += 100) {
    clock = t
    adapter.tick((tag, v) => values.set(tag, { v, q: "good" }))
    if (t % 500 !== 0) continue
    const blockedNow = new Set(adapter.blockedNow())
    for (const id of prevBlocked) if (!blockedNow.has(id)) releasedAt.set(id, t)
    prevBlocked = blockedNow

    const d = derive(scene.segments, values, mem, t, scene.stallSec)
    mem = d.next
    const out = withCause(d.tags, down, order, capacity)
    const st = new Map(out.filter((x) => x.tag.endsWith(".state")).map((x) => [x.tag.slice(0, -6), x.v as SegState]))
    const upstreamOfAnyBlock = (id: string) => [...blockedNow].some((b) => ancestors(b).has(id))
    const recentlyReleasedUpstream = (id: string) => [...releasedAt]
      .some(([b, at]) => t - at <= scene.stallSec * 1000 && (b === id || ancestors(b).has(id)))

    const wrongNow = new Set<string>()
    for (const b of blockedNow) {
      if (st.get(b) === "blocked" && !upstreamOfAnyBlock(b)) { wrong.push(`${t}ms ①: 막힌 ${b} 가 영향으로 판정`); wrongNow.add(b) }
    }
    for (const [id, s] of st) {
      if (s === "stalled") {
        roots++
        if (!blockedNow.has(id) && !recentlyReleasedUpstream(id)) { wrong.push(`${t}ms ②: 막힘과 무관한 ${id} 가 원인`); wrongNow.add(id) }
      }
      if (s === "blocked") blockedSeen++
    }
    for (const id of wrongNow) if (wrongPrev.has(id)) sticky.push(`${t}ms: ${id} 가 두 번 잇달아 틀렸다`)
    wrongPrev = wrongNow
  }
  assert.ok(roots > 100 && blockedSeen > 500, `막힘이 제대로 안 번졌다: 원인 ${roots}, 영향 ${blockedSeen}`)
  assert.deepEqual(sticky, [])
  assert.ok(wrong.length <= roots * 0.005, `오판 ${wrong.length} / 원인 판정 ${roots}:\n${wrong.slice(0, 10).join("\n")}`)
})
