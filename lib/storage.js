const DB_NAME = 'host-workspace-v1';
let opening;
function db() {
  return opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('records', { keyPath: 'key' }); request.result.createObjectStore('meta'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Не удалось открыть хранилище браузера. Проверь настройки приватности.'));
  });
}
async function transaction(store, mode, action) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(new Error('Не удалось сохранить данные на устройстве. Скачай резервную копию и проверь свободное место.'));
  });
}
export async function readRecords(scope) {
  return (await transaction('records', 'readonly', s => s.getAll())).filter(r => r.scope === scope).map(({ key, scope, ...record }) => record);
}
export async function writeRecord(scope, record) { await transaction('records', 'readwrite', s => s.put({ ...record, key: `${scope}/${record.id}`, scope })); }
export async function writeMany(scope, records) {
  await transaction('records', 'readwrite', store => { for (const r of records) store.put({ ...r, key: `${scope}/${r.id}`, scope }); });
}
export const getMeta = key => transaction('meta', 'readonly', s => s.get(key));
export const setMeta = (key, value) => transaction('meta', 'readwrite', s => s.put(value, key));
export async function clearAuxiliaryMeta(scope) {
  const keys = await transaction('meta', 'readonly', store => store.getAllKeys());
  const obsolete = keys.filter(key => typeof key === 'string' && (key.startsWith(`${scope}:before-restore:`) || key.startsWith(`${scope}:conflict:`)));
  await transaction('meta', 'readwrite', store => { for (const key of obsolete) store.delete(key); });
  return obsolete.length;
}
export async function clearScope(scope) {
  const records = await readRecords(scope);
  await transaction('records', 'readwrite', store => { for (const r of records) store.delete(`${scope}/${r.id}`); });
  const keys = await transaction('meta', 'readonly', store => store.getAllKeys());
  await transaction('meta', 'readwrite', store => { for (const key of keys) if (typeof key === 'string' && key.startsWith(`${scope}:`)) store.delete(key); });
}
