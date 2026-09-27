import { readFileSync } from "node:fs"
import type { Scene, Section } from "../../shared/types.ts"
import { equipmentHeight, floorElevation } from "../../shared/types.ts"

type Rect = [number, number, number, number]

/** 배열에서 두 번 이상 나온 값들 */
function dup(ids: string[]): string[] {
  const seen = new Set<string>()
  const out = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) out.add(id)
    seen.add(id)
  }
  return [...out]
}

/** 변끼리 닿는 것은 겹침이 아니다 (엄격 부등호) */
function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2]
    && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

export function validateScene(s: Scene): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const floorIds = new Set(s.floors.map((f) => f.id))
  const sectionIds = new Set(s.sections.map((x) => x.id))
  const cameraIds = new Set(s.cameras.map((c) => c.id))

  // 규칙2: id 중복
  for (const id of dup(s.floors.map((f) => f.id))) errors.push(`중복 층 id: ${id}`)
  for (const id of dup(s.sections.map((x) => x.id))) errors.push(`중복 섹션 id: ${id}`)
  for (const id of dup(s.cameras.map((c) => c.id))) errors.push(`중복 카메라 id: ${id}`)
  // 장비와 구간은 태그 네임스페이스 `{id}.{key}` 를 공유하므로 서로 간에도 겹치면 안 된다
  for (const id of dup([...s.equipment.map((e) => e.id), ...s.segments.map((g) => g.id)]))
    errors.push(`태그 네임스페이스 중복 id: ${id} (장비와 구간은 이름을 공유한다)`)

  // 규칙1: 참조 무결성
  for (const sec of s.sections) {
    if (!floorIds.has(sec.floor)) errors.push(`섹션 ${sec.id}: 없는 층 ${sec.floor}`)
    for (const c of sec.cameras)
      if (!cameraIds.has(c)) errors.push(`섹션 ${sec.id}: 없는 카메라 ${c}`)
  }
  for (const e of s.equipment)
    if (!sectionIds.has(e.section)) errors.push(`장비 ${e.id}: 없는 섹션 ${e.section}`)
  for (const g of s.segments) {
    if (!sectionIds.has(g.section)) errors.push(`구간 ${g.id}: 없는 섹션 ${g.section}`)
    if (!floorIds.has(g.from.floor)) errors.push(`구간 ${g.id}: 없는 층 ${g.from.floor}`)
    if (!floorIds.has(g.to.floor)) errors.push(`구간 ${g.id}: 없는 층 ${g.to.floor}`)
    // 규칙5
    if (g.from.floor === g.to.floor && g.from.x === g.to.x && g.from.y === g.to.y)
      errors.push(`구간 ${g.id}: 시작과 끝이 같은 좌표`)
  }

  // 규칙3: 장비가 소속 섹션 rect 안
  const secById = new Map<string, Section>(s.sections.map((x) => [x.id, x]))
  for (const e of s.equipment) {
    const sec = secById.get(e.section)
    if (!sec) continue
    const [rx, ry, rw, rh] = sec.rect
    const [cx, cy] = e.pos
    const [w, h] = e.size
    if (cx - w / 2 < rx || cx + w / 2 > rx + rw || cy - h / 2 < ry || cy + h / 2 > ry + rh)
      errors.push(`장비 ${e.id}: 섹션 ${sec.id} 영역 밖`)
  }

  // 규칙4: 같은 층 섹션끼리 겹침
  for (const f of s.floors) {
    const on = s.sections.filter((x) => x.floor === f.id)
    for (let i = 0; i < on.length; i++)
      for (let j = i + 1; j < on.length; j++)
        if (overlaps(on[i].rect, on[j].rect))
          errors.push(`섹션 ${on[i].id} 와 ${on[j].id} 가 ${f.id} 에서 겹친다`)
  }

  // 규칙7: 실효 높이가 order 순으로 단조 증가해야 한다.
  // 어긋나면 위층이 아래층 밑에 그려져 화면이 뒤집힌 것처럼 보인다.
  //
  // **원시 elevation 이 아니라 floorElevation() 으로 비교한다.** 원시 값을 읽고
  // undefined 인 쌍을 건너뛰면, 일부 층만 elevation 을 적은 씬에서 진짜 역전이
  // 통째로 새어나간다: 1F=10(명시), 2F 없음(기본 6), 3F=5(명시) 면 실효 높이가
  // 10, 6, 5 로 감소하는데 인접 쌍마다 한쪽이 undefined 라 전부 건너뛴다.
  // floorElevation 은 언제나 수를 돌려주므로 건너뛸 이유 자체가 없다.
  const byOrder = [...s.floors].sort((a, b) => a.order - b.order)
  for (let i = 1; i < byOrder.length; i++) {
    const lo = byOrder[i - 1], hi = byOrder[i]
    const loY = floorElevation(s, lo.id), hiY = floorElevation(s, hi.id)
    if (hiY <= loY)
      errors.push(`층 ${hi.id} 의 높이(${hiY}m) 가 아래층 ${lo.id}(${loY}m) 보다 높지 않다`)
  }

  // 규칙8: 설비 높이
  for (const e of s.equipment) {
    if (e.height !== undefined && e.height <= 0) {
      errors.push(`장비 ${e.id}: height 는 양수여야 한다 (받음: ${e.height})`)
      continue
    }
    const sec = secById.get(e.section)
    if (!sec) continue
    const base = floorElevation(s, sec.floor)
    const top = base + equipmentHeight(e)
    // 바로 위층이 있으면 그 바닥을 뚫는지 본다 — 경고다. 현장에 층고보다 높은
    // 설비(탱크가 두 층을 관통하는 등)가 실제로 있으므로 막지는 않는다.
    const above = byOrder.find((f) => floorElevation(s, f.id) > base)
    if (above && top > floorElevation(s, above.id))
      warnings.push(`장비 ${e.id} 가 위층 ${above.id} 바닥을 뚫는다 (윗면 ${top}m > ${floorElevation(s, above.id)}m)`)
  }

  // 규칙6: 미참조 카메라 (경고)
  const used = new Set(s.sections.flatMap((x) => x.cameras))
  for (const c of s.cameras)
    if (!used.has(c.id)) warnings.push(`카메라 ${c.id} 를 아무 섹션도 쓰지 않는다`)

  return { errors, warnings }
}

export function loadScene(path: string): Scene {
  const s = JSON.parse(readFileSync(path, "utf8")) as Scene
  if (s.version !== 4) throw new Error(`씬 version 4 만 지원한다 (받음: ${s.version})`)
  const { errors, warnings } = validateScene(s)
  for (const w of warnings) console.warn(`씬 경고: ${w}`)
  if (errors.length) throw new Error(`씬 검증 실패:\n  ${errors.join("\n  ")}`)
  return s
}
