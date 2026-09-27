# packtory 데모 씬 전환 설계

작성일: 2026-09-27
상태: 초안 (검토 대기)

## 1. 목적

데모에서 **작은 씬(2층, 구간 4개)과 대형 씬(5층, 구간 493개)을 화면 버튼 하나로
오간다.** 지금은 허브를 `SCENE` 환경 변수로 다시 띄워야 한다.

그리고 **fps 를 처음부터 늘 보인다.** 지금은 `?fps` 를 붙여야 보인다.

**데모용이다.** 실제 여러 현장·라인을 고르는 기능(씬마다 다른 실제 어댑터)은
범위 밖이다 — 두 씬 모두 모의 어댑터로 돈다.

## 2. 확정된 전제

| 항목 | 결정 | 근거 |
|---|---|---|
| 허브 구조 | 씬마다 **실행 환경을 따로** (모의 어댑터·캐시·판정 타이머·WS 팬아웃) | 한 캐시에 섞으면 두 씬에 같은 id 가 생기는 순간 값이 뒤섞인다. 대형 씬 mock 틱이 약 0.3ms 라 둘을 동시에 돌려도 부담이 없다 |
| 기본 씬 | **large** | 새로 만든 것을 보여주는 데모다 |
| 씬 id | 작은 씬 `small`, 대형 씬 `large` | URL 에 남으므로 짧고 읽기 쉬워야 한다 |
| 선택 기억 | URL `?scene=small` (`history.replaceState`) | 새로고침해도 남고 링크로 공유된다. 저장소가 필요 없다 |
| 층 배치 모드 | 씬을 바꿔도 유지 | 보는 방식이지 씬의 속성이 아니다 |
| fps | 늘 표시 | 요청 |
| `SCENE` 환경 변수 | 주면 **그 씬 하나만** 돈다 (id 는 파일 이름) | 기존 사용법·README 가 그대로 산다 |

## 3. 허브

### API

| 요청 | 응답 |
|---|---|
| `GET /api/scenes` | `{ default: "large", scenes: [{ id: "small", name: "데모 라인" }, { id: "large", name: "대형 데모 공장 (5층)" }] }` |
| `GET /api/scene?id=large` | 지금과 같은 `{ scene, go2rtcBase }` |
| `GET /api/scene` | 기본 씬 |
| `GET /api/scene?id=없음` | **404** |
| WS `/ws?scene=large` | 그 씬의 스냅숏, 이후 변경분 |
| WS `/ws` | 기본 씬 |
| WS `/ws?scene=없음` | 접속 직후 코드 **4404** 로 닫는다 |

### `startHub`

```ts
export type SceneSpec = { id: string; path: string; adapter: Adapter }

export type HubOptions = {
  scenes: SceneSpec[]        // 하나 이상
  defaultScene: string       // scenes 중 하나. id 없이 온 요청이 이 씬을 본다
  port: number
  go2rtcBase: string
  stallSecOverride?: number
  webDir?: string
}
```

씬마다 `loadScene` → 캐시 → 팬아웃 → 판정 타이머(`derive` + `withCause`)를 만든다.
지금 `startHub` 안의 씬 하나짜리 코드가 그대로 씬마다 돈다. `defaultScene` 이
`scenes` 에 없으면 부팅 때 에러로 죽는다. 씬 id 가 겹쳐도 에러로 죽는다.

### 직접 실행 (`index.ts` 의 main)

- `SCENE` 이 있으면: `[{ id: 파일 이름(확장자 뺌), path: SCENE }]`, 기본은 그것.
- 없으면: `small` = `scene.json`, `large` = `scene.large.json`, 기본 `large`.
- `MOCK_SEED` 는 모든 씬의 모의 어댑터에 같이 쓴다.

## 4. 웹

- **씬 전환 버튼**을 오른쪽 아래 컨트롤 맨 앞에 둔다. 지금 씬이 대형이면 "소형",
  소형이면 "대형" 이라고 쓴다(누르면 갈 곳). 폭이 다른 버튼보다 넓어도 된다.
- 시작: URL 의 `?scene=` 이 목록에 있으면 그것, 아니면 `/api/scenes` 의 `default`.
- 누르면: URL 을 `replaceState` 로 바꾸고, `useScene(id)` 가 그 씬을 다시 받고,
  `useValues(id)` 가 `/ws?scene=id` 로 다시 연결한다. 씬이 바뀌면 뷰어는 이미 엔진째
  다시 짓는다. **이전 씬의 값과 선택(모달)은 비운다** — 다른 씬의 id 가 남으면 안 된다.
- 씬 목록이 하나뿐이면(`SCENE` 으로 띄움) 버튼을 그리지 않는다.
- fps: `?fps` 조건을 지우고 늘 왼쪽 아래에 그린다.

## 5. 테스트

### 자동 (hub, `node --test`)

기존 `fanout.test.ts` 는 `startHub({ scenes: [{ id: "small", path, adapter }], defaultScene: "small", … })`
로 바꿔 그대로 통과해야 한다. 더한다:

| 확인 |
|---|
| 두 씬으로 띄우면 `/api/scenes` 가 목록과 기본을 준다 |
| `/api/scene?id=` 가 그 씬을, 없으면 기본을, 없는 id 면 404 를 준다 |
| `/ws?scene=a` 와 `/ws?scene=b` 가 각자 자기 씬의 태그만 받는다 (한쪽 어댑터가 낸 값이 다른 쪽에 안 간다) |
| `/ws` 는 기본 씬, 없는 씬이면 4404 로 닫힌다 |
| `defaultScene` 이 목록에 없거나 id 가 겹치면 `startHub` 가 거절한다 |

### 사람 (`docs/BROWSER-CHECKLIST.md`)

1. 처음 열면 대형 씬, 왼쪽 아래에 fps.
2. "소형" 버튼 → 작은 씬, URL 에 `?scene=small`, 버튼이 "대형" 으로.
3. 새로고침 → 작은 씬 그대로.
4. 모달을 연 채 씬을 바꾸면 모달이 닫힌다.
5. 계단 배치로 둔 채 씬을 바꾸면 새 씬도 계단 배치.
6. `SCENE=../scene.json` 으로 띄우면 씬 버튼이 없다.

## 6. 범위 밖

- 씬마다 다른 실제 어댑터 (OPC-UA 등)
- 씬 목록을 파일·설정으로 늘리기 (두 개로 고정)
- 보지 않는 씬의 모의 어댑터 멈추기 (둘 다 늘 돈다)
