import type { Scene, Segment, Value } from "../../../shared/types.ts"
import { downstream, topoOrder } from "../../../shared/graph.ts"
import { rng } from "../../../shared/rng.ts"
import type { Adapter, Emit } from "../adapter.ts"

const TICK_MS = 100
/** 한 틱을 이만큼씩 쪼개 흘린다. 물건은 한 단계에 한 구간만 지나므로 한 구간을
 *  단계당 capacity 개까지만 지날 수 있다 — 틱 단위로 흘리면 1F 출고 분배선처럼
 *  하강 리프트 여섯 대가 모이는 짧은 구간이 초당 50개에서 막혀 망 전체가 선다(실측) */
const STEP_MS = 25
/** 막힘·도크 휴무 각본을 새로 뽑는 주기 */
const CYCLE_MS = 120_000
/** 정상 가동 유량이 처리 속도의 이만큼이 되게 한다. 남는 30% 가 막힘이 풀린 뒤
 *  적체를 스스로 빼낸다 */
const TARGET_LOAD = 0.7
/** 구간별 처리 속도 흔들림. TARGET_LOAD / (1 - JITTER) 가 1 미만이어야
 *  랜덤만으로 빨강이 생기지 않는다 */
const JITTER = 0.1
/** 모든 구간이 정상 가동 중 최소한 이만큼(개/초)은 흐르게 한다. 드문드문 흐르는
 *  구간은 물건 사이 간격이 stallSec 을 넘을 때마다 회색(idle)으로 깜빡인다 */
const MIN_FLOW = 0.2
/** 물건이 구간을 지나는 시간 = capacity / r × 이 값. 정상 가동 중 WIP 가
 *  대략 capacity × TARGET_LOAD × 이 값 — 화면에 물건이 적당히 보인다 */
const TRANSIT_FACTOR = 0.5
/** 지나는 시간 상한. 한산한 구간은 위 식이 수십 초가 된다 */
const MAX_TRANSIT_MS = 2000
/** 생성할 때 미리 돌려두는 시간. 빈 공장에서 시작하면 30단계 깊이의 망이
 *  채워지는 1분 남짓 동안 물건이 안 닿은 구간이 줄줄이 idle 로 보인다. 실제
 *  허브 재시작 때 라인은 이미 돌고 있다 */
const WARMUP_MS = 120_000

export type Block = { id: string; fromMs: number; toMs: number }

export type MockOptions = {
  now?: () => number
  /** 사건 순서의 시드. 공장 모양의 시드(생성기)와 별개다 */
  seed?: number
  /** 테스트용: 막힘 각본을 직접 준다. 없으면 주기마다 시드로 뽑는다 */
  blocks?: Block[]
  /** 테스트용: false 면 도크 휴무가 없다 */
  dockBreaks?: boolean
}

type Plan = { blocks: Block[]; breaks: Map<string, [number, number]> }
/** 워밍업 동안의 각본: 막힘도 휴무도 없다 */
const NO_PLAN: Plan = { blocks: [], breaks: new Map() }

type Sim = {
  seg: Segment
  down: Sim[]
  source: boolean
  r: number
  cap: number
  transitMs: number
  /** 구간 안 물건들이 나갈 수 있게 되는 시각 (들어온 순서) */
  ready: number[]
  in: number
  out: number
  acc: number
  /** 도크 유입 누적기 (source 만 쓴다) */
  accIn: number
  /** 정상 가동 목표 유량 (개/초). 분기에서 하류 몫을 나누는 기준 */
  flow: number
  /** 이 구간이 하류로 지금까지 보낸 수. 몫보다 뒤처진 하류부터 보낸다 */
  sent: Map<Sim, number>
}

/**
 * 전파 모의 어댑터 (스펙 5장). 구간의 out 이 하류 구간의 in 이 된다.
 * 하류에 빈자리가 없으면 못 내보내므로 막힘이 상류로 번지고, 막힌 곳에서만
 * 받는 하류는 굶어 빈다. 판정 로직을 흉내내지 않고 원인만 만든다 — 여기서
 * state 를 직접 쓰면 derive.ts 는 데모에서 한 번도 실행되지 않는다.
 */
