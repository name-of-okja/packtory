# packtory 대형 네트워크 규모 검증 구현 계획 (하위 프로젝트 A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5층·구간 약 490개·설비 약 290대의 합류·분기 네트워크 공장을 생성하고, 막힘이 상류로 번지는 모의 데이터로 돌리고, 뷰어가 그 규모를 적층(A)·계단(B) 두 배치로 한 눈에 읽히게 보여준다.

**Architecture:** 층을 어디에 그릴지를 `shared/layout.ts` 의 `floorOrigin` 한 함수로 모은 뒤(동작 불변 리팩터링), 그 위에 모드 전환을 얹는다. 구간 연결은 스키마를 바꾸지 않고 끝점 일치로 추론한다(`shared/graph.ts`). 씬 생성기(`tools/gen-scene.ts`)가 격자형 DAG 공장을 만들고, 모의 어댑터가 그 연결을 따라 물건을 흘려 back-pressure 를 만든다. 판정(`derive.ts`)은 한 가지 가짜 경보만 고친다.

**Tech Stack:** Node 24 (허브는 `tsx` 로 직접 실행), TypeScript, `node --test`, Vite + React 18, `@babylonjs/core` (개별 import).

**Spec:** `docs/superpowers/specs/2026-09-27-packtory-large-network-design.md`

## Global Constraints

- **새 의존성 금지.** 런타임은 `react`, `react-dom`, `@babylonjs/core`, `ws` 뿐. 생성기는 hub 에 이미 있는 `tsx` 로 돈다.
- 테스트 러너는 `node --test` (stdlib). **웹에는 자동 테스트를 쓰지 않는다** — 웹은 `node tools/shot.mjs <url> <png> [대기ms]` 스크린샷을 열어 눈으로 확인한다. 순수 함수는 `shared/` 에 두고 hub 쪽 `node --test` 로 시험한다.
- Babylon 은 `@babylonjs/core/...` 에서 **개별 경로로** import 한다. 새 Babylon 모듈을 들이지 않는다. 초기 로드 gzip 목표 **350KB 이하** (현재 약 312.8KB).
- 씬 스키마는 **`version: 3` 그대로**. 필드를 추가하지 않는다. 연결 필드는 하위 프로젝트 B 의 일이다.
- 카메라 기울기 `beta = 0.9553` 고정, 방위각 45°/135°/225°/315° 네 값만 — 건드리지 않는다.
- 좌표 매핑: 씬 `(x, y)` + 층 원점 `(dx, dy, elev)` → Babylon `(x + dx, elev, y + dy)`. **층 원점을 더하는 곳은 `worldAt` 하나뿐이다.**
- 모의 어댑터는 `{id}.in`/`{id}.out` 카운터와 설비 태그만 쓴다. `.state`/`.wip` 를 직접 쓰지 않는다.
- **빨강은 막힘에서만 나온다.** 랜덤(속도 흔들림·도크 휴무)만으로 stalled 가 생기면 버그다.
- 코드 주석과 사용자 대면 문자열은 한국어. 기존 파일의 주석 밀도와 어조를 따른다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 를 붙인다.

## 스펙과 달라진 점 (구현 중 실측으로 바뀐 것 — 스펙 문서도 Task 8 에서 고친다)

계획을 쓰면서 생성기·모의 어댑터·뷰어를 scratchpad 에 시제품으로 만들어 돌려 봤다. 아래는 그때 드러난 것이다.

| 스펙 | 바뀐 것 | 이유 (실측) |
|---|---|---|
| `derive.ts` 변경 없음 | **정지 시간을 "out 이 멈춘 뒤" 와 "물건이 들어차기 시작한 뒤" 중 늦은 쪽부터 센다** (`wipSinceTs`) | 비어 쉬던(idle) 구간에 물건이 다시 들어오는 순간, out 은 이미 10초 넘게 그대로이고 wip 는 1 이라 그 물건이 지날 때까지 빨강이 뜬다. 도크 휴무를 켠 대형 씬 10분에서 가짜 stalled 9 구간. 옛 mock 은 들어온 틱에 바로 내보내서 이 버그를 가렸다 |
| 컨베이어 2개/s, 리프트 1개/s 고정, 분기는 균등 분배 | 구간마다 **"source→그 구간→sink" 경로 하나에 0.2개/s 씩 흘린 합**을 정상 유량으로 삼고, 처리 속도 = 유량 / 0.7 | 균등 분배는 뒤로 갈수록 유량이 기하급수로 줄어 천 배 넘게 차이 났다. 고정 속도로는 1F 출고 분배선에 유량이 몰려 망 전체가 교착했다 |
| (없음) | 한 틱(100ms)을 **25ms 네 단계**로 흘린다, 생성 때 **2분 워밍업** | 틱 단위면 짧은 구간이 초당 capacity×10 개에서 막힌다. 빈 공장에서 시작하면 1분 남짓 줄줄이 idle |
| stair: `dx = (order−1) × (폭 + 20m)` | **`dx = −r·(폭+20)`, `dy = +r·(폭+20)`**, `r` = order 정렬 순위 | +x 로 밀면 기본 시점에서 화면 왼쪽 아래로 내려가 위층일수록 화면 아래에 그려졌다. (−x, +y) 는 화면 오른쪽이다. 순위는 order 0(지하)·번호 건너뜀에도 음수로 안 밀린다 |
| (없음) | 카메라 전체보기 배율이 **화면 가로폭**도 따진다 | 계단 배치는 가로로 길어 양 끝 층이 잘렸다 |
| 입고 도크 8 (세 면) | 서쪽 3 + 남쪽 5 (두 면) | 동쪽은 상승 리프트 집하선 자리다 |

## Review Focus

1. **쉬던 구간이 다시 받는 순간** (휴무를 마친 도크, 막힘이 풀려 다시 물건이 오는 하류) — 사람은 초록을 기대한다. 빨강이 뜨면 안 된다. → Task 2 의 `derive` 테스트가 고정한다.
2. **손으로 고친 `scene.json` 에 끝점이 제자리로 돌아오는 순환** — 허브가 조용히 멈추거나 무한 루프 대신, 무엇이 잘못됐는지 말하고 죽기를 기대한다. → Task 5 의 순환 테스트.
3. **`MOCK_SEED` 에 정수가 아닌 값** (`MOCK_SEED=abc`) — 조용히 다른 각본이 도는 대신 부팅 때 거절되기를 기대한다. → Task 5 가 `index.ts` 에서 거절한다 (배선이라 테스트 없음, 수동 확인 단계 있음).
4. **창 크기를 바꾼 뒤 ⌂(전체보기)** — 계단 배치의 다섯 층이 전부 다시 담기기를 기대한다. → Task 6 의 `fit()` 이 매번 현재 비율로 잰다. 체크리스트 항목.
5. **계단 배치에서 칩·배지를 눌렀을 때** — 옆으로 밀린 층의 그 구간/구역으로 날아가기를 기대한다(밀기 전 좌표로 가면 허공이다). → `goTo`/`goSection` 이 `mode` 를 넘긴다. 체크리스트 항목.

---

## File Structure

```
shared/
  layout.ts          층 원점 floorOrigin(scene, floorId, mode) — 층을 어디 그릴지의 유일한 출처   ← 새로
  graph.ts           끝점 일치로 연결 추론 downstream(), 위상 정렬 topoOrder()                ← 새로
  rng.ts             시드 고정 의사난수 (생성기·mock 공용)                                    ← 새로
tools/
  gen-scene.ts       대형 5층 씬 생성기 generate(seed)                                          ← 새로
scene.large.json     generate(1) 의 출력 (커밋한다)                                             ← 새로
scene.json           끝점을 이어 붙여 체인으로                                                  ← 수정
hub/
  src/derive.ts      wipSinceTs — 쉬던 구간이 다시 받는 순간의 가짜 빨강                        ← 수정
  src/adapters/mock.ts  전파 mock 로 새로 씀                                                    ← 재작성
  src/index.ts       MOCK_SEED                                                                  ← 수정
  test/layout.test.ts, graph.test.ts, gen.test.ts                                              ← 새로
  test/mock.test.ts  전파 mock 테스트로 새로 씀                                                 ← 재작성
  test/derive.test.ts  wipSinceTs 테스트                                                        ← 수정
  tsconfig.json      ../tools 포함                                                              ← 수정
  package.json       gen:large 스크립트                                                         ← 수정
web/src/
  viewer/coords.ts   worldAt(), sceneBounds/segmentPoints 가 mode 를 받는다                     ← 수정
  viewer/build.ts, flow.ts   mode 를 받는다                                                     ← 수정
  viewer/andon.ts    mode, 멀리서는 정지 신호등만                                               ← 수정
  viewer/camera.ts   SHOW_BELOW·zoomOf 의 집, 전체보기가 가로폭도 따진다                        ← 수정
  viewer/Viewer.tsx  mode 가 바뀌면 엔진째 다시 짓는다                                          ← 수정
  Labels.tsx         멀리서는 정지 라벨 + 구역 배지                                             ← 수정
  AlertBar.tsx       칩 5개 + "외 N건"                                                          ← 수정
  App.tsx            mode 상태, 전환 버튼, 5분 복귀, ?fps, ?layout                             ← 수정
  styles.css         배지·외 N건·fps                                                            ← 수정
README.md, docs/BROWSER-CHECKLIST.md, 스펙                                                     ← 수정
```

## 공통 절차: 화면 찍기

웹 태스크의 검증은 스크린샷이다. 허브를 백그라운드로 띄우고, 찍고, 끈다. **`pkill -f` 에 맨 문자열 패턴을 쓰지 마라** — 그 명령을 실행하는 셸 자신의 명령줄도 패턴에 걸려 셸이 죽는다(실측, 종료 코드 144). 아래처럼 대괄호로 자기 자신을 비껴간다.

```bash
# 띄우기 (저장소 루트에서). SCENE 을 빼면 작은 scene.json
cd web && npm run build && cd ..
(cd hub && SCENE=../scene.large.json WEB_DIR=../web/dist PORT=8091 node_modules/.bin/tsx src/index.ts > /tmp/packtory-hub.log 2>&1 &)
sleep 4 && cat /tmp/packtory-hub.log          # "packtory-hub http://127.0.0.1:8091" 이 보여야 한다

# 찍기 — 세 번째 인자는 페이지를 연 뒤 기다리는 ms
node tools/shot.mjs "http://localhost:8091/" /tmp/packtory-shot.png 8000

# 끄기
for p in $(pgrep -f "[t]sx src/index.ts"); do kill $p; done
```

찍은 PNG 는 Read 도구로 열어 본다. 헤드리스 크롬은 소프트웨어 렌더링이라 fps 는 한 자리 수로 나온다 — **스크린샷의 fps 는 성능 판단에 쓰지 마라** (Task 8 에서 사람이 실제 GPU 로 잰다).

---

### Task 1: 층 원점 함수로 모으기 (동작 불변 리팩터링)

**Files:**
- Create: `shared/layout.ts`, `hub/test/layout.test.ts`
- Modify: `web/src/viewer/coords.ts` (전체 교체), `web/src/viewer/build.ts`, `web/src/viewer/flow.ts`, `web/src/viewer/andon.ts`, `web/src/Labels.tsx`, `web/src/viewer/Viewer.tsx`, `web/src/App.tsx`

**Interfaces:**
- Produces:
  - `shared/layout.ts`: `type LayoutMode = "stack" | "stair"`, `STAIR_GAP = 20`, `STAIR_RISE = 10`, `floorOrigin(scene: Scene, floorId: string, mode: LayoutMode): { dx: number; dy: number; elev: number }`
  - `web/src/viewer/coords.ts`: `worldAt(scene, floorId, x, y, h, mode): Vector3`, `sceneBounds(scene, mode)`, `segmentPoints(scene, seg, mode)`. `toBabylon`, `BELT_Y`, `pathSampler` 는 그대로.
  - `buildStatic(bscene, scene, mode)`, `createFlow(bscene, scene, mode)`, `createAndons(bscene, scene, equipmentById, mode)`, `<Viewer scene mode onReady>`, `<Labels ctx scene values mode>`
  - `App` 에 `const [mode] = useState<LayoutMode>("stack")` (Task 6 이 setter 를 쓴다)

이 태스크가 끝나면 **화면이 한 픽셀도 안 바뀌어야 한다** — 모든 곳이 `"stack"` 을 넘기고, stack 은 기존 `floorElevation` 과 같다. stair 계산도 여기서 만들지만(순수 함수라 시험하기 쉽다) 아직 아무도 부르지 않는다.

- [ ] **Step 1: 리팩터링 전 기준 스크린샷을 찍는다 (코드를 고치기 전에!)**

작은 씬으로 띄운다 (공통 절차에서 `SCENE=...` 를 뺀다). 20초 기다려 찍는다:

```bash
cd web && npm run build && cd ..
(cd hub && WEB_DIR=../web/dist PORT=8091 node_modules/.bin/tsx src/index.ts > /tmp/packtory-hub.log 2>&1 &)
sleep 4 && node tools/shot.mjs "http://localhost:8091/" /tmp/packtory-before.png 20000
for p in $(pgrep -f "[t]sx src/index.ts"); do kill $p; done
```

Expected: `찍음: /tmp/packtory-before.png`. 열어서 2층 두 판, 설비, 신호등이 보이는지 확인해 둔다.

- [ ] **Step 2: 층 배치 테스트를 쓴다**

