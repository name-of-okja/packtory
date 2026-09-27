import type { SegState, TagValue } from "../../shared/types.ts"

/**
 * WIP 가 capacity 의 이만큼 이상이면 "꽉 참" 으로 본다. 딱 capacity 로 잡으면 정체
 * 구간이 물건 하나를 내보내 한 칸 빈 순간(판정 한 번, 0.5초)마다 그 상류가 원인으로
 * 깜빡인다 (실측). 정상 가동 중 WIP 는 capacity 의 35% 안팎이라 헷갈리지 않는다.
 */
const FULL_RATIO = 0.8

export type Classified = { state: SegState; root: string }

/**
 * derive 가 낸 state 를 연결을 따라 다시 나눈다 (스펙 6장). stalled 만 바뀐다:
 * 하류가 전부 **기다리게 하는 상태**(stalled·blocked, 또는 꽉 참 — `full`)면 blocked(영향),
 * 아니면 stalled(원인 — 하류에 여지가 있는데 못 내보낸다). 출구가 stalled 면 원인이다.
 *
 * 꽉 찬 하류를 기다림으로 치는 이유: 막힘이 번진 망에서 합류점 아래 구간은 꽉 찬
 * 채 조금씩은 움직여 running 으로 보인다. 그 자리를 여러 상류가 다투면 몫이 적은
 * 상류는 stallSec 넘게 못 내보낸다 — running 인 하류만 보고 원인이라 하면 막힘과
 * 무관한 곳에 빨강이 뜬다 (실측: 대형 씬 20분에 수십 번). 꽉 찬 running 구간은 자기
 * 하류에서 원인을 물려받아 위로 전한다.
 *
 * 하류가 unknown 이면 기다리는 중이라고 증명할 수 없으므로 원인으로 둔다 — 센서가
 * 끊긴 하류 때문에 멈춘 것처럼 보이는 구간을 노랑으로 숨기면 안 된다. 하류가
 * idle(비어서 쉼)인데 이 구간이 꽉 찬 채 멈췄다면 고장은 그 사이에 있다 — 원인이다.
 *
 * 한 줄에 원인이 둘이면 상류 쪽은 영향으로 보인다. 하류가 막혀 있는 동안 상류가
 * 따로 고장인지 카운터만으로는 가를 수 없다. 하류가 풀리면 드러난다.
 */
export function classify(
  down: Map<string, string[]>,
  order: string[],
  states: Map<string, SegState>,
  stallMs: Map<string, number>,
  full: Set<string>,
): Map<string, Classified> {
  const out = new Map<string, Classified>()
  // 꽉 찬 running 구간이 물려받은 원인. 밖으로 내보내지 않는다 — 초록은 초록이다
  const carried = new Map<string, string>()
  // 하류부터 — 구간을 볼 때 하류의 분류가 이미 끝나 있다
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    const st = states.get(id) ?? "unknown"
    const ds = down.get(id) ?? []

    // 하류가 전부 기다리게 하는가, 그렇다면 그중 가장 오래 멈춘 원인은
    let waiting = ds.length > 0
    let root = ""
    let longest = -1
    for (const d of ds) {
      const c = out.get(d)
      const holds = c && (c.state === "stalled" || c.state === "blocked" || (c.state === "running" && full.has(d)))
      if (!holds) { waiting = false; break }
      // 하류가 원인이면 하류 자신, 영향이면 하류가 기다리는 원인, 꽉 찬 running 이면 물려받은 원인
      const r = c.state === "stalled" ? d : c.state === "blocked" ? c.root : carried.get(d) ?? ""
      const ms = r ? stallMs.get(r) ?? 0 : -1
      if (ms > longest) { longest = ms; root = r }
    }

    if (st === "stalled" && waiting) out.set(id, { state: "blocked", root })
    else out.set(id, { state: st, root: "" })
    if (st === "running" && full.has(id) && waiting && root) carried.set(id, root)
  }
  return out
}

/**
 * derive 의 출력 태그에 분류를 입힌다: `.state` 를 분류 결과로 바꾸고, 구간마다
 * `.root`(원인 구간 id, 해당 없으면 "")를 더한다. 허브 판정 타이머가 부른다.
 * `capacity` 는 구간 id → capacity (씬에 없으면 20 — 화면·mock 과 같은 기본값).
 * 꽉 참의 기준은 FULL_RATIO 다.
 */
export function withCause(
  tags: TagValue[], down: Map<string, string[]>, order: string[], capacity: Map<string, number>,
): TagValue[] {
  const states = new Map<string, SegState>()
  const stallMs = new Map<string, number>()
  const full = new Set<string>()
  const stateTag = new Map<string, TagValue>()
  for (const t of tags) {
    const dot = t.tag.lastIndexOf(".")
    const id = t.tag.slice(0, dot)
    const key = t.tag.slice(dot + 1)
    if (key === "state") { states.set(id, t.v as SegState); stateTag.set(id, t) }
    else if (key === "stallMs") stallMs.set(id, t.v as number)
    else if (key === "wip" && (t.v as number) >= (capacity.get(id) ?? 20) * FULL_RATIO) full.add(id)
  }
  const c = classify(down, order, states, stallMs, full)
  const out = tags.map((t) => {
    if (!t.tag.endsWith(".state")) return t
    const cl = c.get(t.tag.slice(0, -".state".length))
    return cl ? { ...t, v: cl.state } : t
  })
  for (const [id, cl] of c) {
    const st = stateTag.get(id)
    if (st) out.push({ tag: `${id}.root`, v: cl.root, ts: st.ts, q: st.q })
  }
  return out
}
