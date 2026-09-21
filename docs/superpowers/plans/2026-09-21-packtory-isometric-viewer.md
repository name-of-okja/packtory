# packtory 아이소메트릭 뷰어 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공장을 비스듬히 내려다보는 아이소메트릭 입체 뷰로 그리고, 층을 동시에 보여주고, 막힌 구간 위에 적층 신호등을 세워 신입이 한 눈에 파악하게 한다.

**Architecture:** 허브(센서 카운터 → 정지 판정 → WebSocket)는 그대로 두고 웹 클라이언트를 Babylon.js 로 새로 쓴다. 카메라는 정사영에 각도 고정이라 "각도를 맞춰야 보이는" 화면이 되지 않는다. 층은 씬의 `elevation` 만큼 쌓아 동시에 보이고, 위층 바닥판은 반투명이라 아래층을 가리지 않는다. 글자는 3D 로 그리지 않고 3D 좌표를 화면에 투영해 HTML 로 얹는다.

**Tech Stack:** Node 20, TypeScript, `tsx`, `ws`, `node --test`, Vite + React 18, **Babylon.js (`@babylonjs/core`, 개별 import)**, go2rtc.

**Spec:** `docs/superpowers/specs/2026-09-21-packtory-isometric-viewer-design.md`

## Global Constraints

- Node 20. 허브는 빌드하지 않고 `tsx` 로 직접 실행한다.
- 테스트 러너는 `node --test` (stdlib). **웹에는 자동화 테스트를 쓰지 않는다** (스펙 결정) — vitest/jest/testing-library 를 설치하지 마라. 웹은 **헤드리스 브라우저 스크린샷**으로 검증한다 (Task 1 이 그 하네스를 만든다).
- 런타임 의존성은 `react`, `react-dom`, `@babylonjs/core` 셋뿐. 상태관리·UI프레임워크·애니메이션 라이브러리 금지.
- **Babylon 은 `@babylonjs/core` 에서 개별 import 한다.** `import * as BABYLON from "babylonjs"` 금지 — 400KB 가 통째로 들어온다. 초기 로드 gzip 목표 **350KB 이하** — 게이트가 아니라 목표다. (처음엔 250KB 로 적었는데 측정 전 추정치였고, Babylon core + React 만으로 이미 250KB 다.) 이 숫자의 쓸모는 `import * as BABYLON` 이 새어든 것과 정당한 증가를 구분하는 것이지 절대 상한이 아니다. 메시 생성도 마찬가지다 — `@babylonjs/core/Meshes/meshBuilder` 의 `MeshBuilder` 는 빌더 21종을 통째로 끌어오는 배럴이라 gzip 35KB 를 버린다(Task 4 에서 측정). `Meshes/Builders/boxBuilder` 의 `CreateBox` 처럼 **필요한 빌더만 개별 경로로** 가져와라.
- **카메라 기울기(beta)는 고정이다.** `beta = 0.9553 rad` (수평에서 35.26°). 방위각은 45°/135°/225°/315° 네 값만.
- 좌표 매핑: **씬 `(x, y)` + 층 `elevation` → Babylon `(x, elevation, y)`.** 씬의 Y 가 Babylon 의 Z 다. 뒤집는 곳이 없어야 한다.
- 컨베이어 벨트면은 바닥판 위 **0.8m** (상수).
- 구간당 물건 개수 = `min(wip, capacity)`. `capacity` 를 넘겨 그리면 앞선 물건과 겹쳐 보이지 않는다.
- 상태 4종은 **색만으로 가르지 않는다**: 정지 = 빨강 신호등 + 물건이 꽉 참, 대기 = 신호등 꺼짐 + 비어 있음.
- `prefers-reduced-motion` 존중 — 물건 이동과 신호등 점멸을 멈추되 색·개수는 유지.
- 씬 스키마는 `version: 3`. 새 필드 `elevation`/`height`/`shape` 는 전부 선택이고 **클라이언트 전용**이다 (허브는 읽지 않는다).
- 코드 주석과 사용자 대면 문자열은 한국어.

---

## File Structure

```
tools/
  shot.mjs               헤드리스 브라우저 스크린샷 (모든 웹 태스크의 검증 수단)

shared/
  types.ts               version 3, elevation/height/shape 추가  ← 수정

hub/                     아래 셋 말고는 손대지 않는다
  src/scene.ts           버전 게이트 2→3, 검증 규칙 7·8          ← 수정
  test/scene.test.ts     위 둘을 덮는 테스트                      ← 수정

scene.json               version 3, 높이·모양·elevation 채움      ← 수정

web/src/
  main.tsx               진입점
  App.tsx                상태 보유 (selection, panTo), 레이아웃
  scene.ts               GET /api/scene                           ← 유지
  useValues.ts           WS 훅                                    ← 유지
  state.ts               segState/segWip/segStallMs/formatStall/STATE_LABEL
  viewer/
    Viewer.tsx           Babylon 엔진·씬 수명주기, React 경계
    coords.ts            씬 좌표 → Babylon 좌표, 폴리라인 샘플링
    camera.ts            정사영 카메라, 각도 스냅, 팬/줌/이동
    build.ts             씬 JSON → 정적 메시 (바닥판·설비·구간·리프트)
    andon.ts             적층 신호등 메시 + 상태 반영
    flow.ts              Thin Instance 물건 흐름
    pick.ts              클릭 → Selection (우선순위 규칙)
    project.ts           3D → 화면 좌표 투영
  Labels.tsx             HTML 오버레이 라벨
  AlertBar.tsx           상단 이상 칩
  Modal.tsx              CCTV + 수치
  styles.css

  (삭제) Map.tsx  geom.ts  Segment.tsx  FloorTabs.tsx
```

`viewer/` 안은 전부 **React 를 모른다** — 순수 Babylon 모듈이다. `Viewer.tsx` 만 React 와 Babylon 의 경계다. 그래야 3D 코드를 React 렌더 주기와 무관하게 프레임 루프에서 돌릴 수 있다.

---

## Task 1: 검증 하네스 + 웹 뼈대 정리

