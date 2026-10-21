import test from 'node:test';
import assert from 'node:assert/strict';
import { recordChanges, describeDevice, MAX_HISTORY_RECORDS } from '../lib/change-history.js';

const device = { id: 'desktop', label: 'Мой компьютер' };
const time = '2026-10-21T10:00:00Z';
const event = () => ({ source: { title: 'Свадьба', start: '2026-11-21', status: 'confirmed' }, body: { description: '', notes: '', category: 'wedding', questionnaires: '', scriptUrl: '', questions: [], tasks: [] } });
const task = (id, label, done = false) => ({ id, label, done, answer: '', comment: '' });
const save = (before, after, options = {}) => recordChanges(before, after, device, { now: time, ...options });
test('clearing and restoring a task list are separate visible actions, not typing', () => {
  const before = event(); before.body.tasks = [task('a','Музыка')];
  const empty = structuredClone(before); empty.body.tasks = [];
  const cleared = save(before,empty);
  const restored = structuredClone(cleared); restored.body.tasks = structuredClone(before.body.tasks);
  const result = recordChanges(cleared,restored,device,{now:'2026-10-21T10:00:10Z'});
  assert.equal(result._history.length,2);
});

test('journal records changed text and device without mutating either input', () => {
  const before = event(), after = structuredClone(before); after.body.notes = 'Позвонить паре';
  const recorded = save(before, after);
  assert.equal(before.body.notes, ''); assert.equal(after._history, undefined);
  assert.equal(recorded._history[0].deviceLabel, 'Мой компьютер');
  assert.equal(recorded._history[0].changes[0].label, 'Быстрые заметки');
  assert.equal(recorded._history[0].changes[0].after, 'Позвонить паре');
  assert.match(recorded._history[0].id, /^[a-f0-9-]{36}$/);
});
test('typing on one device coalesces and a full revert removes the pending journal entry', () => {
  const baseline = event(), one = structuredClone(baseline); one.body.notes = 'A';
  const first = save(baseline, one), two = structuredClone(first); two.body.notes = 'AB';
  const second = save(first, two, { now: '2026-10-21T10:00:05Z' });
  assert.equal(second._history.length, 1); assert.equal(second._history[0].changes[0].before, ''); assert.equal(second._history[0].changes[0].after, 'AB');
  const reverted = structuredClone(second); reverted.body.notes = '';
  assert.equal(save(second, reverted, { now: '2026-10-21T10:00:09Z' })._history.length, 0);
});
test('different devices, fields or typing sessions retain independent entries', () => {
  const initial = event(), one = structuredClone(initial); one.body.notes = 'A';
  const first = save(initial, one), two = structuredClone(first); two.body.notes = 'AB';
  const otherDevice = recordChanges(first, two, { id: 'phone', label: 'Телефон' }, { now: '2026-10-21T10:00:05Z' });
  assert.equal(otherDevice._history.length, 2);
  assert.equal(save(first, two, { now: '2026-10-21T10:01:01Z' })._history.length, 2);
  two.body.questionnaires = 'Ответы';
  assert.equal(save(first, two, { now: '2026-10-21T10:00:05Z' })._history.length, 2);
});
test('format-only changes are visible but text changes do not create duplicate formatting entries', () => {
  const before = event(); before.body.notes = 'Note'; before.body.notesHtml = 'Note';
  const after = structuredClone(before); after.body.notesHtml = '<b>Note</b>';
  const changed = save(before, after);
  assert.equal(changed._history[0].changes[0].field, 'notesHtml');
  assert.equal(changed._history[0].changes[0].after, 'Оформление изменено');
  after.body.notes = 'Updated'; after.body.notesHtml = '<b>Updated</b>';
  assert.deepEqual(save(before, after)._history[0].changes.map(x => x.field), ['notes']);
});
test('task additions, deletions, answers and completion show affected item names', () => {
  const before = event(); before.body.tasks = [task('a', 'Музыка'), task('b', 'Микрофон')];
  const after = structuredClone(before); after.body.tasks = [task('a', 'Музыка', true), task('c', 'Торт')];
  const result = save(before, after)._history[0].changes[0];
  assert.match(result.before, /Микрофон/); assert.match(result.after, /Торт/); assert.match(result.after, /выполнено/);
  const qBefore = event(); qBefore.body.questions = [task('q', 'Клятвы?')];
  const qAfter = structuredClone(qBefore); qAfter.body.questions[0].answer = 'Свои';
  assert.match(save(qBefore, qAfter)._history[0].changes[0].after, /ответ: Свои/);
});
test('long summaries remain bounded and distinct middle edits can still coalesce and revert', () => {
  const before = event(); before.body.notes = 'A'.repeat(1000);
  const after = structuredClone(before); after.body.notes = 'A'.repeat(500) + 'B' + 'A'.repeat(499);
  const first = save(before, after);
  assert.equal(first._history.length, 1);
  for (const entry of first._history[0].changes) { assert.ok(entry.before.length <= 300); assert.ok(entry.after.length <= 300); }
  const reversed = structuredClone(first); reversed.body.notes = before.body.notes;
  assert.equal(save(first, reversed, { now: '2026-10-21T10:00:05Z' })._history.length, 0);
});
test('retention caps history and clearing it does not resurrect old entries', () => {
  let current = event();
  for (let i = 0; i < 110; i++) {
    const next = structuredClone(current); next.body.notes = String(i);
    current = save(current, next, { now: new Date(Date.parse(time) + i * 61000) });
  }
  assert.equal(current._history.length, MAX_HISTORY_RECORDS);
  const cleared = structuredClone(current); delete cleared._history;
  assert.equal(save(current, cleared)._history, undefined);
  const next = structuredClone(cleared); next.body.notes = 'После очистки';
  assert.equal(save(cleared, next)._history.length, 1);
});
test('creation, template changes and meaningful calendar changes have journal labels', () => {
  const template = { name: 'Мой шаблон', category: 'other', tasks: [], questions: [] };
  assert.equal(save(null, template)._history[0].changes[0].label, 'Создана запись');
  const renamed = { ...template, name: 'Новый шаблон' };
  assert.equal(save(template, renamed)._history[0].changes[0].label, 'Название шаблона');
  const before = event(), after = structuredClone(before); after.source.start = '2026-11-22'; after.source.updated = '2026-10-21';
  assert.deepEqual(save(before, after)._history[0].changes.map(x => x.field), ['source.start']);
  const unchanged = structuredClone(before); unchanged.source.updated = '2026-10-21'; unchanged.body.tasksRecovery = [task('a', 'Task')];
  assert.equal(save(before, unchanged)._history, undefined);
});
test('device description labels familiar platforms and browsers without a fingerprint', () => {
  assert.equal(describeDevice('Mozilla Windows NT 10.0 Chrome/130 Edg/130'), 'Windows · Edge');
  assert.equal(describeDevice('Mozilla Android Chrome/130'), 'Android · Chrome');
  assert.equal(describeDevice('Mozilla iPhone Mac OS X Version/18 Safari/605'), 'iPhone / iPad · Safari');
  assert.equal(describeDevice('Mozilla Macintosh Firefox/130'), 'macOS · Firefox');
  assert.equal(describeDevice(''), 'Устройство · Браузер');
});
