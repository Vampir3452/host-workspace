import test from 'node:test';
import assert from 'node:assert/strict';
import { orderStatus, cleanTitle, emptyBody, item, applyTemplate, calendarSource, reconcileCalendar, scriptLink, progress, localDate, defaultTemplates, validatePayload, validateBackup, restorePlan, demoRecords } from '../lib/model.js';

const google = (id = 'abc', overrides = {}) => ({ id, summary: 'Заказ: Свадьба', start: { date: '2026-11-21' }, end: { date: '2026-11-22' }, updated: '2026-10-21T10:00:00Z', ...overrides });
const eventRecord = (event = google()) => ({ id: `event:${event.id}`, kind: 'event', version: 3, dirty: false, payload: { source: calendarSource(event), body: emptyBody() } });
const backup = records => ({ format: 'host-workspace', version: 1, ownerEmail: 'owner@example.com', calendarId: 'calendar', records });

test('imports only exact confirmed and tentative order prefixes', () => {
  assert.equal(orderStatus('Заказ: Свадьба'), 'confirmed');
  assert.equal(orderStatus('?Заказ: Корпоратив'), 'tentative');
  for (const text of ['Написать Майе', ' Заказ: тест', 'заказ: тест', '??Заказ: тест', 'Встреча Заказ: тест', 'Заказ без двоеточия']) assert.equal(orderStatus(text), null);
  assert.equal(cleanTitle('?Заказ: Свадьба'), 'Свадьба');
});

test('confirming, moving, deleting and restoring an order preserves all preparation', () => {
  const original = eventRecord(google('abc', { summary: '?Заказ: Свадьба' }));
  original.payload.body.notes = 'Очень важные записи со звонка';
  original.payload.body.questions.push({ ...item('Имена гостей'), answer: 'Анна', done: true });
  const confirmed = reconcileCalendar([original], [google('abc', { start: { date: '2026-12-01' }, end: { date: '2026-12-02' } })]);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].payload.source.status, 'confirmed');
  assert.equal(confirmed[0].payload.source.start, '2026-12-01');
  assert.deepEqual(confirmed[0].payload.body, original.payload.body);
  assert.equal(original.payload.source.status, 'tentative', 'must not mutate caller records');
  const deleted = reconcileCalendar(confirmed, []);
  assert.equal(deleted[0].payload.source.status, 'deleted');
  assert.deepEqual(deleted[0].payload.body, original.payload.body);
  const restored = reconcileCalendar(deleted, [google()]);
  assert.equal(restored[0].payload.source.status, 'confirmed');
  assert.deepEqual(restored[0].payload.body, original.payload.body);
});

test('complete calendar reconciliation excludes tasks and cancelled events without deleting templates', () => {
  const templates = defaultTemplates();
  const result = reconcileCalendar(templates, [google('a'), google('b', { summary: '?Заказ: День рождения' }), google('task', { summary: 'Написать Майе' }), google('cancelled', { status: 'cancelled' })]);
  assert.equal(result.filter(x => x.kind === 'event').length, 2);
  assert.equal(result.filter(x => x.kind === 'template').length, 3);
  assert.ok(result.filter(x => x.kind === 'event').every(x => x.dirty && x.version === 0));
});

test('unchanged calendar snapshot does not mark saved event dirty', () => {
  const record = eventRecord();
  const result = reconcileCalendar([record], [google()]);
  assert.equal(result[0].dirty, false);
});

test('template adds independent fresh items and never overwrites existing answers', () => {
  const body = emptyBody();
  body.notes = 'Заметки'; body.questions.push({ ...item('Старый вопрос'), answer: 'Готовый ответ', done: true });
  const template = { id: 'template:wedding', category: 'wedding', questions: [item('Новый вопрос')], tasks: [item('Проверить звук')] };
  const first = applyTemplate(body, template), second = applyTemplate(body, template);
  assert.equal(first.questions[0].answer, 'Готовый ответ');
  assert.equal(first.notes, 'Заметки');
  assert.equal(first.questions[1].done, false);
  assert.notEqual(first.questions[1].id, second.questions[1].id);
  first.questions[0].answer = 'Изменён'; first.tasks[0].label = 'Другое';
  assert.equal(body.questions[0].answer, 'Готовый ответ');
  assert.equal(template.tasks[0].label, 'Проверить звук');
});

test('date mapping respects Yekaterinburg and preserves all-day dates', () => {
  assert.equal(localDate('2026-11-21'), '2026-11-21');
  assert.equal(localDate('2026-11-20T22:30:00Z'), '2026-11-21');
  assert.equal(localDate('2026-11-21T01:00:00+09:00'), '2026-11-20');
});

test('script links permit Google documents only, including normal sharing query', () => {
  assert.equal(scriptLink(' https://docs.google.com/document/d/abc_123-XYZ/edit?usp=sharing '), 'https://docs.google.com/document/d/abc_123-XYZ/edit?usp=sharing');
  assert.equal(scriptLink(''), '');
  for (const url of ['javascript:alert(1)', 'http://docs.google.com/document/d/abc', 'https://docs.google.com.evil.test/document/d/abc', 'https://evil.test/document/d/abc', 'https://user:pass@docs.google.com/document/d/abc', 'https://docs.google.com:444/document/d/abc', 'https://docs.google.com/document/d/', 'https://docs.google.com/document/d/abc.test']) assert.equal(scriptLink(url), null, url);
});

