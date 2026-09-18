# packtory 물류 흐름 모니터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평면도 위에 물류 흐름을 애니메이션으로 그리고, 막힌 구간을 빨갛게 띄우고, 클릭하면 해당 구역 CCTV를 모달로 보여주는 웹 모니터를 만든다.

**Architecture:** 허브(Node)가 센서 카운터를 읽어 `wip`/`state`/`stallMs` 를 파생 태그로 계산해 WebSocket으로 밀고, 클라이언트(React + SVG)가 그 숫자로 점을 흘린다. 정지 판정은 이력이 필요하므로 서버, 점 애니메이션은 아무도 정확도를 안 따지므로 클라이언트(CSS)가 한다. 영상은 허브를 통과하지 않고 go2rtc에서 브라우저로 직결한다.

**Tech Stack:** Node 20, TypeScript, `tsx`(빌드 단계 없음), `ws`, `node --test`, Vite + React 18, SVG, CSS `offset-path`, go2rtc.

**Spec:** `docs/superpowers/specs/2026-09-19-packtory-flow-monitor-design.md`

## Global Constraints

- Node 20. 허브는 빌드하지 않고 `tsx` 로 TS를 직접 실행한다.
- 테스트 러너는 `node --test` (stdlib). **vitest/jest 등 테스트 프레임워크를 추가하지 않는다.**
- **테스트는 허브에만 붙인다.** 스펙 7장: "`derive.ts` 하나에만 붙인다. 나머지는 배선이라 테스트할 것이 없다." 웹 태스크(5~11)는 테스트 대신 **수동 검증 단계**를 갖는다 — 각 태스크에 무엇을 보고 무엇을 확인하는지 정확히 적혀 있다. 웹에 테스트 러너를 도입하지 않는다.
- 웹 프레임워크를 쓰지 않는다. 허브는 `node:http` + `ws` 뿐. 엔드포인트는 `GET /api/scene` 과 `GET /ws` 둘 + 정적 파일.
- 3D 라이브러리를 쓰지 않는다.
- 와이어 프로토콜을 바꾸지 않는다: `{ type: "snapshot" | "values", data: TagValue[] }`, `TagValue = { tag, v, ts, q }`.
- 읽기 전용. 쓰기 엔드포인트를 만들지 않는다.
- 씬 스키마는 `version: 2`. 다른 버전은 로드 시 에러.
- 고정 상수: `stallSec` 기본 10초 · derive 주기 500ms · 팬아웃 배치 100ms · WS 재접속 3초 · 구간당 점 최대 렌더 30개 · 모의 어댑터 틱 100ms.
- `prefers-reduced-motion` 을 존중한다.
- 코드 주석과 사용자 대면 문자열은 한국어로 쓴다 (기존 스펙과 동일).

---

## File Structure

```
packtory/
  shared/types.ts            씬 + 와이어 타입. 허브와 웹이 공유하는 유일한 파일
  scene.json                 데모 씬 (스펙 5장 예시 그대로)
  go2rtc.yaml                카메라 스트림 설정
  hub/
    package.json
    tsconfig.json
    src/
      scene.ts               씬 로드 + 검증 6규칙
      adapter.ts             Adapter 인터페이스
      adapters/mock.ts       모의 카운터 생성기
      derive.ts              정지 판정 (이 서버의 유일한 로직)
      cache.ts               마지막 값 보관 (스냅샷용)
      ws.ts                  WS 팬아웃 + 100ms 배치
      index.ts               조립 + HTTP + 정적 서빙
    test/
      scene.test.ts
      derive.test.ts
      fanout.test.ts
      mock.test.ts
  web/
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx                층 상태 + 선택 상태 보유
      scene.ts               GET /api/scene
      useValues.ts           WS 훅 (3초 재접속)
      geom.ts                좌표 변환 + 경로 생성 + 바운즈
      Map.tsx                SVG 지도, viewBox 팬/줌
      Segment.tsx            구간 선 + 점 + 리프트 마커
      FloorTabs.tsx          층 탭 + 상태 배지
      AlertBar.tsx           상단 이상 칩
      Modal.tsx              CCTV + 수치
      styles.css             상태색 + 흐름 애니메이션
```

`shared/types.ts` 는 허브와 웹 양쪽 `tsconfig.json` 의 `include` 에 들어가고 상대경로로 import한다. 워크스페이스 도구나 path alias를 쓰지 않는다 — 파일 하나를 공유하는 데 빌드 그래프를 들일 이유가 없다.

---

## Task 1: 공유 타입 + 씬 로더·검증기 + 데모 씬

**Files:**
- Create: `shared/types.ts`
- Create: `scene.json`
- Create: `hub/package.json`, `hub/tsconfig.json`, `.gitignore`
- Create: `hub/src/scene.ts`
- Test: `hub/test/scene.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `shared/types.ts` 의 모든 타입 — 이후 모든 태스크가 쓴다
  - `loadScene(path: string): Scene` — 검증 실패 시 throw
  - `validateScene(s: Scene): { errors: string[]; warnings: string[] }`

- [ ] **Step 1: 프로젝트 파일 생성**

`.gitignore`:
```
node_modules/
dist/
```

`hub/package.json`:
```json
{
  "name": "packtory-hub",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "node --test --import tsx ./test/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

`hub/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "../shared/**/*.ts"]
}
```

Run: `cd hub && npm install`

- [ ] **Step 2: 공유 타입 작성**

`shared/types.ts`:
```ts
export type Quality = "good" | "bad"
export type Value = number | string | boolean

export type TagValue = { tag: string; v: Value; ts: number; q: Quality }

export type WsMessage =
  | { type: "snapshot"; data: TagValue[] }
  | { type: "values"; data: TagValue[] }

export type SegState = "running" | "stalled" | "idle" | "unknown"

export type Floor = { id: string; label: string; order: number }

/** rect 는 [x, y, w, h]. 배경을 칠하고 라벨을 놓는 용도일 뿐 소속 판정에 쓰지 않는다. */
export type Section = {
  id: string
  label: string
  floor: string
  rect: [number, number, number, number]
  cameras: string[]
}

export type EquipmentTag = {
  key: string
  label: string
  unit?: string
  /** 있으면 임계, 없으면 경고 판정에서 제외 */
  warn?: number
}

export type Equipment = {
  id: string
  label: string
  section: string
  /** 중심점 */
  pos: [number, number]
  /** [w, h] */
  size: [number, number]
  tags: EquipmentTag[]
}

export type Endpoint = { floor: string; x: number; y: number }

/** from.floor !== to.floor 이면 리프트다. 별도 타입을 두지 않는다. */
export type Segment = {
  id: string
  label: string
  section: string
  from: Endpoint
  to: Endpoint
  via?: [number, number][]
  capacity?: number
  /** WIP 영점 보정. 구간을 비운 상태에서 -(in - out) 을 넣는다 */
  wipOffset?: number
  /** PLC 카운터 최대값. 있으면 모듈러로 델타를 구한다 */
  counterMax?: number
}

export type Camera = { id: string; label: string; stream: string }

export type Scene = {
  version: 2
  name: string
  stallSec: number
  floors: Floor[]
  sections: Section[]
  equipment: Equipment[]
  segments: Segment[]
  cameras: Camera[]
}

export type SceneResponse = { scene: Scene; go2rtcBase: string }

/** 구간이 리프트인가 */
export function isLift(seg: Segment): boolean {
  return seg.from.floor !== seg.to.floor
}
```

- [ ] **Step 3: 데모 씬 작성**

`scene.json` — 스펙 5장의 예시를 그대로 옮긴다. `packing` 에 카메라를 주지 않는 것과 `conv-5` 가 `packing` 소속이면서 `filling` 영역에서 시작하는 것은 의도된 것이다 (각각 완료 기준 12번, "구간은 섹션 경계를 넘어도 된다" 규칙의 예시).

```json
{
  "version": 2,
  "name": "데모 라인",
  "stallSec": 10,
  "floors": [
    { "id": "1F", "label": "1층", "order": 1 },
    { "id": "2F", "label": "2층", "order": 2 }
  ],
  "sections": [
    { "id": "inbound", "label": "입고부", "floor": "1F",
      "rect": [0, 0, 40, 25], "cameras": ["cam-in-1"] },
    { "id": "filling", "label": "충전부", "floor": "2F",
      "rect": [0, 0, 24, 25], "cameras": ["cam-fill-1", "cam-fill-2"] },
    { "id": "packing", "label": "포장부", "floor": "2F",
      "rect": [24, 0, 16, 25], "cameras": [] }
  ],
  "equipment": [
    { "id": "loader-1", "label": "적재기 1", "section": "inbound",
      "pos": [6, 12], "size": [4, 3], "tags": [] },
    { "id": "filler-1", "label": "충전기 1", "section": "filling",
      "pos": [6, 12], "size": [4, 3],
      "tags": [
        { "key": "speed", "label": "속도", "unit": "bpm", "warn": 250 },
        { "key": "temp", "label": "온도", "unit": "°C", "warn": 80 }
      ] },
    { "id": "capper-1", "label": "캡퍼 1", "section": "filling",
      "pos": [18, 12], "size": [3, 3], "tags": [] },
    { "id": "packer-1", "label": "포장기 1", "section": "packing",
      "pos": [30, 12], "size": [4, 3], "tags": [] }
  ],
  "segments": [
    { "id": "conv-1", "label": "입고 이송", "section": "inbound",
      "from": { "floor": "1F", "x": 8, "y": 12 },
      "to": { "floor": "1F", "x": 34, "y": 12 },
      "capacity": 24 },
    { "id": "lift-1", "label": "수직반송기 1", "section": "inbound",
      "from": { "floor": "1F", "x": 36, "y": 12 },
      "to": { "floor": "2F", "x": 3, "y": 12 },
      "capacity": 4 },
    { "id": "conv-3", "label": "충전 이송", "section": "filling",
      "from": { "floor": "2F", "x": 8, "y": 12 },
      "to": { "floor": "2F", "x": 16.5, "y": 12 },
      "capacity": 12, "wipOffset": 0 },
    { "id": "conv-5", "label": "포장 이송", "section": "packing",
      "from": { "floor": "2F", "x": 19.5, "y": 12 },
      "to": { "floor": "2F", "x": 28, "y": 12 },
      "via": [[23, 12], [23, 16]],
      "capacity": 12, "counterMax": 32767 }
  ],
  "cameras": [
    { "id": "cam-in-1", "label": "입고부 상부", "stream": "cam-in-1" },
    { "id": "cam-fill-1", "label": "충전기 상부", "stream": "cam-fill-1" },
    { "id": "cam-fill-2", "label": "캡퍼 측면", "stream": "cam-fill-2" }
  ]
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`hub/test/scene.test.ts`:
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { validateScene, loadScene } from "../src/scene.ts"
import type { Scene } from "../../shared/types.ts"

/** 검증을 통과하는 최소 씬. 각 테스트가 여기서 한 군데씩 망가뜨린다. */
function base(): Scene {
  return {
    version: 2,
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
  assert.equal(scene.version, 2)
  assert.equal(scene.segments.length, 4)
})

test("version이 2가 아니면 로드가 실패한다", () => {
  assert.throws(
    () => loadScene(new URL("./fixtures/v1.json", import.meta.url).pathname),
    /version 2/,
  )
})
```

`hub/test/fixtures/v1.json`:
```json
{ "version": 1, "name": "구버전", "stallSec": 10,
  "floors": [], "sections": [], "equipment": [], "segments": [], "cameras": [] }
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `cd hub && npm test`
Expected: FAIL — `Cannot find module '../src/scene.ts'`

- [ ] **Step 6: 씬 로더·검증기 구현**

`hub/src/scene.ts`:
```ts
import { readFileSync } from "node:fs"
import type { Scene, Section } from "../../shared/types.ts"

type Rect = [number, number, number, number]

/** 배열에서 두 번 이상 나온 값들 */
function dup(ids: string[]): string[] {
  const seen = new Set<string>()
  const out = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) out.add(id)
    seen.add(id)
  }
  return [...out]
}

