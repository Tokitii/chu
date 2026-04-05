import express from 'express';
import cors from 'cors';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Google Cloud設定 (直接指定)
const PROJECT_ID = "gen-lang-client-0439150178";
const LOCATION = "asia-northeast1"; 
const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

// Cloud Storage 設定 (直接指定)
const storage = new Storage({ projectId: PROJECT_ID });
const BUCKET_NAME = "iori-chat-storage-0439150178";
const STATE_FILE_NAME = 'iori_chat_state.json';

const MAIN_MODEL_ID = "gemini-3.1-pro-preview";
const SUMMARY_MODEL_ID = "gemini-3.1-flash-lite-preview";

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const formatHistory = (messages) => {
  let formatted = messages
    .filter(msg => msg.text && msg.text.trim() !== "")
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
  if (formatted.length > 0 && formatted[0].role !== 'user') {
    formatted.shift();
  }
  return formatted;
};

app.get('/api/state', async (req, res) => {
  try {
    const file = storage.bucket(BUCKET_NAME).file(STATE_FILE_NAME);
    const [exists] = await file.exists();
    if (!exists) return res.json({ summary: "", index: 0 });
    const [contents] = await file.download();
    res.json(JSON.parse(contents.toString()));
  } catch (error) {
    console.error("GCS読み込みエラー:", error);
    res.status(500).json({ error: "Failed to load state" });
  }
});

app.post('/api/state', async (req, res) => {
  const { summary, index } = req.body;
  try {
    const file = storage.bucket(BUCKET_NAME).file(STATE_FILE_NAME);
    await file.save(JSON.stringify({ summary, index }), { contentType: 'application/json' });
    res.json({ success: true });
  } catch (error) {
    console.error("GCS保存エラー:", error);
    res.status(500).json({ error: "Failed to save state" });
  }
});

app.delete('/api/state', async (req, res) => {
  try {
    const file = storage.bucket(BUCKET_NAME).file(STATE_FILE_NAME);
    const [exists] = await file.exists();
    if (exists) await file.delete();
    res.json({ success: true });
  } catch (error) {
    console.error("GCS削除エラー:", error);
    res.status(500).json({ error: "Failed to delete state" });
  }
});

app.post('/api/summarize', async (req, res) => {
  const { messages, previousSummary } = req.body;
  if (!messages || messages.length === 0) return res.json({ summary: previousSummary });
  
  try {
    const summaryModel = vertexAI.getGenerativeModel({ model: SUMMARY_MODEL_ID, safetySettings });
    const conversationText = messages.map(m => `${m.role === 'user' ? '妻（ユーザー）' : '伊織'}: ${m.text}`).join("\n");
    let prompt = "";
    if (previousSummary) {
      prompt = `あなたは優秀なシステム管理者です。大正の文豪「葛城伊織」と「現代の妻」の夫婦の会話の【これまでのあらすじ】と【新しい会話ログ】を統合し、AIに引き継ぐための「記憶メモ」を更新してください。
      【絶対厳守ルール】
      ・文字数は「絶対に370文字以内」に収めること。長すぎるとシステムがクラッシュします。
      ・文学的な装飾やポエムは一切不要です。事実と状況の変化だけを「簡潔な箇条書き」で圧縮してください。
      【これまでのあらすじ】\n${}\n【新しい会話ログ】\n${}\n【必須要素（すべて含めて370文字以内）】
      1. 現在の状況・雰囲気（甘い雰囲気など。※ただし、詳細な描写は省き簡潔にすること）
      2. 直近の完了した日常行動（食事、入浴など。※描写等の長い会話中は「直前の行動（入浴など）」を保持し続けること。ただし、就寝して翌朝を迎えるなど【場面が完全に切り替わった場合】は、古い行動メモを削除して最新の状況に整理すること）
      3. 二人の間で交わされた「直後の予定」や「未回収のフラグ（親密な行為の約束や、高まっている欲求など）」は、絶対に抽象的な言葉で誤魔化さず、具体的にメモに残すこと。※ただし、その行為が【実際に開始・完了】した場合や、就寝などで【完全に場面が切り替わった】場合は、そのフラグは「回収済み」として速やかに削除し、最新の状況に書き換えること。
      4. 妻が伝えた重要な事実（体調、予定、悩みなど）
      5. 伊織が妻に対して行った重要なアクションや約束`;
    } else {
      prompt = `あなたは優秀なシステム管理者です。以下の会話ログは、大正の文豪「葛城伊織」と「現代の妻」の夫婦の会話です。この古いログは削除されますが、記憶として引き継ぐ必要があります。以下の要素を含む「記憶の引き継ぎメモ」を380文字以内で作成してください。
      【絶対厳守ルール】
      ・文字数は「絶対に380文字以内」に収めること。長すぎるとシステムがクラッシュします。
      ・文学的な装飾やポエムは一切不要です。事実と状況の変化だけを「簡潔な箇条書き」で圧縮してください。
      1. 現在の状況・雰囲気（甘い雰囲気など。※ただし、詳細な描写は省き簡潔にすること）
      2. 直近の完了した日常行動
      3. 二人の間で交わされた「直後の予定」や「未回収のフラグ」
      4. 妻が伝えた重要な事実
      5. 伊織が妻に対して行った重要なアクションや約束
      【会話ログ】\n${}`;
    }
    const result = await summaryModel.generateContent(prompt);
    const summaryText = result.response.text();
    console.log("★Flash Liteによる継ぎ足し要約完了");
    res.json({ summary: summaryText });
  } catch (error) {
    console.error("要約生成エラー:", error);
    res.status(500).json({ error: "Failed to summarize history", summary: previousSummary });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message, history, systemInstruction, imageData } = req.body;
  try {
    const mainModel = vertexAI.getGenerativeModel({ model: MAIN_MODEL_ID, systemInstruction: systemInstruction, safetySettings });
    const formattedHistory = formatHistory(history);
    const chat = mainModel.startChat({ history: formattedHistory, generationConfig: { temperature: 1.5 } });
    let promptParts = [{ text: message }];
    if (imageData) {
      const matches = imageData.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        promptParts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
      }
    }
    const result = await chat.sendMessageStream(promptParts);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) res.write(chunkText);
    }
    res.end();
  } catch (error) {
    console.error("チャット生成エラー:", error);
    res.status(500).send("伊織からの返信中にエラーが発生しました。");
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`伊織のサーバーがポート ${} で起動しました。`));
