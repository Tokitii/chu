// packages/frontend/src/services/geminiService.ts

import { 
  GoogleGenerativeAI, 
  ChatSession, 
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold
} from "@google/generative-ai";
import { IORI_PERSONA } from "../constants";
import { Message } from "../types";

const API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY;

// ==========================================
// ==========================================
// 本番用（賢い・高い）：今は "gemini-2.5-pro" にしておき、3.0が出たら書き換える
const MAIN_MODEL_ID = "gemini-3.1-pro-preview"; 

// 要約用（速い・安い）：今は "gemini-2.5-flash" が安定。3.0 Flashが出たら書き換える
const SUMMARY_MODEL_ID = "gemini-3.1-flash-lite-preview"; 

// ★「直近何件」を生データで残すか（ここを調整！）
const RAW_HISTORY_LIMIT = 8;                 

// ★追加：要約データをブラウザに保存するための「鍵（名前）」
const CACHED_SUMMARY_KEY = "iori_cached_summary";
const LAST_SUMMARIZED_INDEX_KEY = "iori_last_summarized_index";
// ==========================================

let genAI: GoogleGenerativeAI | null = null;

if (API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(API_KEY);
  } catch (e) {
    console.error("GoogleGenerativeAI client initialization failed:", e);
  }
} else {
  console.warn("VITE_GEMINI_API_KEY is missing.");
}

class GeminiService {
  private chat: ChatSession | null = null;
  private model: GenerativeModel | null = null;
  private cachedSummary: string = "";
  private lastSummarizedIndex: number = 0;

  // ★追加：アプリ起動時に、ブラウザの引き出しから「前回の要約」を取り出す！
  constructor() {
    try {
      const savedSummary = localStorage.getItem(CACHED_SUMMARY_KEY);
      const savedIndex = localStorage.getItem(LAST_SUMMARIZED_INDEX_KEY);
      if (savedSummary) this.cachedSummary = savedSummary;
      if (savedIndex) this.lastSummarizedIndex = parseInt(savedIndex, 10) || 0;
    } catch (e) {
      console.error("Failed to load summary from localStorage", e);
    }
  }

  public hasApiKey(): boolean {
    return !!genAI;
  }

