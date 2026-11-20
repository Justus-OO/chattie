import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, LifeBuoy, Loader2, MessageSquare, RefreshCw, Send, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { supportService } from '../api/support.service';
import { useI18n } from '../i18n';

const errorMessage = (error, fallback) => (
  typeof error.response?.data === 'string'
    ? error.response.data
    : error.response?.data?.error || fallback
);

export default function SupportPage() {
  const { t } = useI18n();
  const [tickets, setTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [subject, setSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [reply, setReply] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messageRequestRef = useRef(0);
  const messagesContainerRef = useRef(null);
  const messagesRef = useRef(messages);
  const shouldScrollToBottomRef = useRef(false);
  messagesRef.current = messages;

  const refreshTickets = useCallback(async () => {
    try {
      const data = await supportService.listTickets();
      if (!Array.isArray(data)) throw new Error('The server returned an invalid ticket list.');
      setTickets(data);
    } catch (error) {
      toast.error(errorMessage(error, t('supportLoadTicketsFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const refreshConversation = useCallback(async (ticketId) => {
    if (!ticketId) return;
    const requestId = ++messageRequestRef.current;
    setIsLoadingMessages(true);
    try {
      const data = await supportService.getMessages(ticketId);
      if (requestId !== messageRequestRef.current) return;
      const orderedMessages = sortSupportMessages(Array.isArray(data.messages) ? data.messages : []);
      const currentMessages = messagesRef.current;
      const previousLastId = currentMessages[currentMessages.length - 1]?.id;
      const nextLastId = orderedMessages[orderedMessages.length - 1]?.id;
      const container = messagesContainerRef.current;
      const isNearBottom = !container || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      if (nextLastId !== previousLastId && (isNearBottom || currentMessages.length === 0)) {
        shouldScrollToBottomRef.current = true;
      }
      setMessages(orderedMessages);
      if (data.ticket) setActiveTicket(data.ticket);
    } catch (error) {
      if (requestId === messageRequestRef.current) {
        toast.error(errorMessage(error, t('supportLoadConversationFailed')));
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
    shouldScrollToBottomRef.current = true;
    refreshConversation(activeTicket.id);
    const timer = window.setInterval(() => refreshConversation(activeTicket.id), 15000);
    return () => {
      window.clearInterval(timer);
      messageRequestRef.current += 1;
    };
  }, [activeTicket?.id, refreshConversation]);

  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!lastMessageId || !shouldScrollToBottomRef.current || isLoadingMessages) return;
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    shouldScrollToBottomRef.current = false;
  }, [lastMessageId, isLoadingMessages]);

  const handleCreateTicket = async (event) => {
    event.preventDefault();
    if (!subject.trim() || !newMessage.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await supportService.createTicket(subject.trim(), newMessage.trim());
      const ticket = result.ticket;
      if (!ticket?.id) throw new Error('The server did not return the created support ticket.');
      setSubject('');
      setNewMessage('');
      shouldScrollToBottomRef.current = true;
      setMessages(sortSupportMessages(Array.isArray(result.messages) ? result.messages : []));
      setActiveTicket(ticket);
      await refreshTickets();
      if (result.assistant_error) toast.warning(result.assistant_error);
      else toast.success(t('supportTicketCreated'));
    } catch (error) {
      toast.error(errorMessage(error, t('supportCreateFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendReply = async (event) => {
    event.preventDefault();
    if (!activeTicket?.id || !reply.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await supportService.sendMessage(activeTicket.id, reply.trim());
      setReply('');
      shouldScrollToBottomRef.current = true;
      setMessages(sortSupportMessages(Array.isArray(result.messages) ? result.messages : []));
      if (result.ticket) setActiveTicket(result.ticket);
      await refreshTickets();
      if (result.assistant_error) toast.warning(result.assistant_error);
    } catch (error) {
      toast.error(errorMessage(error, t('supportSendFailed')));
      await refreshConversation(activeTicket.id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHumanHandoff = async () => {
    if (!activeTicket?.id || isSubmitting || activeTicket.status === 'resolved') return;
    setIsSubmitting(true);
    try {
      const result = await supportService.requestHuman(activeTicket.id);
      setActiveTicket(result.ticket);
      shouldScrollToBottomRef.current = true;
      setMessages(sortSupportMessages(Array.isArray(result.messages) ? result.messages : []));
      await refreshTickets();
      toast.success(t('supportHumanRequestSent'));
    } catch (error) {
      toast.error(errorMessage(error, t('supportRequestHumanFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTicketStatus = async () => {
    if (!activeTicket?.id || isSubmitting) return;
    const status = activeTicket.status === 'resolved' ? 'open' : 'resolved';
    setIsSubmitting(true);
    try {
      const result = await supportService.updateTicketStatus(activeTicket.id, status);
      setActiveTicket(result.ticket);
      await refreshTickets();
      toast.success(t(status === 'resolved' ? 'supportTicketClosed' : 'supportTicketReopened'));
    } catch (error) {
      toast.error(errorMessage(error, t('supportUpdateStatusFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-zinc-200">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-6 w-6 text-yellow-400" />
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-white">{t('supportTitle')}</h1>
            <p className="text-xs text-zinc-500">{t('supportDescription')}</p>
          </div>
        </div>
        <button type="button" onClick={refreshTickets} className="flex items-center gap-2 border border-zinc-700 px-3 py-2 text-xs uppercase hover:border-yellow-400">
          <RefreshCw className="h-4 w-4" /> {t('refresh')}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(14rem,20rem)_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-zinc-800 md:border-b-0 md:border-r">
          <form onSubmit={handleCreateTicket} className="space-y-2 border-b border-zinc-800 p-3">
            <h2 className="text-xs font-black uppercase tracking-widest text-yellow-300">{t('supportNewTicket')}</h2>
            <label className="sr-only" htmlFor="support-subject">{t('supportSubject')}</label>
            <input id="support-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} placeholder={t('supportSubjectPlaceholder')} className="w-full border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-yellow-400" />
            <label className="sr-only" htmlFor="support-first-message">{t('supportMessage')}</label>
            <textarea id="support-first-message" value={newMessage} onChange={(event) => setNewMessage(event.target.value)} maxLength={10000} rows={3} placeholder={t('supportDescribeIssue')} className="w-full resize-y border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-yellow-400" />
            <button type="submit" disabled={isSubmitting || !subject.trim() || !newMessage.trim()} className="flex w-full items-center justify-center gap-2 border border-yellow-500 bg-yellow-500 px-3 py-2 text-xs font-black uppercase text-black disabled:opacity-50">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />} {t('supportCreateTicket')}
            </button>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-yellow-400" /></div>
            ) : tickets.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">{t('supportEmptyTickets')}</p>
            ) : tickets.map((ticket) => (
              <button type="button" key={ticket.id} onClick={() => setActiveTicket(ticket)} className={`w-full border-b border-zinc-800 p-3 text-left hover:bg-zinc-900 ${activeTicket?.id === ticket.id ? 'bg-zinc-900' : ''}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-white">{ticket.subject}</span>
                  <span className="shrink-0 text-[9px] uppercase text-yellow-400">{t(`supportStatus_${ticket.status}`)}</span>
                </span>
                <span className="mt-1 block truncate text-xs text-zinc-500">{ticket.last_message}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {!activeTicket ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-zinc-500">
              <LifeBuoy className="h-10 w-10" />
              <p>{t('supportSelectTicket')}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 p-4">
                <div>
                  <h2 className="font-black text-white">{activeTicket.subject}</h2>
                  <p className="text-xs uppercase text-zinc-500">{t(`supportStatus_${activeTicket.status}`)} · {t(`supportCategory_${activeTicket.category}`)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleTicketStatus} disabled={isSubmitting} className="border border-zinc-600 px-3 py-2 text-xs font-bold uppercase text-zinc-300 hover:border-white hover:text-white disabled:opacity-50">
                    {activeTicket.status === 'resolved' ? t('supportReopenTicket') : t('supportCloseTicket')}
                  </button>
                  <button type="button" onClick={handleHumanHandoff} disabled={isSubmitting || activeTicket.status === 'resolved' || activeTicket.human_requested} className="border border-zinc-600 px-3 py-2 text-xs font-bold uppercase text-zinc-300 hover:border-yellow-400 hover:text-white disabled:opacity-50">
                    {activeTicket.human_requested ? t('supportHumanRequested') : t('supportRequestHuman')}
                  </button>
                </div>
              </div>
              <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-[11px] text-zinc-400">
                {t('supportAiNotice')}
              </div>
              <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {isLoadingMessages && messages.length === 0 ? (
                  <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-yellow-400" /></div>
                ) : messages.map((message) => {
                  const isUser = message.sender_type === 'user';
                  const isAssistant = message.sender_type === 'assistant';
                  const isSystem = message.sender_type === 'system';
                  return (
                    <article key={message.id} className={`chat-bubble ${isSystem ? 'chat-bubble--system' : isUser ? 'chat-bubble--mine' : 'chat-bubble--other'} max-w-3xl border p-3 ${isUser ? 'ml-auto border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-950'}`}>
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        {isUser ? <UserRound className="h-3.5 w-3.5" /> : isSystem ? <LifeBuoy className="h-3.5 w-3.5 text-zinc-400" /> : <Bot className="h-3.5 w-3.5 text-yellow-400" />}
                        {isUser ? t('you') : isSystem ? t('supportUpdate') : isAssistant ? t('supportAi') : t('supportAgent')}
                        {isAssistant && <span className="text-yellow-500">AI</span>}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-zinc-200">{message.content}</p>
                    </article>
                  );
                })}
              </div>
              <form onSubmit={handleSendReply} className="flex gap-2 border-t border-zinc-800 p-3">
                <label className="sr-only" htmlFor="support-reply">{t('supportReplyLabel')}</label>
                <textarea id="support-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={10000} rows={2} disabled={activeTicket.status === 'resolved'} placeholder={activeTicket.status === 'resolved' ? t('supportTicketResolved') : t('supportWriteReply')} className="min-w-0 flex-1 resize-y border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-yellow-400 disabled:opacity-50" />
                <button type="submit" disabled={isSubmitting || !reply.trim() || activeTicket.status === 'resolved'} aria-label={t('send')} className="self-end border border-yellow-500 bg-yellow-500 p-3 text-black disabled:opacity-50">
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

function sortSupportMessages(messages) {
  return [...messages].sort((a, b) => {
    const timeDifference = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return timeDifference || String(a.id).localeCompare(String(b.id));
  });
}
