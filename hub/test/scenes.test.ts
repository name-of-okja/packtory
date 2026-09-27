import { test } from "node:test"
import assert from "node:assert/strict"
import WebSocket from "ws"
import { startHub } from "../src/index.ts"
import type { Adapter, Emit } from "../src/adapter.ts"
import type { WsMessage } from "../../shared/types.ts"

class FakeAdapter implements Adapter {
  emit!: Emit
  async start(emit: Emit) { this.emit = emit }
  async stop() {}
}

const SMALL = new URL("../../scene.json", import.meta.url).pathname
const LARGE = new URL("../../scene.large.json", import.meta.url).pathname

/** 작은 씬과 대형 씬을 함께 띄운다. 기본은 대형 */
async function two() {
  const small = new FakeAdapter(), large = new FakeAdapter()
  const hub = await startHub({
    scenes: [{ id: "small", path: SMALL, adapter: small }, { id: "large", path: LARGE, adapter: large }],
    defaultScene: "large", port: 0, go2rtcBase: "http://x",
  })
  return { hub, small, large, base: `127.0.0.1:${hub.port}` }
}

/** 소켓의 첫 메시지(스냅숏)의 태그들 */
function snapshotTags(url: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once("message", (raw) => {
      const m = JSON.parse(raw.toString()) as WsMessage
      ws.close()
      resolve(m.data.map((t) => t.tag))
    })
    ws.once("error", reject)
  })
}

test("/api/scenes 가 씬 목록과 기본 씬을 준다", async () => {
  const { hub, base } = await two()
  try {
    const body = await (await fetch(`http://${base}/api/scenes`)).json()
    assert.deepEqual(body, {
      default: "large",
      scenes: [{ id: "small", name: "데모 라인" }, { id: "large", name: "대형 데모 공장 (5층)" }],
    })
  } finally { await hub.close() }
})

test("/api/scene 은 id 의 씬, id 가 없으면 기본 씬, 없는 id 면 404", async () => {
  const { hub, base } = await two()
  try {
    const small = await (await fetch(`http://${base}/api/scene?id=small`)).json()
    assert.equal(small.scene.segments.length, 4)
    const dflt = await (await fetch(`http://${base}/api/scene`)).json()
    assert.equal(dflt.scene.name, "대형 데모 공장 (5층)")
    assert.equal((await fetch(`http://${base}/api/scene?id=nope`)).status, 404)
  } finally { await hub.close() }
})

test("씬마다 자기 태그만 받는다 — 한쪽 어댑터가 낸 값이 다른 씬으로 가지 않는다", async () => {
  const { hub, small, large, base } = await two()
  try {
    small.emit("conv-1.in", 5, Date.now())
    large.emit("f1-c001.in", 7, Date.now())
    const s = await snapshotTags(`ws://${base}/ws?scene=small`)
    const l = await snapshotTags(`ws://${base}/ws?scene=large`)
    assert.ok(s.includes("conv-1.in") && !s.includes("f1-c001.in"), s.join(","))
    assert.ok(l.includes("f1-c001.in") && !l.includes("conv-1.in"), l.join(","))
  } finally { await hub.close() }
})

test("/ws 는 기본 씬을 준다", async () => {
  const { hub, large, base } = await two()
  try {
    large.emit("f1-c001.in", 7, Date.now())
    assert.ok((await snapshotTags(`ws://${base}/ws`)).includes("f1-c001.in"))
  } finally { await hub.close() }
})

test("없는 씬으로 접속하면 4404 로 닫힌다", async () => {
  const { hub, base } = await two()
  try {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${base}/ws?scene=nope`)
      ws.on("close", (c) => resolve(c))
    })
    assert.equal(code, 4404)
  } finally { await hub.close() }
})

test("기본 씬이 목록에 없거나 id 가 겹치면 startHub 가 거절한다", async () => {
  const a = { id: "small", path: SMALL, adapter: new FakeAdapter() }
  await assert.rejects(startHub({ scenes: [a], defaultScene: "large", port: 0, go2rtcBase: "x" }), /기본 씬 large/)
  await assert.rejects(startHub({ scenes: [a, { ...a }], defaultScene: "small", port: 0, go2rtcBase: "x" }), /겹친다/)
})
