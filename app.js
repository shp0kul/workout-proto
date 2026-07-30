// ===========================
// СПОРТ ДНЕВНИК — WebApp v0.9
// Мульти-пользователь: вкладки имён + добавление
// ===========================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby13Q30X_zwMIAGlak9L4uj_P-00Ak75_hFrxrhvC54nhH2qitukv8eHWqtSL1m-nge/exec';
const STORAGE_KEY = 'workout_log_v1';
const LAST_USER_KEY = 'workout_last_user';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

const WEEK_LABELS = { 1: 'Неделя 1', 2: 'Неделя 2', 3: 'Неделя 3', 4: 'Разгрузка' };
const EX_LIST = ['Приседания', 'Жим стоя', 'Жим лёжа', 'Становая тяга'];

function todayKey() { return new Date().toISOString().slice(0, 10); }
function dayNameRu(d = new Date()) { return ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][d.getDay()]; }

function loadLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function saveLocal(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
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
let tab = 'strength';
let usersList = [];
let state = { week: null, exercise: null, plan: [], schemeDate: null, isToday: false };
let allPlansByKey = {};
let maxesCache = null;
let basesCache = null;
let appliedBases = null;
let saveTimers = {};
let isAdmin = false;

async function init() {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
  }
  // Определяем права админа: либо по Telegram ID, либо если активна вкладка "Игорь" (локальная отладка)
  if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
    isAdmin = (window.Telegram.WebApp.initDataUnsafe.user.id === 594920142);
  }
  await loadUsers();
}

async function loadUsers() {
  const last = localStorage.getItem(LAST_USER_KEY);
  if (last) currentUser = parseInt(last);
  try {
    const data = await apiGet({ users: '1' });
    usersList = data.users || [];
    // Если текущего юзера нет в списке — берём первого
    if (!usersList.find(u => u.id == currentUser)) currentUser = usersList[0]?.id || currentUser;
  } catch (e) {
    console.error('Users load error', e);
    usersList = [{ id: currentUser, name: 'Игорь' }];
  }
  buildUserTabs();
  buildTabs();
  buildSelectors();
  await loadToday();
}

function buildUserTabs() {
  const bar = $('#usersBar');
  bar.innerHTML = '';
  usersList.forEach(u => {
    const t = document.createElement('button');
    t.className = 'utab' + (u.id == currentUser ? ' active' : '');
    t.textContent = u.name;
    t.dataset.uid = u.id;
    t.onclick = async () => {
      currentUser = u.id;
      localStorage.setItem(LAST_USER_KEY, currentUser);
      maxesCache = null; basesCache = null; appliedBases = null;
      // Админ если это вкладка Игорь (локальная отладка)
      isAdmin = (u.name === 'Игорь') || isAdmin;
      buildUserTabs();
      await loadToday();
    };
    bar.appendChild(t);
  });
  // Кнопка добавить
  const add = document.createElement('button');
  add.className = 'utab utab-add';
  add.textContent = '+';
  add.onclick = addUser;
  bar.appendChild(add);
  // Кнопка удалить (только админ, скрыта для первого/единственного)
  if (isAdmin && usersList.length > 1) {
    const del = document.createElement('button');
    del.className = 'utab utab-del';
    del.textContent = '−';
    del.title = 'Удалить текущую вкладку';
    del.onclick = deleteCurrentUser;
    bar.appendChild(del);
  }
}

async function deleteCurrentUser() {
  const u = usersList.find(x => x.id == currentUser);
  if (!u) return;
  if (!confirm(`Удалить атлета «${u.name}»? Все его записи будут удалены безвозвратно.`)) return;
  try {
    await apiPost({ action: 'delete_user', viewer_id: 594920142, user_id: currentUser });
    usersList = usersList.filter(x => x.id != currentUser);
    currentUser = usersList[0]?.id;
    maxesCache = null; basesCache = null; appliedBases = null;
    buildUserTabs();
    await loadToday();
    flashSync('🗑 Удалён: ' + u.name);
  } catch (e) {
    console.error(e); flashSync('🟡 Ошибка удаления');
  }
}

