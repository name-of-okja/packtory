import { test } from "node:test"
import assert from "node:assert/strict"
import { downstream, topoOrder } from "../../shared/graph.ts"
import type { Scene, Segment } from "../../shared/types.ts"

const seg = (id: string, from: [string, number, number], to: [string, number, number]): Segment => ({
  id, label: id, section: "a",
  from: { floor: from[0], x: from[1], y: from[2] }, to: { floor: to[0], x: to[1], y: to[2] },
})
const scene = (segments: Segment[]) => ({ segments }) as unknown as Scene

test("끝점이 같으면 이어지고 다르면 안 이어진다", () => {
  const d = downstream(scene([seg("a", ["1F", 0, 0], ["1F", 10, 0]), seg("b", ["1F", 10, 0], ["1F", 20, 0]), seg("c", ["1F", 10, 1], ["1F", 20, 1])]))
  assert.deepEqual(d.get("a"), ["b"])
  assert.deepEqual(d.get("b"), [])
  assert.deepEqual(d.get("c"), [])
})

test("층이 다르면 같은 좌표라도 안 이어진다", () => {
  const d = downstream(scene([seg("a", ["1F", 0, 0], ["1F", 10, 0]), seg("b", ["2F", 10, 0], ["2F", 20, 0])]))
  assert.deepEqual(d.get("a"), [])
})

test("리프트는 도착 층의 구간으로 이어진다", () => {
  const d = downstream(scene([seg("lift", ["1F", 5, 5], ["2F", 5, 5]), seg("up", ["2F", 5, 5], ["2F", 9, 5])]))
  assert.deepEqual(d.get("lift"), ["up"])
})

test("분기는 하류가 여럿, 합류는 여러 구간이 같은 하류를 가진다", () => {
  const d = downstream(scene([
    seg("s1", ["1F", 0, 0], ["1F", 5, 5]), seg("s2", ["1F", 0, 9], ["1F", 5, 5]),
    seg("m1", ["1F", 5, 5], ["1F", 9, 5]), seg("m2", ["1F", 5, 5], ["1F", 5, 9]),
  ]))
  assert.deepEqual(d.get("s1"), ["m1", "m2"])
  assert.deepEqual(d.get("s2"), ["m1", "m2"])
})

test("위상 순서는 상류가 먼저, 순환이면 null", () => {
  const chain = [seg("a", ["1F", 0, 0], ["1F", 1, 0]), seg("b", ["1F", 1, 0], ["1F", 2, 0]), seg("c", ["1F", 2, 0], ["1F", 3, 0])]
  assert.deepEqual(topoOrder(downstream(scene([chain[2], chain[0], chain[1]]))), ["a", "b", "c"])
  const loop = [...chain, seg("back", ["1F", 3, 0], ["1F", 0, 0])]
  assert.equal(topoOrder(downstream(scene(loop))), null)
})
