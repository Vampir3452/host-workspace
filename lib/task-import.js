import * as XLSX from '../vendor/xlsx-0.20.3.mjs';

export const MAX_TASK_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORTED_TASKS = 500;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_SHEET_ROWS = 10000;

function checkArchiveSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint32(0, true) !== 0x04034b50) return;
  // Inspect the ZIP directory before the spreadsheet parser expands compressed XML.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('Файл Excel повреждён. Сохрани его заново в формате .xlsx.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true), total = 0;
  if (count > 2000) throw new Error('В книге слишком много внутренних файлов. Используй простой шаблон задач.');
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('Файл Excel повреждён.');
    total += view.getUint32(at + 24, true);
    if (total > MAX_EXPANDED_BYTES) throw new Error('Книга Excel слишком сложная. Скопируй задачи в пустой шаблон.');
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
}

export function normalizeTaskRows(rows, group = 'tasks') {
  const labels = rows.map(value => String(value ?? '').trim()).filter(Boolean);
  if ((group === 'questions' ? /^(вопрос|вопросы|question|questions)$/iu : /^(задача|задачи|task|tasks)$/iu).test(labels[0] || '')) labels.shift();
  if (!labels.length) throw new Error(group === 'questions' ? 'Вопросы не найдены. Заполни первый столбец.' : 'Задачи не найдены. Заполни первый столбец: одна задача в каждой строке.');
  if (labels.length > MAX_IMPORTED_TASKS) throw new Error(group === 'questions' ? 'За один раз можно добавить не больше 500 вопросов.' : 'За один раз можно добавить не больше 500 задач.');
  if (labels.some(label => label.length > 5000)) throw new Error('Одна из задач длиннее 5000 символов. Раздели её на несколько пунктов.');
  return labels;
}

export async function parseTaskFile(file, group = 'tasks') {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv', 'txt'].includes(extension)) throw new Error('Выбери файл .xlsx, .xls, .csv или .txt.');
  if (!file.size) throw new Error('Файл пустой.');
  if (file.size > MAX_TASK_FILE_BYTES) throw new Error('Файл слишком большой: максимум 2 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_TASK_FILE_BYTES) throw new Error('Файл слишком большой: максимум 2 МБ.');
  if (extension === 'txt') return normalizeTaskRows(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').split(/\r?\n/), group);
  if (extension === 'xlsx' && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new Error('Это не книга .xlsx. Сохрани таблицу в Excel и выбери полученный файл.');
  checkArchiveSize(bytes);
  let workbook;
  try {
    workbook = extension === 'csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string', raw: true, sheetRows: MAX_SHEET_ROWS + 1, cellFormula: false })
      : XLSX.read(bytes, { type: 'array', raw: true, sheetRows: MAX_SHEET_ROWS + 1, cellFormula: false });
  } catch { throw new Error('Не удалось прочитать таблицу. Сохрани её заново в формате .xlsx или CSV UTF-8.'); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) return normalizeTaskRows([], group);
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (range.e.r >= MAX_SHEET_ROWS) throw new Error('В первом листе слишком много строк. Скопируй задачи в пустой шаблон.');
  const rows = [];
  for (let row = 0; row <= range.e.r; row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    rows.push(cell?.v == null ? '' : XLSX.utils.format_cell(cell));
  }
  return normalizeTaskRows(rows, group);
}

export function createTaskWorkbook(group = 'tasks') {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[group === 'questions' ? 'Вопрос' : 'Задача']]);
  sheet['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(book, sheet, group === 'questions' ? 'Вопросы' : 'Задачи');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true });
}

export function downloadTaskWorkbook(group = 'tasks') {
  const blob = new Blob([createTaskWorkbook(group)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = group === 'questions' ? 'shablon-voprosov.xlsx' : 'shablon-zadach.xlsx'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