`hub/test/layout.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { floorOrigin, STAIR_GAP, STAIR_RISE } from "../../shared/layout.ts"
import { floorElevation } from "../../shared/types.ts"
import { loadScene } from "../src/scene.ts"
import type { Scene } from "../../shared/types.ts"

const small = loadScene(new URL("../../scene.json", import.meta.url).pathname)

/** 층 5개, 구역이 X 0~300 을 덮는 씬 */
function five(): Scene {
  const floors = [1, 2, 3, 4, 5].map((o) => ({ id: `${o}F`, label: `${o}층`, order: o, elevation: (o - 1) * 45 }))
  return {
    ...small, floors,
    sections: floors.flatMap((f) => [
      { id: `${f.id}-a`, label: "A", floor: f.id, rect: [0, 0, 100, 200] as [number, number, number, number], cameras: [] },
      { id: `${f.id}-b`, label: "B", floor: f.id, rect: [100, 0, 200, 200] as [number, number, number, number], cameras: [] },
    ]),
  }
}

test("stack 은 옆으로 안 밀고 높이는 floorElevation 그대로 — 리팩터링 전과 같은 화면", () => {
  for (const s of [small, five()])
    for (const f of s.floors)
      assert.deepEqual(floorOrigin(s, f.id, "stack"), { dx: 0, dy: 0, elev: floorElevation(s, f.id) })
})

test("stair 는 층 순서대로 (−x, +y) 로 한 칸씩 밀고 올린다", () => {
  const s = five()
  const step = 300 + STAIR_GAP
  for (const f of s.floors) {
    const r = f.order - 1
    assert.deepEqual(floorOrigin(s, f.id, "stair"), { dx: -r * step, dy: r * step, elev: r * STAIR_RISE })
  }
})

test("stair 에서 어느 두 층도 X 범위가 겹치지 않는다", () => {
  const s = five()
  const ranges = s.floors.map((f) => {
    const { dx } = floorOrigin(s, f.id, "stair")
    return [dx, dx + 300] as const
  }).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i - 1][1] < ranges[i][0], `${i} 번째 층이 겹친다`)
})

test("stair 순번은 order 의 정렬 순위다 — order 가 0 인 지하층이나 번호가 건너뛰어도 음수로 안 밀린다", () => {
  const s: Scene = { ...small, floors: [
    { id: "3F", label: "3층", order: 3 }, { id: "B1", label: "지하", order: 0 }, { id: "1F", label: "1층", order: 1 },
  ] }
  assert.equal(floorOrigin(s, "B1", "stair").elev, 0)
  assert.equal(floorOrigin(s, "1F", "stair").elev, STAIR_RISE)
  assert.equal(floorOrigin(s, "3F", "stair").elev, 2 * STAIR_RISE)
})

test("없는 층은 원점", () => {
  assert.deepEqual(floorOrigin(five(), "9F", "stair"), { dx: 0, dy: 0, elev: 0 })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/layout.test.ts`
Expected: FAIL — `Cannot find module '.../shared/layout.ts'`

- [ ] **Step 4: `shared/layout.ts` 를 만든다**

```ts
import type { Scene } from "./types.ts"
import { floorElevation } from "./types.ts"

/** 층을 늘어놓는 방식. stack = 제자리에 벌려 쌓기(기본), stair = 옆으로도 밀어 계단처럼 */
export type LayoutMode = "stack" | "stair"

/** 계단 배치에서 이웃한 층 사이의 가로 틈 (미터) */
export const STAIR_GAP = 20
/** 계단 배치에서 한 층 오를 때마다 높아지는 만큼 (미터) */
export const STAIR_RISE = 10

/**
 * 층의 원점 — 층 위의 점 (x, y) 는 (x + dx, y + dy) 에, 높이 elev 에 놓인다.
 * **층을 어디에 그릴지는 여기서만 정한다.** 지오메트리·신호등·물건·라벨·
 * 피킹·flyTo 가 전부 이것을 거쳐야 모드를 바꿔도 서로 어긋나지 않는다.
 *
 * stair 의 순번은 order 의 정렬 순위다(스펙의 order − 1 은 order 가 1 부터
 * 빈틈없을 때 이것과 같다). order 가 0 인 지하층이나 번호가 건너뛴 층이 있어도
 * 층끼리 겹치거나 음수 쪽으로 밀리지 않는다.
 */
export function floorOrigin(scene: Scene, floorId: string, mode: LayoutMode): { dx: number; dy: number; elev: number } {
  if (mode === "stack") return { dx: 0, dy: 0, elev: floorElevation(scene, floorId) }
  const rank = [...scene.floors].sort((a, b) => a.order - b.order).findIndex((f) => f.id === floorId)
  if (rank < 0) return { dx: 0, dy: 0, elev: 0 }
  // 층 가로폭은 모든 구역을 덮는 X 범위다. 층마다 달라도 가장 넓은 것으로
  // 한 칸을 잡아야 어느 층끼리도 겹치지 않는다.
  let minX = Infinity, maxX = -Infinity
  for (const s of scene.sections) {
    minX = Math.min(minX, s.rect[0])
    maxX = Math.max(maxX, s.rect[0] + s.rect[2])
  }
  const step = (Number.isFinite(minX) ? maxX - minX : 0) + STAIR_GAP
  // (−x, +y) 로 민다. 기본 시점(방위각 45°)에서 이 방향이 화면 오른쪽이라 층이
  // 1층부터 왼쪽→오른쪽으로 한 줄로 서고, STAIR_RISE 만큼씩 올라간다. +x 로 밀면
  // 화면 왼쪽 아래로 내려가 위층일수록 화면 아래에 그려진다 (실측). X 로 한 칸씩
  // 떨어지므로 어느 두 층도 겹치지 않는다.
  return { dx: -rank * step, dy: rank * step, elev: rank * STAIR_RISE }
}
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `cd hub && node --test --import tsx ./test/layout.test.ts`
Expected: `ℹ pass 5`, `ℹ fail 0`

- [ ] **Step 6: `web/src/viewer/coords.ts` 를 통째로 바꾼다**

```ts
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, Segment } from "../../../shared/types.ts"
import { equipmentHeight, isLift } from "../../../shared/types.ts"
import { floorOrigin, type LayoutMode } from "../../../shared/layout.ts"

/**
 * 씬 좌표는 평면도 기준으로 X 오른쪽, Y 위쪽이다. Babylon 은 Y 가 높이이므로
 * 씬의 Y 가 Babylon 의 Z 가 된다. **뒤집는 곳은 여기 하나뿐이다** —
 * 여기저기서 뒤집으면 어디가 뒤집혔는지 못 찾는다.
 */
export function toBabylon(x: number, y: number, elevation: number): Vector3 {
  return new Vector3(x, elevation, y)
}

/**
 * 층 위의 점 (x, y) 에서 h 만큼 위의 월드 좌표. 층 원점(floorOrigin)을 더하는
 * 곳은 여기 하나뿐이다 — 층을 옆으로 미는 모드(stair)가 있으므로 높이만
 * 더해서는 안 된다.
 */
export function worldAt(scene: Scene, floorId: string, x: number, y: number, h: number, mode: LayoutMode): Vector3 {
  const o = floorOrigin(scene, floorId, mode)
  return toBabylon(x + o.dx, y + o.dy, o.elev + h)
}

/** 모든 층·구역·설비를 담는 상자. 전체보기와 카메라 거리 계산에 쓴다 */
export function sceneBounds(scene: Scene, mode: LayoutMode): { min: Vector3; max: Vector3 } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  let minY = 0, maxY = 0
  for (const sec of scene.sections) {
    const [x, y, w, h] = sec.rect
    // 층 원점은 평행이동뿐이라 rect 의 두 모서리가 곧 월드 상자의 두 모서리다
    const a = worldAt(scene, sec.floor, x, y, 0, mode)
    const b = worldAt(scene, sec.floor, x + w, y + h, 0, mode)
    minX = Math.min(minX, a.x); maxX = Math.max(maxX, b.x)
    minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, b.z)
    minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y)
  }
  for (const e of scene.equipment) {
    const sec = scene.sections.find((s) => s.id === e.section)
    if (!sec) continue
    maxY = Math.max(maxY, floorOrigin(scene, sec.floor, mode).elev + equipmentHeight(e))
  }
  if (!Number.isFinite(minX)) return { min: new Vector3(0, 0, 0), max: new Vector3(40, 6, 25) }
  return { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) }
}

/** 컨베이어 벨트면 높이. 바닥에 붙어 있으면 물건이 바닥을 미끄러지는 것처럼 보인다 */
export const BELT_Y = 0.8

/**
 * 구간의 월드 점열. 리프트는 출발점에서 올라가는 세로 기둥 다음 도착 층의
 * 가로 구간이고, 평면 구간은 from → via… → to 의 폴리라인이다.
 */
export function segmentPoints(scene: Scene, seg: Segment, mode: LayoutMode): Vector3[] {
  const start = worldAt(scene, seg.from.floor, seg.from.x, seg.from.y, BELT_Y, mode)
  const end = worldAt(scene, seg.to.floor, seg.to.x, seg.to.y, BELT_Y, mode)
  if (isLift(seg)) {
    // 스펙은 리프트를 "두 층을 잇는 세로 기둥" 으로 규정한다(구성 요소 표, 완료 기준 10).
    // 두 끝을 그냥 직선으로 이으면 데모 씬의 lift-1 처럼 수평 33m·수직 6m 인
    // 경우 2도짜리 사면이 돼서 옆 컨베이어와 구별이 안 된다 — 층을 잇는다는
    // 것이 화면에서 읽히지 않는다. 출발점에서 수직으로 올린 뒤 도착 층에서 보낸다.
    // 기둥은 출발 층 자리에서 도착 층 높이까지 곧게 선다. stair 모드에서는
    // 도착 층이 옆으로 밀려 있으므로 거기서 가로 구간이 층 사이 틈을 건넌다.
    const pts = [start, new Vector3(start.x, end.y, start.z)]
    // 수직으로만 올라가는 리프트면 가로 구간을 더하지 않는다 — 길이 0 인 구간을
    // 넣으면 CreateTube 가 법선을 못 구해 메시가 깨진다. 씬 좌표가 아니라 월드
    // 좌표로 비교한다 — stair 에서는 x, y 가 같은 리프트도 층 원점이 다르다.
    if (end.x !== start.x || end.z !== start.z) pts.push(end)
    return pts
  }
  return [
    start,
    ...(seg.via ?? []).map(([x, y]) => worldAt(scene, seg.from.floor, x, y, BELT_Y, mode)),
    end,
  ]
}

/**
 * 폴리라인 위를 0..1 로 훑는다. 물건 배치에 쓴다.
 * t 는 순환값이다 — Task 6 이 `phase - i * gap` 으로 물건마다 위상을 어긋나게
 * 놓기 때문에 t 가 일상적으로 음수가 된다. `((t % 1) + 1) % 1` 로 [0,1) 에
 * 되감아서, 경로 끝을 넘어간 물건이 시작으로 이어지게 한다. 클램프로 바꾸면
 * t<0 인 물건이 전부 시작점 한 점에 쌓인다.
 */
