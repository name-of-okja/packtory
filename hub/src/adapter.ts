import type { Quality, Value } from "../../shared/types.ts"

export type Emit = (tag: string, v: Value, ts: number, q?: Quality) => void

export interface Adapter {
  start(emit: Emit): Promise<void>
  stop(): Promise<void>
}
