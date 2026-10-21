# Подключение рабочего кабинета

Код подготовлен для GitHub Pages и проекта Supabase `rodaruodfbokhhtefktt`. Ниже — настройки, которые нужно выполнить в своих аккаунтах. Создание файлов на компьютере не означает, что база, OAuth и серверная функция уже настроены.

## 1. Таблицы и доступ в Supabase

1. Открой [SQL Editor](https://supabase.com/dashboard/project/rodaruodfbokhhtefktt/sql/new).
2. Скопируй целиком `supabase/migrations/202610210001_workspace.sql` и выполни.
3. В списке разрешённых владельцев указан `vampir3452@gmail.com`. Если рабочий аккаунт другой, измени его и в SQL, и в `config.js` до первого входа.

SQL создаёт таблицу карточек и шаблонов с Row Level Security, проверку владельца и атомарную запись с номером версии. Серверная таблица Google-токенов закрыта для браузерных ролей. Публичный ключ в `config.js` не является паролем; приватный ключ/service_role туда добавлять нельзя.

## 2. Google Cloud и разрешение читать календарь

1. Создай или выбери проект в [Google Cloud Console](https://console.cloud.google.com/).
2. В библиотеке API включи **Google Calendar API**.
3. В **Google Auth Platform → Branding / Audience / Data Access** настрой приложение. Для тестирования добавь `vampir3452@gmail.com` в Test users.
4. Добавь scopes `openid`, `email`, `profile` и `https://www.googleapis.com/auth/calendar.events.readonly`. Сайт читает выбранный календарь; изменений в нём не делает.
5. Создай OAuth Client типа **Web application**.
6. В Authorized JavaScript origins добавь `http://localhost:4180` и позднее origin GitHub Pages, например `https://USERNAME.github.io` — без пути репозитория.
7. В Authorized redirect URIs добавь **ровно**:

```text
https://rodaruodfbokhhtefktt.supabase.co/auth/v1/callback
```

Сохрани Client ID и Client Secret в менеджере паролей. Client Secret размещается только в серверных настройках Supabase. [Настройка Google в Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

В режиме Google **Testing** разрешение с Calendar scope обычно выдаёт refresh token на семь дней: затем потребуется переподключение. Для длительного использования настрой статус приложения согласно требованиям Google; переход в Production не гарантирует отсутствие экрана предупреждения или требований проверки. [Сроки и отзыв OAuth-токенов Google](https://developers.google.com/identity/protocols/oauth2/).

## 3. Google-вход в Supabase

1. В **Authentication → Sign In / Providers → Google** включи Google и укажи тот же Client ID и Client Secret.
2. В **Authentication → URL Configuration** добавь `http://localhost:4180/` в Redirect URLs.
3. После публикации добавь полный URL сайта, например `https://USERNAME.github.io/host-workspace/`, и сделай его Site URL.

Путь репозитория и завершающий слэш должны совпадать с адресом сайта. Не добавляй разрешение на произвольные домены. Первый вход выполняется при наличии сети в том же браузере, где был начат. [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## 4. Серверная функция календаря

В Supabase **Edge Functions → Secrets** создай:

| Имя | Значение |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID из шага 2 |
| `GOOGLE_CLIENT_SECRET` | Client Secret того же OAuth-клиента |
| `ALLOWED_ORIGINS` | `http://localhost:4180,https://USERNAME.github.io` — origin без пути и завершающего слэша |

Встроенные переменные Supabase берутся из окружения функции; не копируй их в браузерный код и не присылай в чат. [Секреты Edge Functions](https://supabase.com/docs/guides/functions/secrets).

Создай функцию с именем **`google-calendar`** через **Deploy a new function → Via Editor**, замени её код содержимым `supabase/functions/google-calendar/index.ts` и опубликуй. В настройках функции отключи **Verify JWT** на уровне gateway: функция самостоятельно проверяет bearer через Supabase Auth и проверку владельца перед любым доступом к данным. Отсутствие этой проверки в коде недопустимо. [Редактор функций в Dashboard](https://supabase.com/docs/guides/functions/quickstart-dashboard).

При использовании установленного Supabase CLI из папки проекта:

```powershell
supabase login
supabase link --project-ref rodaruodfbokhhtefktt
supabase functions deploy google-calendar
```

`supabase/config.toml` уже содержит настройку gateway. Секреты вводи в Dashboard, не в аргументах команд и не в публичном репозитории.

Функция привязана к календарю «🎤 Ведущий/Хобби», идентификатор которого указан в `config.js`. При замене календаря измени ID также в функции и повторно разверни её. Google refresh token передаётся серверу после входа; дальнейшее обновление доступа выполняется сервером.

## 5. Проверка локально

1. Запусти `node scripts/serve.mjs` и открой `http://localhost:4180/`.
2. Войди нужным Google-аккаунтом и разреши чтение календаря.
3. Нажми обновление. Проверь появление `Заказ:` и `?Заказ:`; другие записи появляться не должны.
4. Открой карточку, введи заметку, дождись облачного сохранения и проверь запись на другом устройстве после публикации.

Если функция сообщает об истёкшем доступе, используй переподключение Google. Если проект Supabase приостановлен, восстанови его в Dashboard.

## 6. GitHub Pages

Создай отдельный репозиторий и помести **содержимое этой папки** в его корень. Это сохраняет существующий сайт-визитку. Не загружай папку всего рабочего пространства и не включай секреты.

В репозитории открой **Settings → Pages → Source → GitHub Actions**. Workflow `.github/workflows/pages.yml` запускает тесты, собирает публичные файлы в `dist/` и публикует артефакт. Для него используется ветка `main`; при другом имени измени фильтр workflow.

После первого успешного запуска скопируй фактический URL Pages в Site URL / Redirect URLs Supabase и origin в `ALLOWED_ORIGINS`. Не заменяй адрес на пример из инструкции. [GitHub Pages с Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 7. Проверка перед настоящим мероприятием

- На компьютере и телефоне заранее загрузи карточку. Проверь открытие и изменение заметок без связи, затем синхронизацию после подключения.
- Сценарий отдельно сделай доступным без интернета в Google Документах. [Офлайн Google Docs](https://support.google.com/docs/answer/6388102?hl=ru).
- Измени одну карточку на двух устройствах без синхронизации и проверь сохранение обеих конфликтующих версий.
- Проверь перенос даты, подтверждение `?Заказ:` → `Заказ:` и сохранение карточки после удаления календарного события.
- Скачай резервную копию и проверь предварительный просмотр восстановления на демонстрационных данных до применения к рабочим.

Живые Google OAuth, RLS и серверную функцию нужно проверить после настройки аккаунтов. Локальные тесты не подменяют эту проверку.