export function pathSampler(points: Vector3[]): { length: number; at(t: number): Vector3 } {
  const segLen: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = Vector3.Distance(points[i - 1], points[i])
    segLen.push(d)
    total += d
  }
  return {
    length: Math.max(total, 0.001),
    at(t: number) {
      const want = ((t % 1) + 1) % 1 * total
      let acc = 0
      for (let i = 0; i < segLen.length; i++) {
        if (acc + segLen[i] >= want) {
          const k = segLen[i] === 0 ? 0 : (want - acc) / segLen[i]
          return Vector3.Lerp(points[i], points[i + 1], k)
        }
        acc += segLen[i]
      }
      return points[points.length - 1].clone()
    },
  }
}
```

- [ ] **Step 7: `build.ts` 를 고친다**

import 두 줄을 바꾼다:

```ts
// 전
import { equipmentHeight, equipmentShape, floorElevation } from "../../../shared/types.ts"
import { segmentPoints, toBabylon } from "./coords.ts"
// 후
import { equipmentHeight, equipmentShape } from "../../../shared/types.ts"
import type { LayoutMode } from "../../../shared/layout.ts"
import { segmentPoints, worldAt } from "./coords.ts"
```

시그니처: `export function buildStatic(bscene: BScene, scene: Scene): StaticMeshes {` → `export function buildStatic(bscene: BScene, scene: Scene, mode: LayoutMode): StaticMeshes {`

바닥판:

```ts
// 전
    const elev = floorElevation(scene, sec.floor)
    const slab = CreateBox(`sec:${sec.id}`, { width: w, height: SLAB, depth: h }, bscene)
    slab.position = toBabylon(x + w / 2, y + h / 2, elev - SLAB / 2)
// 후
    const slab = CreateBox(`sec:${sec.id}`, { width: w, height: SLAB, depth: h }, bscene)
    slab.position = worldAt(scene, sec.floor, x + w / 2, y + h / 2, -SLAB / 2, mode)
```

설비: `const elev = floorElevation(scene, sec.floor)` 줄을 지우고,

```ts
// 전
    mesh.position = toBabylon(e.pos[0], e.pos[1], elev + ht / 2)
// 후
    mesh.position = worldAt(scene, sec.floor, e.pos[0], e.pos[1], ht / 2, mode)
```

구간: `const pts = segmentPoints(scene, seg)` → `const pts = segmentPoints(scene, seg, mode)`

- [ ] **Step 8: `flow.ts` 를 고친다**

```ts
// import 추가 (coords import 위)
import type { LayoutMode } from "../../../shared/layout.ts"
// 시그니처
export function createFlow(bscene: BScene, scene: Scene, mode: LayoutMode): Flow {
// 샘플러
      sampler: pathSampler(segmentPoints(scene, seg, mode)),
```

- [ ] **Step 9: `andon.ts` 를 고친다**

```ts
// 전
import { equipmentHeight, floorElevation } from "../../../shared/types.ts"
// 후
import { equipmentHeight } from "../../../shared/types.ts"
import { floorOrigin, type LayoutMode } from "../../../shared/layout.ts"
```

`createAndons` 의 매개변수 끝에 `mode: LayoutMode,` 를 더한다 (`equipmentById` 다음). 루프 안:

```ts
    const pts = segmentPoints(scene, seg, mode)
    ...
    const base = floorOrigin(scene, seg.to.floor, mode).elev
```

- [ ] **Step 10: `Labels.tsx` 를 고친다**

```ts
// 전
import { equipmentHeight, floorElevation } from "../../shared/types.ts"
import { segState, segStallMs, segWip, formatStall } from "./state.ts"
import { toBabylon, segmentPoints, pathSampler } from "./viewer/coords.ts"
// 후
import { equipmentHeight } from "../../shared/types.ts"
import type { LayoutMode } from "../../shared/layout.ts"
import { segState, segStallMs, segWip, formatStall } from "./state.ts"
import { worldAt, segmentPoints, pathSampler } from "./viewer/coords.ts"
```

props 에 `mode: LayoutMode` 를 더한다 (`export default function Labels({ ctx, scene, values, mode }: { ...; mode: LayoutMode })`). 설비 라벨:

```ts
// 전
        const top = floorElevation(scene, sec.floor) + equipmentHeight(e) + 0.4
        const p = projectToScreen(bscene, toBabylon(e.pos[0], e.pos[1], top))
// 후
        const p = projectToScreen(bscene, worldAt(scene, sec.floor, e.pos[0], e.pos[1], equipmentHeight(e) + 0.4, mode))
```

구간 라벨: `const pts = segmentPoints(scene, seg)` → `const pts = segmentPoints(scene, seg, mode)`. effect 의존성 `[ctx, scene, values]` → `[ctx, scene, values, mode]`.

- [ ] **Step 11: `Viewer.tsx` 를 고친다**

```ts
// import 추가
import type { LayoutMode } from "../../../shared/layout.ts"
// Props 에 추가 (scene 다음)
  /** 바뀌면 엔진째 다시 짓는다 — 모드 전환은 전부 버리고 새로 그린다 (스펙 6장) */
  mode: LayoutMode
// 함수 시그니처
export default function Viewer({ scene, mode, onReady }: Props) {
// 카메라
    const cam = createCamera(bscene, canvas, sceneBounds(scene, mode))
// effect 의존성
  }, [scene, mode])
```

- [ ] **Step 12: `App.tsx` 를 고친다**

```ts
// import 추가 (Segment import 다음)
import type { LayoutMode } from "../../shared/layout.ts"
// 상태 추가 (ctx 다음 줄). setter 는 Task 6 이 쓴다
  const [mode] = useState<LayoutMode>("stack")
// goTo
    const pts = segmentPoints(data.scene, seg, mode)
// <Viewer> 에 prop 추가
          mode={mode}
// onReady 안
            const statics = buildStatic(bscene, data.scene, mode)
            const flow = createFlow(bscene, data.scene, mode)
            const andons = createAndons(bscene, data.scene, statics.equipmentById, mode)
// Labels
        <Labels ctx={ctx} scene={data.scene} values={values} mode={mode} />
```

- [ ] **Step 13: 타입체크하고 `floorElevation` 직접 호출이 웹에 안 남았는지 본다**

Run: `cd web && npx tsc --noEmit && grep -rn "floorElevation" src/`
Expected: tsc 출력 없음. grep 출력 없음 (웹은 이제 `floorOrigin` 만 거친다).

- [ ] **Step 14: 리팩터링 후 스크린샷을 찍어 전과 비교한다**

Step 1 과 같은 명령으로 `/tmp/packtory-after.png` 를 찍는다. 두 PNG 를 Read 로 열어 **바닥판·설비·벨트·신호등 기둥의 위치와 크기, 카메라 배율이 같은지** 본다. 물건 개수와 신호등 색은 찍은 시각에 따라 다를 수 있다 — 그건 데이터지 기하가 아니다. 위치가 하나라도 다르면 멈추고 원인을 찾는다.

- [ ] **Step 15: 허브 전체 테스트와 커밋**

Run: `cd hub && npm test`
Expected: `ℹ fail 0` (기존 43 + 새 5 = 48)

```bash
git add shared/layout.ts hub/test/layout.test.ts web/src
git commit -m "refactor(viewer): 층 원점을 floorOrigin 한 곳으로 모은다

화면은 바뀌지 않는다 — 모든 곳이 stack 을 넘기고 stack 은 기존
floorElevation 과 같다. 계단 배치(stair) 계산은 순수 함수로 먼저 둔다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 쉬던 구간이 다시 받는 순간의 가짜 빨강을 없앤다 (`derive`)

**Files:**
- Modify: `hub/src/derive.ts`, `hub/test/derive.test.ts`

**Interfaces:**
- Produces: `SegMemory` 에 선택 필드 `wipSinceTs?: number` (구간에 물건이 들어차기 시작한 시각, 비어 있으면 없음). `derive()` 시그니처는 그대로.

지금은 "out 이 stallSec 동안 그대로 + wip > 0" 이면 stalled 다. 비어 쉬던 구간에 물건 하나가 막 들어온 순간도 이 조건을 만족한다 — out 은 이미 오래 그대로였으니까. 그 물건이 구간을 다 지날 때까지 빨강이 뜬다. 고치는 방법: 정지 시간을 `max(out 이 멈춘 시각, 물건이 들어차기 시작한 시각)` 부터 센다. 막힌 구간은 물건이 계속 차 있으므로 그대로 잡힌다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`hub/test/derive.test.ts` 맨 끝에 붙인다:

```ts

test("비어서 쉬던 구간에 물건이 다시 들어온 순간은 stalled 가 아니다", () => {
  // 0초에 비어 out 이 90 에서 멎었다(idle). 30초 뒤 물건 하나가 들어왔다.
  // out 만 보면 30초째 정체 + wip 1 이라 빨강이지만, 그 물건은 방금 왔다.
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 90, lastOut: 90, lastOutChangeTs: 0 }]])
  const { tags, next } = derive([SEG], vals(91, 90), prev, 30_000, STALL)
  assert.equal(pick(tags, "state").v, "running")
  assert.equal(next.get("c1")!.wipSinceTs, 30_000)
  // 그 물건이 stallSec 넘게 안 나가면 그때는 막힘이다. 정지 시간은 들어찬 때부터 센다
  const r2 = derive([SEG], vals(95, 90), next, 45_000, STALL)
  assert.equal(pick(r2.tags, "state").v, "stalled")
  assert.equal(pick(r2.tags, "stallMs").v, 15_000)
})

test("구간이 비면 들어찬 시각을 잊는다", () => {
  const prev = new Map<string, SegMemory>([["c1", { lastIn: 91, lastOut: 90, lastOutChangeTs: 0, wipSinceTs: 5_000 }]])
  const { next } = derive([SEG], vals(91, 91), prev, 8_000, STALL)
  assert.equal(next.get("c1")!.wipSinceTs, undefined)
})
```

그리고 첫 테스트("첫 관측은 기준선만 잡고 running 으로 시작한다")의 기억 기대값을 바꾼다 — 첫 관측에 wip 10 이므로 들어찬 시각도 기록된다:

```ts
// 전
  assert.deepEqual(next.get("c1"), { lastIn: 100, lastOut: 90, lastOutChangeTs: 1000 })
// 후
  assert.deepEqual(next.get("c1"), { lastIn: 100, lastOut: 90, lastOutChangeTs: 1000, wipSinceTs: 1000 })
```

(PLC 재기동 재기준선 테스트의 기대값 `{ lastIn: 5, lastOut: 3, lastOutChangeTs: 20_000 }` 은 **그대로 둔다** — 그 경로는 state 를 unknown 으로 내므로 들어찬 시각을 기록하지 않는다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/derive.test.ts`
Expected: FAIL 2건 — "비어서 쉬던…" 은 `'stalled' !== 'running'`, "첫 관측…" 은 `wipSinceTs` 필드 불일치. "구간이 비면…" 은 지금도 통과한다(옛 코드는 그 필드를 아예 안 쓴다) — 고친 뒤에 잊지 않는지를 지키는 회귀 테스트다.

- [ ] **Step 3: `derive.ts` 를 고친다**

`SegMemory` 에 필드를 더한다:

```ts
export type SegMemory = {
  lastIn: number
  lastOut: number
  lastOutChangeTs: number
  /** 구간에 물건이 들어차기 시작한 시각. 비어 있으면 없다 */
  wipSinceTs?: number
}
```

첫 관측 분기:

```ts
// 전
    if (!mem) {
      next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs: now })
      tags.push(...emit(seg.id, wipOf(seg, inN, outN), "running", 0, now, "good"))
      continue
    }
// 후
    if (!mem) {
      const w0 = wipOf(seg, inN, outN)
      next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs: now, ...(w0 > 0 && { wipSinceTs: now }) })
      tags.push(...emit(seg.id, w0, "running", 0, now, "good"))
      continue
    }
```

정상 분기:

```ts
// 전
    const lastOutChangeTs = dOut > 0 ? now : mem.lastOutChangeTs
    next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs })

    const wip = wipOf(seg, inN, outN)
    const since = now - lastOutChangeTs
// 후
    const lastOutChangeTs = dOut > 0 ? now : mem.lastOutChangeTs
    const wip = wipOf(seg, inN, outN)
    // 직전에도 차 있었으면 그때부터, 방금 차기 시작했으면 지금부터. 기록이 없는
    // 옛 기억(허브가 이 필드 전에 남긴 것)은 out 이 멈춘 시각으로 본다 — 예전 판정과 같다.
    const wasFull = wipOf(seg, mem.lastIn, mem.lastOut) > 0
    const wipSinceTs = wip > 0 ? (wasFull ? mem.wipSinceTs ?? mem.lastOutChangeTs : now) : undefined
    next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs, ...(wipSinceTs !== undefined && { wipSinceTs }) })

    // 정지 시간은 "out 이 멈춘 뒤" 와 "물건이 들어차기 시작한 뒤" 중 늦은 쪽부터
    // 센다. out 만 보면, 비어서 쉬던(idle) 구간에 물건 하나가 다시 들어오는 순간 —
    // out 은 이미 stallSec 넘게 그대로이고 wip 는 1 — 그 물건이 구간을 다 지날
    // 때까지 빨강이 뜬다. 사고가 아닌데 빨강이 뜨면 아무도 화면을 안 본다.
    // 막힌 구간은 물건이 계속 들어차 있으므로 그대로 잡힌다.
    const since = now - Math.max(lastOutChangeTs, wipSinceTs ?? lastOutChangeTs)
```

`since` 아래(`running`/`stalled`/`idle` 분기)는 그대로 둔다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd hub && npm test`
Expected: `ℹ fail 0` (48 + 2 = 50). 기존 derive 테스트는 옛 기억(`wipSinceTs` 없음, 직전 wip > 0)이라 `mem.lastOutChangeTs` 로 떨어져 예전과 같게 판정된다.

- [ ] **Step 5: 커밋**

```bash
git add hub/src/derive.ts hub/test/derive.test.ts
git commit -m "fix(hub): 쉬던 구간에 물건이 다시 들어온 순간 빨강이 뜨던 것을 고친다

정지 시간을 out 이 멈춘 시각과 물건이 들어차기 시작한 시각 중 늦은
쪽부터 센다. 옛 모의 어댑터는 들어온 틱에 바로 내보내서 가려져 있었다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 연결 추론과 시드 난수 (`shared/graph.ts`, `shared/rng.ts`)

**Files:**
- Create: `shared/graph.ts`, `shared/rng.ts`, `hub/test/graph.test.ts`

**Interfaces:**
- Produces:
  - `downstream(scene: Scene): Map<string, string[]>` — 구간 id → 하류 구간 id 들 (씬의 구간 순서). 하류 없음 = 빈 배열.
  - `topoOrder(down: Map<string, string[]>): string[] | null` — 상류가 먼저. 순환이면 `null`.
  - `rng(seed: number): () => number` — [0, 1) 의 수열. 같은 시드면 같은 수열.

- [ ] **Step 1: 테스트를 쓴다**

`hub/test/graph.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/graph.test.ts`
Expected: FAIL — `Cannot find module '.../shared/graph.ts'`

- [ ] **Step 3: `shared/graph.ts` 를 만든다**

```ts
import type { Endpoint, Scene } from "./types.ts"

const key = (e: Endpoint) => `${e.floor}:${e.x}:${e.y}`

/**
 * 구간 id → 하류 구간 id 들. X 의 to 와 Y 의 from 이 같은 층·같은 좌표면
 * X → Y 로 이어진 것이다. 스키마에 연결 필드가 없으므로(하위 프로젝트 B 에서
 * 넣는다) 끝점 일치가 연결의 유일한 근거다 — 생성기가 이어지는 끝점을 정확히
 * 같은 값으로 찍는다.
 */
export function downstream(scene: Scene): Map<string, string[]> {
  const byFrom = new Map<string, string[]>()
  for (const s of scene.segments) {
    const k = key(s.from)
    byFrom.set(k, [...(byFrom.get(k) ?? []), s.id])
  }
  return new Map(scene.segments.map((s) => [s.id, byFrom.get(key(s.to)) ?? []]))
}

