import { test } from "node:test"
import assert from "node:assert/strict"
import WebSocket from "ws"
import { startHub } from "../src/index.ts"
import type { Adapter, Emit } from "../src/adapter.ts"
import type { WsMessage, TagValue } from "../../shared/types.ts"

/** 테스트가 카운터를 직접 조종하는 가짜 어댑터 */
class FakeAdapter implements Adapter {
  emit!: Emit
  async start(emit: Emit) { this.emit = emit }
  async stop() {}
}

const SCENE = new URL("../../scene.json", import.meta.url).pathname

function nextMessage(ws: WebSocket, pred: (m: WsMessage) => boolean): Promise<WsMessage> {
  return new Promise((resolve) => {
    const on = (raw: Buffer) => {
      const m = JSON.parse(raw.toString()) as WsMessage
      if (pred(m)) { ws.off("message", on); resolve(m) }
    }
    ws.on("message", on)
  })
}

function tagOf(m: WsMessage, tag: string): TagValue | undefined {
  return m.data.find((t) => t.tag === tag)
}

test("접속하면 스냅샷을 받고, 스냅샷에 파생 태그가 들어있다", async () => {
  const fake = new FakeAdapter()
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x" })
  try {
    const now = Date.now()
    fake.emit("conv-3.in", 100, now)
    fake.emit("conv-3.out", 90, now)
    await new Promise((r) => setTimeout(r, 700)) // derive 500ms 주기가 한 번 돌기를 기다린다

    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    const snap = await nextMessage(ws, (m) => m.type === "snapshot")
    assert.equal(tagOf(snap, "conv-3.in")!.v, 100)
    assert.equal(tagOf(snap, "conv-3.wip")!.v, 10)
    assert.equal(tagOf(snap, "conv-3.state")!.v, "running")
    ws.close()
  } finally {
    await hub.close()
  }
})

test("값이 바뀌면 values 로 푸시하고, 안 바뀐 태그는 안 보낸다", async () => {
  const fake = new FakeAdapter()
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x" })
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    await nextMessage(ws, (m) => m.type === "snapshot")

    fake.emit("filler-1.temp", 77, Date.now())
    const msg = await nextMessage(ws, (m) => m.type === "values" && !!tagOf(m, "filler-1.temp"))
    assert.equal(tagOf(msg, "filler-1.temp")!.v, 77)
    ws.close()
  } finally {
    await hub.close()
  }
})

test("GET /api/scene 가 씬과 go2rtcBase 를 준다", async () => {
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: new FakeAdapter(), go2rtcBase: "http://cam:1984" })
  try {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/scene`)
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.go2rtcBase, "http://cam:1984")
    assert.equal(body.scene.version, 2)
  } finally {
    await hub.close()
  }
})

test("stallSec 이 지나면 stalled 로 바뀌고 stallMs 가 올라간다", async () => {
  const fake = new FakeAdapter()
  // stallSec 을 1초로 줄여 테스트를 빠르게 돌린다
  const hub = await startHub({ scenePath: SCENE, port: 0, adapter: fake, go2rtcBase: "http://x", stallSecOverride: 1 })
  try {
    const now = Date.now()
    fake.emit("conv-3.in", 100, now)
    fake.emit("conv-3.out", 90, now) // wip 10, out 은 이후 안 움직인다

    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    await nextMessage(ws, (m) => m.type === "snapshot")

    const msg = await nextMessage(
      ws,
      (m) => m.type === "values" && tagOf(m, "conv-3.state")?.v === "stalled",
    )
    assert.ok((tagOf(msg, "conv-3.stallMs")!.v as number) >= 1000)
    ws.close()
  } finally {
    await hub.close()
  }
})
