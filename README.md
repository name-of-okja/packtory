# packtory

자동화 라인의 물류 흐름을 **아이소메트릭 3D 뷰**로 보여주고, 막힌 구간을
찾아내고, 그 구역 CCTV를 바로 띄우는 모니터.

신입 시설 관리·유지보수 담당자가 화면을 처음 봐도 지금 라인이 도는지,
안 돌면 어디가 막혔는지 한 눈에 알 수 있게 하는 것이 목표다. 결정적
요구는 **층이 버튼 없이 한 화면에 동시에 보이는 것** — 반투명 바닥판을
비스듬히 겹쳐 그려서, 층을 고르는 탭이나 버튼 자체가 없다.

- 설계(v3, 현재): `docs/superpowers/specs/2026-09-21-packtory-isometric-viewer-design.md`
- 설계(v2, 이전 SVG 평면도): `docs/superpowers/specs/2026-09-19-packtory-flow-monitor-design.md`

## 구성

| 프로세스 | 하는 일 |
|---|---|
| `hub/` | 센서 카운터를 읽어 `wip`/`state`/`stallMs` 를 계산하고 WebSocket으로 민다. 웹 정적 파일도 서빙한다 |
| `web/` | 아이소메트릭 3D 뷰 렌더링(Babylon.js). 층을 탭 없이 동시에 표시한다 |
| go2rtc | CCTV를 WebRTC로 브라우저에 직결한다. **영상은 허브를 통과하지 않는다** |
| `scene.json` | 층·구역·장비·구간·카메라. 전체 시스템이 이 파일 하나에 매달린다 |

## 개발 실행

```bash
# 1. 카메라 (선택). 실제 카메라가 없으면 sample.mp4 를 루프 재생한다
#    go2rtc.yaml 옆에 sample.mp4 를 직접 넣어야 한다 (저장소에는 없다)
go2rtc -c go2rtc.yaml

# 2. 허브
cd hub && npm install && npm start

# 3. 웹 (개발 서버)
cd web && npm install && npm run dev   # http://localhost:5173
```

## 단일 프로세스로 실행

```bash
cd web && npm run build
cd ../hub && npm run serve             # http://localhost:8080
```

`npm run serve` 는 `web/dist` 를 그대로 서빙할 뿐 신선도를 확인하지 않는다 —
`web/` 을 고쳤으면 반드시 `npm run build` 를 먼저 다시 돌려야 바뀐 내용이
반영된다.

환경 변수: `PORT`, `SCENE`, `GO2RTC_BASE`, `WEB_DIR`.

## 테스트

```bash
cd hub && npm test
```

테스트는 허브에만 있다 (`node --test`, 43개). 웹은 배선(3D 렌더링·피킹·
카메라)이라 자동 테스트를 쓰지 않는다 — 브라우저에서 사람이 직접 확인해야
하고, 순서와 각 항목에서 정확히 무엇이 보여야 하는지는
`docs/BROWSER-CHECKLIST.md` 에 있다.

## 씬 편집

`scene.json` 을 직접 고친다. 좌표 단위는 미터, 평면도 기준으로 X는 오른쪽,
Y는 위쪽(3D 에서는 깊이)이다. 허브가 부팅할 때 검증하며, 참조가 깨졌거나
장비가 구역 밖에 있으면 에러를 내고 죽는다.

v3 에서 추가된 필드(전부 선택):
- `floors[].elevation` — 그 층 바닥의 높이(미터). 없으면
  `(order - 1) × 6` 으로 6m 씩 쌓는다. 층을 겹쳐 그리는 유일한 손잡이다.
- `equipment[].height` — 설비 높이(미터). 없으면 2.
- `equipment[].shape` — `"box"`(기본) 또는 `"cylinder"`.

WIP 숫자가 실제와 안 맞으면 구간을 비운 상태에서 `wipOffset` 에
`-(in - out)` 을 넣는다. PLC 카운터가 한 바퀴 도는 값이 있으면
`counterMax` 에 적는다 (16비트면 32767).

## 카메라 조작

드래그로 팬, 휠로 줌, `⟲`/`⟳` 버튼으로 90°씩 회전(네 모서리 중 하나로만
정지), `⌂` 버튼으로 전체보기. **기울기(위에서 내려다보는 각도)는 못
바꾼다** — 35.26°(진짜 아이소메트릭)로 코드에 고정돼 있다. 기울일 수
있게 두면 누군가 기울여 놓은 화면을 다음 사람이 그대로 물려받기 때문이다.

## 범위

읽기 전용이다. PLC에 쓰지 않는다. 히스토리·알람 통지·인증은 범위 밖이다.
화면은 **어디서** 멈췄는지까지 말한다. **왜** 멈췄는지는 사람이 CCTV를 보고
판단한다.
