a/Спорт Дневник\app.js → b/Спорт Дневник\app.js
@@ -0,0 +1,400 @@
+// ===========================
+// СПОРТ ДНЕВНИК — WebApp  v0.2
+// Реальный бэкенд: Google Apps Script
+// ===========================
+
+const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwyoi2BNSWJ1LNPa_LzkhLWJ_-grRfT_HjnKO1XHUR2X81JUsNhH0a6EahbpL-V__zC/exec';
+const STORAGE_KEY = 'workout_log_v1';
+const TRAINER_ID = 594920142;
+
+let currentUser = null;
+let todayPlan = [];
+let todayLogs = {};
+
+// --- УТИЛИТЫ ---
+const $ = (sel, ctx = document) => ctx.querySelector(sel);
+const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
+
+function todayKey() {
+  const d = new Date();
+  return d.toISOString().slice(0, 10); // YYYY-MM-DD
+}
+
+function dayNameRu(date = new Date()) {
+  const names = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
+  return names[date.getDay()];
+}
+
+function loadLocalLog() {
+  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
+  catch { return {}; }
+}
+
+function saveLocalLog(log) {
+  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
+}
+
+function getTodayLocalLog() {
+  return loadLocalLog()[todayKey()] || {};
+}
+
+function setLocalSetDone(exerciseIdx, setIdx, reps) {
+  const log = loadLocalLog();
+  const key = todayKey();
+  if (!log[key]) log[key] = {};
+  if (!log[key][exerciseIdx]) log[key][exerciseIdx] = {};
+  log[key][exerciseIdx][setIdx] = { reps, at: Date.now() };
+  saveLocalLog(log);
+}
+
+// --- API ---
+async function apiGetPlan(userId) {
+  const url = `${APPS_SCRIPT_URL}?user_id=${userId}`;
+  const resp = await fetch(url);
+  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
+  return resp.json();
+}
+
+async function apiPostLog(payload) {
+  const resp = await fetch(APPS_SCRIPT_URL, {
+    method: 'POST',
+    headers: { 'Content-Type': 'application/json' },
+    body: JSON.stringify(payload)
+  });
+  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
+  return resp.json();
+}
+
+// --- ИНИТ ---
+async function init() {
+  // Telegram WebApp ready
+  if (window.Telegram?.WebApp) {
+    Telegram.WebApp.ready();
+    Telegram.WebApp.expand();
+    
+    // Получаем user_id из initData
+    const initData = Telegram.WebApp.initDataUnsafe?.user;
+    if (initData?.id) {
+      currentUser = initData.id;
… omitted 322 diff line(s) across 1 additional file(s)/section(s)
