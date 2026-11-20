import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, ClipboardCheck, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';
import { useI18n } from '../../i18n';

const errorMessage = (error, fallback) => (
  typeof error.response?.data === 'string'
    ? error.response.data
    : error.response?.data?.error || fallback
);

export default function AdminCreatorApplications() {
  const { t } = useI18n();
  const [applications, setApplications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await adminService.getCreatorApplications();
      if (!Array.isArray(data)) throw new Error(t('adminUiInvalidApplicationList'));
      setApplications(data);
    } catch (error) {
      toast.error(errorMessage(error, t('adminUiLoadCreatorApplicationsError')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const review = async (application, decision) => {
    if (processingId) return;
    if (decision === 'approve' && !application.eligible_for_approval) {
      toast.error(application.has_existing_approval
        ? t('adminUiExistingCreatorApproval')
        : t('adminUiCreatorRequirementsNotMet'));
      return;
    }
    const confirmed = window.confirm(
      t('adminUiReviewCreatorApplicationConfirm', {
        decision: decision === 'approve' ? t('adminUiApprove') : t('adminUiReject'),
        creator: application.creator_alias,
      })
    );
    if (!confirmed) return;

    setProcessingId(application.id);
    try {
      await adminService.reviewCreatorApplication(application.id, decision);
      setApplications((current) => current.filter((item) => item.id !== application.id));
      toast.success(t('adminUiCreatorApplicationReviewed', {
        decision: decision === 'approve' ? t('adminUiApproved') : t('adminUiRejected'),
      }));
    } catch (error) {
      toast.error(errorMessage(error, t('adminUiReviewCreatorApplicationError')));
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
            <h1 className="text-lg font-black uppercase tracking-widest text-white">{t('adminUiCreatorApplications')}</h1>
            <p className="text-xs text-zinc-500">{t('adminUiCreatorApplicationsNotice')}</p>
          </div>
        </div>
        <button type="button" onClick={refresh} className="flex items-center gap-2 border border-zinc-700 px-3 py-2 text-xs uppercase hover:border-yellow-400">
          <RefreshCw className="h-4 w-4" /> {t('adminUiRefresh')}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-yellow-400" /></div>
        ) : applications.length === 0 ? (
          <div className="border border-zinc-800 bg-zinc-950 p-8 text-center text-sm text-zinc-500">{t('adminUiNoPendingCreatorApplications')}</div>
        ) : (
          <div className="w-full space-y-0">
            {applications.map((application) => (
              <article key={application.id} className="w-full border-b border-zinc-800 bg-zinc-950 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-black text-white">{application.creator_alias}</h2>
                    <p className="mt-1 text-xs text-zinc-500">{application.username} · {application.email}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">
                      {t('adminUiSubmitted')} {new Date(application.submitted_at).toLocaleString()} · {t('adminUiPolicy')} {application.policy_version}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 border px-2 py-1 text-[10px] font-black uppercase ${application.eligible_for_approval ? 'border-green-900 text-green-400' : 'border-amber-900 text-amber-400'}`}>
                    {application.eligible_for_approval ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    {application.has_existing_approval
                      ? t('adminUiAlreadyApproved')
                      : application.eligible_for_approval ? t('adminUiRequirementsMet') : t('adminUiRequirementsIncomplete')}
                  </span>
                </div>

                {application.has_existing_approval && (
                  <p className="mt-3 border border-blue-900/70 bg-blue-950/20 p-3 text-xs text-blue-200">
                    {t('adminUiDuplicateCreatorApplication')}
                  </p>
                )}

                <div className="mt-4 border border-yellow-900/70 bg-yellow-950/20 p-3">
                  <h3 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-yellow-400">
                    <Bot className="h-4 w-4" /> {t('adminUiAiTriageAdvisory')}
                  </h3>
                  <p className="whitespace-pre-wrap text-sm text-zinc-300">
                    {application.ai_triage_summary || t('adminUiCreatorSummaryPending')}
                  </p>
                </div>

                <div className="mt-4 grid gap-2 border border-zinc-800 bg-black p-3 sm:grid-cols-2">
                  {[
                    [t('adminUiIdentityVerified'), application.identity_verified],
                    [t('adminUiAgeVerified'), application.age_verified],
                    [t('adminUiRequiredConsents'), application.consents_verified],
                    [t('adminUiProfileDetails'), application.profile_complete],
                  ].map(([label, complete]) => (
                    <div key={label} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                      {complete
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                        : <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />}
                      <span className={complete ? 'text-zinc-300' : 'text-amber-300'}>{label}: {complete ? t('adminUiComplete') : t('adminUiIncomplete')}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => review(application, 'reject')} disabled={Boolean(processingId)} className="flex items-center gap-2 border border-red-900 px-4 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-950 disabled:opacity-50">
                    {processingId === application.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {t('adminUiReject')}
                  </button>
                  <button type="button" onClick={() => review(application, 'approve')} disabled={Boolean(processingId) || !application.eligible_for_approval} title={!application.eligible_for_approval ? t('adminUiApprovalRequirementsTitle') : undefined} className="flex items-center gap-2 border border-green-800 bg-green-900/30 px-4 py-2 text-xs font-black uppercase text-green-300 hover:bg-green-900/60 disabled:cursor-not-allowed disabled:opacity-40">
                    {processingId === application.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t('adminUiApprove')}
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
