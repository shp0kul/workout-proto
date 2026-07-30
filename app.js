// ===========================
// СПОРТ ДНЕВНИК — WebApp v1.2
// Batch-загрузка + кэш + мгновенный рендер
// ===========================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby13Q30X_zwMIAGlak9L4uj_P-00Ak75_hFrxrhvC54nhH2qitukv8eHWqtSL1m-nge/exec';
const STORAGE_KEY = 'workout_log_v1';
const LAST_USER_KEY = 'workout_last_user';
const CACHE_PREFIX = 'wd_cache_';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

// Безопасный localStorage (Safari в приватном режиме кидает исключение на любое обращение)
const safeLS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
};

function loadLocal() { try { return JSON.parse(safeLS.get(STORAGE_KEY) || '{}'); } catch { return {}; } }
function saveLocal(d) { safeLS.set(STORAGE_KEY, JSON.stringify(d)); }
function lk(item) { return `${item.week}|${item.exercise}|${item.setNum}|${item.setType}`; }
function getStored() { return loadLocal().cycle || {}; }
function setStored(key, reps) {
  const l = loadLocal();
  if (!l.cycle) l.cycle = {};
  l.cycle[key] = { reps, at: Date.now() };
  saveLocal(l);
}
function cacheKey(uid) { return CACHE_PREFIX + uid; }
function getCache(uid) { try { return JSON.parse(safeLS.get(cacheKey(uid)) || 'null'); } catch { return null; } }
function setCache(uid, data) { safeLS.set(cacheKey(uid), JSON.stringify(data)); }

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
let state = { week: 1, exercise: EX_LIST[0], plan: [] };
let allPlansByKey = {};
let maxesCache = null;
let basesCache = null;
let appliedBases = null;
let saveTimers = {};
let isAdmin = false;
let currentWod = null;
let editWodMode = false;
let dataLoaded = false;

async function init() {
  if (window.Telegram && window.Telegram.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    var tgU = Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
    if (tgU && tgU.id) isAdmin = (tgU.id === 594920142);
  }
  const last = safeLS.get(LAST_USER_KEY);
  if (last) currentUser = parseInt(last);
  buildTabs();
  buildSelectors();
  // Мгновенно рисуем из кэша, если есть
  await loadUsers();
  renderFromCache();
  // Параллельно подгружаем свежие данные
  await loadBatch();
}

async function loadUsers() {
  try {
    const data = await apiGet({ users: '1' });
    usersList = data.users || [];
    if (!usersList.find(u => u.id == currentUser)) currentUser = (usersList[0] && usersList[0].id) || currentUser;
  } catch (e) { console.error('Users load error', e); usersList = [{ id: currentUser, name: 'Игорь' }]; }
  buildUserTabs();
}

function buildUserTabs() {
  const bar = $('#usersBar');
  bar.innerHTML = '';
  usersList.forEach(u => {
    const t = document.createElement('button');
    t.className = 'utab' + (u.id == currentUser ? ' active' : '');
    t.textContent = u.name; t.dataset.uid = u.id;
    t.onclick = async () => {
      currentUser = u.id;
      safeLS.set(LAST_USER_KEY, currentUser);
      maxesCache = null; basesCache = null; appliedBases = null; dataLoaded = false;
      isAdmin = (u.name === 'Игорь') || isAdmin;
      buildUserTabs();
      renderFromCache();
      await loadBatch();
    };
    bar.appendChild(t);
  });
  const add = document.createElement('button');
  add.className = 'utab utab-add'; add.textContent = '+'; add.onclick = addUser;
  bar.appendChild(add);
  if (isAdmin && usersList.length > 1) {
    const del = document.createElement('button');
    del.className = 'utab utab-del'; del.textContent = '−'; del.title = 'Удалить текущую вкладку';
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
    currentUser = usersList[0] && usersList[0].id;
    maxesCache = null; basesCache = null; appliedBases = null; dataLoaded = false;
    buildUserTabs();
    renderFromCache();
    await loadBatch();
    flashSync('🗑 Удалён: ' + u.name);
  } catch (e) { console.error(e); flashSync('🟡 Ошибка удаления'); }
}

async function addUser() {
  const name = prompt('Имя нового атлета:');
  if (!name) return;
  try {
    const res = await apiPost({ action: 'add_user', name });
    if (res.success) {
      usersList.push(res.user);
      currentUser = res.user.id;
      maxesCache = null; basesCache = null; appliedBases = null; dataLoaded = false;
      buildUserTabs();
      renderFromCache();
      await loadBatch();
      flashSync('✅ Добавлен: ' + res.user.name);
    }
  } catch (e) { console.error(e); flashSync('🟡 Ошибка добавления'); }
}

