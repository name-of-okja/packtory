#!/usr/bin/env node
// 헤드리스 브라우저로 페이지를 찍는다. 웹에는 자동화 테스트를 안 쓰기로 했으므로
// (스펙 결정) 화면이 실제로 뜨는지 보는 유일한 수단이 이것이다.
//
//   node tools/shot.mjs http://localhost:8080/ /tmp/shot.png [대기ms]
//
import { copyFileSync, existsSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"

const CANDIDATES = [
  "chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
]

function findBrowser() {
  for (const c of CANDIDATES) {
    if (c.startsWith("/")) { if (existsSync(c)) return c; continue }
    try { execFileSync("which", [c], { stdio: "ignore" }); return c } catch { /* 없음 */ }
  }
  return null
}

const [url, out, waitMs = "6000"] = process.argv.slice(2)
if (!url || !out) {
  console.error("사용법: node tools/shot.mjs <url> <출력png> [대기ms]")
  process.exit(2)
}

const browser = findBrowser()
if (!browser) {
  console.error("브라우저를 못 찾았다. chromium 또는 google-chrome 을 설치하거나,")
  console.error("WSL 이면 Windows 쪽 Chrome/Edge 가 설치되어 있어야 한다.")
  process.exit(3)
}

// Windows 실행파일은 WSL 경로에 못 쓴다 — Windows 쪽 임시 경로로 찍고 복사해 온다.
// 파일명은 실행마다 고유해야 한다. 고정 이름을 쓰면 이번 실행이 실패했을 때
// 지난번 이미지가 남아 있고, 그걸 복사해 오면서 "찍음" 을 출력한다 —
// 이후 열 태스크의 화면 검증이 통째로 거짓말이 된다.
const isWin = browser.startsWith("/mnt/c/")
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const winWsl = `/mnt/c/Users/Public/packtory-shot-${stamp}.png`
const target = isWin ? `C:\\Users\\Public\\packtory-shot-${stamp}.png` : out
const written = isWin ? winWsl : out

// 이전 산출물이 남아 있으면 지운다. 고유 이름(win)이라 거의 없지만, out 쪽은
// 호출자가 같은 경로를 재사용할 수 있다. rmSync 로 실행 *전에* 지워 두면,
// 이 시점 이후 그 경로에 파일이 있다는 것 자체가 "이번 실행이 썼다"는
// 증거가 된다 — mtime 을 볼 필요가 없다.
//
// 처음에는 mtime 도 비교해서 "이번 실행보다 오래된 파일이면 거부"하는
// 이중 검사를 넣었는데, WSL 쪽 Date.now() 와 Windows 파일시스템이 찍는
// mtime 은 서로 다른 시계라 수 초씩 어긋난다(WSL2 VM 시계 drift). 이 환경의
// 유일한 브라우저가 바로 그 Windows Chrome 이라, mtime 비교를 넣으면 정상
// 실행조차 매번 "낡았다"고 오판하며 죽는다 — 검증했더니 3연속 재현됐다.
// rmSync-먼저 패턴이 이미 신선도를 구조적으로 보장하므로 지웠다.
rmSync(written, { force: true })

execFileSync(browser, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--virtual-time-budget=${waitMs}`,
  "--window-size=1600,1000",
  `--screenshot=${target}`,
  url,
], { stdio: "ignore" })

// 브라우저가 0 으로 끝나고도 아무것도 안 쓸 수 있다 (렌더 크래시, 권한 문제).
// 여기서 크게 실패하지 않으면 없는 화면을 확인했다고 믿게 된다. 위에서 이미
// 지웠으므로, 지금 존재한다는 것은 반드시 이번 실행이 썼다는 뜻이다.
if (!existsSync(written)) {
  console.error(`브라우저가 이미지를 쓰지 않았다: ${written}`)
  console.error(`(${browser} 이 종료코드 0 으로 끝났지만 산출물이 없다)`)
  process.exit(4)
}

if (isWin) {
  copyFileSync(written, out)
  rmSync(written, { force: true })
}
console.log(`찍음: ${out}`)
