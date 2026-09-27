import type { Endpoint, Scene } from "./types.ts"

const key = (e: Endpoint) => `${e.floor}:${e.x}:${e.y}`

/**
 * 구간 id → 하류 구간 id 들. X 의 to 와 Y 의 from 이 같은 층·같은 좌표면
 * X → Y 로 이어진 것이다. 스키마에 연결 필드가 없으므로(하위 프로젝트 B 에서
 * 넣는다) 끝점 일치가 연결의 유일한 근거다 — 생성기가 이어지는 끝점을 정확히
 * 같은 값으로 찍는다.
 */
export function downstream(scene: Scene): Map<string, string[]> {
  const byFrom = new Map<string, string[]>()
  for (const s of scene.segments) {
    const k = key(s.from)
    byFrom.set(k, [...(byFrom.get(k) ?? []), s.id])
  }
  return new Map(scene.segments.map((s) => [s.id, byFrom.get(key(s.to)) ?? []]))
}

/** 위상 순서(상류가 먼저). 순환이 있으면 null */
export function topoOrder(down: Map<string, string[]>): string[] | null {
  const indeg = new Map<string, number>([...down.keys()].map((id) => [id, 0]))
  for (const ds of down.values()) for (const d of ds) indeg.set(d, (indeg.get(d) ?? 0) + 1)
  const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id)
  const out: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    out.push(id)
    for (const d of down.get(id) ?? []) {
      const n = indeg.get(d)! - 1
      indeg.set(d, n)
      if (n === 0) queue.push(d)
    }
  }
  return out.length === down.size ? out : null
}
