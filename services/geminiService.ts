// packages/frontend/src/services/geminiService.ts
import { IORI_PERSONA } from "../constants";
import { Message } from "../types";

// 直近何件を生で送るか
const RAW_HISTORY_LIMIT = 8;

export class GeminiService {
  private cachedSummary: string = "";
  private lastSummarizedIndex: number = 0;
  private isStateLoaded: boolean = false;

  constructor() {
    // コンストラクタでの初期化はせず、API呼び出し時に非同期で読み込みます
  }

  // ★重要：APIキーの有無チェックは不要になります（サーバーが持っているため）
  public hasApiKey(): boolean {
    return true;
  }

  // ★ サーバー(GCS)から状態を非同期で読み込む
  private async ensureStateLoaded() {
    if (this.isStateLoaded) return;
    try {
      const response = await fetch("/api/state");
      if (response.ok) {
        const data = await response.json();
        this.cachedSummary = data.summary || "";
        this.lastSummarizedIndex = data.index || 0;
      }
      this.isStateLoaded = true;
    } catch (e) {
      console.error("GCSからの状態読み込みに失敗しました", e);
    }
  }

  // ★ サーバー(GCS)へ状態を保存する
  private async saveState(summary: string, index: number) {
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, index })
      });
    } catch (e) {
      console.error("GCSへの状態保存に失敗しました", e);
    }
  }

  // ★ サーバー(GCS)の状態を削除する（リセット用）
  private async deleteState() {
    try {
      await fetch("/api/state", { method: "DELETE" });
    } catch (e) {
      console.error("GCSからの状態削除に失敗しました", e);
    }
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
    await this.ensureStateLoaded(); // 操作前に状態をロード

    // 履歴が減っていたらリセット（安全装置）
    if (historyMessages.length < this.lastSummarizedIndex) {
      await this.resetLocalState();
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
          // LocalStorageではなくGCSへ保存
          await this.saveState(this.cachedSummary, this.lastSummarizedIndex);
        }
      }
    }
  }

  private async resetLocalState() {
    this.cachedSummary = "";
    this.lastSummarizedIndex = 0;
    await this.deleteState(); // GCSのデータも削除
  }

  async resetChat(historyMessages: Message[]) {
    await this.ensureStateLoaded();
    await this.resetLocalState();
    await this.initializeChat(historyMessages);
  }

  // 伊織さんからの返信をストリーミングで受け取る
  async sendMessageStream(message: string, allHistory: Message[], imageData?: string) {
    await this.ensureStateLoaded(); // 操作前に状態を確実にする

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
