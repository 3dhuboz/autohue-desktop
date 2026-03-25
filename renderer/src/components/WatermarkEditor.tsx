import { useState, useRef, useEffect, useCallback } from 'react';

type WatermarkMode = 'text' | 'logo';
type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

interface WatermarkConfig {
  mode: WatermarkMode;
  text: string;
  fontSize: number;
  opacity: number;
  color: string;
  position: WatermarkPosition;
  rotation: number;
  fontFamily: string;
  logoDataUrl: string;
  logoScale: number;
}

const DEFAULT_CONFIG: WatermarkConfig = {
  mode: 'text',
  text: 'AutoHue',
  fontSize: 24,
  opacity: 0.3,
  color: '#ffffff',
  position: 'bottom-right',
  rotation: 0,
  fontFamily: 'Arial',
  logoDataUrl: '',
  logoScale: 50,
};

const POSITIONS: { key: WatermarkPosition; label: string; icon: string }[] = [
  { key: 'top-left', label: 'Top Left', icon: '\u2196' },
  { key: 'top-right', label: 'Top Right', icon: '\u2197' },
  { key: 'center', label: 'Center', icon: '\u25CE' },
  { key: 'bottom-left', label: 'Bottom Left', icon: '\u2199' },
  { key: 'bottom-right', label: 'Bottom Right', icon: '\u2198' },
];

const FONTS = ['Arial', 'Georgia', 'Courier New', 'Impact', 'Verdana'];

