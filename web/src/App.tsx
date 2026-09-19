import { useScene } from "./scene.ts"
import { useValues } from "./useValues.ts"

export default function App() {
  const { data, error } = useScene()
  const { values, connected } = useValues()

  if (error) return <p style={{ padding: 16 }}>씬을 못 읽었다: {error}</p>
  if (!data) return <p style={{ padding: 16 }}>씬 읽는 중…</p>

  const segTags = data.scene.segments.flatMap((s) =>
    [`${s.id}.state`, `${s.id}.wip`, `${s.id}.stallMs`].map((t) => values.get(t)),
  )

  return (
    <div style={{ padding: 16 }}>
      <p>{data.scene.name} · {connected ? "연결됨" : "끊김"} · 태그 {values.size}개</p>
      <pre>{segTags.filter(Boolean).map((t) => `${t!.tag} = ${t!.v}`).join("\n")}</pre>
    </div>
  )
}
