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
    // new URL 은 HTTP 파서가 받아 준 절대형 대상(`GET http://[`)에도 던진다. async
    // 핸들러라 못 잡으면 unhandled rejection 으로 프로세스가 죽는다 — 아래 정적 서빙의
    // decodeURIComponent 와 같은 이유로 감싼다.
    let url: URL
    try {
      url = new URL(req.url ?? "/", "http://hub")
    } catch {
      res.writeHead(400).end()
      return
    }
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
