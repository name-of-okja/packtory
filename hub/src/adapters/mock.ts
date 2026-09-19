import type { Scene } from "../../../shared/types.ts"
import type { Adapter, Emit } from "../adapter.ts"

export class MockAdapter implements Adapter {
  constructor(private scene: Scene) {}
  async start(_emit: Emit) {}
  async stop() {}
}
