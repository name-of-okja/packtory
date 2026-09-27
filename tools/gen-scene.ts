// 대형 5층 네트워크 씬 생성기 (스펙 4장).
//
//   cd hub && npm run gen:large     (= tsx ../tools/gen-scene.ts --seed 1 > ../scene.large.json)
//
// 같은 시드면 바이트 단위로 같은 출력을 낸다. 공장 모양:
//   1F 입고(남쪽 절반): 도크 8 → 동쪽으로 흐르는 격자 → 동쪽 집하선 → 상승 리프트 6
//   2F~5F: 상승 리프트 도착 → 서쪽으로 흐르는 격자 → 서쪽 집하선 → 하강 리프트 6
//   1F 출고(북쪽 절반): 하강 리프트 도착 → 동쪽으로 흐르는 격자 → 출고 도크 4
//   2F 에는 남쪽 연결 브리지 2곳이 더 들어온다.
//
// 순환이 생기지 않는 이유: 가로줄은 층마다 한 방향으로만 흐르고, 세로줄은
// 한 기둥 안에서 한 방향이다. 가로 이동 없이 돌아오는 순환은 한 세로줄
// 안에서만 가능한데 세로줄은 한 방향이라 불가능하다. 층 사이는 1F 입고 →
// 위층 → 1F 출고 로만 이어진다.
import { pathToFileURL } from "node:url"
import type { Camera, Endpoint, Equipment, Scene, Section, Segment } from "../shared/types.ts"
import { rng } from "../shared/rng.ts"

/** 격자 기둥 x. 구역 경계(100, 200)에 걸리는 값이 없어야 한다 */
const XS = Array.from({ length: 12 }, (_, i) => 10 + 25 * i) // 10 … 285
const WEST = XS[0]
const EAST = XS[XS.length - 1]
const UPPER_ROWS = [15, 50, 85, 120, 155, 190]
const IN_ROWS = [15, 45, 75]
const OUT_ROWS = [115, 150, 185]
/** [집하선 y, 도착 층 order]. 1F 입고 동쪽 집하선에서 수직으로 오른다 */
const UP_LIFTS: [number, number][] = [[15, 2], [30, 3], [45, 4], [60, 5], [75, 2], [90, 4]]
/** [집하선 y, 출발 층 order]. 위층 서쪽 집하선에서 1F 출고로 수직으로 내린다 */
const DOWN_LIFTS: [number, number][] = [[110, 2], [125, 3], [140, 4], [155, 5], [170, 3], [185, 5]]
/** 가운데 기둥에 세로 연결이 놓일 확률. 구간 수를 400~500 에 맞추는 손잡이 */
const VERTICAL_P = 0.25
const FLOOR_GAP = 45
const STREAMS = ["cam-in-1", "cam-fill-1", "cam-fill-2"]

type Kind = "row" | "col" | "spine" | "dock-in" | "bridge" | "dock-out" | "lift-up" | "lift-down"

