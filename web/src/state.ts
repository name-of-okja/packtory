import type { Scene, SegState, TagValue } from "../../shared/types.ts"

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

/** 영향(blocked) 구간이 기다리는 원인 구간 id. 해당 없으면 "" */
export function segRoot(id: string, values: Map<string, TagValue>): string {
  const v = values.get(`${id}.root`)
  return typeof v?.v === "string" ? v.v : ""
}

/**
 * 멀리서 보기에도 신호등을 세울 상태. 원인(빨강)·영향(노랑)과 불명(센서 값이
 * 끊김)이다 — 노랑 기둥이 막힘이 번진 범위를, 빨강이 그 끝을 보여준다. 불명을
 * 세우는 이유: 전체보기에서 끊긴 구간이 초록과 함께 사라지면 아무도 모른다.
 * 웹소켓 끊김 배너는 허브와의 연결만 말하지 PLC 하나가 끊긴 것은 말하지 않는다.
 */
export function lampVisibleFar(st: SegState): boolean {
  return st === "stalled" || st === "blocked" || st === "unknown"
}

/** 원인 구간 id → 그 원인 때문에 멈춘 영향 구간 수 */
export function affectedCounts(scene: Scene, values: Map<string, TagValue>): Map<string, number> {
  const n = new Map<string, number>()
  for (const g of scene.segments) {
    if (segState(g.id, values) !== "blocked") continue
    const r = segRoot(g.id, values)
    if (r) n.set(r, (n.get(r) ?? 0) + 1)
  }
  return n
}

export type SectionSummary = { stalled: number; blocked: number }

/** 구역 id → 원인·영향 구간 수. 구역마다 항목이 있다 (없으면 0) */
export function sectionSummary(scene: Scene, values: Map<string, TagValue>): Map<string, SectionSummary> {
  const m = new Map<string, SectionSummary>(scene.sections.map((s) => [s.id, { stalled: 0, blocked: 0 }]))
  for (const g of scene.segments) {
    const st = segState(g.id, values)
    const s = m.get(g.section)
    if (!s) continue
    if (st === "stalled") s.stalled++
    else if (st === "blocked") s.blocked++
  }
  return m
}

/** "3층 B구역 · 정지 1 · 영향 4" / "2층 A구역 · 영향 6" / "3층 C구역 · 정상" */
export function badgeText(label: string, s: SectionSummary): string {
  if (s.stalled) return `${label} · 정지 ${s.stalled}${s.blocked ? ` · 영향 ${s.blocked}` : ""}`
  if (s.blocked) return `${label} · 영향 ${s.blocked}`
  return `${label} · 정상`
}

/** 배지 색. 원인이 있으면 빨강, 영향만 있으면 노랑 — 원인은 다른 구역에 있다 */
export function badgeTone(s: SectionSummary): "stalled" | "blocked" | "ok" {
  return s.stalled ? "stalled" : s.blocked ? "blocked" : "ok"
}

/**
 * 원인 칩이 하나도 없을 때 막대 문구. 원인 없는 정체(영향만 있음)가 남아 있으면
 * "정상 가동" 이라 하지 않는다 — 신호등은 노랑인데 막대가 정상이라 하면 둘 중 하나는 거짓이다.
 */
export function idleBarText(scene: Scene, values: Map<string, TagValue>): string {
  const n = scene.segments.filter((g) => segState(g.id, values) === "blocked").length
  return n ? `정체 ${n}구간 · 원인 없음` : "정상 가동"
}

/** "3:12" 꼴 */
export function formatStall(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
