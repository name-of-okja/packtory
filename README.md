# packtory

자동화 라인의 물류 흐름을 평면도 위에 애니메이션으로 보여주고, 막힌 구간을
찾아내고, 그 구역 CCTV를 바로 띄우는 모니터.

신입 시설 관리·유지보수 담당자가 화면을 처음 봐도 지금 라인이 도는지,
안 돌면 어디가 막혔는지 한 눈에 알 수 있게 하는 것이 목표다.

- 설계: `docs/superpowers/specs/2026-09-19-packtory-flow-monitor-design.md`
- 구현 계획: `docs/superpowers/plans/2026-09-19-packtory-flow-monitor.md`

## 구성

| 프로세스 | 하는 일 |
|---|---|
| `hub/` | 센서 카운터를 읽어 `wip`/`state`/`stallMs` 를 계산하고 WebSocket으로 민다. 웹 정적 파일도 서빙한다 |
| `web/` | 평면도 렌더링. 점 애니메이션은 CSS가 돌린다 |
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

환경 변수: `PORT`, `SCENE`, `GO2RTC_BASE`, `WEB_DIR`.

## 테스트

```bash
cd hub && npm test
```

테스트는 허브에만 있다 (`node --test`, 34개). 웹은 배선이라 자동 테스트를
쓰지 않는다 — 브라우저에서 사람이 직접 확인해야 하고, 순서와 각 항목에서
정확히 무엇이 보여야 하는지는 `docs/BROWSER-CHECKLIST.md` 에 있다.

## 씬 편집

`scene.json` 을 직접 고친다. 좌표 단위는 미터, 평면도 기준으로 X는 오른쪽,
Y는 위쪽이다. 허브가 부팅할 때 검증하며, 참조가 깨졌거나 장비가 구역 밖에
있으면 에러를 내고 죽는다.

WIP 숫자가 실제와 안 맞으면 구간을 비운 상태에서 `wipOffset` 에
`-(in - out)` 을 넣는다. PLC 카운터가 한 바퀴 도는 값이 있으면
`counterMax` 에 적는다 (16비트면 32767).

## 범위

읽기 전용이다. PLC에 쓰지 않는다. 히스토리·알람 통지·인증은 범위 밖이다.
화면은 **어디서** 멈췄는지까지 말한다. **왜** 멈췄는지는 사람이 CCTV를 보고
판단한다.
