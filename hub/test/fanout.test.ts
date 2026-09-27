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

    // 첫 derive 틱이 파생 태그를 한 번 내보내고 나면 입력이 안 바뀌므로 그 뒤로는
    // 다시 안 바뀐다. 그게 정착할 때까지 기다린 뒤부터 감시해야 "최초 전송" 을
    // "재전송" 으로 착각하지 않는다.
    await new Promise((r) => setTimeout(r, 700))

    // filler-1.temp 말고 다른 태그가 다시 오면 여기 쌓인다. cache.set 이 항상 true 를
    // 반환하도록 망가지면 derive 가 500ms 마다 안 바뀐 파생 태그 12개(구간 4개 × 3필드)를
    // 다시 밀어 넣으므로 이 목록이 채워진다. (msg.data.length 만 보면 놓친다 — 배치 주기가
    // 100ms 이고 derive 주기가 500ms 라서, 재전송 배치가 filler 배치와 같은 100ms 창에
    // 안 걸리면 그 순간만 보는 단언은 우연히 통과한다. 실측으로 확인함: 아래 참고.)
    const resent = new Set<string>()
    const onMsg = (raw: Buffer) => {
      const m = JSON.parse(raw.toString()) as WsMessage
      if (m.type !== "values") return
      for (const t of m.data) if (t.tag !== "filler-1.temp") resent.add(t.tag)
    }
    ws.on("message", onMsg)

    fake.emit("filler-1.temp", 77, Date.now())
    const msg = await nextMessage(ws, (m) => m.type === "values" && !!tagOf(m, "filler-1.temp"))
    assert.equal(tagOf(msg, "filler-1.temp")!.v, 77)
    assert.equal(msg.data.length, 1)

    await new Promise((r) => setTimeout(r, 700)) // derive 틱이 한 번 더 지나가는 것까지 지켜본다
    ws.off("message", onMsg)
    assert.deepEqual([...resent], [], "안 바뀐 태그가 다시 보내졌다")
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
    assert.equal(body.scene.version, 4)
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

test("정적 서빙: 깨진 퍼센트 인코딩 요청은 400 이고, 프로세스는 죽지 않는다", async () => {
  const hub = await startHub({
    scenePath: SCENE,
    port: 0,
    adapter: new FakeAdapter(),
    go2rtcBase: "http://x",
    // 존재하기만 하면 되는 디렉터리 — 정적 파일을 실제로 서빙하는지는 이 테스트의 관심사가 아니다.
    webDir: new URL(".", import.meta.url).pathname,
  })
  try {
    const res = await fetch(`http://127.0.0.1:${hub.port}/%`)
    assert.equal(res.status, 400)

    // 핵심은 이 두 번째 요청이다. decodeURIComponent 가 던진 URIError 를 못 잡으면
    // async 핸들러의 unhandled rejection 으로 허브 프로세스 자체가 죽으므로,
    // 400 만 확인해서는 크래시 회귀를 못 잡는다 — 그 다음 요청이 살아있어야 진짜 통과다.
    const res2 = await fetch(`http://127.0.0.1:${hub.port}/api/scene`)
    assert.equal(res2.status, 200)
  } finally {
    await hub.close()
  }
})
