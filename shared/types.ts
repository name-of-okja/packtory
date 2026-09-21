export type Quality = "good" | "bad"
export type Value = number | string | boolean

export type TagValue = { tag: string; v: Value; ts: number; q: Quality }

export type WsMessage =
  | { type: "snapshot"; data: TagValue[] }
  | { type: "values"; data: TagValue[] }

export type SegState = "running" | "stalled" | "idle" | "unknown"

export type Floor = {
  id: string
  label: string
  order: number
  /** 이 층 바닥의 높이(미터). 없으면 (order - 1) × 6. 층 겹침의 유일한 손잡이다 */
  elevation?: number
}

/** rect 는 [x, y, w, h]. 배경을 칠하고 라벨을 놓는 용도일 뿐 소속 판정에 쓰지 않는다. */
export type Section = {
  id: string
  label: string
  floor: string
  rect: [number, number, number, number]
  cameras: string[]
}

export type EquipmentTag = {
  key: string
  label: string
  unit?: string
  /** 있으면 임계, 없으면 경고 판정에서 제외 */
  warn?: number
}

export type Equipment = {
  id: string
  label: string
  section: string
  /** 중심점 */
  pos: [number, number]
  /** [w, h] */
  size: [number, number]
  /** 설비 높이(미터). 없으면 2 */
  height?: number
  /** 없으면 "box" */
  shape?: "box" | "cylinder"
  tags: EquipmentTag[]
}

export type Endpoint = { floor: string; x: number; y: number }

/** from.floor !== to.floor 이면 리프트다. 별도 타입을 두지 않는다. */
export type Segment = {
  id: string
  label: string
  section: string
  from: Endpoint
  to: Endpoint
  via?: [number, number][]
  capacity?: number
  /** WIP 영점 보정. 구간을 비운 상태에서 -(in - out) 을 넣는다 */
  wipOffset?: number
  /** PLC 카운터 최대값. 있으면 모듈러로 델타를 구한다 */
  counterMax?: number
}

export type Camera = { id: string; label: string; stream: string }

export type Scene = {
  version: 3
  name: string
  stallSec: number
  floors: Floor[]
  sections: Section[]
  equipment: Equipment[]
  segments: Segment[]
  cameras: Camera[]
}

export type SceneResponse = { scene: Scene; go2rtcBase: string }

/** 구간이 리프트인가 */
export function isLift(seg: Segment): boolean {
  return seg.from.floor !== seg.to.floor
}

/** 층 높이 기본값. elevation 이 없으면 층당 6m 로 쌓는다 */
export function floorElevation(scene: Scene, floorId: string): number {
  const f = scene.floors.find((x) => x.id === floorId)
  if (!f) return 0
  return f.elevation ?? (f.order - 1) * 6
}

export function equipmentHeight(eq: Equipment): number {
  return eq.height ?? 2
}

export function equipmentShape(eq: Equipment): "box" | "cylinder" {
  return eq.shape ?? "box"
}
