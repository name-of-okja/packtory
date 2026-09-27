import { useEffect, useRef, useState } from "react"
import type { Camera, Scene, Segment, TagValue } from "../../shared/types.ts"
import { STATE_LABEL, formatStall, segRoot, segStallMs, segState, segWip, type Selection } from "./state.ts"

/** go2rtc 의 웹 컴포넌트를 한 번만 로드한다 */
function useGo2rtcScript(base: string) {
  const [ready, setReady] = useState(() => !!customElements.get("video-stream"))
  useEffect(() => {
    if (ready) return
    const el = document.createElement("script")
    el.src = `${base}/video-stream.js`
    el.onload = () => setReady(true)
    el.onerror = () => setReady(false)
    document.head.appendChild(el)
  }, [base, ready])
  return ready
}

function num(values: Map<string, TagValue>, tag: string): number | null {
  const v = values.get(tag)
  return typeof v?.v === "number" ? v.v : null
}

/** 포커스 트랩 대상. 이 모달 안에 있을 수 있는 요소는 닫기 버튼, 카메라 탭,
 *  원인으로 가기 버튼뿐이라 매번 다시 조회해도 비용이 없다 — 목록을 캐싱할 이유가 없다. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

type Props = {
  scene: Scene
  values: Map<string, TagValue>
  go2rtcBase: string
  selection: Selection
  onClose: () => void
  /** 영향 구간의 "원인 →" 버튼. 모달을 닫고 그 구간으로 데려간다 */
  onGo: (seg: Segment) => void
}

/** 정지·영향이면 상태 뒤에 정지 시간을 붙인다 */
function stateText(id: string, values: Map<string, TagValue>): string {
  const st = segState(id, values)
  const t = st === "stalled" || st === "blocked" ? ` ${formatStall(segStallMs(id, values))}` : ""
  return `${STATE_LABEL[st]}${t}`
}