/** 변끼리 닿는 것은 겹침이 아니다 (엄격 부등호) */
function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2]
    && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

export function validateScene(s: Scene): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const floorIds = new Set(s.floors.map((f) => f.id))
  const sectionIds = new Set(s.sections.map((x) => x.id))
  const cameraIds = new Set(s.cameras.map((c) => c.id))

  // 규칙2: id 중복
  for (const id of dup(s.floors.map((f) => f.id))) errors.push(`중복 층 id: ${id}`)
  for (const id of dup(s.sections.map((x) => x.id))) errors.push(`중복 섹션 id: ${id}`)
  for (const id of dup(s.cameras.map((c) => c.id))) errors.push(`중복 카메라 id: ${id}`)
  // 장비와 구간은 태그 네임스페이스 `{id}.{key}` 를 공유하므로 서로 간에도 겹치면 안 된다
  for (const id of dup([...s.equipment.map((e) => e.id), ...s.segments.map((g) => g.id)]))
    errors.push(`태그 네임스페이스 중복 id: ${id} (장비와 구간은 이름을 공유한다)`)

  // 규칙1: 참조 무결성
  for (const sec of s.sections) {
    if (!floorIds.has(sec.floor)) errors.push(`섹션 ${sec.id}: 없는 층 ${sec.floor}`)
    for (const c of sec.cameras)
      if (!cameraIds.has(c)) errors.push(`섹션 ${sec.id}: 없는 카메라 ${c}`)
  }
  for (const e of s.equipment)
    if (!sectionIds.has(e.section)) errors.push(`장비 ${e.id}: 없는 섹션 ${e.section}`)
  for (const g of s.segments) {
    if (!sectionIds.has(g.section)) errors.push(`구간 ${g.id}: 없는 섹션 ${g.section}`)
    if (!floorIds.has(g.from.floor)) errors.push(`구간 ${g.id}: 없는 층 ${g.from.floor}`)
    if (!floorIds.has(g.to.floor)) errors.push(`구간 ${g.id}: 없는 층 ${g.to.floor}`)
    // 규칙5
    if (g.from.floor === g.to.floor && g.from.x === g.to.x && g.from.y === g.to.y)
      errors.push(`구간 ${g.id}: 시작과 끝이 같은 좌표`)
  }

  // 규칙3: 장비가 소속 섹션 rect 안
  const secById = new Map<string, Section>(s.sections.map((x) => [x.id, x]))
  for (const e of s.equipment) {
    const sec = secById.get(e.section)
    if (!sec) continue
    const [rx, ry, rw, rh] = sec.rect
    const [cx, cy] = e.pos
    const [w, h] = e.size
    if (cx - w / 2 < rx || cx + w / 2 > rx + rw || cy - h / 2 < ry || cy + h / 2 > ry + rh)
      errors.push(`장비 ${e.id}: 섹션 ${sec.id} 영역 밖`)
  }

  // 규칙4: 같은 층 섹션끼리 겹침
  for (const f of s.floors) {
    const on = s.sections.filter((x) => x.floor === f.id)
    for (let i = 0; i < on.length; i++)
      for (let j = i + 1; j < on.length; j++)
        if (overlaps(on[i].rect, on[j].rect))
          errors.push(`섹션 ${on[i].id} 와 ${on[j].id} 가 ${f.id} 에서 겹친다`)
  }

  // 규칙6: 미참조 카메라 (경고)
  const used = new Set(s.sections.flatMap((x) => x.cameras))
  for (const c of s.cameras)
    if (!used.has(c.id)) warnings.push(`카메라 ${c.id} 를 아무 섹션도 쓰지 않는다`)

  return { errors, warnings }
}

export function loadScene(path: string): Scene {
  const s = JSON.parse(readFileSync(path, "utf8")) as Scene
  if (s.version !== 2) throw new Error(`씬 version 2 만 지원한다 (받음: ${s.version})`)
  const { errors, warnings } = validateScene(s)
  for (const w of warnings) console.warn(`씬 경고: ${w}`)
  if (errors.length) throw new Error(`씬 검증 실패:\n  ${errors.join("\n  ")}`)
  return s
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd hub && npm test`
Expected: PASS — 11 tests

Run: `cd hub && npm run typecheck`
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add shared scene.json hub .gitignore
git commit -m "feat: 공유 타입 + 씬 로더/검증기 + 데모 씬"
```

---

## Task 2: derive.ts — 정지 판정

**Files:**
- Create: `hub/src/derive.ts`
- Test: `hub/test/derive.test.ts`

**Interfaces:**
- Consumes: `Segment`, `TagValue`, `SegState`, `Value`, `Quality` from `shared/types.ts`
- Produces:
  - `type SegMemory = { lastIn: number; lastOut: number; lastOutChangeTs: number }`
  - `type ValueMap = Map<string, { v: Value; q: Quality }>`
  - `derive(segments: Segment[], values: ValueMap, prev: Map<string, SegMemory>, now: number, stallSec: number): { tags: TagValue[]; next: Map<string, SegMemory> }`

- [ ] **Step 1: 실패하는 테스트 작성**

`hub/test/derive.test.ts`:
```ts
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd hub && npm test`
Expected: FAIL — `Cannot find module '../src/derive.ts'`

- [ ] **Step 3: derive 구현**

`hub/src/derive.ts`:
```ts
import type { Quality, SegState, Segment, TagValue, Value } from "../../shared/types.ts"

export type SegMemory = {
  lastIn: number
  lastOut: number
  lastOutChangeTs: number
}

export type ValueMap = Map<string, { v: Value; q: Quality }>

/** WIP. counterMax 가 있으면 모듈러 산술로 구한다 — 랩어라운드 뒤에도 맞아야 하므로. */
function wipOf(seg: Segment, inN: number, outN: number): number {
  const raw = inN - outN + (seg.wipOffset ?? 0)
  if (seg.counterMax === undefined) return Math.max(0, raw)
  const m = seg.counterMax + 1
  return ((raw % m) + m) % m
}

/** 정상이면 델타(>= 0), 재기준선이 필요하면 null */
function delta(v: number, last: number, counterMax?: number): number | null {
  if (v >= last) return v - last
  if (counterMax !== undefined) {
    const m = counterMax + 1
    return (v - last + m) % m
  }
  return null // counterMax 를 모르는 채 역행 = PLC 재기동으로 간주
}

function emit(
  id: string, wip: number, state: SegState, stallMs: number, ts: number, q: Quality,
): TagValue[] {
  return [
    { tag: `${id}.wip`, v: wip, ts, q },
    { tag: `${id}.state`, v: state, ts, q },
    { tag: `${id}.stallMs`, v: stallMs, ts, q },
  ]
}

export function derive(
  segments: Segment[],
  values: ValueMap,
  prev: Map<string, SegMemory>,
  now: number,
  stallSec: number,
): { tags: TagValue[]; next: Map<string, SegMemory> } {
  const next = new Map(prev)
  const tags: TagValue[] = []

  for (const seg of segments) {
    const inV = values.get(`${seg.id}.in`)
    const outV = values.get(`${seg.id}.out`)

    const bad =
      !inV || !outV ||
      inV.q === "bad" || outV.q === "bad" ||
      typeof inV.v !== "number" || typeof outV.v !== "number"

    if (bad) {
      tags.push(...emit(seg.id, 0, "unknown", 0, now, "bad"))
      continue
    }

    const inN = inV.v as number
    const outN = outV.v as number
    const mem = prev.get(seg.id)

    // 첫 관측 (또는 허브 재기동 직후): 기준선만 잡는다.
    // stallSec 동안 running 으로 보이지만 스스로 복구되므로 디스크에 남기지 않는다.
    if (!mem) {
      next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs: now })
      tags.push(...emit(seg.id, wipOf(seg, inN, outN), "running", 0, now, "good"))
      continue
    }

    const dIn = delta(inN, mem.lastIn, seg.counterMax)
    const dOut = delta(outN, mem.lastOut, seg.counterMax)

    if (dIn === null || dOut === null) {
      next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs: now })
      tags.push(...emit(seg.id, 0, "unknown", 0, now, "bad"))
      continue
    }

    const lastOutChangeTs = dOut > 0 ? now : mem.lastOutChangeTs
    next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs })

    const wip = wipOf(seg, inN, outN)
    const since = now - lastOutChangeTs

    let state: SegState
    let stallMs: number
    if (since < stallSec * 1000) {
      state = "running"
      stallMs = 0
    } else if (wip > 0) {
      state = "stalled"
      stallMs = since
    } else {
      // 물건이 안 들어와서 안 도는 것은 사고가 아니다. 여기서 빨강을 쓰지 않는 것이
      // 이 제품의 값어치다 — 빨강이 흔해지면 아무도 화면을 안 본다.
      state = "idle"
      stallMs = 0
    }

    tags.push(...emit(seg.id, wip, state, stallMs, now, "good"))
  }

  return { tags, next }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd hub && npm test`
Expected: PASS — Task 1의 11개 + derive 12개

- [ ] **Step 5: 커밋**

```bash
git add hub/src/derive.ts hub/test/derive.test.ts
git commit -m "feat: 구간 정지 판정 (derive)"
```

---

## Task 3: 캐시 + WS 팬아웃 + HTTP 서버

**Files:**
- Create: `hub/src/cache.ts`, `hub/src/ws.ts`, `hub/src/adapter.ts`, `hub/src/index.ts`
- Test: `hub/test/fanout.test.ts`

**Interfaces:**
- Consumes: `loadScene` (Task 1), `derive`/`SegMemory`/`ValueMap` (Task 2)
- Produces:
  - `class Cache { set(t: TagValue): boolean; snapshot(): TagValue[]; values(): ValueMap }` — `set` 은 값이 바뀌었으면 `true`
  - `createFanout(cache: Cache): { add(ws: WebSocket): void; push(t: TagValue): void; stop(): void }`
  - `interface Adapter { start(emit: Emit): Promise<void>; stop(): Promise<void> }`
  - `type Emit = (tag: string, v: Value, ts: number, q?: Quality) => void`
  - `startHub(opts): Promise<{ port: number; close(): Promise<void> }>` — 테스트에서 포트 0으로 띄우기 위해 index.ts가 함수를 export한다

- [ ] **Step 1: 실패하는 테스트 작성**

`hub/test/fanout.test.ts`:
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import WebSocket from "ws"
import { startHub } from "../src/index.ts"
import type { Adapter, Emit } from "../src/adapter.ts"
import type { WsMessage, TagValue } from "../../shared/types.ts"

/** 테스트가 카운터를 직접 조종하는 가짜 어댑터 */
class FakeAdapter implements Adapter {
  emit!: Emit
  async start(emit: Emit) { this.emit = emit }
  async stop() {}
}

const SCENE = new URL("../../scene.json", import.meta.url).pathname

function nextMessage(ws: WebSocket, pred: (m: WsMessage) => boolean): Promise<WsMessage> {
  return new Promise((resolve) => {
    const on = (raw: Buffer) => {
      const m = JSON.parse(raw.toString()) as WsMessage
      if (pred(m)) { ws.off("message", on); resolve(m) }
    }
    ws.on("message", on)
  })
}

function tagOf(m: WsMessage, tag: string): TagValue | undefined {
  return m.data.find((t) => t.tag === tag)
}

test("접속하면 스냅샷을 받고, 스냅샷에 파생 태그가 들어있다", async () => {
  const fake = new FakeAdapter()
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x" })
  try {
    const now = Date.now()
    fake.emit("conv-3.in", 100, now)
    fake.emit("conv-3.out", 90, now)
    await new Promise((r) => setTimeout(r, 700)) // derive 500ms 주기가 한 번 돌기를 기다린다

    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    const snap = await nextMessage(ws, (m) => m.type === "snapshot")
    assert.equal(tagOf(snap, "conv-3.in")!.v, 100)
    assert.equal(tagOf(snap, "conv-3.wip")!.v, 10)
    assert.equal(tagOf(snap, "conv-3.state")!.v, "running")
    ws.close()
  } finally {
    await hub.close()
  }
})

test("값이 바뀌면 values 로 푸시하고, 안 바뀐 태그는 안 보낸다", async () => {
  const fake = new FakeAdapter()
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x" })
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    await nextMessage(ws, (m) => m.type === "snapshot")

    fake.emit("filler-1.temp", 77, Date.now())
    const msg = await nextMessage(ws, (m) => m.type === "values" && !!tagOf(m, "filler-1.temp"))
    assert.equal(tagOf(msg, "filler-1.temp")!.v, 77)
    ws.close()
  } finally {
    await hub.close()
  }
})

