import type { SegState, TagValue } from "../../shared/types.ts"

/** 클릭 대상. geom.ts 가 사라졌으므로 여기가 새 집이다 */
export type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null

export const STATE_LABEL: Record<SegState, string> = {
  running: "가동", stalled: "정지", blocked: "영향", idle: "대기", unknown: "불명",
}

export function segState(id: string, values: Map<string, TagValue>): SegState {
  const v = values.get(`${id}.state`)
  return (typeof v?.v === "string" ? v.v : "unknown") as SegState
}

export function segWip(id: string, values: Map<string, TagValue>): number {
  const v = values.get(`${id}.wip`)
  return typeof v?.v === "number" ? v.v : 0
}

export function segStallMs(id: string, values: Map<string, TagValue>): number {
  const v = values.get(`${id}.stallMs`)
  return typeof v?.v === "number" ? v.v : 0
}

/**
 * 멀리서 보기에도 신호등을 세울 상태. 정지(사고)뿐 아니라 불명(센서 값이 끊김)도
 * 세운다 — 전체보기에서 끊긴 구간이 초록과 함께 사라지면 아무도 모른다.
 * 웹소켓 끊김 배너는 허브와의 연결만 말하지 PLC 하나가 끊긴 것은 말하지 않는다.
 */
export function lampVisibleFar(st: SegState): boolean {
  return st === "stalled" || st === "unknown"
}

/** "3:12" 꼴 */
export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
