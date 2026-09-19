import type { TagValue } from "../../shared/types.ts"
import type { ValueMap } from "./derive.ts"

/** 마지막 값만 메모리에 들고 있는다 (스냅샷 용도). 히스토리는 범위 밖. */
export class Cache {
  private m = new Map<string, TagValue>()

  /** 값이나 품질이 바뀌었으면 true — 팬아웃은 이때만 푸시한다 */
  set(t: TagValue): boolean {
    const old = this.m.get(t.tag)
    this.m.set(t.tag, t)
    return !old || old.v !== t.v || old.q !== t.q
  }

  snapshot(): TagValue[] {
    return [...this.m.values()]
  }

  /** derive 입력용 */
  values(): ValueMap {
    const out: ValueMap = new Map()
    for (const [tag, t] of this.m) out.set(tag, { v: t.v, q: t.q })
    return out
  }
}
