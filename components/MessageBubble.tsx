import React from 'react';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isModel = message.role === 'model';

  return (
    <div className={`flex w-full mb-6 ${isModel ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] md:max-w-[70%] flex flex-col ${isModel ? 'items-start' : 'items-end'}`}>
        
        {/* Name Label */}
        <span className={`text-xs mb-1 opacity-70 ${isModel ? 'text-iori-indigo ml-2' : 'text-iori-accent mr-2'}`}>
          {isModel ? '葛城 伊織' : '私'}
        </span>

        {/* Bubble */}
        <div
          className={`
            relative p-5 rounded-2xl shadow-md text-sm md:text-base leading-loose whitespace-pre-wrap
            ${isModel 
              ? 'bg-iori-indigo text-iori-paper font-serif rounded-tl-none border border-slate-600' 
              : 'bg-white text-slate-800 font-sans rounded-tr-none border border-stone-200'
            }
          `}
        >
          {message.text}
          
          {/* Decorative corner for Iori */}
          {isModel && (
             <div className="absolute top-0 left-0 -mt-2 -ml-2 w-4 h-4 border-t border-l border-iori-indigo opacity-50"></div>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-stone-500 mt-1 px-1">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
};

export default MessageBubble;
