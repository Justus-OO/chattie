import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Check, ImagePlus, Loader2, Lock, ShieldCheck,
  Upload, Users, Video, X
} from 'lucide-react';
import { toast } from 'sonner';
import { afterDarkService } from '../../api/afterdark.service';

const ACCESS_OPTIONS = [
  { id: 'free', label: 'Free', icon: Check, detail: 'Everyone can view' },
  { id: 'subscriber', label: 'Subscribers', icon: Users, detail: 'Your subscribers' },
  { id: 'ppv', label: 'Pay per view', icon: Lock, detail: 'Unlock with a payment' },
];

export default function UploadExplicitModal({ isOpen, onClose, onSuccess }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [accessType, setAccessType] = useState('free');
  const [price, setPrice] = useState('50');
  const [isExplicit, setIsExplicit] = useState(true);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    setFile(null);
    setCaption('');
    setAccessType('free');
    setPrice('50');
    setIsExplicit(true);
    setRightsConfirmed(false);
    setIsDragging(false);
    setIsSubmitting(false);
    setUploadProgress(0);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    return undefined;
  }, [isOpen]);

  const previewUrl = React.useMemo(() => file ? URL.createObjectURL(file) : '', [file]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  if (!isOpen) return null;

  const selectFile = nextFile => {
    if (!nextFile) return;
    if (!nextFile.type.startsWith('image/') && !nextFile.type.startsWith('video/')) {
      setError('Choose an image or video file.');
      return;
    }
    setError('');
    setFile(nextFile);
  };

  const handleDrop = event => {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  };

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  const handleSubmit = async event => {
    event.preventDefault();
    setError('');
    if (!file) {
      setError('Add a photo or video to continue.');
      return;
    }
    if (!rightsConfirmed) {
      setError('Confirm that you have the rights and consent to publish this media.');
      return;
    }
    const numericPrice = Number(price);
    if (accessType === 'ppv' && (!Number.isFinite(numericPrice) || numericPrice < 50)) {
      setError('Pay-per-view posts must cost at least KES 50.');
      return;
    }

    const formData = new FormData();
    formData.append('media', file);
    formData.append('caption', caption.trim());
    formData.append('access_type', accessType);
    formData.append('price_cents', String(accessType === 'ppv' ? Math.round(numericPrice * 100) : 0));
    formData.append('media_type', file.type.startsWith('video/') ? 'video' : 'image');
    formData.append('is_explicit', String(isExplicit));

    setIsSubmitting(true);
    setUploadProgress(0);
    try {
      const response = await afterDarkService.createPost(formData, setUploadProgress);
      const createdPost = response?.post || response?.item || response;
      if (!createdPost || typeof createdPost !== 'object') {
        throw new Error('The server did not return the created post.');
      }
      toast.success('Post published.');
      onSuccess?.(createdPost);
      onClose();
    } catch (submitError) {
      const message = submitError?.response?.data?.error ||
        (submitError instanceof Error ? submitError.message : 'Could not publish this post.');
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal((
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close create post" onClick={handleClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="create-post-title" className="relative z-10 flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden border-2 border-zinc-700 bg-black font-mono shadow-[8px_8px_0px_rgba(255,255,255,0.08)]">
        <header className="flex shrink-0 items-center justify-between border-b-2 border-zinc-800 bg-zinc-950 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center border border-yellow-400/60 bg-yellow-400/10 text-yellow-300">
              <ImagePlus className="h-4 w-4" />
            </span>
            <div>
              <h2 id="create-post-title" className="text-sm font-bold uppercase tracking-wider text-white">Create post</h2>
              <p className="mt-0.5 text-[10px] uppercase text-zinc-500">Publish to your channel</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} disabled={isSubmitting} aria-label="Close" className="flex h-9 w-9 items-center justify-center border border-zinc-700 text-zinc-400 transition-colors hover:border-white hover:text-white disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <section className="border-b-2 border-zinc-800 p-4 sm:p-6 md:border-b-0 md:border-r-2" aria-label="Media and caption">
              {file ? (
                <div className="relative flex aspect-4/3 items-center justify-center overflow-hidden border border-zinc-700 bg-zinc-950">
                  {file.type.startsWith('video/') ? (
                    <video src={previewUrl} controls playsInline className="h-full w-full object-contain" />
                  ) : (
                    <img src={previewUrl} alt="Post preview" className="h-full w-full object-contain" />
                  )}
                  <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} disabled={isSubmitting} aria-label="Remove selected media" className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center border border-white/30 bg-black/80 text-white hover:bg-black disabled:opacity-40">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={event => { event.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`flex aspect-4/3 flex-col items-center justify-center border border-dashed px-6 text-center transition-colors ${isDragging ? 'border-yellow-300 bg-yellow-300/5' : 'border-zinc-700 bg-zinc-950'}`}
                >
                  <input ref={fileInputRef} id="post-media" type="file" accept="image/*,video/*" className="sr-only" onChange={event => selectFile(event.target.files?.[0])} />
                  <span className="mb-4 flex h-12 w-12 items-center justify-center border border-zinc-700 bg-black text-zinc-300">
                    <Upload className="h-5 w-5" />
                  </span>
                  <label htmlFor="post-media" className="cursor-pointer text-sm font-bold text-white hover:text-yellow-300">Choose media</label>
                  <p className="mt-2 text-[10px] uppercase text-zinc-500">or drop it here</p>
                  <p className="mt-5 flex items-center gap-3 text-[9px] uppercase tracking-wide text-zinc-600"><span className="flex items-center gap-1"><ImagePlus className="h-3 w-3" /> Photo</span><span className="flex items-center gap-1"><Video className="h-3 w-3" /> Video</span></p>
                </div>
              )}

              {file && <p className="mt-2 truncate text-[10px] text-zinc-500">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</p>}

              <div className="mt-5">
                <label htmlFor="post-caption" className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Caption</label>
                <textarea id="post-caption" value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} rows={5} placeholder="Write a caption..." disabled={isSubmitting} className="w-full resize-y border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50" />
                <div className="mt-1 text-right text-[9px] text-zinc-600">{caption.length}/2200</div>
              </div>
            </section>

            <section className="space-y-6 p-4 sm:p-6" aria-label="Post settings">
              <div>
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Who can view</h3>
                <div className="grid grid-cols-3 border border-zinc-800">
                  {ACCESS_OPTIONS.map(option => {
                    const Icon = option.icon;
                    const selected = accessType === option.id;
                    return (
                      <button key={option.id} type="button" onClick={() => setAccessType(option.id)} disabled={isSubmitting} aria-pressed={selected} className={`flex min-h-20 flex-col items-center justify-center gap-1 border-r border-zinc-800 px-1.5 py-3 last:border-r-0 ${selected ? 'bg-white text-black' : 'bg-black text-zinc-400 hover:bg-zinc-950 hover:text-white'}`}>
                        <Icon className="h-4 w-4" />
                        <span className="text-[9px] font-bold uppercase leading-tight">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-zinc-500">{ACCESS_OPTIONS.find(option => option.id === accessType)?.detail}</p>
              </div>

              {accessType === 'ppv' && (
                <div>
                  <label htmlFor="post-price" className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-yellow-300">Unlock price</label>
                  <div className="flex border border-zinc-700 bg-zinc-950 focus-within:border-yellow-300">
                    <span className="flex items-center border-r border-zinc-700 px-3 text-xs font-bold text-zinc-500">KES</span>
                    <input id="post-price" type="number" min="50" step="1" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} disabled={isSubmitting} className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-bold text-white outline-none disabled:opacity-50" />
                  </div>
                  <p className="mt-1 text-[9px] text-zinc-600">Minimum KES 50</p>
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-3 border-t border-zinc-800 pt-4">
                <input type="checkbox" checked={isExplicit} onChange={event => setIsExplicit(event.target.checked)} disabled={isSubmitting} className="mt-0.5 h-4 w-4 accent-yellow-300" />
                <span>
                  <span className="block text-xs font-bold text-white">Mark as adult content</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">Viewers will see the content warning before opening this post.</span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 border-t border-zinc-800 pt-4">
                <input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} disabled={isSubmitting} className="mt-0.5 h-4 w-4 accent-yellow-300" />
                <span className="text-[10px] leading-relaxed text-zinc-400">I have the rights and consent required to publish everyone and everything shown in this media.</span>
              </label>

              <div className="flex items-start gap-2 border border-zinc-800 bg-zinc-950 p-3 text-[9px] leading-relaxed text-zinc-500">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                <p>Uploads are subject to creator eligibility, moderation, and platform rules.</p>
              </div>
            </section>
          </div>

          <footer className="shrink-0 border-t-2 border-zinc-800 bg-zinc-950 px-4 py-3 sm:px-6">
            {(error || isSubmitting) && (
              <div className={`mb-3 flex items-center gap-2 text-[10px] ${error ? 'text-red-400' : 'text-zinc-400'}`} role={error ? 'alert' : 'status'}>
                {error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                <span className="min-w-0 flex-1">{error || 'Uploading post...'}</span>
                {isSubmitting && <span className="tabular-nums">{uploadProgress}%</span>}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={handleClose} disabled={isSubmitting} className="border border-zinc-700 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:border-white hover:text-white disabled:opacity-40">Cancel</button>
              <button type="submit" disabled={isSubmitting || !file} className="flex min-w-36 items-center justify-center gap-2 border border-yellow-300 bg-yellow-300 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black transition-colors hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isSubmitting ? 'Publishing' : 'Publish post'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  ), document.body);
}