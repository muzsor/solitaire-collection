// 應用程式主體：畫面切換、設定、統計、存檔、按鈕

import { GAMES, GAME_BY_ID } from './games/index.js';
import { Game } from './engine.js';
import { Renderer } from './render.js';
import { RULES } from './rules.js';
import { randomSeed } from './rng.js';
import * as Sound from './sound.js';

const $ = (s) => document.querySelector(s);

// 版本資訊由 version.js 提供（index.html 與 sw.js 共用同一份）；APP_BUILD 只給 Service Worker 用
const APP_VERSION = window.APP_VERSION || '?';

// ---------- 本機儲存 ----------
function load(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}
function save(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}
function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

const DEFAULT_SETTINGS = {
  draw3: false,
  spiderSuits: 1,
  freecellCells: 4,
  pyramidPasses: 2,
  leftHand: false,
  sound: true,
  cardBack: 'blue',
  table: 'green',
  bigFont: false,
  showTimer: true,
};
let settings = { ...DEFAULT_SETTINGS, ...load('sol.settings', {}) };

function saveSettings() {
  save('sol.settings', settings);
  applySettings();
}
// 桌面顏色對應的實際色碼，要和 style.css 的 --table 一致
const TABLE_COLORS = { green: '#23613c', blue: '#234a73', gray: '#2b2e33', purple: '#45305f' };

function applySettings() {
  // 寫在 <html> 上，iPhone 的狀態列與底部安全區才會跟著變色
  const root = document.documentElement;
  root.dataset.table = settings.table;
  root.dataset.back = settings.cardBack;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = TABLE_COLORS[settings.table] || TABLE_COLORS.green;
  document.body.classList.toggle('big-font', settings.bigFont);
  document.body.classList.toggle('no-timer', !settings.showTimer);
  Sound.setSoundEnabled(settings.sound);
  if (renderer) renderer.relayout();
}

const EMPTY_STATS = { played: 0, won: 0, bestTime: null, bestScore: null, streak: 0, bestStreak: 0 };
function getStats(id) {
  return { ...EMPTY_STATS, ...load('sol.stats.' + id, {}) };
}
function setStats(id, s) {
  save('sol.stats.' + id, s);
}
function saveKey(id) {
  return 'sol.save.' + id;
}

// ---------- 狀態 ----------
let current = null; // { game, elapsed, runningSince, counted, lostShown }
let renderer = null;
let timerHandle = null;

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------- 畫面 ----------
function showScreen(name) {
  $('#home').classList.toggle('hidden', name !== 'home');
  $('#game').classList.toggle('hidden', name !== 'game');
}

function optionsFor(id) {
  if (id === 'klondike') return { draw3: settings.draw3 };
  if (id === 'spider') return { suits: settings.spiderSuits };
  if (id === 'freecell') return { cells: settings.freecellCells };
  if (id === 'pyramid') return { passes: settings.pyramidPasses };
  return {};
}

// 各遊戲的難度選項（首頁卡片與設定頁共用）
const GAME_OPTIONS = {
  klondike: {
    key: 'draw3',
    label: '經典接龍翻牌',
    items: [
      { v: false, label: '翻 1 張', short: '1 張' },
      { v: true, label: '翻 3 張', short: '3 張' },
    ],
  },
  spider: {
    key: 'spiderSuits',
    label: '蜘蛛接龍花色',
    items: [
      { v: 1, label: '1 花色', short: '1' },
      { v: 2, label: '2 花色', short: '2' },
      { v: 4, label: '4 花色', short: '4' },
    ],
  },
  freecell: {
    key: 'freecellCells',
    label: '新接龍暫存格',
    items: [
      { v: 4, label: '4 格', short: '4' },
      { v: 3, label: '3 格', short: '3' },
      { v: 2, label: '2 格', short: '2' },
      { v: 1, label: '1 格', short: '1' },
    ],
  },
  pyramid: {
    key: 'pyramidPasses',
    label: '金字塔重翻',
    items: [
      { v: -1, label: '重翻無限', short: '無限' },
      { v: 2, label: '重翻 2 次', short: '2 次' },
      { v: 0, label: '不可重翻', short: '不可' },
    ],
  },
};

