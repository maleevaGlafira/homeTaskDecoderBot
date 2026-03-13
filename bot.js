require("dotenv").config();
process.stdout._handle?.setBlocking?.(true);
const { Telegraf, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HttpsProxyAgent } = require("https-proxy-agent");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const https = require("https");



// ─── Прокси ───────────────────────────────────────────────────────────────────
const PROXY_URL = process.env.HTTPS_PROXY || "";


// ─── Клиенты ──────────────────────────────────────────────────────────────────
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent,
  },
});

// Перевірка з'єднання перед запуском
bot.telegram.getMe()
  .then((info) => {
    process.stdout.write(`✅ З'єднання є! Бот: @${info.username}\n`);
   // return bot.launch();
  })
  .then(() => {
    process.stdout.write("✅ Бот запущено!\n");
  })
  .catch((err) => {
    process.stdout.write(`❌ Помилка: ${err.message}\n`);
    process.exit(1);
  });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: "v1" });
// ─── Шрифт ─────────────────────────────────────────────────────────
async function ensureFont() {
  const fontDir = path.join(__dirname, "fonts");
  const fontPath = path.join(fontDir, "DejaVuSans.ttf");

  if (fs.existsSync(fontPath)) return;

  fs.mkdirSync(fontDir, { recursive: true });
  process.stdout.write("⬇️ Завантажую шрифт...\n");

  const url = "https://github.com/dejavu-fonts/dejavu-fonts/raw/master/ttf/DejaVuSans.ttf";

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(fontPath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
  });

  process.stdout.write("✅ Шрифт завантажено!\n");
}

// ─── Хранилище сессий ─────────────────────────────────────────────────────────
// { chatId: { photos: [], messageId?, recognizedText? } }
const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = { photos: [] };
  return sessions[chatId];
}

// ─── Скачивание файла через Telegram API (с учётом прокси) ────────────────────
async function downloadFile(fileId) {
  const fileInfo = await bot.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    ...(agent ? { httpsAgent: agent } : {}),
  });
  return Buffer.from(response.data);
}

// ─── Распознавание через Gemini ───────────────────────────────────────────────
async function recognizeHomework(photoBuffers) {
  const parts = photoBuffers.map((buf) => ({
    inlineData: { mimeType: "image/jpeg", data: buf.toString("base64") },
  }));

  parts.push({
    text:
      "Распозай текст на фото сохрани нумерацию . Верни текст с нумерацией"
  });

  const result = await model.generateContent(parts);
  return result.response.text().trim();
}

// ─── Генерация PDF ────────────────────────────────────────────────────────────
function generatePDF(text) {
  return new Promise((resolve, reject) => {
    const fontPath = path.join(__dirname, "fonts", "DejaVuSans.ttf");
    if (!fs.existsSync(fontPath)) {
      return reject(
        new Error(
          "Шрифт не найден: fonts/DejaVuSans.ttf\n" +
            "Скачай: https://github.com/dejavu-fonts/dejavu-fonts/releases"
        )
      );
    }

    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("DejaVu", fontPath);
    doc
      .font("DejaVu")
      .fontSize(14)
      .text("Домашнє завдання", { align: "center", underline: true });
    doc.moveDown();
    doc.fontSize(12).text(text, { lineGap: 4 });
    doc.end();
  });
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  sessions[ctx.chat.id] = { photos: [] };
  ctx.reply(
    "👋 Привіт! Надішли 1 або 2 фото з домашнім завданням.\n" +
      "Потім натисни кнопку 🔍 Розпізнати текст."
  );
});

// ─── Приём фото ───────────────────────────────────────────────────────────────
bot.on("photo", async (ctx) => {
  const session = getSession(ctx.chat.id);
  const fileId = ctx.message.photo.at(-1).file_id; // берём наибольшее разрешение

  if (session.photos.length >= 2) {
    session.photos = [];
    session.recognizedText = undefined;
  }

  session.photos.push(fileId);

  const count = session.photos.length;
  await ctx.reply(
    `📷 Фото ${count}/2 отримано.`,
    Markup.inlineKeyboard([
      Markup.button.callback("🔍 Розпізнати текст", "recognize"),
    ])
  );
});

// ─── Кнопка: Розпізнати ───────────────────────────────────────────────────────
bot.action("recognize", async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.chat.id);

  if (!session.photos.length) {
    return ctx.reply("⚠️ Спочатку надішли хоча б одне фото.");
  }

  const statusMsg = await ctx.reply("⏳ Розпізнаю текст...");

  try {
    const buffers = await Promise.all(session.photos.map(downloadFile));
    const text = await recognizeHomework(buffers);

    session.recognizedText = text;

    // Редактируем статус-сообщение, заменяя его результатом
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `📝 Розпізнаний текст:\n\n<code>${escapeHtml(text)}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback("📄 Сформувати PDF", "generate_pdf"),
        ]),
      }
    );

    session.botMessageId = statusMsg.message_id;
  } catch (err) {
    console.error(err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Помилка: ${err.message}`
    );
  }
});

// ─── Ответ на сообщение бота = исправление текста ─────────────────────────────
bot.on("text", async (ctx) => {
  const session = getSession(ctx.chat.id);
  const replyTo = ctx.message?.reply_to_message?.message_id;

  if (replyTo && replyTo === session.botMessageId) {
    // Пользователь прислал исправленный текст
    const correctedText = ctx.message.text;
    session.recognizedText = correctedText;

    await ctx.reply(
      `✅ Текст оновлено:\n\n<code>${escapeHtml(correctedText)}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback("📄 Сформувати PDF", "generate_pdf"),
        ]),
      }
    );
  }
});

// ─── Кнопка: Сформувати PDF ───────────────────────────────────────────────────
bot.action("generate_pdf", async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.chat.id);

  if (!session.recognizedText) {
    return ctx.reply("⚠️ Немає тексту для генерації PDF. Спочатку розпізнай фото.");
  }

  const statusMsg = await ctx.reply("⏳ Генерую PDF...");

  try {
    const pdfBuffer = await generatePDF(session.recognizedText);

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    await ctx.replyWithDocument(
      { source: pdfBuffer, filename: "homework.pdf" },
      { caption: "📄 Домашнє завдання" }
    );
  } catch (err) {
    console.error(err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Помилка генерації PDF: ${err.message}`
    );
  }
});

// ─── Утилиты ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Запуск ───────────────────────────────────────────────────────────────────
ensureFont()
  .then(() => bot.telegram.getMe())
  .then((info) => {
    process.stdout.write(`✅ Бот: @${info.username}\n`);
    return bot.launch();
  }).then(() => {
	process.stdout.write("✅ Запуск бота...\n");
  console.log("✅ Бот запущено!");
  if (PROXY_URL) console.log(`🌐 Проксі: ${PROXY_URL}`);
}).catch((err) => {
    process.stdout.write(`❌ Помилка запуску: ${err.message}\n`);
    process.exit(1);
  });
  

  
console.log("PROXY:", process.env.HTTPS_PROXY);
console.log("BOT_TOKEN:",process.env.BOT_TOKEN);
console.log("GEMINI_API_KEY:",process.env.GEMINI_API_KEY);


process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
