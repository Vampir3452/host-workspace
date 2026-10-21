import { CONFIG } from './config.js';
import * as db from './lib/storage.js';
import * as api from './lib/api.js';
import { parseTaskFile, downloadTaskWorkbook } from './lib/task-import.js';
import { renderRichEditor, wireRichEditors } from './lib/rich-text.js';
import { recordChanges, describeDevice } from './lib/change-history.js';
import { CATEGORIES, SCHEMA_VERSION, clone, sameContent, uid, item, createTemplate, clearTaskList, restoreTaskList, clearQuestionList, restoreQuestionList, replaceTemplateTasks, applyTemplate, cleanTitle, progress, localDate, defaultTemplates, seedWeddingTemplate, demoRecords, reconcileCalendar, scriptLink, validateBackup, restorePlan } from './lib/model.js';

const APP_VERSION = '0.4.1';
const historyBaseline = new Map();
const device = (() => {
  try {
    const id = localStorage.getItem('zk.device-id') || crypto.randomUUID(); localStorage.setItem('zk.device-id', id);
    return { id, label: localStorage.getItem('zk.device-label') || describeDevice(navigator.userAgent) };
  } catch { return { id: crypto.randomUUID(), label: describeDevice(navigator.userAgent) }; }
})();
function rememberHistory(records) { for (const r of records) historyBaseline.set(r.id, clone(r.payload)); }

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  templates: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-1 3-3 1-2 4 2 3 1 3 4 3 3-1 3-1 3-4-1-3-1-3-4-3Z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 3h7v7m0-7L10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  note: '<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9Z"/><path d="M14 3v7h7M7 14h10m-10 3h6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11M9 16l3-3 3 3m-3-3v8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  heart: '<path d="M20 5c-3-3-7-1-8 2-1-3-5-5-8-2-4 4 2 10 8 15 6-5 12-11 8-15Z"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  logout: '<path d="M9 3H3v18h6m6-15 6 6-6 6m-7-6h13"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.note}</svg>`;
const button = (action, label, glyph, type = 'secondary', extra = '') => `<button class="button ${type}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}<span>${label}</span></button>`;
const iconButton = (action, label, glyph, extra = '') => `<button class="icon-button" data-action="${action}" aria-label="${esc(label)}" ${extra}>${icon(glyph)}</button>`;
const fmt = (date, options = {}) => new Intl.DateTimeFormat('ru-RU', { timeZone: CONFIG.timeZone, ...options }).format(new Date(date.length === 10 ? `${date}T12:00:00+05:00` : date));
const dateLabel = source => `${fmt(source.start, { day: 'numeric', month: 'long', year: 'numeric' })}${source.allDay ? ' · Время не указано' : ` · ${fmt(source.start, { hour: '2-digit', minute: '2-digit' })}`}`;
const labels = { confirmed: 'Подтверждено', tentative: 'Не подтверждено', deleted: 'Удалено из календаря' };
const badge = status => `<span class="status-badge ${status}">${status === 'confirmed' ? icon('check') : status === 'tentative' ? '◷' : icon('trash')} ${labels[status] || status}</span>`;
let state = { scope: null, demo: false, route: 'calendar', view: 'calendar', selected: null, records: [], month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), filter: 'all', query: '', syncing: false, cloudError: '', calendarError: '', lastCalendar: null, persistError: '', lastBackup: null };
let syncTimer, toastTimer, modalTrigger, lastAutoSync = 0, persistQueue = Promise.resolve(), syncPromise;
let pendingWrites = 0, releaseEditorLock, editorLockScope;
const failedWrites = new Map();
async function acquireEditorLock(scope) {
  if (editorLockScope === scope) return true;
  if (!navigator.locks) throw new Error('Для безопасного сохранения открой кабинет в актуальном Chrome, Edge или Safari.');
  return new Promise((resolve, reject) => {
    navigator.locks.request(`zk-editor:${scope}`, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      editorLockScope = scope;
      await new Promise(release => { releaseEditorLock = release; resolve(true); });
      editorLockScope = null;
    }).catch(reject);
  });
}
const record = id => state.records.find(x => x.id === id);
const events = () => state.records.filter(x => x.kind === 'event');
const templates = () => state.records.filter(x => x.kind === 'template');
const current = () => record(state.selected);
const conflicts = () => state.records.filter(x => x.conflict);
wireRichEditors(({ field, text, html }) => {
  const r = current();
  if (r?.kind !== 'event' || !['description', 'notes'].includes(field)) return;
  r.payload.body[field] = text; r.payload.body[`${field}Html`] = html; changed(r);
});

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 6000); }
function errorMessage(error) { return error?.name === 'TimeoutError' ? 'Сервис не ответил вовремя. Данные на устройстве сохранены.' : error?.message || 'Не удалось выполнить действие.'; }
function safeAction(fn) { return async (...args) => { try { return await fn(...args); } catch (error) { toast(errorMessage(error)); } }; }
function modal(title, body, actions = '', wide = false) {
  modalTrigger = document.activeElement;
  const el = $('#modal'); el.classList.toggle('wide', wide);
  el.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>${iconButton('close-modal', 'Закрыть', 'close')}</div><div class="modal-body">${body}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ''}`;
  if (!el.open) el.showModal();
}
function closeModal() { $('#modal').close(); modalTrigger?.focus(); }
$('#modal').addEventListener('close', () => modalTrigger?.isConnected && modalTrigger.focus());

function persistenceStatus() {
  if (state.persistError) return { text: 'Ошибка сохранения на устройстве', cls: 'offline' };
  if (state.demo) return { text: 'Демо · сохранено на устройстве', cls: '' };
  if (conflicts().length) return { text: `Разные версии: ${conflicts().length}`, cls: 'offline' };
  if (state.syncing) return { text: 'Синхронизация…', cls: '' };
  if (!navigator.onLine) return { text: 'Без интернета · данные на устройстве', cls: 'offline' };
  if (state.cloudError) return { text: 'Облако недоступно · данные на устройстве', cls: 'offline' };
  if (state.records.some(r => r.dirty)) return { text: 'Сохранено на устройстве · ожидает отправки', cls: 'offline' };
  return { text: 'Сохранено и синхронизировано', cls: '' };
}
function updateStatus() {
  const s = persistenceStatus(), el = $('#save-status');
  if (el) { el.className = `sync-status ${s.cls}`; el.innerHTML = `<span class="status-dot"></span><span>${esc(s.text)}</span>`; }
  const count = $('#conflict-count'); if (count) count.textContent = conflicts().length ? ` · ${conflicts().length}` : '';
}
function persist(r, schedule = true) {
  // Capture now; serial writes avoid an older async write replacing a later keystroke.
  const snapshot = clone(r), scope = state.scope; pendingWrites++;
  persistQueue = persistQueue.catch(() => {}).then(() => db.writeRecord(scope, snapshot));
  persistQueue.then(() => { pendingWrites--; failedWrites.delete(snapshot.id); state.persistError = failedWrites.values().next().value || ''; updateStatus(); }, e => { pendingWrites--; failedWrites.set(snapshot.id, errorMessage(e)); state.persistError = errorMessage(e); updateStatus(); toast(state.persistError); });
  if (schedule && !state.demo) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(false), 1200); }
}
function changed(r, schedule = true, logHistory = true) {
  if (logHistory) r.payload = recordChanges(historyBaseline.get(r.id) || null, r.payload, device);
  historyBaseline.set(r.id, clone(r.payload));
  r.dirty = true; r.localUpdated = new Date().toISOString(); persist(r, schedule); updateStatus();
}
function hydrate(remote) { historyBaseline.set(remote.id, clone(remote.payload)); return { ...remote, dirty: false, localUpdated: remote.updated_at }; }

async function sync(includeCalendar = true) {
  if (state.demo || !state.scope) { if (state.demo && includeCalendar) toast('Это пример. Реальный календарь подключается после входа через Google.'); return; }
  if (!navigator.onLine) { updateStatus(); if (includeCalendar) toast('Нет интернета. Работаем с сохранёнными карточками.'); return; }
  if (syncPromise) { await syncPromise; if (includeCalendar) return sync(true); return; }
  syncPromise = performSync(includeCalendar).finally(() => { syncPromise = null; });
  await syncPromise;
}
async function performSync(includeCalendar) {
  state.syncing = true; updateStatus();
  try {
    await persistQueue;
    const remote = await api.cloudRecords();
    for (const cloud of remote) {
      const local = record(cloud.id);
      if (!local) { const r = hydrate(cloud); state.records.push(r); persist(r, false); }
      else if (local.conflict && sameContent(local.payload, cloud.payload)) {
        local.version = cloud.version; local.dirty = false; delete local.conflict; persist(local, false);
      }
      else if (cloud.version !== local.version) {
        const openEditor = state.selected === local.id && ['event', 'templates'].includes(state.route);
        if (local.dirty || openEditor) {
          if (sameContent(local.payload, cloud.payload)) { local.version = cloud.version; local.dirty = false; delete local.conflict; }
          else local.conflict = cloud;
        } else { Object.assign(local, hydrate(cloud)); delete local.conflict; }
        persist(local, false);
      }
    }
    // Initialize templates only after reading the server, so an offline device
    // cannot silently replace templates prepared elsewhere.
    for (const t of defaultTemplates()) if (!record(t.id)) { state.records.push(t); persist(t, false); }
    for (const local of templates()) {
      const seeded = seedWeddingTemplate(local);
      if (seeded) { Object.assign(local, seeded); persist(local, false); }
    }
    for (const local of state.records.filter(r => r.dirty && !r.conflict)) {
      const snapshot = clone(local);
      const result = await api.saveCloud(snapshot);
      if (result.saved) {
        local.version = result.record.version;
        // Edits typed while the network request was in flight remain dirty.
        local.dirty = !sameContent(local.payload, snapshot.payload);
        delete local.conflict;
      } else if (result.record && sameContent(local.payload, result.record.payload)) {
        local.version = result.record.version; local.dirty = false; delete local.conflict;
      } else { local.conflict = result.record || { id: local.id, kind: local.kind, version: 0, payload: null }; }
      persist(local, false);
    }
    state.cloudError = '';
    if (includeCalendar && !conflicts().length) {
      try {
        const snapshot = await api.readCalendar(events().map(r => r.payload.source.googleId));
        if (snapshot.complete !== true || !Array.isArray(snapshot.events)) throw new Error('Календарь загрузился не полностью. Старые карточки сохранены.');
        // Merge only after a complete, validated response; never erase a card on a failed fetch.
        const merged = reconcileCalendar(events(), snapshot.events);
        for (const next of merged) {
          const old = record(next.id);
          if (old) { if (!sameContent(old.payload.source, next.payload.source)) { old.payload.source = next.payload.source; changed(old, false); } }
          else { state.records.push(next); persist(next, false); }
        }
        state.lastCalendar = snapshot.syncedAt; state.calendarError = '';
        await db.setMeta(`${state.scope}:calendar`, state.lastCalendar);
      } catch (e) { state.calendarError = errorMessage(e); }
    }
  } catch (e) { state.cloudError = errorMessage(e); }
  finally {
    state.syncing = false; await persistQueue.catch(() => {});
    // Don't rebuild a focused editor: this preserves caret, selection and partially typed text.
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable && !document.activeElement?.closest('.rich-field') && !$('#modal').open) render(); else updateStatus();
    if (state.records.some(r => r.dirty && !r.conflict) && !state.cloudError) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(false), 1800); }
  }
}

function loginView(message = '') {
  $('#app').innerHTML = `<main id="main" class="login-page"><section class="login-art"><a class="brand" href="./"><span class="brand-mark">зк</span><span class="brand-copy">За кулисами<small>Личное пространство ведущего</small></span></a><div><p class="eyebrow">ХОРОШИЙ ВЕЧЕР НАЧИНАЕТСЯ ЗДЕСЬ</p><h1>Всё готово.<br>Можно на сцену.</h1><p>Мероприятия, мысли после звонков и каждый шаг подготовки — в одном спокойном месте.</p></div><p class="login-eyebrow">Меньше держать в голове. Больше быть в моменте.</p></section><section class="login-card"><span class="section-label">ТВОЙ РАБОЧИЙ КАБИНЕТ</span><h2>Заходи, здесь всё своё.</h2><p class="subtitle">Войди через Google, чтобы открыть свой календарь и продолжить подготовку.</p>${message ? `<p class="error-text" role="alert">${esc(message)}</p>` : ''}${button('login', 'Войти через Google', '', 'primary')}<p class="form-help">Доступ только для владельца. Сайт читает выбранный календарь и не меняет события.</p><div class="login-features"><span>${icon('calendar')}Твоё расписание</span><span>${icon('note')}Заметки и чек-листы</span><span>${icon('cloud')}Работа без интернета</span></div>${button('demo', 'Посмотреть пример кабинета', 'arrow', 'ghost')}<p class="form-help">Пример с вымышленными мероприятиями. Он не связан с твоими данными.</p></section></main>`;
}
function navigation(route, label, glyph) { return `<button class="nav-item ${state.route === route ? 'active' : ''}" data-action="navigate" data-route="${route}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${route === 'settings' ? '<span id="conflict-count"></span>' : ''}</button>`; }
function shell() {
  const title = state.route === 'changes' ? 'История изменений' : state.route === 'templates' ? 'Шаблоны' : state.route === 'settings' ? 'Настройки' : state.route === 'event' ? 'Мероприятия / Подготовка' : state.route === 'archive' ? 'История мероприятий' : 'Мероприятия';
  return `<div class="shell"><aside class="sidebar"><a class="brand" href="#calendar" data-action="navigate" data-route="calendar"><span class="brand-mark">зк</span><span class="brand-copy">За кулисами<small>Кабинет ведущего</small></span></a><p class="section-label">РАБОЧЕЕ ПРОСТРАНСТВО</p><nav class="nav" aria-label="Основная навигация">${navigation('calendar', 'Мероприятия', 'calendar')}${navigation('templates', 'Шаблоны', 'templates')}${navigation('archive', 'Архив', 'clock')}${navigation('changes', 'Изменения', 'note')}${navigation('settings', 'Настройки', 'settings')}</nav><div class="sidebar-bottom"><div class="notice">${icon('spark')}<p>Подготовка по шагам.<br>Вечер — с удовольствием.</p></div><div class="profile"><span class="avatar">ДП</span><div class="profile-copy"><strong>Дмитрий</strong><small>${state.demo ? 'Демонстрационный кабинет' : 'Личный кабинет'}</small></div>${iconButton('exit', state.demo ? 'Выйти из примера' : 'Выйти из аккаунта', 'logout')}</div></div></aside><div class="main"><header class="topbar"><span class="breadcrumb">${title}</span><div class="top-actions"><div id="save-status" role="status" aria-live="polite"></div>${iconButton('sync', 'Обновить данные и календарь', 'refresh')}</div></header><main id="main" class="page">${state.demo ? `<div class="demo-banner"><span>Пример кабинета · мероприятия вымышлены, изменения сохраняются только здесь</span><button data-action="exit">Войти в свой кабинет ${icon('arrow')}</button></div>` : ''}${state.cloudError ? `<div class="notice error-text" role="alert">${esc(state.cloudError)} ${button('sync', 'Повторить', 'refresh', 'ghost')}</div>` : ''}${state.calendarError ? `<div class="notice error-text" role="alert">${esc(state.calendarError)}</div>` : ''}${conflicts().length ? `<div class="notice">Есть разные версии записей на устройствах. ${button('conflicts', 'Выбрать версии', '', 'ghost')}</div>` : ''}<div id="page-content"></div></main></div></div>`;
}
let renderedEditorKey;
function render() {
  if (!state.scope) { loginView(); return; }
  const editorKey = `${state.scope}:${state.route}:${state.selected}`;
  const sectionStates = renderedEditorKey === editorKey ? new Map([...document.querySelectorAll('[data-section-key]')].map(el => [el.dataset.sectionKey, el.open])) : new Map();
  $('#app').innerHTML = shell();
  const content = $('#page-content');
  if (state.route === 'event') content.innerHTML = eventView();
  else if (state.route === 'changes') content.innerHTML = changesView();
  else if (state.route === 'templates') content.innerHTML = templatesView();
  else if (state.route === 'settings') content.innerHTML = settingsView();
  else content.innerHTML = calendarView(state.route === 'archive');
  for (const el of document.querySelectorAll('[data-section-key]')) if (sectionStates.has(el.dataset.sectionKey)) el.open = sectionStates.get(el.dataset.sectionKey);
  renderedEditorKey = editorKey;
  updateStatus();
}
function navigate(route, id) { state.route = route; state.selected = id || null; state.query = ''; state.filter = 'all'; render(); window.scrollTo(0, 0); $('#main').setAttribute('tabindex', '-1'); $('#main').focus({ preventScroll: true }); }
function filteredEvents(archive = false) {
  const today = localDate(new Date().toISOString());
  return events().filter(r => {
    const s = r.payload.source, b = r.payload.body, past = s.allDay && s.end ? localDate(s.end) <= today : localDate(s.end || s.start) < today;
    return (archive ? past || s.status === 'deleted' : !past && s.status !== 'deleted')
      && (state.filter === 'all' || s.status === state.filter || b.category === state.filter)
      && `${s.title} ${s.location || ''} ${b.description} ${b.notes}`.toLowerCase().includes(state.query.toLowerCase());
  }).sort((a, b) => a.payload.source.start.localeCompare(b.payload.source.start));
}
function eventRow(r) {
  const { source: s, body: b } = r.payload, p = progress(b);
  return `<button class="list-row" data-action="open-event" data-id="${esc(r.id)}"><span class="list-date"><strong>${fmt(s.start, { day: '2-digit' })}</strong><small>${fmt(s.start, { month: 'short' })}</small></span><span class="list-title"><strong>${esc(cleanTitle(s.title))}</strong><small>${esc(CATEGORIES[b.category])} · ${s.allDay ? 'Время не указано' : fmt(s.start, { hour: '2-digit', minute: '2-digit' })}</small></span>${badge(s.status)}<span class="list-progress"><progress max="100" value="${p.percent}" aria-label="Готовность ${p.percent}%"></progress><small>${p.done} из ${p.total}</small></span>${icon('right')}</button>`;
}
function calendarView(archive) {
  const all = filteredEvents(archive), active = events().filter(r => r.payload.source.status !== 'deleted');
  const monthEvents = all.filter(r => localDate(r.payload.source.start).slice(0, 7) === `${state.month.getFullYear()}-${String(state.month.getMonth() + 1).padStart(2, '0')}`);
  const count = active.filter(r => r.payload.source.status === 'tentative').length;
  return `<div class="page-heading"><div><p class="eyebrow">${archive ? 'ПРОШЕДШЕЕ ОСТАЁТСЯ ПОД РУКОЙ' : 'ПЛАНИРУЙ СПОКОЙНО. ПРОВОДИ ЯРКО.'}</p><h1>${archive ? 'История мероприятий' : 'Мои мероприятия'}<span class="heading-dot">.</span></h1><p class="subtitle">${archive ? 'Подготовленные материалы и заметки сохраняются здесь.' : 'Всё, что нужно подготовить к следующему выходу на сцену.'}</p></div>${button('sync', 'Обновить календарь', 'refresh', 'secondary')}</div><div class="toolbar"><div class="segmented" aria-label="Вид мероприятий"><button data-action="view-calendar" class="${state.view === 'calendar' && !archive ? 'selected' : ''}" aria-pressed="${state.view === 'calendar' && !archive}">${icon('calendar')} Календарь</button><button data-action="view-list" class="${state.view === 'list' || archive ? 'selected' : ''}" aria-pressed="${state.view === 'list' || archive}">${icon('list')} Список</button></div><label class="search">${icon('search')}<input id="event-search" type="search" value="${esc(state.query)}" placeholder="Найти мероприятие" aria-label="Найти мероприятие"></label></div><div class="filters">${[['all', 'Все мероприятия'], ['confirmed', 'Подтверждённые'], ['tentative', `Не подтверждены${count ? ` · ${count}` : ''}`]].map(([k, v]) => `<button class="chip ${state.filter === k ? 'selected' : ''}" data-action="filter" data-filter="${k}" aria-pressed="${state.filter === k}">${esc(v)}</button>`).join('')}</div><div id="event-results">${archive || state.view === 'list' ? `<section class="event-list">${all.length ? all.map(eventRow).join('') : emptyState(archive ? 'История пока пуста' : 'Мероприятий пока нет', archive ? 'Завершённые и удалённые из календаря события появятся здесь.' : 'Добавь в Google Календарь событие с названием «Заказ: …» или «?Заказ: …», затем обнови календарь.')}</section>` : `<div class="calendar-layout"><section class="calendar-panel" aria-label="Календарь мероприятий"><div class="month-toolbar"><h2 class="month-label">${fmt(state.month.toISOString(), { month: 'long', year: 'numeric' }).replace(' г.', '')}</h2><div>${button('today', 'Сегодня', '', 'ghost')}${iconButton('prev-month', 'Предыдущий месяц', 'left')}${iconButton('next-month', 'Следующий месяц', 'right')}</div></div><div class="weekdays" aria-hidden="true">${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(x => `<span>${x}</span>`).join('')}</div>${calendarGrid(all)}<div class="calendar-legend"><span><i class="legend-dot"></i> Подтверждено</span><span><i class="legend-dot tentative"></i> Не подтверждено</span><small>${monthEvents.length} в этом месяце</small></div></section><aside class="upcoming-panel"><p class="section-label">НА ГОРИЗОНТЕ</p><h2>Ближайшие события</h2>${all.length ? all.slice(0, 3).map(eventPreview).join('') : emptyState('Пока спокойно', 'Новые заказы появятся после обновления календаря.')}<div class="notice"><span>${icon('calendar')}</span><p>Расписание — из Google.<br>Вся подготовка — здесь.</p></div><p class="form-help">${state.lastCalendar ? `Обновлено ${fmt(state.lastCalendar, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : state.demo ? 'Показаны вымышленные события' : 'Календарь ещё не обновлялся'}</p></aside></div>`}</div>`;
}
function calendarGrid(all) {
  const year = state.month.getFullYear(), month = state.month.getMonth(), first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7, start = new Date(year, month, 1 - offset);
  const today = localDate(new Date().toISOString());
  return `<div class="calendar-grid">${Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayEvents = all.filter(r => localDate(r.payload.source.start) === key);
    return `<div class="day-cell ${d.getMonth() !== month ? 'outside' : ''} ${key === today ? 'today' : ''}"><span class="day-number" ${key === today ? 'aria-current="date"' : ''}>${d.getDate()}</span>${dayEvents.map(r => `<button class="calendar-event ${r.payload.source.status}" data-action="open-event" data-id="${esc(r.id)}" title="${esc(cleanTitle(r.payload.source.title))}"><span>${r.payload.source.status === 'tentative' ? '? ' : ''}${esc(cleanTitle(r.payload.source.title))}</span>${!r.payload.source.allDay ? `<small>${fmt(r.payload.source.start, { hour: '2-digit', minute: '2-digit' })}</small>` : ''}</button>`).join('')}</div>`;
  }).join('')}</div>`;
}
function eventPreview(r) {
  const { source: s, body: b } = r.payload, p = progress(b);
  return `<button class="event-preview" data-action="open-event" data-id="${esc(r.id)}"><span class="event-date">${fmt(s.start, { day: 'numeric', month: 'long' })}<span>${icon('arrow')}</span></span><strong>${esc(cleanTitle(s.title))}</strong>${badge(s.status)}<span class="progress-caption"><span>Подготовка</span><span>${p.percent}%</span></span><progress value="${p.percent}" max="100" aria-label="Подготовка ${p.percent}%"></progress></button>`;
}
function emptyState(title, text) { return `<div class="empty-state"><div class="empty-icon">${icon('calendar')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`; }
function editorHeading(number, title, subtitle, extra = '') { return `<div class="panel-header"><span class="panel-number">${number}</span><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${extra}</div>`; }
function field(label, value, data, options = {}) {
  const id = options.id || `f-${data.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  const attrs = `id="${id}" data-field="${esc(data)}" ${options.attrs || ''}`;
  return `<div class="field"><label for="${id}" class="field-label">${label}</label>${options.input ? `<input ${attrs} type="${options.input}" value="${esc(value)}" placeholder="${esc(options.placeholder || '')}">` : `<textarea ${attrs} class="${options.class || ''}" rows="${options.rows || 3}" placeholder="${esc(options.placeholder || '')}">${esc(value)}</textarea>`}</div>`;
}
function eventView() {
  const r = current(); if (!r) return emptyState('Карточка не найдена', 'Вернись к списку мероприятий.');
  const { source: s, body: b } = r.payload, p = progress(b);
  return `<div class="page-heading event-heading"><div>${button('back-calendar', 'Все мероприятия', 'back', 'ghost')}<h1>${esc(cleanTitle(s.title))}</h1><p class="subtitle">${icon('calendar')} ${esc(dateLabel(s))}</p></div>${badge(s.status)}</div>${s.status === 'deleted' ? '<p class="notice">Событие удалено из Google Календаря. Все материалы подготовки сохранены.</p>' : ''}<div class="editor-layout"><div class="editor-main"><section class="panel">${editorHeading('01', 'О мероприятии', 'Контекст, пожелания и важные детали')}${eventCategory(b.category)}${renderRichEditor('description', 'Описание', b.description, b.descriptionHtml)}${b.category === 'wedding' ? field('Анкеты', b.questionnaires || '', 'questionnaires', {placeholder:'Вставь сюда текст анкет молодожёнов…',rows:8,class:'questionnaires-field'}) : ''}${s.calendarDescription ? `<details class="calendar-description"><summary>Исходное описание из Google Календаря</summary><p class="plain-text">${esc(s.calendarDescription)}</p></details>` : ''}</section><section class="panel">${editorHeading('02', 'Быстрые заметки', 'Твой блокнот для звонков, встреч и внезапных идей')}${renderRichEditor('notes', 'Заметки', b.notes, b.notesHtml, {className:'notebook-field'})}<p class="form-help">${state.demo ? 'Демо: заметки сохраняются только в этом браузере.' : 'Автосохранение на устройстве и синхронизация с облаком при наличии интернета.'}</p></section><section class="panel">${editorHeading('03', 'Обсуждение мероприятия', 'Собери ответы, прежде чем приступать к подготовке', `<span class="section-progress">${b.questions.filter(x => x.done).length}/${b.questions.length}</span>`)}${eventQuestions(b)}${button('add-question', 'Добавить вопрос', 'plus', 'ghost')}${questionActions(b)}</section><section class="panel">${editorHeading('04', 'Подготовка', 'Шаг за шагом — к готовому мероприятию', `<span class="section-progress">${b.tasks.filter(x => x.done).length}/${b.tasks.length}</span>`)}${checklistTools('tasks')}<div class="checklist">${b.tasks.length ? renderChecklist(b.tasks, 'tasks') : '<p class="form-help">Добавь задачи подготовки или примени шаблон.</p>'}</div>${button('add-task', 'Добавить задачу', 'plus', 'ghost')}${taskActions(b)}</section><section class="panel">${editorHeading('05', 'Конечный сценарий', 'Основная версия — в Google Документах')}${field('Ссылка на Google Документ', b.scriptUrl, 'scriptUrl', { input: 'url', placeholder: 'https://docs.google.com/document/d/…', attrs: 'aria-describedby="script-help"' })}<p id="script-help" class="form-help">Чтобы открыть сценарий без интернета, заранее настрой офлайн-доступ в Google Документах.</p><div id="script-open">${scriptAction(b.scriptUrl)}</div></section></div><aside class="editor-aside"><section class="panel"><p class="section-label">ГОТОВНОСТЬ МЕРОПРИЯТИЯ</p><div class="summary-progress"><strong id="progress-percent">${p.percent}%</strong><span>шаг за шагом</span></div><progress id="event-progress" value="${p.percent}" max="100" aria-label="Готовность мероприятия"></progress><p class="form-help" id="progress-count">${p.done} из ${p.total} пунктов выполнено</p><div class="meta-list"><div class="meta-row">${icon('calendar')}<span>${esc(fmt(s.start, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div><div class="meta-row">${icon('clock')}<span>${s.allDay ? 'Время не указано в календаре' : `${fmt(s.start, { hour: '2-digit', minute: '2-digit' })}${s.end ? ` — ${fmt(s.end, { hour: '2-digit', minute: '2-digit' })}` : ''}`}</span></div>${s.location ? `<div class="meta-row">${icon('pin')}<span>${esc(s.location)}</span></div>` : ''}</div></section><section class="panel template-picker"><p class="section-label">ШАБЛОН ПОДГОТОВКИ</p><h3>${esc(CATEGORIES[b.category])}</h3><p class="form-help">${b.templateId ? 'Копия шаблона. Все изменения остаются только в этом мероприятии.' : 'Подбери вопросы и задачи под формат мероприятия.'}</p>${button('choose-template', b.templateId ? 'Добавить из шаблона' : 'Выбрать шаблон', 'templates', 'secondary')}</section><section class="notice">${icon('check')}<p id="offline-ready">Сохранено для работы на этом устройстве. Для первого открытия на другом устройстве нужен интернет.</p></section></aside></div>`;
}
function scriptAction(value) {
  const url = scriptLink(value);
  return url ? `<a class="button primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('external')}Открыть сценарий</a>` : value ? '<p class="error-text">Нужна ссылка вида https://docs.google.com/document/d/…</p>' : '';
}
function checklistItem(x, group, template = false) {
  const id = `${group}-${x.id}`;
  const attrs = name => `data-item-field="${name}" data-group="${group}" data-id="${esc(x.id)}"`;
  const settings = `<details class="item-settings"><summary>Раздел и подсказка</summary><label class="field">Раздел<input aria-label="Раздел пункта" ${attrs('section')} value="${esc(x.section)}" placeholder="Без раздела"></label><label class="field">Подсказка<textarea aria-label="Подсказка к пункту" rows="3" ${attrs('hint')} placeholder="Варианты, примеры и детали">${esc(x.hint)}</textarea></label></details>`;
  return `<div class="check-item compact-item ${x.done ? 'completed' : ''}" data-item="${esc(x.id)}"><div class="check-line">${!template ? `<label class="check-hit"><input class="check-input" type="checkbox" id="done-${id}" data-check="${group}" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} aria-label="${group === 'questions' ? 'Обсуждено' : 'Готово'}: ${esc(x.label)}"></label>` : ''}<details class="item-disclosure" data-section-key="item:${esc(id)}"><summary><span class="item-title">${esc(x.label || (group === 'questions' ? 'Новый вопрос' : 'Новая задача'))}</span>${!template && group === 'questions' ? `<span class="answer-preview">${x.answer ? 'Ответ записан' : 'Нет ответа'}</span>` : ''}</summary><div class="check-fields"><label class="field">${group === 'questions' ? 'Вопрос' : 'Задача'}<textarea rows="2" class="check-label" aria-label="${group === 'questions' ? 'Вопрос' : 'Задача'}" ${attrs('label')}>${esc(x.label)}</textarea></label>${x.hint ? `<p class="item-hint">${esc(x.hint)}</p>` : ''}${!template ? `${group === 'questions' ? `<label for="answer-${id}" class="field-label">Ответ</label><textarea rows="2" id="answer-${id}" class="answer" ${attrs('answer')} placeholder="Ответ заказчика">${esc(x.answer)}</textarea>` : ''}<details ${x.comment ? 'open' : ''}><summary>Комментарий · необязательно</summary><textarea aria-label="Комментарий к пункту" rows="2" class="comment" ${attrs('comment')}>${esc(x.comment)}</textarea></details><span class="form-help check-state">${x.done ? (group === 'questions' ? 'Обсуждено' : 'Готово') : ''}</span>` : ''}${settings}<div>${button('remove-item', 'Удалить пункт', 'trash', 'ghost', `data-group="${group}" data-id="${esc(x.id)}"`)}</div></div></details></div></div>`;
}
function checklistTools(group) {
  return `<div class="checklist-tools">${button('toggle-items', 'Развернуть пункты', '', 'ghost', `data-group="${group}" aria-expanded="false"`)}${group === 'tasks' ? button('import-tasks', 'Импорт из Excel', 'upload', 'ghost') : ''}</div>`;
}
function taskActions(body) {
  return `<div class="task-actions">${body.tasks.length ? button('clear-tasks','Очистить все задачи','trash','ghost') : ''}${body.tasksRecovery?.length ? button('restore-tasks',`Вернуть задачи (${body.tasksRecovery.length})`,'back','secondary') : ''}</div>`;
}
function questionActions(body) {
  return `<div class="task-actions">${body.questions.length ? button('clear-questions','Очистить все вопросы','trash','ghost') : ''}${body.questionsRecovery?.length ? button('restore-questions',`Вернуть вопросы (${body.questionsRecovery.length})`,'back','secondary') : ''}</div>`;
}
function eventCategory(category) {
  return `<label class="field">Тип мероприятия<select id="event-category" data-field="category">${Object.entries(CATEGORIES).map(([id,label])=>`<option value="${id}" ${category === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}
function eventQuestions(body) {
  return `<details class="question-block" data-section-key="question-block" open><summary>Вопросы и ответы · ${body.questions.length}<span>Показать / скрыть</span></summary>${checklistTools('questions')}<div class="checklist">${body.questions.length ? renderChecklist(body.questions, 'questions') : '<p class="form-help">Выбери шаблон или добавь вопрос.</p>'}</div></details>`;
}
function showCreateTemplate() {
  modal('Свой шаблон', `<label class="field">Название<input id="new-template-name" maxlength="120" placeholder="Например, камерная свадьба"></label><label class="field">Тип мероприятия<select id="new-template-category">${Object.entries(CATEGORIES).map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>`, `${button('close-modal','Отмена','','secondary')}${button('create-template','Создать шаблон','plus','primary')}`);
  $('#new-template-name').focus();
}
let pendingTaskImport;
function showTaskImport() {
  pendingTaskImport = null;
  modal('Задачи из Excel', `<p>В первом столбце — задачи, каждая с новой строки. Первая строка «Задача» — заголовок. Пустые строки пропускаются.</p>${button('download-task-workbook','Скачать шаблон .xlsx','download','secondary')}<label class="field import-file">Выбрать файл<input id="task-import-file" type="file" accept=".xlsx,.xls,.csv,.txt"></label><p class="form-help">До 2 МБ и 500 задач. Файл обрабатывается на устройстве. Задачи добавятся к существующим.</p>`);
}
async function previewTaskImport(file) {
  if (!file) return;
  const targetId = state.selected, labels = await parseTaskFile(file), target = record(targetId);
  if (state.selected !== targetId || !target || !$('#modal').open) return;
  const body = target.kind === 'event' ? target.payload.body : target.payload;
  if (body.tasks.length + labels.length > 500) throw new Error('В одном списке может быть не больше 500 задач. Уменьши файл или текущий список.');
  pendingTaskImport = { targetId, labels };
  modal('Проверка импорта', `<p>Будет добавлено задач: <strong>${labels.length}</strong>.</p><ol class="import-preview">${labels.slice(0,8).map(label=>`<li>${esc(label)}</li>`).join('')}</ol>${labels.length > 8 ? `<p>И ещё ${labels.length - 8}.</p>` : ''}<p class="form-help">Текущие пункты и отметки сохранятся.</p>`, `${button('close-modal','Отмена','','secondary')}${button('confirm-task-import','Добавить задачи','plus','primary')}`);
}
function renderChecklist(items, group, template = false) {
  if (!items.some(x => x.section?.trim())) return items.map(x => checklistItem(x, group, template)).join('');
  const sections = new Map();
  for (const x of items) {
    const name = x.section?.trim() || 'Без раздела';
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(x);
  }
  return [...sections].map(([name, entries], index) => `<details class="checklist-section" data-section-key="${esc(`${group}:${name}`)}" ${index === 0 ? 'open' : ''}><summary><span>${esc(name)}</span><span class="group-progress">${template ? entries.length : `${entries.filter(x => x.done).length}/${entries.length}`}</span></summary><div>${entries.map(x => checklistItem(x, group, template)).join('')}</div></details>`).join('');
}
function templatesView() {
  const t = current();
  if (t?.kind === 'template') return `<div class="page-heading"><div>${button('back-templates', 'Все шаблоны', 'back', 'ghost')}<p class="eyebrow">ОСНОВА ДЛЯ НОВЫХ МЕРОПРИЯТИЙ</p><h1>${esc(t.payload.name)}</h1><p class="subtitle">Правки действуют на будущие копии. Уже созданные карточки не меняются.</p></div></div><div class="template-editor"><section class="panel">${field('Название шаблона', t.payload.name, 'template-name', { input: 'text' })}</section><section class="panel">${editorHeading('01', 'Вопросы для обсуждения', 'У каждого вопроса в карточке появится поле ответа')}${checklistTools('questions')}<div class="checklist">${renderChecklist(t.payload.questions, 'questions', true)}</div>${button('add-question', 'Добавить вопрос', 'plus', 'ghost')}</section><section class="panel">${editorHeading('02', 'Задачи подготовки', 'Копируются в мероприятие без отметок о выполнении')}${checklistTools('tasks')}<div class="checklist">${renderChecklist(t.payload.tasks, 'tasks', true)}</div>${button('add-task', 'Добавить задачу', 'plus', 'ghost')}</section></div>`;
  return `<div class="page-heading"><div><p class="eyebrow">ПОДГОТОВКА НАЧИНАЕТСЯ НЕ С НУЛЯ</p><h1>Твои шаблоны<span class="heading-dot">.</span></h1><p class="subtitle">Собери вопросы и задачи один раз. Адаптируй их под каждый новый вечер.</p></div></div>${button('new-template', 'Создать свой шаблон', 'plus', 'primary')}<div class="template-grid own-templates">${templates().map(r => `<button class="template-tile" data-action="open-template" data-id="${esc(r.id)}"><span class="template-icon">${icon(r.payload.category === 'wedding' ? 'heart' : r.payload.category === 'birthday' ? 'spark' : 'templates')}</span><h2>${esc(r.payload.name)}</h2><p>${r.payload.questions.length} вопросов · ${r.payload.tasks.length} задач</p><span class="template-count">Редактировать шаблон ${icon('arrow')}</span></button>`).join('')}</div><div class="notice">${icon('note')}<p>Свадебный шаблон готов: вопросы для пары и отдельные задачи подготовки. Лишние пункты можно удалить, формулировки — изменить. «Другое» создаётся без шаблона; вопросы и задачи можно добавить вручную.</p></div>`;
}
function settingsView() {
  return `<div class="page-heading"><div><p class="eyebrow">ВСЁ ПОД КОНТРОЛЕМ</p><h1>Настройки<span class="heading-dot">.</span></h1><p class="subtitle">Подключения, сохранность данных и доступ с твоих устройств.</p></div></div><div class="settings-grid"><section class="panel settings-card"><h2>История и устройство</h2><label class="field">Название этого устройства<input id="device-label" maxlength="80" value="${esc(device.label)}" placeholder="Например, рабочий ноутбук"></label>${button('save-device-label','Сохранить название','check','secondary')}<div class="task-actions">${button('navigate','Открыть журнал','clock','ghost','data-route="changes"')}${button('clear-history','Очистить историю и память','trash','ghost')}</div></section><section class="panel settings-card"><h2>Версия сайта</h2><p class="app-version">За кулисами · ${APP_VERSION}</p><p class="form-help">Версия интерфейса обновляется отдельно от синхронизации заметок и задач.</p>${button('update-site','Обновить версию сайта','refresh','secondary')}</section><section class="panel settings-card"><h2>${icon('calendar')} Google Календарь</h2><p>🎤 Ведущий/Хобби</p><p class="form-help">Импортируются «Заказ:» и «?Заказ:». Даты и время меняются в Google Календаре. Доступ — только на чтение.</p><p>${state.lastCalendar ? `Последнее обновление: ${esc(fmt(state.lastCalendar, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}` : 'Ещё не синхронизирован'}</p><div class="script-actions">${button('sync', 'Обновить', 'refresh', 'secondary')}${!state.demo ? button('login', 'Переподключить Google', 'external', 'ghost') : ''}</div></section><section class="panel settings-card"><h2>${icon('download')} Резервная копия</h2><p>Все карточки, ответы, заметки и шаблоны — в одном файле.</p><p class="form-help">В копии только ссылки на сценарии. Содержимое Google Документов сохраняется отдельно. Файл содержит личные записи — храни его у себя.</p><p class="form-help">${state.lastBackup ? `Последняя выгрузка: ${esc(fmt(state.lastBackup, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}` : 'Резервная копия ещё не скачивалась'}</p><div class="script-actions">${button('backup', 'Скачать копию', 'download', 'primary')}${button('restore', 'Восстановить', 'upload', 'secondary')}</div><input type="file" id="restore-file" accept="application/json,.json" hidden></section><section class="panel settings-card"><h2>${icon('cloud')} Сохранение и устройства</h2><p>Карточки сохраняются на устройстве и отправляются в облако при наличии связи.</p><p class="form-help">Перед выездом открой нужную карточку на телефоне. Для сценария отдельно включи офлайн-доступ в Google Документах. На общем устройстве после работы выйди из кабинета.</p>${button('storage', 'Проверить офлайн-доступ', 'check', 'secondary')}<p id="storage-info" class="form-help"></p></section><section class="panel settings-card"><h2>${icon('note')} Разные версии</h2><p>${conflicts().length ? `Требуют выбора: ${conflicts().length}` : 'Конфликтов нет. Все версии согласованы.'}</p><p class="form-help">Если правки с двух устройств разойдутся, ни одна версия не будет перезаписана без твоего выбора.</p>${conflicts().length ? button('conflicts', 'Посмотреть версии', '', 'secondary') : ''}</section></div>`;
}

function changesView() {
  const entries = state.records.flatMap(r => (Array.isArray(r.payload._history) ? r.payload._history : []).map(entry => ({ r, entry })))
    .filter(x => typeof x.entry?.at === 'string' && Number.isFinite(Date.parse(x.entry.at)) && Array.isArray(x.entry.changes))
    .sort((a,b) => b.entry.at.localeCompare(a.entry.at));
  return `<div class="page-heading"><div><p class="eyebrow">ЧТО МЕНЯЛОСЬ И ОТКУДА</p><h1>История изменений</h1><p class="subtitle">После включения журнала сохраняются последние 100 изменений каждой записи. Последовательный набор текста объединяется в одну правку.</p></div></div><div class="toolbar">${button('clear-history','Очистить историю и память','trash','secondary')}${button('backup','Скачать резервную копию','download','ghost')}</div><p class="form-help">Устройство сейчас: ${esc(device.label)}. Здесь показаны последние 100 изменений по всем записям.</p><div class="change-log">${entries.slice(0,100).map(({r,entry})=>`<article class="panel change-entry"><div class="change-meta"><time datetime="${esc(entry.at)}">${esc(fmt(entry.at,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}))}</time><span>${esc(entry.deviceLabel || 'Устройство не указано')}</span></div><button class="change-title" data-action="${r.kind === 'event' ? 'open-event' : 'open-template'}" data-id="${esc(r.id)}">${esc(r.kind === 'event' ? cleanTitle(r.payload.source.title) : r.payload.name)}</button><p>${entry.changes.map(x=>esc(x.label)).join(' · ')}</p><details><summary>Что изменилось</summary>${entry.changes.map(x=>`<div class="change-values"><strong>${esc(x.label)}</strong><p><span>Было:</span> ${esc(x.before || 'Пусто')}</p><p><span>Стало:</span> ${esc(x.after || 'Пусто')}</p></div>`).join('')}</details></article>`).join('') || '<section class="panel"><h2>Изменений пока нет</h2><p>Новые правки появятся здесь вместе с временем и устройством. Старые изменения до включения журнала восстановить нельзя.</p></section>'}</div>`;
}
async function clearOldShells() {
  if (!('caches' in window) || !navigator.serviceWorker?.controller) return 0;
  const activeCache = await new Promise(resolve => {
    const channel = new MessageChannel(), timeout = setTimeout(()=>resolve(null),2000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.cache || null); };
    navigator.serviceWorker.controller.postMessage({type:'CACHE_STATUS'},[channel.port2]);
  });
  if (!activeCache) return 0;
  const prefix = `zk-shell:${new URL('.',location.href).pathname}:`, names = await caches.keys();
  const obsolete = names.filter(name=>name.startsWith(prefix) && name !== activeCache);
  await Promise.all(obsolete.map(name=>caches.delete(name))); return obsolete.length;
}
async function enterDemo() {
  if (!await acquireEditorLock('demo')) { loginView('Пример кабинета уже открыт в другой вкладке. Продолжи там или закрой ту вкладку.'); return; }
  state.demo = true; state.scope = 'demo'; state.records = await db.readRecords('demo');
  rememberHistory(state.records);
  sessionStorage.setItem('zk.demo', '1');
  if (!state.records.length) { state.records = demoRecords(); await db.writeMany('demo', state.records); }
  rememberHistory(state.records);
  for (const local of templates()) {
    const seeded = seedWeddingTemplate(local);
    if (seeded) { Object.assign(local, seeded); persist(local, false); }
  }
  state.lastCalendar = null; state.cloudError = ''; state.calendarError = '';
  navigate('calendar');
}
async function openAccount() {
  const scope = api.offlineAuthorized();
  if (!scope) return false;
  if (!await acquireEditorLock(scope)) { loginView('Кабинет уже открыт в другой вкладке. Продолжи там или закрой ту вкладку и обнови эту страницу.'); return true; }
  state.scope = scope; state.demo = false; state.records = await db.readRecords(scope);
  rememberHistory(state.records);
  state.lastCalendar = await db.getMeta(`${scope}:calendar`); state.lastBackup = await db.getMeta(`${scope}:backup`);
  const connectionError = sessionStorage.getItem('zk.calendar-connection-error');
  if (connectionError) { state.calendarError = connectionError; sessionStorage.removeItem('zk.calendar-connection-error'); }
  render();
  if (navigator.onLine) sync(true);
  return true;
}
async function exportBackup() {
  await persistQueue.catch(() => {});
  const data = { format: 'host-workspace', version: SCHEMA_VERSION, calendarId: CONFIG.calendarId, ownerEmail: state.demo ? 'demo' : CONFIG.ownerEmail, createdAt: new Date().toISOString(), records: state.records.map(r => ({ id: r.id, kind: r.kind, payload: clone(r.payload) })),
    // Keep both versions in a backup when a conflict has not been resolved yet.
    conflicts: state.records.filter(r => r.conflict?.payload).map(r => ({ id: r.id, kind: r.kind, payload: r.conflict.payload })) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `za-kulisami-${new Date().toISOString().slice(0, 10)}${state.demo ? '-demo' : ''}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  state.lastBackup = data.createdAt; await db.setMeta(`${state.scope}:backup`, data.createdAt); toast('Резервная копия подготовлена. Проверь папку загрузок.');
}
let pendingRestore;
async function previewRestore(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) throw new Error('Копия слишком большая: максимум 30 МБ.');
  let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('Не удалось прочитать JSON-файл.'); }
  const incoming = validateBackup(data, CONFIG.calendarId, state.demo ? 'demo' : CONFIG.ownerEmail);
  if (conflicts().length) throw new Error('Сначала выбери версии конфликтующих записей, затем восстанови копию.');
  pendingRestore = clone(incoming);
  const plan = restorePlan(state.records, incoming);
  modal('Восстановление из копии', `<p>Будут добавлены: <strong>${plan.added.length}</strong>. Будут изменены: <strong>${plan.changed.length}</strong>.</p><p>Записи, которых нет в копии, останутся. Текущие версии изменяемых записей будут сохранены на устройстве перед заменой.</p>${data.conflicts?.length ? '<p class="error-text">В копии есть дополнительные конфликтующие версии. Основные записи будут восстановлены; дополнительные версии останутся в исходном файле для ручной сверки.</p>' : ''}<p class="form-help">Сначала рекомендуется скачать текущую резервную копию.</p>`, `${button('close-modal', 'Отмена', '', 'secondary')}${button('confirm-restore', 'Восстановить записи', 'upload', 'primary')}`);
}
async function confirmRestore() {
  const scope = state.scope;
  await db.setMeta(`${scope}:before-restore:${Date.now()}`, clone(state.records));
  const plan = restorePlan(state.records, pendingRestore);
  for (const entry of [...plan.added, ...plan.changed]) {
    const old = record(entry.id);
    if (old) { old.payload = clone(entry.payload); changed(old, false); }
    else { const r = { ...clone(entry), version: 0, dirty: true, localUpdated: new Date().toISOString() }; state.records.push(r); persist(r, false); }
  }
  await persistQueue; pendingRestore = null; closeModal(); render(); toast('Копия восстановлена на устройстве.'); sync(false);
}
function chooseTemplate() {
  modal('Шаблон мероприятия', `<p>Вопросы и задачи добавятся к текущим. Заполненные ответы и отметки сохранятся.</p><div class="template-grid compact">${templates().map(t => `<button class="template-tile" data-action="apply-template" data-id="${esc(t.id)}"><h3>${esc(t.payload.name)}</h3><p>${t.payload.questions.length} вопросов · ${t.payload.tasks.length} задач</p></button>`).join('')}<button class="template-tile" data-action="no-template"><h3>Другое</h3><p>Без шаблона</p></button></div>`);
}
function showConflicts() {
  const r = conflicts()[0];
  if (!r) { closeModal(); render(); return; }
  const title = r.kind === 'event' ? cleanTitle(r.payload.source.title) : r.payload.name;
  const readable = payload => r.kind === 'event' ? JSON.stringify({ ...payload.body, calendar: payload.source }, null, 2) : JSON.stringify(payload, null, 2);
  modal('Выбери версию записи', `<p><strong>${esc(title)}</strong></p><p>Обе версии сохранены. Перед выбором можно скачать резервную копию и скопировать нужные фрагменты.</p><div class="conflict-preview"><div><h3>На этом устройстве</h3><pre>${esc(readable(r.payload))}</pre></div><div><h3>В облаке</h3><pre>${r.conflict.payload ? esc(readable(r.conflict.payload)) : 'Запись отсутствует'}</pre></div></div>`, `${button('backup', 'Скачать обе версии', 'download', 'ghost')}${button('resolve-remote', 'Оставить облачную', '', 'secondary', `data-id="${esc(r.id)}" ${!r.conflict.payload ? 'disabled' : ''}`)}${button('resolve-local', 'Оставить эту', '', 'primary', `data-id="${esc(r.id)}"`)}`, true);
}
async function resolveConflict(id, useLocal) {
  const r = record(id); if (!r?.conflict) return;
  await db.setMeta(`${state.scope}:conflict:${id}:${Date.now()}`, { local: clone(r), remote: clone(r.conflict) });
  const remote = r.conflict;
  if (useLocal) { r.version = remote.version; delete r.conflict; changed(r); }
  else { Object.assign(r, hydrate(remote)); delete r.conflict; persist(r, false); }
  await persistQueue; closeModal(); render(); if (conflicts().length) showConflicts(); else sync(false);
}
async function leave() {
  await persistQueue;
  const warning = !state.demo && state.records.some(r => r.dirty || r.conflict);
  modal(state.demo ? 'Выйти из примера?' : 'Выйти из кабинета?', `<p>${warning ? 'Есть изменения, которые ещё не отправлены в облако. Скачай резервную копию перед выходом.' : 'Локальные данные этого кабинета будут удалены с устройства при выходе.'}</p>`, `${warning ? button('backup', 'Скачать копию', 'download', 'secondary') : ''}${button('close-modal', 'Остаться', '', 'secondary')}${button('confirm-exit', 'Выйти', 'logout', 'danger')}`);
}
async function exitConfirmed() {
  clearTimeout(syncTimer); if (syncPromise) await syncPromise;
  await persistQueue;
  const scope = state.scope;
  if (!state.demo) { await api.logout().catch(() => api.clearAuth()); await db.clearScope(scope); }
  state = { ...state, scope: null, demo: false, records: [], route: 'calendar', selected: null, cloudError: '', calendarError: '' };
  releaseEditorLock?.(); releaseEditorLock = null; editorLockScope = null;
  sessionStorage.removeItem('zk.demo');
  failedWrites.clear(); state.persistError = '';
  closeModal(); loginView();
}

document.addEventListener('click', safeAction(async e => {
  const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
  e.preventDefault();
  const action = el.dataset.action;
  if (action === 'login') return api.login();
  if (action === 'demo') return enterDemo();
  if (action === 'save-device-label') {
    const label = $('#device-label').value.trim(); if (!label || label.length > 80) throw new Error('Название устройства: от 1 до 80 символов.');
    localStorage.setItem('zk.device-label',label); device.label = label; toast('Название устройства сохранено для следующих изменений.'); return;
  }
  if (action === 'clear-history') {
    if (conflicts().length) throw new Error('Сначала выбери версии конфликтующих записей, затем очисти историю.');
    modal('Очистить историю и служебную память?', '<p>Будет удалён журнал изменений всех мероприятий и шаблонов, старые служебные снимки восстановления и устаревшие офлайн-версии сайта на этом устройстве.</p><p>Текущие заметки, анкеты, задачи, шаблоны, вход в аккаунт и актуальная офлайн-версия останутся. Очистка журнала синхронизируется с другими устройствами.</p><p>Удалённый журнал нельзя вернуть без резервной копии.</p>', `${button('backup','Скачать копию','download','secondary')}${button('close-modal','Отмена','','secondary')}${button('confirm-clear-history','Очистить историю и память','trash','danger')}`); return;
  }
  if (action === 'confirm-clear-history') {
    if (conflicts().length) throw new Error('Сначала разреши конфликт версий.');
    for (const r of state.records) if (r.payload._history?.length) { delete r.payload._history; changed(r,false,false); }
    await persistQueue; const count = await db.clearAuxiliaryMeta(state.scope), cachesRemoved = await clearOldShells();
    closeModal(); render(); toast(`История очищена. Удалено служебных снимков: ${count}, старых версий: ${cachesRemoved}.`); sync(false); return;
  }
  if (action === 'update-site') {
    await persistQueue;
    if (state.persistError) throw new Error('Сначала скачай резервную копию: на устройстве есть ошибка сохранения.');
    if (!state.demo && navigator.onLine) await sync(false);
    location.assign('./update.html'); return;
  }
  if (action === 'clear-tasks') {
    const r = current(); if (r?.kind !== 'event') return;
    modal('Очистить задачи мероприятия?', `<p>Будут убраны все задачи подготовки: <strong>${r.payload.body.tasks.length}</strong>. Их отметки и комментарии сохранятся для возврата. Вопросы, ответы, заметки и анкеты останутся.</p>`, `${button('close-modal','Отмена','','secondary')}${button('confirm-clear-tasks','Очистить все задачи','trash','danger')}`); return;
  }
  if (action === 'clear-questions') {
    const r = current(); if (r?.kind !== 'event') return;
    modal('Очистить обсуждение мероприятия?', `<p>Будут убраны все вопросы: <strong>${r.payload.body.questions.length}</strong>, вместе с их ответами, комментариями и отметками. Их можно будет вернуть кнопкой под списком.</p><p>Задачи подготовки, заметки, описание и анкеты останутся.</p>`, `${button('close-modal','Отмена','','secondary')}${button('confirm-clear-questions','Очистить все вопросы','trash','danger')}`); return;
  }
  if (action === 'confirm-clear-questions' || action === 'restore-questions') {
    const r = current(); if (r?.kind !== 'event') return;
    r.payload.body = action === 'restore-questions' ? restoreQuestionList(r.payload.body) : clearQuestionList(r.payload.body);
    changed(r); closeModal(); render(); toast(action === 'restore-questions' ? 'Вопросы и ответы возвращены.' : 'Вопросы очищены. Их можно вернуть кнопкой под списком.'); return;
  }
  if (action === 'confirm-clear-tasks' || action === 'restore-tasks') {
    const r = current(); if (r?.kind !== 'event') return;
    r.payload.body = action === 'restore-tasks' ? restoreTaskList(r.payload.body) : clearTaskList(r.payload.body);
    changed(r); closeModal(); render(); toast(action === 'restore-tasks' ? 'Задачи возвращены.' : 'Задачи очищены. Их можно вернуть кнопкой под списком.'); return;
  }
  if (action === 'new-template') return showCreateTemplate();
  if (action === 'create-template') {
    const next = createTemplate($('#new-template-name').value, $('#new-template-category').value);
    state.records.push(next); changed(next); closeModal(); navigate('templates', next.id); toast('Свой шаблон создан. Добавь вопросы и задачи.'); return;
  }
  if (action === 'import-tasks') return showTaskImport();
  if (action === 'download-task-workbook') return downloadTaskWorkbook();
  if (action === 'confirm-task-import') {
    const pending = pendingTaskImport, r = pending && record(pending.targetId);
    if (!r || state.selected !== pending.targetId) throw new Error('Открой нужную карточку и повтори импорт.');
    const body = r.kind === 'event' ? r.payload.body : r.payload;
    if (body.tasks.length + pending.labels.length > 500) throw new Error('Не больше 500 задач в одном списке.');
    body.tasks.push(...pending.labels.map(label => item(label))); changed(r); pendingTaskImport = null; closeModal(); render(); toast(`Добавлено задач: ${pending.labels.length}`); return;
  }
  if (action === 'toggle-items') {
    const panel = el.closest('.panel'), items = [...panel.querySelectorAll('.item-disclosure')], expand = !items.every(x => x.open);
    for (const details of panel.querySelectorAll('.checklist-section, .item-disclosure')) details.open = expand;
    el.setAttribute('aria-expanded', String(expand)); el.querySelector('span').textContent = expand ? 'Свернуть пункты' : 'Развернуть пункты'; return;
  }
  if (action === 'navigate') return navigate(el.dataset.route);
  if (action === 'close-modal') return closeModal();
  if (action === 'exit') return leave();
  if (action === 'confirm-exit') return exitConfirmed();
  if (action === 'sync') return sync(true);
  if (action === 'open-event') return navigate('event', el.dataset.id);
  if (action === 'open-template') return navigate('templates', el.dataset.id);
  if (action === 'back-calendar') return navigate('calendar');
  if (action === 'back-templates') return navigate('templates');
  if (action === 'view-calendar') { state.view = 'calendar'; state.route = 'calendar'; render(); return; }
  if (action === 'view-list') { state.view = 'list'; render(); return; }
  if (action === 'filter') { state.filter = el.dataset.filter; render(); return; }
  if (action === 'today') { state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); return; }
  if (action === 'prev-month' || action === 'next-month') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + (action === 'prev-month' ? -1 : 1), 1); render(); return; }
  if (action === 'backup') return exportBackup();
  if (action === 'restore') { $('#restore-file').value = ''; $('#restore-file').click(); return; }
  if (action === 'confirm-restore') return confirmRestore();
  if (action === 'choose-template') return chooseTemplate();
  if (action === 'no-template') { current().payload.body.category = 'other'; changed(current()); closeModal(); render(); return; }
  if (['apply-template', 'repeat-template', 'template-tasks-only'].includes(action)) {
    const r = current(), t = record(el.dataset.id); if (!t || !r) return;
    if (action === 'apply-template' && r.payload.body.templateId === t.id) {
      modal('Этот шаблон уже применён', `<p>Повторное добавление создаст ещё ${t.payload.questions.length} вопросов и ${t.payload.tasks.length} задач.</p><p>Можно обновить только задачи: вопросы и ответы сохранятся, прежние задачи будут доступны для возврата.</p>`, `${button('close-modal','Отмена','','secondary')}${button('repeat-template','Добавить ещё одну копию','','secondary',`data-id="${esc(t.id)}"`)}${button('template-tasks-only','Обновить только задачи','','primary',`data-id="${esc(t.id)}"`)}`); return;
    }
    if (action === 'template-tasks-only') {
      r.payload.body = replaceTemplateTasks(r.payload.body, {...t.payload,id:t.id}); changed(r); closeModal(); render(); toast('Задачи обновлены. Вопросы и ответы сохранены.'); return;
    }
    r.payload.body = applyTemplate(r.payload.body, { ...t.payload, id: t.id }); changed(r); closeModal(); render(); toast('Шаблон добавлен. Существующие записи сохранены.'); return;
  }
  if (action === 'add-question' || action === 'add-task') {
    const r = current(), body = r.kind === 'event' ? r.payload.body : r.payload, group = action === 'add-question' ? 'questions' : 'tasks';
    if (body[group].length >= 500) throw new Error('Не больше 500 пунктов в одном списке.');
    const x = item(); body[group].push(x); changed(r); render(); const input = document.querySelector(`[data-item-field="label"][data-id="${x.id}"]`);
    for (let ancestor = input?.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    input?.focus(); return;
  }
  if (action === 'remove-item') {
    const r = current(), body = r.kind === 'event' ? r.payload.body : r.payload, group = el.dataset.group, x = body[group]?.find(x => x.id === el.dataset.id); if (!x) return;
    modal('Удалить пункт?', `<p>${esc(x.label || 'Пустой пункт')}${x.answer || x.comment ? ' — вместе с ответом и комментарием.' : ''}</p>`, `${button('close-modal', 'Отмена', '', 'secondary')}${button('confirm-remove', 'Удалить пункт', 'trash', 'danger', `data-group="${group}" data-id="${esc(x.id)}"`)}`); return;
  }
  if (action === 'confirm-remove') {
    const r = current(), body = r.kind === 'event' ? r.payload.body : r.payload; body[el.dataset.group] = body[el.dataset.group].filter(x => x.id !== el.dataset.id); changed(r); closeModal(); render(); return;
  }
  if (action === 'conflicts') return showConflicts();
  if (action === 'resolve-local' || action === 'resolve-remote') return resolveConflict(el.dataset.id, action === 'resolve-local');
  if (action === 'storage') {
    const granted = await navigator.storage?.persist?.();
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    $('#storage-info').textContent = `${regs?.some(r => r.active) ? 'Оболочка сайта сохранена для работы без интернета.' : 'Оболочка ещё не готова: обнови страницу при наличии интернета.'} ${granted ? 'Браузер разрешил постоянное хранение.' : 'Браузер может очистить данные при нехватке места. Делай резервные копии.'}`;
  }
}));
document.addEventListener('input', safeAction(async e => {
  const el = e.target;
  if (el.id === 'event-search') {
    state.query = el.value; const focusStart = el.selectionStart; const content = calendarView(state.route === 'archive');
    const parser = new DOMParser().parseFromString(content, 'text/html'); $('#event-results').innerHTML = parser.querySelector('#event-results').innerHTML;
    if (focusStart !== null) el.setSelectionRange?.(focusStart, focusStart); return;
  }
  const r = current(); if (!r) return;
  if (el.dataset.field) {
    const key = el.dataset.field;
    if (r.kind === 'template' && key === 'template-name') r.payload.name = el.value;
    else if (r.kind === 'template' && key === 'template-category' && Object.hasOwn(CATEGORIES, el.value)) r.payload.category = el.value;
    else if (r.kind === 'event' && ['description', 'notes', 'category', 'scriptUrl', 'questionnaires'].includes(key)) {
      if (key === 'scriptUrl') {
        const checked = scriptLink(el.value);
        $('#script-open').innerHTML = scriptAction(el.value);
        el.setAttribute('aria-invalid', String(checked === null));
        // Draft links are text; only the validated action can open them.
        r.payload.body.scriptUrl = el.value;
      } else r.payload.body[key] = el.value;
    } else return;
    changed(r);
    if (key === 'category') render();
  }
  if (el.dataset.itemField && ['label', 'answer', 'comment', 'section', 'hint'].includes(el.dataset.itemField)) {
    const body = r.kind === 'event' ? r.payload.body : r.payload, x = body[el.dataset.group]?.find(x => x.id === el.dataset.id);
    if (x) {
      x[el.dataset.itemField] = el.value;
      const container = el.closest('.check-item');
      if (el.dataset.itemField === 'label') container.querySelector('.item-title').textContent = el.value || 'Новый пункт';
      if (el.dataset.itemField === 'answer' && container.querySelector('.answer-preview')) container.querySelector('.answer-preview').textContent = el.value ? 'Ответ записан' : 'Нет ответа';
      if (el.dataset.itemField === 'label') el.closest('.check-item')?.querySelector('.check-input')?.setAttribute('aria-label', `${el.dataset.group === 'questions' ? 'Обсуждено' : 'Готово'}: ${el.value}`);
      changed(r);
    }
  }
}));
document.addEventListener('change', safeAction(async e => {
  const el = e.target;
  if (el.id === 'restore-file') return previewRestore(el.files[0]);
  if (el.id === 'task-import-file') return previewTaskImport(el.files[0]);
  if (el.dataset.check) {
    const r = current(), body = r?.payload.body, x = body?.[el.dataset.check]?.find(x => x.id === el.dataset.id); if (!x) return;
    x.done = el.checked; changed(r);
    const p = progress(body); $('#progress-percent').textContent = `${p.percent}%`; $('#event-progress').value = p.percent; $('#progress-count').textContent = `${p.done} из ${p.total} пунктов выполнено`;
    const container = el.closest('.check-item'); container.classList.toggle('completed', x.done); container.querySelector('.check-state').textContent = x.done ? (el.dataset.check === 'questions' ? 'Обсуждено' : 'Готово') : '';
    const panel = el.closest('.panel'), group = body[el.dataset.check]; panel.querySelector('.section-progress').textContent = `${group.filter(x => x.done).length}/${group.length}`;
    const section = el.closest('.checklist-section');
    if (section) {
      const checks = [...section.querySelectorAll('.check-input')];
      section.querySelector('.group-progress').textContent = `${checks.filter(x => x.checked).length}/${checks.length}`;
    }
  }
}));
window.addEventListener('online', () => { updateStatus(); sync(true); });
window.addEventListener('offline', updateStatus);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastAutoSync > 15000) { lastAutoSync = Date.now(); sync(true); } });
window.addEventListener('beforeunload', e => { if (state.persistError || pendingWrites > 0) { e.preventDefault(); e.returnValue = ''; } });

async function init() {
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    if (new URLSearchParams(location.search).get('demo') === '1' || sessionStorage.getItem('zk.demo') === '1') { history.replaceState(null, '', location.pathname); await enterDemo(); return; }
    if (navigator.onLine) {
      try { await api.completeLogin(); }
      catch (e) { if (!api.offlineAuthorized()) { loginView(errorMessage(e)); return; } state.calendarError = errorMessage(e); }
    }
    if (!await openAccount()) loginView();
  } catch (e) { loginView(errorMessage(e)); }
}
init();