function optionControl(id, useShort) {
  const spec = GAME_OPTIONS[id];
  if (!spec) return null;
  const items = spec.items.map((it) => ({ v: it.v, label: useShort ? it.short : it.label }));
  return segmented(items, settings[spec.key], (v) => {
    settings[spec.key] = v;
    saveSettings();
  });
}

function renderHome() {
  const list = $('#game-list');
  list.innerHTML = '';
  for (const G of GAMES) {
    const m = G.meta;
    const st = getStats(m.id);
    const saved = load(saveKey(m.id), null);
    const inProgress = saved && saved.game && saved.game.moves > 0 && !saved.game.won;
    const card = document.createElement('div');
    card.className = 'gcard';
    const rate = st.played ? Math.round((st.won / st.played) * 100) : 0;
    let statLine = `勝 ${st.won} / ${st.played} 局`;
    if (st.played) statLine += ` · ${rate}%`;
    if (st.bestTime) statLine += ` · 最佳 ${fmtTime(st.bestTime)}`;
    if (m.hasScore && st.bestScore != null) statLine += ` · 最高 ${st.bestScore} 分`;
    card.innerHTML = `
      <div class="gcard-main">
        <div class="gcard-title">${m.name}<span class="en">${m.en}</span>${inProgress ? '<span class="chip">進行中</span>' : ''}</div>
        <div class="gcard-desc">${m.desc}</div>
        <div class="gcard-stats">${statLine}</div>
      </div>
      <div class="gcard-foot"></div>`;
    const foot = card.querySelector('.gcard-foot');
    const ctrl = optionControl(m.id, false);
    if (ctrl) foot.appendChild(ctrl);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    foot.appendChild(spacer);
    if (inProgress) {
      const b1 = button('繼續', 'btn primary', () => startGame(m.id, 'resume'));
      const b2 = button('新局', 'btn', () => {
        showModal({
          title: `${m.name}：發新局？`,
          html: '<p>目前進行中的那一局會算作放棄，連勝紀錄會歸零。</p>',
          buttons: [
            { label: '取消' },
            {
              label: '發新局',
              primary: true,
              onClick: () => {
                abandonSaved(m.id);
                startGame(m.id, 'new');
              },
            },
          ],
        });
      });
      foot.append(b1, b2);
    } else {
      foot.appendChild(button('開始', 'btn primary', () => startGame(m.id, 'new')));
    }
    card.querySelector('.gcard-main').addEventListener('click', () => startGame(m.id, inProgress ? 'resume' : 'new'));
    list.appendChild(card);
  }
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function segmented(items, value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  const render = () => {
    wrap.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it.label;
      if (it.v === value) b.classList.add('on');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        value = it.v;
        onChange(value);
        render();
      });
      wrap.appendChild(b);
    }
  };
  render();
  return wrap;
}

// ---------- 遊戲流程 ----------
function abandonSaved(id) {
  const saved = load(saveKey(id), null);
  if (saved && saved.game && saved.game.moves > 0 && !saved.game.won) {
    const st = getStats(id);
    st.streak = 0;
    setStats(id, st);
  }
  remove(saveKey(id));
}

function abandonCurrent() {
  if (!current) return;
  const g = current.game;
  if (!g.won && g.moves > 0) {
    const st = getStats(g.meta.id);
    st.streak = 0;
    setStats(g.meta.id, st);
  }
  remove(saveKey(g.meta.id));
}

function startGame(id, mode, extraOptions) {
  const Cls = GAME_BY_ID[id];
  let game = null;
  let elapsed = 0;
  if (mode === 'resume') {
    const data = load(saveKey(id), null);
    if (data && data.game) {
      try {
        game = Game.deserialize(Cls, data.game);
        elapsed = data.elapsed || 0;
      } catch (e) {
        console.error('存檔讀取失敗', e);
        game = null;
      }
    }
  }
  if (!game) {
    if (mode === 'replay' && current && current.game.meta.id === id) {
      game = new Cls(current.game.seed, current.game.options);
    } else {
      game = new Cls(randomSeed(), { ...optionsFor(id), ...(extraOptions || {}) });
    }
    game.boot();
  }
  setupGame(game, elapsed);
}

