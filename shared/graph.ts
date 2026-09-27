import type { Scene } from "./types.ts"

/**
 * 구간 id → 하류 구간 id 들. 씬의 `next` 가 연결의 유일한 출처다 (스키마 v4).
 * 예전에는 끝점 좌표가 같으면 이어진 것으로 추론했지만, 손으로 그린 현장 씬은
 * 끝점이 정확히 안 맞는다 — 설비를 사이에 둔 두 구간이 흔한 예다.
 */
export function downstream(scene: Scene): Map<string, string[]> {
  return new Map(scene.segments.map((s) => [s.id, s.next ?? []]))
}

export type Topo = { order: string[] } | { cycle: string[] }

/**
 * 위상 순서(상류가 먼저). 순환이 있으면 순서 대신 순환에서 빠져나오지 못한
 * 구간들(순환 자신과 그 하류)을 준다 — 부팅 에러 메시지가 어디를 고쳐야 하는지
 * 말할 수 있어야 한다. 없는 id 를 가리키는 연결은 무시한다(검증기가 따로 잡는다).
 */
export function topoOrder(down: Map<string, string[]>): Topo {
  const indeg = new Map<string, number>([...down.keys()].map((id) => [id, 0]))
  for (const ds of down.values())
    for (const d of ds) if (indeg.has(d)) indeg.set(d, indeg.get(d)! + 1)
  const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const d of down.get(id) ?? []) {
      if (!indeg.has(d)) continue
      const n = indeg.get(d)! - 1
      indeg.set(d, n)
      if (n === 0) queue.push(d)
    }
  }
  if (order.length === down.size) return { order }
  const done = new Set(order)
  return { cycle: [...down.keys()].filter((id) => !done.has(id)) }
}
