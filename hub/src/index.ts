import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
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
  // 사건 순서의 시드. 공장 모양의 시드(tools/gen-scene.ts)와 별개다 — 같은 공장의
  // 다른 하루를 재생한다. 정수가 아니면 조용히 다른 각본이 돌지 않게 거절한다.
  // 빈 값("MOCK_SEED=")은 Number("") = 0 이라 정수 검사를 통과해 버린다 — 글자로 본다
  const raw = process.env.MOCK_SEED ?? "1"
  if (!/^-?\d+$/.test(raw.trim())) throw new Error(`MOCK_SEED 는 정수여야 한다 (받음: "${raw}")`)
  const seed = Number(raw)
  const hub = await startHub({
    scenePath,
    port: Number(process.env.PORT ?? 8080),
    adapter: new MockAdapter(scene, { seed }),
    go2rtcBase: process.env.GO2RTC_BASE ?? "http://127.0.0.1:1984",
    webDir: process.env.WEB_DIR,
  })
  console.log(`packtory-hub http://127.0.0.1:${hub.port}`)
}
