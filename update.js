const button = document.querySelector('#update-site');
const status = document.querySelector('#update-status');
const clearCache = new URLSearchParams(location.search).get('clear') === '1';
if (clearCache) button.textContent = 'Очистить кэш и открыть кабинет';
button.addEventListener('click', async () => {
  button.disabled = true;
    status.textContent = clearCache ? 'Обновляем файлы сайта…' : 'Загружаем актуальный интерфейс…';
  try {
    if (!navigator.onLine) throw new Error('Для загрузки обновления нужен интернет.');
    if (!('serviceWorker' in navigator)) { location.replace('./'); return; }
    if (clearCache) {
      const scope = new URL('./', location.href);
      const previous = await navigator.serviceWorker.getRegistration(scope.href);
      if (previous?.scope === scope.href) await previous.unregister();
      const prefix = `zk-shell:${scope.pathname}:`;
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => caches.delete(key)));
    }
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    await registration.update();
    const installing = registration.installing;
    if (installing && installing.state !== 'installed') await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Загрузка заняла больше минуты. Проверь интернет и повтори.')), 60000);
      const changed = () => {
        if (installing.state === 'installed') { clearTimeout(timeout); resolve(); }
        if (installing.state === 'redundant') { clearTimeout(timeout); reject(new Error('Не удалось загрузить обновление. Повтори ещё раз.')); }
      };
      installing.addEventListener('statechange', changed); changed();
    });
    if (registration.waiting) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Обновление готово. Закрой другие вкладки кабинета и повтори.')), 15000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
        registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      });
    }
    location.replace('./');
  } catch (error) {
    status.textContent = error.message || 'Не удалось обновить сайт. Попробуй ещё раз.';
    button.disabled = false;
  }
});
// Reached from the explicit update button in the cabinet: finish in one click.
if (new URLSearchParams(location.search).get('apply') === '1') button.click();