function setupGame(game, elapsed) {
  stopTimer();
  current = { game, elapsed, runningSince: null, counted: game.moves > 0, lostShown: false };
  const m = game.meta;
  showScreen('game');
  $('#g-title').textContent = m.name;
  $('#g-sub').textContent = game.subtitle();
  $('#btn-collect').classList.toggle('hidden', !m.hasAutoCollect);
  $('#hud-score').classList.toggle('hidden', !m.hasScore);
  renderer.setGame(game, { deal: game.moves === 0 });
  game.on('change', onChange);
  game.on('win', onWin);
  game.on('message', (msg) => toast(msg));
  updateHud();
  updateDeadEnd();
  saveCurrent();
  if (game.moves > 0 && !game.won) startTimer();
}

function onChange() {
  const g = current.game;
  if (!current.counted && g.moves > 0) {
    current.counted = true;
    const st = getStats(g.meta.id);
    st.played++;
    setStats(g.meta.id, st);
  }
  if (g.moves > 0 && !g.won) startTimer();
  updateHud();
  saveCurrent();
  Sound.playPlace();
  updateDeadEnd();
}

// 無路可走時顯示常駐橫幅，直到局面改變（復原、重來、新局）
function updateDeadEnd() {
  const bar = $('#deadend');
  const g = current && current.game;
  const stuck = !!g && !g.won && g.moves > 0 && !g.hasMoves();
  bar.classList.toggle('hidden', !stuck);
  if (stuck && !current.lostShown) {
    current.lostShown = true;
    Sound.playError();
  }
  if (!stuck && current) current.lostShown = false;
}

function onWin() {
  stopTimer();
  const g = current.game;
  const ms = current.elapsed;
  const seconds = Math.max(1, Math.round(ms / 1000));
  const bonus = g.meta.hasScore ? g.winBonus(seconds) : 0;
  const finalScore = g.score + bonus;
  const st = getStats(g.meta.id);
  st.won++;
  st.streak++;
  st.bestStreak = Math.max(st.bestStreak, st.streak);
  const newTime = ms > 0 && (st.bestTime == null || ms < st.bestTime);
  if (newTime) st.bestTime = ms;
  const newScore = g.meta.hasScore && (st.bestScore == null || finalScore > st.bestScore);
  if (newScore) st.bestScore = finalScore;
  setStats(g.meta.id, st);
  remove(saveKey(g.meta.id));
  updateHud();
  Sound.playWin();
  celebrate();
  setTimeout(() => {
    let html = `<div class="win-stats">
      <div><span>時間</span><b>${fmtTime(ms)}${newTime ? ' <em>新紀錄</em>' : ''}</b></div>
      <div><span>步數</span><b>${g.moves}</b></div>`;
    if (g.meta.hasScore) {
      html += `<div><span>分數</span><b>${g.score}${bonus ? ` + ${bonus} 時間獎勵` : ''}</b></div>
      <div><span>總分</span><b>${finalScore}${newScore ? ' <em>新紀錄</em>' : ''}</b></div>`;
    }
    html += `<div><span>連勝</span><b>${st.streak}</b></div></div>`;
    showModal({
      title: '🎉 恭喜完成！',
      html,
      sticky: true,
      buttons: [
        { label: '回選單', onClick: goHome },
        { label: '再玩一局', primary: true, onClick: () => startGame(g.meta.id, 'new') },
      ],
    });
  }, 900);
}

