// packages/frontend/src/services/geminiService.ts

import { IORI_PERSONA } from "../constants";
import { Message } from "../types";

// ブラウザの引き出し（localStorage）の鍵
const CACHED_SUMMARY_KEY = "iori_cached_summary";
const LAST_SUMMARIZED_INDEX_KEY = "iori_last_summarized_index";

// 直近何件を生で送るか
const RAW_HISTORY_LIMIT = 8;

export class GeminiService {
  private cachedSummary: string = "";
  private lastSummarizedIndex: number = 0;

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

  // ★重要：APIキーの有無チェックは不要になります（サーバーが持っているため）
  public hasApiKey(): boolean {
    return true; 
  }

  // サーバー側の要約APIを呼び出す
  private async summarizeHistory(messagesToSummarize: Message[], previousSummary: string = ""): Promise<string> {
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesToSummarize,
          previousSummary
        })
      });

      if (!response.ok) throw new Error("Summary request failed");
      const data = await response.json();
      return data.summary;
    } catch (e) {
      console.error("要約の取得に失敗しました:", e);
      return previousSummary;
    }
  }

  async initializeChat(historyMessages: Message[]) {
    // 履歴が減っていたらリセット（安全装置）
    if (historyMessages.length < this.lastSummarizedIndex) {
      this.resetLocalState();
    }

    // 履歴が上限を超えたら、溢れた分をサーバーで要約してもらう
    if (historyMessages.length > RAW_HISTORY_LIMIT) {
      const splitIndex = historyMessages.length - RAW_HISTORY_LIMIT;
      
      if (splitIndex > this.lastSummarizedIndex) {
        const newlyOverflowed = historyMessages.slice(this.lastSummarizedIndex, splitIndex);
        
        console.log("古い会話をCloud Runで圧縮中...");
        const newSummary = await this.summarizeHistory(newlyOverflowed, this.cachedSummary);

        if (newSummary) {
          this.cachedSummary = newSummary;
          this.lastSummarizedIndex = splitIndex;
          localStorage.setItem(CACHED_SUMMARY_KEY, this.cachedSummary);
          localStorage.setItem(LAST_SUMMARIZED_INDEX_KEY, this.lastSummarizedIndex.toString());
        }
      }
    }
  }

  private resetLocalState() {
    this.cachedSummary = "";
    this.lastSummarizedIndex = 0;
    localStorage.removeItem(CACHED_SUMMARY_KEY);
    localStorage.removeItem(LAST_SUMMARIZED_INDEX_KEY);
  }

  async resetChat(historyMessages: Message[]) {
    this.resetLocalState();
    await this.initializeChat(historyMessages);
  }

  // 伊織さんからの返信をストリーミングで受け取る
  async sendMessageStream(message: string, allHistory: Message[], imageData?: string) {
    // 直近の履歴だけをサーバーに送る
    const recentMessages = allHistory.slice(-RAW_HISTORY_LIMIT);
    
    // 要約データをシステムプロンプトに合体
    let finalInstruction = IORI_PERSONA;
    if (this.cachedSummary) {
      finalInstruction += `\n\n=== 【過去の記憶（要約）】 ===\n${this.cachedSummary}\n==========================`;
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: recentMessages,
        systemInstruction: finalInstruction,
        imageData
      })
    });

    if (!response.body) throw new Error("サーバーからの応答が空です");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // ストリーミングを1文字ずつ画面に流すためのジェネレーター
    return (async function* () {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    })();
  }
}

export const geminiService = new GeminiService();
