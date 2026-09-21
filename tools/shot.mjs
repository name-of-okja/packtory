#!/usr/bin/env node
// 헤드리스 브라우저로 페이지를 찍는다. 웹에는 자동화 테스트를 안 쓰기로 했으므로
// (스펙 결정) 화면이 실제로 뜨는지 보는 유일한 수단이 이것이다.
//
//   node tools/shot.mjs http://localhost:8080/ /tmp/shot.png [대기ms]
//
import { existsSync, copyFileSync, mkdtempSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
const isWin = browser.startsWith("/mnt/c/")
const winOut = "C:\\Users\\Public\\packtory-shot.png"
const target = isWin ? winOut : out

execFileSync(browser, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--virtual-time-budget=${waitMs}`,
  "--window-size=1600,1000",
  `--screenshot=${target}`,
  url,
], { stdio: "ignore" })

if (isWin) copyFileSync("/mnt/c/Users/Public/packtory-shot.png", out)
console.log(`찍음: ${out}`)
