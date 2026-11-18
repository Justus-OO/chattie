import { useEffect, useState } from 'react';
import { LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { accountReviewService } from '../api/accountReview.service';
import { useAppStore } from '../store/useAppStore';

export default function AccountReview() {
  const [review, setReview] = useState(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const logout = useAppStore((state) => state.logout);

  useEffect(() => {
    let active = true;
    accountReviewService.getMyReview()
      .then((currentReview) => {
        if (active) setReview(currentReview);
      })
      .catch(() => {
        if (active) toast.error('Unable to load your account review status.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submitReview = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      setReview(await accountReviewService.submitReview(reason));
      setReason('');
      toast.success('Your review request was submitted.');
    } catch (error) {
      toast.error(error.response?.data || 'Unable to submit your review request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100 p-2 sm:p-3 lg:p-4">
      <section className="min-h-[calc(100dvh-1rem)] w-full border border-slate-800 bg-slate-900 p-3 sm:p-4 lg:p-6">
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <ShieldAlert className="mt-1 h-8 w-8 shrink-0 text-rose-400" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-300">Account access restricted</p>
              <h1 className="mt-2 text-2xl font-black text-white">Request an account review</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2 border border-slate-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 hover:border-slate-500 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <p className="mt-6 text-sm leading-6 text-slate-300">
          Your account is temporarily restricted while this decision is reviewed. You can only access this page and submit an appeal. A moderator will review your request.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-slate-400">Loading review status...</p>
        ) : review?.status === 'pending' ? (
          <div className="mt-8 border border-amber-700/70 bg-amber-950/30 p-5">
            <p className="flex items-center gap-2 font-bold text-amber-300">
              <ShieldAlert className="h-5 w-5" /> Review pending
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{review.reason}</p>
            <p className="mt-3 text-xs text-slate-500">Submitted {new Date(review.submittedAt).toLocaleString()}</p>
          </div>
        ) : (
          <form onSubmit={submitReview} className="mt-8">
            {review && (
              <div className="mb-5 border border-slate-700 bg-slate-950/60 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-slate-200">
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                  Previous review: {review.status}
                </p>
                {review.reviewerNote && <p className="mt-2 text-sm text-slate-400">{review.reviewerNote}</p>}
              </div>
            )}
            <label htmlFor="review-reason" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              Explain why you are requesting a review
            </label>
            <textarea
              id="review-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={20}
              maxLength={2000}
              required
              rows={7}
              className="mt-3 w-full resize-y border border-slate-700 bg-slate-950 p-4 text-sm text-white outline-none focus:border-rose-400"
              placeholder="Include any context that may help the moderation team..."
            />
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>20 to 2000 characters</span>
              <span>{reason.length}/2000</span>
            </div>
            <button
              type="submit"
              disabled={submitting || reason.trim().length < 20}
              className="mt-5 w-full bg-rose-500 px-5 py-3 text-sm font-black uppercase tracking-wider text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit review request'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
