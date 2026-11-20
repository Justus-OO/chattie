import React, { useState } from 'react';
import { FileText, Download, Users, Wallet, Shield, Flag, Activity, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

const templates = [
  { id: 'overview', title: 'Platform overview', description: 'Executive totals for users, creators, activity, reports, rooms, and paid checkouts.', icon: Activity, tone: 'text-rose-400' },
  { id: 'financial', title: 'Financial ledger', description: 'Monthly gross revenue, platform net, payouts, transactions, and top earners.', icon: Wallet, tone: 'text-emerald-600' },
  { id: 'security', title: 'Security telemetry', description: 'Active bans, firewall drops, high-risk users, and recent security incidents.', icon: Shield, tone: 'text-blue-400' },
  { id: 'moderation', title: 'Moderation report', description: 'Open and resolved reports with a chronological incident trail.', icon: Flag, tone: 'text-amber-600' },
];

export default function AdminReports() {
  const [userId, setUserId] = useState('');
  const [generating, setGenerating] = useState('');

  const generate = async (type) => {
    if (type === 'user' && !userId.trim()) {
      toast.error('Enter a user ID for the audit report.');
      return;
    }
    setGenerating(type);
    try {
      const blob = await adminService.downloadReport(type, userId.trim());
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${type === 'user' ? 'user_audit' : type}_report.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Report PDF generated.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not generate the report PDF.');
    } finally {
      setGenerating('');
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-black font-mono text-zinc-300" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <div className="flex min-h-full w-full flex-col">
        <header className="mb-5 border-b-2 border-zinc-800 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border-2 border-rose-500/40 bg-rose-500/10 text-rose-400"><FileText className="h-5 w-5" /></span>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-400">Administrative exports</p><h1 className="text-xl font-bold uppercase tracking-widest text-white">Reports center</h1></div>
          </div>
        </header>

        <section className="mb-5 border-y-2 border-zinc-800 bg-zinc-950 p-4 sm:p-6">
          <label htmlFor="report-user-id" className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">User audit target</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="report-user-id" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="User UUID" className="min-w-0 flex-1 border-2 border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-rose-400" />
            <button type="button" disabled={Boolean(generating)} onClick={() => generate('user')} className="inline-flex items-center justify-center gap-2 border-2 border-rose-400 bg-rose-400 px-4 py-2 text-xs font-bold uppercase tracking-widest text-black disabled:opacity-50">
              {generating === 'user' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Generate user audit
            </button>
          </div>
        </section>

        <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-0 sm:grid-cols-2 xl:grid-cols-4">
          {templates.map((template) => {
            const Icon = template.icon;
            return (
              <article key={template.id} className="flex h-full flex-col border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-11 w-11 items-center justify-center border-2 border-zinc-700 bg-black"><Icon className={`h-5 w-5 ${template.tone}`} /></span>
                  <button type="button" disabled={Boolean(generating)} onClick={() => generate(template.id)} className="inline-flex items-center gap-2 border-2 border-zinc-700 bg-black px-3 py-2 text-xs font-bold uppercase tracking-widest text-white hover:border-rose-400 disabled:opacity-50">
                    {generating === template.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
                  </button>
                </div>
                <h2 className="mt-4 text-sm font-bold uppercase tracking-widest text-white">{template.title}</h2>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-zinc-500">{template.description}</p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
