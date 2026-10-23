import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBody, calendarSource, reconcileCalendar, validatePayload } from '../lib/model.js';

const calendarEvent = {
  id: 'venue-test', summary: 'Заказ: Свадьба',
  start: { date: '2026-11-21' }, end: { date: '2026-11-22' }
};

test('calendar changes preserve manual venue, prepayment and existing preparation', () => {
  const payload = {
    source: calendarSource(calendarEvent),
    body: { ...emptyBody(), venue: 'Венеция', totalCost: '5000', prepayment: '1000', notes: 'Сохранённые заметки' }
  };
  const records = reconcileCalendar([{ id: 'event:venue-test', kind: 'event', payload }], [{ ...calendarEvent, location: 'Другая площадка' }]);
  assert.deepEqual(records[0].payload.body, payload.body);
  assert.equal(records[0].payload.source.location, 'Другая площадка');
  assert.equal(validatePayload('event', JSON.parse(JSON.stringify(records[0].payload))), true);
});

test('legacy cards without manual venue and prepayment remain valid; malformed fields are rejected', () => {
  const payload = { source: calendarSource(calendarEvent), body: emptyBody() };
  delete payload.body.venue;
  delete payload.body.prepayment;
  assert.equal(validatePayload('event', payload), true);
  for (const field of ['venue', 'prepayment']) {
    assert.equal(validatePayload('event', { ...payload, body: { ...payload.body, [field]: {} } }), false);
  }
});
