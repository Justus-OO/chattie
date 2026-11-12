import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Sparkles, MoreVertical, Image as ImageIcon, Gift, Smile, Send, 
  Paperclip, Mic, Reply, Copy, CheckCircle2, ChevronDown, X, 
  Info, BellOff, ShieldAlert, Heart
} from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ChatArea({ 
  selectedRoom, 
  messages, 
  messageInput, 
  setMessageInput, 
  handleSendMessage 
}) {
  const { t } = useI18n();
  // --- STATE ---
  const [replyingTo, setReplyingTo] = useState(null);
  const [stagedFiles, setStagedFiles] = useState([]);
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // --- REFS ---
  const feedRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // ============================================================================
  // EFFECTS & SCROLL LOGIC
  // ============================================================================
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, stagedFiles]);

  // Detect manual scroll to show "Jump to bottom" button
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    // Show button if we are scrolled up more than 100px from bottom
    if (scrollHeight - scrollTop - clientHeight > 100) {
      setShowScrollButton(true);
    } else {
      setShowScrollButton(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ============================================================================
  // MESSAGE PROCESSING (Grouping)
  // ============================================================================
  const groupedMessages = useMemo(() => {
    return messages.reduce((acc, curr, i) => {
      const prev = messages[i - 1];
      // Group if same sender AND time difference is negligible (simplified here to just sender match)
      if (prev && prev.sender === curr.sender && prev.isMe === curr.isMe) {
        acc[acc.length - 1].msgs.push(curr);
      } else {
        acc.push({ 
          sender: curr.sender, 
          isMe: curr.isMe, 
          badge: curr.badge, 
          msgs: [curr] 
        });
      }
      return acc;
    }, []);
  }, [messages]);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  
  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map(file => ({
        id: Date.now() + Math.random(),
        file,
        preview: URL.createObjectURL(file)
      }));
      setStagedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeStagedFile = (id) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleInputResize = (e) => {
    setMessageInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; // Max height 120px
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeSend(e);
    }
  };

  const executeSend = (e) => {
    e.preventDefault();
    if (!messageInput.trim() && stagedFiles.length === 0) return;
    
    // Pass the payload up (you can expand your parent handler to accept attachments/replies)
    handleSendMessage(e, { replyContext: replyingTo, attachments: stagedFiles });
    
    // Reset local staging state
    setReplyingTo(null);
    setStagedFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleAction = (action, msg) => {
    if (action === 'reply') {
      setReplyingTo(msg);
      textareaRef.current?.focus();
    } else if (action === 'copy') {
      navigator.clipboard.writeText(msg.text);
      toast.success(t('messageCopied'));
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <main className="flex-1 flex flex-col bg-slate-950 w-full h-full relative overflow-hidden font-sans">
      
      {/* =====================================================================
          HEADER
          ===================================================================== */}
      <header className="px-4 py-3 md:p-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-xl flex items-center justify-between shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center text-2xl shadow-inner shrink-0">
            {selectedRoom.icon}
          </div>
          <div className="flex flex-col overflow-hidden">
            <h2 className="text-sm md:text-base font-bold text-slate-100 flex items-center gap-2 truncate">
              {selectedRoom.name}
              {selectedRoom.name.toLowerCase().includes('hot') && (
                <span className="px-2 py-0.5 text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold uppercase tracking-wider shrink-0">
                  {t('hotLounge')}
                </span>
              )}
            </h2>
            <p className="text-[10px] md:text-xs text-slate-400 truncate">
              {t('publicTextRoom')} • {t('moderated')} • 18+
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0 relative">
          <button 
            onClick={() => toast.success(t('superLikeSent'))}
            className="hidden md:flex px-4 py-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:opacity-90 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-500/20 items-center gap-1.5 transition-all hover:scale-105"
          >
            <Sparkles className="w-4 h-4" /> {t('boostRoom')}
          </button>
          
          <button 
            onClick={() => setShowRoomMenu(!showRoomMenu)}
            className={`p-2 rounded-xl border transition-colors ${showRoomMenu ? 'bg-slate-800 border-slate-700 text-white' : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900'}`}
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {/* Room Context Menu */}
          {showRoomMenu && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-30 animate-in fade-in slide-in-from-top-2 duration-200">
              <button onClick={() => { setShowRoomMenu(false); toast(t('roomInfoOpened')); }} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2">
                <Info className="w-4 h-4" /> {t('roomInfo')}
              </button>
              <button onClick={() => { setShowRoomMenu(false); toast(t('roomMuted')); }} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2">
                <BellOff className="w-4 h-4" /> {t('muteRoom')}
              </button>
              <div className="h-px bg-slate-800 my-1" />
              <button onClick={() => { setShowRoomMenu(false); toast.error(t('roomReported')); }} className="w-full text-left px-4 py-3 text-sm text-rose-500 hover:bg-rose-500/10 transition-colors flex items-center gap-2 font-semibold">
                <ShieldAlert className="w-4 h-4" /> {t('reportRoom')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* =====================================================================
          MESSAGE FEED
          ===================================================================== */}
      <div 
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6 custom-scrollbar bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-slate-950 to-slate-950"
      >
        <div className="text-center my-6">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-900/80 border border-slate-800 px-4 py-1.5 rounded-full shadow-sm backdrop-blur-md">
            {t('welcomeRoom')}
          </span>
        </div>

        {groupedMessages.map((group, groupIndex) => (
          <div key={groupIndex} className={`flex flex-col w-full ${group.isMe ? 'items-end' : 'items-start'}`}>
            
            {/* Sender Info (Only show above the group block if it's not 'Me') */}
            {!group.isMe && (
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="text-xs font-bold text-slate-300">{group.sender}</span>
                {group.badge && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-md font-mono font-bold uppercase">
                    {group.badge}
                  </span>
                )}
              </div>
            )}

            {/* Individual Bubbles in Group */}
            <div className={`flex flex-col gap-1 w-full max-w-[85%] md:max-w-[70%] ${group.isMe ? 'items-end' : 'items-start'}`}>
              {group.msgs.map((msg, msgIdx) => {
                const isFirst = msgIdx === 0;
                const isLast = msgIdx === group.msgs.length - 1;
                
                // Dynamic border radius for consecutive grouping
                let roundedClass = 'rounded-2xl';
                if (group.isMe) {
                  if (!isFirst && !isLast) roundedClass = 'rounded-2xl rounded-tr-sm rounded-br-sm';
                  else if (!isFirst) roundedClass = 'rounded-2xl rounded-tr-sm';
                  else if (!isLast) roundedClass = 'rounded-2xl rounded-br-sm';
                } else {
                  if (!isFirst && !isLast) roundedClass = 'rounded-2xl rounded-tl-sm rounded-bl-sm';
                  else if (!isFirst) roundedClass = 'rounded-2xl rounded-tl-sm';
                  else if (!isLast) roundedClass = 'rounded-2xl rounded-bl-sm';
                }

                return (
                  <div key={msg.id} className={`group/msg flex items-center gap-2 w-full ${group.isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    
                    {/* The Bubble */}
                    <div className={`relative px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-all
                      ${group.isMe 
                        ? 'bg-gradient-to-r from-rose-600 to-violet-600 text-white' 
                        : 'bg-slate-900 border border-slate-800 text-slate-200'
                      }
                      ${roundedClass}
                    `}>
                      {msg.text}
                    </div>

                    {/* Hover Actions Menu */}
                    <div className={`flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity
                      ${group.isMe ? 'flex-row-reverse' : 'flex-row'}
                    `}>
                      <button onClick={() => handleAction('reply', msg)} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors" title={t('reply')}>
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleAction('copy', msg)} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors" title={t('copy')}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Timestamp for the Group */}
            <div className={`flex items-center gap-1.5 mt-1.5 px-2 ${group.isMe ? 'justify-end' : 'justify-start'}`}>
              <span className="text-[10px] font-medium text-slate-500">
                {group.msgs[group.msgs.length - 1].time}
              </span>
              {group.isMe && (
                <CheckCircle2 className={`w-3.5 h-3.5 ${group.msgs[group.msgs.length - 1].status === 'read' ? 'text-emerald-500' : 'text-slate-600'}`} />
              )}
            </div>

          </div>
        ))}
        <div ref={messagesEndRef} className="h-2" />
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollButton && (
        <button 
          onClick={scrollToBottom}
          className="absolute bottom-28 right-6 w-10 h-10 bg-slate-800/90 backdrop-blur-md border border-slate-700 text-white rounded-full flex items-center justify-center shadow-2xl hover:bg-slate-700 transition-all animate-in slide-in-from-bottom-5 z-20"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}

      {/* =====================================================================
          INPUT AREA
          ===================================================================== */}
      <div className="p-3 md:p-4 bg-slate-950 border-t border-slate-800 shrink-0 relative z-20">
        
        {/* Reply Context Bar */}
        {replyingTo && (
          <div className="flex items-center justify-between bg-slate-900 border-t border-x border-slate-800 rounded-t-2xl px-4 py-2 mb-[-10px] pb-4">
            <div className="flex flex-col overflow-hidden">
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <Reply className="w-3 h-3" /> {t('replyingTo', { name: replyingTo.isMe ? t('yourself') : replyingTo.sender })}
              </span>
              <span className="text-xs text-slate-400 truncate">{replyingTo.text}</span>
            </div>
            <button onClick={() => setReplyingTo(null)} className="p-1 text-slate-500 hover:text-white rounded-full bg-slate-950 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Staged Files Previews */}
        {stagedFiles.length > 0 && (
          <div className="flex gap-2 overflow-x-auto custom-scrollbar bg-slate-900 border-t border-x border-slate-800 rounded-t-2xl px-4 py-3 mb-[-10px] pb-5">
            {stagedFiles.map(file => (
              <div key={file.id} className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden border border-slate-700">
                <img src={file.preview} alt={t('stagedImage')} className="w-full h-full object-cover" />
                <button 
                  onClick={() => removeStagedFile(file.id)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-rose-500 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form 
          onSubmit={executeSend} 
          className={`flex items-end gap-2 bg-slate-900 border transition-all shadow-lg p-1.5 md:p-2 relative z-10
            ${replyingTo || stagedFiles.length > 0 ? 'rounded-b-3xl rounded-t-none border-t-0 border-slate-700' : 'rounded-3xl border-slate-800 focus-within:border-rose-500/50'}
          `}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            multiple 
            accept="image/*" 
            className="hidden" 
          />
          
          <div className="flex items-center gap-1 pb-1 md:pb-1.5 px-1 md:px-2 shrink-0">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-full transition-colors">
              <Paperclip className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <button type="button" className="hidden sm:block p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-full transition-colors">
              <ImageIcon className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <button type="button" className="hidden lg:block p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-full transition-colors">
              <Gift className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          </div>
          
          <textarea 
            ref={textareaRef}
            value={messageInput}
            onChange={handleInputResize}
            onKeyDown={onKeyDown}
            placeholder={t('messagePlaceholder')}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none text-white text-sm md:text-base py-3 px-2 placeholder:text-slate-500 resize-none custom-scrollbar"
            style={{ minHeight: '44px' }}
          />
          
          <div className="flex items-center gap-1 pb-1 pr-1 shrink-0">
            {!messageInput.trim() && stagedFiles.length === 0 ? (
              <button type="button" className="p-2.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-full transition-colors">
                <Mic className="w-5 h-5" />
              </button>
            ) : (
              <button 
                type="submit" 
                className="p-2.5 md:px-5 md:py-3 bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 text-white font-bold rounded-full md:rounded-2xl shadow-lg shadow-rose-500/20 flex items-center justify-center gap-2 transition-all scale-in"
              >
                <span className="hidden md:inline text-sm">{t('send')}</span>
                <Send className="w-4 h-4 md:w-4 md:h-4" />
              </button>
            )}
          </div>
        </form>
      </div>

    </main>
  );
}