function celebrate() {
  const table = $('#table');
  const cards = [...table.querySelectorAll('.card')];
  cards.forEach((el, i) => {
    el.style.transition = 'transform .8s cubic-bezier(.2,.8,.3,1.2)';
    const x = (Math.random() - 0.5) * table.clientWidth * 0.8;
    const y = (Math.random() - 0.5) * table.clientHeight * 0.6;
    const r = (Math.random() - 0.5) * 60;
    setTimeout(() => {
      el.style.transform += ` translate(${x}px, ${y}px) rotate(${r}deg)`;
    }, i * 12);
  });
  setTimeout(() => cards.forEach((el) => (el.style.transition = '')), 1800);
}

function updateHud() {
  if (!current) return;
  const g = current.game;
  $('#hud-time').textContent = fmtTime(getElapsed());
  $('#hud-moves').textContent = `${g.moves} 步`;
  $('#hud-score').textContent = g.meta.hasScore ? `${g.score} 分` : '';
  $('#btn-undo').disabled = !g.canUndo();
}

function getElapsed() {
  if (!current) return 0;
  return current.elapsed + (current.runningSince ? Date.now() - current.runningSince : 0);
}
function startTimer() {
  if (!current || current.runningSince) return;
  current.runningSince = Date.now();
  if (!timerHandle) timerHandle = setInterval(updateHud, 500);
}
function stopTimer() {
  if (current && current.runningSince) {
    current.elapsed += Date.now() - current.runningSince;
    current.runningSince = null;
  }
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function saveCurrent() {
  if (!current) return;
  const g = current.game;
  if (g.won) {
    remove(saveKey(g.meta.id));
    return;
  }
  save(saveKey(g.meta.id), { game: g.serialize(), elapsed: getElapsed() });
}

function goHome() {
  stopTimer();
  saveCurrent();
  current = null;
  renderHome();
  showScreen('home');
}

function newGame(mode, extraOptions) {
  if (!current) return;
  const id = current.game.meta.id;
  abandonCurrent();
  startGame(id, mode, extraOptions);
}

// 回到這局開頭：牌序不變、計時與步數歸零，不影響連勝
function restartCurrent() {
  if (!current) return;
  const g = current.game;
  if (!g.restart()) {
    toast('這局還沒開始，沒有可以重來的步');
    return;
  }
  stopTimer();
  current.elapsed = 0;
  current.lostShown = false;
  updateHud();
  saveCurrent();
}

function confirmRestart() {
  if (!current) return;
  if (current.game.moves === 0) {
    toast('這局還沒開始');
    return;
  }
  showModal({
    title: '回到這局開頭？',
    html: '<p>牌序不變，步數、時間與分數會歸零。這不算放棄，連勝紀錄不受影響。</p>',
    buttons: [{ label: '取消' }, { label: '重新開始', primary: true, onClick: restartCurrent }],
  });
}

// ---------- 對話框與提示 ----------
function showModal({ title, html, buttons = [], sticky = false, cls = '' }) {
  const root = $('#modal-root');
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal ${cls}"><h2>${title}</h2><div class="modal-body">${html}</div><div class="modal-buttons"></div></div>`;
  const close = () => bd.remove();
  const btnWrap = bd.querySelector('.modal-buttons');
  for (const b of buttons) {
    const el = button(b.label, 'btn' + (b.primary ? ' primary' : ''), () => {
      close();
      b.onClick && b.onClick();
    });
    btnWrap.appendChild(el);
  }
  if (!buttons.length) btnWrap.remove();
  if (!sticky) {
    bd.addEventListener('click', (e) => {
      if (e.target === bd) close();
    });
  }
  root.appendChild(bd);
  return { close, el: bd };
}

let toastTimer = null;
function toast(msg, action, duration = 2500) {
  const t = $('#toast');
  t.innerHTML = `<span>${msg}</span>`;
  if (action) {
    const b = button(action.label, '', () => {
      hideToast();
      action.fn();
    });
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}
function hideToast() {
  $('#toast').classList.remove('show');
}

function showRules(id) {
  const m = GAME_BY_ID[id].meta;
  showModal({ title: `${m.name} 規則`, html: RULES[id] || '', buttons: [{ label: '知道了', primary: true }] });
}

function showStats(id) {
  const ids = id ? [id] : GAMES.map((G) => G.meta.id);
  let html = '';
  for (const gid of ids) {
    const m = GAME_BY_ID[gid].meta;
    const st = getStats(gid);
    const rate = st.played ? Math.round((st.won / st.played) * 100) : 0;
    html += `<h3>${m.name}</h3><table class="stats">
      <tr><td>局數</td><td>${st.played}</td><td>勝場</td><td>${st.won}</td></tr>
      <tr><td>勝率</td><td>${rate}%</td><td>最佳時間</td><td>${st.bestTime ? fmtTime(st.bestTime) : '—'}</td></tr>
      <tr><td>目前連勝</td><td>${st.streak}</td><td>最長連勝</td><td>${st.bestStreak}</td></tr>
      ${m.hasScore ? `<tr><td>最高分</td><td colspan="3">${st.bestScore ?? '—'}</td></tr>` : ''}
    </table>`;
  }
  showModal({
    title: '統計',
    html,
    buttons: [
      {
        label: '清除統計',
        onClick: () =>
          showModal({
            title: '確定清除？',
            html: '<p>會刪除所有遊戲的勝場與紀錄，無法復原。</p>',
            buttons: [
              { label: '取消' },
              {
                label: '清除',
                primary: true,
                onClick: () => {
                  for (const G of GAMES) remove('sol.stats.' + G.meta.id);
                  if (!current) renderHome();
                },
              },
            ],
          }),
      },
      { label: '關閉', primary: true },
    ],
  });
}

function showSettings() {
  const rows = [];
  const row = (label, control) => {
    const d = document.createElement('div');
    d.className = 'setting-row';
    const l = document.createElement('span');
    l.textContent = label;
    d.append(l, control);
    rows.push(d);
  };
  const toggle = (key) => {
    const lab = document.createElement('label');
    lab.className = 'switch';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = !!settings[key];
    inp.addEventListener('change', () => {
      settings[key] = inp.checked;
      saveSettings();
    });
    const knob = document.createElement('span');
    lab.append(inp, knob);
    return lab;
  };
  const seg = (key, items) =>
    segmented(items, settings[key], (v) => {
      settings[key] = v;
      saveSettings();
    });

  for (const id of Object.keys(GAME_OPTIONS)) row(GAME_OPTIONS[id].label, optionControl(id, true));
  row('左手模式', toggle('leftHand'));
  row('大字模式', toggle('bigFont'));
  row('顯示計時', toggle('showTimer'));
  row('音效', toggle('sound'));
  row(
    '桌面顏色',
    seg('table', [
      { v: 'green', label: '綠' },
      { v: 'blue', label: '藍' },
      { v: 'gray', label: '灰' },
      { v: 'purple', label: '紫' },
    ])
  );
  row(
    '牌背顏色',
    seg('cardBack', [
      { v: 'blue', label: '藍' },
      { v: 'red', label: '紅' },
      { v: 'black', label: '黑' },
      { v: 'green', label: '綠' },
    ])
  );
  const m = showModal({ title: '設定', html: '', buttons: [{ label: '完成', primary: true, onClick: () => !current && renderHome() }] });
  const body = m.el.querySelector('.modal-body');
  rows.forEach((r) => body.appendChild(r));
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = '難度選項會在下一局生效。';
  body.appendChild(note);
  const dataRow = document.createElement('div');
  dataRow.className = 'setting-row';
  dataRow.append(
    Object.assign(document.createElement('span'), { textContent: '資料備份' }),
    button('匯出 / 匯入', 'btn small', () => {
      m.close();
      showBackup();
    })
  );
  body.appendChild(dataRow);
}

// ---------- 資料備份：把統計、設定、進行中的牌局匯出成一段文字 ----------
const BACKUP_PREFIX = 'SOL1:';

function exportData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('sol.')) data[k] = localStorage.getItem(k);
  }
  const json = JSON.stringify({ v: 1, at: new Date().toISOString(), data });
  return BACKUP_PREFIX + btoa(unescape(encodeURIComponent(json)));
}

