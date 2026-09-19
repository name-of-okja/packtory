import { useEffect, useState } from "react"
import type { SceneResponse } from "../../shared/types.ts"

export function useScene() {
  const [data, setData] = useState<SceneResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/scene")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SceneResponse>
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  return { data, error }
}