export class MockAdapter implements Adapter {
  private sims: Sim[]
  /** 하류부터 (위상 역순). 같은 틱 안에 빈자리가 상류로 전파된다 */
  private order: Sim[]
  private sources: Sim[]
  private timer?: NodeJS.Timeout
  private now: () => number
  private seed: number
  private rand: () => number
  private fixedBlocks?: Block[]
  private dockBreaks: boolean
  private plans = new Map<number, Plan>()

  constructor(private scene: Scene, opts: MockOptions = {}) {
    const t0 = Date.now()
    this.now = opts.now ?? (() => Date.now() - t0)
    this.seed = opts.seed ?? 1
    this.rand = rng(this.seed)
    this.fixedBlocks = opts.blocks
    this.dockBreaks = opts.dockBreaks ?? true

    const down = downstream(scene)
    const topo = topoOrder(down)
    if ("cycle" in topo) throw new Error(`모의 어댑터: 구간 연결에 순환이 있다: ${topo.cycle.join(", ")}`)

    const byId = new Map<string, Sim>()
    for (const seg of scene.segments) {
      byId.set(seg.id, {
        seg, down: [], source: true, r: 0, cap: seg.capacity ?? 20, transitMs: 0,
        ready: [], in: 0, out: 0, acc: 0, accIn: 0, flow: 0, sent: new Map(),
      })
    }
    const up = new Map<Sim, Sim[]>([...byId.values()].map((s) => [s, []]))
    for (const [id, ds] of down) {
      const s = byId.get(id)!
      s.down = ds.map((d) => byId.get(d)!)
      for (const d of s.down) { d.source = false; up.get(d)!.push(s) }
    }
    this.sims = topo.order.map((id) => byId.get(id)!)
    this.order = [...this.sims].reverse()
    this.sources = this.sims.filter((s) => s.source)

    // 정상 가동 유량. 분기를 반씩 나누면 뒤로 갈수록 유량이 기하급수로 줄어
    // 천 배 넘게 차이가 난다(실측) — 드문드문 흐르는 구간이 생긴다. 대신 구간마다 source 에서
    // 그 구간을 거쳐 sink 까지 가는 경로 하나에 MIN_FLOW 를 흘려 더한다 —
    // 경로 합이라 모든 합류·분기점에서 들어온 양 = 나간 양이 저절로 맞고,
    // 모든 구간이 MIN_FLOW 이상 흐른다.
    // 경로의 이웃은 지금까지 가장 덜 쓰인 쪽으로 고른다. 늘 첫 이웃을 고르면
    // 모든 경로가 도크 하나로 몰리고, 무작위로 골라도 간선 몇 곳에 몰려 한
    // 틱에 capacity 보다 많이 지나가야 하는 구간이 생긴다 — 거기서 망 전체가 막힌다.
    const pick = (xs: Sim[]) => xs.reduce((a, b) => (b.flow < a.flow ? b : a))
    for (const s of this.sims) {
      let c = s
      c.flow += MIN_FLOW
      while (up.get(c)!.length) { c = pick(up.get(c)!); c.flow += MIN_FLOW }
      c = s
      while (c.down.length) { c = pick(c.down); c.flow += MIN_FLOW }
    }
    // 처리 속도는 유량이 TARGET_LOAD 가 되게. 흔들림을 줘도 1 을 안 넘는다
    for (const s of this.sims) {
      s.r = (s.flow / TARGET_LOAD) * (1 - JITTER + 2 * JITTER * this.rand())
      s.transitMs = Math.min((s.cap / s.r) * TRANSIT_FACTOR * 1000, MAX_TRANSIT_MS)
      for (const d of s.down) s.sent.set(d, 0)
    }

    for (let t = -WARMUP_MS; t < 0; t += STEP_MS) this.step(t, NO_PLAN)
  }

