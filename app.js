// ===========================
// СПОРТ ДНЕВНИК — WebApp v0.2 (minimal)
// ===========================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwyoi2BNSWJ1LNPa_LzkhLWJ_-grRfT_HjnKO1XHUR2X81JUsNhH0a6EahbpL-V__zC/exec';
const STORAGE_KEY = 'workout_log_v1';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

function todayKey() { return new Date().toISOString().slice(0, 10); }
function dayNameRu(d = new Date()) { return ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][d.getDay()]; }

function loadLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function saveLocal(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function getTodayLocal() { return loadLocal()[todayKey()] || {}; }
function setLocal(exIdx, setIdx, reps) { const l = loadLocal(); const k = todayKey(); if (!l[k]) l[k] = {}; if (!l[k][exIdx]) l[k][exIdx] = {}; l[k][exIdx][setIdx] = { reps, at: Date.now() }; saveLocal(l); }

async function apiGet(userId) {
  const r = await fetch(APPS_SCRIPT_URL + '?user_id=' + userId);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function apiPost(payload) {
  const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let currentUser = null, todayPlan = [];

async function init() {
  if (window.Telegram?.WebApp) { Telegram.WebApp.ready(); Telegram.WebApp.expand(); currentUser = Telegram.WebApp.initDataUnsafe?.user?.id; }
  if (!currentUser) currentUser = 594920142; // fallback
  $('#dayBadge').textContent = dayNameRu();
  try {
    const data = await apiGet(currentUser);
    todayPlan = data.plan || [];
  } catch (e) { console.error(e); todayPlan = []; }
  render();
}

function render() {
  const cont = $('#exerciseList'); cont.innerHTML = '';
  const local = getTodayLocal();

  // Группируем по упражнению
  const byEx = {};
  todayPlan.forEach(item => { if (!byEx[item.exercise]) byEx[item.exercise] = []; byEx[item.exercise].push(item); });

  Object.entries(byEx).forEach(([exName, sets], exIdx) => {
    const g = document.createElement('div'); g.className = 'exercise-group';
    const h = document.createElement('div'); h.className = 'exercise-header'; h.textContent = exName; g.appendChild(h);

    sets.forEach((s, si) => {
      const row = document.createElement('div'); row.className = 'set-row';
      const done = local[exIdx]?.[si]?.reps != null; if (done) row.classList.add('completed');
      const target = typeof s.targetReps === 'string' ? s.targetReps : s.targetReps + ' повторов';
      row.innerHTML = `
        <div class="set-info">
          <span class="set-label">${s.setType === 'warmup' ? 'Разминка' : 'Рабочий'} ${s.setNum}</span>
          <span class="set-weight">${s.weight} кг</span>
          <span class="set-target">цель: ${target}</span>
        </div>
        <input type="number" class="set-reps-input" placeholder="—" min="0" max="99" data-ex="${exIdx}" data-set="${si}" ${done ? 'value="' + local[exIdx][si].reps + '"' : ''}>
        <button class="set-done ${done ? 'done' : ''}" data-ex="${exIdx}" data-set="${si}">${done ? '✓' : '✕'}</button>
      `;
      g.appendChild(row);
    });
    cont.appendChild(g);
  });

  bindEvents(local);
  $('#syncStatus').textContent = Object.values(local).reduce((s, ex) => s + Object.keys(ex).length, 0) ? '🟢 Локально' : '🟡 Пусто';
}

function bindEvents(local) {
  $$('.set-reps-input').forEach(inp => {
    inp.oninput = () => inp.classList.toggle('filled', inp.value !== '');
    inp.onchange = async e => { const v = +e.target.value; if (!isNaN(v) && v >= 0) await saveSet(+e.target.dataset.ex, +e.target.dataset.set, v); };
  });
  $$('.set-done').forEach(btn => {
    btn.onclick = async () => {
      const ex = +btn.dataset.ex, set = +btn.dataset.set;
      const l = getTodayLocal();
      if (l[ex]?.[set]?.reps != null) { delete l[ex][set]; if (!Object.keys(l[ex]||{}).length) delete l[ex]; saveLocal(l); }
      else { const v = +prompt('Повторов?', 5); if (!isNaN(v) && v >= 0) await saveSet(ex, set, v); }
      render();
    };
  });
}

async function saveSet(exIdx, setIdx, reps) {
  setLocal(exIdx, setIdx, reps);
  // Находим план
  let flatIdx = 0, found = null;
  for (const p of todayPlan) {
    for (let si = 0; si < p.sets.length; si++) {
      if (flatIdx === exIdx && si === setIdx) { found = { ...p.sets[si], exercise: p.exercise, week: p.week, day: p.day }; break; }
      flatIdx++;
    } if (found) break;
  }
  if (!found) return;
  try { await apiPost({ user_id: currentUser, week: found.week, day: found.day, exercise: found.exercise, set_num: found.setNum, set_type: found.setType, weight: found.weight, target_reps: found.targetReps, actual_reps: reps }); }
  catch (e) { console.warn('Sync later', e); }
}

document.addEventListener('DOMContentLoaded', init);
