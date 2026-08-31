export function SceneFallback() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(47,167,201,0.14),transparent_65%)]">
      <svg viewBox="0 0 400 400" className="h-[86%] w-[86%] opacity-80" aria-hidden>
        <defs>
          <linearGradient id="sliceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.05" />
            <stop offset="50%" stopColor="#3B82F6" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {Array.from({ length: 14 }).map((_, i) => {
          const t = i / 13;
          const width = 60 + Math.sin(t * Math.PI) * 130;
          const y = 40 + t * 320;
          return (
            <ellipse key={i} cx="200" cy={y} rx={width} ry="10" fill="url(#sliceGrad)" stroke="rgba(47,167,201,0.18)" strokeWidth="0.5" />
          );
        })}
        {[
          [255, 140],
          [140, 230],
          [210, 300],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="4" fill="#93C5FD" opacity="0.8" />
        ))}
      </svg>
      <span className="absolute bottom-4 right-4 rounded-md border border-border-strong bg-panel/80 px-2 py-1 text-[10px] text-ink-muted">
        Static preview · WebGL unavailable
      </span>
    </div>
  );
}
