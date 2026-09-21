import type { SegState, TagValue } from "../../shared/types.ts"

/** 클릭 대상. geom.ts 가 사라졌으므로 여기가 새 집이다 */
export type Selection = { kind: "section" | "equipment" | "segment"; id: string } | null

export const STATE_LABEL: Record<SegState, string> = {
  running: "가동", stalled: "정지", idle: "대기", unknown: "불명",
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

/** "3:12" 꼴 */
export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
