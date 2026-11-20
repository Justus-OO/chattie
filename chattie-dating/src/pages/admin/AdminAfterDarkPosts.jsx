import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Eye, Flame, Loader2,
  RefreshCcw, Search, Shield, Trash2, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';

const pageSize = 50;
const statusOptions = ['all', 'draft', 'processing', 'published', 'scheduled', 'rejected', 'deleted'];

const errorMessage = (error, fallback) => error?.response?.data?.error
  || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '')
  || (error instanceof Error ? error.message : fallback);

export default function AdminAfterDarkPosts() {
  const { confirm } = useAppDialogs();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [posts, setPosts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingAction, setPendingAction] = useState('');
  const [aiAction, setAiAction] = useState('');
  const [reasonByPost, setReasonByPost] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    adminService.getAfterDarkPosts({ status, limit: pageSize, offset })
      .then((response) => {
        if (!Array.isArray(response)) throw new Error('The After Dark posts service returned invalid data.');
        if (active) setPosts(response);
      })
      .catch((error) => {
        if (!active) return;
        setPosts([]);
        setLoadError(errorMessage(error, 'Could not load After Dark posts.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [status, offset, refreshKey]);

  const visiblePosts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return posts;
    return posts.filter((post) => [
      post.creator_name, post.creator_id, post.caption, post.id, post.status,
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [posts, search]);

  const openPreview = async (post) => {
    setPreviewLoading(post.id);
    try {
      const media = await adminService.getAfterDarkPostMedia(post.id);
      setPreview({ post, ...media });
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load the private media preview.'));
    } finally {
      setPreviewLoading('');
    }
  };

  const moderate = async (post, action) => {
    const reason = String(reasonByPost[post.id] || '').trim();
    if (!reason || reason.length > 1000) {
      toast.error('Enter a moderation reason of 1 to 1000 characters.');
      return;
    }
    if (action === 'reject' && !await confirm('Reject this post? It will be hidden from After Dark viewers.', {
      title: 'Reject post',
      confirmLabel: 'Reject post',
      tone: 'danger',
    })) return;

    setPendingAction(`${post.id}:${action}`);
    try {
      await adminService.moderateAfterDarkPost(post.id, action, reason);
      toast.success(action === 'approve' ? 'Post approved and published.' : 'Post rejected and hidden.');
      setReasonByPost((current) => ({ ...current, [post.id]: '' }));
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update post moderation.'));
    } finally {
      setPendingAction('');
    }
  };

  const scorePost = async (post) => {
    setAiAction(post.id);
    try {
      const result = await adminService.scoreAfterDarkPostSafety(post.id);
      setPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, ai_safety_score: result.safe_confidence, ai_safety_reason: result.rationale, ai_safety_scored_at: result.scored_at }
        : item));
      toast.success(`Caption safety confidence: ${result.safe_confidence}%.`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not assess this post caption.'));
    } finally {
      setAiAction('');
    }
  };

  const scoreVisiblePosts = async () => {
    const candidates = visiblePosts
      .filter((post) => ['draft', 'processing'].includes(post.status) && post.caption?.trim())
      .slice(0, 20);
    if (candidates.length === 0) {
      toast.info('No captioned draft or processing posts are available to assess on this page.');
      return;
    }

    setAiAction('score-page');
    let cursor = 0;
    let scored = 0;
    let failed = 0;
    const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const index = cursor;
        cursor += 1;
        const post = candidates[index];
        try {
          const result = await adminService.scoreAfterDarkPostSafety(post.id);
          setPosts((current) => current.map((item) => item.id === post.id
            ? { ...item, ai_safety_score: result.safe_confidence, ai_safety_reason: result.rationale, ai_safety_scored_at: result.scored_at }
            : item));
          scored += 1;
        } catch {
          failed += 1;
        }
      }
    });
    await Promise.all(workers);
    setAiAction('');
    toast[failed ? 'warning' : 'success'](`Assessed ${scored} post(s); ${failed} failed. Scores inspect captions only.`);
  };

  const autoApproveSafePosts = async () => {
    if (!await confirm('Publish all recently scored posts with at least 80% safe confidence, only if media is ready, content is non-explicit, the creator is active, and no unresolved post or comment reports exist?', {
      title: 'AI-assisted approval',
      confirmLabel: 'Publish eligible posts',
    })) return;

    setAiAction('auto-approve');
    try {
      const result = await adminService.autoApproveSafeAfterDarkPosts();
      toast.success(`${result.approved_count} eligible post(s) published.`);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not publish eligible posts.'));
    } finally {
      setAiAction('');
    }
  };

  return (
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-2 font-mono text-zinc-300 sm:p-3 lg:p-4">
      <div className="w-full space-y-4">
        <header className="flex flex-col justify-between gap-4 border-b-2 border-zinc-800 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-400">
              <Shield className="h-4 w-4" /> Admin content controls
            </p>
            <h1 className="flex items-center gap-3 text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">
              <Flame className="h-7 w-7 text-amber-400" /> After Dark posts
            </h1>
            <p className="mt-2 max-w-3xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
              Review post metadata and private media, handle reports, and record a reason for every moderation decision.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={scoreVisiblePosts}
              disabled={Boolean(aiAction) || loading}
              className="flex items-center justify-center gap-2 border-2 border-purple-800 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-purple-200 hover:border-purple-400 disabled:opacity-50"
            >
              {aiAction === 'score-page' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Assess page (up to 20)
            </button>
            <button
              type="button"
              onClick={autoApproveSafePosts}
              disabled={Boolean(aiAction) || loading}
              className="flex items-center justify-center gap-2 border-2 border-green-800 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-green-200 hover:border-green-400 disabled:opacity-50"
            >
              {aiAction === 'auto-approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Publish eligible ≥80%
            </button>
            <button
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              disabled={loading || Boolean(aiAction)}
              className="flex items-center justify-center gap-2 border-2 border-zinc-700 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <article className="border-2 border-zinc-800 bg-zinc-950 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Posts on this page</p>
            <p className="mt-2 text-2xl font-black text-white">{posts.length}</p>
          </article>
          <article className="border-2 border-zinc-800 bg-zinc-950 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Reported posts</p>
            <p className="mt-2 text-2xl font-black text-amber-300">{posts.filter((post) => post.pending_report_count > 0).length}</p>
          </article>
          <article className="border-2 border-zinc-800 bg-zinc-950 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Current filter</p>
            <p className="mt-2 text-2xl font-black uppercase text-white">{status}</p>
          </article>
        </section>

        {loadError && (
          <section role="alert" className="flex flex-wrap items-center justify-between gap-4 border-2 border-red-900 bg-red-950/30 p-4 text-xs text-red-300">
            <span>{loadError}</span>
            <button type="button" className="text-[10px] font-black uppercase underline" onClick={() => setRefreshKey((key) => key + 1)}>
              Retry
            </button>
          </section>
        )}

        <section className="border-2 border-zinc-800 bg-zinc-950">
          <div className="flex flex-col gap-3 border-b-2 border-zinc-800 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => { setStatus(option); setOffset(0); }}
                  className={`border-2 px-3 py-2 text-[9px] font-black uppercase tracking-widest ${status === option ? 'border-amber-400 bg-amber-400 text-black' : 'border-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-white'}`}
                >
                  {option}
                </button>
              ))}
            </div>
            <label className="flex min-w-[clamp(10rem,20vw,14rem)] items-center gap-2 border-2 border-zinc-800 px-3 py-2">
              <Search className="h-4 w-4 text-zinc-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="SEARCH POSTS OR CREATORS"
                className="w-full bg-transparent text-[10px] font-bold uppercase tracking-widest text-white outline-none placeholder:text-zinc-600"
              />
            </label>
          </div>

          {loading ? (
            <div className="flex min-h-[35dvh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="flex min-h-[35dvh] flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertTriangle className="h-7 w-7 text-zinc-600" />
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{search ? 'No posts match this search.' : 'No posts in this status.'}</p>
            </div>
          ) : (
            <div className="divide-y-2 divide-zinc-900">
              {visiblePosts.map((post) => {
                const busy = pendingAction.startsWith(`${post.id}:`);
                const deleted = post.status === 'deleted';
                return (
                  <article key={post.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] lg:p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="border border-zinc-700 px-2 py-1 text-[9px] font-black uppercase text-white">{post.status}</span>
                        <span className={`border px-2 py-1 text-[9px] font-black uppercase ${post.moderation_status === 'approved' ? 'border-green-900 text-green-300' : post.moderation_status === 'flagged' ? 'border-red-900 text-red-300' : 'border-amber-900 text-amber-300'}`}>
                          media {post.moderation_status}
                        </span>
                        {post.pending_report_count > 0 && (
                          <span className="border border-red-900 bg-red-950/50 px-2 py-1 text-[9px] font-black uppercase text-red-300">
                            {post.pending_report_count} pending report{post.pending_report_count === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      {post.ai_safety_score !== null && post.ai_safety_score !== undefined && (
                        <aside className="mt-3 border border-purple-900/70 bg-purple-950/20 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-purple-300">
                            AI safe confidence · {post.ai_safety_score}% · caption only
                          </p>
                          <p className="mt-1 text-[10px] text-zinc-400">{post.ai_safety_reason}</p>
                        </aside>
                      )}
                      <h2 className="mt-3 break-all text-sm font-black text-white">{post.creator_name}</h2>
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">{post.caption || 'No caption'}</p>
                      <section className="mt-4 border-l-2 border-zinc-800 pl-3" aria-label="Post comments">
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          {Number(post.comments_count || 0)} comment{Number(post.comments_count || 0) === 1 ? '' : 's'}
                        </p>
                        {post.comments?.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {post.comments.map((comment) => (
                              <article key={comment.id} className="border border-zinc-900 bg-black/50 p-2">
                                <div className="flex flex-wrap justify-between gap-2 text-[9px] font-bold text-zinc-500">
                                  <span>{comment.author}</span>
                                  <time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString()}</time>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-300">{comment.content}</p>
                              </article>
                            ))}
                            {post.comments_count > post.comments.length && (
                              <p className="text-[9px] text-zinc-600">Showing the 5 most recent comments.</p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1 text-[10px] text-zinc-600">No comments on this post.</p>
                        )}
                      </section>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                        <span>{post.access_type}{post.access_type === 'ppv' ? ` · KES ${(Number(post.price_cents) / 100).toFixed(2)}` : ''}</span>
                        <span>{post.media_type || 'unknown media'}</span>
                        <span>{post.is_explicit ? '18+ content' : 'non-explicit'}</span>
                        <span>{new Date(post.created_at).toLocaleString()}</span>
                        <span className="break-all">ID {post.id}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openPreview(post)}
                        disabled={Boolean(previewLoading) || deleted}
                        className="mt-4 flex items-center gap-2 border-2 border-zinc-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {previewLoading === post.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        Preview private media
                      </button>
                      {!deleted && ['draft', 'processing'].includes(post.status) && (
                        <button
                          type="button"
                          onClick={() => scorePost(post)}
                          disabled={Boolean(aiAction) || !post.caption?.trim()}
                          className="mt-2 flex items-center gap-2 border-2 border-purple-900 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-purple-200 hover:border-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {aiAction === post.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                          Assess caption safety
                        </button>
                      )}
                    </div>
                    {!deleted && (
                      <div className="space-y-3 border-t-2 border-zinc-900 pt-4 lg:border-l-2 lg:border-t-0 lg:pl-5 lg:pt-0">
                        <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          Required audit reason
                          <textarea
                            value={reasonByPost[post.id] || ''}
                            onChange={(event) => setReasonByPost((current) => ({ ...current, [post.id]: event.target.value }))}
                            maxLength={1000}
                            rows={3}
                            placeholder="Document review findings"
                            className="mt-2 w-full resize-y border-2 border-zinc-800 bg-black p-3 text-xs normal-case tracking-normal text-white outline-none focus:border-zinc-500"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={Boolean(pendingAction) || post.asset_status !== 'ready'}
                            onClick={() => moderate(post, 'approve')}
                            className="flex items-center gap-2 border-2 border-green-800 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-green-300 hover:bg-green-950 disabled:opacity-40"
                          >
                            {busy && pendingAction.endsWith(':approve') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            Approve / publish
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(pendingAction)}
                            onClick={() => moderate(post, 'reject')}
                            className="flex items-center gap-2 border-2 border-red-900 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-red-300 hover:bg-red-950 disabled:opacity-40"
                          >
                            {busy && pendingAction.endsWith(':reject') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Reject / hide
                          </button>
                        </div>
                        {post.asset_status !== 'ready' && (
                          <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400">
                            Asset is {post.asset_status}; it cannot be approved.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <footer className="flex items-center justify-between border-t-2 border-zinc-800 p-4">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Showing {posts.length} · pages contain at most {pageSize}</span>
            <div className="flex gap-2">
              <button type="button" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - pageSize))} className="border-2 border-zinc-800 p-2 text-white disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" disabled={posts.length < pageSize || loading} onClick={() => setOffset((value) => value + pageSize)} className="border-2 border-zinc-800 p-2 text-white disabled:opacity-30">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </footer>
        </section>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="After Dark media preview">
          <div className="w-full max-w-4xl border-2 border-zinc-700 bg-zinc-950">
            <header className="flex items-center justify-between gap-4 border-b-2 border-zinc-800 p-4">
              <div className="min-w-0">
                <p className="truncate text-xs font-black uppercase tracking-widest text-white">{preview.post.creator_name} · post review</p>
                <p className="mt-1 text-[9px] text-zinc-500">Temporary private preview. URL expires at {new Date(preview.expires_at).toLocaleTimeString()}.</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} aria-label="Close preview" className="border-2 border-zinc-700 p-2 text-white hover:border-white">
                <span className="text-xs font-black">CLOSE</span>
              </button>
            </header>
            <div className="flex max-h-[75dvh] min-h-[40dvh] items-center justify-center overflow-auto bg-black p-3">
              {String(preview.mime_type || '').startsWith('video/')
                ? <video key={preview.url} src={preview.url} controls playsInline className="max-h-[70dvh] max-w-full" />
                : <img src={preview.url} alt="Private After Dark post" className="max-h-[70dvh] max-w-full object-contain" />}
              {!String(preview.mime_type || '').startsWith('image/') && !String(preview.mime_type || '').startsWith('video/') && (
                <Video className="h-8 w-8 text-zinc-600" />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