**Files:**
- Create: `tools/shot.mjs`
- Create: `web/src/state.ts`
- Delete: `web/src/Map.tsx`, `web/src/geom.ts`, `web/src/Segment.tsx`, `web/src/FloorTabs.tsx`
- Modify: `web/package.json`, `web/src/App.tsx`, `web/src/AlertBar.tsx`, `web/src/Modal.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `node tools/shot.mjs <url> <출력png>` — 헤드리스 브라우저로 페이지를 찍는다
  - `web/src/state.ts`: `segState(id, values): SegState`, `segWip(id, values): number`, `segStallMs(id, values): number`, `formatStall(ms): string`, `STATE_LABEL: Record<SegState, string>`

- [ ] **Step 1: 스크린샷 하네스 작성**

브라우저가 없는 환경이 많으므로 찾을 수 있는 것을 찾는다. WSL 이면 Windows 쪽 Chrome/Edge 도 후보다.

`tools/shot.mjs`:
```js
#!/usr/bin/env node
// 헤드리스 브라우저로 페이지를 찍는다. 웹에는 자동화 테스트를 안 쓰기로 했으므로
// (스펙 결정) 화면이 실제로 뜨는지 보는 유일한 수단이 이것이다.
//
//   node tools/shot.mjs http://localhost:8080/ /tmp/shot.png [대기ms]
//
import { copyFileSync, existsSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"

const CANDIDATES = [
  "chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
]

function findBrowser() {
  for (const c of CANDIDATES) {
    if (c.startsWith("/")) { if (existsSync(c)) return c; continue }
    try { execFileSync("which", [c], { stdio: "ignore" }); return c } catch { /* 없음 */ }
  }
  return null
}

const [url, out, waitMs = "6000"] = process.argv.slice(2)
if (!url || !out) {
  console.error("사용법: node tools/shot.mjs <url> <출력png> [대기ms]")
  process.exit(2)
}

const browser = findBrowser()
if (!browser) {
  console.error("브라우저를 못 찾았다. chromium 또는 google-chrome 을 설치하거나,")
  console.error("WSL 이면 Windows 쪽 Chrome/Edge 가 설치되어 있어야 한다.")
  process.exit(3)
}

// Windows 실행파일은 WSL 경로에 못 쓴다 — Windows 쪽 임시 경로로 찍고 복사해 온다.
// 파일명은 실행마다 고유해야 한다. 고정 이름을 쓰면 이번 실행이 실패했을 때
// 지난번 이미지가 남아 있고, 그걸 복사해 오면서 "찍음" 을 출력한다 —
// 이후 열 태스크의 화면 검증이 통째로 거짓말이 된다.
const isWin = browser.startsWith("/mnt/c/")
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const winWsl = `/mnt/c/Users/Public/packtory-shot-${stamp}.png`
const target = isWin ? `C:\\Users\\Public\\packtory-shot-${stamp}.png` : out
const written = isWin ? winWsl : out

// 이전 산출물이 남아 있으면 지운다 (고유 이름이라 거의 없지만, out 쪽은 재사용된다)
rmSync(written, { force: true })
execFileSync(browser, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--virtual-time-budget=${waitMs}`,
  "--window-size=1600,1000",
  `--screenshot=${target}`,
  url,
], { stdio: "ignore" })

// 브라우저가 0 으로 끝나고도 아무것도 안 쓸 수 있다 (렌더 크래시, 권한 문제).
// 여기서 크게 실패하지 않으면 없는 화면을 확인했다고 믿게 된다.
if (!existsSync(written)) {
  console.error(`브라우저가 이미지를 쓰지 않았다: ${written}`)
  console.error(`(${browser} 이 종료코드 0 으로 끝났지만 산출물이 없다)`)
  process.exit(4)
}
// mtime 신선도 검사는 두지 않는다. WSL2 와 Windows 파일시스템 사이에
// 2~8초 클록 드리프트가 있어 정상 실행이 오탐으로 걸린다(실측). 그리고
// 필요도 없다 — 파일명이 실행마다 고유하고 실행 전에 지웠으므로, 실행 뒤에
// 존재한다는 것은 이번 실행이 썼다는 뜻이다. 신선도는 구조로 보장된다.

if (isWin) {
  copyFileSync(written, out)
  rmSync(written, { force: true })
}
console.log(`찍음: ${out}`)
```

- [ ] **Step 2: 하네스가 도는지 확인**

Run:
```bash
cd hub && WEB_DIR=../web/dist npx tsx src/index.ts &
sleep 3
node ../tools/shot.mjs http://localhost:8080/ /tmp/t1.png
```
Expected: `찍음: /tmp/t1.png` 이 뜨고 파일이 생긴다. (지금은 아직 옛 SVG 화면이 찍힌다 — 하네스가 동작하는지만 본다.)

브라우저를 못 찾으면 종료코드 3 과 안내가 나온다. 그 경우 **이 계획의 웹 태스크는 화면 검증을 못 하므로, 그 사실을 리포트에 적고 컨트롤러에게 보고해라.**

- [ ] **Step 3: Babylon 설치**

Run:
```bash
cd web && npm install @babylonjs/core@^7
```
Expected: `package.json` 의 `dependencies` 에 `@babylonjs/core` 가 추가된다.

- [ ] **Step 4: 상태 조회 함수를 `state.ts` 로 옮긴다**

지금 `Segment.tsx` 에 렌더와 섞여 있다. 3D 에서도 그대로 쓰는 순수 함수이므로 분리한다.

`web/src/state.ts`:
```ts
import type { SegState, TagValue } from "../../shared/types.ts"

/** 클릭 대상. geom.ts 가 사라졌으므로 여기가 새 집이다 */
export type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null

export const STATE_LABEL: Record<SegState, string> = {
  running: "가동", stalled: "정지", idle: "대기", unknown: "불명",
}

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

/** "3:12" 꼴 */
export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
```

- [ ] **Step 5: SVG 시대 파일을 지우고 import 를 옮긴다**

```bash
cd web/src && rm Map.tsx geom.ts Segment.tsx FloorTabs.tsx
```

`AlertBar.tsx` 와 `Modal.tsx` 의 `from "./Segment.tsx"` 를 `from "./state.ts"` 로 바꾼다. `Modal.tsx` 의 `import type { Selection } from "./geom.ts"` 도 `from "./state.ts"` 로 바꾼다 — `Selection` 은 Step 4 의 `state.ts` 에 이미 들어 있다.

`App.tsx` 는 이 태스크에서 **화면 없는 껍데기**로 만든다. Task 3 이 3D 뷰를 끼운다:

```tsx
import { useState } from "react"
import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"
import AlertBar from "./AlertBar.tsx"
import Modal from "./Modal.tsx"
import type { Selection } from "./state.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()
  const [selection, setSelection] = useState<Selection>(null)

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  return (
    <div className="app">
      {!connected && <div className="offline">서버와 끊김 — 재접속 중</div>}
      <AlertBar scene={data.scene} values={values} onGo={() => {}} />
      <div className="viewer-slot">3D 뷰 자리 (Task 3)</div>
      <Modal
        scene={data.scene}
        values={values}
        go2rtcBase={data.go2rtcBase}
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  )
}
```

`styles.css` 에서 SVG 전용 규칙(`.map`, `.section`, `.equipment`, `.segment`, `.rail`, `.item`, `.lift`, `.floor-tab*`, `@keyframes flow`)을 지운다. `.app`, `.alert-bar`, `.chip`, `.modal*`, `.sr-only`, `.offline` 은 남긴다. 그리고 추가:

```css
.app { display: grid; grid-template-rows: auto 1fr; height: 100%; position: relative; }
.viewer-slot { display: grid; place-items: center; color: #8b94a3; min-height: 0; }
```

- [ ] **Step 6: 빌드와 화면 확인**

Run:
```bash
cd web && npm run typecheck && npm run build
```
Expected: 에러 없음.

Run: 허브를 띄우고 `node tools/shot.mjs http://localhost:8080/ /tmp/t1.png`
Expected: 상단에 이상 칩(또는 "정상 가동"), 가운데에 "3D 뷰 자리 (Task 3)" 글자. **세로 스크롤바가 없어야 한다.**

찍은 png 를 열어 눈으로 확인하고, 본 것을 리포트에 적어라.

- [ ] **Step 7: 커밋**

```bash
git add tools web
git commit -m "chore: 아이소메트릭 뷰어 준비 — 검증 하네스, Babylon 설치, SVG 시대 파일 제거"
```

---

## Task 2: 씬 스키마 v3

**Files:**
- Modify: `shared/types.ts`, `hub/src/scene.ts`, `scene.json`
- Test: `hub/test/scene.test.ts`

**Interfaces:**
- Consumes: Task 1 의 정리된 웹 (직접 의존은 없다)
- Produces:
  - `Floor` 에 `elevation?: number`
  - `Equipment` 에 `height?: number`, `shape?: "box" | "cylinder"`
  - `Scene.version` 이 `3`
  - `floorElevation(scene, floorId): number` — 기본값을 적용해 돌려주는 헬퍼 (`shared/types.ts`)
  - `equipmentHeight(eq): number`, `equipmentShape(eq): "box" | "cylinder"` (`shared/types.ts`)

- [ ] **Step 1: 실패하는 테스트 작성**

`hub/test/scene.test.ts` 의 `base()` 헬퍼에서 `version: 2` 를 `version: 3` 으로 바꾸고, 아래 테스트를 파일 끝에 덧붙인다:

```ts
test("규칙7: elevation 이 order 순으로 단조 증가하지 않으면 에러", () => {
  const s = base()
  s.floors = [
    { id: "1F", label: "1층", order: 1, elevation: 10 },
    { id: "2F", label: "2층", order: 2, elevation: 4 },
  ]
  assert.match(validateScene(s).errors.join("\n"), /elevation/)
})

test("규칙7: elevation 이 없어도 기본값이 단조 증가라 통과한다", () => {
  const s = base()
  s.floors = [
    { id: "1F", label: "1층", order: 1 },
    { id: "2F", label: "2층", order: 2 },
  ]
  // 1F 만 참조하므로 나머지 규칙도 통과해야 한다
  assert.deepEqual(validateScene(s).errors, [])
})

test("규칙7: 일부 층만 elevation 을 적어 실효 높이가 역전되면 에러", () => {
  const s = base()
  // 실효 높이: 1F=10(명시), 2F=6(기본 (2-1)*6), 3F=5(명시) → 감소한다.
  // 원시 값만 보면 인접 쌍마다 한쪽이 undefined 라 전부 건너뛰어 새어나간다.
  s.floors = [
    { id: "1F", label: "1층", order: 1, elevation: 10 },
    { id: "2F", label: "2층", order: 2 },
    { id: "3F", label: "3층", order: 3, elevation: 5 },
  ]
  assert.match(validateScene(s).errors.join("\n"), /높이/)
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
```

파일 맨 위 import 에 헬퍼를 더한다:
```ts
import { floorElevation, equipmentHeight, equipmentShape } from "../../shared/types.ts"
```

기존 `version 이 2 가 아니면` 테스트는 위의 새 테스트로 대체된다 — 지운다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd hub && npm test`
Expected: FAIL — `floorElevation is not a function` 과 `version 3` 관련 실패.

- [ ] **Step 3: 타입과 헬퍼 추가**

`shared/types.ts` 를 고친다:

```ts
export type Floor = {
  id: string
  label: string
  order: number
  /** 이 층 바닥의 높이(미터). 없으면 (order - 1) × 6. 층 겹침의 유일한 손잡이다 */
  elevation?: number
}
```

```ts
export type Equipment = {
  id: string
  label: string
  section: string
  pos: [number, number]
  size: [number, number]
  /** 설비 높이(미터). 없으면 2 */
  height?: number
  /** 없으면 "box" */
  shape?: "box" | "cylinder"
  tags: EquipmentTag[]
}
```

```ts
export type Scene = {
  version: 3
  ...
}
```

그리고 파일 끝에 기본값 헬퍼를 더한다. **기본값이 두 군데서 달라지면 허브 검증과 클라이언트 렌더가 어긋나므로 한 곳에만 둔다:**

```ts
/** 층 높이 기본값. elevation 이 없으면 층당 6m 로 쌓는다 */
export function floorElevation(scene: Scene, floorId: string): number {
  const f = scene.floors.find((x) => x.id === floorId)
  if (!f) return 0
  return f.elevation ?? (f.order - 1) * 6
}

export function equipmentHeight(eq: Equipment): number {
  return eq.height ?? 2
}

export function equipmentShape(eq: Equipment): "box" | "cylinder" {
  return eq.shape ?? "box"
}
```

- [ ] **Step 4: 검증 규칙 7·8 추가**

`hub/src/scene.ts` 의 `validateScene` 에서 규칙 6(미참조 카메라) 바로 앞에 넣는다:

```ts
  // 규칙7: 실효 높이가 order 순으로 단조 증가해야 한다.
  // 어긋나면 위층이 아래층 밑에 그려져 화면이 뒤집힌 것처럼 보인다.
  //
  // **원시 elevation 이 아니라 floorElevation() 으로 비교한다.** 원시 값을 읽고
  // undefined 인 쌍을 건너뛰면, 일부 층만 elevation 을 적은 씬에서 진짜 역전이
  // 통째로 새어나간다: 1F=10(명시), 2F 없음(기본 6), 3F=5(명시) 면 실효 높이가
  // 10, 6, 5 로 감소하는데 인접 쌍마다 한쪽이 undefined 라 전부 건너뛴다.
  // floorElevation 은 언제나 수를 돌려주므로 건너뛸 이유 자체가 없다.
  const byOrder = [...s.floors].sort((a, b) => a.order - b.order)
  for (let i = 1; i < byOrder.length; i++) {
    const lo = byOrder[i - 1], hi = byOrder[i]
    const loY = floorElevation(s, lo.id), hiY = floorElevation(s, hi.id)
    if (hiY <= loY)
      errors.push(`층 ${hi.id} 의 높이(${hiY}m) 가 아래층 ${lo.id}(${loY}m) 보다 높지 않다`)
  }

  // 규칙8: 설비 높이
  for (const e of s.equipment) {
    if (e.height !== undefined && e.height <= 0) {
      errors.push(`장비 ${e.id}: height 는 양수여야 한다 (받음: ${e.height})`)
      continue
    }
    const sec = secById.get(e.section)
    if (!sec) continue
    const base = floorElevation(s, sec.floor)
    const top = base + equipmentHeight(e)
    // 바로 위층이 있으면 그 바닥을 뚫는지 본다 — 경고다. 현장에 층고보다 높은
    // 설비(탱크가 두 층을 관통하는 등)가 실제로 있으므로 막지는 않는다.
    const above = byOrder.find((f) => floorElevation(s, f.id) > base)
    if (above && top > floorElevation(s, above.id))
      warnings.push(`장비 ${e.id} 가 위층 ${above.id} 바닥을 뚫는다 (윗면 ${top}m > ${floorElevation(s, above.id)}m)`)
  }
```

`floorElevation`/`equipmentHeight` 를 import 한다:
```ts
import { equipmentHeight, floorElevation } from "../../shared/types.ts"
```

그리고 `loadScene` 의 버전 게이트를 바꾼다:
```ts
  if (s.version !== 3) throw new Error(`씬 version 3 만 지원한다 (받음: ${s.version})`)
```

- [ ] **Step 5: 데모 씬을 v3 로 올린다**

`scene.json` 을 고친다 — `version` 과 층 `elevation`, 설비 `height`/`shape`:

```json
  "version": 3,
```
```json
  "floors": [
    { "id": "1F", "label": "1층", "order": 1, "elevation": 0 },
    { "id": "2F", "label": "2층", "order": 2, "elevation": 6 }
  ],
```
```json
  "equipment": [
    { "id": "loader-1", "label": "적재기 1", "section": "inbound",
      "pos": [6, 12], "size": [4, 3], "height": 2.2, "shape": "box", "tags": [] },
    { "id": "filler-1", "label": "충전기 1", "section": "filling",
      "pos": [6, 12], "size": [4, 3], "height": 3.2, "shape": "cylinder",
      "tags": [
        { "key": "speed", "label": "속도", "unit": "bpm", "warn": 250 },
        { "key": "temp", "label": "온도", "unit": "°C", "warn": 80 }
      ] },
    { "id": "capper-1", "label": "캡퍼 1", "section": "filling",
      "pos": [18, 12], "size": [3, 3], "height": 2.6, "shape": "box", "tags": [] },
    { "id": "packer-1", "label": "포장기 1", "section": "packing",
      "pos": [30, 12], "size": [4, 3], "height": 2.0, "shape": "box", "tags": [] }
  ],
```

`filler-1` 을 원통으로 둔 이유는 **두 모양이 실제로 다 그려지는지 데모에서 확인하기 위해서다.** 충전기는 현실에서도 원통형 탱크를 갖는다.

층고 6m 에 설비 최대 3.2m 이므로 규칙 8 경고가 안 난다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd hub && npm test`
Expected: PASS — 기존 37개에서 version 테스트 1개가 대체되고 6개가 추가되어 **42개**.

Run: `cd hub && npm run typecheck && cd ../web && npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add shared hub scene.json
git commit -m "feat: 씬 스키마 v3 — 층 elevation, 설비 height/shape"
```

---

## Task 3: Babylon 부트스트랩 + 정사영 카메라

**Files:**
- Create: `web/src/viewer/coords.ts`, `web/src/viewer/camera.ts`, `web/src/viewer/Viewer.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `Scene`, `floorElevation` (Task 2)
- Produces:
  - `coords.ts`: `toBabylon(x: number, y: number, elevation: number): Vector3`, `sceneBounds(scene): { min: Vector3; max: Vector3 }`
  - `camera.ts`: `createCamera(scene, canvas, bounds): IsoCamera`
    ```ts
    type IsoCamera = {
      camera: ArcRotateCamera
      rotate(dir: -1 | 1): void        // 90°씩
      home(): void                      // 전체보기
      flyTo(target: Vector3): void      // 400ms 보간
      dispose(): void
    }
    ```
  - `Viewer.tsx`: `<Viewer scene={Scene} onReady={(ctx: ViewerCtx) => void} />`
    ```ts
    type ViewerCtx = { bscene: BScene; cam: IsoCamera; engine: Engine }
    ```

- [ ] **Step 1: 좌표 모듈 작성**

`web/src/viewer/coords.ts`:
```ts
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene } from "../../../shared/types.ts"
import { equipmentHeight, floorElevation } from "../../../shared/types.ts"

/**
 * 씬 좌표는 평면도 기준으로 X 오른쪽, Y 위쪽이다. Babylon 은 Y 가 높이이므로
 * 씬의 Y 가 Babylon 의 Z 가 된다. **뒤집는 곳은 여기 하나뿐이다** —
 * 여기저기서 뒤집으면 어디가 뒤집혔는지 못 찾는다.
 */
export function toBabylon(x: number, y: number, elevation: number): Vector3 {
  return new Vector3(x, elevation, y)
}

/** 모든 층·구역·설비를 담는 상자. 전체보기와 카메라 거리 계산에 쓴다 */
export function sceneBounds(scene: Scene): { min: Vector3; max: Vector3 } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  let maxY = 0
  for (const sec of scene.sections) {
    const [x, y, w, h] = sec.rect
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + w)
    minZ = Math.min(minZ, y); maxZ = Math.max(maxZ, y + h)
    maxY = Math.max(maxY, floorElevation(scene, sec.floor))
  }
  for (const e of scene.equipment) {
    const sec = scene.sections.find((s) => s.id === e.section)
    if (!sec) continue
    maxY = Math.max(maxY, floorElevation(scene, sec.floor) + equipmentHeight(e))
  }
  if (!Number.isFinite(minX)) return { min: new Vector3(0, 0, 0), max: new Vector3(40, 6, 25) }
  return { min: new Vector3(minX, 0, minZ), max: new Vector3(maxX, maxY, maxZ) }
}
```

- [ ] **Step 2: 카메라 모듈 작성**

`web/src/viewer/camera.ts`:
```ts
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera"
import { Camera } from "@babylonjs/core/Cameras/camera"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene as BScene } from "@babylonjs/core/scene"

