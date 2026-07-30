// ===========================
// СПОРТ ДНЕВНИК — WebApp v0.6
// Сверху: выбор Недели (1-4) и Упражнения. Дефолт = сегодня.
// Ввод повторов ВСЕГДА активен (можно доделать в другой день).
// Сохранение привязано к дате схемы, а не к сегодня.
// ===========================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby13Q30X_zwMIAGlak9L4uj_P-00Ak75_hFrxrhvC54nhH2qitukv8eHWqtSL1m-nge/exec';
const STORAGE_KEY = 'workout_log_v1';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

const WEEK_LABELS = { 1: 'Неделя 1', 2: 'Неделя 2', 3: 'Неделя 3', 4: 'Разгрузка' };
const EX_LIST = ['Приседания', 'Жим стоя', 'Жим лёжа', 'Становая тяга'];

function todayKey() { return new Date().toISOString().slice(0, 10); }
function dayNameRu(d = new Date()) { return ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][d.getDay()]; }

function loadLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function saveLocal(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }

// Ключ хранилища: дата схемы + упражнение + подход (чтобы разные дни не перезаписывались)
function lk(dateStr, item) { return `${dateStr}|${item.exercise}|${item.setNum}|${item.setType}`; }
function getStoredFor(dateStr) { return loadLocal()[dateStr] || {}; }
function setStored(dateStr, key, reps) {
  const l = loadLocal();
  if (!l[dateStr]) l[dateStr] = {};
  l[dateStr][key] = { reps, at: Date.now() };
  saveLocal(l);
}

async function apiGet(params) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${APPS_SCRIPT_URL}?${q}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function apiPost(payload) {
  const r = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let currentUser = null;
let state = { week: null, exercise: null, plan: [], schemeDate: null, isToday: false };
let allPlansByKey = {};
let saveTimers = {};

async function init() {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    currentUser = Telegram.WebApp.initDataUnsafe?.user?.id;
  }
  if (!currentUser) currentUser = 594920142;

  buildSelectors();
  await loadToday();
}

async function loadToday() {
  const date = todayKey();
  try {
    const data = await apiGet({ user_id: currentUser, date });
    const plan = data.plan || [];
    if (plan.length) {
      state.week = plan[0].week;
      state.exercise = plan[0].exercise;
      state.plan = plan;
      state.schemeDate = date;
      state.isToday = true;
    } else {
      state.week = 1;
      state.exercise = EX_LIST[0];
      state.isToday = false;
      await loadScheme(state.week, state.exercise);
      render();
      return;
    }
  } catch (e) {
    console.error('Load error', e);
    state.week = 1; state.exercise = EX_LIST[0]; state.isToday = false;
  }
  render();
}

async function loadScheme(week, exercise) {
  try {
    const data = await apiGet({ user_id: currentUser, week, exercise });
    state.plan = data.plan || [];
    state.schemeDate = data.schemeDate || null;
    state.isToday = (data.schemeDate === todayKey());
  } catch (e) {
    console.error('Scheme load error', e);
    state.plan = [];
  }
}

function buildSelectors() {
  const weekSel = $('#weekSelect');
  const exSel = $('#exSelect');
  [1, 2, 3, 4].forEach(w => {
    const o = document.createElement('option');
    o.value = w; o.textContent = WEEK_LABELS[w];
    weekSel.appendChild(o);
  });
  EX_LIST.forEach(ex => {
    const o = document.createElement('option');
    o.value = ex; o.textContent = ex;
    exSel.appendChild(o);
  });
  weekSel.onchange = onSelect;
  exSel.onchange = onSelect;
}

async function onSelect() {
  state.week = parseInt($('#weekSelect').value);
  state.exercise = $('#exSelect').value;
  await loadScheme(state.week, state.exercise);
  render();
}

function targetText(t) { return typeof t === 'string' ? t : (t + ' повторов'); }

function render() {
  $('#dayBadge').textContent = state.isToday ? dayNameRu() + ' • сегодня' : (WEEK_LABELS[state.week] || '');
  $('#weekSelect').value = state.week;
  $('#exSelect').value = state.exercise;

  const cont = $('#exerciseList');
  cont.innerHTML = '';
  const local = getStoredFor(state.schemeDate);
  allPlansByKey = {};

  if (state.plan.length === 0) {
    cont.innerHTML = '<div class="empty">Нет данных для выбора 💤</div>';
    updateSyncStatus();
    return;
  }

  const works = state.plan.filter(s => s.setType === 'work');
  const lastWork = works[works.length - 1];
  const editableKey = lastWork ? lk(state.schemeDate, lastWork) : null;

  const g = document.createElement('div');
  g.className = 'exercise-group';
  const h = document.createElement('div');
  h.className = 'exercise-header';
  h.textContent = state.exercise;
  g.appendChild(h);

  state.plan.forEach(s => {
    const key = lk(state.schemeDate, s);
    allPlansByKey[key] = s;
    const editable = (key === editableKey); // ВСЕГДА редактируем последний рабочий
    const saved = local[key];

    const row = document.createElement('div');
    row.className = 'set-row ' + (editable ? 'editable' : 'readonly') + (saved ? ' completed' : '');

    const left = `
      <div class="set-info">
        <span class="set-label">${s.setType === 'warmup' ? 'Разминка' : 'Рабочий'} ${s.setNum}</span>
        <span class="set-weight">${s.weight} кг</span>
        <span class="set-target">цель: ${targetText(s.targetReps)}</span>
      </div>`;

    if (editable) {
      row.innerHTML = left + `
        <input type="number" class="set-reps-input" placeholder="повторы" min="0" max="99" data-key="${key}" ${saved ? 'value="' + saved.reps + '"' : ''}>`;
    } else {
      row.innerHTML = left + `<div class="set-plan">${targetText(s.targetReps)}</div>`;
    }
    g.appendChild(row);
  });
  cont.appendChild(g);

  bindEvents();
  updateSyncStatus();

  if (!state.isToday) {
    flashSync('👁 Другой день — можно внести');
  }
}

function bindEvents() {
  $$('.set-reps-input').forEach(inp => {
    inp.oninput = () => inp.classList.toggle('filled', inp.value !== '');
    inp.onchange = async e => {
      const v = +e.target.value;
      const key = e.target.dataset.key;
      if (!isNaN(v) && v >= 0) await saveSet(key, v);
    };
  });
}

async function saveSet(key, reps) {
  setStored(state.schemeDate, key, reps);
  const s = allPlansByKey[key];
  if (!s) return;
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    try {
      await apiPost({
        user_id: currentUser,
        date: state.schemeDate,
        week: s.week, day: s.day, exercise: s.exercise,
        set_num: s.setNum, set_type: s.setType,
        weight: s.weight, target_reps: s.targetReps, actual_reps: reps
      });
      flashSync('🟢 Сохранено ' + reps);
    } catch (e) {
      console.warn('Sync failed', e);
      flashSync('🟡 Локально (нет сети)');
    }
  }, 600);
}

function flashSync(text) {
  const el = $('#syncStatus');
  el.textContent = text;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
  setTimeout(updateSyncStatus, 1400);
}

function updateSyncStatus() {
  const l = getStoredFor(state.schemeDate);
  $('#syncStatus').textContent = Object.keys(l).length > 0
    ? `🟢 ${state.schemeDate}: ${Object.keys(l).length} запись`
    : '🟡 Пусто';
}

document.addEventListener('DOMContentLoaded', init);

