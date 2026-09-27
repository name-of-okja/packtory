import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder"
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder"
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh"
import type { Scene as BScene } from "@babylonjs/core/scene"
import type { Scene } from "../../../shared/types.ts"
import { equipmentHeight, equipmentShape } from "../../../shared/types.ts"
import type { LayoutMode } from "../../../shared/layout.ts"
import { segmentPoints, worldAt } from "./coords.ts"

export type MeshKind = "section" | "equipment" | "segment" | "andon"
export type MeshMeta = { kind: MeshKind; id: string }

export type StaticMeshes = {
  dispose(): void
  equipmentById: Map<string, AbstractMesh>
}

/** 바닥판 두께 */
const SLAB = 0.1

export function buildStatic(bscene: BScene, scene: Scene, mode: LayoutMode): StaticMeshes {
  const created: AbstractMesh[] = []
  const equipmentById = new Map<string, AbstractMesh>()

  // ── 구역 바닥판 ─────────────────────────────────────────
  // 반투명이라 위층이 아래층을 가리지 않는다. 이게 "층이 동시에 보인다" 의
  // 실현 방법이다.
  const slabMat = new StandardMaterial("slab", bscene)
  slabMat.diffuseColor = new Color3(0.16, 0.19, 0.24)
  slabMat.specularColor = Color3.Black()
  slabMat.alpha = 0.25

  for (const sec of scene.sections) {
    const [x, y, w, h] = sec.rect
    const slab = CreateBox(`sec:${sec.id}`, { width: w, height: SLAB, depth: h }, bscene)
    slab.position = worldAt(scene, sec.floor, x + w / 2, y + h / 2, -SLAB / 2, mode)
    slab.material = slabMat
    slab.metadata = { kind: "section", id: sec.id } satisfies MeshMeta
    created.push(slab)
  }

  // ── 설비 ────────────────────────────────────────────────
  const eqMat = new StandardMaterial("eq", bscene)
  eqMat.diffuseColor = new Color3(0.28, 0.32, 0.38)
  eqMat.specularColor = new Color3(0.1, 0.1, 0.1)

  for (const e of scene.equipment) {
    const sec = scene.sections.find((s) => s.id === e.section)
    if (!sec) continue
    const ht = equipmentHeight(e)
    const [w, d] = e.size

    const mesh = equipmentShape(e) === "cylinder"
      ? CreateCylinder(`eq:${e.id}`, { diameter: Math.min(w, d), height: ht, tessellation: 24 }, bscene)
      : CreateBox(`eq:${e.id}`, { width: w, height: ht, depth: d }, bscene)

    // Babylon 의 상자·원통은 원점이 중심이므로 높이의 절반만큼 올린다
    mesh.position = worldAt(scene, sec.floor, e.pos[0], e.pos[1], ht / 2, mode)
    mesh.material = eqMat
    mesh.metadata = { kind: "equipment", id: e.id } satisfies MeshMeta
    created.push(mesh)
    equipmentById.set(e.id, mesh)
  }

  // ── 구간 (벨트) ─────────────────────────────────────────
  // 상태색은 Task 7 의 신호등이 지고, 벨트 자체는 중립색이다. 벨트에까지
  // 색을 칠하면 카메라 각도에 따라 안 보이는 면이 생겨 신호가 흔들린다.
  const beltMat = new StandardMaterial("belt", bscene)
  beltMat.diffuseColor = new Color3(0.22, 0.25, 0.3)
  beltMat.specularColor = Color3.Black()

  for (const seg of scene.segments) {
    const pts = segmentPoints(scene, seg, mode)
    // 폴리라인을 튜브로 만든다. 꺾인 구간도 한 메시로 처리된다.
    const tube = CreateTube(
      `seg:${seg.id}`,
      { path: pts, radius: 0.22, tessellation: 8, cap: 2 },
      bscene,
    )
    tube.material = beltMat
    tube.metadata = { kind: "segment", id: seg.id } satisfies MeshMeta
    created.push(tube)
  }

  return {
    equipmentById,
    dispose() {
      for (const m of created) m.dispose()
      slabMat.dispose()
      eqMat.dispose()
      beltMat.dispose()
    },
  }
}
