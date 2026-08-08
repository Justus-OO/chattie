import React from 'react';
import { Sparkles, MoreVertical, Image, Gift, Smile, Send } from 'lucide-react';

export default function ChatArea({ 
  selectedRoom, 
  messages, 
  messageInput, 
  setMessageInput, 
  handleSendMessage 
}) {
  return (
    <main className="flex-1 flex flex-col bg-slate-950">
      <header className="p-4 border-b border-slate-800 bg-slate-900/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{selectedRoom.icon}</span>
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              {selectedRoom.name}
              <span className="px-2 py-0.5 text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full">Hot Lounge</span>
            </h2>
            <p className="text-xs text-slate-400">Public Texting Room • Moderated • 18+</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white font-semibold text-xs rounded-lg shadow-lg shadow-rose-500/10 flex items-center gap-1.5 transition-all">
            <Sparkles className="w-3.5 h-3.5" /> Send Super Like
          </button>
          <button className="p-2 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 hover:bg-slate-900">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-slate-950 to-slate-950">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}>
            <div className="flex items-center gap-2 mb-1">
              {!msg.isMe && (
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  {msg.sender}
                  {msg.badge && (
                    <span className="text-[9px] px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded font-mono">
                      {msg.badge}
                    </span>
                  )}
                </span>
              )}
              <span className="text-[10px] text-slate-500">{msg.time}</span>
            </div>
            <div className={`max-w-md px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                msg.isMe 
                  ? 'bg-gradient-to-r from-rose-600 to-violet-600 text-white rounded-tr-none' 
                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
              }`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-900/40">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-slate-400 px-2">
            <button type="button" className="p-2 hover:text-rose-400 transition-colors"><Image className="w-5 h-5" /></button>
            <button type="button" className="p-2 hover:text-amber-400 transition-colors"><Gift className="w-5 h-5" /></button>
            <button type="button" className="p-2 hover:text-indigo-400 transition-colors"><Smile className="w-5 h-5" /></button>
          </div>
          
          <input 
            type="text" 
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder="Type your spicy message or flirt here..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-rose-500/50 text-slate-100 placeholder:text-slate-600"
          />
          
          <button type="submit" className="px-5 py-3 bg-gradient-to-r from-rose-500 to-violet-600 hover:from-rose-600 hover:to-violet-700 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/20 flex items-center gap-2 text-sm transition-all">
            <span>Send</span>
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </main>
  );
}