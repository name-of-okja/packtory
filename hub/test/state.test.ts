import { test } from "node:test"
import assert from "node:assert/strict"
import { lampVisibleFar } from "../../web/src/state.ts"

test("멀리서도 정지와 불명 신호등은 선다 — 센서가 끊긴 구간이 전체보기에서 사라지면 안 된다", () => {
  assert.equal(lampVisibleFar("stalled"), true)
  assert.equal(lampVisibleFar("unknown"), true)
  assert.equal(lampVisibleFar("running"), false)
  assert.equal(lampVisibleFar("idle"), false)
})