async function loadBatch() {
  try {
    const data = await apiGet({ batch: '1', user_id: currentUser, week: state.week, exercise: state.exercise });
    basesCache = data.bases || {};
    appliedBases = { ...basesCache };
    maxesCache = data.maxes || [];
    // Фильтруем план по текущей неделе/упражнению (batch вернул весь цикл)
    state.plan = (data.plan || []).filter(p => p.week === state.week && p.exercise === state.exercise);
    setCache(currentUser, data);
    dataLoaded = true;
    render();
  } catch (e) {
    console.error('Batch load error', e);
    flashSync('🟡 Нет связи — кэш');
  }
}

function renderFromCache() {
  const c = getCache(currentUser);
  if (!c) return;
  basesCache = c.bases || {};
  appliedBases = { ...basesCache };
  maxesCache = c.maxes || [];
  state.plan = (c.plan || []).filter(p => p.week === state.week && p.exercise === state.exercise);
  render();
}

function buildTabs() {
  $$('.tab').forEach(t => {
    t.onclick = () => {
      tab = t.dataset.tab;
      $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
      $('#selectors').style.display = (tab === 'strength') ? 'flex' : 'none';
      if (tab === 'strength') render();
      else if (tab === 'max') renderMax();
      else if (tab === 'wod') loadWod();
      else if (tab === 'wodarch') loadWodArch();
    };
  });
}

function buildSelectors() {
  const weekSel = $('#weekSelect');
  const exSel = $('#exSelect');
  weekSel.innerHTML = ''; exSel.innerHTML = '';
  [1, 2, 3, 4].forEach(w => {
    const o = document.createElement('option'); o.value = w; o.textContent = WEEK_LABELS[w]; weekSel.appendChild(o);
  });
  EX_LIST.forEach(ex => {
    const o = document.createElement('option'); o.value = ex; o.textContent = ex; exSel.appendChild(o);
  });
  weekSel.onchange = onSelect;
  exSel.onchange = onSelect;
}

async function onSelect() {
  state.week = parseInt($('#weekSelect').value);
  state.exercise = $('#exSelect').value;
  const c = getCache(currentUser);
  if (c) { state.plan = (c.plan || []).filter(p => p.week === state.week && p.exercise === state.exercise); render(); }
  await loadBatch();
}

function targetText(t) { return typeof t === 'string' ? t : (t + ' повторов'); }

function render() {
  $('#dayBadge').textContent = WEEK_LABELS[state.week] + ' • ' + state.exercise;
  if (tab === 'max') { $('#selectors').style.display = 'none'; renderMax(); return; }
  $('#selectors').style.display = 'flex';
  $('#weekSelect').value = state.week;
  $('#exSelect').value = state.exercise;
  const cont = $('#exerciseList');
  cont.innerHTML = '';
  const local = getStored();
  allPlansByKey = {};
  if (state.plan.length === 0) {
    cont.innerHTML = '<div class="empty">Нет данных для выбора 💤</div>';
    updateSyncStatus();
    return;
  }
  const works = state.plan.filter(s => s.setType === 'work');
  const lastWork = works[works.length - 1];
  const editableKey = lastWork ? lk(lastWork) : null;
  const g = document.createElement('div');
  g.className = 'exercise-group';
  const h = document.createElement('div');
  h.className = 'exercise-header'; h.textContent = state.exercise;
  g.appendChild(h);
  state.plan.forEach(s => {
    const key = lk(s);
    allPlansByKey[key] = s;
    const editable = (key === editableKey);
    const saved = local[key];
    const row = document.createElement('div');
    row.className = 'set-row ' + (editable ? 'editable' : 'readonly') + (saved ? ' completed' : '');
    const left = `<div class="set-info">
      <span class="set-label">${s.setType === 'warmup' ? 'Разминка' : 'Рабочий'} ${s.setNum}</span>
      <span class="set-weight">${s.weight} кг</span>
      <span class="set-target">цель: ${targetText(s.targetReps)}</span></div>`;
    if (editable) {
      row.innerHTML = left + `<input type="number" class="set-reps-input" placeholder="повторы" min="0" max="99" data-key="${key}" ${saved ? 'value="' + saved.reps + '"' : ''}>`;
    } else {
      row.innerHTML = left + `<div class="set-plan">${targetText(s.targetReps)}</div>`;
    }
    g.appendChild(row);
  });
  cont.appendChild(g);
  bindEvents();
  updateSyncStatus();
}

