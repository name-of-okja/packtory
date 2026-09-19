import { test } from "node:test"
import assert from "node:assert/strict"
import { derive, type SegMemory, type ValueMap } from "../src/derive.ts"
import type { Segment, TagValue } from "../../shared/types.ts"

const SEG: Segment = {
  id: "c1", label: "C", section: "a",
  from: { floor: "1F", x: 0, y: 0 }, to: { floor: "1F", x: 10, y: 0 },
}

function vals(inV: number, outV: number, q: "good" | "bad" = "good"): ValueMap {
  return new Map([
    ["c1.in", { v: inV, q }],
    ["c1.out", { v: outV, q }],
  ])
}

function pick(tags: TagValue[], key: string) {
  return tags.find((t) => t.tag === `c1.${key}`)!
}

const STALL = 10 // 초

test("첫 관측은 기준선만 잡고 running 으로 시작한다", () => {
  const { tags, next } = derive([SEG], vals(100, 90), new Map(), 1000, STALL)
  assert.equal(pick(tags, "state").v, "running")
  assert.equal(pick(tags, "wip").v, 10)
  assert.equal(pick(tags, "stallMs").v, 0)
  assert.deepEqual(next.get("c1"), { lastIn: 100, lastOut: 90, lastOutChangeTs: 1000 })
})

test("out 이 증가하면 running 을 유지하고 정지 시계를 리셋한다", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 1000 }]])
  const { tags, next } = derive([SEG], vals(105, 95), prev, 50_000, STALL)
  assert.equal(pick(tags, "state").v, "running")
  assert.equal(next.get("c1")!.lastOutChangeTs, 50_000)
})

test("out 정체 + wip > 0 + stallSec 경과 → stalled, stallMs 는 경과시간", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 1000 }]])
  const { tags } = derive([SEG], vals(130, 90), prev, 1000 + 192_000, STALL)
  assert.equal(pick(tags, "state").v, "stalled")
  assert.equal(pick(tags, "wip").v, 40)
  assert.equal(pick(tags, "stallMs").v, 192_000)
})

test("out 정체 + wip == 0 → idle 이지 stalled 가 아니다", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 90, lastOut: 90, lastOutChangeTs: 1000 }]])
  const { tags } = derive([SEG], vals(90, 90), prev, 1000 + 60_000, STALL)
  assert.equal(pick(tags, "state").v, "idle")
  assert.equal(pick(tags, "wip").v, 0)
  assert.equal(pick(tags, "stallMs").v, 0)
})

test("stallSec 이 지나기 전에는 정체해도 running", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 1000 }]])
  const { tags } = derive([SEG], vals(100, 90), prev, 1000 + 9_999, STALL)
  assert.equal(pick(tags, "state").v, "running")
})

test("정지가 이어지면 stallMs 가 누적된다", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 0 }]])
  const a = derive([SEG], vals(100, 90), prev, 20_000, STALL)
  const b = derive([SEG], vals(100, 90), a.next, 20_500, STALL)
  assert.equal(pick(a.tags, "stallMs").v, 20_000)
  assert.equal(pick(b.tags, "stallMs").v, 20_500)
})

test("센서 품질이 bad 면 unknown 이고 파생 태그도 bad 로 나간다", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 0 }]])
  const { tags } = derive([SEG], vals(100, 90, "bad"), prev, 20_000, STALL)
  assert.equal(pick(tags, "state").v, "unknown")
  assert.equal(pick(tags, "state").q, "bad")
  assert.equal(pick(tags, "wip").v, 0)
})

test("값이 아예 없으면 unknown", () => {
  const { tags } = derive([SEG], new Map(), new Map(), 1000, STALL)
  assert.equal(pick(tags, "state").v, "unknown")
})

test("counterMax 없이 카운터가 역행하면 PLC 재기동으로 보고 재기준선을 잡는다", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 1000, lastOut: 990, lastOutChangeTs: 0 }]])
  const { tags, next } = derive([SEG], vals(5, 3), prev, 20_000, STALL)
  assert.equal(pick(tags, "state").v, "unknown")
  assert.deepEqual(next.get("c1"), { lastIn: 5, lastOut: 3, lastOutChangeTs: 20_000 })
})

test("counterMax 가 있으면 랩어라운드를 정상 델타로 처리하고 wip 도 맞는다", () => {
  const seg: Segment = { ...SEG, counterMax: 32767 }
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 32_700, lastOut: 32_690, lastOutChangeTs: 0 }]])
  // in 은 32700 → 5 (68개 통과), out 은 32690 → 32700 (10개 통과)
  const { tags } = derive([seg], vals(5, 32_700), prev, 5_000, STALL)
  assert.equal(pick(tags, "state").v, "running") // out 이 늘었으므로
  // wip = (5 - 32700) mod 32768 = 73
  assert.equal(pick(tags, "wip").v, 73)
})

test("wipOffset 이 WIP 영점을 보정한다", () => {
  const seg: Segment = { ...SEG, wipOffset: -8 }
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 0 }]])
  const { tags } = derive([seg], vals(100, 90), prev, 1_000, STALL)
  assert.equal(pick(tags, "wip").v, 2)
})

test("WIP 는 음수가 되지 않는다", () => {
  const seg: Segment = { ...SEG, wipOffset: -100 }
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 100, lastOut: 90, lastOutChangeTs: 0 }]])
  const { tags } = derive([seg], vals(100, 90), prev, 1_000, STALL)
  assert.equal(pick(tags, "wip").v, 0)
})
