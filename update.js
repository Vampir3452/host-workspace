const button = document.querySelector('#update-site');
const status = document.querySelector('#update-status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Загружаем актуальный интерфейс…';
  try {
    if (!navigator.onLine) throw new Error('Для загрузки обновления нужен интернет.');
    if (!('serviceWorker' in navigator)) { location.replace('./'); return; }
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