export default function WatermarkEditor({
  onConfigChange,
  initialConfig,
}: {
  onConfigChange?: (config: WatermarkConfig) => void;
  initialConfig?: Partial<WatermarkConfig>;
}) {
  const [config, setConfig] = useState<WatermarkConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const [collapsed, setCollapsed] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const updateConfig = useCallback((updates: Partial<WatermarkConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...updates };
      onConfigChange?.(next);
      return next;
    });
  }, [onConfigChange]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      updateConfig({ logoDataUrl: dataUrl, mode: 'logo' });
    };
    reader.readAsDataURL(file);
  };

  // Load logo image when URL changes
  useEffect(() => {
    if (!config.logoDataUrl) { logoImgRef.current = null; return; }
    const img = new Image();
    img.onload = () => { logoImgRef.current = img; };
    img.src = config.logoDataUrl;
  }, [config.logoDataUrl]);

  // Draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(20, 20, w - 40, h - 40);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.fillStyle = '#444';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Preview Image', w / 2, h / 2 - 10);

    ctx.save();
    ctx.globalAlpha = config.opacity;
    const padding = 30;

    if (config.mode === 'logo' && logoImgRef.current) {
      const logo = logoImgRef.current;
      const scale = config.logoScale / 100;
      const lw = logo.width * scale;
      const lh = logo.height * scale;
      const maxW = w * 0.4;
      const ratio = lw > maxW ? maxW / lw : 1;
      const drawW = lw * ratio;
      const drawH = lh * ratio;

      let x = (w - drawW) / 2;
      let y = (h - drawH) / 2;
      switch (config.position) {
        case 'top-left': x = padding; y = padding; break;
        case 'top-right': x = w - padding - drawW; y = padding; break;
        case 'bottom-left': x = padding; y = h - padding - drawH; break;
        case 'bottom-right': x = w - padding - drawW; y = h - padding - drawH; break;
        case 'center': break;
      }

      if (config.rotation !== 0) {
        ctx.translate(x + drawW / 2, y + drawH / 2);
        ctx.rotate((config.rotation * Math.PI) / 180);
        ctx.drawImage(logo, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.drawImage(logo, x, y, drawW, drawH);
      }
    } else {
      ctx.fillStyle = config.color;
      ctx.font = `${config.fontSize}px ${config.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let x = w / 2, y = h / 2;
      switch (config.position) {
        case 'top-left': x = padding; y = padding + config.fontSize / 2; ctx.textAlign = 'left'; break;
        case 'top-right': x = w - padding; y = padding + config.fontSize / 2; ctx.textAlign = 'right'; break;
        case 'bottom-left': x = padding; y = h - padding - config.fontSize / 2; ctx.textAlign = 'left'; break;
        case 'bottom-right': x = w - padding; y = h - padding - config.fontSize / 2; ctx.textAlign = 'right'; break;
        case 'center': break;
      }

      if (config.rotation !== 0) {
        ctx.translate(x, y);
        ctx.rotate((config.rotation * Math.PI) / 180);
        ctx.fillText(config.text, 0, 0);
      } else {
        ctx.fillText(config.text, x, y);
      }
    }

    ctx.restore();
  }, [config]);

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <h2 className="font-heading font-bold text-sm flex items-center gap-2">
          <span className="text-racing-500">W</span>
          Watermark Editor
          <span className="text-[10px] bg-racing-600/20 text-racing-400 px-2 py-0.5 rounded-full font-bold">PRO</span>
        </h2>
        <span className="text-white/20 text-xs">{collapsed ? '\u25BC' : '\u25B2'}</span>
      </button>

      {!collapsed && (
        <div className="px-6 pb-6 space-y-5 animate-fade-up">
          {/* Mode toggle */}
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            <button
              onClick={() => updateConfig({ mode: 'text' })}
              className={`flex-1 py-2.5 text-xs font-bold transition-all ${config.mode === 'text' ? 'bg-racing-600/20 text-racing-400' : 'bg-white/[0.02] text-white/30 hover:text-white/50'}`}
            >
              <span className="mr-1.5">Aa</span>Text
            </button>
            <button
              onClick={() => updateConfig({ mode: 'logo' })}
              className={`flex-1 py-2.5 text-xs font-bold transition-all ${config.mode === 'logo' ? 'bg-racing-600/20 text-racing-400' : 'bg-white/[0.02] text-white/30 hover:text-white/50'}`}
            >
              <span className="mr-1.5">{'\uD83D\uDDBC'}</span>Logo
            </button>
          </div>

          {/* Preview */}
          <div className="rounded-xl overflow-hidden border border-white/5">
            <canvas ref={canvasRef} width={400} height={250} className="w-full h-auto bg-carbon-500" />
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {config.mode === 'text' ? (
              <>
                {/* Text input */}
                <div>
                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Watermark Text</label>
                  <input
                    type="text"
                    value={config.text}
                    onChange={e => updateConfig({ text: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 focus:border-racing-600/50 focus:outline-none transition-colors"
                    placeholder="Your watermark text"
                  />
                </div>

                {/* Font & Size */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Font</label>
                    <select
                      value={config.fontFamily}
                      onChange={e => updateConfig({ fontFamily: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                      title="Select font"
                    >
                      {FONTS.map(f => <option key={f} value={f} className="bg-gray-900">{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Size: {config.fontSize}px</label>
                    <input type="range" min="10" max="72" value={config.fontSize} onChange={e => updateConfig({ fontSize: Number(e.target.value) })} className="w-full accent-racing-600" title="Font size" />
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={config.color} onChange={e => updateConfig({ color: e.target.value })} className="w-8 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer" title="Select watermark color" />
                    <div className="flex gap-1.5">
                      {['#ffffff', '#000000', '#dc2626', '#3b82f6', '#22c55e', '#eab308'].map(c => (
                        <button key={c} onClick={() => updateConfig({ color: c })} className={`w-6 h-6 rounded-lg border transition-all ${config.color === c ? 'border-racing-500 scale-110' : 'border-white/10'}`} style={{ backgroundColor: c }} title={`Set color to ${c}`} />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Logo upload */}
                <div>
                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Upload Logo</label>
                  <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" title="Upload logo image" />
                  {config.logoDataUrl ? (
                    <div className="flex items-center gap-3">
                      <img src={config.logoDataUrl} alt="Logo" className="w-12 h-12 object-contain rounded-lg border border-white/10 bg-white/5 p-1" />
                      <div className="flex-1">
                        <div className="text-xs text-white/50">Logo uploaded</div>
                        <button onClick={() => logoInputRef.current?.click()} className="text-[10px] text-racing-400 hover:text-racing-300 mt-0.5">Change logo</button>
                      </div>
                      <button onClick={() => updateConfig({ logoDataUrl: '', mode: 'text' })} title="Remove logo" className="text-white/20 hover:text-red-400 transition-colors">
                        <span className="text-xs">{'\uD83D\uDDD1'}</span>
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => logoInputRef.current?.click()} className="w-full border-2 border-dashed border-white/10 rounded-xl py-6 text-center hover:border-racing-600/30 transition-colors group">
                      <span className="text-white/20 text-xl group-hover:text-racing-500 transition-colors">{'\u2B06'}</span>
                      <div className="text-xs text-white/30 mt-2 group-hover:text-white/50">Click to upload logo (PNG, SVG, JPG)</div>
                    </button>
                  )}
                </div>

                {/* Logo scale */}
                <div>
                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Scale: {config.logoScale}%</label>
                  <input type="range" min="10" max="200" value={config.logoScale} onChange={e => updateConfig({ logoScale: Number(e.target.value) })} className="w-full accent-racing-600" title="Logo scale" />
                </div>
              </>
            )}

            {/* Shared: Opacity & Rotation */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Opacity: {Math.round(config.opacity * 100)}%</label>
                <input type="range" min="5" max="100" value={config.opacity * 100} onChange={e => updateConfig({ opacity: Number(e.target.value) / 100 })} className="w-full accent-racing-600" title="Opacity" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Rotation: {config.rotation}{'\u00B0'}</label>
                <input type="range" min="-45" max="45" value={config.rotation} onChange={e => updateConfig({ rotation: Number(e.target.value) })} className="w-full accent-racing-600" title="Rotation" />
              </div>
            </div>

            {/* Shared: Position */}
            <div>
              <label className="block text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">Position</label>
              <div className="flex gap-1.5">
                {POSITIONS.map(p => (
                  <button key={p.key} onClick={() => updateConfig({ position: p.key })} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${config.position === p.key ? 'bg-racing-600/20 text-racing-400 border border-racing-600/30' : 'bg-white/[0.03] text-white/30 border border-white/5 hover:text-white/50'}`} title={p.label}>
                    <span>{p.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { WatermarkConfig };
