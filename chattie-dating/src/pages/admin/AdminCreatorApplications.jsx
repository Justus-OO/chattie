import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, ClipboardCheck, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

const errorMessage = (error, fallback) => (
  typeof error.response?.data === 'string'
    ? error.response.data
    : error.response?.data?.error || fallback
);

export default function AdminCreatorApplications() {
  const [applications, setApplications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await adminService.getCreatorApplications();
      if (!Array.isArray(data)) throw new Error('The server returned an invalid application list.');
      setApplications(data);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load creator applications.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const review = async (application, decision) => {
    if (processingId) return;
    if (decision === 'approve' && !application.eligible_for_approval) {
      toast.error('This application does not meet the age, identity, and consent requirements.');
      return;
    }
    const confirmed = window.confirm(
      `${decision === 'approve' ? 'Approve' : 'Reject'} creator application for ${application.creator_alias}?`
    );
    if (!confirmed) return;

    setProcessingId(application.id);
    try {
      await adminService.reviewCreatorApplication(application.id, decision);
      setApplications((current) => current.filter((item) => item.id !== application.id));
      toast.success(`Creator application ${decision === 'approve' ? 'approved' : 'rejected'}.`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not review the creator application.'));
      await refresh();
    } finally {
      setProcessingId('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-zinc-200">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-yellow-400" />
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-white">Creator applications</h1>
            <p className="text-xs text-zinc-500">AI summaries assist triage only. Every application decision is made by an admin.</p>
          </div>
        </div>
        <button type="button" onClick={refresh} className="flex items-center gap-2 border border-zinc-700 px-3 py-2 text-xs uppercase hover:border-yellow-400">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-yellow-400" /></div>
        ) : applications.length === 0 ? (
          <div className="border border-zinc-800 bg-zinc-950 p-8 text-center text-sm text-zinc-500">There are no pending creator applications.</div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            {applications.map((application) => (
              <article key={application.id} className="border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-black text-white">{application.creator_alias}</h2>
                    <p className="mt-1 text-xs text-zinc-500">{application.username} · {application.email}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">
                      Submitted {new Date(application.submitted_at).toLocaleString()} · Policy {application.policy_version}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 border px-2 py-1 text-[10px] font-black uppercase ${application.eligible_for_approval ? 'border-green-900 text-green-400' : 'border-amber-900 text-amber-400'}`}>
                    {application.eligible_for_approval ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    {application.eligible_for_approval ? 'Requirements met' : 'Requirements incomplete'}
                  </span>
                </div>

                <div className="mt-4 border border-yellow-900/70 bg-yellow-950/20 p-3">
                  <h3 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-yellow-400">
                    <Bot className="h-4 w-4" /> AI triage summary · advisory only
                  </h3>
                  <p className="whitespace-pre-wrap text-sm text-zinc-300">
                    {application.ai_triage_summary || 'Summary is pending. Review the application details and verification records directly.'}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => review(application, 'reject')} disabled={Boolean(processingId)} className="flex items-center gap-2 border border-red-900 px-4 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-950 disabled:opacity-50">
                    {processingId === application.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                  </button>
                  <button type="button" onClick={() => review(application, 'approve')} disabled={Boolean(processingId) || !application.eligible_for_approval} title={!application.eligible_for_approval ? 'Age verification, identity verification, and all required consents must be complete.' : undefined} className="flex items-center gap-2 border border-green-800 bg-green-900/30 px-4 py-2 text-xs font-black uppercase text-green-300 hover:bg-green-900/60 disabled:cursor-not-allowed disabled:opacity-40">
                    {processingId === application.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