/**
 * 수평에서 35.26° 올려다본 각. Babylon 의 beta 는 +Y 축에서 재므로 54.74°,
 * 라디안으로 0.9553. 진짜 아이소메트릭(1:1:1) 각이다.
 * **바꿀 수 없다** — 기울일 수 있으면 누군가 기울여 놓고 가고,
 * 다음 사람이 이상한 화면을 본다.
 */
const BETA = 0.9553
/** 네 모서리. 45°에서 90°씩 */
const ALPHAS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
/** 드래그가 이보다 움직였으면 클릭이 아니라 팬이다 (CSS 픽셀) */
export const DRAG_SLOP = 4

export type IsoCamera = {
  camera: ArcRotateCamera
  rotate(dir: -1 | 1): void
  home(): void
  flyTo(target: Vector3): void
  /** 마지막 포인터 조작이 팬이었는지 — 클릭 오발동을 막는다 */
  didPan(): boolean
  dispose(): void
}

export function createCamera(
  scene: BScene,
  canvas: HTMLCanvasElement,
  bounds: { min: Vector3; max: Vector3 },
): IsoCamera {
  const center = bounds.min.add(bounds.max).scale(0.5)
  const span = bounds.max.subtract(bounds.min)
  const fit = Math.max(span.x, span.z, span.y * 2) * 0.75

  let alphaIdx = 0
  let zoom = fit
  let moved = false

  const camera = new ArcRotateCamera("iso", ALPHAS[0], BETA, 200, center, scene)
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = -1000
  camera.maxZ = 2000
  // 기본 입력을 전부 뗀다. 기울기·자유회전이 붙으면 각도 고정이 깨진다.
  camera.inputs.clear()

  const applyZoom = () => {
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    camera.orthoTop = zoom / 2
    camera.orthoBottom = -zoom / 2
    camera.orthoLeft = (-zoom * aspect) / 2
    camera.orthoRight = (zoom * aspect) / 2
  }
  applyZoom()

  // ── 팬: 화면 평면에서 끈다 ──────────────────────────────
  let drag: { x: number; y: number; target: Vector3 } | null = null
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, target: camera.target.clone() }
    moved = false
    canvas.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_SLOP) moved = true
    const px = (e.clientX - drag.x) / Math.max(canvas.clientWidth, 1)
    const py = (e.clientY - drag.y) / Math.max(canvas.clientHeight, 1)
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    // 화면 오른쪽·위 방향을 월드 벡터로 바꿔 그만큼 target 을 민다
    const right = camera.getDirection(Vector3.Right())
    const up = camera.getDirection(Vector3.Up())
    camera.target = drag.target
      .subtract(right.scale(px * zoom * aspect))
      .subtract(up.scale(-py * zoom))
  }
  const onUp = () => { drag = null }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    zoom = Math.min(Math.max(zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 4), fit * 4)
    applyZoom()
  }
  const onResize = () => applyZoom()

  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerup", onUp)
  canvas.addEventListener("pointercancel", onUp)
  canvas.addEventListener("wheel", onWheel, { passive: false })
  window.addEventListener("resize", onResize)

  // ── 보간 ────────────────────────────────────────────────
  let anim: { from: number; to: number; t0: number; dur: number; kind: "alpha" } |
            { from: Vector3; to: Vector3; t0: number; dur: number; kind: "target" } | null = null

  const tick = () => {
    if (!anim) return
    const k = Math.min((performance.now() - anim.t0) / anim.dur, 1)
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2 // easeInOutQuad
    if (anim.kind === "alpha") camera.alpha = anim.from + (anim.to - anim.from) * e
    else camera.target = Vector3.Lerp(anim.from, anim.to, e)
    if (k >= 1) anim = null
  }
  scene.onBeforeRenderObservable.add(tick)

  return {
    camera,
    rotate(dir) {
      const from = camera.alpha
      alphaIdx = (alphaIdx + dir + ALPHAS.length) % ALPHAS.length
      // 짧은 쪽으로 돈다
      let to = ALPHAS[alphaIdx]
      while (to - from > Math.PI) to -= 2 * Math.PI
      while (from - to > Math.PI) to += 2 * Math.PI
      anim = { kind: "alpha", from, to, t0: performance.now(), dur: 200 }
    },
    home() {
      zoom = fit
      applyZoom()
      anim = { kind: "target", from: camera.target.clone(), to: center, t0: performance.now(), dur: 400 }
    },
    flyTo(target) {
      anim = { kind: "target", from: camera.target.clone(), to: target, t0: performance.now(), dur: 400 }
    },
    didPan: () => moved,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      canvas.removeEventListener("wheel", onWheel)
      window.removeEventListener("resize", onResize)
      scene.onBeforeRenderObservable.removeCallback(tick)
    },
  }
}
```

- [ ] **Step 3: Viewer 컴포넌트 작성**

`web/src/viewer/Viewer.tsx`:
```tsx
import { useEffect, useRef } from "react"
import { Engine } from "@babylonjs/core/Engines/engine"
import { Scene as BScene } from "@babylonjs/core/scene"
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight"
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color"
import type { Scene } from "../../../shared/types.ts"
import { sceneBounds } from "./coords.ts"
import { createCamera, type IsoCamera } from "./camera.ts"

