import type { Quality, SegState, Segment, TagValue, Value } from "../../shared/types.ts"

export type SegMemory = {
  lastIn: number
  lastOut: number
  lastOutChangeTs: number
}

export type ValueMap = Map<string, { v: Value; q: Quality }>

/**
 * WIP. counterMax 가 있으면 모듈러 산술로 구한다 — 랩어라운드 뒤에도 맞아야 하므로.
 *
 * 모듈러 차분은 w 와 w - m 사이에서 모호하다 — in/out 이 다른 PLC 레지스터라
 * 스캔 한 번에 out 이 in 을 한 칸 앞서는 것(raw = -1)이 평범하고, wipOffset 을
 * 맞추는 사이에도 카운터가 움직이므로 한두 칸 넘기는 것도 예상된 일이다.
 * 그때 raw % m 은 m-1 에 가까운 큰 양수가 되어 "거의 꽉 찬 채 정지"로 오판된다.
 * 실제 WIP 는 모듈러스의 절반에 근접할 수 없으므로(씬의 capacity 는 수십 이하)
 * 상위 절반을 음의 차분으로 보고 0 으로 접는다.
 */
function wipOf(seg: Segment, inN: number, outN: number): number {
  const raw = inN - outN + (seg.wipOffset ?? 0)
  if (seg.counterMax === undefined) return Math.max(0, raw)
  const m = seg.counterMax + 1
  const w = ((raw % m) + m) % m
  return w > m / 2 ? 0 : w
}

/** 정상이면 델타(>= 0), 재기준선이 필요하면 null */
function delta(v: number, last: number, counterMax?: number): number | null {
  if (v >= last) return v - last
  if (counterMax !== undefined) {
    const m = counterMax + 1
    return (v - last + m) % m
  }
  return null // counterMax 를 모르는 채 역행 = PLC 재기동으로 간주
}

function emit(
  id: string, wip: number, state: SegState, stallMs: number, ts: number, q: Quality,
): TagValue[] {
  return [
    { tag: `${id}.wip`, v: wip, ts, q },
    { tag: `${id}.state`, v: state, ts, q },
    { tag: `${id}.stallMs`, v: stallMs, ts, q },
  ]
}

export function derive(
  segments: Segment[],
  values: ValueMap,
  prev: Map<string, SegMemory>,
  now: number,
  stallSec: number,
): { tags: TagValue[]; next: Map<string, SegMemory> } {
  const next = new Map(prev)
  const tags: TagValue[] = []

  for (const seg of segments) {
    const inV = values.get(`${seg.id}.in`)
    const outV = values.get(`${seg.id}.out`)

    const bad =
      !inV || !outV ||
      inV.q === "bad" || outV.q === "bad" ||
      typeof inV.v !== "number" || typeof outV.v !== "number"

    if (bad) {
      tags.push(...emit(seg.id, 0, "unknown", 0, now, "bad"))
      continue
    }

    const inN = inV.v as number
    const outN = outV.v as number
    const mem = prev.get(seg.id)

    // 첫 관측 (또는 허브 재기동 직후): 기준선만 잡는다.
    // stallSec 동안 running 으로 보이지만 스스로 복구되므로 디스크에 남기지 않는다.
    if (!mem) {
      next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs: now })
      tags.push(...emit(seg.id, wipOf(seg, inN, outN), "running", 0, now, "good"))
      continue
    }

    const dIn = delta(inN, mem.lastIn, seg.counterMax)
    const dOut = delta(outN, mem.lastOut, seg.counterMax)

    if (dIn === null || dOut === null) {
      next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs: now })
      tags.push(...emit(seg.id, 0, "unknown", 0, now, "bad"))
      continue
    }

    const lastOutChangeTs = dOut > 0 ? now : mem.lastOutChangeTs
    next.set(seg.id, { lastIn: inN, lastOut: outN, lastOutChangeTs })

    const wip = wipOf(seg, inN, outN)
    const since = now - lastOutChangeTs

    let state: SegState
    let stallMs: number
    if (since < stallSec * 1000) {
      state = "running"
      stallMs = 0
    } else if (wip > 0) {
      state = "stalled"
      stallMs = since
    } else {
      // 물건이 안 들어와서 안 도는 것은 사고가 아니다. 여기서 빨강을 쓰지 않는 것이
      // 이 제품의 값어치다 — 빨강이 흔해지면 아무도 화면을 안 본다.
      state = "idle"
      stallMs = 0
    }

    tags.push(...emit(seg.id, wip, state, stallMs, now, "good"))
  }

  return { tags, next }
}