/** 위상 순서(상류가 먼저). 순환이 있으면 null */
export function topoOrder(down: Map<string, string[]>): string[] | null {
  const indeg = new Map<string, number>([...down.keys()].map((id) => [id, 0]))
  for (const ds of down.values()) for (const d of ds) indeg.set(d, (indeg.get(d) ?? 0) + 1)
  const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id)
  const out: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    out.push(id)
    for (const d of down.get(id) ?? []) {
      const n = indeg.get(d)! - 1
      indeg.set(d, n)
      if (n === 0) queue.push(d)
    }
  }
  return out.length === down.size ? out : null
}
```

- [ ] **Step 4: `shared/rng.ts` 를 만든다** (Task 4·5 가 쓴다. 한 파일에 한 함수)

```ts
/** 시드 고정 의사난수 (mulberry32). 같은 시드면 같은 수열 — 데모와 테스트의 재현성 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 5: 통과를 확인하고 커밋한다**

Run: `cd hub && npm test`
Expected: `ℹ fail 0` (50 + 5 = 55)

```bash
git add shared/graph.ts shared/rng.ts hub/test/graph.test.ts
git commit -m "feat(shared): 끝점 일치로 구간 연결을 추론한다

스키마에 연결 필드를 넣지 않고(하위 프로젝트 B 의 일), 이어지는 구간의
끝점 좌표가 같다는 것만으로 하류를 안다. 시드 난수도 함께 둔다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 대형 씬 생성기와 `scene.large.json`

**Files:**
- Create: `tools/gen-scene.ts`, `hub/test/gen.test.ts`, `scene.large.json` (생성물)
- Modify: `hub/tsconfig.json` (include), `hub/package.json` (scripts)

**Interfaces:**
- Consumes: `rng` (Task 3), `downstream`/`topoOrder` (Task 3, 테스트만), `validateScene` (`hub/src/scene.ts`)
- Produces: `generate(seed: number): Scene`. 구간 id: 격자 `f{층}-c{3자리}`, `dock-in1..8`, `bridge-1..2`, `dock-out1..4`, `lift-u1..6`, `lift-d1..6`. 설비 id `f{층}-m{3자리}`. 구역 id `f{층}-s{행}{열}`.

공장 모양은 스펙 4장, 순환이 없는 이유는 파일 머리 주석에 있다. 시제품으로 시드 1, 2, 3, 7, 42 를 돌려 구간 467~493, 설비 244~286, 검증 에러 0, DAG, 도달성 100%, 차수 최대 3 을 확인했다.

- [ ] **Step 1: 허브 타입체크가 `tools/` 를 보게 한다**

`hub/tsconfig.json`:

```json
// 전
  "include": ["src/**/*.ts", "test/**/*.ts", "../shared/**/*.ts"]
// 후
  "include": ["src/**/*.ts", "test/**/*.ts", "../shared/**/*.ts", "../tools/**/*.ts"]
```

`hub/package.json` 의 `scripts` 에 한 줄 더한다 (`typecheck` 다음):

```json
    "typecheck": "tsc --noEmit",
    "gen:large": "tsx ../tools/gen-scene.ts --seed 1 > ../scene.large.json"
```

- [ ] **Step 2: 테스트를 쓴다**

`hub/test/gen.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { generate } from "../../tools/gen-scene.ts"
import { validateScene } from "../src/scene.ts"
import { downstream, topoOrder } from "../../shared/graph.ts"
import type { Scene } from "../../shared/types.ts"

const SEEDS = [1, 2, 3, 42]

function upstream(down: Map<string, string[]>) {
  const up = new Map<string, string[]>([...down.keys()].map((id) => [id, []]))
  for (const [id, ds] of down) for (const d of ds) up.get(d)!.push(id)
  return up
}
function reach(starts: string[], next: Map<string, string[]>) {
  const seen = new Set(starts)
  const stack = [...starts]
  while (stack.length) for (const n of next.get(stack.pop()!)!) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  return seen
}

for (const seed of SEEDS) {
  const s: Scene = generate(seed)
  const down = downstream(s)
  const up = upstream(down)

  test(`seed ${seed}: 검증 에러 0`, () => {
    assert.deepEqual(validateScene(s).errors, [])
  })

  test(`seed ${seed}: 규모 — 5층, 구간 400~500, 설비 250~350`, () => {
    assert.equal(s.floors.length, 5)
    assert.ok(s.segments.length >= 400 && s.segments.length <= 500, `구간 ${s.segments.length}`)
    assert.ok(s.equipment.length >= 250 && s.equipment.length <= 350, `설비 ${s.equipment.length}`)
  })

  test(`seed ${seed}: 순환 없음`, () => {
    assert.notEqual(topoOrder(down), null)
  })

  test(`seed ${seed}: 모든 구간이 source 에서 닿고 sink 로 빠진다`, () => {
    const sources = s.segments.filter((g) => up.get(g.id)!.length === 0).map((g) => g.id)
    const sinks = s.segments.filter((g) => down.get(g.id)!.length === 0).map((g) => g.id)
    assert.equal(sources.length, 10, "입고 도크 8 + 연결 브리지 2")
    assert.equal(sinks.length, 4, "출고 도크 4")
    assert.equal(reach(sources, down).size, s.segments.length, "source 에서 안 닿는 구간이 있다")
    assert.equal(reach(sinks, up).size, s.segments.length, "sink 로 안 빠지는 구간이 있다")
  })

  test(`seed ${seed}: 합류·분기 차수 3 이하`, () => {
    for (const [id, ds] of down) assert.ok(ds.length <= 3, `${id} 분기 ${ds.length}`)
    for (const [id, us] of up) assert.ok(us.length <= 3, `${id} 합류 ${us.length}`)
  })
}

test("같은 시드 → 같은 출력, 다른 시드 → 다른 출력", () => {
  assert.equal(JSON.stringify(generate(1)), JSON.stringify(generate(1)))
  assert.notEqual(JSON.stringify(generate(1)), JSON.stringify(generate(2)))
})

test("커밋된 scene.large.json 은 seed 1 의 출력과 같다 — 생성기를 고치고 다시 안 돌린 채 커밋하면 걸린다", () => {
  const committed = readFileSync(new URL("../../scene.large.json", import.meta.url), "utf8")
  assert.equal(committed, JSON.stringify(generate(1), null, 2) + "\n")
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/gen.test.ts`
Expected: FAIL — `Cannot find module '.../tools/gen-scene.ts'`

- [ ] **Step 4: `tools/gen-scene.ts` 를 만든다**

```ts
// 대형 5층 네트워크 씬 생성기 (스펙 4장).
//
//   cd hub && npm run gen:large     (= tsx ../tools/gen-scene.ts --seed 1 > ../scene.large.json)
//
// 같은 시드면 바이트 단위로 같은 출력을 낸다. 공장 모양:
//   1F 입고(남쪽 절반): 도크 8 → 동쪽으로 흐르는 격자 → 동쪽 집하선 → 상승 리프트 6
//   2F~5F: 상승 리프트 도착 → 서쪽으로 흐르는 격자 → 서쪽 집하선 → 하강 리프트 6
//   1F 출고(북쪽 절반): 하강 리프트 도착 → 동쪽으로 흐르는 격자 → 출고 도크 4
//   2F 에는 남쪽 연결 브리지 2곳이 더 들어온다.
//
// 순환이 생기지 않는 이유: 가로줄은 층마다 한 방향으로만 흐르고, 세로줄은
// 한 기둥 안에서 한 방향이다. 가로 이동 없이 돌아오는 순환은 한 세로줄
// 안에서만 가능한데 세로줄은 한 방향이라 불가능하다. 층 사이는 1F 입고 →
// 위층 → 1F 출고 로만 이어진다.
import { pathToFileURL } from "node:url"
import type { Camera, Endpoint, Equipment, Scene, Section, Segment } from "../shared/types.ts"
import { rng } from "../shared/rng.ts"

/** 격자 기둥 x. 구역 경계(100, 200)에 걸리는 값이 없어야 한다 */
const XS = Array.from({ length: 12 }, (_, i) => 10 + 25 * i) // 10 … 285
const WEST = XS[0]
const EAST = XS[XS.length - 1]
const UPPER_ROWS = [15, 50, 85, 120, 155, 190]
const IN_ROWS = [15, 45, 75]
const OUT_ROWS = [115, 150, 185]
/** [집하선 y, 도착 층 order]. 1F 입고 동쪽 집하선에서 수직으로 오른다 */
const UP_LIFTS: [number, number][] = [[15, 2], [30, 3], [45, 4], [60, 5], [75, 2], [90, 4]]
/** [집하선 y, 출발 층 order]. 위층 서쪽 집하선에서 1F 출고로 수직으로 내린다 */
const DOWN_LIFTS: [number, number][] = [[110, 2], [125, 3], [140, 4], [155, 5], [170, 3], [185, 5]]
/** 가운데 기둥에 세로 연결이 놓일 확률. 구간 수를 400~500 에 맞추는 손잡이 */
const VERTICAL_P = 0.25
const FLOOR_GAP = 45
const STREAMS = ["cam-in-1", "cam-fill-1", "cam-fill-2"]

type Kind = "row" | "col" | "spine" | "dock-in" | "bridge" | "dock-out" | "lift-up" | "lift-down"

export function generate(seed: number): Scene {
  const rand = rng(seed)
  const floors = [1, 2, 3, 4, 5].map((o) => ({
    id: `${o}F`, label: `${o}층`, order: o, elevation: (o - 1) * FLOOR_GAP,
  }))

  // ── 구역: 층마다 100×100 을 3×2 ─────────────────────────
  const sections: Section[] = []
  const cameras: Camera[] = []
  for (const f of floors) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const letter = "ABC"[col]
        const label = f.order === 1
          ? `1층 ${row === 0 ? "입고" : "출고"} ${letter}`
          : `${f.label} ${"ABCDEF"[row * 3 + col]}구역`
        const id = `f${f.order}-s${row}${col}`
        const cams: string[] = []
        // 구역 절반에만 카메라를 둔다 — 현장에서도 모든 구역에 있지는 않다
        if ((row + col) % 2 === 0) {
          const cid = `cam-${id}`
          cameras.push({ id: cid, label: `${label} 상부`, stream: STREAMS[cameras.length % STREAMS.length] })
          cams.push(cid)
        }
        sections.push({ id, label, floor: f.id, rect: [col * 100, row * 100, 100, 100], cameras: cams })
      }
    }
  }
  const sectionAt = (floorOrder: number, x: number, y: number) =>
    sections.find((s) => s.floor === `${floorOrder}F`
      && x >= s.rect[0] && x < s.rect[0] + s.rect[2]
      && y >= s.rect[1] && y < s.rect[1] + s.rect[3])!

  // ── 구간 ───────────────────────────────────────────────
  const segments: Segment[] = []
  const kinds = new Map<string, Kind>()
  const perFloor = new Map<number, number>()
  const counters = new Map<string, number>()
  const nextN = (k: string) => { const n = (counters.get(k) ?? 0) + 1; counters.set(k, n); return n }

  const add = (kind: Kind, from: Endpoint, to: Endpoint, id?: string, label?: string) => {
    const fo = Number(from.floor[0])
    const sec = sectionAt(fo, from.x, from.y)
    if (!id) {
      const n = (perFloor.get(fo) ?? 0) + 1
      perFloor.set(fo, n)
      id = `f${fo}-c${String(n).padStart(3, "0")}`
      const word = kind === "row" ? "이송" : kind === "col" ? "연결" : "집하"
      label = `${sec.label.replace("구역", "")}-${n} ${word}`
    }
    const len = Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
    const lift = from.floor !== to.floor
    segments.push({
      id, label: label!, section: sec.id, from, to,
      capacity: lift ? 4 : Math.max(4, Math.round(len * 0.5)),
    })
    kinds.set(id, kind)
  }
  const at = (fo: number, x: number, y: number): Endpoint => ({ floor: `${fo}F`, x, y })

  /**
   * 한 층(또는 1F 의 절반) 격자. 가로줄은 dir 방향으로 흐르고, 입구 기둥의
   * 분배선은 entryRoot 에서 멀어지는 쪽으로, 출구 기둥의 집하선은 exitRoot 로
   * 모이는 쪽으로 흐른다. 그래서 root 에서 모든 줄이 닿고 모든 줄이 root 로 빠진다.
   */
  const grid = (fo: number, rows: number[], dir: 1 | -1,
    entryYs: number[], entryRoot: number, exitYs: number[], exitRoot: number) => {
    const xs = dir === 1 ? XS : [...XS].reverse()
    const entryX = xs[0], exitX = xs[xs.length - 1]

    for (const y of rows)
      for (let i = 1; i < xs.length; i++) add("row", at(fo, xs[i - 1], y), at(fo, xs[i], y))

    const spine = (x: number, extra: number[], root: number, away: boolean) => {
      const ys = [...new Set([...rows, ...extra])].sort((a, b) => a - b)
      for (let i = 1; i < ys.length; i++) {
        const [a, b] = [ys[i - 1], ys[i]]
        // away: root 에서 멀어지게. 아니면 root 로 모이게.
        const up = away ? a >= root : b <= root
        add("spine", at(fo, x, up ? a : b), at(fo, x, up ? b : a))
      }
    }
    spine(entryX, entryYs, entryRoot, true)
    spine(exitX, exitYs, exitRoot, false)

    // 가운데 기둥: 기둥마다 한 방향(번갈아), 칸마다 확률로 놓는다
    for (let c = 1; c < xs.length - 1; c++) {
      const up = c % 2 === 0
      for (let r = 1; r < rows.length; r++) {
        if (rand() >= VERTICAL_P) continue
        const [a, b] = [rows[r - 1], rows[r]]
        add("col", at(fo, xs[c], up ? a : b), at(fo, xs[c], up ? b : a))
      }
    }
  }

  // 1F 입고: 서쪽 도크 3 + 남쪽 도크 5 → 동쪽 집하선 → 상승 리프트
  grid(1, IN_ROWS, 1, [], IN_ROWS[0], UP_LIFTS.map(([y]) => y), UP_LIFTS[UP_LIFTS.length - 1][0])
  for (const y of IN_ROWS) {
    const n = nextN("dock-in")
    add("dock-in", at(1, 0, y), at(1, WEST, y), `dock-in${n}`, `입고 도크 ${n}`)
  }
  for (const x of [XS[0], XS[2], XS[4], XS[6], XS[8]]) {
    const n = nextN("dock-in")
    add("dock-in", at(1, x, 0), at(1, x, IN_ROWS[0]), `dock-in${n}`, `입고 도크 ${n}`)
  }

  // 1F 출고: 하강 리프트 도착 → 동쪽 3 + 북쪽 1 출고 도크
  const downYs = DOWN_LIFTS.map(([y]) => y)
  grid(1, OUT_ROWS, 1, downYs, Math.min(...downYs), [], OUT_ROWS[OUT_ROWS.length - 1])
  for (const y of OUT_ROWS) {
    const n = nextN("dock-out")
    add("dock-out", at(1, EAST, y), at(1, 300, y), `dock-out${n}`, `출고 도크 ${n}`)
  }
  {
    const n = nextN("dock-out")
    const y = OUT_ROWS[OUT_ROWS.length - 1]
    add("dock-out", at(1, EAST, y), at(1, EAST, 200), `dock-out${n}`, `출고 도크 ${n}`)
  }

  // 2F~5F: 동쪽 분배선(상승 리프트 도착) → 서쪽으로 → 서쪽 집하선(하강 리프트 출발)
  for (let fo = 2; fo <= 5; fo++) {
    const ups = UP_LIFTS.filter(([, o]) => o === fo).map(([y]) => y)
    const downs = DOWN_LIFTS.filter(([, o]) => o === fo).map(([y]) => y)
    grid(fo, UPPER_ROWS, -1, ups, Math.min(...ups), downs, Math.min(...downs))
  }
  for (const x of [XS[4], XS[7]]) {
    const n = nextN("bridge")
    add("bridge", at(2, x, 0), at(2, x, UPPER_ROWS[0]), `bridge-${n}`, `연결 브리지 ${n}`)
  }

  // 리프트: 전부 수직이다(출발과 도착의 x, y 가 같다)
  UP_LIFTS.forEach(([y, fo], i) =>
    add("lift-up", at(1, EAST, y), at(fo, EAST, y), `lift-u${i + 1}`, `상승 리프트 ${i + 1}`))
  DOWN_LIFTS.forEach(([y, fo], i) =>
    add("lift-down", at(fo, WEST, y), at(1, WEST, y), `lift-d${i + 1}`, `하강 리프트 ${i + 1}`))

  // ── 설비: 합류점 머지기, 분기점 분류기, 가로줄 셋 중 하나에 가공기 ──
  const equipment: Equipment[] = []
  const nodeKey = (e: Endpoint) => `${e.floor}:${e.x}:${e.y}`
  const inDeg = new Map<string, number>(), outDeg = new Map<string, number>()
  const nodeAt = new Map<string, Endpoint>()
  for (const s of segments) {
    if (s.from.floor !== s.to.floor) continue // 리프트 끝은 설비를 두지 않는다 — 리프트 자체가 설비다
    outDeg.set(nodeKey(s.from), (outDeg.get(nodeKey(s.from)) ?? 0) + 1)
    inDeg.set(nodeKey(s.to), (inDeg.get(nodeKey(s.to)) ?? 0) + 1)
    nodeAt.set(nodeKey(s.from), s.from); nodeAt.set(nodeKey(s.to), s.to)
  }
  const perFloorEq = new Map<number, number>()
  const addEq = (fo: number, x: number, y: number, what: string, size: [number, number],
    height: number, shape: "box" | "cylinder") => {
    const n = (perFloorEq.get(fo) ?? 0) + 1
    perFloorEq.set(fo, n)
    const sec = sectionAt(fo, x, y)
    const withTags = equipment.length % 5 === 0
    equipment.push({
      id: `f${fo}-m${String(n).padStart(3, "0")}`,
      label: `${what} ${fo}-${n}`,
      section: sec.id, pos: [x, y], size, height, shape,
      tags: withTags
        ? [{ key: "speed", label: "속도", unit: "bpm", warn: 250 },
           { key: "temp", label: "온도", unit: "°C", warn: 80 }]
        : [],
    })
  }
  for (const [k, p] of nodeAt) {
    const fo = Number(p.floor[0])
    // 도크·브리지의 바깥 끝(층 가장자리)은 설비 자리가 아니다
    if (p.x === 0 || p.x === 300 || p.y === 0 || p.y === 200) continue
    if ((inDeg.get(k) ?? 0) >= 2) addEq(fo, p.x, p.y, "머지기", [3, 3], 2.2, "box")
    else if ((outDeg.get(k) ?? 0) >= 2) addEq(fo, p.x, p.y, "분류기", [3, 3], 2.4, "box")
  }
  let rowN = 0
  for (const s of segments) {
    if (kinds.get(s.id) !== "row") continue
    if (rowN++ % 3 !== 1) continue
    const fo = Number(s.from.floor[0])
    addEq(fo, (s.from.x + s.to.x) / 2, s.from.y, "가공기", [5, 3], 3.0, "cylinder")
  }

  return {
    version: 3, name: "대형 데모 공장 (5층)", stallSec: 10,
    floors, sections, equipment, segments, cameras,
  }
}

