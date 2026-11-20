import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, LifeBuoy, Loader2, RefreshCw, Send, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { supportService } from '../../api/support.service';
import { useI18n } from '../../i18n';

const errorMessage = (error, fallback) => (
  typeof error.response?.data === 'string'
    ? error.response.data
    : error.response?.data?.error || fallback
);

export default function AdminSupportInbox() {
  const { t } = useI18n();
  const [tickets, setTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messageRequestRef = useRef(0);

  const refreshTickets = useCallback(async () => {
    try {
      const data = await supportService.listAdminTickets();
      if (!Array.isArray(data)) throw new Error(t('adminUiInvalidSupportQueue'));
      setTickets(data);
    } catch (error) {
      toast.error(errorMessage(error, t('adminUiLoadSupportQueueError')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const loadMessages = useCallback(async (ticketId) => {
    if (!ticketId) return;
    const requestId = ++messageRequestRef.current;
    setIsLoadingMessages(true);
    try {
      const data = await supportService.getAdminMessages(ticketId);
      if (requestId !== messageRequestRef.current) return;
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      if (data.ticket) setActiveTicket(data.ticket);
    } catch (error) {
      if (requestId === messageRequestRef.current) {
        toast.error(errorMessage(error, t('adminUiLoadConversationError')));
      }
    } finally {
      if (requestId === messageRequestRef.current) setIsLoadingMessages(false);
    }
  }, [t]);

  useEffect(() => {
    refreshTickets();
  }, [refreshTickets]);

  useEffect(() => {
    if (!activeTicket?.id) return undefined;
    loadMessages(activeTicket.id);
    const timer = window.setInterval(() => loadMessages(activeTicket.id), 15000);
    return () => {
      window.clearInterval(timer);
      messageRequestRef.current += 1;
    };
  }, [activeTicket?.id, loadMessages]);

  const handleReply = async (event) => {
    event.preventDefault();
    if (!activeTicket?.id || !reply.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const message = await supportService.sendAdminMessage(activeTicket.id, reply.trim());
      setMessages((current) => [...current, message]);
      setReply('');
      await refreshTickets();
      await loadMessages(activeTicket.id);
    } catch (error) {
      toast.error(errorMessage(error, t('adminUiSendSupportReplyError')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (status) => {
    if (!activeTicket?.id || isSubmitting || status === activeTicket.status) return;
    setIsSubmitting(true);
    try {
      await supportService.updateAdminTicket(activeTicket.id, status);
      setActiveTicket((current) => current ? { ...current, status } : current);
      await refreshTickets();
      toast.success(t('adminUiTicketMarked', { status: t(`adminUiTicketStatus${status.replace(/(^|_)([a-z])/g, (_, separator, letter) => letter.toUpperCase())}`) }));
    } catch (error) {
      toast.error(errorMessage(error, t('adminUiUpdateTicketStatusError')));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-zinc-200">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-6 w-6 text-yellow-400" />
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-white">{t('adminUiSupportInbox')}</h1>
            <p className="text-xs text-zinc-500">{t('adminUiSupportInboxDescription')}</p>
          </div>
        </div>
        <button type="button" onClick={refreshTickets} className="flex items-center gap-2 border border-zinc-700 px-3 py-2 text-xs uppercase hover:border-yellow-400">
          <RefreshCw className="h-4 w-4" /> {t('adminUiRefresh')}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(15rem,22rem)_1fr]">
        <aside className="min-h-0 overflow-y-auto border-b border-zinc-800 md:border-b-0 md:border-r">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-yellow-400" /></div>
          ) : tickets.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">{t('adminUiNoWaitingSupportTickets')}</p>
          ) : tickets.map((ticket) => (
            <button type="button" key={ticket.id} onClick={() => setActiveTicket(ticket)} className={`w-full border-b border-zinc-800 p-3 text-left hover:bg-zinc-900 ${activeTicket?.id === ticket.id ? 'bg-zinc-900' : ''}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-white">{ticket.subject}</span>
                <span className={`shrink-0 text-[9px] uppercase ${ticket.human_requested ? 'text-amber-400' : 'text-zinc-500'}`}>{ticket.human_requested ? t('adminUiHumanRequested') : t(`adminUiTicketStatus${ticket.status.replace(/(^|_)([a-z])/g, (_, separator, letter) => letter.toUpperCase())}`)}</span>
              </span>
              <span className="mt-1 block text-xs text-zinc-500">{ticket.user_name} · {ticket.priority}</span>
              <span className="mt-1 block truncate text-xs text-zinc-600">{ticket.last_message}</span>
            </button>
          ))}
        </aside>

        <section className="flex min-h-0 flex-col">
          {!activeTicket ? (
            <div className="flex flex-1 items-center justify-center p-6 text-zinc-500">{t('adminUiSelectTicket')}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 p-4">
                <div>
                  <h2 className="font-black text-white">{activeTicket.subject}</h2>
                  <p className="text-xs text-zinc-500">{activeTicket.user_name} · {activeTicket.category} · {activeTicket.priority}</p>
                </div>
                <label className="flex items-center gap-2 text-xs uppercase text-zinc-500">
                  {t('adminUiStatus')}
                  <select value={activeTicket.status} disabled={isSubmitting} onChange={(event) => handleStatusChange(event.target.value)} className="border border-zinc-700 bg-black px-2 py-2 text-xs text-white">
                    <option value="open">{t('adminUiTicketStatusOpen')}</option>
                    <option value="waiting_human">{t('adminUiTicketStatusWaitingHuman')}</option>
                    <option value="in_progress">{t('adminUiTicketStatusInProgress')}</option>
                    <option value="resolved">{t('adminUiTicketStatusResolved')}</option>
                  </select>
                </label>
              </div>
              {activeTicket.ai_summary && (
                <aside className="border-b border-yellow-900 bg-yellow-950/20 px-4 py-3">
                  <p className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-yellow-400"><Bot className="h-4 w-4" /> {t('adminUiAiSummaryHumanReview')}</p>
                  <p className="whitespace-pre-wrap text-sm text-zinc-300">{activeTicket.ai_summary}</p>
                </aside>
              )}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {isLoadingMessages ? (
                  <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-yellow-400" /></div>
                ) : messages.map((message) => (
                  <article key={message.id} className={`chat-bubble ${message.sender_type === 'system' ? 'chat-bubble--system' : message.sender_type === 'admin' ? 'chat-bubble--mine' : 'chat-bubble--other'} max-w-3xl border p-3 ${message.sender_type === 'admin' ? 'ml-auto border-yellow-900 bg-yellow-950/20' : 'border-zinc-800 bg-zinc-950'}`}>
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      {message.sender_type === 'user' ? <UserRound className="h-3.5 w-3.5" /> : message.sender_type === 'system' ? <LifeBuoy className="h-3.5 w-3.5 text-zinc-400" /> : <Bot className="h-3.5 w-3.5 text-yellow-400" />}
                      {message.sender_type === 'user' ? activeTicket.user_name || t('adminUiUser') : message.sender_type === 'system' ? t('adminUiSupportUpdate') : message.sender_type === 'assistant' ? 'Chattie AI' : t('adminUiSupportAgent')}
                      {message.sender_type === 'assistant' && <span className="text-yellow-500">AI</span>}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-zinc-200">{message.content}</p>
                  </article>
                ))}
              </div>
              <form onSubmit={handleReply} className="flex gap-2 border-t border-zinc-800 p-3">
                <label className="sr-only" htmlFor="admin-support-reply">{t('adminUiWriteReply')}</label>
                <textarea id="admin-support-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={10000} rows={2} disabled={activeTicket.status === 'resolved'} placeholder={activeTicket.status === 'resolved' ? t('adminUiTicketResolved') : t('adminUiReplyAsHumanAgent')} className="min-w-0 flex-1 resize-y border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-yellow-400 disabled:opacity-50" />
                <button type="submit" disabled={isSubmitting || !reply.trim() || activeTicket.status === 'resolved'} aria-label={t('adminUiSendAgentReply')} className="self-end border border-yellow-500 bg-yellow-500 p-3 text-black disabled:opacity-50">
                  {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
