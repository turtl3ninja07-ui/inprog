import { useEffect, useMemo, useState } from 'react';
import { codeToFlagEmoji, onLeaderboardUpdated, topN, type CountryCount } from '@/lib/leaderboard';

export default function Leaderboard() {
  const [items, setItems] = useState<CountryCount[]>(() => topN(5));

  useEffect(() => {
    const off = onLeaderboardUpdated(() => setItems(topN(5)));
    return () => off();
  }, []);

  const total = useMemo(() => items.reduce((acc, it) => acc + it.count, 0), [items]);

  return (
    <aside
      className="
        pointer-events-auto fixed left-4 bottom-20 z-20
        h-56 w-56
        rounded-lg border border-cyan-400/30 bg-white/5
        shadow-[0_0_16px_rgba(34,211,238,0.22)]
        backdrop-blur-md
        text-white
        flex flex-col
      "
      aria-label="Top 5 Countries Leaderboard"
    >
      <div className="px-3 py-2 border-b border-cyan-400/20">
        <h2 className="text-sm font-semibold leading-none">Leaderboard</h2>
        <p className="text-[10px] text-white/70 leading-none mt-1">Top 5 countries by clicks</p>
      </div>

      <ol className="flex-1 overflow-auto p-1.5">
        {items.length === 0 ? (
          <div className="text-white/70 text-xs p-2">No clicks yet. Pick a country or click the map.</div>
        ) : (
          items.map((it, idx) => (
            <li
              key={it.code}
              className="
                flex items-center justify-between gap-2
                rounded-md px-2 py-1
                hover:bg-white/5 transition-colors
              "
            >
              <div className="flex items-center gap-2.5">
                <span className="text-white/70 w-4 text-right text-xs">{idx + 1}.</span>
                <span className="text-lg leading-none">{codeToFlagEmoji(it.code)}</span>
                <span className="font-medium text-sm leading-none">{it.code}</span>
              </div>
              <span className="text-cyan-300 font-semibold text-sm leading-none">{it.count}</span>
            </li>
          ))
        )}
      </ol>

      <div className="px-3 py-2 flex items-center justify-between border-t border-cyan-400/20">
        <span className="text-[10px] text-white/70">Total (Top 5): {total}</span>
      </div>
    </aside>
  );
}