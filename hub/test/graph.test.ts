import { test } from "node:test"
import assert from "node:assert/strict"
import { downstream, topoOrder } from "../../shared/graph.ts"
import type { Scene, Segment } from "../../shared/types.ts"

/** 끝점은 일부러 아무렇게나 둔다 — 연결은 next 만 본다 */
const seg = (id: string, next?: string[]): Segment => ({
  id, label: id, section: "a",
  from: { floor: "1F", x: 0, y: 0 }, to: { floor: "1F", x: 1, y: 0 },
  ...(next && { next }),
})
const scene = (segments: Segment[]) => ({ segments }) as unknown as Scene

test("하류는 next 그대로, 없으면 빈 배열", () => {
  const d = downstream(scene([seg("a", ["b", "c"]), seg("b"), seg("c", [])]))
  assert.deepEqual(d.get("a"), ["b", "c"])
  assert.deepEqual(d.get("b"), [])
  assert.deepEqual(d.get("c"), [])
})

test("끝점이 같아도 next 가 없으면 안 이어진다 — 좌표로 추론하지 않는다", () => {
  const a: Segment = { ...seg("a"), to: { floor: "1F", x: 5, y: 5 } }
  const b: Segment = { ...seg("b"), from: { floor: "1F", x: 5, y: 5 } }
  assert.deepEqual(downstream(scene([a, b])).get("a"), [])
})

test("위상 순서는 상류가 먼저", () => {
  const topo = topoOrder(downstream(scene([seg("c"), seg("a", ["b"]), seg("b", ["c"])])))
  assert.deepEqual(topo, { order: ["a", "b", "c"] })
})

test("순환이면 순서 대신 순환과 그 하류의 id 를 준다", () => {
  // a → b → c → b (b·c 순환), c → d (순환의 하류)
  const topo = topoOrder(downstream(scene([seg("a", ["b"]), seg("b", ["c"]), seg("c", ["b", "d"]), seg("d")])))
  assert.deepEqual(topo, { cycle: ["b", "c", "d"] })
})

test("없는 id 를 가리키는 연결은 순서를 막지 않는다 — 검증기가 따로 잡는다", () => {
  assert.deepEqual(topoOrder(downstream(scene([seg("a", ["ghost"])]))), { order: ["a"] })
})
