import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { aiWritingService } from '../api/aiWriting.service';

export default function AIDraftAssistant({
  type,
  draft = '',
  context = '',
  interests = [],
  onSelect,
  disabled = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const hasInput = type === 'profile-bio'
    ? Boolean(draft.trim() || interests.length)
    : Boolean(draft.trim() || context.trim());

  useEffect(() => {
    setSuggestions([]);
  }, [type, draft, context, interests]);

  const generate = async () => {
    setIsGenerating(true);
    setSuggestions([]);
    try {
      const result = type === 'profile-bio'
        ? await aiWritingService.generateProfileBios({ interests, draft })
        : await aiWritingService.generateCreatorCaptions({ context, draft });
      if (!Array.isArray(result?.suggestions) || result.suggestions.length !== 3) {
        throw new Error('The AI writing service returned invalid suggestions.');
      }
      setSuggestions(result.suggestions);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not generate writing suggestions.'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <button
        type="button"
        onClick={generate}
        disabled={disabled || isGenerating || !hasInput}
        className="inline-flex items-center gap-2 border border-yellow-400/60 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-yellow-300 transition-colors hover:border-yellow-300 hover:bg-yellow-300/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {isGenerating ? 'Drafting...' : 'Draft 3 ideas with AI'}
      </button>
      <p className="text-[9px] leading-relaxed text-zinc-600">
        AI uses only the text you provide. Review and edit suggestions before using them.
      </p>
      {suggestions.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${index}-${suggestion}`}
              type="button"
              onClick={() => {
                onSelect(suggestion);
                setSuggestions([]);
              }}
              className="block w-full border border-zinc-800 bg-zinc-950 p-3 text-left text-xs leading-relaxed text-zinc-300 transition-colors hover:border-yellow-400/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-300"
            >
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-yellow-400">Use idea {index + 1}</span>
              <span className="whitespace-pre-wrap">{suggestion}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
