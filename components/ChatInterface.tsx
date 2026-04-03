import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { geminiService } from '../services/geminiService';

const STORAGE_KEY = 'iori_chat_history';

const ChatInterface: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State for Editing
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyFileInputRef = useRef<HTMLInputElement>(null); // フルバックアップ復元用
  const memoryFileInputRef = useRef<HTMLInputElement>(null); // 【新規】記憶の追記用

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!editingMessageId) {
        scrollToBottom();
    }
  }, [messages, editingMessageId]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
    }
  }, [inputText]);

  // Initial Loading from LocalStorage or Default Greeting
  useEffect(() => {
     if (!geminiService.hasApiKey()) {
         setError("⚠️ APIキーが設定されていません。環境変数 VITE_GEMINI_API_KEY を設定してください。");
     }

     const savedHistory = localStorage.getItem(STORAGE_KEY);
     
     if (savedHistory) {
         try {
             const parsedMessages: Message[] = JSON.parse(savedHistory).map((msg: any) => ({
                 ...msg,
                 timestamp: new Date(msg.timestamp)
             }));
             
             setMessages(parsedMessages);
             // 起動時に履歴を渡して初期化
             geminiService.initializeChat(parsedMessages);
         } catch (e) {
             console.error("Failed to parse chat history", e);
             initializeDefaultChat();
         }
     } else {
         initializeDefaultChat();
     }
  }, []);

  const initializeDefaultChat = () => {
      const defaultMsg: Message = {
          id: 'init-1',
          role: 'model',
          text: '（書斎の文机に向かっていたが、お前の気配を感じてふと顔を上げ、丸眼鏡の奥の瞳を細める）\n\n……おや。起きたのかい？\n……ふふ。おはよう。',
          timestamp: new Date()
      };
      setMessages([defaultMsg]);
      geminiService.initializeChat([defaultMsg]);
  };

  // Save to LocalStorage (Recent 36 messages)
  useEffect(() => {
      if (messages.length > 0) {
          try {
              const MAX_SAVE_MESSAGES = 36;
              const recentMessages = messages.slice(-MAX_SAVE_MESSAGES);

              const storageMessages = recentMessages.map(msg => {
                  if (msg.image) {
                      const { image, ...rest } = msg;
                      if (!rest.text || rest.text.trim() === '') {
                          return { ...rest, text: '（画像を送信しました）' };
                      }
                      return rest;
                  }
                  return msg;
              });
              
              localStorage.setItem(STORAGE_KEY, JSON.stringify(storageMessages));
          } catch (e) {
              console.error("LocalStorage save failed", e);
              setError("履歴の保存容量が一杯です。一部の履歴が保存されない可能性があります。");
          }
      }
  }, [messages]);

  // Image Compression Utility
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
               reject(new Error('Canvas context error'));
               return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        img.onerror = (error) => reject(error);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsLoading(true);

    try {
        const compressedDataUrl = await compressImage(file);
        setSelectedImage(compressedDataUrl);
    } catch (error) {
        console.error("Image processing failed", error);
        setError("画像の処理に失敗しました。ファイルが破損しているか、対応していない形式です。");
        setSelectedImage(null);
    } finally {
        setIsLoading(false);
        e.target.value = '';
    }
  };

  const clearImage = () => {
    setSelectedImage(null);
  };

  // Stream Processing
  const processStreamResponse = async (stream: AsyncIterable<string>) => {
      const responseId = (Date.now() + 1).toString();
      let fullResponseText = '';
      
      setMessages((prev) => [
        ...prev,
        {
          id: responseId,
          role: 'model',
          text: '',
          timestamp: new Date(),
          isStreaming: true
        }
      ]);

      for await (const chunk of stream) {
        fullResponseText += chunk;
        setMessages((prev) => 
          prev.map((msg) => 
            msg.id === responseId 
              ? { ...msg, text: fullResponseText }
              : msg
          )
        );
      }
      
      setMessages((prev) => 
          prev.map((msg) => 
            msg.id === responseId 
              ? { ...msg, isStreaming: false }
              : msg
          )
      );
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isLoading) return;

    if (!geminiService.hasApiKey()) {
        setError("APIキーが設定されていないため、メッセージを送信できません。");
        return;
    }

    setError(null);
    const userMessageText = inputText;
    const userImage = selectedImage;

    setInputText('');
    setSelectedImage(null);
    
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: userMessageText,
      image: userImage || undefined,
      timestamp: new Date(),
    };

    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setIsLoading(true);

    try {
      // 履歴を含めて初期化し、ストリームを開始
      await geminiService.initializeChat(currentMessages);
      const stream = await geminiService.sendMessageStream(userMessageText, currentMessages, userImage || undefined);
      await processStreamResponse(stream);
    } catch (error) {
      console.error("Failed to send message", error);
      setError("送信に失敗しました。通信環境を確認してください。");
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'model',
          text: '……すまない。少し考え事をしていたようだ。（エラーが発生しました）',
          timestamp: new Date(),
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEdit = (message: Message) => {
      setEditingMessageId(message.id);
      setEditText(message.text);
      setError(null);
  };

  const handleCancelEdit = () => {
      setEditingMessageId(null);
      setEditText('');
  };

  const handleSaveEdit = async (messageId: string) => {
      if (!editText.trim() || isLoading) return;

      const index = messages.findIndex(m => m.id === messageId);
      if (index === -1) return;

      const historyMessages = messages.slice(0, index);
      const originalMessage = messages[index];
      const updatedMessage: Message = {
          ...originalMessage,
          text: editText,
          timestamp: new Date()
      };

      const newFullHistory = [...historyMessages, updatedMessage];
      setMessages(newFullHistory);
      setEditingMessageId(null);
      setIsLoading(true);
      setError(null);

      try {
          await geminiService.initializeChat(newFullHistory);
          const stream = await geminiService.sendMessageStream(updatedMessage.text, newFullHistory, updatedMessage.image || undefined);
          await processStreamResponse(stream);
      } catch (error) {
          console.error("Failed to edit and resend", error);
          setError("送信に失敗しました。通信環境を確認してください。");
          setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'model',
              text: '……（書き直そうとしたが、言葉に詰まってしまったようだ）',
              timestamp: new Date()
          }]);
      } finally {
          setIsLoading(false);
      }
  };

  const handleDownloadHistory = () => {
    if (messages.length === 0) return;
    const textContent = messages.map(msg => {
      const dateStr = msg.timestamp.toLocaleString('ja-JP');
      const speaker = msg.role === 'model' ? '葛城 伊織' : '私';
      const content = msg.text || '';
      const imageNote = msg.image ? '（画像を送信しました）' : '';
      return `[${dateStr}] ${speaker}:\n${content}${imageNote ? `\n${imageNote}` : ''}`;
    }).join('\n\n----------------------------------------\n\n');

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `伊織との思い出_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleHistoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (messages.length > 1) { 
          const confirmLoad = window.confirm("現在の会話履歴はすべて消去され、ファイルの内容で上書きされます。\n復元を実行しますか？");
          if (!confirmLoad) {
              e.target.value = ''; 
              return;
          }
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
          const text = event.target?.result as string;
          if (!text) return;

          try {
              const chunks = text.split('\n\n----------------------------------------\n\n');
              const parsedMessages: Message[] = [];

              for (const chunk of chunks) {
                  if (!chunk.trim()) continue;
                  const firstNewLineIndex = chunk.indexOf('\n');
                  if (firstNewLineIndex === -1) continue;

                  const header = chunk.substring(0, firstNewLineIndex);
                  const body = chunk.substring(firstNewLineIndex + 1);
                  const headerMatch = header.match(/^\[(.*?)\] (.*?):$/);
                  
                  if (headerMatch) {
                      const dateStr = headerMatch[1];
                      const speaker = headerMatch[2];
                      
                      parsedMessages.push({
                          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                          role: speaker === '私' ? 'user' : 'model',
                          text: body.trim(),
                          timestamp: new Date(dateStr)
                      });
                  }
              }

              if (parsedMessages.length > 0) {
                  setMessages(parsedMessages);
                  geminiService.resetChat(parsedMessages);
                  setError(null);
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsedMessages));
              } else {
                  setError("ファイルの読み込みに失敗しました。形式が正しくないか、データが空です。");
              }
          } catch (error) {
              console.error("Failed to parse history file", error);
              setError("ファイルの読み込み中にエラーが発生しました。");
          }
      };
      reader.readAsText(file);
      e.target.value = '';
  };

  const handleMemoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
          const text = event.target?.result as string;
          if (!text) return;

          try {
              const memoryInjectMsg: Message = {
                  id: Date.now().toString() + '-mem-user',
                  role: 'user',
                  text: `（※記憶の引き継ぎ：\n${text.trim()}\n）`,
                  timestamp: new Date()
              };

              const memoryAckMsg: Message = {
                  id: Date.now().toString() + '-mem-model',
                  role: 'model',
                  text: `（※伊織は静かに目を閉じ、その記憶を深く心に刻み込んだ）`,
                  timestamp: new Date()
              };

              const newMessages = [...messages, memoryInjectMsg, memoryAckMsg];
              setMessages(newMessages);
              geminiService.initializeChat(newMessages);
              setError(null);
          } catch (error) {
              console.error("Failed to inject memory", error);
              setError("記憶の追加中にエラーが発生しました。");
          }
      };
      reader.readAsText(file);
      e.target.value = '';
  };

return (
    <div className="relative w-full h-screen overflow-hidden bg-[#f4f1ea] font-serif">
      
      <div className="absolute inset-0 z-0 bg-[url('https://www.transparenttextures.com/patterns/washi.png')] opacity-40"></div>
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#fdfbf7] via-[#f4f1ea] to-[#e6e5e1] opacity-90"></div>
      <div className="absolute top-10 left-10 w-64 h-64 bg-[#a1887f] rounded-full blur-[120px] opacity-10"></div>

      <div className="absolute inset-0 z-10 flex flex-col justify-end">
        <div className="flex-1 hidden md:flex items-center justify-center opacity-10 select-none pointer-events-none">
            <span className="text-[12rem] font-serif text-[#3e2723] tracking-widest writing-vertical-rl">葛城伊織</span>
        </div>

        <div className="w-full max-w-4xl mx-auto mb-0 md:mb-8 flex flex-col h-[75vh] md:h-[65vh]">
            
            {/* Header / Utility Buttons */}
            <div className="flex justify-end gap-2 p-2 bg-white/50 backdrop-blur-sm rounded-t-xl border-b border-[#d7ccc8]">
                <button onClick={handleDownloadHistory} className="text-xs px-3 py-1 bg-[#8d6e63] text-white rounded hover:bg-[#795548] transition-colors">
                    履歴保存
                </button>
                <button onClick={() => historyFileInputRef.current?.click()} className="text-xs px-3 py-1 bg-[#a1887f] text-white rounded hover:bg-[#8d6e63] transition-colors">
                    復元
                </button>
                <button onClick={() => memoryFileInputRef.current?.click()} className="text-xs px-3 py-1 bg-[#d7ccc8] text-[#3e2723] rounded hover:bg-[#bcaaa4] transition-colors">
                    記憶追加
                </button>
                <input type="file" ref={historyFileInputRef} onChange={handleHistoryFileChange} accept=".txt" className="hidden" />
                <input type="file" ref={memoryFileInputRef} onChange={handleMemoryFileChange} accept=".txt" className="hidden" />
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-2 text-sm">
                    {error}
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-white/40 backdrop-blur-sm border-x border-[#d7ccc8]">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl p-4 ${
                            msg.role === 'user' 
                            ? 'bg-[#8d6e63] text-white rounded-tr-sm' 
                            : 'bg-white text-[#3e2723] rounded-tl-sm shadow-sm border border-[#d7ccc8]'
                        }`}>
                            {msg.image && (
                                <img src={msg.image} alt="添付画像" className="max-w-full h-auto rounded-lg mb-2" />
                            )}
                            
                            {editingMessageId === msg.id ? (
                                <div className="flex flex-col gap-2">
                                    <textarea
                                        value={editText}
                                        onChange={(e) => setEditText(e.target.value)}
                                        className="w-full p-2 text-[#3e2723] bg-white rounded border border-[#d7ccc8] min-h-[60px]"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button onClick={handleCancelEdit} className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
                                        <button onClick={() => handleSaveEdit(msg.id)} className="text-xs px-2 py-1 bg-[#795548] text-white rounded hover:bg-[#5d4037]">保存して再送信</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="whitespace-pre-wrap leading-relaxed">
                                    {msg.text}
                                    {msg.role === 'user' && !msg.isStreaming && (
                                        <button onClick={() => handleStartEdit(msg)} className="ml-2 text-xs opacity-50 hover:opacity-100 underline">
                                            [編集]
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white text-[#3e2723] rounded-2xl rounded-tl-sm p-4 shadow-sm border border-[#d7ccc8] flex space-x-2">
                            <div className="w-2 h-2 bg-[#a1887f] rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-[#a1887f] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            <div className="w-2 h-2 bg-[#a1887f] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-[#f4f1ea] border border-[#d7ccc8] rounded-b-xl p-3 md:p-4 shadow-lg relative">
                {selectedImage && (
                    <div className="relative inline-block mb-3">
                        <img src={selectedImage} alt="Preview" className="h-20 rounded border border-[#d7ccc8]" />
                        <button onClick={clearImage} className="absolute -top-2 -right-2 bg-[#3e2723] text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-800">
                            ×
                        </button>
                    </div>
                )}
                <div className="flex items-end gap-2">
                    <button 
                        onClick={() => fileInputRef.current?.click()} 
                        className="p-2 text-[#8d6e63] hover:bg-[#efebe9] rounded-full transition-colors flex-shrink-0" 
                        disabled={isLoading}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" className="hidden" />
                    
                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                            }
                        }}
                        placeholder="伊織に話しかける..."
                        className="flex-1 max-h-32 p-3 bg-white border border-[#d7ccc8] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8d6e63] resize-none text-[#3e2723] placeholder-[#a1887f]"
                        rows={1}
                        disabled={isLoading}
                    />
                    
                    <button 
                        onClick={handleSendMessage}
                        disabled={(!inputText.trim() && !selectedImage) || isLoading}
                        className="p-3 bg-[#8d6e63] text-white rounded-xl hover:bg-[#795548] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                    </button>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
