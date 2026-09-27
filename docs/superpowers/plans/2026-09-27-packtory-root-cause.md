# packtory 원인 추적 구현 계획 (하위 프로젝트 B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구간 연결을 스키마(`next`)에 넣고, 서버가 정지 구간을 원인(빨강)과 영향(노랑)으로 나눠, 막힘이 번진 화면에서 가서 볼 곳 하나만 빨갛게 남긴다.

**Architecture:** 연결의 출처를 끝점 추론에서 `Segment.next` 로 바꾼다(스키마 v4, 검증기가 참조·순환을 거절). 허브 판정 타이머에서 `derive` 뒤에 순수 함수 `classify()` 가 연결을 하류부터 훑어 stalled 를 원인/영향으로 나누고 `.root` 태그를 낸다. 웹은 셀 수 있는 요약(영향 수·배지 문구)을 순수 함수로 두고, 신호등·라벨·배지·칩·모달이 그것을 쓴다.

**Tech Stack:** Node 24 (`tsx`), TypeScript, `node --test`, Vite + React 18, `@babylonjs/core`.

**Spec:** `docs/superpowers/specs/2026-09-27-packtory-root-cause-design.md`

## Global Constraints

- 새 의존성 금지. 웹에 자동 테스트를 쓰지 않는다 — 셀 수 있는 것은 `web/src/state.ts` 순수 함수로 두고 `hub/test/state.test.ts` 가 시험한다(A 의 `lampVisibleFar` 와 같은 방식).
- 씬 스키마는 **`version: 4`**. v3 는 거절한다. 호환 코드를 두지 않는다.
- 연결의 유일한 출처는 **`Segment.next`**. 끝점 좌표로 연결을 추론하는 코드는 씬을 읽는 쪽에 남지 않는다 (생성기 안에서 `next` 를 계산하는 것만 예외).
- 판정은 서버, 그림은 클라이언트. `blocked` 는 `hub/src/cause.ts` 만 만든다. `derive.ts` 는 바꾸지 않는다.
- 영향 색은 **노랑, 점멸 없음** — 주황은 설비 경고 발광(`WARN_GLOW`)이다.
- 전파 mock 은 여전히 카운터만 쓴다. `blockedNow()` 는 테스트 정답 대조용이지 판정에 쓰지 않는다.
- Babylon 개별 import, gzip 350KB 이하 목표(현재 약 313KB).
- 주석·사용자 문자열 한국어. 커밋 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 허브를 끌 때 `pgrep -f`/`pkill -f` 를 쓰지 마라 — 띄우는 명령과 같은 셸에 있으면 셸 자신이 걸려 죽는다(A 실측). **`kill $(lsof -t -i:<포트> -sTCP:LISTEN)`** 로 끈다.

## 스펙과 달라진 점 (시제품 실측 — Task 6 에서 스펙도 고친다)

계획을 쓰며 scratchpad 에 전부 만들어 돌렸다(허브 테스트 110, 웹 타입체크·빌드, 대형 씬 스크린샷).

| 스펙 | 바뀐 것 | 이유 (실측) |
|---|---|---|
| 하류가 **전부 stalled/blocked** 면 영향 | 하류가 전부 stalled/blocked **또는 꽉 참(WIP ≥ capacity × 0.8)** 이면 영향. 꽉 찬 running 구간은 자기 하류의 원인을 물려받아 위로 전한다 | 막힘이 번진 망에서 합류점 아래 구간은 꽉 찬 채 조금씩 움직여 running 이다. 그 자리를 다투다 몫을 못 받은 상류가 원인으로 판정돼, 막힘과 무관한 곳에 빨강이 계속 켜졌다(대형 씬 20분에 수십 초). 기준을 딱 capacity 로 하면 한 칸 빈 순간마다 깜빡였다 |
| (없음) | 하류가 꽉 찬 running 뿐이고 그 아래에 원인이 없으면 **영향이되 `root` 가 빈 문자열** | 원인 없는 정체다 — 고장이 아니므로 빨강이 아니고, 칩도 세지 않는다 |
| 정답 대조: 오판 0 | **오판은 원인 판정의 0.5% 이하, 같은 구간이 두 번 잇달아(1초) 틀리지 않는다** | 카운터만으로 못 가르는 순간이 드물게 있다. 시드 8개 × 20분에서 원인 판정 약 4000번 중 0~4번, 전부 판정 한 번(0.5초)짜리 깜빡임이었다 |
| `{ cycle: string[] }` = 순환에 걸린 id | 순환 **과 그 하류** | 위상 정렬로 드러나는 것이 그것이다. 고칠 곳은 그 목록 앞쪽에 있다 |

## Review Focus

1. **정체된 합류점 아래에서 원인 빨강이 깜빡이는 빈도** — 사람은 막힘과 무관한 곳에 빨강이 안 뜨길 기대한다. → Task 3 정답 대조가 0.5% 이하·연속 오판 없음을 고정한다.
2. **센서가 끊긴(unknown) 하류 바로 위의 정지** — 노랑으로 숨지 않고 빨강으로 남길 기대한다. → Task 3 단위 테스트.
3. **손으로 고친 씬에서 `next` 오타·순환** — 부팅 때 어느 구간인지 말하고 거절하길 기대한다. → Task 2 규칙 9·11 테스트.
4. **막힘이 풀린 뒤 노랑이 남는가** — 원인이 풀리면 영향도 함께 초록으로 돌아오길 기대한다. `classify` 는 상태를 기억하지 않으므로 매 판정 새로 계산한다 → Task 3 정답 대조 ②(풀린 뒤 stallSec 안에만 허용) + 체크리스트 7.
5. **영향 구간 모달의 "원인 →"** — 원인이 다른 층·계단 배치여도 그 자리로 날아가길 기대한다. → 기존 `goTo`(mode 를 넘긴다) 재사용, 체크리스트 5.

---

## File Structure

```
shared/
  types.ts          Segment.next, version 4, SegState 에 blocked          ← 수정
  graph.ts          downstream() 은 next 를, topoOrder() 는 {order}|{cycle} ← 재작성
hub/
  src/cause.ts      classify(), withCause() — 원인·영향 판정              ← 새로
  src/scene.ts      version 4 게이트, 규칙 9~12                           ← 수정
  src/index.ts      판정 타이머에 withCause                                ← 수정
  src/adapters/mock.ts  topoOrder 새 반환형, blockedNow()                 ← 수정
  test/cause.test.ts    단위 + 정답 대조                                  ← 새로
  test/graph.test.ts    next 기반으로                                     ← 재작성
  test/state.test.ts    화면 요약 함수                                    ← 수정
  test/scene.test.ts, gen.test.ts, mock.test.ts, fanout.test.ts           ← 수정
tools/gen-scene.ts  next 를 계산해 써 넣는다, version 4                   ← 수정
scene.json          version 4, next                                       ← 수정
scene.large.json    다시 생성                                             ← 재생성
web/src/
  state.ts          STATE_LABEL.blocked, segRoot, affectedCounts, sectionSummary, badgeText, badgeTone ← 수정
  viewer/andon.ts   LAMP.blocked 노랑                                     ← 수정
  Labels.tsx        배지 요약·영향 라벨                                   ← 수정
  AlertBar.tsx      원인 칩 + 영향 수                                     ← 수정
  Modal.tsx         영향 상태·정지 시간, "원인 →" 버튼                    ← 수정
  App.tsx           Modal 에 onGo                                         ← 수정
  styles.css        lbl-wait, badge.blocked, goto-root                    ← 수정
README.md, docs/BROWSER-CHECKLIST.md, 스펙                               ← 수정
```

## 공통 절차: 화면 찍기