export default function Modal({ scene, values, go2rtcBase, selection, onClose, onGo }: Props) {
  const [tab, setTab] = useState(0)
  const ready = useGo2rtcScript(go2rtcBase)
  const dialogRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const downOnBackdrop = useRef(false)

  useEffect(() => { setTab(0) }, [selection?.kind, selection?.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // 접근성: 모달이 열리면 초점을 안으로 옮기고, 닫히면 열기 전 요소로 되돌린다.
  // role="dialog" + aria-modal="true" 는 스크린리더가 모달 바깥을 배경으로
  // 인식하게 하는 표준 신호다 — 형제 요소마다 aria-hidden 을 손으로 거는 것보다
  // 이쪽이 이 값을 만드는 정확한 방법이고, 주요 스크린리더가 실제로 지원한다.
  useEffect(() => {
    if (!selection) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => { prevFocusRef.current?.focus() }
  }, [selection?.kind, selection?.id])

  // "원인 →" 버튼에 초점이 있는 채로 구간이 풀려 버튼이 사라지면 초점이 body 로
  // 떨어지고, 다음 Tab 이 트랩을 벗어나 배경으로 간다. 모달로 되돌린다.
  const hasRoot = !!selection && selection.kind === "segment" && segState(selection.id, values) === "blocked"
  useEffect(() => {
    if (!selection || hasRoot) return
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus()
  }, [hasRoot, selection])

  if (!selection) return null

  // 대상이 무엇이든 카메라는 언제나 그 대상이 속한 섹션에서 온다
  let sectionId: string | undefined
  let title = ""
  let rows: [string, string][] = []
  // 영향 구간이면 그 원인. 모달 아래에 "원인: … →" 버튼으로 뜬다
  let root: Segment | undefined

  if (selection.kind === "section") {
    const sec = scene.sections.find((s) => s.id === selection.id)
    if (!sec) return null
    sectionId = sec.id
    title = sec.label
    rows = scene.segments
      .filter((g) => g.section === sec.id)
      .map((g) => [g.label, `${stateText(g.id, values)} · WIP ${segWip(g.id, values)}`])
  } else if (selection.kind === "equipment") {
    const eq = scene.equipment.find((e) => e.id === selection.id)
    if (!eq) return null
    sectionId = eq.section
    title = eq.label
    rows = eq.tags.map((t) => {
      const v = values.get(`${eq.id}.${t.key}`)
      const over = t.warn !== undefined && typeof v?.v === "number" && v.v >= t.warn
      return [t.label, `${v?.v ?? "—"} ${t.unit ?? ""}${over ? " ⚠" : ""}`]
    })
  } else {
    const seg = scene.segments.find((g) => g.id === selection.id)
    if (!seg) return null
    sectionId = seg.section
    title = seg.label
    const st = segState(seg.id, values)
    if (st === "blocked") root = scene.segments.find((g) => g.id === segRoot(seg.id, values))
    rows = [
      ["상태", STATE_LABEL[st]],
      ["누적 입고", String(num(values, `${seg.id}.in`) ?? "—")],
      ["누적 출고", String(num(values, `${seg.id}.out`) ?? "—")],
      ["구간 내 재공(WIP)", `${segWip(seg.id, values)}${seg.capacity ? ` / ${seg.capacity}` : ""}`],
      ["정지 시간", st === "stalled" || st === "blocked" ? formatStall(segStallMs(seg.id, values)) : "—"],
    ]
  }

  const section = scene.sections.find((s) => s.id === sectionId)
  const cams: Camera[] = (section?.cameras ?? [])
    .map((id) => scene.cameras.find((c) => c.id === id))
    .filter((c): c is Camera => !!c)

  // Tab 이 모달 밖으로 나가지 않게 가둔다. 배경이 시각적으로만 가려진 게 아니라
  // 키보드로도 닿지 않아야 진짜 "모달"이다 — 뒤에 층 탭·이상 칩 버튼이 그대로
  // 남아 있어서, 트랩이 없으면 Tab 만으로 모달이 뜬 채 배경을 조작할 수 있다.
  const onTrapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    // 열린 직후에는 초점이 컨테이너 자신에게 있고, 모달 안의 비-포커스 영역
    // (제목, 수치 행)을 클릭해도 초점은 가장 가까운 포커스 가능 조상 =
    // 컨테이너로 간다. 그 상태를 first 로도 last 로도 보지 않으면 다음
    // Shift+Tab 이 그대로 배경으로 빠져나간다 — 트랩이 막으려던 바로 그 일이고,
    // 키보드 사용자가 제일 먼저 시도할 조합에서 터진다. 컨테이너에서 앞으로
    // Tab 하는 경우는 손대지 않는다 — 브라우저 기본 동작이 이미 first 로 간다.
    const atContainer = active === dialogRef.current
    if (e.shiftKey && (active === first || atContainer)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="modal-backdrop"
      // 모달 안에서 시작해 배경에서 끝나는 드래그(수치를 긁어 복사하는, 관제
      // 화면에서 아주 흔한 동작)는 click 이 두 지점의 공통 조상 = 배경에서
      // 발생한다. 그러면 .modal 의 stopPropagation 을 거치지 않아 모달이 선택
      // 도중에 닫힌다. 눌린 지점도 배경이었을 때만 닫는다.
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={() => { if (downOnBackdrop.current) onClose() }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onTrapTab}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          {section && selection.kind !== "section" && <span className="modal-sub">{section.label}</span>}
          <button className="close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {cams.length > 0 && (
          <div className="video">
            {cams.length > 1 && (
              <div className="tabs" role="tablist">
                {cams.map((c, i) => (
                  <button key={c.id} role="tab" aria-selected={i === tab}
                          className={i === tab ? "on" : ""} onClick={() => setTab(i)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {/* 활성 탭 하나만 마운트한다 — 동시 디코딩 스트림은 항상 1개.
                모달을 닫으면 언마운트되며 연결도 끊긴다. */}
            {ready
              ? <video-stream key={cams[tab].id} src={`${go2rtcBase}/api/ws?src=${cams[tab].stream}`} mode="webrtc" />
              : <p className="video-error">영상 컴포넌트를 못 불러왔다 ({go2rtcBase})</p>}
          </div>
        )}

        <dl className="rows">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {root && (
          <button className="goto-root" onClick={() => { const r = root; onClose(); onGo(r) }}>
            원인: {root.label} →
          </button>
        )}
      </div>
    </div>
  )
}
