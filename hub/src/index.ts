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