  /** 주기마다 막힘과 도크 휴무를 새로 뽑는다. 같은 시드·같은 주기면 같은 각본 */
  private planFor(cycle: number): Plan {
    let p = this.plans.get(cycle)
    if (p) return p
    const r = rng(this.seed * 1_000_003 + cycle)
    const blocks: Block[] = []
    if (!this.fixedBlocks) {
      // 상류가 2단계 이상인 구간만 — 적체가 거슬러 번지는 모습이 보여야 한다
      const candidates = this.sims.filter((s) => !s.source && !this.sims
        .filter((u) => u.down.includes(s)).every((u) => u.source))
      const k = Math.max(1, Math.ceil(this.sims.length / 150))
      for (let i = 0; i < k && candidates.length; i++) {
        const pick = candidates.splice(Math.floor(r() * candidates.length), 1)[0]
        const dur = 30_000 + r() * 60_000
        const start = r() * (CYCLE_MS - dur)
        blocks.push({ id: pick.seg.id, fromMs: cycle * CYCLE_MS + start, toMs: cycle * CYCLE_MS + start + dur })
      }
    }
    const breaks = new Map<string, [number, number]>()
    if (this.dockBreaks) {
      for (const s of this.sources) {
        if (r() < 0.5) continue // 절반의 도크만 이번 주기에 쉰다
        const dur = 20_000 + r() * 30_000
        const start = r() * (CYCLE_MS - dur)
        breaks.set(s.seg.id, [cycle * CYCLE_MS + start, cycle * CYCLE_MS + start + dur])
      }
    }
    p = { blocks, breaks }
    this.plans.set(cycle, p)
    this.plans.delete(cycle - 2)
    return p
  }

  private isBlocked(id: string, t: number, plan: Plan): boolean {
    const list = plan === NO_PLAN ? [] : this.fixedBlocks ?? plan.blocks
    return list.some((b) => b.id === id && t >= b.fromMs && t < b.toMs)
  }

  /** 한 틱. 테스트가 시계를 직접 돌릴 수 있도록 public. */
  tick(emit: Emit) {
    const t = this.now()
    const ts = Date.now()
    const plan = this.planFor(Math.floor(t / CYCLE_MS))
    for (let k = 0; k < TICK_MS; k += STEP_MS) this.step(t - TICK_MS + STEP_MS + k, plan)

    // counterMax 가 있으면 실제 PLC처럼 그 값에서 한 바퀴 돈다
    for (const s of this.sims) {
      const max = s.seg.counterMax
      const wrap = (v: number) => (max === undefined ? v : v % (max + 1))
      emit(`${s.seg.id}.in`, wrap(s.in), ts)
      emit(`${s.seg.id}.out`, wrap(s.out), ts)
    }

    for (const e of this.scene.equipment) {
      for (const tag of e.tags) {
        const mid = tag.warn ? tag.warn * 0.85 : 50
        const swing = mid * 0.25
        const v = mid + swing * Math.sin(t / 7000) + (this.rand() - 0.5) * swing * 0.2
        emit(`${e.id}.${tag.key}`, Math.round(v * 10) / 10 as Value, ts)
      }
    }
  }

  /** 한 단계(STEP_MS). 시각 t 는 모의 시계 기준이다 */
  private step(t: number, plan: Plan) {
    const dt = STEP_MS / 1000

    // 1. 하류부터 내보낸다. 받을 자리가 없으면 못 내보낸다 → 막힘이 번진다.
    for (const s of this.order) {
      s.acc += s.r * dt
      let n = Math.floor(s.acc)
      // 쓰지 못한 처리 능력은 쌓아두지 않는다 — 막힌 동안의 몫을 풀린 뒤
      // 한꺼번에 쏟아내면 안 된다
      s.acc -= n
      if (this.isBlocked(s.seg.id, t, plan)) continue
      while (n-- > 0 && s.ready.length && s.ready[0] <= t) {
        // 자기 몫(flow)보다 가장 뒤처진 하류부터, 빈자리가 있는 곳으로
        let target: Sim | null = null
        for (const d of s.down) {
          if (d.ready.length >= d.cap) continue
          if (!target || s.sent.get(d)! / d.flow < s.sent.get(target)! / target.flow) target = d
        }
        if (s.down.length && !target) break
        s.ready.shift()
        s.out++
        if (target) {
          target.ready.push(t + target.transitMs)
          target.in++
          s.sent.set(target, s.sent.get(target)! + 1)
        }
      }
    }

    // 2. 도크로 들어온다. 휴무 중이거나 도크가 꽉 찼으면 안 들어온다
    for (const s of this.sources) {
      const br = plan.breaks.get(s.seg.id)
      if (br && t >= br[0] && t < br[1]) continue
      s.accIn += s.flow * dt
      while (s.accIn >= 1) {
        s.accIn -= 1
        if (s.ready.length >= s.cap) continue
        s.ready.push(t + s.transitMs)
        s.in++
      }
    }
  }

  async start(emit: Emit) {
    this.tick(emit)
    this.timer = setInterval(() => this.tick(emit), TICK_MS)
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
  }
}
