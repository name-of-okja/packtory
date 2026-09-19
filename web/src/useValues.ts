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