function importData(text) {
  const t = (text || '').trim();
  if (!t.startsWith(BACKUP_PREFIX)) throw new Error('格式不對，開頭應該是 ' + BACKUP_PREFIX);
  const json = decodeURIComponent(escape(atob(t.slice(BACKUP_PREFIX.length))));
  const parsed = JSON.parse(json);
  if (!parsed || parsed.v !== 1 || typeof parsed.data !== 'object') throw new Error('內容無法解讀');
  let n = 0;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k.startsWith('sol.') && typeof v === 'string') {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return { count: n, at: parsed.at };
}

function showBackup() {
  const code = exportData();
  const m = showModal({
    title: '資料備份',
    html: `<p class="note">內容包含統計、設定與進行中的牌局。複製這段文字保存，換手機或清除瀏覽器資料後貼回來就能還原。</p>
      <textarea id="backup-out" readonly rows="4"></textarea>
      <div class="row-btns"><button id="backup-copy" class="btn small">複製</button><span id="backup-msg" class="note"></span></div>
      <p class="note" style="margin-top:14px">還原：把之前複製的文字貼在下面，會覆蓋目前的資料。</p>
      <textarea id="backup-in" rows="3" placeholder="${BACKUP_PREFIX}…"></textarea>`,
    buttons: [{ label: '關閉' }, { label: '匯入並還原', primary: true, onClick: () => doImport(m.el.querySelector('#backup-in').value) }],
  });
  const out = m.el.querySelector('#backup-out');
  out.value = code;
  m.el.querySelector('#backup-copy').addEventListener('click', async () => {
    const msg = m.el.querySelector('#backup-msg');
    try {
      await navigator.clipboard.writeText(code);
      msg.textContent = '已複製';
    } catch {
      out.focus();
      out.select();
      msg.textContent = '請長按文字框全選複製';
    }
  });
}

