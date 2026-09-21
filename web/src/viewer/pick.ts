// scene.multiPick 은 Scene 클래스에 스텁으로만 정의돼 있고, 실제 구현은
// 이 모듈을 사이드이펙트로 임포트해야 Scene.prototype 에 등록된다. Task 6·7 의
// thinInstance/HighlightLayer 와 같은 함정 — 빠뜨리면 타입체크·빌드는 통과하고
// 클릭할 때마다 "Ray needs to be imported before" 로 런타임에만 죽는다
// (실측: 클릭 핸들러가 매번 조용히 죽어 아무것도 안 잡혔다).
import "@babylonjs/core/Culling/ray"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Selection } from "../state.ts"
import type { IsoCamera } from "./camera.ts"
import type { MeshKind, MeshMeta } from "./build.ts"

/**
 * 종류 우선순위. 반투명 바닥판 너머의 아래층 설비를 곧장 누를 수 있어야 하므로
 * 바닥판을 맨 뒤에 둔다. 바닥판 자체도 클릭 대상이라(구역 모달) 끄지는 않는다.
 */
const PRIORITY: MeshKind[] = ["equipment", "segment", "andon", "section"]

export function attachPicking(
  bscene: BScene,
  cam: IsoCamera,
  onPick: (sel: Selection) => void,
): () => void {
  const canvas = bscene.getEngine().getRenderingCanvas()
  if (!canvas) return () => {}

  const onClick = (e: MouseEvent) => {
    // 팬 드래그 뒤의 합성 클릭을 막는다. 지도를 끌 때마다 모달이 열리면
    // 아무도 지도를 못 끈다.
    if (cam.didPan()) return

    // bscene.pointerX/pointerY 는 scene.attachControl() 이 호출돼야 갱신된다.
    // 이 앱은 카메라를 직접 굴리므로(camera.ts) 그걸 부른 적이 없다 — 그대로
    // 쓰면 항상 초기값(0,0)을 줍는다. 클릭 이벤트 좌표를 캔버스 기준으로
    // 직접 계산한다.
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const hits = bscene.multiPick(x, y) ?? []
    let best: { meta: MeshMeta; dist: number; rank: number } | null = null
    for (const h of hits) {
      const meta = h.pickedMesh?.metadata as MeshMeta | undefined
      if (!meta) continue
      const rank = PRIORITY.indexOf(meta.kind)
      if (rank < 0) continue
      if (!best || rank < best.rank || (rank === best.rank && h.distance < best.dist))
        best = { meta, dist: h.distance, rank }
    }
    if (!best) {
      onPick(null)
      return
    }
    // 신호등을 누르면 그 구간이 잡힌다
    const kind = best.meta.kind === "andon" ? "segment" : best.meta.kind
    onPick({ kind: kind as "section" | "equipment" | "segment", id: best.meta.id })
  }

  canvas.addEventListener("click", onClick)
  return () => canvas.removeEventListener("click", onClick)
}