export type ViewerCtx = { bscene: BScene; cam: IsoCamera; engine: Engine }

type Props = {
  scene: Scene
  /** Babylon 씬이 준비되면 한 번 불린다. 반환한 정리 함수는 언마운트 때 실행된다 */
  onReady: (ctx: ViewerCtx) => (() => void) | void
}

export default function Viewer({ scene, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // onReady 를 ref 에 담는다. 의존성에 넣으면 값이 갱신될 때마다
  // 엔진이 통째로 재생성된다 — 3D 씬은 React 렌더 주기와 무관해야 한다.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    const bscene = new BScene(engine)
    bscene.clearColor = new Color4(0.06, 0.07, 0.09, 1)

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), bscene)
    hemi.intensity = 0.75
    hemi.groundColor = new Color3(0.2, 0.22, 0.26)
    const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), bscene)
    sun.intensity = 0.6

    const cam = createCamera(bscene, canvas, sceneBounds(scene))
    const cleanup = onReadyRef.current({ bscene, cam, engine })

    engine.runRenderLoop(() => bscene.render())
    const onResize = () => engine.resize()
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      cleanup?.()
      cam.dispose()
      bscene.dispose()
      engine.dispose()
    }
  }, [scene])

  return <canvas ref={canvasRef} className="viewer" />
}
```

- [ ] **Step 4: App 에 끼우고 조작 버튼을 단다**

`App.tsx` 의 `<div className="viewer-slot">` 을 교체한다:
```tsx
  const camRef = useRef<IsoCamera | null>(null)
```
```tsx
      <div className="viewer-wrap">
        <Viewer
          scene={scene}
          onReady={({ cam }) => { camRef.current = cam; return () => { camRef.current = null } }}
        />
        <div className="viewer-controls">
          <button title="왼쪽으로 회전" onClick={() => camRef.current?.rotate(-1)}>⟲</button>
          <button title="오른쪽으로 회전" onClick={() => camRef.current?.rotate(1)}>⟳</button>
          <button title="전체보기" onClick={() => camRef.current?.home()}>⌂</button>
        </div>
      </div>
```

`import { useRef, useState } from "react"`, `import Viewer from "./viewer/Viewer.tsx"`, `import type { IsoCamera } from "./viewer/camera.ts"` 를 더한다.

`styles.css`:
```css
.viewer-wrap { position: relative; min-height: 0; }
/* height 를 주지 않는다 — 그리드 1fr 트랙이 이미 크기를 정한다.
   퍼센트 높이를 주면 부모에 확정 높이가 없어 풀리고 페이지가 넘친다. */
