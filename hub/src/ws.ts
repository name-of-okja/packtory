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