function renderMax() {
  const cont = $('#exerciseList');
  cont.innerHTML = '';
  if (!maxesCache || !maxesCache.length) { cont.innerHTML = '<div class="empty">Записей пока нет 💤</div>'; return; }
  const wkOrder = [1, 2, 3];
  const wkLabel = { 1: 'Нед 1', 2: 'Нед 2', 3: 'Нед 3' };
  const table = document.createElement('div');
  table.className = 'max-table';
  const head = document.createElement('div');
  head.className = 'max-row max-head';
  head.innerHTML = '<div class="max-ex">Максимумы</div><div class="max-cell">База</div>' + wkOrder.map(w => `<div class="max-cell">${wkLabel[w]}</div>`).join('');
  table.appendChild(head);
  maxesCache.forEach(row => {
    const r = document.createElement('div');
    r.className = 'max-row';
    const baseVal = basesCache ? basesCache[row.exercise] : row.base;
    const appliedVal = appliedBases ? appliedBases[row.exercise] : baseVal;
    let cells = `<div class="max-ex">${row.exercise}</div>`;
    cells += `<div class="max-cell">
      <input type="number" class="base-input" data-ex="${row.exercise}" value="${baseVal != null ? baseVal : ''}" placeholder="кг">
      <span class="base-applied">применено: ${appliedVal != null ? appliedVal : '—'} кг</span></div>`;
    wkOrder.forEach(w => {
      const d = row.weeks[w] || {};
      const wTxt = d.weight != null ? d.weight : '—';
      const aTxt = d.actual != null ? d.actual : '';
      const tNum = typeof d.target === 'string' ? (parseInt(d.target) || 0) : (Number(d.target) || 0);
      let cls = '';
      if (aTxt !== '' && aTxt !== null && aTxt !== undefined) cls = (Number(aTxt) >= tNum) ? 'ok' : 'bad';
      const repTxt = aTxt !== '' && aTxt != null ? `${aTxt} <span class="max-tgt">/ ${d.target}</span>` : (d.target || '');
      cells += `<div class="max-cell ${cls}"><span class="max-w">${wTxt} кг</span><span class="max-rep">${repTxt}</span></div>`;
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
    inp.onchange = () => { if (!basesCache) basesCache = {}; basesCache[inp.dataset.ex] = +inp.value; };
  });
}

async function doRecalc() {
  const btn = $('#recalcBtn');
  btn.disabled = true; btn.textContent = '⏳ Считаем…';
  try {
    const b = await apiPost({
      action: 'recalc', user_id: currentUser,
      ohp: basesCache['Жим стоя'], dl: basesCache['Становая тяга'],
      bench: basesCache['Жим лёжа'], squat: basesCache['Приседания']
    });
    maxesCache = null; appliedBases = b.bases;
    await loadBatch();
    flashSync('✅ Перерасчёт готов');
  } catch (e) { console.error(e); flashSync('🟡 Ошибка перерасчёта'); }
  finally { btn.disabled = false; btn.textContent = '🔄 Перерасчёт весов'; }
}

function bindEvents() {
  $$('.set-reps-input').forEach(inp => {
    inp.oninput = () => inp.classList.toggle('filled', inp.value !== '');
    inp.onchange = async e => {
      const v = +e.target.value; const key = e.target.dataset.key;
      if (!isNaN(v) && v >= 0) await saveSet(key, v);
    };
  });
}

async function saveSet(key, reps) {
  setStored(key, reps);
  const s = allPlansByKey[key];
  if (!s) return;
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    try {
      await apiPost({
        user_id: currentUser, week: s.week, day: s.day, exercise: s.exercise,
        set_num: s.setNum, set_type: s.setType, weight: s.weight, target_reps: s.targetReps, actual_reps: reps
      });
      flashSync('🟢 Сохранено ' + reps);
    } catch (e) { console.warn('Sync failed', e); flashSync('🟡 Локально (нет сети)'); }
  }, 600);
}

// ---------- WOD ----------
async function loadWod() {
  const cont = $('#exerciseList');
  $('#dayBadge').textContent = '🔥 WOD';
  cont.innerHTML = '<div class="empty">⏳ загрузка…</div>';
  try { const data = await apiGet({ wod: 'today' }); currentWod = data.wod || null; renderWod(); }
  catch (e) { console.error(e); cont.innerHTML = '<div class="empty">Ошибка загрузки</div>'; }
}

function renderWod() {
  const cont = $('#exerciseList');
  cont.innerHTML = '';
  if (!currentWod) { cont.innerHTML = '<div class="empty">Пока нет актуального WOD 💤</div>'; if (isAdmin) renderWodAdmin(cont); return; }
  const card = document.createElement('div');
  card.className = 'wod-card';
  card.innerHTML = `<div class="wod-date">${currentWod.date}</div><h2 class="wod-title">${escapeHtml(currentWod.name)}</h2><div class="wod-text">${escapeHtml(currentWod.text).replace(/\n/g, '<br>')}</div>`;
  cont.appendChild(card);
  if (isAdmin) renderWodAdmin(cont);
}