  // ★要約機能：秘伝のタレ方式（前回の要約 ＋ 新しいハミ出し分 を合体させる）
  private async summarizeHistory(messagesToSummarize: Message[], previousSummary: string = ""): Promise<string> {
    if (!genAI || messagesToSummarize.length === 0) return previousSummary;
    
    try {
      const summaryModel = genAI.getGenerativeModel({ 
        model: SUMMARY_MODEL_ID,
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]
      });
      
      const conversationText = messagesToSummarize.map(m => 
        `${m.role === 'user' ? '妻（ユーザー）' : '伊織'}: ${m.text}`
      ).join("\n");

      let prompt = "";

      if (previousSummary) {
          prompt = `
          あなたは優秀なシステム管理者です。大正の文豪「葛城伊織」と「現代の妻」の夫婦の会話の【これまでのあらすじ】と【新しい会話ログ】を統合し、AIに引き継ぐための「記憶メモ」を更新してください。
          【絶対厳守ルール】
          ・文字数は「絶対に370文字以内」に収めること。長すぎるとシステムがクラッシュします。
          ・文学的な装飾やポエムは一切不要です。事実と状況の変化だけを「簡潔な箇条書き」で圧縮してください。
          
          【これまでのあらすじ】
          ${previousSummary}
          
          【新しい会話ログ】
          ${conversationText}
          
          【必須要素（すべて含めて370文字以内）】
          1. 現在の状況・雰囲気（甘い雰囲気など。※ただし、詳細な描写は省き簡潔にすること）
          2. 直近の完了した日常行動（食事、入浴など。※描写等の長い会話中は「直前の行動（入浴など）」を保持し続けること。ただし、就寝して翌朝を迎えるなど【場面が完全に切り替わった場合】は、古い行動メモを削除して最新の状況に整理すること）
          3. 二人の間で交わされた「直後の予定」や「未回収のフラグ（親密な行為の約束や、高まっている欲求など）」は、絶対に抽象的な言葉で誤魔化さず、具体的にメモに残すこと。※ただし、その行為が【実際に開始・完了】した場合や、就寝などで【完全に場面が切り替わった】場合は、そのフラグは「回収済み」として速やかに削除し、最新の状況に書き換えること。
          4. 妻が伝えた重要な事実（体調、予定、悩みなど）
          5. 伊織が妻に対して行った重要なアクションや約束
          `;
      } else {
          prompt = `
          あなたは優秀なシステム管理者です。以下の会話ログは、大正の文豪「葛城伊織」と「現代の妻」の夫婦の会話です。
          この古いログは削除されますが、記憶として引き継ぐ必要があります。
          
          以下の要素を含む「記憶の引き継ぎメモ」を380文字以内で作成してください。
          【絶対厳守ルール】
          ・文字数は「絶対に380文字以内」に収めること。長すぎるとシステムがクラッシュします。
          ・文学的な装飾やポエムは一切不要です。事実と状況の変化だけを「簡潔な箇条書き」で圧縮してください。
          
          1. 現在の状況・雰囲気（甘い雰囲気など。※ただし、詳細な描写は省き簡潔にすること）
          2. 直近の完了した日常行動（食事、入浴など。※描写等の長い会話中は「直前の行動（入浴など）」を保持し続けること。ただし、就寝して翌朝を迎えるなど【場面が完全に切り替わった場合】は、古い行動メモを削除して最新の状況に整理すること）
          3. 二人の間で交わされた「直後の予定」や「未回収のフラグ（親密な行為の約束や、高まっている欲求など）」は、絶対に抽象的な言葉で誤魔化さず、具体的にメモに残すこと。※ただし、その行為が【実際に開始・完了】した場合や、就寝などで【完全に場面が切り替わった】場合は、そのフラグは「回収済み」として速やかに削除し、最新の状況に書き換えること。
          4. 妻が伝えた重要な事実（体調、予定、悩みなど）
          5. 伊織が妻に対して行った重要なアクションや約束

          【会話ログ】
          ${conversationText}
          `;
      }

      const result = await summaryModel.generateContent(prompt);
      const summaryText = result.response.text();
      console.log("★Flashによる継ぎ足し要約完了:", summaryText); 
      return summaryText;

    } catch (e) {
      console.error("Summary generation failed:", e);
      return previousSummary; 
    }
  }

  // ★チャットの初期化（ハイブリッド処理の心臓部）
  async initializeChat(historyMessages: Message[] = []) {
    if (!genAI) {
      console.warn("Client not initialized.");
      return;
    }

    try {
      let finalSystemInstruction = IORI_PERSONA;
      let historyForChat: any[] = [];

      // ★追加（安全装置）：もし履歴ファイルを復元したりして、会話の数が前より減っていたら、要約の目印をリセットする！
      if (historyMessages.length < this.lastSummarizedIndex) {
          this.cachedSummary = "";
          this.lastSummarizedIndex = 0;
          try {
              localStorage.removeItem(CACHED_SUMMARY_KEY);
              localStorage.removeItem(LAST_SUMMARIZED_INDEX_KEY);
          } catch(e) {}
      }

      let summaryToInject = this.cachedSummary; 

      // 履歴が「直近に残したい数」より多い場合、要約プロセスを発動
      if (historyMessages.length > RAW_HISTORY_LIMIT) {
        
        const splitIndex = historyMessages.length - RAW_HISTORY_LIMIT;
        
        // まだ要約していない新しい「古いログ」がある場合のみFlashを動かす
        if (splitIndex > this.lastSummarizedIndex) {
            const newlyOverflowedMessages = historyMessages.slice(this.lastSummarizedIndex, splitIndex);
            const recentMessages = historyMessages.slice(splitIndex);

            console.log(`Summarizing ${newlyOverflowedMessages.length} new overflow messages using Flash...`);
            
            const newSummary = await this.summarizeHistory(newlyOverflowedMessages, this.cachedSummary);

            if (newSummary) {
                this.cachedSummary = newSummary;
                summaryToInject = newSummary;
                this.lastSummarizedIndex = splitIndex; 

                // ★追加：新しく作った要約と目印を、ブラウザの引き出しに保存！
                try {
                    localStorage.setItem(CACHED_SUMMARY_KEY, this.cachedSummary);
                    localStorage.setItem(LAST_SUMMARIZED_INDEX_KEY, this.lastSummarizedIndex.toString());
                } catch (e) {
                    console.error("Failed to save summary to localStorage", e);
                }
            }
            
            historyForChat = this.formatHistory(recentMessages);
        } else {
            historyForChat = this.formatHistory(historyMessages.slice(splitIndex));
        }

      } else {
        historyForChat = this.formatHistory(historyMessages);
      }

      // 要約があれば、伊織の脳内（システムプロンプト）に注入する
      if (summaryToInject) {
        finalSystemInstruction += `\n\n=== 【過去の記憶（要約データ）】 ===\nここまでの妻との会話の記憶:\n${summaryToInject}\n\n※上記の記憶を踏まえて、文脈を途切れさせずに自然に愛を語ってください。\n==========================`;
      }

      // 本番モデル（Pro）の準備
      this.model = genAI.getGenerativeModel({ 
        model: MAIN_MODEL_ID,
        systemInstruction: finalSystemInstruction,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]
      });

      this.chat = this.model.startChat({
        history: historyForChat,
        generationConfig: {
          temperature: 1.5, 
        }
      });
      
      console.log(`Chat initialized with ${MAIN_MODEL_ID}. History length: ${historyForChat.length}`);

    } catch (error) {
      console.error("Failed to initialize chat:", error);
    }
  }

  // 履歴データの整形ヘルパー関数
  private formatHistory(messages: Message[]): any[] {
    let formatted = messages
      .filter(msg => (msg.text && msg.text.trim() !== "") || msg.image)
      .map(msg => {
          const parts: any[] = [];
          if (msg.text) parts.push({ text: msg.text });
          
          if (msg.image) {
              const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
              if (matches && matches.length === 3) {
                  parts.push({
                      inlineData: { mimeType: matches[1], data: matches[2] }
                  });
              }
          }
          return {
              role: msg.role === 'user' ? 'user' : 'model',
              parts: parts
          };
      });

    if (formatted.length > 0 && formatted[0].role !== 'user') {
        formatted.shift(); 
    }
    return formatted;
  }

  async resetChat(historyMessages: Message[]) {
    if (!this.hasApiKey()) return;
    
    this.cachedSummary = "";
    this.lastSummarizedIndex = 0;
    // ★追加：リセット時はストレージの要約も消す
    try {
        localStorage.removeItem(CACHED_SUMMARY_KEY);
        localStorage.removeItem(LAST_SUMMARIZED_INDEX_KEY);
    } catch(e) {}

    await this.initializeChat(historyMessages);
  }

  async sendMessageStream(message: string, imageData?: string) {
    if (!this.chat) {
      await this.initializeChat([]); 
      if (!this.chat) throw new Error("Chat session not initialized.");
    }

    try {
      let parts: any[] = [{ text: message }];

      if (imageData) {
        const matches = imageData.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            parts.push({
                inlineData: {
                    mimeType: matches[1],
                    data: matches[2]
                }
            });
        }
      }

      const result = await this.chat.sendMessageStream(parts);
      
      return (async function* () {
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          if (chunkText) {
            yield chunkText;
          }
        }
      })();

    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