```bash
cd web && npm run build && cd ..
(cd hub && SCENE=../scene.large.json WEB_DIR=../web/dist PORT=8091 node_modules/.bin/tsx src/index.ts > /tmp/packtory-hub.log 2>&1 &)
sleep 5 && cat /tmp/packtory-hub.log
# ... 찍기 ...
kill $(lsof -t -i:8091 -sTCP:LISTEN)
```

`tools/shot.mjs` 의 대기(ms)는 **가상 시간**이라 허브 시계는 거의 안 흐른다. 막힘이 번진 장면을 찍으려면 허브에 영향 구간이 생길 때까지 **실제로** 기다린다. 아래 스크립트를 `/tmp/packtory-wait.mjs` 로 두고 `until node /tmp/packtory-wait.mjs; do sleep 3; done` 로 기다린 뒤 짧은 대기로 찍는다:

```js
import WebSocket from "/home/okja/work/packtory/hub/node_modules/ws/wrapper.mjs"
const ws = new WebSocket("ws://127.0.0.1:8091/ws")
ws.on("message", (m) => {
  const n = JSON.parse(m).data.filter((t) => t.tag.endsWith(".state") && t.v === "blocked").length
  console.log(n); process.exit(n >= 8 ? 0 : 1)
})
setTimeout(() => process.exit(2), 3000)
```

---

### Task 1: 연결을 `next` 에서 읽는다 (스키마 v4)

**Files:**
- Modify: `shared/types.ts`, `hub/src/scene.ts`, `hub/src/adapters/mock.ts`, `tools/gen-scene.ts`, `scene.json`, `hub/test/gen.test.ts`, `hub/test/mock.test.ts`, `hub/test/scene.test.ts`, `hub/test/fanout.test.ts`
- Rewrite: `shared/graph.ts`, `hub/test/graph.test.ts`
- Regenerate: `scene.large.json`

**Interfaces:**
- Produces:
  - `Segment.next?: string[]`, `Scene.version: 4`
  - `downstream(scene: Scene): Map<string, string[]>` — `seg.next ?? []` 그대로
  - `type Topo = { order: string[] } | { cycle: string[] }`, `topoOrder(down: Map<string, string[]>): Topo` — 없는 id 를 가리키는 연결은 무시

연결 자체는 바뀌지 않는다 — 출처만 바뀐다. 이 태스크가 끝나면 A 의 테스트(mock 전파·보존·결정성 등)가 전부 그대로 통과해야 한다.

- [ ] **Step 1: 그래프 테스트를 `next` 기반으로 새로 쓴다**

`hub/test/graph.test.ts` 를 통째로 바꾼다:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/graph.test.ts`
Expected: FAIL 여러 건 — 옛 `downstream` 은 끝점을 보므로 `next` 를 무시하고, `topoOrder` 는 배열/`null` 을 돌려준다 (예: "위상 순서는 상류가 먼저" 가 `{ order: [...] }` 불일치).

- [ ] **Step 3: `shared/graph.ts` 를 통째로 바꾼다**

```ts
import type { Scene } from "./types.ts"

/**
 * 구간 id → 하류 구간 id 들. 씬의 `next` 가 연결의 유일한 출처다 (스키마 v4).
 * 예전에는 끝점 좌표가 같으면 이어진 것으로 추론했지만, 손으로 그린 현장 씬은
 * 끝점이 정확히 안 맞는다 — 설비를 사이에 둔 두 구간이 흔한 예다.
 */
export function downstream(scene: Scene): Map<string, string[]> {
  return new Map(scene.segments.map((s) => [s.id, s.next ?? []]))
}

export type Topo = { order: string[] } | { cycle: string[] }

/**
 * 위상 순서(상류가 먼저). 순환이 있으면 순서 대신 순환에서 빠져나오지 못한
 * 구간들(순환 자신과 그 하류)을 준다 — 부팅 에러 메시지가 어디를 고쳐야 하는지
 * 말할 수 있어야 한다. 없는 id 를 가리키는 연결은 무시한다(검증기가 따로 잡는다).
 */
export function topoOrder(down: Map<string, string[]>): Topo {
  const indeg = new Map<string, number>([...down.keys()].map((id) => [id, 0]))
  for (const ds of down.values())
    for (const d of ds) if (indeg.has(d)) indeg.set(d, indeg.get(d)! + 1)
  const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const d of down.get(id) ?? []) {
      if (!indeg.has(d)) continue
      const n = indeg.get(d)! - 1
      indeg.set(d, n)
      if (n === 0) queue.push(d)
    }
  }
  if (order.length === down.size) return { order }
  const done = new Set(order)
  return { cycle: [...down.keys()].filter((id) => !done.has(id)) }
}
```

- [ ] **Step 4: 타입에 `next` 와 version 4**

`shared/types.ts`:

```ts
// Segment 의 counterMax 다음에 더한다
  /** PLC 카운터 최대값. 있으면 모듈러로 델타를 구한다 */
  counterMax?: number
  /** 이 구간이 물건을 넘겨주는 구간들. 없거나 비었으면 출구(sink)다.
   *  구간 연결의 유일한 출처다 (스키마 v4) — 끝점 좌표로 추론하지 않는다 */
  next?: string[]
}
// Scene
  version: 4
```

`hub/src/scene.ts` 의 버전 게이트:

```ts
// 전
  if (s.version !== 3) throw new Error(`씬 version 3 만 지원한다 (받음: ${s.version})`)
// 후
  if (s.version !== 4) throw new Error(`씬 version 4 만 지원한다 (받음: ${s.version})`)
```

- [ ] **Step 5: mock 이 새 `topoOrder` 반환형을 쓴다**

`hub/src/adapters/mock.ts`:

```ts
// 전
    const topo = topoOrder(down)
    if (!topo) throw new Error("모의 어댑터: 구간 연결에 순환이 있다 — 끝점이 이어진 구간들이 제자리로 돌아온다")
// 후
    const topo = topoOrder(down)
    if ("cycle" in topo) throw new Error(`모의 어댑터: 구간 연결에 순환이 있다: ${topo.cycle.join(", ")}`)
```

```ts
// 전
    this.sims = topo.map((id) => byId.get(id)!)
// 후
    this.sims = topo.order.map((id) => byId.get(id)!)
```

- [ ] **Step 6: 생성기가 `next` 를 써 넣는다**

`tools/gen-scene.ts` — 리프트를 다 만든 직후(`DOWN_LIFTS.forEach(...)` 다음), 설비 절 앞에:

```ts
  // ── 연결: 끝점이 같은 좌표면 이어진 것이다 ────────────────
  // 생성기는 이어지는 구간의 끝점을 정확히 같게 찍으므로 여기서 한 번 계산해
  // next 로 써 넣는다. 씬을 읽는 쪽은 next 만 본다 (스키마 v4).
  const nodeKey = (e: Endpoint) => `${e.floor}:${e.x}:${e.y}`
  const byFrom = new Map<string, string[]>()
  for (const s of segments) byFrom.set(nodeKey(s.from), [...(byFrom.get(nodeKey(s.from)) ?? []), s.id])
  for (const s of segments) {
    const next = byFrom.get(nodeKey(s.to))
    if (next) s.next = next
  }
```

설비 절에 있던 같은 정의 `const nodeKey = (e: Endpoint) => \`${e.floor}:${e.x}:${e.y}\`` 줄은 **지운다**(위로 옮긴 것이다). 반환값의 `version: 3,` → `version: 4,`.

- [ ] **Step 7: 작은 씬에 `next` 를 쓴다**

`scene.json`: `"version": 3,` → `"version": 4,`, 그리고 구간 셋:

```jsonc
// conv-1 의 마지막 줄
      "capacity": 24, "next": ["lift-1"] },
// lift-1
      "capacity": 4, "next": ["conv-3"] },
// conv-3
      "capacity": 12, "wipOffset": 0, "next": ["conv-5"] },
```