test("GET /api/scene 가 씬과 go2rtcBase 를 준다", async () => {
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: new FakeAdapter(), go2rtcBase: "http://cam:1984" })
  try {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/scene`)
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.go2rtcBase, "http://cam:1984")
    assert.equal(body.scene.version, 2)
  } finally {
    await hub.close()
  }
})

test("stallSec 이 지나면 stalled 로 바뀌고 stallMs 가 올라간다", async () => {
  const fake = new FakeAdapter()
  // stallSec 을 1초로 줄여 테스트를 빠르게 돌린다
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x", stallSecOverride: 1 })
  try {
    const now = Date.now()
    fake.emit("conv-3.in", 100, now)
    fake.emit("conv-3.out", 90, now) // wip 10, out 은 이후 안 움직인다

    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    await nextMessage(ws, (m) => m.type === "snapshot")

    const msg = await nextMessage(
      ws,
      (m) => m.type === "values" && tagOf(m, "conv-3.state")?.v === "stalled",
    )
    assert.ok((tagOf(msg, "conv-3.stallMs")!.v as number) >= 1000)
    ws.close()
  } finally {
    await hub.close()
  }
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd hub && npm test`
Expected: FAIL — `Cannot find module '../src/index.ts'`

- [ ] **Step 3: 어댑터 인터페이스와 캐시 구현**

`hub/src/adapter.ts`:
```ts
import type { Quality, Value } from "../../shared/types.ts"

export type Emit = (tag: string, v: Value, ts: number, q?: Quality) => void

export interface Adapter {
  start(emit: Emit): Promise<void>
  stop(): Promise<void>
}
```

`hub/src/cache.ts`:
```ts
import type { TagValue } from "../../shared/types.ts"
import type { ValueMap } from "./derive.ts"

/** 마지막 값만 메모리에 들고 있는다 (스냅샷 용도). 히스토리는 범위 밖. */
export class Cache {
  private m = new Map<string, TagValue>()

  /** 값이나 품질이 바뀌었으면 true — 팬아웃은 이때만 푸시한다 */
  set(t: TagValue): boolean {
    const old = this.m.get(t.tag)
    this.m.set(t.tag, t)
    return !old || old.v !== t.v || old.q !== t.q
  }

  snapshot(): TagValue[] {
    return [...this.m.values()]
  }

  /** derive 입력용 */
  values(): ValueMap {
    const out: ValueMap = new Map()
    for (const [tag, t] of this.m) out.set(tag, { v: t.v, q: t.q })
    return out
  }
}
```

- [ ] **Step 4: 팬아웃 구현**

`hub/src/ws.ts`:
```ts
import type { WebSocket } from "ws"
import type { TagValue } from "../../shared/types.ts"
import type { Cache } from "./cache.ts"

const BATCH_MS = 100

export function createFanout(cache: Cache) {
  const clients = new Set<WebSocket>()
  // 같은 태그가 한 배치 안에서 여러 번 바뀌면 마지막 것만 보낸다
  let pending = new Map<string, TagValue>()

  const timer = setInterval(() => {
    if (pending.size === 0 || clients.size === 0) {
      pending.clear()
      return
    }
    const payload = JSON.stringify({ type: "values", data: [...pending.values()] })
    pending.clear()
    for (const ws of clients) ws.send(payload)
  }, BATCH_MS)

  return {
    add(ws: WebSocket) {
      ws.send(JSON.stringify({ type: "snapshot", data: cache.snapshot() }))
      clients.add(ws)
      ws.on("close", () => clients.delete(ws))
      ws.on("error", () => clients.delete(ws))
    },
    push(t: TagValue) {
      pending.set(t.tag, t)
    },
    stop() {
      clearInterval(timer)
      for (const ws of clients) ws.close()
      clients.clear()
    },
  }
}
```

- [ ] **Step 5: 조립 + HTTP 서버 구현**

`hub/src/index.ts`:
```ts
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { WebSocketServer } from "ws"
import { loadScene } from "./scene.ts"
import { Cache } from "./cache.ts"
import { createFanout } from "./ws.ts"
import { derive, type SegMemory } from "./derive.ts"
import type { Adapter, Emit } from "./adapter.ts"
import { MockAdapter } from "./adapters/mock.ts"

const DERIVE_MS = 500

export type HubOptions = {
  scenePath: string
  port: number
  adapter: Adapter
  go2rtcBase: string
  /** 테스트 전용 — 씬의 stallSec 을 덮어쓴다 */
  stallSecOverride?: number
  /** 클라이언트 정적 파일 디렉터리. 없으면 정적 서빙을 안 한다 */
  webDir?: string
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
}

export async function startHub(opts: HubOptions) {
  const scene = loadScene(opts.scenePath)
  const stallSec = opts.stallSecOverride ?? scene.stallSec
  const cache = new Cache()
  const fanout = createFanout(cache)

  const emit: Emit = (tag, v, ts, q = "good") => {
    const tv = { tag, v, ts, q }
    if (cache.set(tv)) fanout.push(tv)
  }

  await opts.adapter.start(emit)

  // 값이 안 바뀌어도 돌아야 stallMs 가 올라간다 — 정지 시간은 아무 일도
  // 안 일어날 때 세는 숫자다.
  let mem = new Map<string, SegMemory>()
  const deriveTimer = setInterval(() => {
    const { tags, next } = derive(scene.segments, cache.values(), mem, Date.now(), stallSec)
    mem = next
    for (const t of tags) if (cache.set(t)) fanout.push(t)
  }, DERIVE_MS)

  const server = createServer(async (req, res) => {
    if (req.url === "/api/scene") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ scene, go2rtcBase: opts.go2rtcBase }))
      return
    }
    if (!opts.webDir) {
      res.writeHead(404).end()
      return
    }
    // 정적 파일. SPA 라우팅이 없으므로 없는 경로는 index.html 로 떨어뜨린다.
    const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "")
    const path = join(opts.webDir, rel === "/" ? "index.html" : rel)
    try {
      const buf = await readFile(path)
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
      res.end(buf)
    } catch {
      try {
        const buf = await readFile(join(opts.webDir, "index.html"))
        res.writeHead(200, { "content-type": MIME[".html"] }).end(buf)
      } catch {
        res.writeHead(404).end()
      }
    }
  })

  const wss = new WebSocketServer({ server, path: "/ws" })
  wss.on("connection", (ws) => fanout.add(ws))

  await new Promise<void>((resolve) => server.listen(opts.port, resolve))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : opts.port

  return {
    port,
    async close() {
      clearInterval(deriveTimer)
      fanout.stop()
      await opts.adapter.stop()
      wss.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// 직접 실행했을 때만 뜬다 (테스트에서 import 할 때는 안 뜬다)
if (import.meta.url === `file://${process.argv[1]}`) {
  const scenePath = process.env.SCENE ?? new URL("../../scene.json", import.meta.url).pathname
  const scene = loadScene(scenePath)
  const hub = await startHub({
    scenePath,
    port: Number(process.env.PORT ?? 8080),
    adapter: new MockAdapter(scene),
    go2rtcBase: process.env.GO2RTC_BASE ?? "http://127.0.0.1:1984",
    webDir: process.env.WEB_DIR,
  })
  console.log(`packtory-hub http://127.0.0.1:${hub.port}`)
}
```

`MockAdapter` 는 Task 4에서 만든다. 이 태스크를 먼저 통과시키려면 `hub/src/adapters/mock.ts` 에 아래 껍데기를 두고, Task 4에서 내용을 채운다:

```ts
import type { Scene } from "../../../shared/types.ts"
import type { Adapter, Emit } from "../adapter.ts"

export class MockAdapter implements Adapter {
  constructor(private scene: Scene) {}
  async start(_emit: Emit) {}
  async stop() {}
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd hub && npm test`
Expected: PASS — 이전 23개 + fanout 4개

Run: `cd hub && npm run typecheck`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add hub/src hub/test/fanout.test.ts
git commit -m "feat: 값 캐시 + WS 팬아웃 + HTTP 서버"
```

---

## Task 4: 모의 어댑터

**Files:**
- Create: `hub/src/adapters/mock.ts` (Task 3의 껍데기를 채운다)
- Test: `hub/test/mock.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `Emit` (Task 3), `Scene`, `Segment` (Task 1)
- Produces: `class MockAdapter implements Adapter` — 생성자 `(scene: Scene, opts?: { now?: () => number })`

- [ ] **Step 1: 실패하는 테스트 작성**

`hub/test/mock.test.ts`:
```ts
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd hub && npm test`
Expected: FAIL — `adapter.tick is not a function`

- [ ] **Step 3: 모의 어댑터 구현**

`hub/src/adapters/mock.ts`:
```ts
import type { Scene, Segment, Value } from "../../../shared/types.ts"
import type { Adapter, Emit } from "../adapter.ts"

const TICK_MS = 100

/**
 * 데모 각본. 120초 주기로 conv-3 의 out 을 30~90초 동안 멈춘다.
 * 판정 로직을 흉내내지 않고 원인만 만든다 — out 이 멈추면 WIP가 차오르면서
 * 진짜 derive.ts 가 stalled 를 판정한다. 여기서 state 를 직접 쓰면
 * 판정 코드는 데모에서 한 번도 실행되지 않는다.
 */
const BLOCK_PLAN: Record<string, [number, number]> = {
  "conv-3": [30, 90],
}
const BLOCK_CYCLE_S = 120

/** 구간별 목표 처리량 (개/초) */
function rateOf(seg: Segment): number {
  return seg.id.startsWith("lift") ? 0.5 : 2
}

type Counter = { in: number; out: number; accIn: number; accOut: number }

export class MockAdapter implements Adapter {
  private counters = new Map<string, Counter>()
  private timer?: NodeJS.Timeout
  private now: () => number