test('progress combines discussion and preparation, including empty checklists', () => {
  const body = emptyBody();
  assert.deepEqual(progress(body), { done: 0, total: 0, percent: 0 });
  body.questions.push({ ...item('Вопрос'), done: true }); body.tasks.push(item('Задача'));
  assert.deepEqual(progress(body), { done: 1, total: 2, percent: 50 });
});

test('backup validation accepts supported data and rejects other owners, calendar and malformed records', () => {
  const r = eventRecord(); const data = backup([r, ...defaultTemplates()]);
  assert.equal(validateBackup(data, 'calendar', 'owner@example.com').length, 4);
  assert.throws(() => validateBackup(data, 'other', 'owner@example.com'), /другому/);
  assert.throws(() => validateBackup(data, 'calendar', 'other@example.com'), /другому/);
  assert.throws(() => validateBackup({ ...data, version: 999 }, 'calendar', 'owner@example.com'), /версии/);
  assert.throws(() => validateBackup(backup([r, r]), 'calendar', 'owner@example.com'), /повторяющиеся/);
  assert.throws(() => validateBackup(backup([{ ...r, id: 'event:wrong-id' }]), 'calendar', 'owner@example.com'), /Идентификатор/);
  const corrupt = structuredClone(r); corrupt.payload.body.questions = [{ label: 'Broken' }];
  assert.throws(() => validateBackup(backup([corrupt]), 'calendar', 'owner@example.com'), /повреждённые/);
  const malicious = structuredClone(r); malicious.payload.body.scriptUrl = 'javascript:alert(1)';
  assert.equal(validatePayload('event', malicious.payload), true, 'URL text is saved even when it cannot be opened');
  assert.equal(scriptLink(malicious.payload.body.scriptUrl), null);
});

test('backup round trip preserves incomplete script URL drafts without making them navigable', () => {
  for (const draft of ['https://docs.goo', 'ссылка ещё не готова', 'javascript:alert(1)', ' https://docs.google.com/document/d/ ']) {
    const record = eventRecord(); record.payload.body.scriptUrl = draft;
    const restored = validateBackup(JSON.parse(JSON.stringify(backup([record]))), 'calendar', 'owner@example.com');
    assert.equal(restored[0].payload.body.scriptUrl, draft);
    assert.equal(scriptLink(restored[0].payload.body.scriptUrl), null);
  }
});

test('backup rejects invalid calendar dates, malformed end times and optional field types', () => {
  for (const field of ['start', 'end']) {
    for (const date of ['not-a-date', '', null, 42, '2026-02-29', '2026-04-31', '2026-13-01', '2026-11-00', '2026-11-21T25:00:00+05:00', '2026-11-21T17:00:00', '2026-02-29T17:00:00+05:00']) {
      const record = eventRecord(); record.payload.source[field] = date;
      assert.equal(validatePayload('event', record.payload), false, `${field}: ${date}`);
      assert.throws(() => validateBackup(backup([record]), 'calendar', 'owner@example.com'), /повреждённые/);
    }
  }
  for (const field of ['location', 'htmlLink', 'updated', 'calendarDescription']) {
    const record = eventRecord(); record.payload.source[field] = { unexpected: true };
    assert.equal(validatePayload('event', record.payload), false, field);
  }
  const allDay = eventRecord(); allDay.payload.source.allDay = 'yes';
  assert.equal(validatePayload('event', allDay.payload), false);
});

test('calendar date validation accepts real leap days, RFC3339 and omitted optional metadata', () => {
  for (const start of ['2028-02-29', '2000-02-29', '2026-11-21T17:00:00+05:00', '2026-11-21T12:00:00Z', '2026-11-21T12:00:00.123456Z']) {
    const record = eventRecord(); record.payload.source = { googleId: 'abc', title: 'Заказ: Тест', start, status: 'confirmed' };
    assert.equal(validatePayload('event', record.payload), true, start);
  }
});

test('restore preview separates additions and changes, ignoring unchanged records', () => {
  const old = eventRecord(), changed = structuredClone(old); changed.payload.body.notes = 'Новая запись';
  const added = eventRecord(google('new'));
  const preview = restorePlan([old, ...defaultTemplates()], [changed, added, ...defaultTemplates()]);
  assert.deepEqual(preview.added.map(x => x.id), ['event:new']);
  assert.deepEqual(preview.changed.map(x => x.id), ['event:abc']);
});

test('demo data is synthetic, structurally valid and includes three empty starter templates', () => {
  const records = demoRecords();
  assert.equal(records.filter(x => x.kind === 'event').length, 3);
  assert.ok(records.every(x => validatePayload(x.kind, x.payload)));
  assert.ok(records.filter(x => x.kind === 'event').every(x => x.id.startsWith('event:demo-')));
  assert.ok(records.filter(x => x.kind === 'template').every(x => !x.payload.questions.length && !x.payload.tasks.length));
});