async function addUser() {
  const name = prompt('Имя нового атлета:');
  if (!name) return;
  try {
    const res = await apiPost({ action: 'add_user', name });
    if (res.success) {
      usersList.push(res.user);
      currentUser = res.user.id;
      maxesCache = null; basesCache = null; appliedBases = null;
      buildUserTabs();
      await loadToday();
      flashSync('✅ Добавлен: ' + res.user.name);
    }
  } catch (e) {
    console.error(e);
    flashSync('🟡 Ошибка добавления');
  }
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

function buildTabs() {
  $$('.tab').forEach(t => {
    t.onclick = () => {
      tab = t.dataset.tab;
      $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
      // Селекторы недель/упражнений только для Силовой
      $('#selectors').style.display = (tab === 'strength') ? 'flex' : 'none';
      if (tab === 'strength') loadTodayJustRender();
      else if (tab === 'max') loadMax();
      else if (tab === 'wod') loadWod();
      else if (tab === 'wodarch') loadWodArch();
    };
  });
}

async function loadTodayJustRender() {
  await loadToday();
}

function buildSelectors() {
  const weekSel = $('#weekSelect');
  const exSel = $('#exSelect');
  weekSel.innerHTML = ''; exSel.innerHTML = '';
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

  if (tab === 'max') {
    $('#selectors').style.display = 'none';
    renderMax();
    return;
  }

  $('#selectors').style.display = 'flex';
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
    const editable = (key === editableKey);
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
  if (!state.isToday) flashSync('👁 Другой день — можно внести');
}

async function loadMax() {
  if (!basesCache) {
    try { const b = await apiGet({ user_id: currentUser, bases: '1' }); basesCache = b.bases; appliedBases = b.bases; }
    catch (e) { console.error(e); basesCache = {}; appliedBases = {}; }
  }
  if (!maxesCache) {
    try { const m = await apiGet({ user_id: currentUser, maxes: '1' }); maxesCache = m.maxes || []; }
    catch (e) { console.error(e); maxesCache = []; }
  }
  renderMax();
}

function targetNum(t) {
  if (typeof t === 'string') return parseInt(t) || 0;
  return Number(t) || 0;
}

function renderMax() {
  const cont = $('#exerciseList');
  cont.innerHTML = '';
  if (!maxesCache || !maxesCache.length) {
    cont.innerHTML = '<div class="empty">Записей пока нет 💤</div>';
    return;
  }
  const wkOrder = [1, 2, 3];
  const wkLabel = { 1: 'Нед 1', 2: 'Нед 2', 3: 'Нед 3' };

  const table = document.createElement('div');
  table.className = 'max-table';

  const head = document.createElement('div');
  head.className = 'max-row max-head';
  head.innerHTML = '<div class="max-ex">Максимумы</div><div class="max-cell">База</div>' +
    wkOrder.map(w => `<div class="max-cell">${wkLabel[w]}</div>`).join('');
  table.appendChild(head);

  maxesCache.forEach(row => {
    const r = document.createElement('div');
    r.className = 'max-row';
    const baseVal = basesCache ? basesCache[row.exercise] : row.base;
    const appliedVal = appliedBases ? appliedBases[row.exercise] : baseVal;
    let cells = `<div class="max-ex">${row.exercise}</div>`;
    cells += `<div class="max-cell">
      <input type="number" class="base-input" data-ex="${row.exercise}" value="${baseVal != null ? baseVal : ''}" placeholder="кг">
      <span class="base-applied">применено: ${appliedVal != null ? appliedVal : '—'} кг</span>
    </div>`;
    wkOrder.forEach(w => {
      const d = row.weeks[w] || {};
      const wTxt = d.weight != null ? d.weight : '—';
      const aTxt = d.actual != null ? d.actual : '';
      const tNum = targetNum(d.target);
      let cls = '';
      if (aTxt !== '' && aTxt !== null && aTxt !== undefined) {
        cls = (Number(aTxt) >= tNum) ? 'ok' : 'bad';
      }
      const repTxt = aTxt !== '' && aTxt != null ? `${aTxt} <span class="max-tgt">/ ${d.target}</span>` : (d.target || '');
      cells += `<div class="max-cell ${cls}">
        <span class="max-w">${wTxt} кг</span>
        <span class="max-rep">${repTxt}</span>
      </div>`;
    });
    r.innerHTML = cells;
    table.appendChild(r);
  });

  const recalcWrap = document.createElement('div');
  recalcWrap.className = 'recalc-wrap';
  recalcWrap.innerHTML = `<button class="recalc-btn" id="recalcBtn">🔄 Перерасчёт весов</button>`;
  table.appendChild(recalcWrap);

  cont.appendChild(table);
  bindMaxEvents();
}

function bindMaxEvents() {
  $('#recalcBtn').onclick = doRecalc;
  $$('.base-input').forEach(inp => {
    inp.onchange = () => {
      if (!basesCache) basesCache = {};
      basesCache[inp.dataset.ex] = +inp.value;
    };
  });
}

async function doRecalc() {
  const btn = $('#recalcBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Считаем…';
  try {
    const b = await apiPost({
      action: 'recalc', user_id: currentUser,
      ohp: basesCache['Жим стоя'], dl: basesCache['Становая тяга'],
      bench: basesCache['Жим лёжа'], squat: basesCache['Приседания']
    });
    maxesCache = null;
    appliedBases = b.bases;
    await loadMax();
    flashSync('✅ Перерасчёт готов');
  } catch (e) {
    console.error(e);
    flashSync('🟡 Ошибка перерасчёта');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Перерасчёт весов';
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
        user_id: currentUser, date: state.schemeDate,
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

async function loadWod() {
  const cont = $('#exerciseList');
  cont.innerHTML = '<div class="empty">⏳ загрузка…</div>';
  try {
    const data = await apiGet({ wod: 'today' });
    if (!data.wod) {
      cont.innerHTML = '<div class="empty">Пока нет актуального WOD 💤</div>';
      if (isAdmin) renderWodAdmin(cont);
      return;
    }
    renderWod(data.wod, cont);
  } catch (e) {
    console.error(e);
    cont.innerHTML = '<div class="empty">Ошибка загрузки</div>';
  }
}

function renderWod(wod, cont) {
  cont.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'wod-card';
  card.innerHTML = `
    <div class="wod-date">${wod.date}</div>
    <h2 class="wod-title">${escapeHtml(wod.name)}</h2>
    <div class="wod-text">${escapeHtml(wod.text).replace(/\n/g, '<br>')}</div>`;
  cont.appendChild(card);
  if (isAdmin) renderWodAdmin(cont);
}

function renderWodAdmin(cont) {
  const wrap = document.createElement('div');
  wrap.className = 'wod-admin';
  wrap.innerHTML = `
    <details>
      <summary>➕ Добавить WOD (админ)</summary>
      <div class="wod-form">
        <input type="text" id="wodName" placeholder="Название" class="wod-input">
        <textarea id="wodText" placeholder="Описание комплекса" class="wod-textarea" rows="5"></textarea>
        <button id="wodAdd" class="recalc-btn">Сохранить WOD</button>
      </div>
    </details>`;
  cont.appendChild(wrap);
  wrap.querySelector('#wodAdd').onclick = async () => {
    const name = wrap.querySelector('#wodName').value.trim();
    const text = wrap.querySelector('#wodText').value.trim();
    if (!name) { alert('Введите название'); return; }
    try {
      await apiPost({ action: 'add_wod', viewer_id: 594920142, name, text });
      flashSync('✅ WOD добавлен');
      await loadWod();
    } catch (e) { console.error(e); flashSync('🟡 Ошибка'); }
  };
}

async function loadWodArch() {
  const cont = $('#exerciseList');
  cont.innerHTML = '<div class="empty">⏳ загрузка…</div>';
  try {
    const data = await apiGet({ wods: '1' });
    renderWodArch(data.wods || [], cont);
  } catch (e) {
    console.error(e);
    cont.innerHTML = '<div class="empty">Ошибка загрузки</div>';
  }
}

function renderWodArch(wods, cont) {
  cont.innerHTML = '';
  if (!wods.length) { cont.innerHTML = '<div class="empty">Архив пуст 💤</div>'; return; }
  const list = document.createElement('div');
  list.className = 'wod-arch';
  wods.forEach(w => {
    const item = document.createElement('div');
    item.className = 'wod-arch-item';
    item.innerHTML = `<span class="wod-arch-date">${w.date}</span><span class="wod-arch-name">${escapeHtml(w.name)}</span>`;
    item.onclick = () => {
      cont.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'wod-card';
      card.innerHTML = `<div class="wod-date">${w.date}</div><h2 class="wod-title">${escapeHtml(w.name)}</h2><div class="wod-text">${escapeHtml(w.text).replace(/\n/g, '<br>')}</div>`;
      cont.appendChild(card);
      const back = document.createElement('button');
      back.className = 'utab';
      back.textContent = '← Архив';
      back.onclick = () => loadWodArch();
      cont.appendChild(back);
    };
    list.appendChild(item);
  });
  cont.appendChild(list);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
