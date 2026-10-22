import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = 'https://vampir3452.github.io';
const token = randomBytes(32).toString('hex');
const port = Number(process.env.ZK_CODEX_PORT || 43187);
const active = new Set();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && origin !== allowed && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return reply(res, 403, { error: 'Origin запрещён' });
  res.setHeader('Access-Control-Allow-Origin', origin || 'null');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ready: true, codex: 'local' });
  if (!authorized(req)) return reply(res, 401, { error: 'Введи ключ моста из окна запуска.' });
  if (req.method !== 'POST' || req.url !== '/chat') return reply(res, 404, { error: 'Не найдено' });
  if (active.size) return reply(res, 429, { error: 'Codex уже выполняет запрос. Дождись ответа.' });
  let body;
  try { body = await readJson(req); } catch { return reply(res, 400, { error: 'Некорректный запрос' }); }
  const message = String(body.message || '').trim().slice(0, 6000);
  if (!message) return reply(res, 400, { error: 'Напиши сообщение.' });
  const context = JSON.stringify(body.event || {}).slice(0, 18000);
  const prompt = `Ты помощник личного кабинета ведущего. Отвечай по-русски. Если дано мероприятие, используй только его контекст и не выдумывай факты. Ты работаешь через локальный Codex CLI на компьютере владельца сайта. Запрос пользователя может быть вопросом или задачей по проекту. Для вопросов о мероприятии ответь по данным ниже. Для задач по сайту изучи файлы проекта, внеси нужные изменения в код и сообщи, что изменил; публикацию сайта выполняет пользователь отдельно. Не запускай внешние публикации и не проси секреты.\n\nДАННЫЕ ВЫБРАННОГО МЕРОПРИЯТИЯ:\n${context}\n\nСООБЩЕНИЕ:\n${message}`;
  active.add('chat');
  const child = spawn('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', root, '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk.toString(); if (out.length > 1000000) child.kill(); });
  child.stderr.on('data', chunk => { err += chunk.toString(); if (err.length > 12000) err = err.slice(-12000); });
  child.on('error', error => { active.delete('chat'); reply(res, 500, { error: `Не удалось запустить Codex: ${error.message}` }); });
  child.on('close', code => {
    active.delete('chat');
    if (res.writableEnded) return;
    if (code !== 0) return reply(res, 500, { error: err.trim() || `Codex завершился с кодом ${code}.` });
    const messages = out.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
    const answer = messages.filter(item => item?.type === 'item.completed' && item.item?.type === 'agent_message').map(item => item.item.text).join('\n').trim();
    reply(res, 200, { answer: answer || 'Codex завершил запрос. Открой проект в Codex, чтобы посмотреть детали.' });
  });
  child.stdin.end(prompt);
});

function authorized(req) {
  const value = req.headers.authorization || '';
  const supplied = Buffer.from(value.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function readJson(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 30000) reject(new Error('too large')); }); req.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function reply(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(status === 204 ? '' : JSON.stringify(data)); }
server.listen(port, '127.0.0.1', () => { console.log(`Локальный мост Codex запущен: http://127.0.0.1:${port}`); console.log(`Ключ для подключения сайта: ${token}`); console.log('Не отправляй этот ключ другим людям. Остановить мост: Ctrl+C.'); });
