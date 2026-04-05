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
  
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyFileInputRef = useRef<HTMLInputElement>(null); 
  const memoryFileInputRef = useRef<HTMLInputElement>(null); 

  // ★修正箇所：スクロールの挙動を指定できるように変更
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // ★修正箇所：描画が完了するのをわずかに待ってから一番下へジャンプ
  useEffect(() => {
    if (!editingMessageId && messages.length > 0) {
      const timer = setTimeout(() => {
        scrollToBottom('auto'); // 'auto' で瞬時に移動
      }, 100); 
      return () => clearTimeout(timer);
    }
  }, [messages, editingMessageId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
    }
  }, [inputText]);

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
      geminiService.initializeChat();
      setMessages([{
          id: 'init-1',
          role: 'model',
          text: '（書斎の文机に向かっていたが、お前の気配を感じてふと顔を上げ、丸眼鏡の奥の瞳を細める）\n\n……おや。起きたのかい？\n……ふふ。おはよう。',
          timestamp: new Date()
      }]);
  };

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
              setError("履歴の保存容量が一杯です。");
          }
      }
  }, [messages]);

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
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
          } else {
            if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
          }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas context error')); return; }
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
        setError("画像の処理に失敗しました。");
        setSelectedImage(null);
    } finally {
        setIsLoading(false);
        e.target.value = '';
    }
  };

  const clearImage = () => setSelectedImage(null);

  const processStreamResponse = async (stream: AsyncIterable<string>) => {
      const responseId = (Date.now() + 1).toString();
      let fullResponseText = '';
      setMessages((prev) => [...prev, { id: responseId, role: 'model', text: '', timestamp: new Date(), isStreaming: true }]);
      for await (const chunk of stream) {
        fullResponseText += chunk;
        setMessages((prev) => prev.map((msg) => msg.id === responseId ? { ...msg, text: fullResponseText } : msg));
      }
      setMessages((prev) => prev.map((msg) => msg.id === responseId ? { ...msg, isStreaming: false } : msg));
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isLoading) return;
    if (!geminiService.hasApiKey()) { setError("APIキーが設定されていません。"); return; }
    setError(null);
    const userMessageText = inputText;
    const userImage = selectedImage;
    setInputText('');
    setSelectedImage(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const userMessage: Message = { id: Date.now().toString(), role: 'user', text: userMessageText, image: userImage || undefined, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    try {
      await geminiService.initializeChat([...messages, userMessage]);
      const stream = await geminiService.sendMessageStream(userMessageText, userImage || undefined);
      await processStreamResponse(stream);
    } catch (error) {
      setError("送信に失敗しました。");
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'model', text: '……すまない。少し考え事をしていたようだ。', timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEdit = (message: Message) => { setEditingMessageId(message.id); setEditText(message.text); setError(null); };
  const handleCancelEdit = () => { setEditingMessageId(null); setEditText(''); };

  const handleSaveEdit = async (messageId: string) => {
      if (!editText.trim() || isLoading) return;
      const index = messages.findIndex(m => m.id === messageId);
      if (index === -1) return;
      const historyMessages = messages.slice(0, index);
      const updatedMessage: Message = { ...messages[index], text: editText, timestamp: new Date() };
      setMessages([...historyMessages, updatedMessage]);
      setEditingMessageId(null);
      setIsLoading(true);
      try {
          await geminiService.initializeChat([...historyMessages, updatedMessage]);
          const stream = await geminiService.sendMessageStream(updatedMessage.text, updatedMessage.image);
          await processStreamResponse(stream);
      } catch (error) {
          setError("送信に失敗しました。");
      } finally { setIsLoading(false); }
  };

  const handleDownloadHistory = () => {
    if (messages.length === 0) return;
    const textContent = messages.map(msg => {
      const dateStr = msg.timestamp.toLocaleString('ja-JP');
      const speaker = msg.role === 'model' ? '葛城 伊織' : '私';
      return `[${dateStr}] ${speaker}:\n${msg.text}${msg.image ? '\n（画像を送信しました）' : ''}`;
    }).join('\n\n----------------------------------------\n\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `伊織との思い出_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleHistoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (messages.length > 1 && !window.confirm("履歴を上書きしますか？")) { e.target.value = ''; return; }
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
                  const header = chunk.substring(0, firstNewLineIndex);
                  const body = chunk.substring(firstNewLineIndex + 1);
                  const headerMatch = header.match(/^\[(.*?)\] (.*?):$/);
                  if (headerMatch) {
                      parsedMessages.push({ id: Date.now().toString() + Math.random().toString(36).substr(2, 9), role: headerMatch[2] === '私' ? 'user' : 'model', text: body.trim(), timestamp: new Date(headerMatch[1]) });
                  }
              }
              if (parsedMessages.length > 0) {
                  setMessages(parsedMessages);
                  geminiService.resetChat(parsedMessages);
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsedMessages));
              }
          } catch (e) { setError("読み込みに失敗しました。"); }
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
          const memoryInjectMsg: Message = { id: Date.now().toString() + '-mem-user', role: 'user', text: `（※記憶の引き継ぎ：\n${text.trim()}\n）`, timestamp: new Date() };
          const memoryAckMsg: Message = { id: Date.now().toString() + '-mem-model', role: 'model', text: `（※伊織は静かに目を閉じ、その記憶を深く心に刻み込んだ）`, timestamp: new Date() };
          setMessages(prev => {
              const newMessages = [...prev, memoryInjectMsg, memoryAckMsg];
              geminiService.initializeChat(newMessages);
              return newMessages;
          });
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
        <div className="w-full max-w-4xl mx-auto mb-0 md:mb-8 flex flex-col h-[92vh] md:h-[92vh] pt-12">
            
            <div className="flex justify-end px-6 md:px-12 mb-2 gap-4">
                 <input type="file" accept=".txt" ref={memoryFileInputRef} onChange={handleMemoryFileChange} className="hidden" />
                 <button onClick={() => memoryFileInputRef.current?.click()} className="text-[#8e354a] hover:text-[#5d4037] text-xs md:text-sm font-serif font-bold flex items-center gap-1 opacity-90">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    <span>思い出を追記</span>
                 </button>
                 <input type="file" accept=".txt" ref={historyFileInputRef} onChange={handleHistoryFileChange} className="hidden" />
                 <button onClick={() => historyFileInputRef.current?.click()} className="text-[#8d6e63] hover:text-[#5d4037] text-xs md:text-sm font-serif flex items-center gap-1 opacity-80">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                    <span>履歴を復元</span>
                 </button>
                 <button onClick={handleDownloadHistory} className="text-[#8d6e63] hover:text-[#5d4037] text-xs md:text-sm font-serif flex items-center gap-1 opacity-80">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                    <span>履歴を保存</span>
                 </button>
            </div>

            {/* ★修正箇所: 瞬時に移動させるため scroll-smooth を削除しました */}
            <div className="flex-1 overflow-y-auto px-6 md:px-12 py-6 mask-image-fade-top bg-[#d7ccc8]/30 backdrop-blur-sm md:rounded-t-xl border-t border-[#bcaaa4]/30 shadow-inner">
                <div className="h-4"></div>
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col group animate-fade-in ${msg.role === 'model' ? 'items-start' : 'items-end'} border-b border-stone-500/20 pb-8 mb-8 last:border-0 last:pb-0 last:mb-0`}>
                        <div className={`text-xs mb-2 tracking-widest font-bold ${msg.role === 'model' ? 'text-[#5d4037] ml-1' : 'text-[#8d6e63] mr-1'}`}>{msg.role === 'model' ? '葛城 伊織' : '私'}</div>
                        {msg.image && ( <div className={`mb-2 max-w-[60%] md:max-w-[40%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}><img src={msg.image} alt="uploaded content" className="rounded-lg shadow-md border-4 border-white/50 object-cover" /></div> )}
                        {editingMessageId === msg.id ? (
                            <div className="w-full max-w-[90%] md:max-w-[80%] flex flex-col gap-2 bg-[#fdfbf7] p-3 rounded-xl border border-[#8e354a] shadow-lg">
                                <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full bg-transparent border-none outline-none font-sans text-[#5d4037] text-base resize-none" rows={3} />
                                <div className="flex justify-end gap-2"><button onClick={handleCancelEdit} className="text-xs text-stone-400 hover:text-stone-600 px-2 py-1">キャンセル</button><button onClick={() => handleSaveEdit(msg.id)} className="bg-[#8e354a] text-white text-xs px-3 py-1 rounded-full hover:bg-[#5d4037] transition-colors flex items-center gap-1"><span>再送信</span></button></div>
                            </div>
                        ) : (
                            <div className="relative group/bubble max-w-[95%] md:max-w-[85%]">
                                <div className={`leading-loose tracking-wide whitespace-pre-wrap ${msg.role === 'model' ? 'text-[#3e2723] font-serif drop-shadow-none text-left text-sm md:text-lg' : 'text-[#5d4037] font-sans text-sm md:text-lg italic text-right opacity-90'}`}>{msg.text}</div>
                                {msg.role === 'user' && !isLoading && !msg.text.includes('（※記憶') && (
                                    <button onClick={() => handleStartEdit(msg)} className="absolute -left-8 top-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity text-[#a1887f] hover:text-[#8e354a]">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" /></svg>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === 'user' && ( <div className="text-[#8d6e63] text-sm font-serif animate-pulse pl-2">……（伊織が言葉を選んでいる）</div> )}
                <div ref={messagesEndRef} />
            </div>

            <div className="px-4 md:px-12 py-6 bg-gradient-to-t from-[#d7ccc8]/40 to-[#d7ccc8]/20 backdrop-blur-md md:rounded-b-xl">
                {error && ( <div className="mb-2 px-4 py-2 bg-red-100/80 border border-red-300 rounded-lg text-red-800 text-sm flex items-center gap-2 animate-fade-in mx-auto max-w-3xl"><span>{error}</span><button onClick={() => setError(null)} className="ml-auto text-red-600">×</button></div> )}
                {selectedImage && ( <div className="flex justify-center mb-3 animate-fade-in"><div className="relative inline-block"><img src={selectedImage} alt="preview" className="h-24 w-auto rounded-md border-2 border-[#8e354a]/30 shadow-sm"/><button onClick={clearImage} className="absolute -top-2 -right-2 bg-[#8e354a] text-white rounded-full p-1 shadow hover:bg-[#5d4037]">×</button></div></div> )}
                <div className="relative group max-w-3xl mx-auto">
                    <div className="absolute -inset-1 bg-[#ffffff]/60 rounded-xl blur opacity-40 group-hover:opacity-70 transition duration-1000"></div>
                    <div className="relative flex items-end gap-2 bg-[#fdfbf7] p-4 rounded-xl shadow-lg border border-[#d7ccc8]">
                        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} className="hidden" />
                        <button onClick={() => fileInputRef.current?.click()} disabled={isLoading} className={`p-2 mb-1 rounded-full transition-all ${isLoading ? 'text-stone-300' : 'text-[#8d6e63] hover:text-[#5d4037] hover:bg-[#efebe9]'}`} title="写真を見せる"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" /></svg></button>
                        <textarea ref={textareaRef} value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="伊織さんに言葉を伝える..." className="w-full bg-transparent border-none focus:ring-0 resize-none max-h-32 text-[#3e2723] font-sans placeholder-[#a1887f] outline-none text-base" rows={1} disabled={isLoading} />
                        <button onClick={handleSendMessage} disabled={(!inputText.trim() && !selectedImage) || isLoading} className={`p-2 mb-1 rounded-full transition-all duration-300 ${(!inputText.trim() && !selectedImage) || isLoading ? 'text-[#d7ccc8]' : 'text-[#8e354a] hover:text-[#5d4037] hover:bg-[#efebe9] transform hover:scale-110'}`} title="送信"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 rotate-[-45deg]"><path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32L19.513 8.2Z" /></svg></button>
                    </div>
                </div>
            </div>
        </div>
      </div>
      <style>{`
        .mask-image-fade-top { mask-image: linear-gradient(to bottom, transparent, black 5%); -webkit-mask-image: linear-gradient(to bottom, transparent, black 5%); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default ChatInterface;
