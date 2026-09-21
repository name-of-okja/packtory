import { test } from "node:test"
import assert from "node:assert/strict"
import { validateScene, loadScene } from "../src/scene.ts"
import { floorElevation, equipmentHeight, equipmentShape } from "../../shared/types.ts"
import type { Scene } from "../../shared/types.ts"

/** 검증을 통과하는 최소 씬. 각 테스트가 여기서 한 군데씩 망가뜨린다. */
function base(): Scene {
  return {
    version: 3,
    name: "t",
    stallSec: 10,
    floors: [{ id: "1F", label: "1층", order: 1 }],
    sections: [
      { id: "a", label: "A", floor: "1F", rect: [0, 0, 10, 10], cameras: ["c1"] },
    ],
    equipment: [
      { id: "eq1", label: "E", section: "a", pos: [5, 5], size: [2, 2], tags: [] },
    ],
    segments: [
      { id: "sg1", label: "S", section: "a",
        from: { floor: "1F", x: 6, y: 5 }, to: { floor: "1F", x: 9, y: 5 } },
    ],
    cameras: [{ id: "c1", label: "C", stream: "c1" }],
  }
}

test("정상 씬은 에러가 없다", () => {
  const { errors } = validateScene(base())
  assert.deepEqual(errors, [])
})

test("규칙1: 없는 층을 가리키는 섹션", () => {
  const s = base()
  s.sections[0].floor = "9F"
  assert.match(validateScene(s).errors.join("\n"), /없는 층 9F/)
})

test("규칙1: 없는 카메라를 가리키는 섹션", () => {
  const s = base()
  s.sections[0].cameras = ["nope"]
  assert.match(validateScene(s).errors.join("\n"), /없는 카메라 nope/)
})

test("규칙2: 장비와 구간이 태그 네임스페이스를 공유하므로 이름이 겹치면 에러", () => {
  const s = base()
  s.segments[0].id = "eq1"
  assert.match(validateScene(s).errors.join("\n"), /태그 네임스페이스/)
})

test("규칙3: 장비가 섹션 rect 밖이면 에러", () => {
  const s = base()
  s.equipment[0].pos = [9.5, 5] // 폭 2 → 오른쪽 끝 10.5 > 10
  assert.match(validateScene(s).errors.join("\n"), /영역 밖/)
})

test("규칙4: 같은 층 섹션이 겹치면 에러, 변끼리 닿는 것은 통과", () => {
  const touching = base()
  touching.sections.push({ id: "b", label: "B", floor: "1F", rect: [10, 0, 10, 10], cameras: [] })
  assert.deepEqual(validateScene(touching).errors, [])

  const overlapping = base()
  overlapping.sections.push({ id: "b", label: "B", floor: "1F", rect: [9, 0, 10, 10], cameras: [] })
  assert.match(validateScene(overlapping).errors.join("\n"), /겹친다/)
})

test("규칙5: 시작과 끝이 같은 구간은 에러", () => {
  const s = base()
  s.segments[0].to = { floor: "1F", x: 6, y: 5 }
  assert.match(validateScene(s).errors.join("\n"), /같은 좌표/)
})

test("규칙6: 미참조 카메라는 경고이지 에러가 아니다", () => {
  const s = base()
  s.cameras.push({ id: "c2", label: "C2", stream: "c2" })
  const { errors, warnings } = validateScene(s)
  assert.deepEqual(errors, [])
  assert.match(warnings.join("\n"), /c2/)
})

test("구간 좌표는 섹션 rect를 벗어나도 된다", () => {
  const s = base()
  s.segments[0].to = { floor: "1F", x: 99, y: 5 }
  assert.deepEqual(validateScene(s).errors, [])
})

test("실제 데모 씬이 검증을 통과한다", () => {
  const scene = loadScene(new URL("../../scene.json", import.meta.url).pathname)
  assert.equal(scene.version, 3)
  assert.equal(scene.segments.length, 4)
})

test("규칙7: elevation 이 order 순으로 단조 증가하지 않으면 에러", () => {
  const s = base()
  s.floors = [
    { id: "1F", label: "1층", order: 1, elevation: 10 },
    { id: "2F", label: "2층", order: 2, elevation: 4 },
  ]
  assert.match(validateScene(s).errors.join("\n"), /elevation/)
})

test("규칙7: elevation 이 없으면 검사하지 않는다", () => {
  const s = base()
  s.floors = [
    { id: "1F", label: "1층", order: 1 },
    { id: "2F", label: "2층", order: 2 },
  ]
  // 1F 만 참조하므로 나머지 규칙도 통과해야 한다
  assert.deepEqual(validateScene(s).errors, [])
})

test("규칙8: 설비가 위층 바닥을 뚫으면 경고이지 에러가 아니다", () => {
  const s = base()
  s.floors = [
    { id: "1F", label: "1층", order: 1, elevation: 0 },
    { id: "9F", label: "윗층", order: 2, elevation: 3 },
  ]
  s.equipment[0].height = 5 // 3m 위층 바닥을 뚫는다
  const { errors, warnings } = validateScene(s)
  assert.deepEqual(errors, [])
  assert.match(warnings.join("\n"), /위층/)
})

test("규칙8: height 가 0 이하면 에러", () => {
  const s = base()
  s.equipment[0].height = 0
  assert.match(validateScene(s).errors.join("\n"), /height/)
})

test("version 이 3 이 아니면 로드가 실패한다", () => {
  assert.throws(
    () => loadScene(new URL("./fixtures/v1.json", import.meta.url).pathname),
    /version 3/,
  )
})

test("기본값 헬퍼", () => {
  const s = base()
  s.floors = [
    { id: "1F", label: "1층", order: 1 },
    { id: "2F", label: "2층", order: 2 },
  ]
  // elevation 이 없으면 (order - 1) × 6
  assert.equal(floorElevation(s, "1F"), 0)
  assert.equal(floorElevation(s, "2F"), 6)
  // height 가 없으면 2, shape 가 없으면 box
  assert.equal(equipmentHeight(s.equipment[0]), 2)
  assert.equal(equipmentShape(s.equipment[0]), "box")
})