function renderWodAdmin(cont) {
  const wrap = document.createElement('div');
  wrap.className = 'wod-admin';
  const editing = editWodMode && currentWod;
  wrap.innerHTML = `<details ${editing ? 'open' : ''}>
      <summary>${editing ? '✏️ Редактировать WOD' : '➕ Добавить WOD (админ)'}</summary>
      <div class="wod-form">
        <input type="text" id="wodName" placeholder="Название" class="wod-input" value="${editing ? escapeHtml(currentWod.name) : ''}">
        <textarea id="wodText" placeholder="Описание комплекса" class="wod-textarea" rows="5">${editing ? escapeHtml(currentWod.text) : ''}</textarea>
        <button id="wodSave" class="recalc-btn">${editing ? 'Сохранить изменения' : 'Сохранить WOD'}</button>
        ${editing ? '<button id="wodCancel" class="utab">Отмена</button>' : ''}
      </div></details>`;
  cont.appendChild(wrap);
  if (!editing && currentWod) {
    const actions = document.createElement('div');
    actions.className = 'wod-actions';
    actions.innerHTML = `<button id="wodEdit" class="utab">✏️ Редактировать</button><button id="wodDel" class="utab utab-del">🗑 Удалить</button>`;
    cont.appendChild(actions);
    actions.querySelector('#wodEdit').onclick = () => { editWodMode = true; renderWod(); };
    actions.querySelector('#wodDel').onclick = async () => {
      if (!confirm('Удалить WOD «' + currentWod.name + '»?')) return;
      await apiPost({ action: 'delete_wod', viewer_id: 594920142, id: currentWod.id });
      flashSync('🗑 WOD удалён'); editWodMode = false; await loadWod();
    };
  }
  wrap.querySelector('#wodSave').onclick = async () => {
    const name = wrap.querySelector('#wodName').value.trim();
    const text = wrap.querySelector('#wodText').value.trim();
    if (!name) { alert('Введите название'); return; }
    try {
      if (editing) { await apiPost({ action: 'edit_wod', viewer_id: 594920142, id: currentWod.id, name, text }); flashSync('✅ WOD обновлён'); }
      else { await apiPost({ action: 'add_wod', viewer_id: 594920142, name, text }); flashSync('✅ WOD добавлен'); }
      editWodMode = false; await loadWod();
    } catch (e) { console.error(e); flashSync('🟡 Ошибка'); }
  };
  const cancel = wrap.querySelector('#wodCancel');
  if (cancel) cancel.onclick = () => { editWodMode = false; renderWod(); };
}

async function loadWodArch() {
  const cont = $('#exerciseList');
  cont.innerHTML = '<div class="empty">⏳ загрузка…</div>';
  try { const data = await apiGet({ wods: '1' }); renderWodArch(data.wods || [], cont); }
  catch (e) { console.error(e); cont.innerHTML = '<div class="empty">Ошибка загрузки</div>'; }
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
      back.className = 'utab'; back.textContent = '← Архив'; back.onclick = () => loadWodArch();
      cont.appendChild(back);
    };
    list.appendChild(item);
  });
  cont.appendChild(list);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Видимая ошибка на экране (для диагностики на iPhone, где консоль недоступна)
function showError(msg) {
  let el = $('#errBox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'errBox';
    el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;background:#3a0d0d;color:#ff9b9b;border:1px solid #ff6b6b;border-radius:8px;padding:10px;font-size:13px;z-index:9999;white-space:pre-wrap;max-height:40vh;overflow:auto;';
    document.body.appendChild(el);
  }
  el.textContent = '⚠️ Ошибка: ' + msg;
}

window.addEventListener('error', e => {
  showError((e.error && e.error.stack) ? e.error.stack : (e.message || 'неизвестно'));
});
window.addEventListener('unhandledrejection', e => {
  showError('Promise: ' + ((e.reason && e.reason.message) ? e.reason.message : e.reason));
});

function flashSync(text) {
  const el = $('#syncStatus');
  el.textContent = text; el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
  setTimeout(updateSyncStatus, 1400);
}

function updateSyncStatus() {
  const l = getStored();
  const n = Object.keys(l).length;
  $('#syncStatus').textContent = n > 0 ? `🟢 ${n} запись в цикле` : '🟡 Пусто';
}

document.addEventListener('DOMContentLoaded', init);