  constructor(private scene: Scene, opts?: { now?: () => number }) {
    const t0 = Date.now()
    this.now = opts?.now ?? (() => Date.now() - t0)
    for (const seg of scene.segments)
      this.counters.set(seg.id, { in: 0, out: 0, accIn: 0, accOut: 0 })
  }

  private isBlocked(segId: string, elapsedMs: number): boolean {
    const plan = BLOCK_PLAN[segId]
    if (!plan) return false
    const phase = (elapsedMs / 1000) % BLOCK_CYCLE_S
    return phase >= plan[0] && phase < plan[1]
  }

  /** 한 틱. 테스트가 시계를 직접 돌릴 수 있도록 public. */
  tick(emit: Emit) {
    const elapsed = this.now()
    const ts = Date.now()

    for (const seg of this.scene.segments) {
      const c = this.counters.get(seg.id)!
      const per = rateOf(seg) * (TICK_MS / 1000)

      c.accIn += per
      const wIn = Math.floor(c.accIn)
      c.in += wIn
      c.accIn -= wIn

      if (!this.isBlocked(seg.id, elapsed)) {
        c.accOut += per
        const wOut = Math.floor(c.accOut)
        c.out += wOut
        c.accOut -= wOut
      }

      // counterMax 가 있으면 실제 PLC처럼 그 값에서 한 바퀴 돈다
      const max = seg.counterMax
      const wrap = (v: number) => (max === undefined ? v : v % (max + 1))
      emit(`${seg.id}.in`, wrap(c.in), ts)
      emit(`${seg.id}.out`, wrap(c.out), ts)
    }

    for (const e of this.scene.equipment) {
      for (const tag of e.tags) {
        const mid = tag.warn ? tag.warn * 0.85 : 50
        const swing = mid * 0.25
        const v = mid + swing * Math.sin(elapsed / 7000) + (Math.random() - 0.5) * swing * 0.2
        emit(`${e.id}.${tag.key}`, Math.round(v * 10) / 10 as Value, ts)
      }
    }
  }

  async start(emit: Emit) {
    this.tick(emit)
    this.timer = setInterval(() => this.tick(emit), TICK_MS)
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd hub && npm test`
Expected: PASS — 이전 27개 + mock 6개

- [ ] **Step 5: 허브를 직접 띄워 눈으로 확인**

Run: `cd hub && npm start`

다른 터미널에서:
```bash
npx wscat -c ws://127.0.0.1:8080/ws | head -c 2000
```

Expected: `{"type":"snapshot","data":[...]}` 안에 `conv-3.in`, `conv-3.out`, `conv-3.wip`, `conv-3.state`, `conv-3.stallMs` 가 모두 있다. 40초쯤 지켜보면 `conv-3.state` 가 `"stalled"` 로 바뀌고 `conv-3.stallMs` 가 올라간다. 90초쯤에 다시 `"running"` 이 된다.

- [ ] **Step 6: 커밋**

```bash
git add hub/src/adapters/mock.ts hub/test/mock.test.ts
git commit -m "feat: 모의 카운터 어댑터 (막힘 각본 포함)"
```

---

## Task 5: 웹 뼈대 + 씬 fetch + WS 훅

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/scene.ts`, `web/src/useValues.ts`, `web/src/App.tsx`

**Interfaces:**
- Consumes: `Scene`, `SceneResponse`, `TagValue`, `WsMessage` from `shared/types.ts`; 허브의 `GET /api/scene`, `GET /ws`
- Produces:
  - `fetchScene(): Promise<SceneResponse>`
  - `useValues(): { values: Map<string, TagValue>; connected: boolean }`
  - `useScene(): { data: SceneResponse | null; error: string | null }`

**검증 방식:** 이 태스크부터는 테스트 대신 수동 검증이다 (Global Constraints 참조).

- [ ] **Step 1: 웹 프로젝트 생성**

`web/package.json`:
```json
{
  "name": "packtory-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
  build: { outDir: "dist" },
})
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "../shared/**/*.ts"]
}
```

`web/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>packtory</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Run: `cd web && npm install`

- [ ] **Step 2: 씬 fetch 작성**

`web/src/scene.ts`:
```ts
import { useEffect, useState } from "react"
import type { SceneResponse } from "../../shared/types.ts"

export function useScene() {
  const [data, setData] = useState<SceneResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/scene")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SceneResponse>
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  return { data, error }
}
```

- [ ] **Step 3: WS 훅 작성**

`web/src/useValues.ts`:
```ts
import { useEffect, useRef, useState } from "react"
import type { TagValue, WsMessage } from "../../shared/types.ts"

const RECONNECT_MS = 3000

export function useValues() {
  const [values, setValues] = useState<Map<string, TagValue>>(new Map())
  const [connected, setConnected] = useState(false)
  const closed = useRef(false)

  useEffect(() => {
    closed.current = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed.current) return
      const proto = location.protocol === "https:" ? "wss" : "ws"
      ws = new WebSocket(`${proto}://${location.host}/ws`)

      ws.onopen = () => setConnected(true)

      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string) as WsMessage
        setValues((prev) => {
          // 스냅샷은 전체 교체, values 는 변경분 병합
          const next = m.type === "snapshot" ? new Map<string, TagValue>() : new Map(prev)
          for (const t of m.data) next.set(t.tag, t)
          return next
        })
      }

      ws.onclose = () => {
        setConnected(false)
        if (!closed.current) retry = setTimeout(connect, RECONNECT_MS)
      }

      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed.current = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [])

