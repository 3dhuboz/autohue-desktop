import { useState } from 'react';

interface AiDisclaimerProps {
  variant?: 'inline' | 'banner' | 'compact';
  className?: string;
}

export default function AiDisclaimer({ variant = 'inline', className = '' }: AiDisclaimerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed && variant === 'banner') return null;

  if (variant === 'compact') {
    return (
      <p className={`text-[10px] text-white/20 leading-relaxed ${className}`}>
        AI-powered results may occasionally be inaccurate. All classifications are logged and continuously improved.
      </p>
    );
  }

  if (variant === 'banner') {
    return (
      <div className={`relative bg-amber-500/5 border border-amber-500/10 rounded-xl px-4 py-3 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-amber-400 text-sm">⚠</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-300/80 font-semibold mb-0.5">AI Accuracy Notice</p>
            <p className="text-[11px] text-white/40 leading-relaxed">
              AutoHue uses advanced AI and color science to classify vehicle colors with high accuracy.
              However, no AI system is perfect — occasional misclassifications may occur due to lighting,
              reflections, wraps, or multi-tone paint. You can reassign any image with one click if needed.
            </p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-white/20 hover:text-white/40 transition-colors shrink-0" title="Dismiss">
            <span className="text-sm">&#x2715;</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-2.5 text-[11px] text-white/30 leading-relaxed ${className}`}>
      <span className="text-amber-500/40 mt-0.5 shrink-0">&#x2139;</span>
      <p>
        <span className="text-white/40 font-semibold">AI Accuracy Notice:</span>{' '}
        While our dual AI engine achieves 95%+ accuracy, occasional misclassifications may occur.
        Use the reassign feature to correct any errors instantly.
      </p>
    </div>
  );
}