.viewer { width: 100%; height: 100%; display: block; outline: none; touch-action: none; }
.viewer-controls { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 6px; }
.viewer-controls button {
  width: 32px; height: 32px; border: 1px solid #2b3240; border-radius: 6px;
  background: #171b22; color: #e6e8eb; font-size: 16px; cursor: pointer;
}
.viewer-controls button:hover { background: #222833; }
```

- [ ] **Step 5: 화면 확인**

Run:
```bash
cd web && npm run typecheck && npm run build
cd ../hub && WEB_DIR=../web/dist npx tsx src/index.ts &
sleep 3
node ../tools/shot.mjs http://localhost:8080/ /tmp/t3.png
```

찍은 png 를 열어 확인할 것:
1. 빈 3D 캔버스가 화면을 채운다 (어두운 남색 배경)
2. 우하단에 `⟲ ⟳ ⌂` 세 버튼
3. **세로 스크롤바가 없다**
4. 콘솔 에러가 없다

아직 아무 메시도 없으므로 배경만 보이는 게 정상이다.

번들 크기를 재고 리포트에 적어라:
```bash
cd web && npm run build 2>&1 | grep -E "gzip"
```
Expected: 초기 로드(주 JS 청크 + CSS) gzip 합계를 **숫자로 적는다.** 350KB 를 넘으면 무엇이 들어왔는지 찾아 적어라. 지연 로드 청크(이 씬이 안 쓰는 텍스처 로더 등)는 초기 로드가 아니므로 따로 적는다.

- [ ] **Step 6: 커밋**

```bash
git add web/src
git commit -m "feat: Babylon 부트스트랩 + 정사영 아이소메트릭 카메라"
```

---

## Task 4: 지오메트리 — 바닥판과 설비

**Files:**
- Create: `web/src/viewer/build.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `toBabylon` (Task 3), `floorElevation`/`equipmentHeight`/`equipmentShape` (Task 2)
- Produces:
  - `build.ts`: `buildStatic(bscene: BScene, scene: Scene): StaticMeshes`
    ```ts
    type MeshKind = "section" | "equipment" | "segment" | "andon"
    type MeshMeta = { kind: MeshKind; id: string }   // mesh.metadata 에 담긴다
    type StaticMeshes = { dispose(): void; equipmentById: Map<string, AbstractMesh> }
    ```

- [ ] **Step 1: 빌더 작성 (바닥판 + 설비)**

`web/src/viewer/build.ts`:
```ts
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder"
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Scene } from "../../../shared/types.ts"
import { equipmentHeight, equipmentShape, floorElevation } from "../../../shared/types.ts"
import { toBabylon } from "./coords.ts"

export type MeshKind = "section" | "equipment" | "segment" | "andon"
export type MeshMeta = { kind: MeshKind; id: string }

export type StaticMeshes = {
  dispose(): void
  equipmentById: Map<string, AbstractMesh>
}

/** 바닥판 두께 */
const SLAB = 0.1

export function buildStatic(bscene: BScene, scene: Scene): StaticMeshes {
  const created: AbstractMesh[] = []
  const equipmentById = new Map<string, AbstractMesh>()

  // ── 구역 바닥판 ─────────────────────────────────────────
  // 반투명이라 위층이 아래층을 가리지 않는다. 이게 "층이 동시에 보인다" 의
  // 실현 방법이다.
  const slabMat = new StandardMaterial("slab", bscene)
  slabMat.diffuseColor = new Color3(0.16, 0.19, 0.24)
  slabMat.specularColor = Color3.Black()
  slabMat.alpha = 0.25

  for (const sec of scene.sections) {
    const [x, y, w, h] = sec.rect
    const elev = floorElevation(scene, sec.floor)
    const slab = CreateBox(`sec:${sec.id}`, { width: w, height: SLAB, depth: h }, bscene)
    slab.position = toBabylon(x + w / 2, y + h / 2, elev - SLAB / 2)
    slab.material = slabMat
    slab.metadata = { kind: "section", id: sec.id } satisfies MeshMeta
    created.push(slab)
  }

  // ── 설비 ────────────────────────────────────────────────
  const eqMat = new StandardMaterial("eq", bscene)
  eqMat.diffuseColor = new Color3(0.28, 0.32, 0.38)
  eqMat.specularColor = new Color3(0.1, 0.1, 0.1)

  for (const e of scene.equipment) {
    const sec = scene.sections.find((s) => s.id === e.section)
    if (!sec) continue
    const elev = floorElevation(scene, sec.floor)
    const ht = equipmentHeight(e)
    const [w, d] = e.size

    const mesh = equipmentShape(e) === "cylinder"
      ? CreateCylinder(`eq:${e.id}`, { diameter: Math.min(w, d), height: ht, tessellation: 24 }, bscene)
      : CreateBox(`eq:${e.id}`, { width: w, height: ht, depth: d }, bscene)

    // Babylon 의 상자·원통은 원점이 중심이므로 높이의 절반만큼 올린다
    mesh.position = toBabylon(e.pos[0], e.pos[1], elev + ht / 2)
    mesh.material = eqMat
    mesh.metadata = { kind: "equipment", id: e.id } satisfies MeshMeta
    created.push(mesh)
    equipmentById.set(e.id, mesh)
  }

  return {
    equipmentById,
    dispose() {
      for (const m of created) m.dispose()
      slabMat.dispose()
      eqMat.dispose()
    },
  }
}
```

- [ ] **Step 2: App 에서 호출**

`App.tsx` 의 `onReady` 를 바꾼다:
```tsx
          onReady={({ bscene, cam }) => {
            camRef.current = cam
            const statics = buildStatic(bscene, scene)
            return () => { statics.dispose(); camRef.current = null }
          }}
```
`import { buildStatic } from "./viewer/build.ts"` 를 더한다.

- [ ] **Step 3: 화면 확인**

빌드하고 허브를 띄운 뒤 `node tools/shot.mjs http://localhost:8080/ /tmp/t4.png`

확인할 것:
1. **바닥판 두 장이 위아래로 떠 있다** — 1층(elevation 0)과 2층(elevation 6)
2. 위층 바닥판 너머로 **1층 설비가 비친다**
3. 설비 상자 4개가 각자 구역 안에 서 있다
4. **`filler-1` 은 원통이고 나머지는 상자다**
5. 비스듬히 내려다보는 각도다 (수직도 정면도 아니다)
6. `⟲` 를 누른 상태로 다시 찍으면 **다른 모서리에서 본 화면**이 나온다

6번은 스크린샷 두 장이 필요하므로, 페이지에 임시 스크립트를 주입해 `⟲` 를 누른 뒤 찍는 방식을 써라 (`dist/index.html` 사본에 `<script>` 를 넣고 그 사본을 서빙). 확인 후 사본은 지워라.

- [ ] **Step 4: 커밋**

```bash
git add web/src
git commit -m "feat: 구역 바닥판과 설비 지오메트리"
```

---

## Task 5: 지오메트리 — 구간과 리프트

**Files:**
- Modify: `web/src/viewer/build.ts`, `web/src/viewer/coords.ts`

**Interfaces:**
- Consumes: Task 4 의 `buildStatic`
- Produces:
  - `coords.ts`: `segmentPoints(scene, seg): Vector3[]` — 벨트면 높이까지 반영한 월드 점열
  - `coords.ts`: `pathSampler(points): { length: number; at(t: number): Vector3 }`
  - `build.ts` 의 `StaticMeshes` 에 `segmentById: Map<string, AbstractMesh>` 추가

- [ ] **Step 1: 경로 유틸 작성**

`coords.ts` 에 덧붙인다:
```ts
import type { Segment } from "../../../shared/types.ts"
import { isLift } from "../../../shared/types.ts"

/** 컨베이어 벨트면 높이. 바닥에 붙어 있으면 물건이 바닥을 미끄러지는 것처럼 보인다 */
export const BELT_Y = 0.8

/**
 * 구간의 월드 점열. 리프트는 두 층을 잇는 수직 선분이고,
 * 평면 구간은 from → via… → to 의 폴리라인이다.
 */
export function segmentPoints(scene: Scene, seg: Segment): Vector3[] {
  const fromY = floorElevation(scene, seg.from.floor) + BELT_Y
  const toY = floorElevation(scene, seg.to.floor) + BELT_Y
  if (isLift(seg)) {
    return [toBabylon(seg.from.x, seg.from.y, fromY), toBabylon(seg.to.x, seg.to.y, toY)]
  }
  return [
    toBabylon(seg.from.x, seg.from.y, fromY),
    ...(seg.via ?? []).map(([x, y]) => toBabylon(x, y, fromY)),
    toBabylon(seg.to.x, seg.to.y, toY),
  ]
}

/** 폴리라인 위를 0..1 로 훑는다. 물건 배치와 신호등 위치에 쓴다 */
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

- [ ] **Step 2: 구간 메시를 빌더에 추가**

`build.ts` 의 설비 루프 뒤에 넣고, 파일 맨 위 import 에 아래 한 줄을 더한다:
```ts
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder"
```

```ts
  // ── 구간 (벨트) ─────────────────────────────────────────
  // 상태색은 Task 7 의 신호등이 지고, 벨트 자체는 중립색이다. 벨트에까지
  // 색을 칠하면 카메라 각도에 따라 안 보이는 면이 생겨 신호가 흔들린다.
  const beltMat = new StandardMaterial("belt", bscene)
  beltMat.diffuseColor = new Color3(0.22, 0.25, 0.3)
  beltMat.specularColor = Color3.Black()

  const segmentById = new Map<string, AbstractMesh>()
  for (const seg of scene.segments) {
    const pts = segmentPoints(scene, seg)
    // 폴리라인을 튜브로 만든다. 꺾인 구간도 한 메시로 처리된다.
    const tube = CreateTube(
      `seg:${seg.id}`,
      { path: pts, radius: 0.22, tessellation: 8, cap: 2 },
      bscene,
    )
    tube.material = beltMat
    tube.metadata = { kind: "segment", id: seg.id } satisfies MeshMeta
    created.push(tube)
    segmentById.set(seg.id, tube)
  }
```

`StaticMeshes` 타입과 반환값에 `segmentById` 를 더하고, import 에 `segmentPoints` 를 더한다.

- [ ] **Step 3: 화면 확인**

빌드·서빙·촬영 후 확인:
1. 1층에 `conv-1` 튜브가 길게 누워 있다
2. 2층에 `conv-3`, `conv-5` 가 있고 `conv-5` 는 `via` 때문에 직각으로 꺾인다
3. **`lift-1` 이 1층과 2층을 잇는 비스듬한 관으로 보인다** — 층 사이가 실제로 이어진 게 눈에 보인다
4. 벨트가 바닥판 위 0.8m 에 떠 있다 (바닥에 파묻히지 않았다)

- [ ] **Step 4: 커밋**

```bash
git add web/src
git commit -m "feat: 구간·리프트 지오메트리와 경로 샘플러"
```

---

## Task 6: 물건 흐름

**Files:**
- Create: `web/src/viewer/flow.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `segmentPoints`/`pathSampler` (Task 5), `segState`/`segWip` (Task 1)
- Produces:
  - `flow.ts`: `createFlow(bscene, scene): Flow`
    ```ts
    type Flow = {
      /** 값이 갱신될 때마다 부른다 (렌더 루프가 아니라 데이터 주기) */
      setValues(values: Map<string, TagValue>): void
      dispose(): void
    }
    ```

- [ ] **Step 1: 흐름 모듈 작성**

`web/src/viewer/flow.ts`:
```ts
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Scene, SegState, TagValue } from "../../../shared/types.ts"
import { segState, segWip } from "../state.ts"
import { pathSampler, segmentPoints } from "./coords.ts"

/** 눈에 보이는 이동 속도 (미터/초). 구간 길이와 무관하게 같아 보이게 한다 */
const SPEED = 3
/** 구간당 최대 렌더 개수. capacity 가 커도 브라우저가 죽으면 안 된다 */
const MAX_ITEMS = 60

type SegFlow = {
  sampler: ReturnType<typeof pathSampler>
  capacity: number
  /** 0..1, 흐를 때만 증가 */
  phase: number
  count: number
  state: SegState
}

export type Flow = {
  setValues(values: Map<string, TagValue>): void
  dispose(): void
}

export function createFlow(bscene: BScene, scene: Scene): Flow {
  const mat = new StandardMaterial("item", bscene)
  mat.diffuseColor = new Color3(0.82, 0.86, 0.92)
  mat.specularColor = Color3.Black()

  // 상자 하나를 thin instance 로 복제한다 — 몇백 개여도 드로우콜 하나다
  const proto = CreateBox("items", { size: 0.38 }, bscene)
  proto.material = mat
  proto.isPickable = false
  proto.thinInstanceEnablePicking = false

  const flows = new Map<string, SegFlow>()
  for (const seg of scene.segments) {
    flows.set(seg.id, {
      sampler: pathSampler(segmentPoints(scene, seg)),
      capacity: seg.capacity ?? 20,
      phase: 0,
      count: 0,
      state: "unknown",
    })
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  let buf = new Float32Array(0)

  const rebuild = () => {
    let total = 0
    for (const f of flows.values()) total += f.count
    if (buf.length !== total * 16) buf = new Float32Array(total * 16)

    let o = 0
    for (const f of flows.values()) {
      // 간격은 capacity 로 고정이다. 개수로 나누면 물건이 하나 생길 때마다
      // 기존 물건이 전부 자리를 옮겨 화면이 튄다.
      const gap = 1 / f.capacity
      for (let i = 0; i < f.count; i++) {
        const p = f.sampler.at(f.phase - i * gap)
        Matrix.Translation(p.x, p.y, p.z).copyToArray(buf, o)
        o += 16
      }
    }
    proto.thinInstanceSetBuffer("matrix", buf, 16)
    proto.setEnabled(total > 0)
  }

  const onFrame = () => {
    if (reduced) return
    const dt = bscene.getEngine().getDeltaTime() / 1000
    let moved = false
    for (const f of flows.values()) {
      // 멈춘 구간은 위상을 안 올린다 → 물건이 그 자리에 얼어붙는다
      if (f.state !== "running" || f.count === 0) continue
      f.phase = (f.phase + (SPEED * dt) / f.sampler.length) % 1
      moved = true
    }
    if (moved) rebuild()
  }
  bscene.onBeforeRenderObservable.add(onFrame)

  return {
    setValues(values) {
      for (const [id, f] of flows) {
        f.state = segState(id, values)
        const wip = segWip(id, values)
        // capacity 를 넘겨 그려봐야 앞선 물건과 겹쳐 안 보인다.
        // 넘는 수량은 Task 9 의 +N 라벨이 말한다.
        f.count = f.state === "unknown" ? 0 : Math.min(wip, f.capacity, MAX_ITEMS)
      }
      rebuild()
    },
    dispose() {
      bscene.onBeforeRenderObservable.removeCallback(onFrame)
      proto.dispose()
      mat.dispose()
    },
  }
}
```

- [ ] **Step 2: App 에서 값을 흘려보낸다**

`App.tsx` 에 `flowRef` 를 더하고, `onReady` 에서 만들고, 값이 바뀔 때 먹인다:

```tsx
  const flowRef = useRef<Flow | null>(null)

  useEffect(() => { flowRef.current?.setValues(values) }, [values])
```
```tsx
          onReady={({ bscene, cam }) => {
            camRef.current = cam
            const statics = buildStatic(bscene, scene)
            const flow = createFlow(bscene, scene)
            flowRef.current = flow
            return () => {
              flow.dispose(); statics.dispose()
              flowRef.current = null; camRef.current = null
            }
          }}
```

`useEffect` 를 import 에 더한다. **훅은 전부 조기 반환 위에 둔다** — 아래에 두면 `data` 가 도착한 렌더에서 훅 개수가 달라져 React 가 던지고 화면이 통째로 빈다.

- [ ] **Step 3: 화면 확인**

허브를 띄우고 **40초 전**(정지 전)에 한 번, **정지 중**에 한 번 찍는다. 정지 여부는 WebSocket 으로 확인해라:

```bash
cd hub && cat > p.tmp.mjs <<'EOF'
import WebSocket from "ws"
const ws = new WebSocket("ws://127.0.0.1:8080/ws")
const v = new Map()
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString())
  for (const t of m.data) v.set(t.tag, t.v)
  if (m.type === "snapshot") {
    console.log(`conv-3=${v.get("conv-3.state")} wip=${v.get("conv-3.wip")} conv-5=${v.get("conv-5.state")}`)
    ws.close(); process.exit(0)
  }
})
setTimeout(() => process.exit(1), 5000)
EOF
npx tsx p.tmp.mjs; rm p.tmp.mjs
```

확인할 것:
1. 가동 중일 때 벨트 위에 작은 상자들이 놓여 있다
2. **정지 중일 때 `conv-3` 위에 상자가 빽빽하다** (`capacity` 12개까지)
3. `conv-5` 가 굶은 구간이면 상자가 **없다**
4. 상자가 벨트에서 벗어나 떠 있거나 파묻히지 않는다

움직임은 스크린샷으로 못 본다. 대신 `--virtual-time-budget` 을 다르게 줘서 두 장을 찍고 **상자 위치가 달라졌는지** 비교해라.

- [ ] **Step 4: 커밋**

```bash
git add web/src
git commit -m "feat: Thin Instance 물건 흐름"
```

---

## Task 7: 적층 신호등

**Files:**
- Create: `web/src/viewer/andon.ts`
- Modify: `web/src/App.tsx`, `web/src/viewer/build.ts`

**Interfaces:**
- Consumes: `segmentPoints` (Task 5), `segState` (Task 1), `equipmentHeight` (Task 2)
- Produces:
  - `andon.ts`: `createAndons(bscene, scene): Andons`
    ```ts
    type Andons = {
      setValues(values: Map<string, TagValue>): void
      dispose(): void
    }
    ```

- [ ] **Step 1: 신호등 모듈 작성**

`web/src/viewer/andon.ts`:
```ts
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder"
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import type { Mesh } from "@babylonjs/core/Meshes/mesh"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Scene, SegState, TagValue } from "../../../shared/types.ts"
import { equipmentHeight, floorElevation } from "../../../shared/types.ts"
import { segState } from "../state.ts"
import { segmentPoints } from "./coords.ts"

/**
 * 적층 신호등. 구간의 출구 끝에 세운다 — 막힘이 드러나는 자리가 거기다.
 * 기둥이라 위에서도 옆에서도 다른 설비 뒤에서도 보인다. 평면 색칠은 3D 에서
 * 카메라 각도에 따라 사라지지만 수직 요소는 사라지지 않는다.
 * 그리고 현장 사람이 이미 읽을 줄 아는 물건이다.
 */
const MIN_POLE = 3

const LAMP: Record<SegState, { color: Color3; blinkHz: number }> = {
  running: { color: new Color3(0.30, 0.85, 0.42), blinkHz: 0 },
  stalled: { color: new Color3(1.00, 0.25, 0.25), blinkHz: 1 },
  idle:    { color: new Color3(0.18, 0.20, 0.24), blinkHz: 0 },
  unknown: { color: new Color3(0.90, 0.90, 0.90), blinkHz: 0.5 },
}

type One = { lamp: Mesh; mat: StandardMaterial; state: SegState }

export type Andons = {
  setValues(values: Map<string, TagValue>): void
  dispose(): void
}

export function createAndons(bscene: BScene, scene: Scene): Andons {
  const poleMat = new StandardMaterial("pole", bscene)
  poleMat.diffuseColor = new Color3(0.18, 0.20, 0.24)
  poleMat.specularColor = Color3.Black()

  const made: One[] = []
  const created: Mesh[] = []

  for (const seg of scene.segments) {
    const pts = segmentPoints(scene, seg)
    const end = pts[pts.length - 1]

    // 기둥은 그 구간이 닿는 설비보다 높아야 뒤에 서도 보인다
    const sec = scene.sections.find((s) => s.id === seg.section)
    const base = sec ? floorElevation(scene, sec.floor) : 0
    const tallest = scene.equipment
      .filter((e) => e.section === seg.section)
      .reduce((m, e) => Math.max(m, equipmentHeight(e)), 0)
    const poleH = Math.max(MIN_POLE, tallest + 1)

    const pole = CreateCylinder(`andonpole:${seg.id}`, { diameter: 0.12, height: poleH, tessellation: 8 }, bscene)
    pole.position.set(end.x, base + poleH / 2, end.z)
    pole.material = poleMat
    pole.isPickable = false
    created.push(pole)

    const mat = new StandardMaterial(`andon:${seg.id}`, bscene)
    mat.diffuseColor = Color3.Black()
    mat.specularColor = Color3.Black()
    mat.emissiveColor = LAMP.unknown.color

    const lamp = CreateSphere(`andon:${seg.id}`, { diameter: 0.7, segments: 10 }, bscene)
    lamp.position.set(end.x, base + poleH, end.z)
    lamp.material = mat
    // 신호등을 클릭하면 그 구간이 잡혀야 한다
    lamp.metadata = { kind: "andon", id: seg.id }
    created.push(lamp)

    made.push({ lamp, mat, state: "unknown" })
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const onFrame = () => {
    if (reduced) return
    const t = performance.now() / 1000
    for (const one of made) {
      const spec = LAMP[one.state]
      if (spec.blinkHz === 0) continue
      // 점멸은 재질의 emissive 만 바꾼다. 메시를 다시 만들지 않는다.
      const on = Math.floor(t * spec.blinkHz * 2) % 2 === 0
      one.mat.emissiveColor = on ? spec.color : spec.color.scale(0.15)
    }
  }
  bscene.onBeforeRenderObservable.add(onFrame)

  return {
    setValues(values) {
      for (let i = 0; i < scene.segments.length; i++) {
        const st = segState(scene.segments[i].id, values)
        made[i].state = st
        made[i].mat.emissiveColor = LAMP[st].color
      }
    },
    dispose() {
      bscene.onBeforeRenderObservable.removeCallback(onFrame)
      for (const m of created) m.dispose()
      for (const o of made) o.mat.dispose()
      poleMat.dispose()
    },
  }
}
```

- [ ] **Step 2: App 에 붙인다**

`onReady` 에서 `createAndons` 를 만들고, `values` effect 에서 함께 먹인다:
```tsx
  const andonRef = useRef<Andons | null>(null)

  useEffect(() => {
    flowRef.current?.setValues(values)
    andonRef.current?.setValues(values)
  }, [values])
```

`onReady` 의 정리 함수에서도 `andons.dispose()` 를 부른다.

import 를 더한다:
```ts
import { createAndons, type Andons } from "./viewer/andon.ts"
```

- [ ] **Step 3: 장비 경고 발광 추가**

스펙 6장: *"장비 경고(`warn` 초과)는 **다른 언어를 쓴다** — `HighlightLayer` 로
설비 외곽에 주황 발광. 신호등과 모양도 위치도 달라서 겹쳐 봐도 안 헷갈린다."*

구간 정지(기둥 램프)와 장비 경고(외곽 발광)를 같은 언어로 만들면 둘이 섞인다.
`andon.ts` 에 함께 둔다 — 값이 바뀔 때 상태를 반영하는 일이 같은 종류라서다.

`andon.ts` 에 덧붙인다:

```ts
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer"
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh"

const WARN_GLOW = new Color3(0.88, 0.54, 0.18)

/** 이력이 필요 없는 순간 판정이라 클라이언트가 계산한다 (스펙 6장) */
function isWarning(scene: Scene, eqId: string, values: Map<string, TagValue>): boolean {
  const eq = scene.equipment.find((e) => e.id === eqId)
  if (!eq) return false
  return eq.tags.some((t) => {
    if (t.warn === undefined) return false
    const v = values.get(`${eq.id}.${t.key}`)
    return typeof v?.v === "number" && v.q === "good" && v.v >= t.warn
  })
}
```

`createAndons` 의 시그니처에 설비 메시 맵을 받는 인자를 더한다:

```ts
export function createAndons(
  bscene: BScene,
  scene: Scene,
  equipmentById: Map<string, AbstractMesh>,
): Andons {
```

본문 앞쪽에 하이라이트 레이어를 만들고:
```ts
  const glow = new HighlightLayer("warn", bscene)
  const glowing = new Set<string>()
```

`setValues` 안에서 구간 루프 뒤에 설비 루프를 더한다:
```ts
      for (const [id, mesh] of equipmentById) {
        const want = isWarning(scene, id, values)
        const has = glowing.has(id)
        if (want && !has) { glow.addMesh(mesh as Mesh, WARN_GLOW); glowing.add(id) }
        else if (!want && has) { glow.removeMesh(mesh as Mesh); glowing.delete(id) }
      }
```

`dispose` 에 `glow.dispose()` 를 더한다.

`App.tsx` 의 호출부를 고친다:
```tsx
            const statics = buildStatic(bscene, scene)
            const andons = createAndons(bscene, scene, statics.equipmentById)
```

- [ ] **Step 4: 화면 확인**

가동 중과 정지 중 두 시점을 찍어 비교한다.

확인할 것:
0. **`filler-1` 의 온도가 80 을 넘는 순간 그 원통 외곽에 주황 발광**이 생긴다.
   모의 어댑터가 `warn × 0.85` 중심으로 흔들므로 가끔 넘는다. 넘지 않는 시점에
   찍혔으면 여러 번 찍어 확인해라. **신호등(기둥 램프)과 생김새가 확연히
   다른지**도 같이 본다 — 겹쳐 봐도 안 헷갈려야 한다.
1. 각 구간 출구에 **기둥과 램프**가 서 있다
2. 가동 중이면 램프가 **초록**
3. **정지 중이면 빨강** (점멸은 스크린샷으로 못 보므로 두 장을 다른 시점에 찍어 밝기가 다른지 본다)
4. **굶은 구간은 램프가 어둡다** (꺼짐)
5. 기둥이 설비보다 높아 **설비 뒤에 있어도 램프가 보인다** — `⟲` 로 돌려가며 네 모서리에서 확인해라
6. 색을 흑백으로 바꿔도(이미지 편집 없이 눈으로) **정지와 대기가 물건 유무로 구분된다**

- [ ] **Step 5: 커밋**

```bash
git add web/src
git commit -m "feat: 적층 신호등 + 장비 경고 발광"
```

---

## Task 8: 피킹과 모달

**Files:**
- Create: `web/src/viewer/pick.ts`
- Modify: `web/src/App.tsx`, `web/src/Modal.tsx`

**Interfaces:**
- Consumes: `MeshMeta` (Task 4), `DRAG_SLOP`/`didPan` (Task 3)
- Produces:
  - `pick.ts`: `attachPicking(bscene, cam, onPick: (sel: Selection) => void): () => void`

- [ ] **Step 1: 피킹 모듈 작성**

`web/src/viewer/pick.ts`:
```ts
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Selection } from "../state.ts"
import type { IsoCamera } from "./camera.ts"
import type { MeshKind, MeshMeta } from "./build.ts"

/**
 * 종류 우선순위. 반투명 바닥판 너머의 아래층 설비를 곧장 누를 수 있어야 하므로
 * 바닥판을 맨 뒤에 둔다. 바닥판 자체도 클릭 대상이라(구역 모달) 끄지는 않는다.
 */
const PRIORITY: MeshKind[] = ["equipment", "segment", "andon", "section"]

export function attachPicking(
  bscene: BScene,
  cam: IsoCamera,
  onPick: (sel: Selection) => void,
): () => void {
  const canvas = bscene.getEngine().getRenderingCanvas()
  if (!canvas) return () => {}

  const onClick = () => {
    // 팬 드래그 뒤의 합성 클릭을 막는다. 지도를 끌 때마다 모달이 열리면
    // 아무도 지도를 못 끈다.
    if (cam.didPan()) return

    const hits = bscene.multiPick(bscene.pointerX, bscene.pointerY) ?? []
    let best: { meta: MeshMeta; dist: number; rank: number } | null = null
    for (const h of hits) {
      const meta = h.pickedMesh?.metadata as MeshMeta | undefined
      if (!meta) continue
      const rank = PRIORITY.indexOf(meta.kind)
      if (rank < 0) continue
      if (!best || rank < best.rank || (rank === best.rank && h.distance < best.dist))
        best = { meta, dist: h.distance, rank }
    }
    if (!best) return
    // 신호등을 누르면 그 구간이 잡힌다
    const kind = best.meta.kind === "andon" ? "segment" : best.meta.kind
    onPick({ kind: kind as "section" | "equipment" | "segment", id: best.meta.id })
  }

  canvas.addEventListener("click", onClick)
  return () => canvas.removeEventListener("click", onClick)
}
```

- [ ] **Step 2: App 에 배선**

`onReady` 안에서:
```tsx
            const detach = attachPicking(bscene, cam, setSelection)
```
정리 함수에서 `detach()` 를 부른다.

- [ ] **Step 3: `Modal.tsx` 의 import 정리**

`Selection` 을 `./state.ts` 에서 가져오도록 고치고, 나머지는 그대로 둔다 — 모달의 동작(초점 이동·복귀·Tab 트랩·배경 드래그 가드·단일 스트림)은 이미 검증된 것이라 손대지 않는다.

- [ ] **Step 4: 화면 확인**

브라우저 없이 클릭을 확인하려면 페이지에 스크립트를 주입한다. `dist` 사본을 만들어 `index.html` 끝에 붙인다:

```html
<script>
setTimeout(() => {
  const c = document.querySelector('canvas.viewer');
  const r = c.getBoundingClientRect();
  // 캔버스 한가운데를 누른다 — 설비나 바닥판이 잡혀야 한다
  const at = (x, y) => {
    for (const t of ['pointerdown','pointerup','click'])
      c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true }));
  };
  at(r.left + r.width/2, r.top + r.height/2);
  setTimeout(() => {
    const d = document.createElement('div');
    d.style.cssText='position:fixed;top:0;left:0;z-index:99999;background:#000;color:#0f0;font:14px monospace;padding:8px';
    d.textContent = '모달: ' + (document.querySelector('.modal') ? document.querySelector('.modal h2').textContent : '안 열림');
    document.body.appendChild(d);
  }, 400);
}, 3000);
</script>
```

확인할 것:
1. 캔버스를 클릭하면 **모달이 열리고 제목이 보인다**
2. 구간을 클릭하면 `in`/`out`/`wip`/정지시간이 뜬다
3. **신호등을 클릭해도 그 구간 모달이 열린다**
4. `packing` 구역을 클릭하면 영상 자리 없이 수치만 뜬다
5. **드래그(팬) 뒤에는 모달이 안 열린다** — `pointerdown` → 여러 번 `pointermove`(10px 이상) → `pointerup` → `click` 순서로 보내 확인해라

확인 후 사본은 지워라.

- [ ] **Step 5: 커밋**

```bash
git add web/src
git commit -m "feat: 3D 피킹과 모달 연결"
```

---

## Task 9: HTML 오버레이 라벨

**Files:**
- Create: `web/src/viewer/project.ts`, `web/src/Labels.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `ViewerCtx` (Task 3), `segmentPoints` (Task 5), `segWip` (Task 1)
- Produces:
  - `project.ts`: `projectToScreen(bscene, world: Vector3): { x: number; y: number; visible: boolean }`
  - `Labels.tsx`: `<Labels ctx={ViewerCtx | null} scene={Scene} values={Map} />`

- [ ] **Step 1: 투영 모듈 작성**

`web/src/viewer/project.ts`:
```ts
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene as BScene } from "@babylonjs/core/scene"

