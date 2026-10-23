import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWeddingTemplate, validatePayload } from '../lib/model.js';

test('deleted legacy default templates remain deleted during migrations and backup validation', () => {
  const record = {
    id: 'template:wedding', kind: 'template',
    payload: { name: 'Свадьба', category: 'wedding', questions: [], tasks: [], deletedAt: '2026-10-23T12:00:00Z' }
  };
  assert.equal(seedWeddingTemplate(record), null);
  assert.equal(validatePayload('template', JSON.parse(JSON.stringify(record.payload))), true);
  assert.equal(validatePayload('template', { ...record.payload, deletedAt: true }), false);
  assert.equal(validatePayload('template', { ...record.payload, deletedAt: 'не дата' }), false);
  const restored = structuredClone(record);
  delete restored.payload.deletedAt;
  assert.ok(seedWeddingTemplate(restored));
});
