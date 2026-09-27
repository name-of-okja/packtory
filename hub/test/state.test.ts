import { test } from "node:test"
import assert from "node:assert/strict"
import { affectedCounts, badgeText, badgeTone, idleBarText, lampVisibleFar, sectionSummary, segRoot } from "../../web/src/state.ts"
import type { Scene, TagValue, Value } from "../../shared/types.ts"

/** 구간 셋(a·b 는 구역 A, c 는 구역 B)과 구역 둘 */
const scene = {
  sections: [{ id: "A" }, { id: "B" }],
  segments: [{ id: "a", section: "A" }, { id: "b", section: "A" }, { id: "c", section: "B" }],
} as unknown as Scene

function vals(tags: Record<string, Value>): Map<string, TagValue> {
  return new Map(Object.entries(tags).map(([tag, v]) => [tag, { tag, v, ts: 0, q: "good" }]))
}

test("멀리서도 정지와 불명 신호등은 선다 — 센서가 끊긴 구간이 전체보기에서 사라지면 안 된다", () => {
  assert.equal(lampVisibleFar("stalled"), true)
  assert.equal(lampVisibleFar("unknown"), true)
  assert.equal(lampVisibleFar("blocked"), true)
  assert.equal(lampVisibleFar("running"), false)
  assert.equal(lampVisibleFar("idle"), false)
})

test("segRoot: .root 태그, 없으면 빈 문자열", () => {
  assert.equal(segRoot("a", vals({ "a.root": "c" })), "c")
  assert.equal(segRoot("a", vals({})), "")
})

test("affectedCounts: 원인마다 그 원인을 기다리는 영향 구간 수", () => {
  const n = affectedCounts(scene, vals({
    "a.state": "blocked", "a.root": "c",
    "b.state": "blocked", "b.root": "c",
    "c.state": "stalled", "c.root": "",
  }))
  assert.deepEqual([...n], [["c", 2]])
})

test("affectedCounts: root 가 빈 영향(원인 없는 정체)은 세지 않는다", () => {
  assert.equal(affectedCounts(scene, vals({ "a.state": "blocked", "a.root": "" })).size, 0)
})

test("sectionSummary: 구역마다 원인·영향 수, 빈 구역도 0 으로", () => {
  const m = sectionSummary(scene, vals({ "a.state": "stalled", "b.state": "blocked", "c.state": "running" }))
  assert.deepEqual(m.get("A"), { stalled: 1, blocked: 1 })
  assert.deepEqual(m.get("B"), { stalled: 0, blocked: 0 })
})

test("badgeText·badgeTone: 원인 있음 / 영향만 / 정상", () => {
  assert.equal(badgeText("3층 B구역", { stalled: 1, blocked: 4 }), "3층 B구역 · 정지 1 · 영향 4")
  assert.equal(badgeText("3층 B구역", { stalled: 1, blocked: 0 }), "3층 B구역 · 정지 1")
  assert.equal(badgeText("2층 A구역", { stalled: 0, blocked: 6 }), "2층 A구역 · 영향 6")
  assert.equal(badgeText("3층 C구역", { stalled: 0, blocked: 0 }), "3층 C구역 · 정상")
  assert.equal(badgeTone({ stalled: 1, blocked: 4 }), "stalled")
  assert.equal(badgeTone({ stalled: 0, blocked: 6 }), "blocked")
  assert.equal(badgeTone({ stalled: 0, blocked: 0 }), "ok")
})

test("idleBarText: 원인이 없을 때 막대 문구 — 영향이 남아 있으면 '정상 가동' 이라 하지 않는다", () => {
  assert.equal(idleBarText(scene, vals({ "a.state": "running", "b.state": "idle" })), "정상 가동")
  assert.equal(idleBarText(scene, vals({ "a.state": "blocked", "a.root": "", "b.state": "blocked" })), "정체 2구간 · 원인 없음")
})