/**
 * 3D 좌표를 캔버스 화면 좌표로. 글자를 3D 로 그리지 않는 이유는
 * 한글이 3D 텍스처로는 흐리고, Babylon GUI 모듈을 안 들여도 되기 때문이다.
 */
export function projectToScreen(bscene: BScene, world: Vector3): { x: number; y: number; visible: boolean } {
  const engine = bscene.getEngine()
  const cam = bscene.activeCamera
  if (!cam) return { x: 0, y: 0, visible: false }
  const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const p = Vector3.Project(world, Matrix.Identity(), bscene.getTransformMatrix(), vp)
  const dpr = engine.getHardwareScalingLevel()
  return {
    x: p.x * dpr,
    y: p.y * dpr,
    // 정사영이라 뒤로 넘어가는 일은 없지만 화면 밖은 거른다
    visible: p.x >= 0 && p.y >= 0 && p.x <= vp.width && p.y <= vp.height,
  }
}
```

- [ ] **Step 2: 라벨 컴포넌트 작성**

`web/src/Labels.tsx`:
```tsx
import { useEffect, useState } from "react"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, TagValue } from "../../shared/types.ts"
import { equipmentHeight, floorElevation } from "../../shared/types.ts"
import { segState, segStallMs, segWip, formatStall } from "./state.ts"
import { toBabylon, segmentPoints } from "./viewer/coords.ts"
import { projectToScreen } from "./viewer/project.ts"
import type { ViewerCtx } from "./viewer/Viewer.tsx"

