import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskFile, createTaskWorkbook } from '../lib/task-import.js';
import * as XLSX from '../vendor/xlsx-0.20.3.mjs';

test('discussion workbook has question header and imports questions from the first column', async () => {
  const workbook = XLSX.read(createTaskWorkbook('questions'), { type: 'array' });
  assert.equal(workbook.SheetNames[0], 'Вопросы');
  const sheet = workbook.Sheets.Вопросы;
  assert.equal(sheet.A1.v, 'Вопрос');
  XLSX.utils.sheet_add_aoa(sheet, [['Где проходит свадьба?', 'Не импортировать'], ['Будет ли первый танец?']], { origin: 'A2' });
  const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'questions.xlsx');
  assert.deepEqual(await parseTaskFile(file, 'questions'), ['Где проходит свадьба?', 'Будет ли первый танец?']);
});

test('discussion text import skips its own header while task imports retain a task named Вопрос', async () => {
  assert.deepEqual(await parseTaskFile(new File(['Вопрос\nМузыка?\n\nТорт?'], 'questions.txt'), 'questions'), ['Музыка?', 'Торт?']);
  assert.deepEqual(await parseTaskFile(new File(['Вопрос\nПодготовить'], 'tasks.txt')), ['Вопрос', 'Подготовить']);
});
