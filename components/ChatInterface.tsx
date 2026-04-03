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
            <div className="