function doImport(text) {
  let result;
  try {
    result = importData(text);
  } catch (e) {
    toast('匯入失敗：' + e.message, null, 4000);
    return;
  }
  settings = { ...DEFAULT_SETTINGS, ...load('sol.settings', {}) };
  applySettings();
  if (!current) renderHome();
  toast(`已還原 ${result.count} 筆資料`);
}

function showMenu() {
  const g = current.game;
  const m = showModal({ title: g.meta.name, html: '<div class="menu-list"></div>' });
  const list = m.el.querySelector('.menu-list');
  const item = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      m.close();
      fn();
    });
    list.appendChild(b);
  };
  item('回到這局開頭', confirmRestart);
  item('規則說明', () => showRules(g.meta.id));
  item('統計', () => showStats(g.meta.id));
  item('設定', showSettings);
  if (g.meta.id === 'freecell') item('輸入牌局編號…', showDealInput);
  item('回到選單', goHome);
}

function showDealInput() {
  const m = showModal({
    title: '輸入牌局編號',
    html: '<p>輸入 1 到 32000 之間的編號，與 Windows 新接龍的牌局相同。</p><input id="deal-input" type="number" min="1" max="32000" inputmode="numeric" placeholder="例如 11982">',
    buttons: [
      { label: '取消' },
      {
        label: '開始',
        primary: true,
        onClick: () => {
          const v = parseInt(m.el.querySelector('#deal-input').value, 10);
          if (!v || v < 1 || v > 32000) {
            toast('請輸入 1 到 32000 的數字');
            return;
          }
          newGame('new', { deal: v });
        },
      },
    ],
  });
  setTimeout(() => m.el.querySelector('#deal-input').focus(), 50);
}

function confirmNewGame() {
  const g = current.game;
  const inProgress = g.moves > 0 && !g.won;
  const buttons = [{ label: '取消' }];
  if (inProgress) buttons.push({ label: '回到這局開頭', onClick: restartCurrent });
  buttons.push({ label: '發新局', primary: true, onClick: () => newGame('new') });
  showModal({
    title: '新局',
    html: inProgress
      ? '<p><b>回到這局開頭</b>：同一副牌重來，不算放棄。<br><b>發新局</b>：目前這局算作放棄，連勝紀錄會歸零。</p>'
      : '',
    buttons,
  });
}