export function generate(seed: number): Scene {
  const rand = rng(seed)
  const floors = [1, 2, 3, 4, 5].map((o) => ({
    id: `${o}F`, label: `${o}층`, order: o, elevation: (o - 1) * FLOOR_GAP,
  }))

  // ── 구역: 층마다 100×100 을 3×2 ─────────────────────────
  const sections: Section[] = []
  const cameras: Camera[] = []
  for (const f of floors) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const letter = "ABC"[col]
        const label = f.order === 1
          ? `1층 ${row === 0 ? "입고" : "출고"} ${letter}`
          : `${f.label} ${"ABCDEF"[row * 3 + col]}구역`
        const id = `f${f.order}-s${row}${col}`
        const cams: string[] = []
        // 구역 절반에만 카메라를 둔다 — 현장에서도 모든 구역에 있지는 않다
        if ((row + col) % 2 === 0) {
          const cid = `cam-${id}`
          cameras.push({ id: cid, label: `${label} 상부`, stream: STREAMS[cameras.length % STREAMS.length] })
          cams.push(cid)
        }
        sections.push({ id, label, floor: f.id, rect: [col * 100, row * 100, 100, 100], cameras: cams })
      }
    }
  }
  const sectionAt = (floorOrder: number, x: number, y: number) =>
    sections.find((s) => s.floor === `${floorOrder}F`
      && x >= s.rect[0] && x < s.rect[0] + s.rect[2]
      && y >= s.rect[1] && y < s.rect[1] + s.rect[3])!

  // ── 구간 ───────────────────────────────────────────────
  const segments: Segment[] = []
  const kinds = new Map<string, Kind>()
  const perFloor = new Map<number, number>()
  const counters = new Map<string, number>()
  const nextN = (k: string) => { const n = (counters.get(k) ?? 0) + 1; counters.set(k, n); return n }

  const add = (kind: Kind, from: Endpoint, to: Endpoint, id?: string, label?: string) => {
    const fo = Number(from.floor[0])
    const sec = sectionAt(fo, from.x, from.y)
    if (!id) {
      const n = (perFloor.get(fo) ?? 0) + 1
      perFloor.set(fo, n)
      id = `f${fo}-c${String(n).padStart(3, "0")}`
      const word = kind === "row" ? "이송" : kind === "col" ? "연결" : "집하"
      label = `${sec.label.replace("구역", "")}-${n} ${word}`
    }
    const len = Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
    const lift = from.floor !== to.floor
    segments.push({
      id, label: label!, section: sec.id, from, to,
      capacity: lift ? 4 : Math.max(4, Math.round(len * 0.5)),
    })
    kinds.set(id, kind)
  }
  const at = (fo: number, x: number, y: number): Endpoint => ({ floor: `${fo}F`, x, y })

  /**
   * 한 층(또는 1F 의 절반) 격자. 가로줄은 dir 방향으로 흐르고, 입구 기둥의
   * 분배선은 entryRoot 에서 멀어지는 쪽으로, 출구 기둥의 집하선은 exitRoot 로
   * 모이는 쪽으로 흐른다. 그래서 root 에서 모든 줄이 닿고 모든 줄이 root 로 빠진다.
   */
  const grid = (fo: number, rows: number[], dir: 1 | -1,
    entryYs: number[], entryRoot: number, exitYs: number[], exitRoot: number) => {
    const xs = dir === 1 ? XS : [...XS].reverse()
    const entryX = xs[0], exitX = xs[xs.length - 1]

    for (const y of rows)
      for (let i = 1; i < xs.length; i++) add("row", at(fo, xs[i - 1], y), at(fo, xs[i], y))

    const spine = (x: number, extra: number[], root: number, away: boolean) => {
      const ys = [...new Set([...rows, ...extra])].sort((a, b) => a - b)
      for (let i = 1; i < ys.length; i++) {
        const [a, b] = [ys[i - 1], ys[i]]
        // away: root 에서 멀어지게. 아니면 root 로 모이게.
        const up = away ? a >= root : b <= root
        add("spine", at(fo, x, up ? a : b), at(fo, x, up ? b : a))
      }
    }
    spine(entryX, entryYs, entryRoot, true)
    spine(exitX, exitYs, exitRoot, false)

    // 가운데 기둥: 기둥마다 한 방향(번갈아), 칸마다 확률로 놓는다
    for (let c = 1; c < xs.length - 1; c++) {
      const up = c % 2 === 0
      for (let r = 1; r < rows.length; r++) {
        if (rand() >= VERTICAL_P) continue
        const [a, b] = [rows[r - 1], rows[r]]
        add("col", at(fo, xs[c], up ? a : b), at(fo, xs[c], up ? b : a))
      }
    }
  }

  // 1F 입고: 서쪽 도크 3 + 남쪽 도크 5 → 동쪽 집하선 → 상승 리프트
  grid(1, IN_ROWS, 1, [], IN_ROWS[0], UP_LIFTS.map(([y]) => y), UP_LIFTS[UP_LIFTS.length - 1][0])
  for (const y of IN_ROWS) {
    const n = nextN("dock-in")
    add("dock-in", at(1, 0, y), at(1, WEST, y), `dock-in${n}`, `입고 도크 ${n}`)
  }
  for (const x of [XS[0], XS[2], XS[4], XS[6], XS[8]]) {
    const n = nextN("dock-in")
    add("dock-in", at(1, x, 0), at(1, x, IN_ROWS[0]), `dock-in${n}`, `입고 도크 ${n}`)
  }

  // 1F 출고: 하강 리프트 도착 → 동쪽 3 + 북쪽 1 출고 도크
  const downYs = DOWN_LIFTS.map(([y]) => y)
  grid(1, OUT_ROWS, 1, downYs, Math.min(...downYs), [], OUT_ROWS[OUT_ROWS.length - 1])
  for (const y of OUT_ROWS) {
    const n = nextN("dock-out")
    add("dock-out", at(1, EAST, y), at(1, 300, y), `dock-out${n}`, `출고 도크 ${n}`)
  }
  {
    const n = nextN("dock-out")
    const y = OUT_ROWS[OUT_ROWS.length - 1]
    add("dock-out", at(1, EAST, y), at(1, EAST, 200), `dock-out${n}`, `출고 도크 ${n}`)
  }

  // 2F~5F: 동쪽 분배선(상승 리프트 도착) → 서쪽으로 → 서쪽 집하선(하강 리프트 출발)
  for (let fo = 2; fo <= 5; fo++) {
    const ups = UP_LIFTS.filter(([, o]) => o === fo).map(([y]) => y)
    const downs = DOWN_LIFTS.filter(([, o]) => o === fo).map(([y]) => y)
    grid(fo, UPPER_ROWS, -1, ups, Math.min(...ups), downs, Math.min(...downs))
  }
  for (const x of [XS[4], XS[7]]) {
    const n = nextN("bridge")
    add("bridge", at(2, x, 0), at(2, x, UPPER_ROWS[0]), `bridge-${n}`, `연결 브리지 ${n}`)
  }

  // 리프트: 전부 수직이다(출발과 도착의 x, y 가 같다)
  UP_LIFTS.forEach(([y, fo], i) =>
    add("lift-up", at(1, EAST, y), at(fo, EAST, y), `lift-u${i + 1}`, `상승 리프트 ${i + 1}`))
  DOWN_LIFTS.forEach(([y, fo], i) =>
    add("lift-down", at(fo, WEST, y), at(1, WEST, y), `lift-d${i + 1}`, `하강 리프트 ${i + 1}`))

  // ── 설비: 합류점 머지기, 분기점 분류기, 가로줄 셋 중 하나에 가공기 ──
  const equipment: Equipment[] = []
  const nodeKey = (e: Endpoint) => `${e.floor}:${e.x}:${e.y}`
  const inDeg = new Map<string, number>(), outDeg = new Map<string, number>()
  const nodeAt = new Map<string, Endpoint>()
  for (const s of segments) {
    if (s.from.floor !== s.to.floor) continue // 리프트 끝은 설비를 두지 않는다 — 리프트 자체가 설비다
    outDeg.set(nodeKey(s.from), (outDeg.get(nodeKey(s.from)) ?? 0) + 1)
    inDeg.set(nodeKey(s.to), (inDeg.get(nodeKey(s.to)) ?? 0) + 1)
    nodeAt.set(nodeKey(s.from), s.from); nodeAt.set(nodeKey(s.to), s.to)
  }
  const perFloorEq = new Map<number, number>()
  const addEq = (fo: number, x: number, y: number, what: string, size: [number, number],
    height: number, shape: "box" | "cylinder") => {
    const n = (perFloorEq.get(fo) ?? 0) + 1
    perFloorEq.set(fo, n)
    const sec = sectionAt(fo, x, y)
    const withTags = equipment.length % 5 === 0
    equipment.push({
      id: `f${fo}-m${String(n).padStart(3, "0")}`,
      label: `${what} ${fo}-${n}`,
      section: sec.id, pos: [x, y], size, height, shape,
      tags: withTags
        ? [{ key: "speed", label: "속도", unit: "bpm", warn: 250 },
           { key: "temp", label: "온도", unit: "°C", warn: 80 }]
        : [],
    })
  }
  for (const [k, p] of nodeAt) {
    const fo = Number(p.floor[0])
    // 도크·브리지의 바깥 끝(층 가장자리)은 설비 자리가 아니다
    if (p.x === 0 || p.x === 300 || p.y === 0 || p.y === 200) continue
    if ((inDeg.get(k) ?? 0) >= 2) addEq(fo, p.x, p.y, "머지기", [3, 3], 2.2, "box")
    else if ((outDeg.get(k) ?? 0) >= 2) addEq(fo, p.x, p.y, "분류기", [3, 3], 2.4, "box")
  }
  let rowN = 0
  for (const s of segments) {
    if (kinds.get(s.id) !== "row") continue
    if (rowN++ % 3 !== 1) continue
    const fo = Number(s.from.floor[0])
    addEq(fo, (s.from.x + s.to.x) / 2, s.from.y, "가공기", [5, 3], 3.0, "cylinder")
  }

  return {
    version: 3, name: "대형 데모 공장 (5층)", stallSec: 10,
    floors, sections, equipment, segments, cameras,
  }
}

function main() {
  const i = process.argv.indexOf("--seed")
  const seed = i >= 0 ? Number(process.argv[i + 1]) : 1
  if (!Number.isInteger(seed)) {
    console.error("사용법: tsx tools/gen-scene.ts --seed <정수>")
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(generate(seed), null, 2) + "\n")
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