  return { values, connected }
}
```

- [ ] **Step 4: 배선 확인용 임시 App 작성**

`web/src/main.tsx`:
```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.tsx"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`web/src/styles.css` (이 태스크에서는 최소한만, Task 7에서 채운다):
```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; background: #0f1115; color: #e6e8eb; }
```

`web/src/App.tsx` — Task 6에서 지도로 교체할 임시 화면이다:
```tsx
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const segTags = data.scene.segments.flatMap((s) =>
    [`${s.id}.state`, `${s.id}.wip`, `${s.id}.stallMs`].map((t) => values.get(t)),
  )

  return (
    <div style={{ padding: 16 }}>
      <p>{data.scene.name} · {connected ? "연결됨" : "끊김"} · 태그 {values.size}개</p>
      <pre>{segTags.filter(Boolean).map((t) => `${t!.tag} = ${t!.v}`).join("\n")}</pre>
    </div>
  )
}
```

- [ ] **Step 5: 수동 검증 — 파이프가 끝에서 끝까지 뚫렸는지**

터미널 1: `cd hub && npm start`
터미널 2: `cd web && npm run dev` → 브라우저에서 `http://localhost:5173`

확인할 것:
1. "데모 라인 · 연결됨 · 태그 N개" 가 뜬다
2. `conv-3.state = running` 이 보이고, `conv-3.wip` 숫자가 계속 바뀐다
3. 40초쯤 기다리면 `conv-3.state = stalled` 로 바뀌고 `conv-3.stallMs` 가 올라간다
4. **허브를 Ctrl+C 로 끄면 3초 뒤 "끊김" 으로 바뀌고, 다시 켜면 "연결됨" 으로 돌아오며 값이 이어진다** (완료 기준 11)

Run: `cd web && npm run typecheck`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add web
git commit -m "feat: 웹 뼈대 + 씬 fetch + WS 훅"
```

---

## Task 6: SVG 지도 — 섹션·장비 렌더 + 팬/줌

**Files:**
- Create: `web/src/geom.ts`, `web/src/Map.tsx`
- Modify: `web/src/App.tsx` (임시 화면을 지도로 교체), `web/src/styles.css`

**Interfaces:**
- Consumes: `useScene`, `useValues` (Task 5), `Scene`/`Section`/`Equipment`/`Segment` (Task 1)
- Produces:
  - `geom.ts`: `type Bounds = { minX: number; minY: number; maxX: number; maxY: number }`
  - `floorBounds(scene: Scene, floorId: string): Bounds`
  - `toSvgY(y: number, b: Bounds): number` — 씬 좌표(Y 위쪽) → SVG 좌표(Y 아래쪽)
  - `segmentPath(seg: Segment, b: Bounds): string | null` — 리프트면 `null`
  - `pathLength(seg: Segment): number` — 미터
  - `type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null`
  - `Map.tsx`: `<Map scene values floorId selection onSelect />`

- [ ] **Step 1: 좌표 유틸 작성**

`web/src/geom.ts`:
```ts
import type { Equipment, Scene, Segment } from "../../shared/types.ts"

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null

const MARGIN = 2 // 미터

/** 그 층 섹션들을 다 담는 사각형 + 여백 */
export function floorBounds(scene: Scene, floorId: string): Bounds {
  const rects = scene.sections.filter((s) => s.floor === floorId).map((s) => s.rect)
  if (rects.length === 0) return { minX: 0, minY: 0, maxX: 40, maxY: 25 }
  return {
    minX: Math.min(...rects.map((r) => r[0])) - MARGIN,
    minY: Math.min(...rects.map((r) => r[1])) - MARGIN,
    maxX: Math.max(...rects.map((r) => r[0] + r[2])) + MARGIN,
    maxY: Math.max(...rects.map((r) => r[1] + r[3])) + MARGIN,
  }
}

/**
 * 씬 좌표는 평면도 기준으로 Y가 위쪽인데 SVG는 아래쪽이다.
 * 뒤집지 않으면 지도가 상하 거울상이 되어 도면과 안 맞는다.
 * 변환은 이 함수 한 군데서만 한다.
 */
export function toSvgY(y: number, b: Bounds): number {
  return b.minY + b.maxY - y
}

/** 같은 층 구간의 폴리라인. 리프트(층이 다름)는 경로가 없으므로 null. */
export function segmentPath(seg: Segment, b: Bounds): string | null {
  if (seg.from.floor !== seg.to.floor) return null
  const pts: [number, number][] = [
    [seg.from.x, seg.from.y],
    ...(seg.via ?? []),
    [seg.to.x, seg.to.y],
  ]
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${toSvgY(y, b)}`).join(" ")
}

/** 경로 길이 (미터). 애니메이션 속도를 구간마다 같게 맞추는 데 쓴다. */
export function pathLength(seg: Segment): number {
  if (seg.from.floor !== seg.to.floor) return 1
  const pts: [number, number][] = [
    [seg.from.x, seg.from.y],
    ...(seg.via ?? []),
    [seg.to.x, seg.to.y],
  ]
  let len = 0
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return Math.max(len, 0.1)
}

/** 장비의 SVG 사각형 [x, y, w, h] */
export function equipmentRect(e: Equipment, b: Bounds): [number, number, number, number] {
  return [e.pos[0] - e.size[0] / 2, toSvgY(e.pos[1] + e.size[1] / 2, b), e.size[0], e.size[1]]
}
```

- [ ] **Step 2: 지도 컴포넌트 작성**

`web/src/Map.tsx`:
```tsx
import { useEffect, useRef, useState } from "react"
import type { Scene, TagValue } from "../../shared/types.ts"
import type { Equipment } from "../../shared/types.ts"
import { equipmentRect, floorBounds, toSvgY, type Bounds, type Selection } from "./geom.ts"

type ViewBox = [number, number, number, number]

function fit(b: Bounds): ViewBox {
  return [b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY]
}

/** 장비 경고: warn 이 설정된 태그 중 하나라도 임계 이상이면 참. 이력이 필요 없는 순간 판정이라 여기서 계산한다. */
export function equipmentWarn(scene: Scene, eqId: string, values: Map<string, TagValue>): boolean {
  const eq = scene.equipment.find((e) => e.id === eqId)
  if (!eq) return false
  return eq.tags.some((t) => {
    if (t.warn === undefined) return false
    const v = values.get(`${eq.id}.${t.key}`)
    return typeof v?.v === "number" && v.q === "good" && v.v >= t.warn
  })
}

/**
 * 호버 툴팁. SVG `<title>` 은 브라우저가 알아서 띄우므로 툴팁 컴포넌트를
 * 만들지 않는다 — 스펙 8장의 "값은 호버 툴팁" 은 이 한 줄로 끝난다.
 */
function equipmentTip(e: Equipment, values: Map<string, TagValue>): string {
  const lines = e.tags.map((t) => {
    const v = values.get(`${e.id}.${t.key}`)
    return `${t.label} ${v?.v ?? "—"}${t.unit ?? ""}`
  })
  return [e.label, ...lines].join("\n")
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  floorId: string
  selection: Selection
  onSelect: (s: Selection) => void
  /** AlertBar 가 특정 구간으로 화면을 옮길 때 쓴다 */
  panTo: { x: number; y: number; nonce: number } | null
  children?: (b: Bounds, zoomedIn: boolean) => React.ReactNode
}

export default function Map({ scene, values, floorId, selection, onSelect, panTo, children }: Props) {
  const b = floorBounds(scene, floorId)
  const [vb, setVb] = useState<ViewBox>(() => fit(b))
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; vb: ViewBox } | null>(null)

  // 이상 칩은 층 전환과 이동을 같은 렌더에서 요청한다. 아래 두 effect 중
  // 층 전환 쪽이 먼저 돌아 전체보기로 덮어쓰면 이동이 없던 일이 되므로
  // nonce 로 비켜간다.
  const lastPan = useRef(0)

  // 층이 바뀌면 전체보기로 되돌린다
  useEffect(() => {
    if (panTo && panTo.nonce !== lastPan.current) return // 아래 effect 가 처리한다
    setVb(fit(floorBounds(scene, floorId)))
  }, [floorId, scene])

  // 이상 칩이 요청한 위치로 이동 (줌 배율은 유지)
  useEffect(() => {
    if (!panTo || panTo.nonce === lastPan.current) return
    lastPan.current = panTo.nonce
    setVb(([, , w, h]) => [panTo.x - w / 2, toSvgY(panTo.y, b) - h / 2, w, h])
  }, [panTo?.nonce])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    // 커서가 가리키는 지점을 고정한 채 확대/축소
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
    setVb(([x, y, w, h]) => {
      const nw = Math.min(Math.max(w * k, 2), 500)
      const nh = nw * (h / w)
      return [x + (w - nw) * fx, y + (h - nh) * fy, nw, nh]
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const svg = svgRef.current
    if (!d || !svg) return
    const r = svg.getBoundingClientRect()
    const dx = ((e.clientX - d.x) / r.width) * d.vb[2]
    const dy = ((e.clientY - d.y) / r.height) * d.vb[3]
    setVb([d.vb[0] - dx, d.vb[1] - dy, d.vb[2], d.vb[3]])
  }
  const onPointerUp = () => { drag.current = null }

  const sections = scene.sections.filter((s) => s.floor === floorId)
  const sectionIds = new Set(sections.map((s) => s.id))
  const equipment = scene.equipment.filter((e) => sectionIds.has(e.section))
  /** 확대했을 때만 장비·구간 라벨을 띄운다. 축소 상태에서는 구역 이름만 남는다. */
  const zoomedIn = (b.maxX - b.minX) / vb[2] > 1.4

  return (
    <div className="map">
      <svg
        ref={svgRef}
        viewBox={vb.join(" ")}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {sections.map((s) => {
          const [x, y, w, h] = s.rect
          return (
            <g key={s.id} className="section" onClick={() => onSelect({ kind: "section", id: s.id })}>
              <title>{s.label}</title>
              <rect x={x} y={toSvgY(y + h, b)} width={w} height={h} rx={0.5} />
              <text x={x + 0.8} y={toSvgY(y + h, b) + 1.8} className="section-label">
                {s.label}
                {s.cameras.length > 0 ? ` 📹×${s.cameras.length}` : ""}
              </text>
            </g>
          )
        })}

        {/* 구간은 Task 7에서 children 으로 들어온다 */}
        {children?.(b, zoomedIn)}

        {equipment.map((e) => {
          const [x, y, w, h] = equipmentRect(e, b)
          const warn = equipmentWarn(scene, e.id, values)
          const sel = selection?.kind === "equipment" && selection.id === e.id
          return (
            <g
              key={e.id}
              className={`equipment${warn ? " warn" : ""}${sel ? " selected" : ""}`}
              onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "equipment", id: e.id }) }}
            >
              <title>{equipmentTip(e, values)}</title>
              <rect x={x} y={y} width={w} height={h} rx={0.3} />
              {zoomedIn && <text x={x + w / 2} y={y + h + 1.2} className="equipment-label">{e.label}</text>}
            </g>
          )
        })}
      </svg>

      <div className="map-controls">
        <button title="전체보기" onClick={() => setVb(fit(b))}>⌂</button>
        <button title="확대" onClick={() => setVb(([x, y, w, h]) => [x + w * 0.075, y + h * 0.075, w * 0.85, h * 0.85])}>+</button>
        <button title="축소" onClick={() => setVb(([x, y, w, h]) => [x - w * 0.075, y - h * 0.075, w * 1.15, h * 1.15])}>−</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 스타일 추가**

`web/src/styles.css` 에 덧붙인다:
```css
.map { position: relative; width: 100%; height: 100%; }
.map svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; background: #0f1115; }
.map svg:active { cursor: grabbing; }

.section rect { fill: #1a1f27; stroke: #2b3240; stroke-width: 0.12; }
.section { cursor: pointer; }
.section:hover rect { fill: #1f2530; }
.section-label { fill: #8b94a3; font-size: 1.2px; pointer-events: none; }

.equipment rect { fill: #39424f; stroke: #5b6675; stroke-width: 0.1; }
.equipment { cursor: pointer; }
.equipment:hover rect { fill: #46515f; }
.equipment.warn rect { stroke: #e08a2e; stroke-width: 0.35; }
.equipment.selected rect { stroke: #6aa9ff; stroke-width: 0.3; }
.equipment-label { fill: #aeb6c2; font-size: 0.9px; text-anchor: middle; pointer-events: none; }

.map-controls { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 6px; }
.map-controls button {
  width: 32px; height: 32px; border: 1px solid #2b3240; border-radius: 6px;
  background: #171b22; color: #e6e8eb; font-size: 16px; cursor: pointer;
}
.map-controls button:hover { background: #222833; }
```

- [ ] **Step 4: App 을 지도로 교체**

`web/src/App.tsx`:
```tsx
import { useState } from "react"
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"
import Map from "./Map.tsx"
import type { Selection } from "./geom.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [floorId, setFloorId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const scene = data.scene
  const floors = [...scene.floors].sort((a, b) => b.order - a.order)
  const current = floorId ?? floors[0].id

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <Map
        scene={scene}
        values={values}
        floorId={current}
        selection={selection}
        onSelect={setSelection}
        panTo={null}
      />
    </div>
  )
}
```

`styles.css` 에 덧붙인다:
```css
.app { display: grid; grid-template-rows: 1fr; height: 100%; }
.offline {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  background: #4a2020; border: 1px solid #7a3030; padding: 6px 12px; border-radius: 6px; z-index: 10;
}
```

- [ ] **Step 5: 수동 검증**

터미널 1: `cd hub && npm start` / 터미널 2: `cd web && npm run dev`

확인할 것:
1. 2층 평면도가 뜨고 `충전부 📹×2` 와 `포장부` 두 구역이 나란히 보인다 (겹치지 않는다)
2. 장비 박스 3개(충전기 1, 캡퍼 1, 포장기 1)가 각자 구역 안에 있다
3. **휠로 확대/축소하면 커서가 가리키던 지점이 제자리에 있다**
4. 드래그로 화면이 따라 움직인다
5. `⌂` 를 누르면 층 전체가 다시 보인다
6. 확대하면 장비 라벨이 나타나고, 축소하면 사라진다
7. 장비에 마우스를 올리면 브라우저 툴팁으로 이름과 태그 값이 뜬다 (스펙 8장의 호버 툴팁)
8. `filler-1.temp` 가 68(=80×0.85) 근처에서 흔들리므로 충전기 박스에 주황 테두리가 **가끔** 붙었다 떨어진다

Run: `cd web && npm run typecheck`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src
git commit -m "feat: SVG 평면도 지도 + 팬/줌"
```

---

## Task 7: 구간 렌더 + 흐름 애니메이션 + 상태 표현

**Files:**
- Create: `web/src/Segment.tsx`
- Modify: `web/src/Map.tsx` (children 으로 구간 렌더), `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `segmentPath`, `pathLength`, `toSvgY`, `Bounds` (Task 6); `SegState`, `Segment`, `TagValue` (Task 1)
- Produces:
  - `segState(id: string, values: Map<string, TagValue>): SegState`
  - `segWip(id: string, values: Map<string, TagValue>): number`
  - `<Segments scene values floorId bounds selection onSelect />`

**애니메이션 위험 고지:** CSS `offset-path` 를 SVG 요소에 쓰는 것이 이 계획에서 유일하게 브라우저 동작이 불확실한 부분이다. Step 1에서 먼저 확인하고, 안 되면 Step 2의 대체안으로 간다.

- [ ] **Step 1: offset-path 가 SVG에서 도는지 먼저 확인**

`web/index.html` 의 `<body>` 맨 위에 임시로 붙여 넣고 `npm run dev` 로 연다:
```html
<svg viewBox="0 0 100 20" style="width:400px;background:#222">
  <path d="M 5 10 L 95 10" stroke="#555" fill="none" />
  <circle r="3" fill="#4caf50"
          style="offset-path: path('M 5 10 L 95 10'); animation: go 2s linear infinite" />
</svg>
<style>@keyframes go { to { offset-distance: 100% } }</style>
```

Expected: 초록 점이 왼쪽에서 오른쪽으로 2초마다 반복해 움직인다.

**움직이면** 확인용 코드를 지우고 Step 2를 건너뛰어 Step 3으로 간다.
**안 움직이면** Step 2의 대체안을 쓴다 (Step 3 이후의 CSS 애니메이션 대신).

- [ ] **Step 2: (offset-path 가 안 될 때만) 대체안 적용**

`getPointAtLength` 로 좌표를 직접 찍는다. `Segment.tsx` 의 점 렌더를 아래로 바꾸고, `styles.css` 의 `@keyframes flow` 와 `.item` 의 `offset-*` 속성은 뺀다.

```tsx
// 대체안: rAF 루프 하나가 모든 점의 transform 을 찍는다.
// 브라우저 표준 SVGGeometryElement.getPointAtLength 를 쓰므로 어디서나 돈다.
function useDotPositions(pathEl: SVGPathElement | null, count: number, durSec: number, running: boolean) {
  const [, force] = useState(0)
  const start = useRef(performance.now())
  useEffect(() => {
    if (!pathEl || count === 0) return
    let id = 0
    const loop = () => { force((n) => n + 1); id = requestAnimationFrame(loop) }
    if (running) id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [pathEl, count, running])

  if (!pathEl) return []
  const total = pathEl.getTotalLength()
  const phase = running ? ((performance.now() - start.current) / 1000 / durSec) % 1 : 0
  return Array.from({ length: count }, (_, i) => {
    const t = (((phase - i / count) % 1) + 1) % 1
    return pathEl.getPointAtLength(t * total)
  })
}
```

- [ ] **Step 3: 구간 컴포넌트 작성**

`web/src/Segment.tsx`:
```tsx
import type { Scene, SegState, Segment, TagValue } from "../../shared/types.ts"
import { isLift } from "../../shared/types.ts"
import { pathLength, segmentPath, toSvgY, type Bounds, type Selection } from "./geom.ts"

/** 구간당 화면에 그리는 점의 최대 개수. 500개가 쌓여도 브라우저가 죽으면 안 된다. */
const MAX_DOTS = 30
/** 점의 눈에 보이는 속도 (미터/초). 구간 길이와 무관하게 같아 보이도록 duration 을 길이에서 뽑는다. */
const VISUAL_SPEED = 3

export function segState(id: string, values: Map<string, TagValue>): SegState {
  const v = values.get(`${id}.state`)
  return (typeof v?.v === "string" ? v.v : "unknown") as SegState
}

export function segWip(id: string, values: Map<string, TagValue>): number {
  const v = values.get(`${id}.wip`)
  return typeof v?.v === "number" ? v.v : 0
}

export function segStallMs(id: string, values: Map<string, TagValue>): number {
  const v = values.get(`${id}.stallMs`)
  return typeof v?.v === "number" ? v.v : 0
}

export const STATE_LABEL: Record<SegState, string> = {
  running: "가동", stalled: "정지", idle: "대기", unknown: "불명",
}

export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  floorId: string
  bounds: Bounds
  /** 확대 상태에서만 구간 라벨을 띄운다 (Map 이 내려준다) */
  zoomedIn: boolean
  selection: Selection
  onSelect: (s: Selection) => void
}

export default function Segments({ scene, values, floorId, bounds, zoomedIn, selection, onSelect }: Props) {
  const flat = scene.segments.filter(
    (s) => !isLift(s) && s.from.floor === floorId,
  )
  // 리프트는 양쪽 층 지도 모두에 마커로 나타난다
  const lifts = scene.segments.filter(
    (s) => isLift(s) && (s.from.floor === floorId || s.to.floor === floorId),
  )

  return (
    <>
      {flat.map((seg) => {
        const d = segmentPath(seg, bounds)!
        const state = segState(seg.id, values)
        const wip = segWip(seg.id, values)
        const dots = state === "unknown" ? 0 : Math.min(wip, MAX_DOTS)
        const dur = pathLength(seg) / VISUAL_SPEED
        // 점 간격을 capacity 로 고정한다. n 으로 나누면 점이 늘 때마다
        // 기존 점들의 delay 가 바뀌어 화면 전체가 튄다.
        const gap = dur / (seg.capacity ?? 20)
        const sel = selection?.kind === "segment" && selection.id === seg.id

        return (
          <g
            key={seg.id}
            className={`segment${sel ? " selected" : ""}`}
            data-state={state}
            onClick={(e) => { e.stopPropagation(); onSelect({ kind: "segment", id: seg.id }) }}
          >
            <title>{`${seg.label}\n${STATE_LABEL[state]} · WIP ${wip}`}</title>
            <path className="rail-hit" d={d} />
            <path className="rail" d={d} />
            {Array.from({ length: dots }, (_, i) => (
              <circle
                key={i}
                className="item"
                r={0.35}
                style={{
                  offsetPath: `path("${d}")`,
                  animationDuration: `${dur}s`,
                  animationDelay: `${-i * gap}s`,
                }}
              />
            ))}
            {wip > MAX_DOTS && (
              <text className="overflow" x={seg.to.x} y={toSvgY(seg.to.y, bounds) - 1}>
                +{wip - MAX_DOTS}
              </text>
            )}
            {zoomedIn && (
              <text
                className="segment-label"
                x={(seg.from.x + seg.to.x) / 2}
                y={toSvgY((seg.from.y + seg.to.y) / 2, bounds) - 0.8}
              >
                {seg.label}
              </text>
            )}
          </g>
        )
      })}

      {lifts.map((seg) => {
        const here = seg.from.floor === floorId ? seg.from : seg.to
        const other = seg.from.floor === floorId ? seg.to : seg.from
        const up = (scene.floors.find((f) => f.id === other.floor)?.order ?? 0)
          > (scene.floors.find((f) => f.id === here.floor)?.order ?? 0)
        const state = segState(seg.id, values)
        const wip = segWip(seg.id, values)

        return (
          <g
            key={`${seg.id}-${floorId}`}
            className="lift"
            data-state={state}
            onClick={(e) => { e.stopPropagation(); onSelect({ kind: "segment", id: seg.id }) }}
          >
            <title>{`${seg.label}\n${STATE_LABEL[state]} · WIP ${wip} · ${other.floor} 연결`}</title>
            <circle cx={here.x} cy={toSvgY(here.y, bounds)} r={1.1} />
            <text x={here.x} y={toSvgY(here.y, bounds) + 0.45} className="lift-arrow">
              {up ? "▲" : "▼"}
            </text>
            <text x={here.x} y={toSvgY(here.y, bounds) - 1.6} className="lift-label">
              {other.floor} · {wip}
            </text>
          </g>
        )
      })}
    </>
  )
}
```

- [ ] **Step 4: 상태 표현 스타일 작성**

`web/src/styles.css` 에 덧붙인다:
```css
/* ── 구간 ─────────────────────────────────────────── */
.segment { cursor: pointer; }
/* 얇은 선을 클릭하기 어려우므로 투명한 굵은 히트 영역을 겹쳐 둔다 */
.rail-hit { stroke: transparent; stroke-width: 1.6; fill: none; }
.rail { stroke-width: 0.45; fill: none; stroke-linecap: round; }
.item { fill: #cfd6e0; }
.overflow { fill: #e6e8eb; font-size: 1px; text-anchor: middle; }
.segment-label { fill: #8b94a3; font-size: 0.85px; text-anchor: middle; pointer-events: none; }

@keyframes flow { to { offset-distance: 100%; } }
.item { animation-name: flow; animation-timing-function: linear; animation-iteration-count: infinite; }

/* 가동 */
.segment[data-state="running"] .rail { stroke: #3d7a4a; }
.segment[data-state="running"] .item { fill: #7fd694; }

/* 정지 — 색만으로 구분하지 않는다. 점선과 깜빡임이 같이 붙는다. */
.segment[data-state="stalled"] .rail { stroke: #d24b4b; stroke-dasharray: 1 0.6; animation: blink 1s steps(2) infinite; }
.segment[data-state="stalled"] .item { fill: #ff8a8a; animation-play-state: paused; }
@keyframes blink { 50% { opacity: 0.35; } }

/* 대기 — 물건이 안 들어와서 안 도는 것은 정상이다. 여기서 빨강을 쓰지 않는 것이 이 제품의 값어치다. */
.segment[data-state="idle"] .rail { stroke: #4a515c; }

/* 불명 — 빗금 */
.segment[data-state="unknown"] .rail { stroke: #6b7280; stroke-dasharray: 0.4 0.4; }

/* ── 리프트 ───────────────────────────────────────── */
.lift { cursor: pointer; }
.lift circle { fill: #2a3240; stroke: #5b6675; stroke-width: 0.15; }
.lift-arrow { fill: #cfd6e0; font-size: 1.2px; text-anchor: middle; pointer-events: none; }
.lift-label { fill: #8b94a3; font-size: 0.85px; text-anchor: middle; pointer-events: none; }
.lift[data-state="stalled"] circle { stroke: #d24b4b; stroke-width: 0.3; animation: blink 1s steps(2) infinite; }
.lift[data-state="running"] circle { stroke: #3d7a4a; }
.lift[data-state="unknown"] circle { stroke-dasharray: 0.4 0.4; }

.segment.selected .rail, .lift.selected circle { stroke: #6aa9ff; }

/* 움직임을 줄이라고 한 사용자에게는 애니메이션을 끈다.
   상태는 색·점선·점 개수가 이미 다 전달하므로 정보가 사라지지 않는다. */
@media (prefers-reduced-motion: reduce) {
  .item, .segment[data-state="stalled"] .rail, .lift[data-state="stalled"] circle {
    animation: none !important;
  }
}
```

- [ ] **Step 5: 지도에 구간 끼우기**

`web/src/App.tsx` 의 `<Map ...>` 호출을 children 을 넘기도록 바꾼다:
```tsx
      <Map
        scene={scene}
        values={values}
        floorId={current}
        selection={selection}
        onSelect={setSelection}
        panTo={null}
      >
        {(b, zoomedIn) => (
          <Segments
            scene={scene}
            values={values}
            floorId={current}
            bounds={b}
            zoomedIn={zoomedIn}
            selection={selection}
            onSelect={setSelection}
          />
        )}
      </Map>
```
그리고 위에 `import Segments from "./Segment.tsx"` 를 추가한다.

- [ ] **Step 6: 수동 검증 — 이 태스크가 제품의 핵심이다**

터미널 1: `cd hub && npm start` / 터미널 2: `cd web && npm run dev`

확인할 것:
1. 2층에서 `conv-3` 과 `conv-5` 에 초록 점이 왼쪽에서 오른쪽으로 흐른다
2. `conv-5` 는 `via` 때문에 중간에 꺾이고, 점이 그 꺾인 경로를 따라간다
3. **40초쯤 기다리면 `conv-3` 이 빨강 점선으로 바뀌고 깜빡이며, 점이 그 자리에 얼어붙고, 점 개수가 계속 늘어난다** (완료 기준 3)
4. 90초쯤에 막힘이 풀리고 다시 초록으로 흐른다
5. 점이 새로 생겨도 **기존 점들이 제자리에서 계속 흐른다** (전체가 튀면 `gap` 계산이 잘못된 것이다)
6. 1층 탭이 아직 없으므로 `App.tsx` 의 `floors[0].id` 를 잠시 `"1F"` 로 바꿔 확인한다: `conv-1` 이 흐르고, 오른쪽 끝에 `▲ 2F · N` 리프트 마커가 보인다. 확인 후 되돌린다
7. 구간에 마우스를 올리면 툴팁으로 `충전 이송 / 정지 · WIP 35` 가 뜨고, 확대하면 구간 라벨이 선 위에 나타난다
8. OS 설정에서 "동작 줄이기"를 켜면 애니메이션이 멎고 점은 그대로 깔려 있다

Run: `cd web && npm run typecheck`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add web/src
git commit -m "feat: 구간 흐름 애니메이션 + 정지/대기/불명 상태 표현"
```

---

## Task 8: 층 탭 + 상태 배지

**Files:**
- Create: `web/src/FloorTabs.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `segState` (Task 7), `Scene`, `TagValue`
- Produces:
  - `floorState(scene, floorId, values): SegState` — 그 층에서 가장 나쁜 상태
  - `<FloorTabs scene values current onChange />`

- [ ] **Step 1: 층 탭 컴포넌트 작성**

`web/src/FloorTabs.tsx`:
```tsx
import type { Scene, SegState, TagValue } from "../../shared/types.ts"
import { segState } from "./Segment.tsx"

/**
 * 그 층에서 가장 나쁜 상태. 리프트는 양쪽 층에 다 걸리므로 두 층 모두에 반영된다 —
 * 층간 반송기가 막히면 어느 층을 보고 있든 알아야 하기 때문이다.
 */
export function floorState(scene: Scene, floorId: string, values: Map<string, TagValue>): SegState {
  const on = scene.segments.filter((s) => s.from.floor === floorId || s.to.floor === floorId)
  const states = on.map((s) => segState(s.id, values))
  if (states.includes("stalled")) return "stalled"
  if (states.includes("running")) return "running"
  if (states.includes("unknown")) return "unknown"
  return "idle"
}

const BADGE: Record<SegState, string> = {
  running: "🟢",
  stalled: "🔴",
  idle: "⚪",
  unknown: "⚫",
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  current: string
  onChange: (floorId: string) => void
}

export default function FloorTabs({ scene, values, current, onChange }: Props) {
  const floors = [...scene.floors].sort((a, b) => b.order - a.order)
  return (
    <nav className="floor-tabs" aria-label="층 선택">
      {floors.map((f) => {
        const st = floorState(scene, f.id, values)
        return (
          <button
            key={f.id}
            className={`floor-tab${f.id === current ? " current" : ""}`}
            data-state={st}
            aria-current={f.id === current}
            onClick={() => onChange(f.id)}
          >
            <span className="floor-id">{f.id}</span>
            <span className="floor-badge" aria-label={st}>{BADGE[st]}</span>
          </button>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: 스타일 추가**

```css
.floor-tabs { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #12161d; border-right: 1px solid #222833; }
.floor-tab {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  width: 52px; padding: 8px 4px; border: 1px solid #2b3240; border-radius: 6px;
  background: #171b22; color: #aeb6c2; cursor: pointer;
}
.floor-tab:hover { background: #222833; }
.floor-tab.current { background: #243048; border-color: #3c5a8a; color: #e6e8eb; }
.floor-id { font-weight: 600; }
.floor-badge { font-size: 11px; }
.floor-tab[data-state="stalled"] { border-color: #d24b4b; }
```

- [ ] **Step 3: App 에 배치**

`web/src/App.tsx` 를 좌측 탭 + 지도 레이아웃으로 바꾼다:
```tsx
  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <div className="body">
        <FloorTabs scene={scene} values={values} current={current} onChange={setFloorId} />
        <Map ...>{/* Task 7 그대로 */}</Map>
      </div>
    </div>
  )
```
`import FloorTabs from "./FloorTabs.tsx"` 를 추가하고, `styles.css` 에:
```css
.body { display: grid; grid-template-columns: auto 1fr; height: 100%; min-height: 0; }
```

- [ ] **Step 4: 수동 검증**

1. 왼쪽에 `2F`, `1F` 탭이 위에서부터 순서대로 뜬다 (`order` 큰 값이 위)
2. 탭을 누르면 그 층 지도로 바뀌고 전체보기로 맞춰진다 (완료 기준 2)
3. **2층을 보고 있을 때 1층 `conv-1` 은 정상이므로 `1F` 탭이 🟢 이다**
4. **1층을 보고 있어도 2층에서 `conv-3` 이 막히면 `2F` 탭이 🔴 로 바뀐다** (완료 기준 5)
5. `lift-1` 은 1F·2F 양쪽에 걸리므로 리프트가 막히면 두 탭이 다 빨개진다

- [ ] **Step 5: 커밋**

```bash
git add web/src
git commit -m "feat: 층 탭 + 층별 상태 배지"
```

---

## Task 9: 이상 칩 + 층 전환 + 팬 이동

**Files:**
- Create: `web/src/AlertBar.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `segState`/`segStallMs`/`formatStall` (Task 7), `Map` 의 `panTo` prop (Task 6)
- Produces: `<AlertBar scene values onGo />` — `onGo(floorId, x, y)` 를 호출한다

- [ ] **Step 1: 이상 칩 컴포넌트 작성**

`web/src/AlertBar.tsx`:
```tsx
import type { Scene, TagValue } from "../../shared/types.ts"
import { formatStall, segStallMs, segState } from "./Segment.tsx"

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  onGo: (floorId: string, x: number, y: number) => void
}

/**
 * 정지 중인 구간만 칩으로 띄운다. 칩을 누르면 화면이 거기로 데려간다 —
 * 신입이 찾을 필요가 없는 것이 이 제품의 핵심이다.
 */
export default function AlertBar({ scene, values, onGo }: Props) {
  const stalled = scene.segments
    .filter((s) => segState(s.id, values) === "stalled")
    .map((s) => ({ seg: s, ms: segStallMs(s.id, values) }))
    .sort((a, b) => b.ms - a.ms)

  if (stalled.length === 0) {
    return <div className="alert-bar ok">정상 가동</div>
  }

  return (
    <div className="alert-bar" role="status">
      {stalled.map(({ seg, ms }) => {
        const section = scene.sections.find((x) => x.id === seg.section)
        return (
          <button
            key={seg.id}
            className="chip"
            onClick={() => onGo(seg.from.floor, seg.from.x, seg.from.y)}
          >
            ⚠ {section?.label ?? seg.section} {seg.label} 정지 {formatStall(ms)}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: 스타일 추가**

```css
.alert-bar {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 8px 12px; background: #12161d; border-bottom: 1px solid #222833; min-height: 44px;
}
.alert-bar.ok { color: #7fd694; }
.chip {
  padding: 6px 12px; border: 1px solid #d24b4b; border-radius: 999px;
  background: #3a1d1d; color: #ffb4b4; cursor: pointer; font: inherit;
  animation: blink 1.6s steps(2) infinite;
}
.chip:hover { background: #4a2424; }
@media (prefers-reduced-motion: reduce) { .chip { animation: none; } }
```

- [ ] **Step 3: App 에 배선**

`web/src/App.tsx` 전체:
```tsx
import { useState } from "react"
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"
import Map from "./Map.tsx"
import Segments from "./Segment.tsx"
import FloorTabs from "./FloorTabs.tsx"
import AlertBar from "./AlertBar.tsx"
import type { Selection } from "./geom.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [floorId, setFloorId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [panTo, setPanTo] = useState<{ x: number; y: number; nonce: number } | null>(null)

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const scene = data.scene
  const floors = [...scene.floors].sort((a, b) => b.order - a.order)
  const current = floorId ?? floors[0].id

  // 층 전환과 이동을 한 번에. nonce 가 있어야 같은 칩을 연달아 눌러도 다시 움직인다.
  const goTo = (f: string, x: number, y: number) => {
    setFloorId(f)
    setPanTo({ x, y, nonce: Date.now() })
  }

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <AlertBar scene={scene} values={values} onGo={goTo} />
      <div className="body">
        <FloorTabs scene={scene} values={values} current={current} onChange={setFloorId} />
        <Map
          scene={scene}
          values={values}
          floorId={current}
          selection={selection}
          onSelect={setSelection}
          panTo={panTo}
        >
          {(b, zoomedIn) => (
            <Segments
              scene={scene}
              values={values}
              floorId={current}
              bounds={b}
              zoomedIn={zoomedIn}
              selection={selection}
              onSelect={setSelection}
            />
          )}
        </Map>
      </div>
    </div>
  )
}
```

`styles.css` 의 `.app` 을 고친다:
```css
.app { display: grid; grid-template-rows: auto 1fr; height: 100%; position: relative; }
```

- [ ] **Step 4: 수동 검증 — 완료 기준 4·6**

1. 평소에는 상단에 "정상 가동" 만 보인다
2. **40초쯤 지나면 `⚠ 충전부 충전 이송 정지 0:12` 칩이 뜨고 초가 올라간다** (완료 기준 4)
3. **1층을 보고 있을 때 그 칩을 누르면 2층으로 전환되고 지도가 `conv-3` 으로 옮겨간다** (완료 기준 6)
4. 칩을 다시 눌러도 또 움직인다 (nonce 가 없으면 한 번만 움직인다)
5. 90초쯤 막힘이 풀리면 칩이 사라지고 "정상 가동" 으로 돌아온다
6. **물건이 없어 멈춘 구간은 칩이 안 뜬다** — `hub` 를 끄고 `scene.json` 의 `BLOCK_PLAN` 대상을 `conv-5` 로 바꿔 띄우면 `conv-5` 는 `conv-3` 에서 물건이 안 와 `wip` 이 0에 가까우므로 `idle` 로 남는다. 확인 후 되돌린다 (완료 기준 8)

- [ ] **Step 5: 커밋**

```bash
git add web/src
git commit -m "feat: 상단 이상 칩 + 클릭 시 층 전환/이동"
```

---

## Task 10: 모달 + CCTV

**Files:**
- Create: `web/src/Modal.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`, `web/src/vite-env.d.ts`

**Interfaces:**
- Consumes: `Selection` (Task 6), `segState`/`segWip`/`segStallMs`/`formatStall` (Task 7), `go2rtcBase` (Task 5)
- Produces: `<Modal scene values go2rtcBase selection onClose />`

- [ ] **Step 1: go2rtc 커스텀 엘리먼트 타입 선언**

`web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    "video-stream": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      mode?: string
    }
  }
}
```

- [ ] **Step 2: 모달 컴포넌트 작성**

`web/src/Modal.tsx`:
```tsx
import { useEffect, useState } from "react"
import type { Camera, Scene, TagValue } from "../../shared/types.ts"
import type { Selection } from "./geom.ts"
import { STATE_LABEL, formatStall, segStallMs, segState, segWip } from "./Segment.tsx"

/** go2rtc 의 웹 컴포넌트를 한 번만 로드한다 */
function useGo2rtcScript(base: string) {
  const [ready, setReady] = useState(() => !!customElements.get("video-stream"))
  useEffect(() => {
    if (ready) return
    const el = document.createElement("script")
    el.src = `${base}/video-stream.js`
    el.onload = () => setReady(true)
    el.onerror = () => setReady(false)
    document.head.appendChild(el)
  }, [base, ready])
  return ready
}

function num(values: Map<string, TagValue>, tag: string): number | null {
  const v = values.get(tag)
  return typeof v?.v === "number" ? v.v : null
}

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  go2rtcBase: string
  selection: Selection
  onClose: () => void
}

export default function Modal({ scene, values, go2rtcBase, selection, onClose }: Props) {
  const [tab, setTab] = useState(0)
  const ready = useGo2rtcScript(go2rtcBase)

  useEffect(() => { setTab(0) }, [selection?.kind, selection?.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!selection) return null

  // 대상이 무엇이든 카메라는 언제나 그 대상이 속한 섹션에서 온다
  let sectionId: string | undefined
  let title = ""
  let rows: [string, string][] = []

  if (selection.kind === "section") {
    const sec = scene.sections.find((s) => s.id === selection.id)
    if (!sec) return null
    sectionId = sec.id
    title = sec.label
    rows = scene.segments
      .filter((g) => g.section === sec.id)
      .map((g) => {
        const st = segState(g.id, values)
        const suffix = st === "stalled" ? ` ${formatStall(segStallMs(g.id, values))}` : ""
        return [g.label, `${STATE_LABEL[st]}${suffix} · WIP ${segWip(g.id, values)}`]
      })
  } else if (selection.kind === "equipment") {
    const eq = scene.equipment.find((e) => e.id === selection.id)
    if (!eq) return null
    sectionId = eq.section
    title = eq.label
    rows = eq.tags.map((t) => {
      const v = values.get(`${eq.id}.${t.key}`)
      const over = t.warn !== undefined && typeof v?.v === "number" && v.v >= t.warn
      return [t.label, `${v?.v ?? "—"} ${t.unit ?? ""}${over ? " ⚠" : ""}`]
    })
  } else {
    const seg = scene.segments.find((g) => g.id === selection.id)
    if (!seg) return null
    sectionId = seg.section
    title = seg.label
    const st = segState(seg.id, values)
    rows = [
      ["상태", STATE_LABEL[st]],
      ["누적 입고", String(num(values, `${seg.id}.in`) ?? "—")],
      ["누적 출고", String(num(values, `${seg.id}.out`) ?? "—")],
      ["구간 내 재공(WIP)", `${segWip(seg.id, values)}${seg.capacity ? ` / ${seg.capacity}` : ""}`],
      ["정지 시간", st === "stalled" ? formatStall(segStallMs(seg.id, values)) : "—"],
    ]
  }

  const section = scene.sections.find((s) => s.id === sectionId)
  const cams: Camera[] = (section?.cameras ?? [])
    .map((id) => scene.cameras.find((c) => c.id === id))
    .filter((c): c is Camera => !!c)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          {section && selection.kind !== "section" && <span className="modal-sub">{section.label}</span>}
          <button className="close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {cams.length > 0 && (
          <div className="video">
            {cams.length > 1 && (
              <div className="tabs" role="tablist">
                {cams.map((c, i) => (
                  <button key={c.id} role="tab" aria-selected={i === tab}
                          className={i === tab ? "on" : ""} onClick={() => setTab(i)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {/* 활성 탭 하나만 마운트한다 — 동시 디코딩 스트림은 항상 1개.
                모달을 닫으면 언마운트되며 연결도 끊긴다. */}
            {ready
              ? <video-stream key={cams[tab].id} src={`${go2rtcBase}/api/ws?src=${cams[tab].stream}`} mode="webrtc" />
              : <p className="video-error">영상 컴포넌트를 못 불러왔다 ({go2rtcBase})</p>}
          </div>
        )}

        <dl className="rows">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 스타일 추가**

```css
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.6);
  display: grid; place-items: center; z-index: 50;
}
.modal {
  width: min(560px, 92vw); max-height: 88vh; overflow: auto;
  background: #171b22; border: 1px solid #2b3240; border-radius: 10px; padding: 16px;
}
.modal header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.modal h2 { margin: 0; font-size: 18px; }
.modal-sub { color: #8b94a3; font-size: 13px; }
.modal .close { margin-left: auto; background: none; border: 0; color: #8b94a3; font-size: 18px; cursor: pointer; }
.video { margin-bottom: 12px; }
.video video-stream { display: block; width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 6px; }
.video-error { color: #d99; }
.tabs { display: flex; gap: 6px; margin-bottom: 8px; }
.tabs button { padding: 4px 10px; border: 1px solid #2b3240; border-radius: 6px; background: #12161d; color: #aeb6c2; cursor: pointer; }
.tabs button.on { background: #243048; color: #e6e8eb; }
.rows div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #222833; }
.rows dt { color: #8b94a3; margin: 0; }
.rows dd { margin: 0; }
```

- [ ] **Step 4: App 에 배선**

`App.tsx` 의 `</div>` 직전에 추가하고 `import Modal from "./Modal.tsx"`:
```tsx
      <Modal
        scene={scene}
        values={values}
        go2rtcBase={data.go2rtcBase}
        selection={selection}
        onClose={() => setSelection(null)}
      />
```

- [ ] **Step 5: 수동 검증**

go2rtc 없이 먼저 수치부터 확인한다.

1. 구간을 클릭하면 모달이 뜨고 상태·누적 입고·누적 출고·WIP·정지 시간이 보인다 (완료 기준 7의 수치 부분)
2. `conv-3` 이 막힌 동안 열면 "상태: 정지" 와 올라가는 정지 시간이 보인다
3. 충전기 1을 클릭하면 속도·온도가 보이고, 온도가 80 이상이면 `⚠` 가 붙는다
4. **포장부 빈 배경을 클릭하면 영상 자리 없이 구간 상태 목록만 뜬다** (완료 기준 12)
5. 충전부를 클릭하면 카메라 탭 2개가 보인다
6. `Esc` 또는 배경 클릭으로 닫힌다

Run: `cd web && npm run typecheck`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src
git commit -m "feat: CCTV 모달 (섹션/장비/구간 공용)"
```

---

## Task 11: 정적 서빙 + 개발용 영상 소스 + README

**Files:**
- Create: `go2rtc.yaml`, `README.md`
- Modify: `hub/package.json` (빌드·기동 스크립트)

**Interfaces:**
- Consumes: `startHub` 의 `webDir` 옵션 (Task 3), `Modal` 의 `video-stream` (Task 10)
- Produces: 완성된 데모. 허브 하나만 띄우면 화면과 영상이 다 나온다.

- [ ] **Step 1: go2rtc 설정 작성**

`go2rtc.yaml` — 카메라 3대. 실제 카메라가 없으면 아래 `ffmpeg` 소스가 동영상 파일을 루프 재생한다.

**스펙과의 차이:** 스펙 9장은 개발용 RTSP 소스로 MediaMTX를 띄우라고 했다. go2rtc가 `ffmpeg:` 소스로 같은 일을 하므로 프로세스를 하나 줄인다. MediaMTX가 필요해지면 `cam-*` 값을 그 RTSP 주소로 바꾸기만 하면 된다.

```yaml
api:
  listen: ":1984"
  origin: "*"   # 개발 중 5173(vite) 에서 붙기 위해. 운영에서는 실제 출처로 좁힌다.

streams:
  # 실제 카메라 (H.264 전용. H.265는 트랜스코딩이 필요하므로 범위 밖)
  # cam-in-1: rtsp://user:pass@192.168.0.21:554/stream1
  # cam-fill-1: rtsp://user:pass@192.168.0.22:554/stream1
  # cam-fill-2: rtsp://user:pass@192.168.0.23:554/stream1

  # 개발용 대체 — sample.mp4 를 무한 반복해 H.264로 내보낸다
  cam-in-1: "ffmpeg:sample.mp4#video=copy#input=-re -stream_loop -1"
  cam-fill-1: "ffmpeg:sample.mp4#video=copy#input=-re -stream_loop -1"
  cam-fill-2: "ffmpeg:sample.mp4#video=copy#input=-re -stream_loop -1"
```

- [ ] **Step 2: 허브가 웹 빌드 결과를 서빙하도록 스크립트 추가**

`hub/package.json` 의 `scripts` 에 추가:
```json
    "serve": "WEB_DIR=../web/dist tsx src/index.ts"
```

`web` 을 빌드한 뒤 허브 하나만 띄우면 된다:
```bash
cd web && npm run build && cd ../hub && npm run serve
```

- [ ] **Step 3: README 작성**

`README.md`:
```markdown
# packtory

자동화 라인의 물류 흐름을 평면도 위에 애니메이션으로 보여주고, 막힌 구간을
찾아내고, 그 구역 CCTV를 바로 띄우는 모니터.

신입 시설 관리·유지보수 담당자가 화면을 처음 봐도 지금 라인이 도는지,
안 돌면 어디가 막혔는지 한 눈에 알 수 있게 하는 것이 목표다.

- 설계: `docs/superpowers/specs/2026-09-19-packtory-flow-monitor-design.md`
- 구현 계획: `docs/superpowers/plans/2026-09-19-packtory-flow-monitor.md`

## 구성

| 프로세스 | 하는 일 |
|---|---|
| `hub/` | 센서 카운터를 읽어 `wip`/`state`/`stallMs` 를 계산하고 WebSocket으로 민다. 웹 정적 파일도 서빙한다 |
| `web/` | 평면도 렌더링. 점 애니메이션은 CSS가 돌린다 |
| go2rtc | CCTV를 WebRTC로 브라우저에 직결한다. **영상은 허브를 통과하지 않는다** |
| `scene.json` | 층·구역·장비·구간·카메라. 전체 시스템이 이 파일 하나에 매달린다 |

## 개발 실행

```bash
# 1. 카메라 (선택). 실제 카메라가 없으면 sample.mp4 를 루프 재생한다
go2rtc -c go2rtc.yaml

# 2. 허브
cd hub && npm install && npm start

# 3. 웹 (개발 서버)
cd web && npm install && npm run dev   # http://localhost:5173
```

## 단일 프로세스로 실행

```bash
cd web && npm run build
cd ../hub && npm run serve             # http://localhost:8080
```

환경 변수: `PORT`, `SCENE`, `GO2RTC_BASE`, `WEB_DIR`.

## 테스트

```bash
cd hub && npm test
```

테스트는 허브에만 있다. 웹은 배선이라 수동으로 확인한다 — 무엇을 보고
무엇을 확인하는지는 구현 계획의 각 태스크에 적혀 있다.

## 씬 편집

`scene.json` 을 직접 고친다. 좌표 단위는 미터, 평면도 기준으로 X는 오른쪽,
Y는 위쪽이다. 허브가 부팅할 때 검증하며, 참조가 깨졌거나 장비가 구역 밖에
있으면 에러를 내고 죽는다.

WIP 숫자가 실제와 안 맞으면 구간을 비운 상태에서 `wipOffset` 에
`-(in - out)` 을 넣는다. PLC 카운터가 한 바퀴 도는 값이 있으면
`counterMax` 에 적는다 (16비트면 32767).

## 범위

읽기 전용이다. PLC에 쓰지 않는다. 히스토리·알람 통지·인증은 범위 밖이다.
화면은 **어디서** 멈췄는지까지 말한다. **왜** 멈췄는지는 사람이 CCTV를 보고
판단한다.
```

- [ ] **Step 4: 전체 완료 기준 통과 확인**

```bash
cd web && npm run build
cd ../hub && npm run serve
```
브라우저에서 `http://localhost:8080` 을 열고 스펙 11장의 12개 항목을 순서대로 확인한다:

1. [ ] 2층 평면도에 구역·장비·구간이 뜨고 가동 구간에 점이 흐른다
2. [ ] 층 탭 2개에 상태 배지가 달리고, 누르면 그 층 지도로 바뀐다
3. [ ] 40초쯤 `conv-3` 이 빨강 점선으로 바뀌고 점이 얼어붙고 개수가 늘어난다
4. [ ] 상단에 `충전부 충전 이송 정지 0:12` 칩이 뜨고 초가 올라간다
5. [ ] 1층을 보고 있어도 `2F` 탭이 빨개진다
6. [ ] 칩을 누르면 2층으로 전환되고 지도가 그 구간으로 옮겨간다
7. [ ] 구간을 클릭하면 수치와 CCTV 라이브가 뜬다 (지연 1초 미만)
8. [ ] 빈 구간은 회색 대기로 남고 칩이 안 뜬다
9. [ ] **브라우저를 새로 열어도 정지 시간이 이어서 맞다** — 정지 상태에서 새 탭으로 같은 주소를 열어 두 화면의 정지 시간이 같은지 본다
10. [ ] 리프트 마커를 클릭하면 모달이 뜬다
11. [ ] 허브를 재시작하면 자동 재접속하고 값이 이어진다
12. [ ] 포장부를 클릭하면 영상 자리 없이 수치만 뜬다

**9번이 안 되면 판정이 클라이언트로 새어나간 것이다.** `stallMs` 를 브라우저에서
계산하는 코드가 있는지 찾는다.

- [ ] **Step 5: 커밋**

```bash
git add go2rtc.yaml README.md hub/package.json
git commit -m "feat: 정적 서빙 + go2rtc 설정 + README"
```

---

## 남은 것

스펙 13장의 확장 경로. 이 계획에는 들어있지 않다.

1. 실제 어댑터 (`OpcUaAdapter`) — 허브·클라이언트 무변경
2. 씬 에디터 — 지도 위 드래그 배치
3. 정지 이력 적재 — 가동률 집계의 전제
4. 알람 통지
5. 다중 카메라 타일
6. H.265 트랜스코딩