function autoCollect() {
  const g = current.game;
  const step = () => {
    if (!current || current.game !== g || g.won) return;
    if (g.autoCollectStep()) setTimeout(step, 130);
  };
  if (!g.autoCollectStep()) {
    toast('目前沒有可以收的牌');
    return;
  }
  setTimeout(step, 130);
}

// ---------- Service Worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const onWaiting = (sw) => {
        toast('有新版本可用', {
          label: '更新',
          fn: () => sw.postMessage('skipWaiting'),
        }, 15000);
      };
      if (reg.waiting && navigator.serviceWorker.controller) onWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) onWaiting(sw);
        });
      });
    })
    .catch((e) => console.warn('SW 註冊失敗', e));
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    saveCurrent();
    location.reload();
  });
}

// ---------- 啟動 ----------
function init() {
  applySettings();
  renderer = new Renderer($('#table'), () => settings);

  $('#btn-settings').addEventListener('click', showSettings);
  $('#btn-stats-home').addEventListener('click', () => showStats(null));
  $('#btn-back').addEventListener('click', goHome);
  // 復原：點一下退一步；長按 0.6 秒跳出「回到這局開頭」
  // 以位移距離判斷取消，手指稍微滑動不會中斷長按
  const undoBtn = $('#btn-undo');
  let undoHold = null;
  let undoLongPressed = false;
  let holdStart = null;
  const cancelHold = () => {
    if (undoHold) clearTimeout(undoHold);
    undoHold = null;
    holdStart = null;
    undoBtn.classList.remove('holding');
  };
  undoBtn.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    undoLongPressed = false;
    holdStart = { x: e.clientX, y: e.clientY };
    undoBtn.classList.add('holding');
    undoHold = setTimeout(() => {
      undoHold = null;
      undoLongPressed = true;
      undoBtn.classList.remove('holding');
      confirmRestart();
    }, 600);
  });
  window.addEventListener('pointermove', (e) => {
    if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 16) cancelHold();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => window.addEventListener(ev, cancelHold));
  undoBtn.addEventListener('click', () => {
    if (undoLongPressed) {
      undoLongPressed = false;
      return;
    }
    if (!current || !current.game.undo()) toast('沒有可以復原的步。長按可回到這局開頭');
  });
  $('#btn-hint').addEventListener('click', () => {
    if (!current) return;
    const h = current.game.hint();
    if (!renderer.showHint(h)) toast('找不到可走的步，這局可能卡住了');
  });
  $('#btn-collect').addEventListener('click', autoCollect);
  $('#btn-new').addEventListener('click', confirmNewGame);
  $('#btn-menu').addEventListener('click', showMenu);
  $('#dead-undo').addEventListener('click', () => current && current.game.undo());
  $('#dead-restart').addEventListener('click', restartCurrent);
  $('#dead-new').addEventListener('click', () => newGame('new'));

  document.addEventListener('pointerdown', Sound.primeAudio, { once: true });

  // iPhone Safari 雙擊會放大頁面：第二下快速點擊時取消預設行為
  // 按鈕與輸入框除外（它們靠 CSS touch-action 處理，且需要保留 click）
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 350 && !e.target.closest('button, input, select, label, a')) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimer();
      saveCurrent();
    } else if (current && current.game.moves > 0 && !current.game.won) {
      startTimer();
    }
  });
  window.addEventListener('pagehide', saveCurrent);
  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      current.game.undo();
    }
  });

  $('#app-version').textContent = `v${APP_VERSION}`;
  renderHome();
  showScreen('home');
  registerSW();
  // 除錯用：在主控台可透過 __sol.game 取得目前遊戲
  window.__sol = {
    get game() {
      return current && current.game;
    },
  };
}

init();
