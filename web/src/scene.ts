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