type Item = { key: string; text: string; x: number; y: number; cls: string }

/** 이 배율보다 멀면 라벨을 숨긴다. 멀리서는 신호등만 남는다 */
const SHOW_BELOW = 60

export default function Labels({ ctx, scene, values }: {
  ctx: ViewerCtx | null
  scene: Scene
  values: Map<string, TagValue>
}) {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    if (!ctx) return
    const { bscene, cam } = ctx

    const recompute = () => {
      const zoom = (cam.camera.orthoTop ?? 0) * 2
      if (zoom > SHOW_BELOW) { setItems([]); return }

      const out: Item[] = []

      for (const e of scene.equipment) {
        const sec = scene.sections.find((s) => s.id === e.section)
        if (!sec) continue
        const top = floorElevation(scene, sec.floor) + equipmentHeight(e) + 0.4
        const p = projectToScreen(bscene, toBabylon(e.pos[0], e.pos[1], top))
        if (p.visible) out.push({ key: `eq:${e.id}`, text: e.label, x: p.x, y: p.y, cls: "lbl-eq" })
      }

      for (const seg of scene.segments) {
        const pts = segmentPoints(scene, seg)
        const mid = pts[Math.floor(pts.length / 2)]
        const st = segState(seg.id, values)
        const wip = segWip(seg.id, values)
        const cap = seg.capacity ?? 20
        const over = wip - Math.min(wip, cap)

        const p = projectToScreen(bscene, new Vector3(mid.x, mid.y + 1.2, mid.z))
        if (!p.visible) continue
        out.push({ key: `sg:${seg.id}`, text: seg.label, x: p.x, y: p.y, cls: "lbl-seg" })
        if (over > 0)
          out.push({ key: `ov:${seg.id}`, text: `+${over}`, x: p.x, y: p.y - 16, cls: "lbl-over" })
        if (st === "stalled")
          out.push({ key: `st:${seg.id}`, text: formatStall(segStallMs(seg.id, values)), x: p.x, y: p.y - 32, cls: "lbl-stall" })
      }

      setItems(out)
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
  }, [ctx, scene, values])

  return (
    <div className="labels" aria-hidden="true">
      {items.map((i) => (
        <span key={i.key} className={i.cls} style={{ left: i.x, top: i.y }}>{i.text}</span>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: App 에 붙이고 스타일 추가**

`App.tsx` 에 `const [ctx, setCtx] = useState<ViewerCtx | null>(null)` 을 더하고(조기 반환 **위**), `onReady` 에서 `setCtx(c)` 를 부르고 정리에서 `setCtx(null)` 한다. `<Viewer>` 뒤에 `<Labels ctx={ctx} scene={scene} values={values} />` 를 넣는다.

`styles.css`:
```css
.labels { position: absolute; inset: 0; pointer-events: none; }
.labels span {
  position: absolute; transform: translate(-50%, -100%);
  white-space: nowrap; text-shadow: 0 1px 3px #000;
}
.lbl-eq   { font-size: 12px; color: #aeb6c2; }
.lbl-seg  { font-size: 11px; color: #8b94a3; }
.lbl-over { font-size: 13px; color: #e6e8eb; font-weight: 600; }
.lbl-stall{ font-size: 13px; color: #ff8a8a; font-weight: 600; }
```

- [ ] **Step 4: 화면 확인**

확인할 것:
1. 설비 위에 이름이 뜬다 (한글이 **선명하다**)
2. 구간 위에 이름이 뜬다
3. **정지 중이면 그 구간에 `3:12` 가 뜬다**
4. `wip` 가 `capacity` 를 넘으면 `+26` 이 뜬다
5. **라벨이 설비에 가리지 않는다** — 설비 윗면보다 위에 뜬다
6. 줌 아웃하면 라벨이 사라지고 신호등만 남는다
7. `⟲` 로 돌리면 라벨이 **따라 움직인다**

- [ ] **Step 5: 커밋**

```bash
git add web/src
git commit -m "feat: HTML 오버레이 라벨 (3D→화면 투영)"
```

---

## Task 10: 이상 칩과 카메라 이동

**Files:**
- Modify: `web/src/AlertBar.tsx`, `web/src/App.tsx`

**Interfaces:**
- Consumes: `flyTo` (Task 3), `segmentPoints` (Task 5)
- Produces: `AlertBar` 의 `onGo` 가 `(seg: Segment) => void` 로 바뀐다 (층 id 가 필요 없어졌다)

- [ ] **Step 1: `AlertBar` 의 콜백을 바꾼다**

층 탭이 없으니 층을 넘길 이유가 없다. 구간 자체를 넘긴다:

```tsx
type Props = {
  scene: Scene
  values: Map<string, TagValue>
  onGo: (seg: Segment) => void
}
```
```tsx
          <button key={seg.id} className="chip" onClick={() => onGo(seg)}>
            ⚠ {section?.label ?? seg.section} {seg.label} 정지 {formatStall(ms)}
          </button>
```

나머지(정지만 거르기, 정지 시간 긴 순 정렬, 전이 전용 announcer, `max-height` 상한)는 **그대로 둔다** — 전부 검증된 것이다.

- [ ] **Step 2: App 에서 카메라를 옮긴다**

```tsx
  const goTo = (seg: Segment) => {
    const pts = segmentPoints(scene, seg)
    // 구간 한가운데로 간다. 끝점으로 가면 긴 구간이 화면 가장자리에 걸린다.
    const mid = pts[Math.floor(pts.length / 2)]
    camRef.current?.flyTo(mid)
  }
```
`<AlertBar ... onGo={goTo} />` 로 연결한다.

**층 전환이 없다.** 층이 동시에 보이므로 옮길 것은 카메라뿐이다.

- [ ] **Step 3: 화면 확인**

주입 스크립트로 칩을 누르고 카메라 `target` 이 바뀌는지 본다:

```html
<script>
setTimeout(() => {
  const chip = document.querySelector('.chip');
  const before = window.__camTarget ? {...window.__camTarget} : null;
  chip && chip.click();
  setTimeout(() => {
    const d = document.createElement('div');
    d.style.cssText='position:fixed;top:0;left:0;z-index:99999;background:#000;color:#0f0;font:14px monospace;padding:8px;white-space:pre';
    d.textContent = '칩: ' + (chip ? chip.textContent.trim() : '없음');
    document.body.appendChild(d);
  }, 800);
}, 42000);
</script>
```

확인할 것:
1. 평소에는 상단에 "정상 가동"
2. 40초쯤 `⚠ 충전부 충전 이송 정지 0:12` 칩이 뜬다
3. **칩을 누르기 전후로 화면이 다르다** — 스크린샷 두 장을 비교해 카메라가 실제로 옮겨갔는지 본다
4. 굶은 구간은 칩이 **안 뜬다**

- [ ] **Step 4: 커밋**

```bash
git add web/src
git commit -m "feat: 이상 칩이 카메라를 그 구간으로 옮긴다"
```

---

## Task 11: 최종 점검과 문서

**Files:**
- Modify: `README.md`, `docs/BROWSER-CHECKLIST.md`

**Interfaces:**
- Consumes: 전부
- Produces: 완성된 데모

- [ ] **Step 1: 완료 기준 11개를 순서대로 확인**

```bash
cd web && npm run build
cd ../hub && WEB_DIR=../web/dist npx tsx src/index.ts
```
브라우저(또는 `tools/shot.mjs`)로 `http://localhost:8080` 을 열고 스펙 9장의 11개 항목을 확인한다:

1. [ ] 부지 전체가 한 화면에, 층이 동시에 보인다
2. [ ] 가동 구간에 물건이 흐르고 신호등이 초록
3. [ ] 40초쯤 `conv-3` 신호등이 빨강 점멸, 물건이 꽉 찬 채 얼어붙는다
4. [ ] 상단에 정지 칩, 초가 올라간다
5. [ ] **카메라를 안 움직여도 다른 층 신호등이 빨개지는 게 보인다**
6. [ ] 칩을 누르면 카메라가 그 구간으로 이동한다
7. [ ] 구간을 클릭하면 수치와 CCTV 자리가 뜬다
8. [ ] **굶은 구간은 신호등이 꺼진 채 비어 있고, 정지 구간과 나란히 보인다**
9. [ ] 브라우저를 새로 열어도 정지 시간이 이어서 맞다
10. [ ] 리프트가 층 사이 관으로 보이고, 클릭하면 모달이 뜬다
11. [ ] 허브를 재시작하면 자동 재접속한다

**8번과 9번이 시험지다.** 못 한 항목은 못 했다고 적어라.

- [ ] **Step 2: 번들 크기 확인**

```bash
cd web && npm run build
```
초기 로드(주 JS 청크 + CSS) gzip 합계와 지연 로드 청크 합계를 **나눠서** 적는다. 초기 로드가 **350KB 를 넘으면** 무엇이 들어왔는지 찾아 적어라 — 대개 `import * as BABYLON` 이나 필요 없는 로더가 딸려온 것이다.

- [ ] **Step 3: 허브 테스트 재확인**

```bash
cd hub && npm test
```
Expected: 42/42 통과.

- [ ] **Step 4: README 갱신**

`README.md` 의 아래를 고친다:
- 구성 표의 `web/` 설명을 "평면도 렌더링, 점 애니메이션은 CSS" 에서 "아이소메트릭 3D 뷰 (Babylon.js), 층을 동시에 표시" 로
- 테스트 수를 실제 값으로
- 씬 편집 절에 새 필드 셋(`elevation`, `height`, `shape`)과 기본값을 적는다
- 카메라 조작(드래그/휠/회전 버튼)과 **기울기를 못 바꾸는 이유**를 한 줄로

- [ ] **Step 5: 브라우저 체크리스트 갱신**

`docs/BROWSER-CHECKLIST.md` 를 이 스펙의 11개 기준으로 다시 쓴다. 각 항목에 무엇을 하는지, 무엇이 보여야 하는지(구체적으로), 틀렸을 때 어디를 의심할지를 적는다.

SVG 시대 항목(층 탭, 점선, `offset-path`/Safari)은 지운다 — 해당 코드가 없어졌다.

새로 최상단에 올릴 것:
- **정사영 카메라가 브라우저마다 같게 보이는가** — Babylon 의 WebGL 경로 차이
- **반투명 바닥판 너머로 아래층이 비치는가** — 알파 정렬은 엔진마다 다르다

- [ ] **Step 6: 커밋**

```bash
git add README.md docs/BROWSER-CHECKLIST.md
git commit -m "docs: 아이소메트릭 뷰어에 맞춰 README·브라우저 체크리스트 갱신"
```

---

## 남은 것

스펙 11장의 확장 경로. 이 계획에는 없다.

1. **glTF 에셋 카탈로그** — `shape` 에 파일명 허용. Babylon 에 로더가 내장이다
2. **실제 어댑터** (`OpcUaAdapter`) — 허브·클라이언트 무변경
3. **씬 에디터** — 3D 기즈모로 배치, 씬 JSON 저장
4. **벽·건물 외피** — 지붕은 생략해 안을 본다
5. **정지 이력** — 가동률 집계의 전제
6. **다중 카메라 타일**
