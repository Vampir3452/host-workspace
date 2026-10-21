import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '../vendor/xlsx-0.20.3.mjs';
import { parseTaskFile, normalizeTaskRows, createTaskWorkbook, MAX_TASK_FILE_BYTES } from '../lib/task-import.js';

const file = (name, data) => new File([data], name);
const workbookFile = (rows, extension = 'xlsx') => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Задачи');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Не импортировать второй лист']]), 'Другой лист');
  return file(`tasks.${extension}`, XLSX.write(workbook, { type: 'array', bookType: extension === 'xls' ? 'biff8' : 'xlsx', compression: true }));
};

test('XLSX import reads first column of first sheet and ignores header and empty rows', async () => {
  const source = workbookFile([['Задача', 'Комментарий'], ['  Позвонить паре  ', 'Не отдельная задача'], [], ['Подготовить музыку'], [null, 'Не импортировать второй столбец'], ['Скачать сценарий']]);
  assert.deepEqual(await parseTaskFile(source), ['Позвонить паре', 'Подготовить музыку', 'Скачать сценарий']);
});
test('old Excel and CSV UTF-8 files preserve Russian tasks and quoted commas', async () => {
  assert.deepEqual(await parseTaskFile(workbookFile([['Задача'], ['Проверить микрофоны']], 'xls')), ['Проверить микрофоны']);
  assert.deepEqual(await parseTaskFile(file('tasks.csv', '\uFEFFЗадача,Комментарий\r\n"Позвонить, уточнить",не задача\r\nПроверить звук,нет')), ['Позвонить, уточнить', 'Проверить звук']);
  assert.deepEqual(await parseTaskFile(file('tasks.csv', 'Задача;Комментарий\nПроверить звук;не задача')), ['Проверить звук']);
});
test('text import preserves one task per line and allows files without a header', async () => {
  assert.deepEqual(await parseTaskFile(file('tasks.txt', '\uFEFF\r\nПервая задача\r\n\r\nВторая задача\n')), ['Первая задача', 'Вторая задача']);
  assert.deepEqual(await parseTaskFile(workbookFile([['Первая задача'], ['Вторая задача']])), ['Первая задача', 'Вторая задача']);
});
test('downloaded template is a valid XLSX with task column ready to fill', async () => {
  const bytes = createTaskWorkbook();
  const workbook = XLSX.read(bytes, { type: 'array' });
  assert.equal(workbook.SheetNames[0], 'Задачи');
  assert.equal(workbook.Sheets.Задачи.A1.v, 'Задача');
  await assert.rejects(parseTaskFile(file('template.xlsx', bytes)), /Задачи не найдены/);
});
test('rejects empty, wrong-format, oversized and too-long task lists without partial results', async () => {
  await assert.rejects(parseTaskFile(file('empty.xlsx', '')), /Файл пустой/);
  await assert.rejects(parseTaskFile(file('image.png', 'image')), /Выбери файл/);
  await assert.rejects(parseTaskFile(file('fake.xlsx', 'not a spreadsheet')), /Это не книга/);
  await assert.rejects(parseTaskFile(file('huge.txt', new Uint8Array(MAX_TASK_FILE_BYTES + 1))), /максимум 2 МБ/);
  assert.throws(() => normalizeTaskRows(Array(501).fill('Задача номер')), /500 задач/);
  assert.throws(() => normalizeTaskRows(['a'.repeat(5001)]), /5000 символов/);
  await assert.rejects(parseTaskFile(workbookFile([['Задача'], ...Array.from({ length: 501 }, (_, i) => [`Task ${i}`])])), /500 задач/);
});
test('rejects dangerous ZIP expansion before parsing workbook XML', async () => {
  const bytes = new Uint8Array(createTaskWorkbook());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let directory = -1;
  for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) { directory = i; break; }
  assert.ok(directory >= 0);
  view.setUint32(directory + 24, 20 * 1024 * 1024, true);
  await assert.rejects(parseTaskFile(file('expanded.xlsx', bytes)), /слишком сложная/);
});
