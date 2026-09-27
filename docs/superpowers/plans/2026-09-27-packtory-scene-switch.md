# packtory 데모 씬 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 허브가 작은 씬과 대형 씬을 함께 돌리고, 웹이 버튼 하나로 둘을 오간다. fps 는 늘 보인다.

**Architecture:** `startHub` 가 씬 목록을 받아 씬마다 실행 환경(어댑터·캐시·판정 타이머·팬아웃)을 따로 만든다. `/api/scenes` 로 목록을, `/api/scene?id=`·`/ws?scene=` 로 씬을 고른다. 웹은 고른 씬 id 를 URL 에 남기고, 바뀌면 씬·값·소켓을 새로 받는다.

**Tech Stack:** Node 24 (`tsx`), `ws`, `node --test`, Vite + React 18, `@babylonjs/core`.

**Spec:** `docs/superpowers/specs/2026-09-27-packtory-scene-switch-design.md`

## Global Constraints

- 새 의존성 금지. 웹 자동 테스트 없음(스크린샷·체크리스트).
- 씬 id 는 `small`(scene.json), `large`(scene.large.json). 기본 **large**. `SCENE` 환경 변수가 있으면 그 씬 하나만(id 는 파일 이름에서 `.json` 을 뺀 것).
- 없는 씬: HTTP 404, WS 는 코드 4404 로 닫는다.
- 씬끼리 캐시·팬아웃을 공유하지 않는다.
- 주석·문자열 한국어. 커밋 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 허브 종료는 `kill $(lsof -t -i:<포트> -sTCP:LISTEN)` (`pkill -f` 금지).
- **`tools/shot.mjs` 는 대형 씬에서 가끔 멈춘다** (헤드리스 Windows Chrome, main 에서도 세 번에 한 번꼴로 재현 — 이 계획의 변경과 무관). `timeout 120` 을 걸고, 124 로 끝나면 한 번 더 찍는다.

## Review Focus

1. **씬을 바꾸는 순간 옛 씬의 값·모달이 새 씬에 섞이는가** — 사람은 새 씬만 보이길 기대한다. `useScene`·`useValues` 가 id 가 바뀌면 먼저 비운다, `switchScene` 이 선택을 비운다 → 체크리스트 4.
2. **없는 `?scene=` 으로 연 URL** (`?scene=old`) — 기본 씬으로 뜨길 기대한다(빈 화면이나 404 가 아니라). `sceneId` 계산이 목록에 있을 때만 URL 을 쓴다 → 체크리스트 7.
3. **씬 하나(`SCENE=`)로 띄운 허브** — 버튼이 없어야 한다 → 체크리스트 6.
4. **보지 않는 씬의 mock 이 계속 돌아 허브가 느려지는가** — 대형 틱 약 0.3ms 라 괜찮다고 봤다. 두 씬 허브의 WS 트래픽이 단일 씬 허브와 같음을 시제품에서 확인했다(대형 3초 31메시지).
5. **허브 재접속 중 씬 전환** — 옛 씬의 재접속 타이머가 새 씬 소켓과 겹치지 않아야 한다. `useValues` 의 cleanup 이 타이머를 지우고 `cancelled` 를 세운다(기존 구조 그대로, deps 만 `[sceneId]`).

---

### Task 1: 허브가 씬 여럿을 돌린다

**Files:**
- Modify: `hub/src/index.ts` (전체 교체), `hub/test/fanout.test.ts` (패치)
- Create: `hub/test/scenes.test.ts`

**Interfaces:**
- Produces: `type SceneSpec = { id: string; path: string; adapter: Adapter }`, `startHub({ scenes: SceneSpec[]; defaultScene: string; port; go2rtcBase; stallSecOverride?; webDir? })`. HTTP `GET /api/scenes` → `{ default: string; scenes: { id: string; name: string }[] }`, `GET /api/scene?id=`, WS `/ws?scene=`.