function main() {
  const i = process.argv.indexOf("--seed")
  const seed = i >= 0 ? Number(process.argv[i + 1]) : 1
  if (!Number.isInteger(seed)) {
    console.error("사용법: tsx tools/gen-scene.ts --seed <정수>")
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(generate(seed), null, 2) + "\n")
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
```

- [ ] **Step 5: 씬을 생성한다**

Run: `cd hub && npm run gen:large && wc -c ../scene.large.json && head -c 120 ../scene.large.json`
Expected: 약 234,000 바이트, `{\n  "version": 3,\n  "name": "대형 데모 공장 (5층)",` 로 시작.

- [ ] **Step 6: 통과를 확인한다**

Run: `cd hub && npm test && npx tsc --noEmit`
Expected: `ℹ fail 0` (55 + 22 = 77), tsc 출력 없음.

- [ ] **Step 7: 커밋**

```bash
git add tools/gen-scene.ts hub/test/gen.test.ts hub/tsconfig.json hub/package.json scene.large.json
git commit -m "feat(tools): 대형 5층 네트워크 씬 생성기

1F 입고 도크 8·2F 연결 브리지 2 에서 들어와 격자망을 지나 리프트로
2~5F 를 돌고 1F 출고 도크 4 로 나간다. 시드 1 의 출력을 커밋한다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 전파 모의 어댑터

**Files:**
- Modify (재작성): `hub/src/adapters/mock.ts`, `hub/test/mock.test.ts`
- Modify: `scene.json` (끝점 세 곳), `hub/src/index.ts` (MOCK_SEED)

**Interfaces:**
- Consumes: `downstream`, `topoOrder`, `rng` (Task 3), `scene.large.json` (Task 4, 테스트), `derive` (Task 2 가 고친 것 — 테스트가 진짜 판정을 돌린다)
- Produces:
  - `new MockAdapter(scene: Scene, opts?: MockOptions)` — 순환이 있으면 `Error` (메시지에 "순환")
  - `type MockOptions = { now?: () => number; seed?: number; blocks?: Block[]; dockBreaks?: boolean }`
  - `type Block = { id: string; fromMs: number; toMs: number }` (모의 시계 기준 ms, `toMs` 는 포함하지 않는다)
  - `tick(emit: Emit)`, `start(emit)`, `stop()` — `Adapter` 인터페이스 그대로

**주의 — 순서:** 작은 `scene.json` 의 끝점 수정(Step 1)은 Task 1 의 전후 스크린샷 비교가 끝난 **뒤**여야 한다. 이 태스크는 Task 1 뒤라 괜찮다.

- [ ] **Step 1: 작은 씬의 끝점을 이어 붙인다**

`scene.json` 의 구간 셋. 선이 설비를 관통해도 괜찮다 — 컨베이어는 원래 설비를 지나간다.

```jsonc
// conv-1 의 to:  { "floor": "1F", "x": 34, "y": 12 }  →  { "floor": "1F", "x": 36, "y": 12 }   (lift-1 의 from)
// conv-3 의 from: { "floor": "2F", "x": 8, "y": 12 }   →  { "floor": "2F", "x": 3, "y": 12 }    (lift-1 의 to)
// conv-5 의 from: { "floor": "2F", "x": 19.5, "y": 12 } → { "floor": "2F", "x": 16.5, "y": 12 } (conv-3 의 to)
```

확인: `cd hub && node --test --import tsx ./test/scene.test.ts` → `ℹ fail 0` (검증 규칙은 끝점 연결을 보지 않는다).

- [ ] **Step 2: 테스트를 새로 쓴다**

`hub/test/mock.test.ts` 를 통째로 바꾼다. 옛 테스트(conv-3 의 BLOCK_PLAN·conv-5 의 STARVE_PLAN 을 직접 가리키던 것)는 각본이 사라지므로 버린다:

```ts
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
  const seg = (id: string, fx: number, fy: number, tx: number, ty: number) => ({
    id, label: id, section: "a", capacity: 8,
    from: { floor: "1F", x: fx, y: fy }, to: { floor: "1F", x: tx, y: ty },
  })
  return {
    version: 3, name: "t", stallSec: 10,
    floors: [{ id: "1F", label: "1층", order: 1 }],
    sections: [{ id: "a", label: "A", floor: "1F", rect: [0, 0, 100, 100], cameras: [] }],
    equipment: [],
    segments: [seg("s1", 0, 10, 20, 20), seg("s2", 0, 30, 20, 20), seg("m", 20, 20, 40, 20), seg("x", 40, 20, 60, 20)],
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
  // s1 → m 대신 s1 이 m 과 y 로 갈라지게 바꾼다
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
  const fed = new Set(large.segments.flatMap((a) => large.segments
    .filter((b) => b.from.floor === a.to.floor && b.from.x === a.to.x && b.from.y === a.to.y).map((b) => b.id)))
  const feeds = new Set(large.segments.filter((a) => large.segments
    .some((b) => b.from.floor === a.to.floor && b.from.x === a.to.x && b.from.y === a.to.y)).map((a) => a.id))
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
  s.segments.push({ id: "back", label: "back", section: "a",
    from: { floor: "1F", x: 60, y: 20 }, to: { floor: "1F", x: 20, y: 20 } })
  assert.throws(() => new MockAdapter(s), /순환/)
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/mock.test.ts`
Expected: FAIL 여러 건 — 옛 어댑터는 `blocks`/`dockBreaks` 를 모르고 막힘이 번지지 않는다 (예: "합류 아래를 막으면…" 에서 `s1` 이 `running`).

- [ ] **Step 4: `hub/src/adapters/mock.ts` 를 통째로 바꾼다**

```ts
import type { Scene, Segment, Value } from "../../../shared/types.ts"
import { downstream, topoOrder } from "../../../shared/graph.ts"
import { rng } from "../../../shared/rng.ts"
import type { Adapter, Emit } from "../adapter.ts"

const TICK_MS = 100
/** 한 틱을 이만큼씩 쪼개 흘린다. 물건은 한 단계에 한 구간만 지나므로 한 구간을
 *  단계당 capacity 개까지만 지날 수 있다 — 틱 단위로 흘리면 1F 출고 분배선처럼
 *  하강 리프트 여섯 대가 모이는 짧은 구간이 초당 50개에서 막혀 망 전체가 선다(실측) */
const STEP_MS = 25
/** 막힘·도크 휴무 각본을 새로 뽑는 주기 */
const CYCLE_MS = 120_000
/** 정상 가동 유량이 처리 속도의 이만큼이 되게 한다. 남는 30% 가 막힘이 풀린 뒤
 *  적체를 스스로 빼낸다 */
const TARGET_LOAD = 0.7
/** 구간별 처리 속도 흔들림. TARGET_LOAD / (1 - JITTER) 가 1 미만이어야
 *  랜덤만으로 빨강이 생기지 않는다 */
const JITTER = 0.1
/** 모든 구간이 정상 가동 중 최소한 이만큼(개/초)은 흐르게 한다. 드문드문 흐르는
 *  구간은 물건 사이 간격이 stallSec 을 넘을 때마다 회색(idle)으로 깜빡인다 */
const MIN_FLOW = 0.2
/** 물건이 구간을 지나는 시간 = capacity / r × 이 값. 정상 가동 중 WIP 가
 *  대략 capacity × TARGET_LOAD × 이 값 — 화면에 물건이 적당히 보인다 */
const TRANSIT_FACTOR = 0.5
/** 지나는 시간 상한. 한산한 구간은 위 식이 수십 초가 된다 */
const MAX_TRANSIT_MS = 2000
/** 생성할 때 미리 돌려두는 시간. 빈 공장에서 시작하면 30단계 깊이의 망이
 *  채워지는 1분 남짓 동안 물건이 안 닿은 구간이 줄줄이 idle 로 보인다. 실제
 *  허브 재시작 때 라인은 이미 돌고 있다 */
const WARMUP_MS = 120_000

export type Block = { id: string; fromMs: number; toMs: number }

export type MockOptions = {
  now?: () => number
  /** 사건 순서의 시드. 공장 모양의 시드(생성기)와 별개다 */
  seed?: number
  /** 테스트용: 막힘 각본을 직접 준다. 없으면 주기마다 시드로 뽑는다 */
  blocks?: Block[]
  /** 테스트용: false 면 도크 휴무가 없다 */
  dockBreaks?: boolean
}

type Plan = { blocks: Block[]; breaks: Map<string, [number, number]> }
/** 워밍업 동안의 각본: 막힘도 휴무도 없다 */
const NO_PLAN: Plan = { blocks: [], breaks: new Map() }

type Sim = {
  seg: Segment
  down: Sim[]
  source: boolean
  r: number
  cap: number
  transitMs: number
  /** 구간 안 물건들이 나갈 수 있게 되는 시각 (들어온 순서) */
  ready: number[]
  in: number
  out: number
  acc: number
  /** 도크 유입 누적기 (source 만 쓴다) */
  accIn: number
  /** 정상 가동 목표 유량 (개/초). 분기에서 하류 몫을 나누는 기준 */
  flow: number
  /** 이 구간이 하류로 지금까지 보낸 수. 몫보다 뒤처진 하류부터 보낸다 */
  sent: Map<Sim, number>
}

/**
 * 전파 모의 어댑터 (스펙 5장). 구간의 out 이 하류 구간의 in 이 된다.
 * 하류에 빈자리가 없으면 못 내보내므로 막힘이 상류로 번지고, 막힌 곳에서만
 * 받는 하류는 굶어 빈다. 판정 로직을 흉내내지 않고 원인만 만든다 — 여기서
 * state 를 직접 쓰면 derive.ts 는 데모에서 한 번도 실행되지 않는다.
 */
export class MockAdapter implements Adapter {
  private sims: Sim[]
  /** 하류부터 (위상 역순). 같은 틱 안에 빈자리가 상류로 전파된다 */
  private order: Sim[]
  private sources: Sim[]
  private timer?: NodeJS.Timeout
  private now: () => number
  private seed: number
  private rand: () => number
  private fixedBlocks?: Block[]
  private dockBreaks: boolean
  private plans = new Map<number, Plan>()

  constructor(private scene: Scene, opts: MockOptions = {}) {
    const t0 = Date.now()
    this.now = opts.now ?? (() => Date.now() - t0)
    this.seed = opts.seed ?? 1
    this.rand = rng(this.seed)
    this.fixedBlocks = opts.blocks
    this.dockBreaks = opts.dockBreaks ?? true

    const down = downstream(scene)
    const topo = topoOrder(down)
    if (!topo) throw new Error("모의 어댑터: 구간 연결에 순환이 있다 — 끝점이 이어진 구간들이 제자리로 돌아온다")

    const byId = new Map<string, Sim>()
    for (const seg of scene.segments) {
      byId.set(seg.id, {
        seg, down: [], source: true, r: 0, cap: seg.capacity ?? 20, transitMs: 0,
        ready: [], in: 0, out: 0, acc: 0, accIn: 0, flow: 0, sent: new Map(),
      })
    }
    const up = new Map<Sim, Sim[]>([...byId.values()].map((s) => [s, []]))
    for (const [id, ds] of down) {
      const s = byId.get(id)!
      s.down = ds.map((d) => byId.get(d)!)
      for (const d of s.down) { d.source = false; up.get(d)!.push(s) }
    }
    this.sims = topo.map((id) => byId.get(id)!)
    this.order = [...this.sims].reverse()
    this.sources = this.sims.filter((s) => s.source)

    // 정상 가동 유량. 분기를 반씩 나누면 뒤로 갈수록 유량이 기하급수로 줄어
    // 천 배 넘게 차이가 난다(실측) — 드문드문 흐르는 구간이 생긴다. 대신 구간마다 source 에서
    // 그 구간을 거쳐 sink 까지 가는 경로 하나에 MIN_FLOW 를 흘려 더한다 —
    // 경로 합이라 모든 합류·분기점에서 들어온 양 = 나간 양이 저절로 맞고,
    // 모든 구간이 MIN_FLOW 이상 흐른다.
    // 경로의 이웃은 지금까지 가장 덜 쓰인 쪽으로 고른다. 늘 첫 이웃을 고르면
    // 모든 경로가 도크 하나로 몰리고, 무작위로 골라도 간선 몇 곳에 몰려 한
    // 틱에 capacity 보다 많이 지나가야 하는 구간이 생긴다 — 거기서 망 전체가 막힌다.
    const pick = (xs: Sim[]) => xs.reduce((a, b) => (b.flow < a.flow ? b : a))
    for (const s of this.sims) {
      let c = s
      c.flow += MIN_FLOW
      while (up.get(c)!.length) { c = pick(up.get(c)!); c.flow += MIN_FLOW }
      c = s
      while (c.down.length) { c = pick(c.down); c.flow += MIN_FLOW }
    }
    // 처리 속도는 유량이 TARGET_LOAD 가 되게. 흔들림을 줘도 1 을 안 넘는다
    for (const s of this.sims) {
      s.r = (s.flow / TARGET_LOAD) * (1 - JITTER + 2 * JITTER * this.rand())
      s.transitMs = Math.min((s.cap / s.r) * TRANSIT_FACTOR * 1000, MAX_TRANSIT_MS)
      for (const d of s.down) s.sent.set(d, 0)
    }

    for (let t = -WARMUP_MS; t < 0; t += STEP_MS) this.step(t, NO_PLAN)
  }

  /** 주기마다 막힘과 도크 휴무를 새로 뽑는다. 같은 시드·같은 주기면 같은 각본 */
  private planFor(cycle: number): Plan {
    let p = this.plans.get(cycle)
    if (p) return p
    const r = rng(this.seed * 1_000_003 + cycle)
    const blocks: Block[] = []
    if (!this.fixedBlocks) {
      // 상류가 2단계 이상인 구간만 — 적체가 거슬러 번지는 모습이 보여야 한다
      const candidates = this.sims.filter((s) => !s.source && !this.sims
        .filter((u) => u.down.includes(s)).every((u) => u.source))
      const k = Math.max(1, Math.ceil(this.sims.length / 150))
      for (let i = 0; i < k && candidates.length; i++) {
        const pick = candidates.splice(Math.floor(r() * candidates.length), 1)[0]
        const dur = 30_000 + r() * 60_000
        const start = r() * (CYCLE_MS - dur)
        blocks.push({ id: pick.seg.id, fromMs: cycle * CYCLE_MS + start, toMs: cycle * CYCLE_MS + start + dur })
      }
    }
    const breaks = new Map<string, [number, number]>()
    if (this.dockBreaks) {
      for (const s of this.sources) {
        if (r() < 0.5) continue // 절반의 도크만 이번 주기에 쉰다
        const dur = 20_000 + r() * 30_000
        const start = r() * (CYCLE_MS - dur)
        breaks.set(s.seg.id, [cycle * CYCLE_MS + start, cycle * CYCLE_MS + start + dur])
      }
    }
    p = { blocks, breaks }
    this.plans.set(cycle, p)
    this.plans.delete(cycle - 2)
    return p
  }

  private isBlocked(id: string, t: number, plan: Plan): boolean {
    const list = plan === NO_PLAN ? [] : this.fixedBlocks ?? plan.blocks
    return list.some((b) => b.id === id && t >= b.fromMs && t < b.toMs)
  }

  /** 한 틱. 테스트가 시계를 직접 돌릴 수 있도록 public. */
  tick(emit: Emit) {
    const t = this.now()
    const ts = Date.now()
    const plan = this.planFor(Math.floor(t / CYCLE_MS))
    for (let k = 0; k < TICK_MS; k += STEP_MS) this.step(t - TICK_MS + STEP_MS + k, plan)

    // counterMax 가 있으면 실제 PLC처럼 그 값에서 한 바퀴 돈다
    for (const s of this.sims) {
      const max = s.seg.counterMax
      const wrap = (v: number) => (max === undefined ? v : v % (max + 1))
      emit(`${s.seg.id}.in`, wrap(s.in), ts)
      emit(`${s.seg.id}.out`, wrap(s.out), ts)
    }

    for (const e of this.scene.equipment) {
      for (const tag of e.tags) {
        const mid = tag.warn ? tag.warn * 0.85 : 50
        const swing = mid * 0.25
        const v = mid + swing * Math.sin(t / 7000) + (this.rand() - 0.5) * swing * 0.2
        emit(`${e.id}.${tag.key}`, Math.round(v * 10) / 10 as Value, ts)
      }
    }
  }

  /** 한 단계(STEP_MS). 시각 t 는 모의 시계 기준이다 */
  private step(t: number, plan: Plan) {
    const dt = STEP_MS / 1000

    // 1. 하류부터 내보낸다. 받을 자리가 없으면 못 내보낸다 → 막힘이 번진다.
    for (const s of this.order) {
      s.acc += s.r * dt
      let n = Math.floor(s.acc)
      // 쓰지 못한 처리 능력은 쌓아두지 않는다 — 막힌 동안의 몫을 풀린 뒤
      // 한꺼번에 쏟아내면 안 된다
      s.acc -= n
      if (this.isBlocked(s.seg.id, t, plan)) continue
      while (n-- > 0 && s.ready.length && s.ready[0] <= t) {
        // 자기 몫(flow)보다 가장 뒤처진 하류부터, 빈자리가 있는 곳으로
        let target: Sim | null = null
        for (const d of s.down) {
          if (d.ready.length >= d.cap) continue
          if (!target || s.sent.get(d)! / d.flow < s.sent.get(target)! / target.flow) target = d
        }
        if (s.down.length && !target) break
        s.ready.shift()
        s.out++
        if (target) {
          target.ready.push(t + target.transitMs)
          target.in++
          s.sent.set(target, s.sent.get(target)! + 1)
        }
      }
    }

    // 2. 도크로 들어온다. 휴무 중이거나 도크가 꽉 찼으면 안 들어온다
    for (const s of this.sources) {
      const br = plan.breaks.get(s.seg.id)
      if (br && t >= br[0] && t < br[1]) continue
      s.accIn += s.flow * dt
      while (s.accIn >= 1) {
        s.accIn -= 1
        if (s.ready.length >= s.cap) continue
        s.ready.push(t + s.transitMs)
        s.in++
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

- [ ] **Step 5: 통과를 확인한다**

Run: `cd hub && npm test`
Expected: `ℹ fail 0` (77 − 8 옛 mock + 12 새 mock = 81). mock 테스트는 10분짜리 시뮬레이션이 있어 수 초 걸린다.

- [ ] **Step 6: `index.ts` 가 `MOCK_SEED` 를 받게 한다**

```ts
// 전
  const scene = loadScene(scenePath)
  const hub = await startHub({
    scenePath,
    port: Number(process.env.PORT ?? 8080),
    adapter: new MockAdapter(scene),
// 후
  const scene = loadScene(scenePath)
  // 사건 순서의 시드. 공장 모양의 시드(tools/gen-scene.ts)와 별개다 — 같은 공장의
  // 다른 하루를 재생한다. 정수가 아니면 조용히 다른 각본이 돌지 않게 거절한다.
  const seed = Number(process.env.MOCK_SEED ?? 1)
  if (!Number.isInteger(seed)) throw new Error(`MOCK_SEED 는 정수여야 한다 (받음: ${process.env.MOCK_SEED})`)
  const hub = await startHub({
    scenePath,
    port: Number(process.env.PORT ?? 8080),
    adapter: new MockAdapter(scene, { seed }),
```

확인 (Review Focus 3):

```bash
cd hub && MOCK_SEED=abc node_modules/.bin/tsx src/index.ts; echo "exit=$?"
```

Expected: `MOCK_SEED 는 정수여야 한다 (받음: abc)` 와 `exit=1`.

- [ ] **Step 7: 커밋**

```bash
git add hub/src/adapters/mock.ts hub/test/mock.test.ts hub/src/index.ts scene.json
git commit -m "feat(hub): 막힘이 상류로 번지는 전파 모의 어댑터

구간의 out 이 하류의 in 이 되고, 하류가 차면 못 내보낸다. 막힘·도크
휴무는 주기마다 시드로 뽑는다(MOCK_SEED). 작은 씬도 끝점을 이어 체인이 된다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 보기 모드 전환 (적층 ⇄ 계단)

**Files:**
- Modify: `web/src/App.tsx`, `web/src/viewer/camera.ts`, `web/src/styles.css`

**Interfaces:**
- Consumes: `mode` 를 받는 모든 뷰어 함수 (Task 1), `worldAt` (Task 1)
- Produces: `App` 의 `goSection(id: string)` (Task 7 의 배지가 쓴다), URL 파라미터 `?layout=stair`, `?idleMs=<ms>`, `?fps`

- [ ] **Step 1: 카메라 전체보기가 화면 가로폭도 따지게 한다**

`camera.ts` 의 `fit` 을 함수로 바꾼다:

```ts
// 전
  const fit = Math.max(span.x, span.z, span.y * 2) * 0.75

  let alphaIdx = 0
  let zoom = fit
// 후
  // 화면 가로에 담기는 폭도 따진다. 층을 옆으로 늘어놓는 배치(stair)는 가로로
  // 길어서 세로 기준만으로 맞추면 양 끝 층이 화면 밖으로 잘린다 (실측). 45° 에서
  // 바닥 상자의 화면 가로 폭은 (span.x + span.z) × cos45° ≈ 0.71 배인데, 0.75 로는
  // 대형 씬 계단 배치의 양 끝 층이 잘렸다(실측) — 0.85 로 여백을 둔다. 화면 비율은
  // 그때그때 잰다 — 창 크기가 바뀐 뒤 ⌂ 를 누르면 새 비율로 맞아야 한다.
  const fit = () => Math.max(
    Math.max(span.x, span.z, span.y * 2) * 0.75,
    ((span.x + span.z) * 0.85) / (canvas.clientWidth / Math.max(canvas.clientHeight, 1)),
  )

  let alphaIdx = 0
  let zoom = fit()
```

휠 상한 `fit * 4` → `fit() * 4`, `home()` 의 `zoomTo: fit,` → `zoomTo: fit(),`.

그리고 `tick` 맨 앞에서 첫 프레임에 한 번 다시 잰다:

```ts
// 전
  const tick = () => {
    if (animAlpha) {
// 후
  // 첫 프레임에서 전체보기 배율을 다시 잰다. 카메라를 만드는 순간은 레이아웃이
  // 자리 잡기 전이라 캔버스 비율이 첫 프레임과 다를 수 있다.
  let fitted = false
  const tick = () => {
    if (!fitted) {
      fitted = true
      zoom = fit()
      applyZoom()
    }
    if (animAlpha) {
```

(작은 씬은 두 번째 항이 이겨 전체보기가 약 10% 멀어진다 — 30 → 33. 대형 적층 배치는 첫 항이 이겨 그대로다.)

- [ ] **Step 2: `App.tsx` 에 모드 상태·전환 버튼·5분 복귀·fps 를 넣는다**

import:

```ts
// 전
import { pathSampler, segmentPoints } from "./viewer/coords.ts"
// 후
import { pathSampler, segmentPoints, worldAt } from "./viewer/coords.ts"
```

`import type { LayoutMode } ...` 다음에 붙인다:

```ts
import type { Engine } from "@babylonjs/core/Engines/engine"

const params = new URLSearchParams(location.search)
/**
 * 기본(stack)이 아닌 배치를 이만큼 아무도 안 만지면 기본으로 돌아간다.
 * 누가 계단 배치로 바꿔 놓고 가면 다음 사람은 이상한 화면을 본다 — 카메라
 * 기울기를 잠근 것과 같은 이유다. `?idleMs=` 는 확인용(체크리스트)이다.
 */
const IDLE_RESET_MS = Number(params.get("idleMs")) || 5 * 60_000
/** `?layout=stair` 로 계단 배치에서 시작한다. 헤드리스 스크린샷(tools/shot.mjs)은
 *  버튼을 못 누르므로 확인용이다. 이것도 IDLE_RESET_MS 뒤에는 기본으로 돌아간다 */
const START_MODE: LayoutMode = params.get("layout") === "stair" ? "stair" : "stack"
const SHOW_FPS = params.has("fps")

/** `?fps` 일 때만 구석에 뜬다. 성능 측정용 (스펙 6장) */
function Fps({ engine }: { engine: Engine | undefined }) {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    if (!engine) return
    const id = setInterval(() => setFps(engine.getFps()), 500)
    return () => clearInterval(id)
  }, [engine])
  return <div className="fps">{fps.toFixed(0)} fps</div>
}
```

상태: `const [mode] = useState<LayoutMode>("stack")` → `const [mode, setMode] = useState<LayoutMode>(START_MODE)`

`values` effect 바로 다음에 복귀 타이머:

```ts
  useEffect(() => {
    if (mode === "stack") return
    let timer = setTimeout(() => setMode("stack"), IDLE_RESET_MS)
    const poke = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setMode("stack"), IDLE_RESET_MS)
    }
    const events = ["pointerdown", "pointermove", "wheel", "keydown"] as const
    for (const e of events) window.addEventListener(e, poke, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, poke)
    }
  }, [mode])
```

`goTo` 다음에:

```ts
  const goSection = (id: string) => {
    const sec = data.scene.sections.find((s) => s.id === id)
    if (!sec) return
    const [x, y, w, h] = sec.rect
    camRef.current?.flyTo(worldAt(data.scene, sec.floor, x + w / 2, y + h / 2, 0, mode))
  }
```

(`goSection` 은 Task 7 에서 배지가 쓴다. 지금은 안 쓰여도 타입체크는 통과한다.)

`<Labels .../>` 다음 줄에 `{SHOW_FPS && <Fps engine={ctx?.engine} />}`. 전체보기 버튼 다음에:

```tsx
          <button
            title={mode === "stack" ? "계단 배치로 보기" : "적층 배치로 보기"}
            onClick={() => setMode(mode === "stack" ? "stair" : "stack")}
          >
            {mode === "stack" ? "⋰" : "≡"}
          </button>
```

- [ ] **Step 3: fps 스타일**

`styles.css` 맨 끝:

```css

.fps {
  position: absolute; left: 12px; bottom: 12px; padding: 2px 8px; border-radius: 4px;
  background: #171b22; color: #aeb6c2; font: 12px ui-monospace, monospace;
}
```

- [ ] **Step 4: 타입체크·빌드**

Run: `cd web && npx tsc --noEmit && npm run build 2>&1 | grep "index-.*\.js"`
Expected: tsc 출력 없음. `index-*.js` gzip 이 약 313KB (350KB 이하).

- [ ] **Step 5: 두 배치를 찍어 본다**

공통 절차로 대형 씬을 띄우고 둘 다 찍는다:

```bash
node tools/shot.mjs "http://localhost:8091/" /tmp/packtory-stack.png 8000
node tools/shot.mjs "http://localhost:8091/?layout=stair" /tmp/packtory-stair.png 8000
```

Expected (Read 로 연다):
- stack: 다섯 층 판이 45m 간격으로 겹쳐 쌓여 화면 가운데를 채운다.
- stair: 다섯 층이 **왼쪽(1층)에서 오른쪽(5층)으로 한 줄**로, 오른쪽일수록 조금씩 높게 선다. **양 끝 층이 잘리지 않는다.** 층 사이를 건너는 가느다란 가로선(리프트)이 보인다.

아직 신호등·라벨이 전부 서 있어 복잡한 것은 정상이다 — Task 7 이 솎는다.

- [ ] **Step 6: 커밋**

```bash
git add web/src/App.tsx web/src/viewer/camera.ts web/src/styles.css
git commit -m "feat(viewer): 적층 ⇄ 계단 배치 전환 버튼, 5분 뒤 기본 복귀

전환하면 엔진째 다시 짓고 전체보기로 간다. 전체보기는 화면 가로폭도
따져 계단 배치의 양 끝 층이 잘리지 않는다. ?fps 로 fps 를 띄운다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 멀리서는 정지만 — 밀도 제어, 구역 배지, 칩 묶음

**Files:**
- Modify: `web/src/viewer/camera.ts`, `web/src/viewer/andon.ts`, `web/src/Labels.tsx` (전체 교체), `web/src/AlertBar.tsx`, `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `goSection` (Task 6), `worldAt`/`segmentPoints` (Task 1)
- Produces: `camera.ts` 의 `export const SHOW_BELOW = 60`, `export function zoomOf(scene: BScene): number`. `<Labels ... onSection={(sectionId: string) => void}>`

- [ ] **Step 1: 문턱을 `camera.ts` 로 옮긴다**

`FLY_ZOOM` 주석 바로 위에 넣는다:

```ts
/**
 * 이 배율(화면 세로에 담기는 미터)보다 멀면 "멀리서 보기" 다. 멀리서는 정지
 * 구간의 신호등·라벨과 구역 배지만 남긴다 (스펙 6장 밀도 제어). 라벨과
 * 신호등이 같은 문턱을 써야 하므로 여기 하나만 둔다.
 */
export const SHOW_BELOW = 60

/** 지금 화면 세로에 담기는 미터 */
export function zoomOf(scene: BScene): number {
  return (scene.activeCamera?.orthoTop ?? 0) * 2
}

```

그리고 주석 두 곳의 `Labels 의 SHOW_BELOW(60)` → `SHOW_BELOW(60)`, `라벨 문턱(Labels 의 SHOW_BELOW)` → `라벨 문턱(SHOW_BELOW)`.

- [ ] **Step 2: 신호등이 멀리서는 정지만 선다 (`andon.ts`)**

import 추가 (`./coords.ts` 다음): `import { SHOW_BELOW, zoomOf } from "./camera.ts"`

`type One` 에 기둥을 더한다: `type One = { lamp: Mesh; pole: Mesh; mat: StandardMaterial; state: SegState }`, 그리고 `made.push({ lamp, pole, mat, state: "unknown" })`.

`const reduced = ...` 줄 다음, `onFrame` 을 바꾼다:

```ts
// 전
  const onFrame = () => {
    if (reduced) return
// 후
  // 멀리서는 정지 신호등만 세운다. 층당 백 개 가까운 초록 기둥 사이에서 빨강
  // 몇 개를 찾으라는 화면은 이 제품의 목적과 반대다 (스펙 6장 밀도 제어).
  let far: boolean | null = null
  const applyVisibility = () => {
    for (const one of made) {
      const show = !far || one.state === "stalled"
      if (one.lamp.isEnabled() === show) continue
      one.lamp.setEnabled(show)
      one.pole.setEnabled(show)
    }
  }

  const onFrame = () => {
    // 문턱 판정은 모션 감소 설정과 무관하다 — 줌은 사용자가 바꾼다
    const nowFar = zoomOf(bscene) > SHOW_BELOW
    if (nowFar !== far) { far = nowFar; applyVisibility() }
    if (reduced) return
```

`setValues` 의 상태 루프 바로 다음에 `applyVisibility()` 한 줄 (꺼진 메시는 피킹에서도 빠진다 — 멀리서 초록 신호등을 누를 일이 없다):

```ts
        made[i].mat.emissiveColor = LAMP[st].color
      }
      applyVisibility()
```

- [ ] **Step 3: `Labels.tsx` 를 통째로 바꾼다**

```tsx
import { useEffect, useState } from "react"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, TagValue } from "../../shared/types.ts"
import { equipmentHeight } from "../../shared/types.ts"
import type { LayoutMode } from "../../shared/layout.ts"
import { segState, segStallMs, segWip, formatStall } from "./state.ts"
import { worldAt, segmentPoints, pathSampler } from "./viewer/coords.ts"
import { projectToScreen } from "./viewer/project.ts"
import { SHOW_BELOW, zoomOf } from "./viewer/camera.ts"
import type { ViewerCtx } from "./viewer/Viewer.tsx"

type Item = { key: string; text: string; x: number; y: number; cls: string }
type Badge = { id: string; text: string; x: number; y: number; stalled: number }

export default function Labels({ ctx, scene, values, mode, onSection }: {
  ctx: ViewerCtx | null
  scene: Scene
  values: Map<string, TagValue>
  mode: LayoutMode
  /** 구역 배지를 눌렀을 때 */
  onSection: (sectionId: string) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [badges, setBadges] = useState<Badge[]>([])

  useEffect(() => {
    if (!ctx) return
    const { bscene } = ctx

    const recompute = () => {
      // 멀리서는 정지 구간 라벨과 구역 배지만, 가까이서는 화면 안의 모든 라벨.
      // 대형 씬은 전체보기에서 구간 500 개다 — 전부 띄우면 글자 더미에 빨강이 묻힌다.
      const far = zoomOf(bscene) > SHOW_BELOW
      const out: Item[] = []

      if (!far) {
        for (const e of scene.equipment) {
          const sec = scene.sections.find((s) => s.id === e.section)
          if (!sec) continue
          const p = projectToScreen(bscene, worldAt(scene, sec.floor, e.pos[0], e.pos[1], equipmentHeight(e) + 0.4, mode))
          if (p.visible) out.push({ key: `eq:${e.id}`, text: e.label, x: p.x, y: p.y, cls: "lbl-eq" })
        }
      }

      const stalledIn = new Map<string, number>()
      for (const seg of scene.segments) {
        const st = segState(seg.id, values)
        if (st === "stalled") stalledIn.set(seg.section, (stalledIn.get(seg.section) ?? 0) + 1)
        if (far && st !== "stalled") continue

        // pts[Math.floor(pts.length / 2)] 는 중점이 아니다 — via 없는 2점
        // 직선 구간은 length=2, floor(1)=1 로 끝점을 고른다. 끝점은 신호등이
        // 서 있는 자리라 라벨이 바로 옆 설비 라벨과 겹친다. 호 길이 기준
        // 중점을 써야 한다.
        const mid = pathSampler(segmentPoints(scene, seg, mode)).at(0.5)
        const wip = segWip(seg.id, values)
        const cap = seg.capacity ?? 20
        const over = wip - Math.min(wip, cap)

        // 화면 밖이면 투영 결과를 버린다 — DOM 에 넣지 않는다
        const p = projectToScreen(bscene, new Vector3(mid.x, mid.y + 1.2, mid.z))
        if (!p.visible) continue
        out.push({ key: `sg:${seg.id}`, text: seg.label, x: p.x, y: p.y, cls: "lbl-seg" })
        if (over > 0)
          out.push({ key: `ov:${seg.id}`, text: `+${over}`, x: p.x, y: p.y - 16, cls: "lbl-over" })
        if (st === "stalled")
          out.push({ key: `st:${seg.id}`, text: formatStall(segStallMs(seg.id, values)), x: p.x, y: p.y - 32, cls: "lbl-stall" })
      }

      const bs: Badge[] = []
      if (far) {
        for (const sec of scene.sections) {
          const [x, y, w, h] = sec.rect
          const p = projectToScreen(bscene, worldAt(scene, sec.floor, x + w / 2, y + h / 2, 0.5, mode))
          if (!p.visible) continue
          const n = stalledIn.get(sec.id) ?? 0
          bs.push({ id: sec.id, text: `${sec.label} · ${n ? `정지 ${n}` : "정상"}`, x: p.x, y: p.y, stalled: n })
        }
      }

      setItems(out)
      setBadges(bs)
    }

    // 카메라가 움직이면 라벨도 따라가야 하므로 렌더 루프에 붙인다.
    // React 상태를 프레임마다 갱신하면 비싸므로 100ms 로 솎는다 —
    // 라벨은 한 프레임 늦어도 아무도 모른다.
    let last = 0
    const obs = bscene.onAfterRenderObservable.add(() => {
      const now = performance.now()
      if (now - last < 100) return
      last = now
      recompute()
    })
    return () => { bscene.onAfterRenderObservable.remove(obs) }
  }, [ctx, scene, values, mode])

  return (
    <>
      {/* 배지는 누를 수 있어야 하므로 aria-hidden 인 라벨 층과 따로 둔다. 라벨보다
          먼저 그려 아래에 깐다 — 정지 시간 라벨이 배지에 가리면 안 된다 */}
      <div className="badges">
        {badges.map((b) => (
          <button
            key={b.id}
            className={b.stalled ? "badge stalled" : "badge"}
            style={{ transform: `translate(${b.x}px, ${b.y}px) translate(-50%, -50%)` }}
            onClick={() => onSection(b.id)}
          >
            {b.text}
          </button>
        ))}
      </div>
      <div className="labels" aria-hidden="true">
        {items.map((i) => (
          // left/top 은 레이아웃(리플로우)을 강제한다. transform 은 컴포지터만
          // 건드리므로 라벨이 매 프레임 움직여도 값싸다 — position 은 0,0 에
          // 고정해 두고 transform 으로만 옮긴다.
          <span key={i.key} className={i.cls} style={{ transform: `translate(${i.x}px, ${i.y}px) translate(-50%, -100%)` }}>
            {i.text}
          </span>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 4: 칩을 5개로 묶는다 (`AlertBar.tsx`)**

import 다음에:

```ts

/** 칩은 이만큼만 세운다. 막힘 하나가 상류로 번지면 빨강이 여럿 된다 — 전부
 *  세우면 막대가 뷰어를 잡아먹는다. 오래 멈춘 순이라 대개 원인이 앞에 온다 */
const MAX_CHIPS = 5
```

`{stalled.map(({ seg, ms }) => {` → `{stalled.slice(0, MAX_CHIPS).map(({ seg, ms }) => {`, 그리고 그 `map` 이 닫히는 `})}` 다음(`</div>` 전)에:

```tsx
          {stalled.length > MAX_CHIPS && (
            <span className="chip-more">외 {stalled.length - MAX_CHIPS}건</span>
          )}
```

알림(announcer)은 그대로 둔다 — 스크린리더에는 전체 목록을 읽어 준다.

- [ ] **Step 5: `App.tsx` 에서 배지를 잇는다**

`<Labels ctx={ctx} scene={data.scene} values={values} mode={mode} />` → `<Labels ctx={ctx} scene={data.scene} values={values} mode={mode} onSection={goSection} />`

- [ ] **Step 6: 배지·외 N건 스타일**

`styles.css` 의 `.lbl-stall` 줄 다음에:

```css

/* ── 구역 배지 (멀리서 보기) ─────────────────────────
   라벨 층과 달리 누를 수 있다. 위치는 라벨과 같은 방식(transform)으로 옮긴다. */
.badges { position: absolute; inset: 0; pointer-events: none; }
.badge {
  position: absolute; left: 0; top: 0; pointer-events: auto; white-space: nowrap;
  padding: 3px 10px; border: 1px solid #2f6b47; border-radius: 999px;
  background: #16301f; color: #9fe0b4; font: 12px/1.4 inherit; cursor: pointer;
}
.badge.stalled { border-color: #d24b4b; background: #3a1d1d; color: #ffb4b4; font-weight: 600; }
.chip-more { color: #ffb4b4; font-size: 13px; }
```

- [ ] **Step 7: 타입체크·빌드**

Run: `cd web && npx tsc --noEmit && npm run build 2>&1 | grep "index-.*\.js"`
Expected: tsc 출력 없음, gzip 약 313KB.

- [ ] **Step 8: 정지가 번진 장면을 찍는다**

대형 씬을 띄우고 **막힘이 생길 만큼 기다려** 찍는다 (시드 1 은 첫 주기 안에 막힌다):

```bash
node tools/shot.mjs "http://localhost:8091/" /tmp/packtory-far.png 60000
node tools/shot.mjs "http://localhost:8091/?layout=stair" /tmp/packtory-far-stair.png 30000
```

Expected:
- 초록 신호등 기둥과 구간·설비 라벨이 **없다**. 구역 배지 30개("3층 B구역 · 정상" 초록)가 보인다.
- 정지가 있으면: 그 구역 배지가 빨강 "· 정지 N", 정지 구간 위에 빨간 신호등과 라벨·정지 시간, AlertBar 칩 최대 5개 + "외 N건". 정지 시간 라벨이 배지에 가려지지 않는다(라벨이 위에 그려진다).
- 60초 동안 정지가 하나도 없으면 `MOCK_SEED=2` 로 허브를 다시 띄워 찍는다.

- [ ] **Step 9: 커밋**

```bash
git add web/src
git commit -m "feat(viewer): 멀리서는 정지 신호등·라벨과 구역 배지만

가까이 가면 기존처럼 전부 보인다(SHOW_BELOW). 배지를 누르면 그 구역으로
날아간다. 칩은 5개까지, 나머지는 '외 N건'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 문서 — 실행법·체크리스트·스펙 갱신, 사람의 fps 측정

**Files:**
- Modify: `README.md`, `docs/BROWSER-CHECKLIST.md`, `docs/superpowers/specs/2026-09-27-packtory-large-network-design.md`

- [ ] **Step 1: README 에 대형 씬 절을 더한다**

`## 씬 편집` 절 바로 앞에 넣는다:

````markdown
## 대형 씬 (5층 네트워크)

`scene.large.json` 은 `tools/gen-scene.ts` 가 시드 1 로 만든 가상 공장이다 —
5층, 구간 493, 설비 286. 1층 입고 도크 8곳과 2층 연결 브리지 2곳에서 물건이
들어와 격자망과 리프트를 지나 1층 출고 도크 4곳으로 나간다. 손으로 고치지
말고 생성기를 고쳐 다시 만든다:

```bash
cd hub && npm run gen:large        # scene.large.json 을 다시 쓴다
SCENE=../scene.large.json npm start
```

모의 데이터는 구간 연결(끝점이 같은 좌표면 이어진 것)을 따라 흐른다. 한
구간이 막히면 상류가 차례로 꽉 차 빨강이 되고, 막힌 곳에서만 받던 하류는
비어 회색이 된다. 막힘·도크 휴무는 120초마다 새로 뽑는다. 같은 하루를 다시
보려면 같은 `MOCK_SEED`(기본 1)로 띄운다.

화면 오른쪽 아래 버튼(⋰/≡)으로 층 배치를 **적층**(제자리에 벌려 쌓기, 기본)과
**계단**(1층부터 옆으로 한 줄)으로 바꾼다. 계단 배치는 5분 동안 아무도 안
만지면 적층으로 돌아간다. 멀리서 보면 정지 구간과 구역 배지만 보이고, 가까이
가면 전부 보인다.

URL 파라미터: `?layout=stair`(계단에서 시작), `?idleMs=<ms>`(복귀 시간),
`?fps`(구석에 fps).
````

`환경 변수: ...` 줄을 `환경 변수: `PORT`, `SCENE`, `GO2RTC_BASE`, `WEB_DIR`, `MOCK_SEED`.` 로 바꾼다. 테스트 절의 `(`node --test`, 43개)` → `(`node --test`, 81개)`.

- [ ] **Step 2: 사람에게 fps 측정을 부탁하고 기다린다**

헤드리스 스크린샷의 fps 는 소프트웨어 렌더링이라 쓸모가 없다. 이렇게 묻는다:

> 실제 GPU 가 있는 브라우저에서 `cd web && npm run build && cd ../hub && SCENE=../scene.large.json WEB_DIR=../web/dist npm start` 로 띄우고 `http://localhost:8080/?fps` 를 열어, 전체보기(⌂)에서 적층·계단 각각 fps 를 알려주세요. 노트북 GPU 종류도 함께요.

답을 받으면 README 의 `## 번들 크기` 절 다음에 새 절로 받은 숫자 그대로 적는다:

```markdown
## 성능 (대형 씬 전체보기)

목표: `scene.large.json` 전체보기 30fps 이상 (내장 GPU 노트북).
측정: 2026-09-XX, <GPU>, <브라우저> — 적층 <N>fps, 계단 <N>fps.
```

(`<…>` 는 사람이 준 값으로 채운다. 값을 지어내지 마라.) **30fps 미만이면 여기서 멈추고 보고한다** — 스펙 6장: 메시 병합은 피킹을 깨므로 방법을 따로 정한다.

- [ ] **Step 3: 브라우저 체크리스트를 고친다**

`docs/BROWSER-CHECKLIST.md` 첫 줄 제목 `(v3 — 아이소메트릭 뷰어)` → `(v4 — 대형 네트워크)`.

`## 준비` 절의 "conv-3(충전 이송)은 120초 주기로 반복된다: …" 부터 "…(허브·`derive.ts` 를 실제 코드로 돌려 실측한 값. 이번 점검에서 실제 브라우저로도 재확인했다 — 아래 각 항목 참조.)" 까지 두 문단을 아래로 바꾼다 (옛 BLOCK_PLAN·STARVE_PLAN 각본은 없어졌다):

```markdown
모의 데이터는 이제 구간 연결을 따라 흐르고, 막힘과 도크 휴무를 120초마다
시드(`MOCK_SEED`, 기본 1)로 새로 뽑는다. 작은 씬(`scene.json`)은
conv-1 → lift-1 → conv-3 → conv-5 체인이라, 가운데가 막히면 위쪽이 빨강,
아래쪽이 회색이 된다. 어느 구간이 언제 막히는지는 시드에 달렸다 — 몇 분
지켜보면 빨강과 회색이 나란히 뜨는 장면이 온다.
```

문서 맨 끝에 절을 더한다:

```markdown
## v4 — 대형 네트워크 (`SCENE=../scene.large.json`)

| # | 할 일 | 보여야 하는 것 |
|---|---|---|
| 1 | 대형 씬으로 띄운다 | 다섯 층이 45m 간격으로 겹쳐 쌓여 보인다 (적층) |
| 2 | ⋰ 버튼 | 1층(왼쪽)→5층(오른쪽) 한 줄. 양 끝 층이 잘리지 않는다 |
| 3 | 창 크기를 바꾸고 ⌂ | 다섯 층이 다시 전부 담긴다 |
| 4 | `?layout=stair&idleMs=10000` 로 열고 10초 손 떼기 | 적층으로 돌아온다. 마우스를 움직이면 타이머가 다시 시작한다 |
| 5 | 전체보기 | 초록 신호등·구간 라벨 없음. 구역 배지 30개 |
| 6 | 배지 하나 클릭 (적층·계단 둘 다) | 그 구역으로 날아가고, 배지가 사라지고, 라벨·신호등이 전부 나온다 |
| 7 | 막힘이 생길 때까지 지켜본다 | 막힌 구간 상류로 빨강이 번지고, 막힌 곳에서만 받던 하류가 회색. 그 구역 배지가 "정지 N" 빨강 |
| 8 | 정지가 6개 넘게 번졌을 때 | AlertBar 칩 5개 + "외 N건" |
| 9 | 계단 배치에서 칩 클릭 | 옆으로 밀린 층의 그 구간으로 간다 (허공이 아니다) |
| 10 | 도크 휴무가 끝나 물건이 다시 들어올 때 | 회색 → 초록. **빨강을 거치지 않는다** |
| 11 | `?fps` | 전체보기 30fps 이상 (README 성능 절) |
| 12 | 작은 씬(`SCENE` 없이) | 예전처럼 뜬다. 전체보기가 예전보다 조금(약 10%) 멀다 |
```

- [ ] **Step 4: 스펙을 실제와 맞춘다**

`docs/superpowers/specs/2026-09-27-packtory-large-network-design.md` 에서:

1. 2장 표의 `| 판정 | `derive.ts` **변경 없음** | ...` 행을 → `| 판정 | `derive.ts` 는 한 가지만 고친다: 정지 시간을 out 이 멈춘 뒤와 물건이 들어차기 시작한 뒤 중 늦은 쪽부터 센다 | 쉬던 구간이 다시 받는 순간 빨강이 뜨는 가짜 경보를 대형 씬이 드러냈다 (5장) |`
2. 3장 "바뀌지 않는 것:" 문장에서 `` `derive`· `` 를 지운다.
3. 4장 공장 모양 그림의 `1F 입고 도크 ×8 (세 면)` → `1F 입고 도크 ×8 (서 3 · 남 5)`.
4. 5장 "전파 mock — 매 틱(100ms)" 의 1·2번을 이 계획의 "스펙과 달라진 점" 표 두·세 번째 행 내용으로 바꾸고 (경로 합 유량 MIN_FLOW 0.2, 처리 속도 = 유량/0.7, 25ms 단계, 2분 워밍업), "바뀌지 않는 것" 문단의 `` `derive.ts`, `` 를 지우고 그 아래에 한 문단을 더한다: "`derive.ts` 는 정지 시간 기준만 고친다 — `max(out 이 멈춘 시각, 물건이 들어차기 시작한 시각)`. 비어 쉬던 구간에 물건 하나가 다시 들어온 순간을 막힘으로 보던 가짜 경보다."
5. 6장 층 배치 표의 B 행을 → `| B `stair` | `−r × (층 가로폭 + 20m)` (그리고 `dy = +r × (층 가로폭 + 20m)`) | `r × 10m` |` 로 바꾸고 표 아래에 한 줄: "`r` 은 order 의 정렬 순위다. (−x, +y) 는 기본 시점에서 화면 오른쪽이라 1층부터 왼쪽→오른쪽으로 선다. 전체보기 배율은 화면 가로폭도 따진다."
6. 머리의 `상태: 초안 (검토 대기)` → `상태: 승인됨, 구현 중 실측으로 고침 (2026-09-27)`.

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/BROWSER-CHECKLIST.md docs/superpowers/specs/2026-09-27-packtory-large-network-design.md
git commit -m "docs: 대형 씬 실행법·체크리스트 v4·스펙을 실제에 맞춘다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
