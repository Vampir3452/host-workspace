import { WEDDING_TEMPLATE } from './wedding-template.js';

export const SCHEMA_VERSION = 1;
export const CATEGORIES = { wedding: 'Свадьба', birthday: 'День рождения', corporate: 'Корпоратив', other: 'Другое' };
export const clone = value => structuredClone(value);
// JSONB may return object keys in a different order; array order remains meaningful.
export function sameContent(left, right) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export const uid = () => crypto.randomUUID();
export function orderStatus(title = '') {
  if (/^\?Заказ:/.test(title)) return 'tentative';
  return /^Заказ:/.test(title) ? 'confirmed' : null;
}
export function cleanTitle(title) { return title.replace(/^\??Заказ:\s*/, ''); }
export function emptyBody() { return { description: '', notes: '', category: 'other', templateId: null, questions: [], tasks: [], scriptUrl: '', questionnaires: '', totalCost: '', team: '' }; }
export function item(label = '') { return { id: uid(), label, answer: '', comment: '', done: false }; }
export function createTemplate(name, category = 'other') {
  const title = name.trim();
  if (!title || title.length > 120 || !Object.hasOwn(CATEGORIES, category)) throw new Error('Укажи название шаблона (до 120 символов) и тип мероприятия.');
  return { id: `template:custom-${uid()}`, kind: 'template', version: 0, dirty: true, localUpdated: new Date().toISOString(), payload: { name: title, category, questions: [], tasks: [] } };
}
export function clearTaskList(body) {
  if (!body.tasks.length) return clone(body);
  return { ...clone(body), tasks: [], tasksRecovery: clone(body.tasks) };
}
export function restoreTaskList(body) {
  const copy = clone(body), ids = new Set(copy.tasks.map(x => x.id));
  const recovered = (copy.tasksRecovery || []).filter(x => !ids.has(x.id));
  if (copy.tasks.length + recovered.length > 500) throw new Error('Для возврата задач освободи место: максимум 500 пунктов.');
  copy.tasks.push(...recovered); delete copy.tasksRecovery; return copy;
}
export function clearQuestionList(body) {
  if (!body.questions.length) return clone(body);
  return { ...clone(body), questions: [], questionsRecovery: clone(body.questions) };
}
export function restoreQuestionList(body) {
  const copy = clone(body), ids = new Set(copy.questions.map(x => x.id));
  const recovered = (copy.questionsRecovery || []).filter(x => !ids.has(x.id));
  if (copy.questions.length + recovered.length > 500) throw new Error('Для возврата вопросов освободи место: максимум 500 пунктов.');
  copy.questions.push(...recovered); delete copy.questionsRecovery; return copy;
}
export function discardRecoveredItems(body, group) {
  if (!['questions','tasks'].includes(group)) throw new Error('Неизвестный список.');
  const copy = clone(body); delete copy[`${group}Recovery`]; return copy;
}
export function replaceTemplateTasks(body, template) {
  const copy = clearTaskList(body);
  copy.tasks = template.tasks.map(x => templateItem(x, true));
  copy.category = template.category; copy.templateId = template.id;
  return copy;
}
function templateItem(source, freshId = false) {
  return {
    id: freshId ? uid() : source.id, label: source.label, answer: '', comment: '', done: false,
    ...(source.section !== undefined ? { section: source.section } : {}),
    ...(source.hint !== undefined ? { hint: source.hint } : {}),
  };
}
function weddingPayload() {
  return { ...clone(WEDDING_TEMPLATE),
    questions: WEDDING_TEMPLATE.questions.map(x => templateItem(x)),
    tasks: WEDDING_TEMPLATE.tasks.map(x => templateItem(x)) };
}
export function applyTemplate(body, template) {
  if (['questions', 'tasks'].some(group => body[group].length + template[group].length > 500)) throw new Error('В одном списке может быть не больше 500 пунктов. Уменьши шаблон или текущий список.');
  const copy = clone(body);
  return { ...copy, category: template.category, templateId: template.id,
    questions: [...copy.questions, ...template.questions.map(x => templateItem(x, true))],
    tasks: [...copy.tasks, ...template.tasks.map(x => templateItem(x, true))] };
}
export function calendarSource(event) {
  return { googleId: event.id, title: event.summary || '', start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date, allDay: Boolean(event.start?.date), location: event.location || '',
    htmlLink: event.htmlLink || '', status: event.status === 'cancelled' ? 'deleted' : orderStatus(event.summary),
    updated: event.updated || '', calendarDescription: event.description || '' };
}
// Deletion is inferred only after ALL pages of a complete calendar snapshot were received.
export function reconcileCalendar(existing, events) {
  const result = new Map(existing.map(x => [x.id, clone(x)]));
  const seen = new Set();
  for (const event of events) {
    const id = `event:${event.id}`;
    if (!orderStatus(event.summary) || event.status === 'cancelled') continue;
    seen.add(id);
    const source = calendarSource(event);
    const old = result.get(id);
    if (old) {
      if (!sameContent(old.payload.source, source)) {
        old.payload.source = source; old.dirty = true; old.localUpdated = new Date().toISOString();
      }
    } else result.set(id, { id, kind: 'event', version: 0, dirty: true, localUpdated: new Date().toISOString(), payload: { source, body: emptyBody() } });
  }
  for (const record of result.values()) {
    if (record.kind === 'event' && !seen.has(record.id) && record.payload.source.status !== 'deleted') {
      record.payload.source.status = 'deleted'; record.dirty = true; record.localUpdated = new Date().toISOString();
    }
  }
  return [...result.values()];
}
export function scriptLink(value) {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && !url.username && !url.password && !url.port && /^\/document\/d\/[\w-]+(?:\/|$)/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
export function progress(body) {
  const all = [...body.questions, ...body.tasks];
  return { done: all.filter(x => x.done).length, total: all.length, percent: all.length ? Math.round(all.filter(x => x.done).length / all.length * 100) : 0 };
}
export function localDate(date, timeZone = 'Asia/Yekaterinburg') {
  if (!date) return '';
  return date.length === 10 ? date : new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}
export function defaultTemplates() {
  return Object.entries(CATEGORIES).filter(([k]) => k !== 'other').map(([category, name]) => ({
    id: `template:${category}`, kind: 'template', version: 0, dirty: true,
    payload: category === 'wedding' ? weddingPayload() : { name, category, questions: [], tasks: [] }, localUpdated: new Date().toISOString(),
  }));
}
// Seed only an untouched legacy blank. The marker survives later edits or intentional clearing.
export function seedWeddingTemplate(record) {
  if (record?.id !== 'template:wedding' || record.kind !== 'template' || record.conflict
    || !record.payload || record.payload.category !== 'wedding'
    || record.payload.contentVersion >= WEDDING_TEMPLATE.contentVersion
    || !Array.isArray(record.payload.questions) || record.payload.questions.length
    || !Array.isArray(record.payload.tasks) || record.payload.tasks.length) return null;
  return { ...clone(record), payload: weddingPayload(), dirty: true, localUpdated: new Date().toISOString() };
}
function validateItem(x) {
  return x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.done === 'boolean'
    && typeof x.answer === 'string' && typeof x.comment === 'string'
    && ['section', 'hint'].every(k => x[k] === undefined || typeof x[k] === 'string');
}
function validCalendarDate(value) {
  if (typeof value !== 'string') return false;
  // Date.parse normalises invalid days such as 29 February in a non-leap year.
  // Validate the calendar part first, then accept only an all-day date or RFC3339 time.
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!date) return false;
  const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return false;
  if (value.length === 10) return true;
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}
export function validatePayload(kind, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (p._history !== undefined && (!Array.isArray(p._history) || p._history.length > 100 || !p._history.every(entry => entry && typeof entry.id === 'string' && typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at)) && typeof entry.deviceId === 'string' && typeof entry.deviceLabel === 'string' && Array.isArray(entry.changes) && entry.changes.length <= 30 && entry.changes.every(change => change && ['field','label','before','after'].every(key => typeof change[key] === 'string'))))) return false;
  if (kind === 'template') return typeof p.name === 'string' && Object.hasOwn(CATEGORIES, p.category)
    && (p.contentVersion === undefined || (Number.isSafeInteger(p.contentVersion) && p.contentVersion >= 0))
    && ['questions', 'tasks'].every(k => Array.isArray(p[k]) && p[k].length <= 500 && p[k].every(validateItem));
  if (kind !== 'event' || !p.source || !p.body || typeof p.source !== 'object' || typeof p.body !== 'object'
    || Array.isArray(p.source) || Array.isArray(p.body)) return false;
  const s = p.source, b = p.body;
  return typeof s.googleId === 'string' && typeof s.title === 'string' && validCalendarDate(s.start)
    && (s.end === undefined || validCalendarDate(s.end))
    && (s.allDay === undefined || typeof s.allDay === 'boolean')
    && ['location', 'htmlLink', 'updated', 'calendarDescription'].every(k => s[k] === undefined || typeof s[k] === 'string')
    && ['confirmed', 'tentative', 'deleted'].includes(s.status)
    && ['description', 'notes', 'scriptUrl'].every(k => typeof b[k] === 'string')
    && ['descriptionHtml', 'notesHtml'].every(k => b[k] === undefined || typeof b[k] === 'string')
    && (b.questionnaires === undefined || typeof b.questionnaires === 'string')
    && (b.totalCost === undefined || typeof b.totalCost === 'string')
    && (b.team === undefined || typeof b.team === 'string')
    && (b.tasksRecovery === undefined || (Array.isArray(b.tasksRecovery) && b.tasksRecovery.length <= 500 && b.tasksRecovery.every(validateItem)))
    && (b.questionsRecovery === undefined || (Array.isArray(b.questionsRecovery) && b.questionsRecovery.length <= 500 && b.questionsRecovery.every(validateItem)))
    && Object.hasOwn(CATEGORIES, b.category) && (b.templateId === null || typeof b.templateId === 'string')
    // A partially typed script URL is legitimate saved text. Validate only when opening it.
    && ['questions', 'tasks'].every(k => Array.isArray(b[k]) && b[k].length <= 500 && b[k].every(validateItem));
}
export function validateBackup(data, calendarId, ownerEmail) {
  if (data?.format !== 'host-workspace' || data.version !== SCHEMA_VERSION || !Array.isArray(data.records)) throw new Error('Это не резервная копия «За кулисами» поддерживаемой версии.');
  if (data.calendarId !== calendarId || data.ownerEmail !== ownerEmail) throw new Error('Копия относится к другому аккаунту или календарю.');
  if (data.records.length > 20000) throw new Error('Слишком много записей в копии.');
  const ids = new Set();
  for (const r of data.records) {
    if (!r || !['event', 'template'].includes(r.kind) || typeof r.id !== 'string' || r.id.length > 300 || !r.id.startsWith(`${r.kind}:`) || ids.has(r.id) || !validatePayload(r.kind, r.payload)) throw new Error('В копии есть повреждённые или повторяющиеся записи.');
    if (r.kind === 'event' && r.id !== `event:${r.payload.source.googleId}`) throw new Error('Идентификатор мероприятия повреждён.');
    ids.add(r.id);
  }
  return data.records;
}
export function restorePlan(current, incoming) {
  const map = new Map(current.map(x => [x.id, x]));
  return { added: incoming.filter(x => !map.has(x.id)), changed: incoming.filter(x => map.has(x.id) && JSON.stringify(map.get(x.id).payload) !== JSON.stringify(x.payload)) };
}
export function demoRecords() {
  const year = new Date().getFullYear();
  const source = (id, title, date, status = 'confirmed') => ({ googleId: id, title: `${status === 'tentative' ? '?' : ''}Заказ: ${title}`, start: `${year}-${date}T17:00:00+05:00`, end: `${year}-${date}T23:00:00+05:00`, allDay: false, location: 'Демонстрационная площадка', status, htmlLink: '', updated: '' });
  const body = emptyBody(); body.category = 'wedding'; body.description = 'Камерная свадьба для самых близких. Тёплая атмосфера, живое общение и немного импровизации.';
  body.questions = [item('Обсудить настроение и формат вечера'), item('Уточнить состав гостей и важные имена'), item('Узнать пожелания к интерактивам')];
  body.questions[0].done = true; body.questions[0].answer = 'Лёгкий вечер без официальных речей. Больше общения с гостями.';
  body.tasks = [item('Подготовить структуру вечера'), item('Согласовать тайминг с площадкой'), item('Проверить звук и оборудование')]; body.tasks[0].done = true;
  const nextMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  return [
    { id: 'event:demo-wedding', kind: 'event', payload: { source: source('demo-wedding', 'Свадьба · Анна и Михаил', `${nextMonth}-24`), body } },
    { id: 'event:demo-birthday', kind: 'event', payload: { source: source('demo-birthday', 'День рождения · Мария', `${nextMonth}-27`, 'tentative'), body: { ...emptyBody(), category: 'birthday' } } },
    { id: 'event:demo-corporate', kind: 'event', payload: { source: source('demo-corporate', 'Корпоратив · Команда', `${nextMonth}-28`), body: { ...emptyBody(), category: 'corporate' } } },
    ...defaultTemplates(),
  ].map(r => ({ version: 0, dirty: false, localUpdated: new Date().toISOString(), ...r, dirty: false }));
}

