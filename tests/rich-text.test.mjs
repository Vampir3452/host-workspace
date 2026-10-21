import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichHtml, richPlainText, renderRichEditor } from '../lib/rich-text.js';

test('saved formatting survives repeated sanitization without arbitrary attributes', () => {
  const html = '<div onclick="alert(1)"><b>Пара</b> &amp; <u>гости</u><font size="5" color="red">Тайминг</font></div>';
  const safe = '<div><b>Пара</b> &amp; <u>гости</u><span class="rt-size-large">Тайминг</span></div>';
  assert.equal(sanitizeRichHtml(html), safe);
  assert.equal(sanitizeRichHtml(safe), safe);
  assert.equal(richPlainText(safe), 'Пара & гостиТайминг');
});
test('active markup, embedded documents and their content are discarded', () => {
  const html = '<p>Заметки<script>alert(1)</script><svg><a onload="evil()">скрыто</a></svg><iframe srcdoc="evil">скрыто</iframe><img src=x onerror=evil()><a href="javascript:evil()">текст</a></p>';
  assert.equal(sanitizeRichHtml(html), '<p>Заметкитекст</p>');
  assert.equal(sanitizeRichHtml('<script x=">">x</script><b>видно</b>'), '<b>видно</b>');
});
test('font sizes and formatting classes are strictly restricted', () => {
  assert.equal(sanitizeRichHtml('<span class="evil rt-size-xlarge" style="color:red">A</span><font size="100">B</font>'), '<span class="rt-size-xlarge">A</span><span>B</span>');
  assert.equal(sanitizeRichHtml('<h2 data-x="a">Заголовок</h2>'), '<p class="rt-size-xlarge">Заголовок</p>');
  assert.equal(sanitizeRichHtml('<p class="rt-size-xlarge">Заголовок</p>'), '<p class="rt-size-xlarge">Заголовок</p>');
});
test('plain notes migrate as text and rich plain text preserves line boundaries', () => {
  const editor = renderRichEditor('notes', 'Заметки', 'A <script>\nБ & В');
  assert.match(editor, /A &lt;script&gt;<br>Б &amp; В/);
  assert.equal(richPlainText('<p>Первая</p><div><b>Вторая</b><br>Третья</div>'), 'Первая\nВторая\nТретья');
  assert.equal(richPlainText('Первая<div>Вторая</div>'), 'Первая\nВторая');
  assert.equal(richPlainText('<div>Первая</div><div><br></div><div>Третья</div>'), 'Первая\n\nТретья');
  assert.equal(richPlainText('A &lt;img&gt; &#128512;'), 'A <img> 😀');
  assert.equal(richPlainText('&amp;lt;'), '&lt;');
});
test('editor renderer never injects raw field, label or stored HTML', () => {
  const editor = renderRichEditor('notes', 'Заметки', 'OK', '<img src=x onerror=alert(1)><u>OK</u>');
  assert.ok(!editor.includes('onerror'));
  assert.match(editor, /<u>OK<\/u>/);
  assert.match(editor, /aria-multiline="true"/);
  assert.match(editor, /data-rich-size="7"/);
});
test('plain edits from an older client take precedence over stale formatting', () => {
  const editor = renderRichEditor('notes', 'Заметки', 'New text', '<b>Old text</b>');
  assert.match(editor, /New text/); assert.ok(!editor.includes('Old text'));
});