- [ ] **Step 1: 테스트를 쓴다** — `hub/test/scenes.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import WebSocket from "ws"
import { startHub } from "../src/index.ts"
import type { Adapter, Emit } from "../src/adapter.ts"
import type { WsMessage } from "../../shared/types.ts"

class FakeAdapter implements Adapter {
  emit!: Emit
  async start(emit: Emit) { this.emit = emit }
  async stop() {}
}

const SMALL = new URL("../../scene.json", import.meta.url).pathname
const LARGE = new URL("../../scene.large.json", import.meta.url).pathname

/** 작은 씬과 대형 씬을 함께 띄운다. 기본은 대형 */
async function two() {
  const small = new FakeAdapter(), large = new FakeAdapter()
  const hub = await startHub({
    scenes: [{ id: "small", path: SMALL, adapter: small }, { id: "large", path: LARGE, adapter: large }],
    defaultScene: "large", port: 0, go2rtcBase: "http://x",
  })
  return { hub, small, large, base: `127.0.0.1:${hub.port}` }
}

/** 소켓의 첫 메시지(스냅숏)의 태그들 */
function snapshotTags(url: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once("message", (raw) => {
      const m = JSON.parse(raw.toString()) as WsMessage
      ws.close()
      resolve(m.data.map((t) => t.tag))
    })
    ws.once("error", reject)
  })
}

test("/api/scenes 가 씬 목록과 기본 씬을 준다", async () => {
  const { hub, base } = await two()
  try {
    const body = await (await fetch(`http://${base}/api/scenes`)).json()
    assert.deepEqual(body, {
      default: "large",
      scenes: [{ id: "small", name: "데모 라인" }, { id: "large", name: "대형 데모 공장 (5층)" }],
    })
  } finally { await hub.close() }
})

test("/api/scene 은 id 의 씬, id 가 없으면 기본 씬, 없는 id 면 404", async () => {
  const { hub, base } = await two()
  try {
    const small = await (await fetch(`http://${base}/api/scene?id=small`)).json()
    assert.equal(small.scene.segments.length, 4)
    const dflt = await (await fetch(`http://${base}/api/scene`)).json()
    assert.equal(dflt.scene.name, "대형 데모 공장 (5층)")
    assert.equal((await fetch(`http://${base}/api/scene?id=nope`)).status, 404)
  } finally { await hub.close() }
})

test("씬마다 자기 태그만 받는다 — 한쪽 어댑터가 낸 값이 다른 씬으로 가지 않는다", async () => {
  const { hub, small, large, base } = await two()
  try {
    small.emit("conv-1.in", 5, Date.now())
    large.emit("f1-c001.in", 7, Date.now())
    const s = await snapshotTags(`ws://${base}/ws?scene=small`)
    const l = await snapshotTags(`ws://${base}/ws?scene=large`)
    assert.ok(s.includes("conv-1.in") && !s.includes("f1-c001.in"), s.join(","))
    assert.ok(l.includes("f1-c001.in") && !l.includes("conv-1.in"), l.join(","))
  } finally { await hub.close() }
})

test("/ws 는 기본 씬을 준다", async () => {
  const { hub, large, base } = await two()
  try {
    large.emit("f1-c001.in", 7, Date.now())
    assert.ok((await snapshotTags(`ws://${base}/ws`)).includes("f1-c001.in"))
  } finally { await hub.close() }
})

