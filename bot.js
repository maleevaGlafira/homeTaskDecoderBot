require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleGenAI } = require("@google/genai"); // Подключение нового SDK
const { HttpsProxyAgent } = require("https-proxy-agent");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const https = require("https");

// --- Конфигурация ---
const PROXY_URL = process.env.HTTPS_PROXY || "";
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { agent },
});

// Инициализация нового клиента Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = { photos: [] };
  return sessions[chatId];
}

// --- Функции ---

async function ensureFont() {
  const fontDir = path.join(__dirname, "fonts");
  const fontPath = path.join(fontDir, "DejaVuSans.ttf");
  if (fs.existsSync(fontPath)) return;

  fs.mkdirSync(fontDir, { recursive: true });
  process.stdout.write("⬇️ Завантажую шрифт...\n");
  const url = "https://github.com/dejavu-fonts/dejavu-fonts/raw/master/ttf/DejaVuSans.ttf";
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(fontPath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
  });
}

async function downloadFile(fileId) {
  const fileInfo = await bot.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    ...(agent ? { httpsAgent: agent } : {}),
  });
  return Buffer.from(response.data);
}

async function recognizeHomework(photoBuffers) {
  const imageParts = photoBuffers.map((buf) => ({
    inlineData: { 
      mimeType: "image/jpeg", 
      data: buf.toString("base64") 
    },
  }));

  // Отправка запроса по новому стандарту @google/genai
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      "Analyze this photo of handwritten homework. Return plain text only.",
      ...imageParts
    ]
  });
  
  // В новом SDK текст является свойством, а не функцией
  return response.text;
}

async function generatePDF(text) {
  return new Promise((resolve, reject) => {
    const fontPath = path.join(__dirname, "fonts", "DejaVuSans.ttf");
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("DejaVu", fontPath);
    doc.font("DejaVu").fontSize(14).text("Домашнє завдання", { align: "center", underline: true });
    doc.moveDown().fontSize(12).text(text, { lineGap: 4 });
    doc.end();
  });
}

// --- Обработчики ---

const mainMenu = Markup.keyboard([["🔄 Перезапустити бота"]]).resize();

bot.start((ctx) => {
  sessions[ctx.chat.id] = { photos: [] };
  ctx.reply("👋 Привіт! Надішли 1 або 2 фото з завданням, а потім натисни кнопку розпізнавання.", mainMenu);
});

bot.on("photo", async (ctx) => {
  const session = getSession(ctx.chat.id);
  const fileId = ctx.message.photo.at(-1).file_id;

  if (session.photos.length >= 2) {
    session.photos = [];
    session.recognizedText = undefined;
  }
  
  session.photos.push(fileId);

  await ctx.reply(`📷 Фото ${session.photos.length}/2 отримано.`, 
    Markup.inlineKeyboard([Markup.button.callback("🔍 Розпізнати текст", "recognize")])
  );
  await ctx.reply("⬇️ Або:", mainMenu);
});

bot.action("recognize", async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.chat.id);
  if (!session.photos.length) return ctx.reply("⚠️ Спочатку надішли фото.");

  const statusMsg = await ctx.reply("⏳ Розпізнаю текст через Gemini...");
  
  try {
    const buffers = await Promise.all(session.photos.map(downloadFile));
    const text = await recognizeHomework(buffers);
    
    session.recognizedText = text;
    session.botMessageId = statusMsg.message_id;

    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `📝 Розпізнаний текст:\n\n<code>${escapeHtml(text)}</code>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([Markup.button.callback("📄 Сформувати PDF", "generate_pdf")]) }
    );
  } catch (err) {
    console.error(err);
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ Помилка: ${err.message}`);
  }
});

bot.hears("🔄 Перезапустити бота", handleRestart);
bot.command("restart", handleRestart);

bot.on("text", async (ctx) => {
  const session = getSession(ctx.chat.id);
  const replyTo = ctx.message?.reply_to_message?.message_id;

  if (replyTo && replyTo === session.botMessageId) {
    session.recognizedText = ctx.message.text;
    await ctx.reply(`✅ Текст оновлено:\n\n<code>${escapeHtml(session.recognizedText)}</code>`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([Markup.button.callback("📄 Сформувати PDF", "generate_pdf")]),
    });
  }
});

bot.action("generate_pdf", async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.chat.id);
  if (!session.recognizedText) return ctx.reply("⚠️ Немає тексту. Спочатку розпізнай фото.");
  
  const statusMsg = await ctx.reply("⏳ Генерую PDF...");
  
  try {
    const pdf = await generatePDF(session.recognizedText);
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    await ctx.replyWithDocument({ source: pdf, filename: "homework.pdf" }, { caption: "📄 Домашнє завдання" });
  } catch (err) {
    console.error(err);
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ Помилка PDF: ${err.message}`);
  }
});



function handleRestart(ctx) {
  sessions[ctx.chat.id] = { photos: [] };
  ctx.reply("♻️ Бот перезапущено! Надішли нове фото.", mainMenu);
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Запуск ---
(async () => {
  try {
    await ensureFont();
    const info = await bot.telegram.getMe();
    process.stdout.write(`✅ З'єднання є! Бот: @${info.username}\n`);
    await bot.launch();
    console.log("✅ Бот успішно запущено!");
    if (PROXY_URL) console.log(`🌐 Проксі: ${PROXY_URL}`);
  } catch (err) {
    console.error("❌ Ошибка запуска:", err);
    process.exit(1);
  }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));