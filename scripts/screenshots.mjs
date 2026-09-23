// 產生 README 用的截圖（App Store 風格 iPhone 外框）：node scripts/screenshots.mjs [--png] [home klondike ...]
// - 用無頭 Chrome 載入 App，模擬 iPhone 直向 / 橫向與「加入主畫面」獨立模式後擷圖
// - 再套上 scripts/screenshots-frame.html 的外框、狀態列與標題，輸出到 docs/screenshots/*.webp（加 --png 同時輸出 PNG）
// - 需要本機有 Chrome 或 Edge（找不到時用環境變數 CHROME 指定執行檔），Node 20.10 以上
// - 牌局每次隨機發，重跑圖會不同；只想重出幾張就把檔名當參數：npm run screenshots -- home klondike
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Node 20 / 21 的 WebSocket 要加旗標才有，這裡自動帶旗標重新執行一次
if (typeof WebSocket === 'undefined') {
  if (process.execArgv.includes('--experimental-websocket')) {
    console.error('這個 Node 版本沒有 WebSocket，請改用 Node 20.10 以上');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, ['--experimental-websocket', '--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit' });
  if (r.status === 9) console.error('需要 Node 20.10 以上');
  process.exit(r.status ?? 1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
const args = process.argv.slice(2);
const wantPng = args.includes('--png');
const only = args.filter((a) => !a.startsWith('--'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 模擬的機型：6.3 吋 iPhone（402×874 pt、3x），狀態列 62pt
// 獨立模式下 iOS 27 回報的底部安全區較大，App 端上限 40px（見 style.css 的 --safe-bottom）；橫向時動態島在側邊
const PT = { w: 402, h: 874, status: 62, bottom: 40, landSide: 62, landBottom: 21 };
const NAMES = { klondike: '經典接龍', spider: '蜘蛛接龍', freecell: '新接龍', pyramid: '金字塔', tripeaks: '三峰' };
// 每張圖的檔名、要開的遊戲（沒有就是首頁）、標題與副標；land 為橫向
const SHOTS = [
  { file: 'home', t: '五款接龍，一次收齊', s: '免費、無廣告、可離線，加到主畫面就能玩' },
  { file: 'klondike', game: 'klondike', t: '經典接龍', s: '翻 1 張或 3 張，含時間獎勵計分' },
  { file: 'spider', game: 'spider', t: '蜘蛛接龍', s: '1、2、4 花色三種難度' },
  { file: 'freecell', game: 'freecell', t: '新接龍', s: '牌局編號與 Windows 相同，1–1,000,000 局' },
  { file: 'pyramid', game: 'pyramid', t: '金字塔', s: '「湊 13」對照表，選牌時對應組合亮起' },
  { file: 'tripeaks', game: 'tripeaks', t: '三峰', s: '連消加分，一口氣清光三座山' },
  { file: 'landscape', game: 'klondike', land: true, t: '直向、橫向都能玩', s: '轉向自動重排，牌太小時自動放大角標' },
];
const todo = only.length ? SHOTS.filter((s) => only.includes(s.file)) : SHOTS;
if (!todo.length) {
  console.error(`沒有符合的截圖名稱，可用：${SHOTS.map((s) => s.file).join(' ')}`);
  process.exit(1);
}

// ---------- 找瀏覽器 ----------
const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome 或 Edge，請用環境變數 CHROME 指定執行檔路徑');
  process.exit(1);
}

// ---------- 靜態伺服器：專案根目錄 + 外框樣板 + 記憶體中的原始截圖；不給 sw.js，擷圖時不註冊 Service Worker ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const raw = new Map();
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/sw.js') throw new Error('no sw');
    if (p.startsWith('/__raw/')) {
      const buf = raw.get(p.slice(7));
      if (!buf) throw new Error('no raw');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(buf);
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = p === '/__frame.html' ? join(root, 'scripts', 'screenshots-frame.html') : normalize(join(root, p));
    if (!file.startsWith(root)) throw new Error('bad path');
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- 啟動無頭 Chrome，從 DevToolsActivePort 拿到偵錯埠 ----------
const profile = join(tmpdir(), 'solitaire-screenshots-profile');
await rm(profile, { recursive: true, force: true });
const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--lang=zh-TW',
    '--hide-scrollbars',
    '--window-size=500,1000',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
try {
  let port;
  for (let i = 0; i < 150 && !port; i++) {
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    } catch {}
    if (!port) await sleep(200);
  }
  if (!port) throw new Error('Chrome 沒有啟動');
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch {}
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('找不到 Chrome 分頁');

  // ---------- DevTools Protocol ----------
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else {
      listeners.forEach((l) => l(m));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const waitEvent = (name) =>
    new Promise((r) => {
      const l = (m) => {
        if (m.method === name) {
          listeners.delete(l);
          r(m.params);
        }
      };
      listeners.add(l);
    });
  const nav = async (url) => {
    const loaded = waitEvent('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const metrics = (width, height, deviceScaleFactor, mobile) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height });
  const capture = async (format, quality) => Buffer.from((await send('Page.captureScreenshot', { format, quality })).data, 'base64');
  await send('Page.enable');
  await send('Runtime.enable');

  // ---------- 1. 進 App 擷取原始畫面 ----------
  for (const s of todo) {
    const land = !!s.land;
    await metrics(land ? PT.h : PT.w, land ? PT.w : PT.h - PT.status, 3, true);
    const insets = land
      ? { left: PT.landSide, leftMax: PT.landSide, right: PT.landSide, rightMax: PT.landSide, bottom: PT.landBottom, bottomMax: PT.landBottom }
      : { bottom: PT.bottom, bottomMax: PT.bottom };
    await send('Emulation.setSafeAreaInsetsOverride', { insets });
    await nav(`${base}/index.html`);
    await evaluate(`document.body.classList.add('standalone'); 'ok'`); // 當作已加入主畫面，隱藏安裝提示
    if (s.game) {
      await evaluate(`(async () => {
        for (let i = 0; i < 100; i++) {
          const card = [...document.querySelectorAll('#game-list .gcard')]
            .find((c) => c.querySelector('.gcard-title').textContent.startsWith(${JSON.stringify(NAMES[s.game])}));
          if (card) { card.querySelector('.gcard-main').click(); return 'ok'; }
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error('首頁找不到遊戲卡片：${NAMES[s.game]}');
      })()`);
    }
    await sleep(2200); // 等發牌動畫結束
    raw.set(`${s.file}.png`, await capture('png'));
    console.log(`擷取 ${s.file}`);
  }

  // ---------- 2. 套外框、標題，輸出 ----------
  await mkdir(outDir, { recursive: true });
  await send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  for (const s of todo) {
    const land = !!s.land;
    await send('Emulation.clearDeviceMetricsOverride');
    await metrics(land ? PT.h : PT.w, land ? 470 : PT.h, 2, false);
    const q = new URLSearchParams({ img: `/__raw/${s.file}.png`, t: s.t, s: s.s, land: land ? '1' : '0' });
    await nav(`${base}/__frame.html?${q}`);
    await evaluate(`new Promise((r) => { const i = document.getElementById('img'); if (i.complete && i.naturalWidth) r(1); else i.onload = () => r(1); })`);
    await sleep(300);
    const webp = await capture('webp', 92);
    await writeFile(join(outDir, `${s.file}.webp`), webp);
    let msg = `${s.file}.webp (${Math.round(webp.length / 1024)} KB)`;
    if (wantPng) {
      const png = await capture('png');
      await writeFile(join(outDir, `${s.file}.png`), png);
      msg += `、${s.file}.png (${Math.round(png.length / 1024)} KB)`;
    }
    console.log(`✓ docs/screenshots/${msg}`);
  }
} finally {
  ws?.close();
  proc.kill();
  server.close();
}
