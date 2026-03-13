# 📚 Homework Bot — Інструкція з налаштування

## Структура проекту

```
homework-bot/
├── bot.js           ← головний файл бота
├── package.json
├── .env             ← твої секретні ключі (створи сам з .env.example)
├── .env.example     ← шаблон
└── fonts/
    └── DejaVuSans.ttf  ← шрифт для PDF (завантажити вручну)
```

---

## 🔑 Крок 1. Отримати ключі

### Telegram Bot Token
1. Відкрий Telegram, знайди [@BotFather](https://t.me/BotFather)
2. Надішли команду `/newbot`
3. Придумай назву бота (наприклад: `Homework Helper`)
4. Придумай username (наприклад: `my_homework_bot`) — має закінчуватись на `bot`
5. BotFather надішле токен вигляду:
   ```
   7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. Скопіюй його — це твій `BOT_TOKEN`

### Google Gemini API Key
1. Перейди на [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Увійди з Google-акаунтом
3. Натисни **"Create API key"**
4. Обери проект або створи новий
5. Скопіюй ключ вигляду:
   ```
   AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
6. Це твій `GEMINI_API_KEY`

---

## 📦 Крок 2. Встановити залежності

```bash
# Перейди до папки проекту
cd homework-bot

# Встанови всі пакети
npm install
```

---

## 🔤 Крок 3. Завантажити шрифт для PDF

```bash
# Створи папку fonts
mkdir fonts

# Завантаж DejaVuSans.ttf (один з варіантів):

# Варіант A — через curl (Linux/Mac):
curl -L "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2" \
  -o dejavu.tar.bz2
tar -xjf dejavu.tar.bz2
cp dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf fonts/
rm -rf dejavu.tar.bz2 dejavu-fonts-ttf-2.37

# Варіант B — вручну:
# Скачай з https://dejavu-fonts.github.io/
# Розпакуй архів, скопіюй DejaVuSans.ttf у папку fonts/
```

---

## ⚙️ Крок 4. Створити файл .env

```bash
cp .env.example .env
```

Відкрий `.env` і заміни значення на свої:

```env
BOT_TOKEN=7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HTTPS_PROXY=http://user:password@proxy-host:3128
```

> Якщо проксі не потрібен — залиш `HTTPS_PROXY=` порожнім або видали рядок.

---

## 🚀 Крок 5. Запустити бота

### Без проксі:
```bash
node bot.js
```

### З проксі через змінну оточення (термінал):

**Linux / Mac:**
```bash
HTTPS_PROXY=http://user:password@proxy-host:3128 node bot.js
```

**Windows (PowerShell):**
```powershell
$env:HTTPS_PROXY="http://user:password@proxy-host:3128"; node bot.js
```

**Windows (CMD):**
```cmd
set HTTPS_PROXY=http://user:password@proxy-host:3128 && node bot.js
```

### Через .env файл (рекомендовано):
```bash
# Просто заповни HTTPS_PROXY у .env і запускай звичайно:
node bot.js
```

---

## 🤖 Як користуватись ботом

1. Знайди бота в Telegram за його username
2. Натисни `/start`
3. Надішли 1 або 2 фото з домашнім завданням
4. Натисни кнопку **🔍 Розпізнати текст**
5. Бот поверне розпізнаний текст після "Домашнє завдання"
6. Щоб виправити текст — **відповідай реплаєм** на повідомлення бота з виправленим варіантом
7. Натисни **📄 Сформувати PDF** — отримаєш файл

---

## 🛠 Режим розробки (auto-restart)

```bash
npm run dev
```

---

## ❗ Можливі помилки

| Помилка | Рішення |
|---|---|
| `ETELEGRAM: 401 Unauthorized` | Перевір `BOT_TOKEN` у `.env` |
| `API key not valid` | Перевір `GEMINI_API_KEY` у `.env` |
| `Шрифт не найден` | Поклади `DejaVuSans.ttf` у папку `fonts/` |
| `ECONNREFUSED` / таймаут | Перевір проксі або мережу |
