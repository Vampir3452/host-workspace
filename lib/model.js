export const SCHEMA_VERSION = 1;
export const CATEGORIES = { wedding: 'Свадьба', birthday: 'День рождения', corporate: 'Корпоратив', other: 'Другое' };
export const clone = value => structuredClone(value);
export const uid = () => crypto.randomUUID();
export function orderStatus(title = '') {
  if (/^\?Заказ:/.test(title)) return 'tentative';
  return /^Заказ:/.test(title) ? 'confirmed' : null;
}
export function cleanTitle(title) { return title.replace(/^\??Заказ:\s*/, ''); }
export function emptyBody() { return { description: '', notes: '', category: 'other', templateId: null, questions: [], tasks: [], scriptUrl: '' }; }
export function item(label = '') { return { id: uid(), label, answer: '', comment: '', done: false }; }
export function applyTemplate(body, template) {
  const copy = clone(body);
  return { ...copy, category: template.category, templateId: template.id,
    questions: [...copy.questions, ...template.questions.map(x => item(x.label))],
    tasks: [...copy.tasks, ...template.tasks.map(x => item(x.label))] };
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
      if (JSON.stringify(old.payload.source) !== JSON.stringify(source)) {
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
    payload: { name, category, questions: [], tasks: [] }, localUpdated: new Date().toISOString(),
  }));
}
function validateItem(x) {
  return x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.done === 'boolean'
    && typeof x.answer === 'string' && typeof x.comment === 'string';
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
  if (kind === 'template') return typeof p.name === 'string' && Object.hasOwn(CATEGORIES, p.category)
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
