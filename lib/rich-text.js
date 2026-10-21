const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sizes = new Set(['rt-size-small', 'rt-size-normal', 'rt-size-large', 'rt-size-xlarge']);
const tags = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'ul', 'ol', 'li']);
const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'title', 'xmp', 'plaintext']);
const entity = /&(?:amp|lt|gt|quot|apos|nbsp|#[0-9]{1,7}|#x[0-9a-f]{1,6});/gi;
function escapeText(text) {
  // Preserve valid entities already present in saved HTML, and escape all raw markup.
  const parts = String(text).split(/(&(?:amp|lt|gt|quot|apos|nbsp|#[0-9]{1,7}|#x[0-9a-f]{1,6});)/gi);
  return parts.map(part => /^&(?:amp|lt|gt|quot|apos|nbsp|#[0-9]{1,7}|#x[0-9a-f]{1,6});$/i.test(part) ? part : escape(part)).join('');
}
function attribute(token, name) {
  const match = token.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : '';
}
/** Rebuild markup from a narrow grammar; input attributes are never copied to output. */
export function sanitizeRichHtml(value) {
  const tokens = String(value ?? '').match(/<[^>]*>|[^<]+|</g) || [];
  const stack = [], hidden = [];
  let output = '';
  for (const token of tokens) {
    const match = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(token);
    if (!match) { if (!hidden.length && !token.startsWith('<!') && !token.startsWith('<?')) output += escapeText(token); continue; }
    const closing = Boolean(match[1]), source = match[2].toLowerCase();
    if (hidden.length) {
      if (closing && source === hidden[hidden.length - 1]) hidden.pop();
      else if (!closing && blocked.has(source) && !['embed'].includes(source)) hidden.push(source);
      continue;
    }
    if (blocked.has(source)) { if (!closing && source !== 'embed') hidden.push(source); continue; }
    let tag = source, size = '';
    if (source === 'font') { tag = 'span'; size = ({ 1: 'rt-size-small', 2: 'rt-size-small', 3: 'rt-size-normal', 4: 'rt-size-large', 5: 'rt-size-large', 6: 'rt-size-xlarge', 7: 'rt-size-xlarge' })[attribute(token, 'size')] || ''; }
    else if (/^h[1-6]$/.test(source)) { tag = 'p'; size = ['h1', 'h2'].includes(source) ? 'rt-size-xlarge' : 'rt-size-large'; }
    if (!tags.has(tag)) continue;
    if (closing) {
      const index = stack.map(x => x.source).lastIndexOf(source);
      if (index >= 0) while (stack.length > index) output += `</${stack.pop().tag}>`;
      continue;
    }
    if (!size && ['span', 'p', 'div'].includes(tag)) size = attribute(token, 'class').split(/\s+/).find(x => sizes.has(x)) || '';
    output += `<${tag}${size ? ` class="${size}"` : ''}>`;
    if (tag !== 'br') stack.push({ tag, source });
  }
  while (stack.length) output += `</${stack.pop().tag}>`;
  return output;
}
export function richPlainText(html) {
  let safe = '';
  for (const token of sanitizeRichHtml(html).match(/<[^>]*>|[^<]+/g) || []) {
    if (token === '<br>') safe += '\n';
    else if (/^<\/?(?:p|div|li)(?:\s[^>]*)?>$/.test(token)) {
      if (safe && !safe.endsWith('\n')) safe += '\n';
    } else if (!token.startsWith('<')) safe += token;
  }
  const decoded = safe.replace(entity, value => {
    const names = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (names[value.toLowerCase()] !== undefined) return names[value.toLowerCase()];
    const digits = value.slice(2, -1), number = digits[0]?.toLowerCase() === 'x' ? parseInt(digits.slice(1), 16) : Number(digits);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '\uFFFD';
  });
  return decoded.replace(/\n$/, '');
}
export function renderRichEditor(field, label, plain = '', html, { className = '' } = {}) {
  const id = `rich-${field}`;
  const content = typeof html === 'string' && richPlainText(html) === plain ? sanitizeRichHtml(html) : escape(plain).replace(/\r?\n/g, '<br>');
  return `<div class="rich-field ${escape(className)}"><label id="${id}-label" class="field-label" for="${id}">${escape(label)}</label><div class="rich-toolbar" role="group" aria-label="Форматирование: ${escape(label)}"><button type="button" data-rich-command="bold" aria-label="Жирный текст" title="Жирный (Ctrl+B)"><strong>Ж</strong></button><button type="button" data-rich-command="underline" aria-label="Подчеркнуть текст" title="Подчеркнуть (Ctrl+U)"><u>Ч</u></button><button type="button" data-rich-command="fontSize" data-rich-size="3" aria-label="Обычный размер текста">А</button><button type="button" data-rich-command="fontSize" data-rich-size="5" aria-label="Крупный размер текста">А+</button><button type="button" data-rich-command="fontSize" data-rich-size="7" aria-label="Очень крупный размер текста">А++</button></div><div id="${id}" class="rich-editor" data-rich-field="${escape(field)}" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="${id}-label" spellcheck="true">${content}</div><p class="form-help">Выдели текст или строку и выбери оформление. Ctrl+B — жирный, Ctrl+U — подчёркивание.</p></div>`;
}
let wired = false;
export function wireRichEditors(onChange) {
  if (wired) return;
  wired = true;
  let range, activeEditor;
  const editorAt = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('[data-rich-field]');
  const save = editor => {
    const html = sanitizeRichHtml(editor.innerHTML);
    onChange({ field: editor.dataset.richField, text: richPlainText(html), html });
  };
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const current = selection.getRangeAt(0), editor = editorAt(current.commonAncestorContainer);
    if (editor) { activeEditor = editor; range = current.cloneRange(); }
  });
  document.addEventListener('mousedown', event => {
    if (event.target.closest('[data-rich-command]')) event.preventDefault();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-rich-command]');
    if (!button) return;
    const editor = button.closest('.rich-field')?.querySelector('[data-rich-field]');
    if (!editor) return;
    event.preventDefault();
    editor.focus();
    if (range && activeEditor === editor && editor.contains(range.commonAncestorContainer)) {
      const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
    document.execCommand(button.dataset.richCommand, false, button.dataset.richSize || null);
    save(editor);
  });
  document.addEventListener('input', event => { const editor = editorAt(event.target); if (editor) save(editor); });
  document.addEventListener('paste', event => {
    const editor = editorAt(event.target); if (!editor) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
    save(editor);
  });
  document.addEventListener('drop', event => { if (editorAt(event.target)) event.preventDefault(); });
  document.addEventListener('focusout', event => {
    const editor = editorAt(event.target);
    if (editor) { const html = sanitizeRichHtml(editor.innerHTML); if (editor.innerHTML !== html) editor.innerHTML = html; }
  });
}