(conv-5 는 출구라 `next` 가 없다.)

- [ ] **Step 8: 나머지 테스트를 v4·`next` 에 맞춘다**

`hub/test/scene.test.ts`: `base()` 의 `version: 3,` → `version: 4,`; "실제 데모 씬" 의 `assert.equal(scene.version, 3)` → `4`; 테스트 이름 `"version 이 3 이 아니면 로드가 실패한다"` → `"version 이 4 가 아니면 로드가 실패한다"`, 정규식 `/version 3/` → `/version 4/`.

`hub/test/fanout.test.ts`: `assert.equal(body.scene.version, 3)` → `4`.

`hub/test/gen.test.ts`:

```ts
// 전
    assert.notEqual(topoOrder(down), null)
// 후
    assert.ok("order" in topoOrder(down))
```

그리고 "합류·분기 차수 3 이하" 테스트 **앞에** 더한다:

```ts
  test(`seed ${seed}: next 는 실재 구간을 가리키고, 이어진 두 구간의 끝점이 같다`, () => {
    const byId = new Map(s.segments.map((g) => [g.id, g]))
    for (const g of s.segments)
      for (const n of g.next ?? []) {
        const h = byId.get(n)
        assert.ok(h, `${g.id} → 없는 ${n}`)
        assert.deepEqual(h.from, g.to, `${g.id} → ${n} 끝점이 떨어져 있다`)
      }
  })

```

`hub/test/mock.test.ts` — `merge()` 가 `next` 를 쓴다:

```ts
// 전
  const seg = (id: string, fx: number, fy: number, tx: number, ty: number) => ({
    id, label: id, section: "a", capacity: 8,
    from: { floor: "1F", x: fx, y: fy }, to: { floor: "1F", x: tx, y: ty },
  })
  return {
    version: 3, name: "t", stallSec: 10,
// 후
  const seg = (id: string, fx: number, fy: number, tx: number, ty: number, next?: string[]) => ({
    id, label: id, section: "a", capacity: 8,
    from: { floor: "1F", x: fx, y: fy }, to: { floor: "1F", x: tx, y: ty },
    ...(next && { next }),
  })
  return {
    version: 4, name: "t", stallSec: 10,
```

```ts
// 전
    segments: [seg("s1", 0, 10, 20, 20), seg("s2", 0, 30, 20, 20), seg("m", 20, 20, 40, 20), seg("x", 40, 20, 60, 20)],
// 후
    segments: [seg("s1", 0, 10, 20, 20, ["m"]), seg("s2", 0, 30, 20, 20, ["m"]), seg("m", 20, 20, 40, 20, ["x"]), seg("x", 40, 20, 60, 20)],
```

"분기 한쪽이 막혀도…" 테스트:

```ts
// 전
  // s1 → m 대신 s1 이 m 과 y 로 갈라지게 바꾼다
  s.segments.push({ id: "y", label: "y", section: "a", capacity: 8,
// 후
  // s1 이 m 과 y 로 갈라지게 바꾼다
  s.segments[0].next = ["m", "y"]
  s.segments.push({ id: "y", label: "y", section: "a", capacity: 8,
```

"물건은 사라지지도…" 테스트의 `fed`/`feeds`:

```ts
// 전 (두 줄씩, 끝점 비교)
  const fed = new Set(large.segments.flatMap((a) => large.segments
    .filter((b) => b.from.floor === a.to.floor && b.from.x === a.to.x && b.from.y === a.to.y).map((b) => b.id)))
  const feeds = new Set(large.segments.filter((a) => large.segments
    .some((b) => b.from.floor === a.to.floor && b.from.x === a.to.x && b.from.y === a.to.y)).map((a) => a.id))
// 후
  const fed = new Set(large.segments.flatMap((a) => a.next ?? []))
  const feeds = new Set(large.segments.filter((a) => (a.next ?? []).length > 0).map((a) => a.id))
```

"순환…" 테스트:

```ts
// 전
  s.segments.push({ id: "back", label: "back", section: "a",
    from: { floor: "1F", x: 60, y: 20 }, to: { floor: "1F", x: 20, y: 20 } })
  assert.throws(() => new MockAdapter(s), /순환/)
// 후
  // x → back → m → x
  s.segments.find((g) => g.id === "x")!.next = ["back"]
  s.segments.push({ id: "back", label: "back", section: "a", next: ["m"],
    from: { floor: "1F", x: 60, y: 20 }, to: { floor: "1F", x: 20, y: 20 } })
  assert.throws(() => new MockAdapter(s), /순환이 있다: m, x, back/)
```

- [ ] **Step 9: 대형 씬을 다시 만들고 전체를 돌린다**

Run: `cd hub && npm run gen:large && grep -c '"next"' ../scene.large.json && npm test && npx tsc --noEmit`
Expected: `489` (구간 493 − 출구 4), `ℹ tests 86`, `ℹ fail 0`, tsc 출력 없음. 웹도 `cd web && npx tsc --noEmit` → 출력 없음.

- [ ] **Step 10: 커밋**

```bash
git add shared hub tools scene.json scene.large.json
git commit -m "feat: 구간 연결을 스키마 v4 의 next 로 — 끝점 추론을 지운다

손으로 그린 현장 씬은 끝점이 정확히 안 맞는다. 생성기가 next 를 써 넣고
씬을 읽는 쪽은 next 만 본다. topoOrder 는 순환일 때 걸린 구간을 알려준다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 검증 규칙 9~12 (연결)

**Files:**
- Modify: `hub/src/scene.ts`, `hub/test/scene.test.ts`

**Interfaces:**
- Consumes: `downstream`, `topoOrder` (Task 1)
- Produces: `validateScene` 이 `next` 오류를 에러로, 끝점 어긋남을 경고로 낸다.

- [ ] **Step 1: 테스트를 쓴다** — `hub/test/scene.test.ts` 맨 끝에:

```ts

test("규칙9: next 가 없는 구간을 가리키면 에러", () => {
  const s = base()
  s.segments[0].next = ["ghost"]
  assert.match(validateScene(s).errors.join("\n"), /없는 구간 ghost/)
})

test("규칙10: next 가 자기 자신이면 에러", () => {
  const s = base()
  s.segments[0].next = ["sg1"]
  assert.match(validateScene(s).errors.join("\n"), /자기 자신/)
})

/** base() 에 sg2 를 더해 sg1 → sg2 로 잇는다. sg2 의 시작은 sg1 의 끝 (9, 5) */
function linked(): Scene {
  const s = base()
  s.segments.push({ id: "sg2", label: "S2", section: "a",
    from: { floor: "1F", x: 9, y: 5 }, to: { floor: "1F", x: 9, y: 9 } })
  s.segments[0].next = ["sg2"]
  return s
}

test("규칙11: 순환이면 에러이고, 걸린 구간을 나열한다", () => {
  const s = linked()
  s.segments[1].next = ["sg1"]
  assert.match(validateScene(s).errors.join("\n"), /순환.*sg1, sg2/)
})

test("규칙12: 이어진 두 구간의 끝점이 1m 넘게 떨어지면 경고이지 에러가 아니다", () => {
  const s = linked()
  s.segments[1].from = { floor: "1F", x: 9, y: 7 } // sg1 의 끝 (9, 5) 에서 2m
  const { errors, warnings } = validateScene(s)
  assert.deepEqual(errors, [])
  assert.match(warnings.join("\n"), /sg1 → sg2: 끝점이 떨어져/)
})

test("규칙12: 1m 안쪽이면 경고가 없다", () => {
  const s = linked()
  s.segments[1].from = { floor: "1F", x: 9, y: 5.5 }
  assert.deepEqual(validateScene(s).warnings, [])
})