test("없는 씬으로 접속하면 4404 로 닫힌다", async () => {
  const { hub, base } = await two()
  try {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${base}/ws?scene=nope`)
      ws.on("close", (c) => resolve(c))
    })
    assert.equal(code, 4404)
  } finally { await hub.close() }
})

test("기본 씬이 목록에 없거나 id 가 겹치면 startHub 가 거절한다", async () => {
  const a = { id: "small", path: SMALL, adapter: new FakeAdapter() }
  await assert.rejects(startHub({ scenes: [a], defaultScene: "large", port: 0, go2rtcBase: "x" }), /기본 씬 large/)
  await assert.rejects(startHub({ scenes: [a, { ...a }], defaultScene: "small", port: 0, go2rtcBase: "x" }), /겹친다/)
})
```

그리고 기존 `fanout.test.ts` 를 새 `startHub` 모양으로 바꾼다. 아래 패치를 `/tmp/fanout.patch` 로 저장해 `git apply /tmp/fanout.patch`:

````diff
--- a/hub/test/fanout.test.ts
+++ b/hub/test/fanout.test.ts
@@ -14,6 +14,9 @@
 
 const SCENE = new URL("../../scene.json", import.meta.url).pathname
 
+/** 작은 씬 하나만 도는 허브 */
+const one = (adapter: Adapter) => ({ scenes: [{ id: "small", path: SCENE, adapter }], defaultScene: "small" })
+
 function nextMessage(ws: WebSocket, pred: (m: WsMessage) => boolean): Promise<WsMessage> {
   return new Promise((resolve) => {
     const on = (raw: Buffer) => {
@@ -30,7 +33,7 @@
 
 test("접속하면 스냅샷을 받고, 스냅샷에 파생 태그가 들어있다", async () => {
   const fake = new FakeAdapter()
-  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x" })
+  const hub = await startHub({ ...one(fake), port: 0, go2rtcBase: "http://x" })
   try {
     const now = Date.now()
     fake.emit("conv-3.in", 100, now)
@@ -50,7 +53,7 @@
 
 test("값이 바뀌면 values 로 푸시하고, 안 바뀐 태그는 안 보낸다", async () => {
   const fake = new FakeAdapter()
-  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x" })
+  const hub = await startHub({ ...one(fake), port: 0, go2rtcBase: "http://x" })
   try {
     const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
     await nextMessage(ws, (m) => m.type === "snapshot")
@@ -88,7 +91,7 @@
 })
 
 test("GET /api/scene 가 씬과 go2rtcBase 를 준다", async () => {
-  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: new FakeAdapter(), go2rtcBase: "http://cam:1984" })
+  const hub = await startHub({ ...one(new FakeAdapter()), port: 0, go2rtcBase: "http://cam:1984" })
   try {
     const res = await fetch(`http://127.0.0.1:${hub.port}/api/scene`)
     const body = await res.json()
@@ -103,7 +106,7 @@
 test("stallSec 이 지나면 stalled 로 바뀌고 stallMs 가 올라간다", async () => {
   const fake = new FakeAdapter()
   // stallSec 을 1초로 줄여 테스트를 빠르게 돌린다
-  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x", stallSecOverride: 1 })
+  const hub = await startHub({ ...one(fake), port: 0, go2rtcBase: "http://x", stallSecOverride: 1 })
   try {
     const now = Date.now()
     fake.emit("conv-3.in", 100, now)
@@ -125,9 +128,8 @@
 
 test("정적 서빙: 깨진 퍼센트 인코딩 요청은 400 이고, 프로세스는 죽지 않는다", async () => {
   const hub = await startHub({
-    scenePath: SCENE,
+    ...one(new FakeAdapter()),
     port: 0,
-    adapter: new FakeAdapter(),
     go2rtcBase: "http://x",
     // 존재하기만 하면 되는 디렉터리 — 정적 파일을 실제로 서빙하는지는 이 테스트의 관심사가 아니다.
     webDir: new URL(".", import.meta.url).pathname,
````

- [ ] **Step 2: 실패를 확인한다**

Run: `cd hub && npx tsc --noEmit; node --test --import tsx ./test/scenes.test.ts 2>&1 | grep "ℹ fail"`
Expected: tsc 가 `'scenes' does not exist in type 'HubOptions'` 류 에러, 테스트 `ℹ fail 6`.

- [ ] **Step 3: `hub/src/index.ts` 를 통째로 바꾼다**

```ts
import { createServer, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { basename, extname, join, normalize } from "node:path"
import { WebSocketServer } from "ws"
import { loadScene } from "./scene.ts"
import { Cache } from "./cache.ts"
import { createFanout } from "./ws.ts"
import { derive, type SegMemory } from "./derive.ts"
import { withCause } from "./cause.ts"
import { downstream, topoOrder } from "../../shared/graph.ts"
import type { Adapter, Emit } from "./adapter.ts"
import { MockAdapter } from "./adapters/mock.ts"

const DERIVE_MS = 500

/** 허브가 돌리는 씬 하나. 씬마다 어댑터·캐시·판정·팬아웃을 따로 둔다 */
export type SceneSpec = { id: string; path: string; adapter: Adapter }

export type HubOptions = {
  /** 하나 이상 */
  scenes: SceneSpec[]
  /** scenes 중 하나. 씬을 안 고른 요청(`/api/scene`, `/ws`)이 이 씬을 본다 */
  defaultScene: string
  port: number
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

/**
 * 씬 하나의 실행 환경: 캐시 → 팬아웃, 그리고 판정 타이머(derive + 원인 판정).
 * 씬끼리 섞이지 않게 전부 따로 둔다 — 한 캐시에 넣으면 두 씬에 같은 id 가 생기는
 * 순간 값이 뒤섞인다.
 */
async function startScene(spec: SceneSpec, stallSecOverride: number | undefined) {
  const scene = loadScene(spec.path)
  const stallSec = stallSecOverride ?? scene.stallSec
  const cache = new Cache()
  const fanout = createFanout(cache)

  const emit: Emit = (tag, v, ts, q = "good") => {
    const tv = { tag, v, ts, q }
    if (cache.set(tv)) fanout.push(tv)
  }

  await spec.adapter.start(emit)

  // 값이 안 바뀌어도 돌아야 stallMs 가 올라간다 — 정지 시간은 아무 일도
  // 안 일어날 때 세는 숫자다.
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
  }, DERIVE_MS)

  return {
    id: spec.id,
    scene,
    fanout,
    async stop() {
      clearInterval(deriveTimer)
      fanout.stop()
      await spec.adapter.stop()
    },
  }
}

export async function startHub(opts: HubOptions) {
  const ids = opts.scenes.map((s) => s.id)
  if (ids.length === 0) throw new Error("씬이 하나도 없다")
  if (new Set(ids).size !== ids.length) throw new Error(`씬 id 가 겹친다: ${ids.join(", ")}`)
  if (!ids.includes(opts.defaultScene)) throw new Error(`기본 씬 ${opts.defaultScene} 이 목록(${ids.join(", ")})에 없다`)

  const runs = new Map<string, Awaited<ReturnType<typeof startScene>>>()
  for (const spec of opts.scenes) runs.set(spec.id, await startScene(spec, opts.stallSecOverride))
  /** 쿼리의 씬 id. 없으면 기본 씬, 목록에 없으면 undefined */
  const pick = (id: string | null) => runs.get(id ?? opts.defaultScene)

  const json = (res: ServerResponse, body: unknown) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://hub")
    if (url.pathname === "/api/scenes") {
      json(res, {
        default: opts.defaultScene,
        scenes: [...runs.values()].map((r) => ({ id: r.id, name: r.scene.name })),
      })
      return
    }
    if (url.pathname === "/api/scene") {
      const run = pick(url.searchParams.get("id"))
      if (!run) { res.writeHead(404).end(); return }
      json(res, { scene: run.scene, go2rtcBase: opts.go2rtcBase })
      return
    }
    if (!opts.webDir) {
      res.writeHead(404).end()
      return
    }
    // 정적 파일. SPA 라우팅이 없으므로 없는 경로는 index.html 로 떨어뜨린다.
    // decodeURIComponent 는 `GET /%` 같은 깨진 퍼센트 인코딩에 URIError 를 던진다.
    // async 핸들러 안이라 잡지 않으면 unhandled rejection 으로 프로세스가 죽는다 —
    // OT망에 상주하는 서버를 요청 한 번으로 내릴 수 있으므로 반드시 감싼다.
    let decoded: string
    try {
      decoded = decodeURIComponent((req.url ?? "/").split("?")[0])
    } catch {
      res.writeHead(400).end()
      return
    }
    const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "")
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
  wss.on("connection", (ws, req) => {
    const run = pick(new URL(req.url ?? "/", "http://hub").searchParams.get("scene"))
    // 없는 씬이면 무엇을 잘못했는지 알 수 있게 전용 코드로 닫는다 (4000 번대는 앱이 쓴다)
    if (!run) { ws.close(4404, "unknown scene"); return }
    run.fanout.add(ws)
  })

  await new Promise<void>((resolve) => server.listen(opts.port, resolve))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : opts.port

  return {
    port,
    async close() {
      for (const r of runs.values()) await r.stop()
      wss.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// 직접 실행했을 때만 뜬다 (테스트에서 import 할 때는 안 뜬다)
if (import.meta.url === `file://${process.argv[1]}`) {
  // 사건 순서의 시드. 공장 모양의 시드(tools/gen-scene.ts)와 별개다 — 같은 공장의
  // 다른 하루를 재생한다. 정수가 아니면 조용히 다른 각본이 돌지 않게 거절한다.
  // 빈 값("MOCK_SEED=")은 Number("") = 0 이라 정수 검사를 통과해 버린다 — 글자로 본다
  const raw = process.env.MOCK_SEED ?? "1"
  if (!/^-?\d+$/.test(raw.trim())) throw new Error(`MOCK_SEED 는 정수여야 한다 (받음: "${raw}")`)
  const seed = Number(raw)

  // SCENE 을 주면 그 씬 하나만 (id 는 파일 이름). 아니면 데모 두 씬, 기본은 대형.
  const root = (f: string) => new URL(`../../${f}`, import.meta.url).pathname
  const paths: [string, string][] = process.env.SCENE
    ? [[basename(process.env.SCENE, ".json"), process.env.SCENE]]
    : [["small", root("scene.json")], ["large", root("scene.large.json")]]
  const scenes = paths.map(([id, path]) => ({ id, path, adapter: new MockAdapter(loadScene(path), { seed }) }))

  const hub = await startHub({
    scenes,
    defaultScene: process.env.SCENE ? scenes[0].id : "large",
    port: Number(process.env.PORT ?? 8080),
    go2rtcBase: process.env.GO2RTC_BASE ?? "http://127.0.0.1:1984",
    webDir: process.env.WEB_DIR,
  })
  console.log(`packtory-hub http://127.0.0.1:${hub.port} (씬: ${scenes.map((s) => s.id).join(", ")})`)
}
```

- [ ] **Step 4: 통과·확인·커밋**

Run: `cd hub && npm test && npx tsc --noEmit`
Expected: `ℹ tests 121`, `ℹ fail 0`, tsc 출력 없음.

손으로: `cd hub && (PORT=8096 node_modules/.bin/tsx src/index.ts > /tmp/h.log 2>&1 &); sleep 6; cat /tmp/h.log; curl -s localhost:8096/api/scenes; kill $(lsof -t -i:8096 -sTCP:LISTEN)`
Expected: `packtory-hub http://127.0.0.1:8096 (씬: small, large)` 와 `{"default":"large","scenes":[{"id":"small","name":"데모 라인"},{"id":"large","name":"대형 데모 공장 (5층)"}]}`.

```bash
git add hub
git commit -m "feat(hub): 씬 여럿을 따로 돌린다 — /api/scenes, ?id=, /ws?scene=

기본은 small·large 두 씬, 기본 씬 large. SCENE 을 주면 그 씬 하나만.
씬마다 어댑터·캐시·판정·팬아웃을 따로 둬 값이 섞이지 않는다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 웹의 씬 버튼과 상시 fps

**Files:**
- Modify: `web/src/scene.ts` (전체 교체), `web/src/useValues.ts`, `web/src/App.tsx`, `web/src/styles.css` (패치), `README.md`, `docs/BROWSER-CHECKLIST.md`

**Interfaces:**
- Consumes: Task 1 의 API
- Produces: `useSceneList(): { list: SceneList | null; error }`, `useScene(id: string | null)`, `useValues(sceneId: string | null)`

- [ ] **Step 1: `web/src/scene.ts` 를 통째로 바꾼다**

```ts
import { useEffect, useState } from "react"
import type { SceneResponse } from "../../shared/types.ts"

export type SceneList = { default: string; scenes: { id: string; name: string }[] }

/** 허브가 돌리는 씬 목록과 기본 씬 */
export function useSceneList() {
  const [list, setList] = useState<SceneList | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/scenes")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SceneList>
      })
      .then(setList)
      .catch((e: Error) => setError(e.message))
  }, [])

  return { list, error }
}

/** 씬 하나. id 가 null 이면 아직 고르지 않은 것이라 받지 않는다 */
export function useScene(id: string | null) {
  const [data, setData] = useState<SceneResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    // 씬을 바꾸는 순간 이전 씬을 버린다 — 새 씬이 올 때까지 옛 씬을 새 값과 함께 그리면
    // 없는 id 들을 찾아 헤맨다
    setData(null)
    setError(null)
    let cancelled = false
    fetch(`/api/scene?id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SceneResponse>
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [id])

  return { data, error }
}
```

- [ ] **Step 2: `useValues`·`App`·스타일** — 아래 패치를 `/tmp/web.patch` 로 저장해 `git apply /tmp/web.patch`:

````diff
--- a/web/src/useValues.ts
+++ b/web/src/useValues.ts
@@ -3,7 +3,9 @@
 
 const RECONNECT_MS = 3000
 
-export function useValues() {
+/** 씬 하나의 값. 씬이 바뀌면 이전 씬의 값을 버리고 그 씬의 소켓으로 다시 붙는다.
+ *  sceneId 가 null 이면(아직 안 고름) 붙지 않는다 */
+export function useValues(sceneId: string | null) {
   const [values, setValues] = useState<Map<string, TagValue>>(new Map())
   const [connected, setConnected] = useState(false)
 
@@ -13,6 +15,9 @@
     // 첫 cleanup 이 세운 플래그를 되돌린다. 그 뒤 (항상 비동기로) 도착하는
     // 첫 소켓의 close 이벤트가 죽었어야 할 재접속을 되살려, 아무도 닫지 않는
     // 유령 소켓이 탭 수명 내내 남는다.
+    if (!sceneId) return
+    // 다른 씬의 값이 남아 있으면 새 씬의 스냅숏이 오기 전 한순간 엉뚱한 id 를 그린다
+    setValues(new Map())
     let cancelled = false
     let ws: WebSocket | null = null
     let retry: ReturnType<typeof setTimeout> | null = null
@@ -20,7 +25,7 @@
     const connect = () => {
       if (cancelled) return
       const proto = location.protocol === "https:" ? "wss" : "ws"
-      ws = new WebSocket(`${proto}://${location.host}/ws`)
+      ws = new WebSocket(`${proto}://${location.host}/ws?scene=${encodeURIComponent(sceneId)}`)
 
       ws.onopen = () => setConnected(true)
 
@@ -48,7 +53,7 @@
       if (retry) clearTimeout(retry)
       ws?.close()
     }
-  }, [])
+  }, [sceneId])
 
   return { values, connected }
 }
--- a/web/src/App.tsx
+++ b/web/src/App.tsx
@@ -1,5 +1,5 @@
 import { useEffect, useRef, useState } from "react"
-import { useScene } from "./scene.ts"
+import { useScene, useSceneList } from "./scene.ts"
 import { useValues } from "./useValues.ts"
 import AlertBar from "./AlertBar.tsx"
 import Modal from "./Modal.tsx"
@@ -27,9 +27,10 @@
 /** `?layout=stair` 로 계단 배치에서 시작한다. 헤드리스 스크린샷(tools/shot.mjs)은
  *  버튼을 못 누르므로 확인용이다. 이것도 IDLE_RESET_MS 뒤에는 기본으로 돌아간다 */
 const START_MODE: LayoutMode = params.get("layout") === "stair" ? "stair" : "stack"
-const SHOW_FPS = params.has("fps")
+/** 씬 버튼에 쓰는 짧은 이름. 목록에 없는 id 는 씬 이름을 그대로 쓴다 */
+const SCENE_SHORT: Record<string, string> = { small: "소형", large: "대형" }
 
-/** `?fps` 일 때만 구석에 뜬다. 성능 측정용 (스펙 6장) */
+/** 늘 왼쪽 아래에 뜬다. 대형 씬에서 버벅이는지 바로 보이게 */
 function Fps({ engine }: { engine: Engine | undefined }) {
   const [fps, setFps] = useState(0)
   useEffect(() => {
@@ -41,8 +42,14 @@
 }
 
 export default function App() {
-  const { data, error } = useScene()
-  const { values, connected } = useValues()
+  const { list, error: listError } = useSceneList()
+  // 고른 씬. 아직 안 골랐으면 URL 의 ?scene= (목록에 있을 때), 아니면 허브의 기본 씬
+  const [picked, setPicked] = useState<string | null>(null)
+  const urlScene = params.get("scene")
+  const sceneId = picked
+    ?? (list ? (list.scenes.some((s) => s.id === urlScene) ? urlScene : list.default) : null)
+  const { data, error } = useScene(sceneId)
+  const { values, connected } = useValues(sceneId)
   const [selection, setSelection] = useState<Selection>(null)
   const [ctx, setCtx] = useState<ViewerCtx | null>(null)
   const [mode, setMode] = useState<LayoutMode>(START_MODE)
@@ -70,7 +77,7 @@
     }
   }, [mode])
 
-  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
+  if (listError || error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {listError ?? error}</p>
   if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>
 
   const goTo = (seg: Segment) => {
@@ -83,6 +90,17 @@
     camRef.current?.flyTo(mid)
   }
 
+  // 씬 전환. 선택(모달)은 비운다 — 다른 씬의 id 가 남으면 안 된다. URL 에 남겨
+  // 새로고침·링크 공유에도 그 씬이 뜨게 한다. 층 배치 모드는 그대로 둔다
+  const other = list && list.scenes.length > 1 ? list.scenes.find((s) => s.id !== sceneId) : undefined
+  const switchScene = (id: string) => {
+    const q = new URLSearchParams(location.search)
+    q.set("scene", id)
+    history.replaceState(null, "", `?${q}`)
+    setSelection(null)
+    setPicked(id)
+  }
+
   const goSection = (id: string) => {
     const sec = data.scene.sections.find((s) => s.id === id)
     if (!sec) return
@@ -122,8 +140,13 @@
           }}
         />
         <Labels ctx={ctx} scene={data.scene} values={values} mode={mode} onSection={goSection} />
-        {SHOW_FPS && <Fps engine={ctx?.engine} />}
+        <Fps engine={ctx?.engine} />
         <div className="viewer-controls">
+          {other && (
+            <button className="wide" title={`${other.name} 보기`} onClick={() => switchScene(other.id)}>
+              {SCENE_SHORT[other.id] ?? other.name}
+            </button>
+          )}
           <button title="왼쪽으로 회전" onClick={() => camRef.current?.rotate(-1)}>⟲</button>
           <button title="오른쪽으로 회전" onClick={() => camRef.current?.rotate(1)}>⟳</button>
           <button title="전체보기" onClick={() => camRef.current?.home()}>⌂</button>
--- a/web/src/styles.css
+++ b/web/src/styles.css
@@ -13,6 +13,8 @@
   background: #171b22; color: #e6e8eb; font-size: 16px; cursor: pointer;
 }
 .viewer-controls button:hover { background: #222833; }
+/* 씬 전환처럼 글자가 들어가는 버튼 */
+.viewer-controls button.wide { width: auto; padding: 0 10px; font-size: 13px; }
 .offline {
   position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
   background: #4a2020; border: 1px solid #7a3030; padding: 6px 12px; border-radius: 6px; z-index: 10;
````

- [ ] **Step 3: 타입체크·빌드**

Run: `cd web && npx tsc --noEmit && npm run build 2>&1 | grep "index-.*\.js"`
Expected: tsc 출력 없음, gzip 약 314KB.

- [ ] **Step 4: 두 씬을 찍는다**

```bash
(cd hub && WEB_DIR=../web/dist PORT=8096 node_modules/.bin/tsx src/index.ts > /tmp/h.log 2>&1 &); sleep 6
timeout 120 node tools/shot.mjs "http://localhost:8096/" /tmp/sw-default.png 3000
timeout 120 node tools/shot.mjs "http://localhost:8096/?scene=small" /tmp/sw-small.png 3000
timeout 120 node tools/shot.mjs "http://localhost:8096/?scene=old" /tmp/sw-bad.png 3000
kill $(lsof -t -i:8096 -sTCP:LISTEN)
```

Expected (124 로 끝난 것은 다시 찍는다): 기본 = 대형 씬, 오른쪽 아래 맨 앞 버튼 "소형", 왼쪽 아래 fps. `?scene=small` = 작은 씬, 버튼 "대형". `?scene=old` = 대형 씬 (기본으로 떨어진다).

- [ ] **Step 5: 문서**

`README.md`:
- `## 개발 실행` 의 허브 줄 다음에 한 문단: "허브는 작은 씬(`scene.json`)과 대형 씬(`scene.large.json`)을 함께 돌린다. 화면 오른쪽 아래 맨 앞 버튼(소형/대형)으로 오가고, 고른 씬은 URL `?scene=small|large` 에 남는다. 기본은 대형. `SCENE=...` 을 주면 그 씬 하나만 돌고 버튼은 없다."
- `## 대형 씬 (5층 네트워크)` 의 `SCENE=../scene.large.json npm start` 줄을 `npm start                          # 기본이 대형 씬이다` 로.
- URL 파라미터 문단의 `` `?fps`(구석에 fps) `` 를 지우고, 문단 끝에 "fps 는 늘 왼쪽 아래에 보인다." 를 더한다.
- `## 성능` 의 측정 방법이 `?fps` 를 말하면 지운다.
- 테스트 수 `115개` → `121개`.

`docs/BROWSER-CHECKLIST.md` 맨 끝:

```markdown

## 데모 씬 전환

| # | 할 일 | 보여야 하는 것 |
|---|---|---|
| 1 | 허브를 `SCENE` 없이 띄우고 연다 | 대형 씬, 왼쪽 아래 fps, 오른쪽 아래 맨 앞 "소형" |
| 2 | "소형" | 작은 씬, URL `?scene=small`, 버튼이 "대형" |
| 3 | 새로고침 | 작은 씬 그대로 |
| 4 | 구간 모달을 연 채 씬 버튼 | 모달이 닫히고, 새 씬에 옛 씬의 라벨·신호등이 안 남는다 |
| 5 | 계단 배치로 둔 채 씬 버튼 | 새 씬도 계단 배치 |
| 6 | `SCENE=../scene.json` 으로 띄운다 | 씬 버튼이 없다 |
| 7 | `?scene=old` 로 연다 | 기본(대형) 씬 |
```

- [ ] **Step 6: 커밋**

```bash
git add web/src README.md docs/BROWSER-CHECKLIST.md
git commit -m "feat(web): 소형·대형 씬 전환 버튼, fps 는 늘 보인다

고른 씬은 URL ?scene= 에 남는다. 씬을 바꾸면 값·모달을 비우고 새 소켓으로
붙는다. 층 배치 모드는 그대로.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
