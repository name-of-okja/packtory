import { useEffect, useState } from "react"
import type { TagValue, WsMessage } from "../../shared/types.ts"

const RECONNECT_MS = 3000

export function useValues() {
  const [values, setValues] = useState<Map<string, TagValue>>(new Map())
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // 취소 플래그는 effect 실행마다 새로 만든다. useRef 로 공유하면
    // StrictMode 의 mount→cleanup→mount 가 같은 틱에 돌면서 두 번째 마운트가
    // 첫 cleanup 이 세운 플래그를 되돌린다. 그 뒤 (항상 비동기로) 도착하는
    // 첫 소켓의 close 이벤트가 죽었어야 할 재접속을 되살려, 아무도 닫지 않는
    // 유령 소켓이 탭 수명 내내 남는다.
    let cancelled = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return
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
        if (!cancelled) retry = setTimeout(connect, RECONNECT_MS)
      }

      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [])

  return { values, connected }
}