test("실제 씬 둘 다 경고 없이 통과한다", () => {
  for (const f of ["../../scene.json", "../../scene.large.json"]) {
    const { errors, warnings } = validateScene(loadScene(new URL(f, import.meta.url).pathname))
    assert.deepEqual([errors, warnings], [[], []], f)
  }
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/scene.test.ts`
Expected: FAIL 4건 — 규칙 9·10·11·12(떨어짐) 는 아무것도 안 낸다. "1m 안쪽" 과 "실제 씬 둘 다" 는 지금도 통과한다 — 규칙을 넣은 뒤 가짜 경고가 없음을 지키는 회귀 테스트다.

- [ ] **Step 3: 규칙을 넣는다** — `hub/src/scene.ts`

import 추가 (셋째 줄 다음): `import { downstream, topoOrder } from "../../shared/graph.ts"`

`// 규칙6: 미참조 카메라 (경고)` **앞에**:

```ts
  // 규칙9·10·12: 연결(next). 연결은 스키마 v4 부터 next 가 유일한 출처라, 잘못
  // 적으면 모의 데이터가 엉뚱하게 흐르고 원인 판정이 엉뚱한 곳을 짚는다.
  const segById = new Map(s.segments.map((g) => [g.id, g]))
  for (const g of s.segments) {
    for (const n of g.next ?? []) {
      const h = segById.get(n)
      if (n === g.id) errors.push(`구간 ${g.id}: next 가 자기 자신을 가리킨다`)
      else if (!h) errors.push(`구간 ${g.id}: next 가 없는 구간 ${n} 을 가리킨다`)
      // 연결은 되지만 선이 끊겨 보인다 — 막지는 않는다. 설비를 사이에 두고 1m
      // 안쪽으로 떨어진 정도는 그리는 사람의 어림으로 본다.
      else if (h.from.floor !== g.to.floor || Math.hypot(h.from.x - g.to.x, h.from.y - g.to.y) > 1)
        warnings.push(`구간 ${g.id} → ${n}: 끝점이 떨어져 있다 — 화면에서 선이 끊겨 보인다`)
    }
  }

  // 규칙11: 순환. 모의 데이터가 제자리를 도는 물건을 만들고 원인 판정이 끝나지
  // 않는다. 어디를 고칠지 알 수 있게 걸린 구간을 나열한다.
  const topo = topoOrder(downstream(s))
  if ("cycle" in topo) errors.push(`구간 연결에 순환이 있다 (순환과 그 하류): ${topo.cycle.join(", ")}`)

```

- [ ] **Step 4: 통과를 확인하고 커밋한다**

Run: `cd hub && npm test && npx tsc --noEmit`
Expected: `ℹ tests 92`, `ℹ fail 0`.

```bash
git add hub/src/scene.ts hub/test/scene.test.ts
git commit -m "feat(hub): 연결 검증 — 없는 id·자기 참조·순환은 거절, 끊긴 끝점은 경고

순환이면 걸린 구간을 나열한다 (A 에서 미룬 사소한 문제).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 원인·영향 판정 (`hub/src/cause.ts`)

**Files:**
- Create: `hub/src/cause.ts`, `hub/test/cause.test.ts`
- Modify: `shared/types.ts` (SegState), `hub/src/index.ts`, `hub/src/adapters/mock.ts` (blockedNow), `web/src/state.ts` (STATE_LABEL), `web/src/viewer/andon.ts` (LAMP)

**Interfaces:**
- Consumes: `downstream`, `topoOrder` (Task 1), `derive` (그대로), `MockAdapter` (A)
- Produces:
  - `type SegState = "running" | "stalled" | "blocked" | "idle" | "unknown"`
  - `classify(down, order, states: Map<string, SegState>, stallMs: Map<string, number>, full: Set<string>): Map<string, { state: SegState; root: string }>`
  - `withCause(tags: TagValue[], down, order, capacity: Map<string, number>): TagValue[]` — `.state` 를 바꾸고 구간마다 `{id}.root` 를 더한다
  - `MockAdapter.blockedNow(): string[]`
  - 태그 `{id}.state` 에 `"blocked"`, 새 태그 `{id}.root` (string)

- [ ] **Step 1: 테스트를 쓴다** — `hub/test/cause.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/cause.test.ts`
Expected: FAIL — `Cannot find module '.../hub/src/cause.ts'`

- [ ] **Step 3: `SegState` 에 `blocked`**

`shared/types.ts`:

```ts
// 전
export type SegState = "running" | "stalled" | "idle" | "unknown"
// 후
/** blocked 는 derive 가 아니라 원인 판정(hub/src/cause.ts)만 만든다 — 하류가 막혀 기다리는 정지 */
export type SegState = "running" | "stalled" | "blocked" | "idle" | "unknown"
```

웹이 `Record<SegState, …>` 로 쓰는 두 곳을 채운다 (안 채우면 웹 타입체크가 깨진다):

`web/src/state.ts`: `running: "가동", stalled: "정지", idle: "대기", unknown: "불명",` → `running: "가동", stalled: "정지", blocked: "영향", idle: "대기", unknown: "불명",`

`web/src/viewer/andon.ts` 의 `LAMP` — `stalled` 줄 다음에:

```ts
  // 영향(하류가 막혀 기다림)은 노랑, 점멸 없음. 주황은 설비 경고 발광(WARN_GLOW)이
  // 이미 쓴다 — 섞이면 "온도 경고" 와 "막힘 영향" 이 같은 색이 된다 (스펙 2장).
  blocked: { color: new Color3(1.00, 0.82, 0.20), blinkHz: 0 },
```

- [ ] **Step 4: `hub/src/cause.ts` 를 만든다**

```ts
import type { SegState, TagValue } from "../../shared/types.ts"

/**
 * WIP 가 capacity 의 이만큼 이상이면 "꽉 참" 으로 본다. 딱 capacity 로 잡으면 정체
 * 구간이 물건 하나를 내보내 한 칸 빈 순간(판정 한 번, 0.5초)마다 그 상류가 원인으로
 * 깜빡인다 (실측). 정상 가동 중 WIP 는 capacity 의 35% 안팎이라 헷갈리지 않는다.
 */
const FULL_RATIO = 0.8

export type Classified = { state: SegState; root: string }

/**
 * derive 가 낸 state 를 연결을 따라 다시 나눈다 (스펙 6장). stalled 만 바뀐다:
 * 하류가 전부 **기다리게 하는 상태**(stalled·blocked, 또는 꽉 참 — `full`)면 blocked(영향),
 * 아니면 stalled(원인 — 하류에 여지가 있는데 못 내보낸다). 출구가 stalled 면 원인이다.
 *
 * 꽉 찬 하류를 기다림으로 치는 이유: 막힘이 번진 망에서 합류점 아래 구간은 꽉 찬
 * 채 조금씩은 움직여 running 으로 보인다. 그 자리를 여러 상류가 다투면 몫이 적은
 * 상류는 stallSec 넘게 못 내보낸다 — running 인 하류만 보고 원인이라 하면 막힘과
 * 무관한 곳에 빨강이 뜬다 (실측: 대형 씬 20분에 수십 번). 꽉 찬 running 구간은 자기
 * 하류에서 원인을 물려받아 위로 전한다.
 *
 * 하류가 unknown 이면 기다리는 중이라고 증명할 수 없으므로 원인으로 둔다 — 센서가
 * 끊긴 하류 때문에 멈춘 것처럼 보이는 구간을 노랑으로 숨기면 안 된다. 하류가
 * idle(비어서 쉼)인데 이 구간이 꽉 찬 채 멈췄다면 고장은 그 사이에 있다 — 원인이다.
 *
 * 한 줄에 원인이 둘이면 상류 쪽은 영향으로 보인다. 하류가 막혀 있는 동안 상류가
 * 따로 고장인지 카운터만으로는 가를 수 없다. 하류가 풀리면 드러난다.
 */
export function classify(
  down: Map<string, string[]>,
  order: string[],
  states: Map<string, SegState>,
  stallMs: Map<string, number>,
  full: Set<string>,
): Map<string, Classified> {
  const out = new Map<string, Classified>()
  // 꽉 찬 running 구간이 물려받은 원인. 밖으로 내보내지 않는다 — 초록은 초록이다
  const carried = new Map<string, string>()
  // 하류부터 — 구간을 볼 때 하류의 분류가 이미 끝나 있다
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    const st = states.get(id) ?? "unknown"
    const ds = down.get(id) ?? []

    // 하류가 전부 기다리게 하는가, 그렇다면 그중 가장 오래 멈춘 원인은
    let waiting = ds.length > 0
    let root = ""
    let longest = -1
    for (const d of ds) {
      const c = out.get(d)
      const holds = c && (c.state === "stalled" || c.state === "blocked" || (c.state === "running" && full.has(d)))
      if (!holds) { waiting = false; break }
      // 하류가 원인이면 하류 자신, 영향이면 하류가 기다리는 원인, 꽉 찬 running 이면 물려받은 원인
      const r = c.state === "stalled" ? d : c.state === "blocked" ? c.root : carried.get(d) ?? ""
      const ms = r ? stallMs.get(r) ?? 0 : -1
      if (ms > longest) { longest = ms; root = r }
    }

    if (st === "stalled" && waiting) out.set(id, { state: "blocked", root })
    else out.set(id, { state: st, root: "" })
    if (st === "running" && full.has(id) && waiting && root) carried.set(id, root)
  }
  return out
}

/**
 * derive 의 출력 태그에 분류를 입힌다: `.state` 를 분류 결과로 바꾸고, 구간마다
 * `.root`(원인 구간 id, 해당 없으면 "")를 더한다. 허브 판정 타이머가 부른다.
 * `capacity` 는 구간 id → capacity (씬에 없으면 20 — 화면·mock 과 같은 기본값).
 * 꽉 참의 기준은 FULL_RATIO 다.
 */
export function withCause(
  tags: TagValue[], down: Map<string, string[]>, order: string[], capacity: Map<string, number>,
): TagValue[] {
  const states = new Map<string, SegState>()
  const stallMs = new Map<string, number>()
  const full = new Set<string>()
  const stateTag = new Map<string, TagValue>()
  for (const t of tags) {
    const dot = t.tag.lastIndexOf(".")
    const id = t.tag.slice(0, dot)
    const key = t.tag.slice(dot + 1)
    if (key === "state") { states.set(id, t.v as SegState); stateTag.set(id, t) }
    else if (key === "stallMs") stallMs.set(id, t.v as number)
    else if (key === "wip" && (t.v as number) >= (capacity.get(id) ?? 20) * FULL_RATIO) full.add(id)
  }
  const c = classify(down, order, states, stallMs, full)
  const out = tags.map((t) => {
    if (!t.tag.endsWith(".state")) return t
    const cl = c.get(t.tag.slice(0, -".state".length))
    return cl ? { ...t, v: cl.state } : t
  })
  for (const [id, cl] of c) {
    const st = stateTag.get(id)
    if (st) out.push({ tag: `${id}.root`, v: cl.root, ts: st.ts, q: st.q })
  }
  return out
}
```

- [ ] **Step 5: mock 이 지금 막은 곳을 알려준다** — `hub/src/adapters/mock.ts`, `/** 한 틱. 테스트가 시계를 직접 돌릴 수 있도록 public. */` 바로 앞에:

```ts
  /** 지금 막고 있는 구간들. 원인 판정을 이 정답과 대조하는 테스트용 — 판정에는 안 쓴다 */
  blockedNow(): string[] {
    const t = this.now()
    const plan = this.planFor(Math.floor(t / CYCLE_MS))
    return this.sims.filter((s) => this.isBlocked(s.seg.id, t, plan)).map((s) => s.seg.id)
  }

```

- [ ] **Step 6: 통과를 확인한다**

Run: `cd hub && node --test --import tsx ./test/cause.test.ts`
Expected: `ℹ pass 13`, `ℹ fail 0`. 정답 대조는 20분 시뮬레이션이라 약 4초.

- [ ] **Step 7: 허브 판정 타이머에 잇는다** — `hub/src/index.ts`

import (derive import 다음):

```ts
import { withCause } from "./cause.ts"
import { downstream, topoOrder } from "../../shared/graph.ts"
```

```ts
// 전
  let mem = new Map<string, SegMemory>()
  const deriveTimer = setInterval(() => {
    const { tags, next } = derive(scene.segments, cache.values(), mem, Date.now(), stallSec)
    mem = next
    for (const t of tags) if (cache.set(t)) fanout.push(t)
// 후
  let mem = new Map<string, SegMemory>()
  // 씬은 바뀌지 않으므로 연결과 순서는 한 번만 만든다. 순환은 loadScene 이 이미 거절했다.
  const down = downstream(scene)
  const topo = topoOrder(down)
  const order = "order" in topo ? topo.order : []
  const capacity = new Map(scene.segments.map((g) => [g.id, g.capacity ?? 20]))
  const deriveTimer = setInterval(() => {
    const { tags, next } = derive(scene.segments, cache.values(), mem, Date.now(), stallSec)
    mem = next
    for (const t of withCause(tags, down, order, capacity)) if (cache.set(t)) fanout.push(t)
```

- [ ] **Step 8: 전체·타입체크·커밋**

Run: `cd hub && npm test && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: `ℹ tests 105`, `ℹ fail 0`, tsc 두 번 모두 출력 없음.

```bash
git add shared/types.ts hub web/src/state.ts web/src/viewer/andon.ts
git commit -m "feat(hub): 정지를 원인과 영향으로 나눈다

derive 뒤에 classify 가 연결을 하류부터 훑는다. 하류가 전부 멈췄거나 꽉
찼으면 영향(blocked), 아니면 원인. .root 태그가 영향이 기다리는 원인을
가리킨다. 전파 mock 이 막은 곳과 대조해 20분 오판 0.5% 이하.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 화면 요약 함수 (`web/src/state.ts`)

**Files:**
- Modify: `web/src/state.ts` (전체 교체), `hub/test/state.test.ts` (전체 교체)

**Interfaces:**
- Produces: `segRoot(id, values): string`, `lampVisibleFar(st)` (blocked 추가), `affectedCounts(scene, values): Map<string, number>`, `type SectionSummary = { stalled: number; blocked: number }`, `sectionSummary(scene, values): Map<string, SectionSummary>`, `badgeText(label, s): string`, `badgeTone(s): "stalled" | "blocked" | "ok"`

- [ ] **Step 1: 테스트를 쓴다** — `hub/test/state.test.ts` 를 통째로:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { affectedCounts, badgeText, badgeTone, lampVisibleFar, sectionSummary, segRoot } from "../../web/src/state.ts"
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && node --test --import tsx ./test/state.test.ts`
Expected: FAIL — `does not provide an export named 'affectedCounts'`

- [ ] **Step 3: `web/src/state.ts` 를 통째로 바꾼다**

```ts
import type { Scene, SegState, TagValue } from "../../shared/types.ts"

/** 클릭 대상. geom.ts 가 사라졌으므로 여기가 새 집이다 */
export type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null

export const STATE_LABEL: Record<SegState, string> = {
  running: "가동", stalled: "정지", blocked: "영향", idle: "대기", unknown: "불명",
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

/** 영향(blocked) 구간이 기다리는 원인 구간 id. 해당 없으면 "" */
export function segRoot(id: string, values: Map<string, TagValue>): string {
  const v = values.get(`${id}.root`)
  return typeof v?.v === "string" ? v.v : ""
}

/**
 * 멀리서 보기에도 신호등을 세울 상태. 원인(빨강)·영향(노랑)과 불명(센서 값이
 * 끊김)이다 — 노랑 기둥이 막힘이 번진 범위를, 빨강이 그 끝을 보여준다. 불명을
 * 세우는 이유: 전체보기에서 끊긴 구간이 초록과 함께 사라지면 아무도 모른다.
 * 웹소켓 끊김 배너는 허브와의 연결만 말하지 PLC 하나가 끊긴 것은 말하지 않는다.
 */
export function lampVisibleFar(st: SegState): boolean {
  return st === "stalled" || st === "blocked" || st === "unknown"
}

/** 원인 구간 id → 그 원인 때문에 멈춘 영향 구간 수 */
export function affectedCounts(scene: Scene, values: Map<string, TagValue>): Map<string, number> {
  const n = new Map<string, number>()
  for (const g of scene.segments) {
    if (segState(g.id, values) !== "blocked") continue
    const r = segRoot(g.id, values)
    if (r) n.set(r, (n.get(r) ?? 0) + 1)
  }
  return n
}

export type SectionSummary = { stalled: number; blocked: number }

/** 구역 id → 원인·영향 구간 수. 구역마다 항목이 있다 (없으면 0) */
export function sectionSummary(scene: Scene, values: Map<string, TagValue>): Map<string, SectionSummary> {
  const m = new Map<string, SectionSummary>(scene.sections.map((s) => [s.id, { stalled: 0, blocked: 0 }]))
  for (const g of scene.segments) {
    const st = segState(g.id, values)
    const s = m.get(g.section)
    if (!s) continue
    if (st === "stalled") s.stalled++
    else if (st === "blocked") s.blocked++
  }
  return m
}

/** "3층 B구역 · 정지 1 · 영향 4" / "2층 A구역 · 영향 6" / "3층 C구역 · 정상" */
export function badgeText(label: string, s: SectionSummary): string {
  if (s.stalled) return `${label} · 정지 ${s.stalled}${s.blocked ? ` · 영향 ${s.blocked}` : ""}`
  if (s.blocked) return `${label} · 영향 ${s.blocked}`
  return `${label} · 정상`
}

/** 배지 색. 원인이 있으면 빨강, 영향만 있으면 노랑 — 원인은 다른 구역에 있다 */
export function badgeTone(s: SectionSummary): "stalled" | "blocked" | "ok" {
  return s.stalled ? "stalled" : s.blocked ? "blocked" : "ok"
}

/** "3:12" 꼴 */
export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
```

- [ ] **Step 4: 통과·커밋**

Run: `cd hub && npm test && cd ../web && npx tsc --noEmit`
Expected: `ℹ tests 110`, `ℹ fail 0`, tsc 출력 없음.

```bash
git add web/src/state.ts hub/test/state.test.ts
git commit -m "feat(web): 원인·영향 요약 — 영향 수, 구역 배지 문구와 색

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 화면 — 라벨·배지·칩·모달

**Files:**
- Modify (전체 교체): `web/src/Labels.tsx`, `web/src/AlertBar.tsx`, `web/src/Modal.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: Task 4 의 함수 전부, `goTo(seg: Segment)` (App, 기존)
- Produces: `<Modal ... onGo={(seg: Segment) => void}>`

- [ ] **Step 1: `Labels.tsx` 를 통째로 바꾼다**

```tsx
import { useEffect, useState } from "react"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import type { Scene, TagValue } from "../../shared/types.ts"
import { equipmentHeight } from "../../shared/types.ts"
import type { LayoutMode } from "../../shared/layout.ts"
import { badgeText, badgeTone, formatStall, sectionSummary, segRoot, segState, segStallMs, segWip } from "./state.ts"
import { worldAt, segmentPoints, pathSampler } from "./viewer/coords.ts"
import { projectToScreen } from "./viewer/project.ts"
import { SHOW_BELOW, zoomOf } from "./viewer/camera.ts"
import type { ViewerCtx } from "./viewer/Viewer.tsx"

type Item = { key: string; text: string; x: number; y: number; cls: string }
type Badge = { id: string; text: string; x: number; y: number; tone: "stalled" | "blocked" | "ok" }

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
      // 멀리서는 원인 구간 라벨과 구역 배지만, 가까이서는 화면 안의 모든 라벨.
      // 대형 씬은 전체보기에서 구간 500 개다 — 전부 띄우면 글자 더미에 빨강이 묻힌다.
      // 영향(노랑) 구간은 멀리서 신호등만 선다 — 라벨까지 띄우면 원인이 다시 묻힌다.
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

      for (const seg of scene.segments) {
        const st = segState(seg.id, values)
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
        if (st === "blocked") {
          // 무엇을 기다리는지 말해 준다. 원인이 없는 영향(원인 없는 정체)은 시간만
          const root = scene.segments.find((g) => g.id === segRoot(seg.id, values))
          const why = root ? ` · ${root.label} 때문에 대기` : ""
          out.push({ key: `st:${seg.id}`, text: `${formatStall(segStallMs(seg.id, values))}${why}`, x: p.x, y: p.y - 32, cls: "lbl-wait" })
        }
      }

      const bs: Badge[] = []
      if (far) {
        const summary = sectionSummary(scene, values)
        for (const sec of scene.sections) {
          const [x, y, w, h] = sec.rect
          const p = projectToScreen(bscene, worldAt(scene, sec.floor, x + w / 2, y + h / 2, 0.5, mode))
          if (!p.visible) continue
          const s = summary.get(sec.id)!
          bs.push({ id: sec.id, text: badgeText(sec.label, s), x: p.x, y: p.y, tone: badgeTone(s) })
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
            className={b.tone === "ok" ? "badge" : `badge ${b.tone}`}
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

- [ ] **Step 2: `AlertBar.tsx` 를 통째로 바꾼다**

```tsx
import { useEffect, useRef, useState } from "react"
import type { Scene, Segment, TagValue } from "../../shared/types.ts"
import { affectedCounts, formatStall, segStallMs, segState } from "./state.ts"

/** 칩은 이만큼만 세운다. 막힘 하나가 상류로 번지면 빨강이 여럿 된다 — 전부
 *  세우면 막대가 뷰어를 잡아먹는다. 오래 멈춘 순이라 대개 원인이 앞에 온다 */
const MAX_CHIPS = 5

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  onGo: (seg: Segment) => void
}

/**
 * 원인 구간만 칩으로 띄운다 — 막힘이 번져 멈춘 영향(노랑) 구간은 칩이 아니라 원인
 * 칩의 "영향 N" 으로 센다. 원인 하나에 칩 열셋이 서면 신입은 어디부터 볼지 모른다. 칩을 누르면 화면이 거기로 데려간다 —
 * 신입이 찾을 필요가 없는 것이 이 제품의 핵심이다.
 */
export default function AlertBar({ scene, values, onGo }: Props) {
  const stalled = scene.segments
    .filter((s) => segState(s.id, values) === "stalled")
    .map((s) => ({ seg: s, ms: segStallMs(s.id, values) }))
    .sort((a, b) => b.ms - a.ms)
  const affected = affectedCounts(scene, values)

  // 살아있는 영역이 알려야 할 것은 "정지가 새로 생겼다/풀렸다" 이지
  // "초가 바뀌었다" 가 아니다. role="status" 는 암묵적으로 aria-atomic="true"
  // 라서, 칩 하나의 타이머가 500ms 마다 갱신될 때마다 스크린리더가 막대
  // 전체를 다시 읽는다 — 정지가 둘이면 두 배로 읽는다. 그래서 칩에서는
  // 살아있는 영역을 떼고, 아래 announcer 가 "집합이 바뀐 순간" 에만 말한다.
  const ids = stalled.map(({ seg }) => seg.id).join(",")
  const [announcement, setAnnouncement] = useState("")
  const prevIds = useRef<string | null>(null)

  useEffect(() => {
    // 첫 렌더에서는 알리지 않는다 — 화면을 켠 순간 읽어줄 이유가 없다.
    if (prevIds.current === null) { prevIds.current = ids; return }
    if (prevIds.current === ids) return
    prevIds.current = ids
    setAnnouncement(
      stalled.length === 0
        ? "정상 가동으로 복귀"
        : `정지 ${stalled.length}건: ${stalled.map(({ seg }) => {
          const n = affected.get(seg.id) ?? 0
          return n ? `${seg.label} (영향 ${n})` : seg.label
        }).join(", ")}`,
    )
  }, [ids, stalled, affected])

  // 살아있는 영역은 내용이 바뀌기 **전에** 이미 DOM 에 있어야 한다. 새로 삽입된
  // 영역의 초기 내용은 안 읽어주는 AT 가 있기 때문이다. 두 분기 안에 각각 쓰면
  // JSX 가 형제 위치로 대조하므로 ok↔정지 전환 때마다 언마운트·재마운트된다 —
  // 그래서 분기 바깥, 프래그먼트의 첫 자식으로 고정한다. position: absolute 라
  // 그리드 트랙을 만들지 않으므로 레이아웃에는 영향이 없다.
  const announcer = (
    <span className="sr-only" aria-live="polite">{announcement}</span>
  )

  return (
    <>
      {announcer}
      {stalled.length === 0 ? (
        <div className="alert-bar ok">정상 가동</div>
      ) : (
        <div className="alert-bar">
          {stalled.slice(0, MAX_CHIPS).map(({ seg, ms }) => {
            const section = scene.sections.find((x) => x.id === seg.section)
            const n = affected.get(seg.id) ?? 0
            return (
              <button key={seg.id} className="chip" onClick={() => onGo(seg)}>
                ⚠ {section?.label ?? seg.section} {seg.label} 정지 {formatStall(ms)}{n ? ` · 영향 ${n}` : ""}
              </button>
            )
          })}
          {stalled.length > MAX_CHIPS && (
            <span className="chip-more">외 {stalled.length - MAX_CHIPS}건</span>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: `Modal.tsx` 를 통째로 바꾼다**

```tsx
import { useEffect, useRef, useState } from "react"
import type { Camera, Scene, Segment, TagValue } from "../../shared/types.ts"
import { STATE_LABEL, formatStall, segRoot, segStallMs, segState, segWip, type Selection } from "./state.ts"

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

/** 포커스 트랩 대상. 이 모달 안에 있을 수 있는 요소는 닫기 버튼, 카메라 탭,
 *  원인으로 가기 버튼뿐이라 매번 다시 조회해도 비용이 없다 — 목록을 캐싱할 이유가 없다. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  go2rtcBase: string
  selection: Selection
  onClose: () => void
  /** 영향 구간의 "원인 →" 버튼. 모달을 닫고 그 구간으로 데려간다 */
  onGo: (seg: Segment) => void
}

/** 정지·영향이면 상태 뒤에 정지 시간을 붙인다 */
function stateText(id: string, values: Map<string, TagValue>): string {
  const st = segState(id, values)
  const t = st === "stalled" || st === "blocked" ? ` ${formatStall(segStallMs(id, values))}` : ""
  return `${STATE_LABEL[st]}${t}`
}

export default function Modal({ scene, values, go2rtcBase, selection, onClose, onGo }: Props) {
  const [tab, setTab] = useState(0)
  const ready = useGo2rtcScript(go2rtcBase)
  const dialogRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const downOnBackdrop = useRef(false)

  useEffect(() => { setTab(0) }, [selection?.kind, selection?.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // 접근성: 모달이 열리면 초점을 안으로 옮기고, 닫히면 열기 전 요소로 되돌린다.
  // role="dialog" + aria-modal="true" 는 스크린리더가 모달 바깥을 배경으로
  // 인식하게 하는 표준 신호다 — 형제 요소마다 aria-hidden 을 손으로 거는 것보다
  // 이쪽이 이 값을 만드는 정확한 방법이고, 주요 스크린리더가 실제로 지원한다.
  useEffect(() => {
    if (!selection) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => { prevFocusRef.current?.focus() }
  }, [selection?.kind, selection?.id])

  if (!selection) return null

  // 대상이 무엇이든 카메라는 언제나 그 대상이 속한 섹션에서 온다
  let sectionId: string | undefined
  let title = ""
  let rows: [string, string][] = []
  // 영향 구간이면 그 원인. 모달 아래에 "원인: … →" 버튼으로 뜬다
  let root: Segment | undefined

  if (selection.kind === "section") {
    const sec = scene.sections.find((s) => s.id === selection.id)
    if (!sec) return null
    sectionId = sec.id
    title = sec.label
    rows = scene.segments
      .filter((g) => g.section === sec.id)
      .map((g) => [g.label, `${stateText(g.id, values)} · WIP ${segWip(g.id, values)}`])
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
    if (st === "blocked") root = scene.segments.find((g) => g.id === segRoot(seg.id, values))
    rows = [
      ["상태", STATE_LABEL[st]],
      ["누적 입고", String(num(values, `${seg.id}.in`) ?? "—")],
      ["누적 출고", String(num(values, `${seg.id}.out`) ?? "—")],
      ["구간 내 재공(WIP)", `${segWip(seg.id, values)}${seg.capacity ? ` / ${seg.capacity}` : ""}`],
      ["정지 시간", st === "stalled" || st === "blocked" ? formatStall(segStallMs(seg.id, values)) : "—"],
    ]
  }

  const section = scene.sections.find((s) => s.id === sectionId)
  const cams: Camera[] = (section?.cameras ?? [])
    .map((id) => scene.cameras.find((c) => c.id === id))
    .filter((c): c is Camera => !!c)

  // Tab 이 모달 밖으로 나가지 않게 가둔다. 배경이 시각적으로만 가려진 게 아니라
  // 키보드로도 닿지 않아야 진짜 "모달"이다 — 뒤에 층 탭·이상 칩 버튼이 그대로
  // 남아 있어서, 트랩이 없으면 Tab 만으로 모달이 뜬 채 배경을 조작할 수 있다.
  const onTrapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    // 열린 직후에는 초점이 컨테이너 자신에게 있고, 모달 안의 비-포커스 영역
    // (제목, 수치 행)을 클릭해도 초점은 가장 가까운 포커스 가능 조상 =
    // 컨테이너로 간다. 그 상태를 first 로도 last 로도 보지 않으면 다음
    // Shift+Tab 이 그대로 배경으로 빠져나간다 — 트랩이 막으려던 바로 그 일이고,
    // 키보드 사용자가 제일 먼저 시도할 조합에서 터진다. 컨테이너에서 앞으로
    // Tab 하는 경우는 손대지 않는다 — 브라우저 기본 동작이 이미 first 로 간다.
    const atContainer = active === dialogRef.current
    if (e.shiftKey && (active === first || atContainer)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="modal-backdrop"
      // 모달 안에서 시작해 배경에서 끝나는 드래그(수치를 긁어 복사하는, 관제
      // 화면에서 아주 흔한 동작)는 click 이 두 지점의 공통 조상 = 배경에서
      // 발생한다. 그러면 .modal 의 stopPropagation 을 거치지 않아 모달이 선택
      // 도중에 닫힌다. 눌린 지점도 배경이었을 때만 닫는다.
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={() => { if (downOnBackdrop.current) onClose() }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onTrapTab}
        onClick={(e) => e.stopPropagation()}
      >
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
        {root && (
          <button className="goto-root" onClick={() => { const r = root; onClose(); onGo(r) }}>
            원인: {root.label} →
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: App 이 모달에 `onGo` 를 준다** — `web/src/App.tsx` 의 `<Modal>`:

```tsx
        onClose={() => setSelection(null)}
        onGo={goTo}
```

- [ ] **Step 5: 스타일** — `web/src/styles.css`

`.lbl-stall` 줄 다음에: `.lbl-wait { font-size: 12px; color: #ffd966; }`

`.badge.stalled` 줄 다음에:

```css
/* 영향만 있는 구역 — 원인은 다른 구역에 있다 */
.badge.blocked { border-color: #b8962e; background: #332a12; color: #ffe08a; }
```

`.rows dd { margin: 0; }` 다음에:

```css
.goto-root {
  margin-top: 12px; width: 100%; padding: 8px 12px; border: 1px solid #d24b4b; border-radius: 6px;
  background: #3a1d1d; color: #ffb4b4; font: inherit; cursor: pointer; text-align: left;
}
.goto-root:hover { background: #4a2424; }
```

- [ ] **Step 6: 타입체크·빌드**

Run: `cd web && npx tsc --noEmit && npm run build 2>&1 | grep "index-.*\.js"`
Expected: tsc 출력 없음, gzip 약 313KB.

- [ ] **Step 7: 막힘이 번진 장면을 찍는다**

공통 절차로 대형 씬을 띄우고, 영향 구간이 8개 이상 생길 때까지 기다린 뒤 찍는다:

```bash
until node /tmp/packtory-wait.mjs; do sleep 3; done
node tools/shot.mjs "http://localhost:8091/" /tmp/packtory-cause.png 3000
kill $(lsof -t -i:8091 -sTCP:LISTEN)
```

Expected (Read 로 연다): 칩이 원인마다 하나, "… 정지 0:58 · 영향 5" 꼴. 원인이 있는 구역 배지는 빨강 "… · 정지 1 · 영향 N", 영향만 있는 구역은 **노랑** "… · 영향 N". 초록 구역은 "정상".

- [ ] **Step 8: 커밋**

```bash
git add web/src
git commit -m "feat(viewer): 원인만 빨강, 영향은 노랑 — 칩·배지·라벨·모달

칩은 원인만 '· 영향 N' 과 함께 선다. 영향만 있는 구역 배지는 노랑.
영향 구간 모달의 '원인 →' 은 원인 구간으로 데려간다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 문서 — README·체크리스트 v5·스펙

**Files:**
- Modify: `README.md`, `docs/BROWSER-CHECKLIST.md`, `docs/superpowers/specs/2026-09-27-packtory-root-cause-design.md`

- [ ] **Step 1: README** — `## 대형 씬 (5층 네트워크)` 절의 "모의 데이터는 구간 연결(끝점이 같은 좌표면 이어진 것)을 따라 흐른다." 문장을 "모의 데이터는 구간 연결(`next`)을 따라 흐른다." 로 바꾸고, 그 절 끝(URL 파라미터 문단 다음)에 문단을 더한다:

```markdown
막힘이 번지면 **원인만 빨강**(점멸), 원인 때문에 기다리는 상류는 **노랑**(영향,
점멸 없음)이다. 칩은 원인 하나에 하나, "· 영향 N" 과 함께 선다. 영향 구간을
누르면 모달의 "원인: … →" 이 원인으로 데려간다. 판정은 허브가 한다
(`hub/src/cause.ts`): 정지한 구간의 하류가 전부 멈췄거나 꽉 찼으면(capacity 의
80% 이상) 영향, 아니면 원인. 카운터만으로 못 가르는 순간이 드물게 있어 원인
빨강이 0.5초 깜빡일 수 있다(20분에 0~4번, 실측).
```

`## 씬 편집` 절에 한 줄: "구간 연결은 `next: [\"다음 구간 id\", …]` 로 적는다(스키마 v4). 없으면 출구다. 없는 id·자기 참조·순환은 부팅 때 거절, 이어진 끝점이 1m 넘게 떨어지면 경고." 테스트 수 `82개` → `110개`.

- [ ] **Step 2: 체크리스트** — `docs/BROWSER-CHECKLIST.md` 제목 `(v4 — 대형 네트워크)` → `(v5 — 원인 추적)`, 맨 끝에:

```markdown

## v5 — 원인 추적

| # | 할 일 | 보여야 하는 것 |
|---|---|---|
| 1 | 대형 씬에서 막힘이 번질 때까지 | 빨강(점멸)은 원인 하나, 그 상류는 노랑(점멸 없음) |
| 2 | AlertBar | 칩은 원인마다 하나, "… 정지 0:58 · 영향 5" |
| 3 | 전체보기 | 노랑 기둥이 번진 범위를 보여준다. 라벨은 원인 구간만 |
| 4 | 영향만 있는 구역 | 배지가 노랑 "… · 영향 N" |
| 5 | 영향 구간 클릭 → 모달 | 상태 "영향", 정지 시간, "원인: … →" 버튼. 누르면 모달이 닫히고 원인으로 날아간다 (계단 배치에서도) |
| 6 | 설비 경고 발광(주황)이 있는 화면 | 주황 발광과 노랑 신호등이 구별된다 |
| 7 | 막힘이 풀릴 때 | 빨강·노랑이 함께 초록으로 돌아온다. 노랑이 남지 않는다 |
| 8 | 가까이서 영향 구간 | 노랑 "0:42 · C-92 충전 이송 때문에 대기" |
```

- [ ] **Step 3: 스펙을 실제와 맞춘다** — `docs/superpowers/specs/2026-09-27-packtory-root-cause-design.md`:

1. `상태: 초안 (검토 대기)` → `상태: 승인됨, 구현 중 실측으로 고침 (2026-09-27)`
2. 6장 `classify` 시그니처에 `full: Set<string>,` 를 `stallMs` 다음에 더하고, 주석의 "하류가 전부 stalled 또는 blocked 면" → "하류가 전부 stalled·blocked 이거나 꽉 찼으면(WIP ≥ capacity × 0.8)".
3. 6장 규칙 표의 둘째 행 하류 칸 `**전부** stalled/blocked` → `**전부** stalled/blocked/꽉 찬 running`, 표 아래에 두 줄: "꽉 찬 running 구간은 자기 하류의 원인을 물려받아 위로 전한다 — 합류점 아래는 꽉 찬 채 조금씩 움직여 running 이라, 몫을 못 받은 상류가 원인으로 오판됐다(실측). 꽉 찬 running 아래에 원인이 없으면 영향이되 `root` 는 비어 있다 — 원인 없는 정체다."
4. 6장 `withCause` 언급(허브 배선)에 "`capacity` 를 넘긴다" 를 더한다.
5. 8장 정답 대조 행을 "① 지금 막힌 구간이 stalled 면 원인(다른 막힘의 상류면 예외) ② 원인은 지금 막힌 구간이거나 풀린 지 stallSec 이내인 막힘의 상류 — **오판은 원인 판정의 0.5% 이하, 같은 구간이 두 번 잇달아 틀리지 않는다** (시드 8개 × 20분에서 원인 판정 약 4000번 중 0~4번, 전부 0.5초짜리)" 로 바꾼다.
6. 4장 `topoOrder` 문장의 "순환에서 빠져나오지 못한 구간 id 들" → "순환과 그 하류의 구간 id 들".

- [ ] **Step 4: 커밋**

```bash
git add README.md docs/BROWSER-CHECKLIST.md docs/superpowers/specs/2026-09-27-packtory-root-cause-design.md
git commit -m "docs: 원인 추적 — README·체크리스트 v5·스펙을 실제에 맞춘다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
