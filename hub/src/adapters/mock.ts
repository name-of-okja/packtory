import type { Scene, Segment, Value } from "../../../shared/types.ts"
import type { Adapter, Emit } from "../adapter.ts"

const TICK_MS = 100

/**
 * 데모 각본. 120초 주기로 conv-3 의 out 을 30~90초 동안 멈춘다.
 * 판정 로직을 흉내내지 않고 원인만 만든다 — out 이 멈추면 WIP가 차오르면서
 * 진짜 derive.ts 가 stalled 를 판정한다. 여기서 state 를 직접 쓰면
 * 판정 코드는 데모에서 한 번도 실행되지 않는다.
 */
const BLOCK_PLAN: Record<string, [number, number]> = {
  "conv-3": [30, 90],
}
const BLOCK_CYCLE_S = 120
/**
 * 막힘이 풀렸을 때 out 이 in 보다 몇 배 빠르게 나가 적체를 배출하는지.
 * conv-3 은 60초(30~90초) 막혀 backlog 120개가 쌓인다. 3배면 배출
 * 순유량이 (3-1)×2/s = 4/s 라 120개를 30초 만에 비우고, 다음 막힘
 * (120초 주기의 30초 지점, 즉 지금부터 60초 뒤)까지 30초 여유가 남는다 —
 * 데모가 매 주기 반복 가능해야 하므로 여유를 넉넉히 둔다.
 */
const DRAIN_FACTOR = 3

/** 구간별 목표 처리량 (개/초) */
function rateOf(seg: Segment): number {
  return seg.id.startsWith("lift") ? 0.5 : 2
}

type Counter = { in: number; out: number; accIn: number; accOut: number }

export class MockAdapter implements Adapter {
  private counters = new Map<string, Counter>()
  private timer?: NodeJS.Timeout
  private now: () => number

  constructor(private scene: Scene, opts?: { now?: () => number }) {
    const t0 = Date.now()
    this.now = opts?.now ?? (() => Date.now() - t0)
    for (const seg of scene.segments)
      this.counters.set(seg.id, { in: 0, out: 0, accIn: 0, accOut: 0 })
  }

  private isBlocked(segId: string, elapsedMs: number): boolean {
    const plan = BLOCK_PLAN[segId]
    if (!plan) return false
    const phase = (elapsedMs / 1000) % BLOCK_CYCLE_S
    return phase >= plan[0] && phase < plan[1]
  }

  /** 한 틱. 테스트가 시계를 직접 돌릴 수 있도록 public. */
  tick(emit: Emit) {
    const elapsed = this.now()
    const ts = Date.now()

    for (const seg of this.scene.segments) {
      const c = this.counters.get(seg.id)!
      const per = rateOf(seg) * (TICK_MS / 1000)

      c.accIn += per
      const wIn = Math.floor(c.accIn)
      c.in += wIn
      c.accIn -= wIn

      if (!this.isBlocked(seg.id, elapsed)) {
        // 적체(backlog = in - out)가 있으면 out 을 DRAIN_FACTOR 배로 내보내
        // 배출한다 — 실제 라인도 하류가 밀린 만큼 당겨 쓴다. 그대로 두면(both
        // 2/s) conv-3 의 WIP 가 막힘 해제 뒤에도 영원히 안 줄어든다.
        const backlog = c.in - c.out
        const outPer = backlog > 0 ? per * DRAIN_FACTOR : per
        c.accOut += outPer
        let wOut = Math.floor(c.accOut)
        // out 이 in 을 앞지르면 안 된다 — 들어온 것보다 많이 나갈 수는 없다
        if (wOut > backlog) { wOut = backlog; c.accOut = 0 } else { c.accOut -= wOut }
        c.out += wOut
      }

      // counterMax 가 있으면 실제 PLC처럼 그 값에서 한 바퀴 돈다
      const max = seg.counterMax
      const wrap = (v: number) => (max === undefined ? v : v % (max + 1))
      emit(`${seg.id}.in`, wrap(c.in), ts)
      emit(`${seg.id}.out`, wrap(c.out), ts)
    }

    for (const e of this.scene.equipment) {
      for (const tag of e.tags) {
        const mid = tag.warn ? tag.warn * 0.85 : 50
        const swing = mid * 0.25
        const v = mid + swing * Math.sin(elapsed / 7000) + (Math.random() - 0.5) * swing * 0.2
        emit(`${e.id}.${tag.key}`, Math.round(v * 10) / 10 as Value, ts)
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
