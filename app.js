// ===========================
// СПОРТ ДНЕВНИК — WebApp v0.2
// Бэкенд: Google Apps Script (плоский план)
// ===========================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby13Q30X_zwMIAGlak9L4uj_P-00Ak75_hFrxrhvC54nhH2qitukv8eHWqtSL1m-nge/exec';
const STORAGE_KEY = 'workout_log_v1';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

function todayKey() { return new Date().toISOString().slice(0, 10); }
function dayNameRu(d = new Date()) { return ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][d.getDay()]; }

function loadLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function saveLocal(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function getTodayLocal() { return loadLocal()[todayKey()] || {}; }
function setLocal(flatIdx, reps) { const l = loadLocal(); const k = todayKey(); if (!l[k]) l[k] = {}; l[k][flatIdx] = { reps, at: Date.now() }; saveLocal(l); }

async function apiGet(userId, date) {
  const url = `${APPS_SCRIPT_URL}?user_id=${userId}&date=${date}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function apiPost(payload) {
  const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let currentUser = null;
let todayPlan = [];   // плоский массив

async function init() {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    currentUser = Telegram.WebApp.initDataUnsafe?.user?.id;
  }
  if (!currentUser) currentUser = 594920142; // fallback для теста в браузере

  $('#dayBadge').textContent = dayNameRu();
  const date = todayKey();
  try {
    const data = await apiGet(currentUser, date);
    todayPlan = data.plan || [];
  } catch (e) {
    console.error('Load error', e);
    todayPlan = [];
  }
  render();
}

function render() {
  const cont = $('#exerciseList');
  cont.innerHTML = '';
  const local = getTodayLocal();

  // Группируем по упражнению, но храним плоский индекс
  const groups = {};
  todayPlan.forEach((item, flatIdx) => {
    if (!groups[item.exercise]) groups[item.exercise] = [];
    groups[item.exercise].push({ ...item, flatIdx });
  });

  Object.entries(groups).forEach(([exName, items]) => {
    const g = document.createElement('div');
    g.className = 'exercise-group';
    const h = document.createElement('div');
    h.className = 'exercise-header';
    h.textContent = exName;
    g.appendChild(h);

    items.forEach((s, si) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      const done = local[s.flatIdx]?.reps != null;
      if (done) row.classList.add('completed');
      const target = typeof s.targetReps === 'string' ? s.targetReps : s.targetReps + ' повторов';
      row.innerHTML = `
        <div class="set-info">
          <span class="set-label">${s.setType === 'warmup' ? 'Разминка' : 'Рабочий'} ${s.setNum}</span>
          <span class="set-weight">${s.weight} кг</span>
          <span class="set-target">цель: ${target}</span>
        </div>
        <input type="number" class="set-reps-input" placeholder="—" min="0" max="99"
          data-flat="${s.flatIdx}" ${done ? 'value="' + local[s.flatIdx].reps + '"' : ''}>
        <button class="set-done ${done ? 'done' : ''}" data-flat="${s.flatIdx}">${done ? '✓' : '✕'}</button>
      `;
      g.appendChild(row);
    });
    cont.appendChild(g);
  });

  bindEvents();
  updateSyncStatus();
}

function bindEvents() {
  $$('.set-reps-input').forEach(inp => {
    inp.oninput = () => inp.classList.toggle('filled', inp.value !== '');
    inp.onchange = async e => {
      const v = +e.target.value;
      if (!isNaN(v) && v >= 0) await saveSet(+e.target.dataset.flat, v);
    };
  });
  $$('.set-done').forEach(btn => {
    btn.onclick = async () => {
      const flat = +btn.dataset.flat;
      const l = getTodayLocal();
      if (l[flat]?.reps != null) {
        delete l[flat];
        saveLocal(l);
      } else {
        const v = +prompt('Сколько повторов сделано?', 5);
        if (!isNaN(v) && v >= 0) await saveSet(flat, v);
      }
      render();
    };
  });
}

async function saveSet(flatIdx, reps) {
  setLocal(flatIdx, reps);
  const s = todayPlan[flatIdx];
  if (!s) return;
  try {
    await apiPost({
      user_id: currentUser,
      week: s.week, day: s.day, exercise: s.exercise,
      set_num: s.setNum, set_type: s.setType,
      weight: s.weight, target_reps: s.targetReps, actual_reps: reps
    });
  } catch (e) {
    console.warn('Sync failed (local saved)', e);
  }
}

function updateSyncStatus() {
  const l = getTodayLocal();
  const done = Object.keys(l).length;
  $('#syncStatus').textContent = done > 0 ? `🟢 Локально (${done}/${todayPlan.length})` : '🟡 Пусто';
}

async function syncAll() {
  const l = getTodayLocal();
  let ok = 0, fail = 0;
  for (const flatIdx of Object.keys(l)) {
    const s = todayPlan[flatIdx];
    if (!s) continue;
    try {
      await apiPost({
        user_id: currentUser,
        week: s.week, day: s.day, exercise: s.exercise,
        set_num: s.setNum, set_type: s.setType,
        weight: s.weight, target_reps: s.targetReps, actual_reps: l[flatIdx].reps
      });
      ok++;
    } catch { fail++; }
  }
  $('#syncStatus').textContent = `🟢 Отправлено: ${ok}, ошибок: ${fail}`;
  setTimeout(updateSyncStatus, 2000);
}

document.addEventListener('DOMContentLoaded', init);
