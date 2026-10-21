export const MAX_HISTORY_RECORDS = 100;
const COALESCE_MS = 60000;
const labels = {
  name: 'Название шаблона', category: 'Тип мероприятия', templateId: 'Шаблон мероприятия',
  description: 'Описание', notes: 'Быстрые заметки', questionnaires: 'Анкеты', scriptUrl: 'Ссылка на сценарий',
  questions: 'Вопросы для обсуждения', tasks: 'Задачи подготовки',
  descriptionHtml: 'Оформление описания', notesHtml: 'Оформление заметок',
  'source.title': 'Название в календаре', 'source.start': 'Начало в календаре',
  'source.end': 'Окончание в календаре', 'source.location': 'Место в календаре',
  'source.status': 'Статус в календаре', 'source.calendarDescription': 'Описание в календаре',
};
const categoryNames = { wedding: 'Свадьба', birthday: 'День рождения', corporate: 'Корпоратив', other: 'Другое' };
const statusNames = { confirmed: 'Подтверждено', tentative: 'Не подтверждено', deleted: 'Удалено из календаря' };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const serialise = value => JSON.stringify(canonical(value)) ?? 'undefined';
const equal = (left, right) => serialise(left) === serialise(right);
function fingerprint(value) {
  const text = serialise(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
function brief(value, max = 300) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, Math.floor((max - 30) / 2))} … ${text.slice(-Math.floor((max - 30) / 2))} (${text.length} символов)`;
}
const itemLabel = item => `«${String(item?.label || 'Без названия').slice(0, 65)}»`;
function listSummary(items, group) {
  const noun = group === 'questions' ? 'Вопросов' : 'Задач';
  return `${noun}: ${items.length}; отмечено: ${items.filter(item => item.done).length}`;
}
function listChange(before, after, group) {
  const left = Array.isArray(before) ? before : [], right = Array.isArray(after) ? after : [];
  const oldById = new Map(left.map(item => [item.id, item])), newById = new Map(right.map(item => [item.id, item]));
  const removed = left.filter(item => !newById.has(item.id)), added = right.filter(item => !oldById.has(item.id));
  const modified = right.filter(item => oldById.has(item.id) && !equal(oldById.get(item.id), item));
  const beforeParts = [listSummary(left, group)], afterParts = [listSummary(right, group)];
  if (removed.length) beforeParts.push(`Удаляемые: ${removed.slice(0, 3).map(itemLabel).join(', ')}${removed.length > 3 ? '…' : ''}`);
  if (added.length) afterParts.push(`Добавлены: ${added.slice(0, 3).map(itemLabel).join(', ')}${added.length > 3 ? '…' : ''}`);
  for (const item of modified.slice(0, 3)) {
    const old = oldById.get(item.id);
    beforeParts.push(`${itemLabel(old)}${old.done ? ' — отмечено' : ''}`);
    const details = [];
    if (Boolean(old.done) !== Boolean(item.done)) details.push(item.done ? (group === 'questions' ? 'обсуждено' : 'выполнено') : 'отметка снята');
    if (old.label !== item.label) details.push('изменено название');
    if ((old.answer || '') !== (item.answer || '')) details.push(item.answer ? `ответ: ${String(item.answer).slice(0, 70)}` : 'ответ очищен');
    if ((old.comment || '') !== (item.comment || '')) details.push('изменён комментарий');
    if ((old.hint || '') !== (item.hint || '')) details.push('изменена подсказка');
    if ((old.section || '') !== (item.section || '')) details.push('изменён раздел');
    afterParts.push(`${itemLabel(item)}: ${details.join(', ') || 'изменён пункт'}`);
  }
  if (!removed.length && !added.length && !modified.length && !equal(left, right)) afterParts.push('Изменён порядок пунктов');
  return { before: brief(beforeParts.join('. ')), after: brief(afterParts.join('. ')) };
}
function scalarSummary(value, field) {
  if (field === 'category') return categoryNames[value] || brief(value);
  if (field === 'source.status') return statusNames[value] || brief(value);
  if (field.endsWith('Html')) return value ? 'Есть сохранённое оформление' : 'Без оформления';
  return brief(value);
}
function change(field, before, after) {
  const summaries = ['questions', 'tasks'].includes(field) ? listChange(before, after, field)
    : { before: scalarSummary(before, field), after: scalarSummary(after, field) };
  if (field.endsWith('Html') && summaries.before === summaries.after) summaries.after = 'Оформление изменено';
  return { field, label: labels[field] || field, ...summaries, _beforeHash: fingerprint(before), _afterHash: fingerprint(after) };
}
/** A compact activity journal, not a full-content backup or security audit log. */
export function recordChanges(beforePayload, afterPayload, device, { now = new Date() } = {}) {
  const copy = structuredClone(afterPayload);
  const at = new Date(now).toISOString();
  const history = Array.isArray(copy._history) ? copy._history.slice(-MAX_HISTORY_RECORDS) : [];
  const changes = [];
  if (!beforePayload) {
    changes.push(change('record', '', copy.name || copy.source?.title || 'Новая запись'));
    changes[0].label = 'Создана запись';
  } else {
    const isEvent = Boolean(copy.body);
    const before = isEvent ? beforePayload.body || {} : beforePayload;
    const after = isEvent ? copy.body : copy;
    const fields = isEvent ? ['description', 'notes', 'questionnaires', 'scriptUrl', 'category', 'templateId', 'questions', 'tasks', 'descriptionHtml', 'notesHtml']
      : ['name', 'category', 'questions', 'tasks'];
    for (const field of fields) if (!equal(before[field], after[field])) {
      // The text entry already explains the edit; add a format entry only when text did not change.
      if (field.endsWith('Html') && before[field.slice(0, -4)] !== after[field.slice(0, -4)]) continue;
      changes.push(change(field, before[field], after[field]));
    }
    if (isEvent) for (const field of ['title', 'start', 'end', 'location', 'status', 'calendarDescription']) {
      if (!equal(beforePayload.source?.[field], copy.source?.[field])) changes.push(change(`source.${field}`, beforePayload.source?.[field], copy.source?.[field]));
    }
  }
  if (!changes.length) return copy;
  const deviceId = String(device?.id || 'unknown'), deviceLabel = brief(device?.label || 'Устройство', 100);
  const previous = history[history.length - 1];
  const sameFields = previous && Array.isArray(previous.changes) && previous.changes.length === changes.length
    && previous.changes.every((entry, index) => entry.field === changes[index].field);
  const elapsed = previous ? Date.parse(at) - Date.parse(previous.at) : NaN;
  const textEdit = changes.every(entry => {
    if (['notes','notesHtml','description','descriptionHtml','questionnaires','name','scriptUrl'].includes(entry.field)) return true;
    if (!['questions','tasks'].includes(entry.field) || !beforePayload) return false;
    const before = (beforePayload.body || beforePayload)[entry.field], after = (copy.body || copy)[entry.field];
    return Array.isArray(before) && Array.isArray(after) && before.length === after.length && before.every((item,index) => item.id === after[index].id && item.done === after[index].done);
  });
  if (textEdit && previous && previous._textEdit !== false && previous.deviceId === deviceId && sameFields && elapsed >= 0 && elapsed < COALESCE_MS) {
    const merged = changes.map((entry, index) => ({ ...entry, before: previous.changes[index].before, _beforeHash: previous.changes[index]._beforeHash || fingerprint(previous.changes[index].before) }))
      .filter(entry => entry._beforeHash !== entry._afterHash);
    if (merged.length) history[history.length - 1] = { ...previous, at, deviceLabel, changes: merged };
    else history.pop();
  } else history.push({ id: crypto.randomUUID(), at, deviceId, deviceLabel, changes, _textEdit: textEdit });
  copy._history = history.slice(-MAX_HISTORY_RECORDS);
  return copy;
}

export function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone / iPad'
    : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Устройство';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /(?:Firefox|FxiOS)\//i.test(ua) ? 'Firefox'
    : /(?:Chrome|CriOS)\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Браузер';
  return `${platform} · ${browser}`;
}
