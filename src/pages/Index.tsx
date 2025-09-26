import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorldBackground from '@/components/WorldBackground';
import CircleButton from '@/components/CircleButton';
import Leaderboard from '@/components/Leaderboard';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';

// Minimal helpers
function clsx(...xs: Array<string | false | undefined>) {
  return xs.filter(Boolean).join(' ');
}
function sumCounts(map: Record<string, number>): number {
  return Object.values(map).reduce((a, b) => a + (Number(b) || 0), 0);
}
function normalizeCountryCode(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const code = String(input).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

const regionNames = typeof Intl !== 'undefined' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
function countryNameFromCode(code: string | undefined | null): string {
  try {
    if (!code) return 'Unknown';
    return (regionNames?.of(code) as string) || code;
  } catch {
    return code || 'Unknown';
  }
}

type ModalKey = 'world' | 'settings' | 'register' | 'about' | 'contact' | 'share' | 'already' | null;

async function verifyAdmin(): Promise<boolean> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return false;
    const res = await fetch('https://wblnwqqsbobcdjllrhum.supabase.co/functions/v1/app_6571a533ec_admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'verify' }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json?.isAdmin;
  } catch {
    return false;
  }
}

type ClickFnResponse = {
  country_code?: string;
  clicks?: number;
  isNew?: boolean;
};

type Explorer = {
  id: string;
  email: string;
  countryCode: string;
  countryName: string;
  at: string;
};

export default function Index() {
  const navigate = useNavigate();

  // Selection (still supported for map tap pings)
  const [selected, setSelected] = useState<string>('US');

  // Country counts map from Supabase
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Totals
  const globalTotal = useMemo(() => sumCounts(counts), [counts]);

  // UI toggles (persist) - both closed by default
  const [showLeaderboard, setShowLeaderboard] = useState<boolean>(() => {
    const v = localStorage.getItem('ui_show_leaderboard');
    return v ? v === '1' : false;
  });
  const [showGlobalNetwork, setShowGlobalNetwork] = useState<boolean>(() => {
    const v = localStorage.getItem('ui_show_global_network');
    return v ? v === '1' : false;
  });

  useEffect(() => {
    localStorage.setItem('ui_show_leaderboard', showLeaderboard ? '1' : '0');
  }, [showLeaderboard]);
  useEffect(() => {
    localStorage.setItem('ui_show_global_network', showGlobalNetwork ? '1' : '0');
  }, [showGlobalNetwork]);

  // Modals
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  // Hover tooltip over centroids with counts > 0
  const [hover, setHover] = useState<{ code: string | null; x: number; y: number }>({ code: null, x: -1, y: -1 });

  // Auth state
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Click limit and share state
  const [hasClicked, setHasClicked] = useState<boolean>(() => localStorage.getItem('clicked_once') === '1');
  const [lastCountry, setLastCountry] = useState<string>('US');
  const shareTimerRef = useRef<number | null>(null);

  // Realtime "Latest Explorers" ticker
  const [latest, setLatest] = useState<Explorer[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pushExplorer = useCallback((email: string, countryCode: string) => {
    const item: Explorer = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      email,
      countryCode,
      countryName: countryNameFromCode(countryCode),
      at: new Date().toISOString(),
    };
    setLatest((prev) => [item, ...prev].slice(0, 5));
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (mounted) {
        setSignedIn(!!session);
        setUserEmail(session?.user?.email || '');
      }
      const ok = await verifyAdmin();
      if (mounted) setIsAdmin(ok);
    };
    init();

    // Auth change
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user?.email || '');
      verifyAdmin().then((ok) => setIsAdmin(!!ok));
    });

    // Realtime channel for click feed
    const channel = supabase.channel('click-feed', { config: { broadcast: { self: true } } });
    channel
      .on('broadcast', { event: 'click' }, (payload) => {
        const p = (payload as unknown as { payload?: { email?: string; country_code?: string } }).payload;
        const email = (p?.email || '').trim();
        const code = normalizeCountryCode(p?.country_code || '') || 'US';
        if (email) pushExplorer(email, code);
      })
      .subscribe(() => {
        // no-op
      });
    channelRef.current = channel;

    return () => {
      sub?.subscription?.unsubscribe?.();
      mounted = false;
      if (shareTimerRef.current) {
        clearTimeout(shareTimerRef.current);
        shareTimerRef.current = null;
      }
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [pushExplorer]);

  // Fetch all counts once on mount
  useEffect(() => {
    const fetchAll = async () => {
      const { data, error } = await supabase
        .from('app_6571a533ec_country_counts')
        .select('country_code,clicks');

      if (!error && data) {
        const map: Record<string, number> = {};
        for (const row of data as Array<{ country_code: string; clicks: number }>) {
          const code = normalizeCountryCode(row.country_code);
          if (code) map[code] = Number(row.clicks) || 0;
        }
        setCounts(map);
      }
    };
    fetchAll();

    const onHover = (e: Event) => {
      const ce = e as CustomEvent<{ code: string | null; x: number; y: number }>;
      const d = ce.detail;
      if (!d) return;
      setHover({ code: d.code, x: d.x, y: d.y });
    };
    window.addEventListener('world:hover', onHover as EventListener);
    return () => window.removeEventListener('world:hover', onHover as EventListener);
  }, []);

  // Persistent pins for countries with >= 10 clicks
  useEffect(() => {
    try {
      Object.entries(counts).forEach(([code, clicks]) => {
        if (Number(clicks) >= 10) {
          window.dispatchEvent(new CustomEvent('world:pin', { detail: { code } }));
        }
      });
    } catch {
      // ignore
    }
  }, [counts]);

  // Stable map country selection (prevents canvas re-init)
  const handleMapCountrySelect = useCallback((code: string) => {
    const norm = normalizeCountryCode(code);
    if (norm) setSelected(norm);
  }, []);

  // Invoke Edge Function to detect IP country, increment, and return status
  const handleIncrement = async () => {
    try {
      // Enforce single click on frontend
      if (hasClicked) {
        setOpenModal('already');
        return;
      }

      const { data, error } = await supabase.functions.invoke('app_6571a533ec_click', {
        body: {}, // no body needed
      });

      // Default country fallback if needed
      let code: string = selected || 'US';
      let isNew = false;
      let clicksAfter = counts[code] || 0;

      if (error) {
        // Soft fallback: show repeat blip at selected country
        if (selected) {
          window.dispatchEvent(new CustomEvent('world:blip', { detail: { code: selected, kind: 'repeat' as const } }));
        }
      } else {
        const result = (data ?? {}) as ClickFnResponse;
        code = normalizeCountryCode(result.country_code) || selected || 'US';
        clicksAfter = Number(result.clicks ?? (counts[code] || 0) + 1);
        isNew = !!result.isNew;

        // Update UI states
        setCounts((prev) => ({ ...prev, [code]: clicksAfter }));
      }

      setSelected(code);
      setLastCountry(code);

      // Trigger blip based on isNew
      window.dispatchEvent(
        new CustomEvent('world:blip', {
          detail: { code, kind: isNew ? ('new' as const) : ('repeat' as const) },
        }),
      );

      // Broadcast this click to the live ticker if signed in
      if (signedIn && userEmail) {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'click',
          payload: { email: userEmail, country_code: code },
        });
        // Also optimistically show ourselves if channel not receiving self
        pushExplorer(userEmail, code);
      }

      // Mark as clicked and open share dialog after 3s
      setHasClicked(true);
      localStorage.setItem('clicked_once', '1');
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
      shareTimerRef.current = window.setTimeout(() => setOpenModal('share'), 3000);
    } catch {
      // Ignore; handled above
    }
  };

  // Menu click -> open specific modal
  const open = (key: ModalKey) => setOpenModal(key);

  // Logout
  const onLogout = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setSignedIn(false);
    setUserEmail('');
    setOpenModal(null);
  };

  // World Stats: fetch top 20 (live when modal opens)
  const [top20, setTop20] = useState<Array<{ country_code: string; clicks: number }>>([]);
  useEffect(() => {
    const fetchTop = async () => {
      if (openModal !== 'world') return;
      const { data, error } = await supabase
        .from('app_6571a533ec_country_counts')
        .select('country_code,clicks')
        .order('clicks', { ascending: false })
        .limit(20);
      if (!error && data) {
        type CountRow = { country_code: string; clicks: number };
        setTop20(
          (data as CountRow[]).map((r: CountRow) => ({
            country_code: String(r.country_code).toUpperCase(),
            clicks: Number(r.clicks) || 0,
          })),
        );
      }
    };
    fetchTop();
  }, [openModal]);

  // Register/Login state
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regMsg, setRegMsg] = useState<string>('');

  // Sign Up
  const onRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegMsg('');
    const { error } = await supabase.auth.signUp({ email: regEmail, password: regPass });
    if (error) setRegMsg(error.message);
    else setRegMsg('Registration initiated. Please check your email for confirmation.');
  };

  // Login
  const onLoginClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setRegMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: regEmail, password: regPass });
    if (error) setRegMsg(error.message);
    else {
      setRegMsg('Logged in successfully.');
      setOpenModal(null);
      const ok = await verifyAdmin();
      setIsAdmin(ok);
      setSignedIn(true);
    }
  };

  // Contact
  const [contactEmail, setContactEmail] = useState('');
  const [contactMsg, setContactMsg] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const onContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactInfo('');
    if (!contactMsg.trim()) {
      setContactInfo('Please enter a message.');
      return;
    }
    const { error } = await supabase.from('app_6571a533ec_contacts').insert({
      email: contactEmail || null,
      message: contactMsg.trim(),
    });
    if (error) setContactInfo(error.message);
    else {
      setContactInfo('Message sent. Thank you!');
      setContactEmail('');
      setContactMsg('');
    }
  };

  // Share helpers
  const shareCountry = countryNameFromCode(lastCountry);
  const shareText = `I just added my click from ${shareCountry} to One Click, One World 🌍. Can you beat us?`;
  const xShareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  const tryWebShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, title: 'One Click, One World' });
      } catch {
        // ignore
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      alert('Share text copied. Paste it in your social app!');
    }
  };

  // Tooltip content and responsive clamp to viewport (mobile-friendly)
  const tooltipVisible = hover.code && (counts[hover.code] || 0) > 0;
  const tooltipLabel = hover.code ? `${hover.code} • ${counts[hover.code] ?? 0} clicks` : '';
  const tooltipStyle: React.CSSProperties = {
    left: Math.min(Math.max(8, hover.x + 10), typeof window !== 'undefined' ? window.innerWidth - 160 : 360),
    top: Math.min(Math.max(8, hover.y + 10), typeof window !== 'undefined' ? window.innerHeight - 44 : 640),
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Fullscreen background image */}
      <img
        src="/assets/uploads/sa.png"
        alt="Background"
        className="absolute inset-0 w-full h-full object-cover -z-10"
      />

      {/* Top-left menu */}
      <div className="fixed top-4 left-4 z-30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="
                rounded-md border border-cyan-400/30
                bg-[rgba(6,13,23,0.92)] hover:bg-[rgba(6,13,23,0.85)]
                text-white p-2 shadow-[0_0_14px_rgba(34,211,238,0.35)]
                transition
                flex items-center justify-center
              "
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="
              w-[86vw] sm:w-56 border border-cyan-400/30
              bg-[rgba(6,13,23,0.92)]
              text-white shadow-[0_0_20px_rgba(124,58,237,0.25)]
              backdrop-blur-md
            "
          >
            {/* Admin view: Panel + Logout */}
            {signedIn && isAdmin && (
              <>
                <DropdownMenuItem className="gap-2" onClick={() => navigate('/admin')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-green-300">
                    <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Panel
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={onLogout}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-red-300">
                    <path d="M10 6h4v12h-4z" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M8 12h10M16 9l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Logout
                </DropdownMenuItem>
              </>
            )}

            {/* User view: Logout only */}
            {signedIn && !isAdmin && (
              <DropdownMenuItem className="gap-2" onClick={onLogout}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-red-300">
                  <path d="M10 6h4v12h-4z" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 12h10M16 9l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Logout
              </DropdownMenuItem>
            )}

            {/* Guest view: Login / Sign up */}
            {!signedIn && (
              <DropdownMenuItem className="gap-2" onClick={() => open('register')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-purple-300">
                  <path d="M12 12a4 4 0 100-8 4 4 0 000 8Z" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4 20a8 8 0 0116 0" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                Login / Sign up
              </DropdownMenuItem>
            )}

            {/* Common items */}
            <DropdownMenuItem className="gap-2" onClick={() => open('world')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-cyan-300">
                <path d="M12 2a10 10 0 100 20 10 10 0 000-20Z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2 12h20M12 2c3 3.5 3 16.5 0 20M12 2c-3 3.5-3 16.5 0 20" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              World Stats
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => open('settings')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-indigo-300">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6Z" stroke="currentColor" strokeWidth="1.6" />
                <path d="M19.4 15a7.97 7.97 0 00.1-6l2-1.2-2-3.5-2.3 1a8 8 0 00-5.2-3L9.6 1H6l-.5 2.3a8 8 0 00-5.2 3L-1 6.3l2 3.5 2-1.2a8 8 0 000 6l-2 1.2 2 3.5 2.4 1a8 8 0 005.1 3l.6 2.3h3.5l.6-2.3a8 8 0 005.1-3l2.4 1 2-3.5-2-1.2Z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => open('about')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-cyan-300">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8h.01M11 12h2v6h-2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              About
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => open('contact')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-fuchsia-300">
                <path d="M3 6h18v12H3z" stroke="currentColor" strokeWidth="1.6" />
                <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              Contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Top-right visible auth/admin actions for clarity */}
      <div className="fixed top-4 right-4 z-30 flex items-center gap-2">
        {!signedIn && (
          <button
            type="button"
            onClick={() => open('register')}
            className="rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-white text-xs px-3 py-1.5 transition"
          >
            Login / Sign up
          </button>
        )}
        {signedIn && !isAdmin && (
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-white text-xs px-3 py-1.5 transition"
          >
            Logout
          </button>
        )}
        {signedIn && isAdmin && (
          <>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="rounded-md border border-emerald-300/40 bg-emerald-600/20 hover:bg-emerald-500/25 text-emerald-200 text-xs px-3 py-1.5 transition"
            >
              Panel
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-white text-xs px-3 py-1.5 transition"
            >
              Logout
            </button>
          </>
        )}
      </div>

      {/* World map overlay */}
      <WorldBackground onCountrySelect={handleMapCountrySelect} />

      {/* Latest Explorers - right middle ticker (moved from left) */}
      <aside
        className="fixed right-3 md:right-4 top-1/2 -translate-y-1/2 z-30 w-[84vw] sm:w-64 rounded-lg border border-cyan-400/30 bg-[rgba(6,13,23,0.7)] backdrop-blur-sm text-white px-3 py-2 shadow-[0_0_16px_rgba(34,211,238,0.22)]"
        aria-label="Latest Explorers"
      >
        <div className="text-xs tracking-wide text-cyan-200/90">Latest Explorers</div>
        <div className="mt-2 space-y-1 overflow-hidden">
          {latest.map((it) => (
            <div
              key={it.id}
              className="text-xs flex items-center gap-2 animate-in fade-in slide-in-from-right-6 duration-500"
              title={`${it.email} • ${it.countryName}`}
            >
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              <span className="font-medium">{it.email}</span>
              <span className="text-white/70">from</span>
              <span className="text-cyan-200">{it.countryName}</span>
            </div>
          ))}
          {latest.length === 0 && (
            <div className="text-[11px] text-white/70">Waiting for explorers...</div>
          )}
        </div>
      </aside>

      {/* Center content: button + slogan */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto flex flex-col items-center gap-4 transform translate-y-[120px] sm:translate-y-[160px] md:translate-y-[180px] lg:translate-y-[190px]">
          <CircleButton onClick={handleIncrement} />
          <div className="mt-3 text-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            <div className="text-lg font-semibold">Click to Light Up the World</div>
            <div className="text-xs text-white/80">Watch countries pulse with each click</div>
          </div>
        </div>
      </div>

      {/* Tooltip (hover near centroid) */}
      {tooltipVisible && (
        <div
          className="fixed z-40 px-2 py-1 rounded-md text-[11px] text-black bg-white/90 shadow-lg border border-white/50"
          style={tooltipStyle}
        >
          {tooltipLabel}
        </div>
      )}

      {/* Show/Hide Leaderboard Toggle (controls both windows) */}
      <button
        type="button"
        aria-pressed={showLeaderboard}
        onClick={() =>
          setShowLeaderboard((prev) => {
            const next = !prev;
            setShowGlobalNetwork(next);
            return next;
          })
        }
        className={clsx(
          'fixed left-4 bottom-4 z-30 rounded-full border border-cyan-400/30',
          'bg-[rgba(6,13,23,0.92)] hover:bg-[rgba(6,13,23,0.85)] text-white text-xs font-medium',
          'px-3 py-1.5 shadow-[0_0_12px_rgba(34,211,238,0.35)] transition'
        )}
        title={showLeaderboard ? 'Hide Leaderboard' : 'Show Leaderboard'}
      >
        {showLeaderboard ? 'Hide Leaderboard' : 'Show Leaderboard'}
      </button>

      {showLeaderboard && <Leaderboard />}

      {/* Bottom social icons */}
      <div
        className="
          fixed bottom-3 left-1/2 -translate-x-1/2 z-30
          flex items-center gap-4 px-4 py-2
          rounded-full border border-white/20 bg-[rgba(6,13,23,0.65)] backdrop-blur-md
          shadow-[0_0_12px_rgba(34,211,238,0.25)]
        "
        aria-label="Social links"
      >
        <a href={xShareUrl} target="_blank" rel="noopener noreferrer" aria-label="X" className="text-white/90 hover:text-gray-300 transition">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </a>
        <button onClick={tryWebShare} aria-label="TikTok" className="text-white/90 hover:text-fuchsia-300 transition">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 3c1.3 1.4 3 2.3 5 2.4v3.1c-1.9-.2-3.7-1-5-2.2V15a5 5 0 11-5-5h1v3h-1a2 2 0 100 4 2 2 0 002-2V3h3z" fill="currentColor" />
          </svg>
        </button>
        <button onClick={async () => { await navigator.clipboard.writeText(shareText); alert('Share text copied. Paste it in Instagram!'); }} aria-label="Instagram" className="text-white/90 hover:text-pink-300 transition">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* Bottom-right GLOBAL NETWORK box */}
      {showGlobalNetwork && (
        <aside
          className="
            fixed right-4 bottom-4 z-30 w-48 rounded-lg border border-fuchsia-400/30 bg-white/5
            shadow-[0_0_16px_rgba(232,121,249,0.22)] backdrop-blur-md text-white px-3 py-2
          "
          aria-label="Global Network Counter"
        >
          <div className="text-[11px] tracking-wide text-white/80">GLOBAL NETWORK</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums">
            {globalTotal.toLocaleString()}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowLeaderboard(false);
              setShowGlobalNetwork(false);
            }}
            className="mt-2 w-full rounded-md border border-white/20 bg-white/10 hover:bg-white/15 text-white text-xs px-2 py-1 transition"
            title="Hide Global network"
          >
            Hide Global network
          </button>
        </aside>
      )}

      {/* Modals (World Stats, Settings, Login/Sign up, About, Contact, Share, Already) */}
      <Dialog open={!!openModal} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="w-[92vw] sm:w-auto max-w-md border-cyan-400/30 bg-[rgba(6,13,23,0.92)] text-white shadow-[0_0_20px_rgba(124,58,237,0.25)] backdrop-blur-md">
          {openModal === 'world' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-cyan-300">Top 20 Countries</DialogTitle>
              </DialogHeader>
              <div className="mt-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {top20.map((r, i) => (
                  <div key={r.country_code} className="flex justify-between text-sm">
                    <div className="text-white/90">{i + 1}. {r.country_code}</div>
                    <div className="text-white/70">{r.clicks.toLocaleString()}</div>
                  </div>
                ))}
                {top20.length === 0 && <div className="text-white/60 text-sm">No data yet.</div>}
              </div>
            </>
          )}

          {openModal === 'settings' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-indigo-300">Settings</DialogTitle>
              </DialogHeader>
              <div className="mt-3 space-y-3 text-sm">
                <label className="flex items-center justify-between">
                  <span className="text-white/90">Show Leaderboard & Network</span>
                  <input
                    type="checkbox"
                    checked={showLeaderboard && showGlobalNetwork}
                    onChange={(e) => {
                      setShowLeaderboard(e.target.checked);
                      setShowGlobalNetwork(e.target.checked);
                    }}
                    className="accent-cyan-400"
                  />
                </label>
              </div>
            </>
          )}

          {openModal === 'register' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-purple-300">Login / Sign up</DialogTitle>
              </DialogHeader>
              <form className="mt-3 space-y-3 text-sm" onSubmit={onRegisterSubmit}>
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="Email"
                  required
                  className="w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-white placeholder-white/50 outline-none focus:border-purple-400"
                />
                <input
                  type="password"
                  value={regPass}
                  onChange={(e) => setRegPass(e.target.value)}
                  placeholder="Password"
                  required
                  className="w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-white placeholder-white/50 outline-none focus:border-purple-400"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onLoginClick}
                    className="w-1/2 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-semibold px-3 py-2 transition"
                  >
                    Login
                  </button>
                  <button
                    type="submit"
                    className="w-1/2 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-semibold px-3 py-2 transition"
                  >
                    Sign up
                  </button>
                </div>
                {regMsg && <div className="text-white/80 text-xs">{regMsg}</div>}
              </form>
            </>
          )}

          {openModal === 'about' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-cyan-300">About</DialogTitle>
              </DialogHeader>
              <div className="mt-2 text-sm text-white/85">
                This project lights up countries across the world with each click. It’s a minimal,
                futuristic experience: your click sends a pulse to your country, grows the global network,
                and updates live stats. Built on Supabase + React with a neon map aesthetic.
              </div>
            </>
          )}

          {openModal === 'contact' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-fuchsia-300">Contact</DialogTitle>
              </DialogHeader>
              <form className="mt-3 space-y-3 text-sm" onSubmit={onContact}>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Your email (optional)"
                  className="w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-white placeholder-white/50 outline-none focus:border-fuchsia-400"
                />
                <textarea
                  value={contactMsg}
                  onChange={(e) => setContactMsg(e.target.value)}
                  placeholder="Your message"
                  required
                  rows={4}
                  className="w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-white placeholder-white/50 outline-none focus:border-fuchsia-400"
                />
                <button
                  type="submit"
                  className="w-full rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold px-3 py-2 transition"
                >
                  Send
                </button>
                {contactInfo && <div className="text-white/80 text-xs">{contactInfo}</div>}
              </form>
            </>
          )}

          {openModal === 'share' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-green-300">Share your click</DialogTitle>
              </DialogHeader>
              <div className="mt-2 space-y-3 text-sm">
                <div className="text-white/85">
                  One-click buttons to share on X (Twitter), TikTok, Instagram:
                </div>
                <div className="rounded-md border border-white/20 bg-white/5 p-3 text-white/90">
                  “I just added my click from <span className="font-semibold">{shareCountry}</span> to One Click, One World 🌍. Can you beat us?”
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={xShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-black/60 hover:bg-black/50 border border-gray-400/40 text-white text-xs px-3 py-1.5 transition"
                  >
                    Share on X
                  </a>
                  <button
                    onClick={tryWebShare}
                    className="rounded-md bg-fuchsia-600/80 hover:bg-fuchsia-600 border border-fuchsia-300/40 text-white text-xs px-3 py-1.5 transition"
                  >
                    Share on TikTok
                  </button>
                  <button
                    onClick={async () => { await navigator.clipboard.writeText(shareText); alert('Copied! Paste in Instagram.'); }}
                    className="rounded-md bg-pink-600/80 hover:bg-pink-600 border border-pink-300/40 text-white text-xs px-3 py-1.5 transition"
                  >
                    Share on Instagram
                  </button>
                </div>
              </div>
            </>
          )}

          {openModal === 'already' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-yellow-300">Already clicked</DialogTitle>
              </DialogHeader>
              <div className="mt-2 space-y-3 text-sm">
                <div className="rounded-md border border-white/20 bg-white/5 p-3 text-white/90">
                  You’ve already clicked! 🚀 Share this and help your country climb the leaderboard 📈
                </div>
                <div className="rounded-md border border-white/20 bg-white/5 p-3 text-white/90">
                  “I just added my click from <span className="font-semibold">{shareCountry}</span> to One Click, One World 🌍. Can you beat us?”
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={xShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-black/60 hover:bg-black/50 border border-gray-400/40 text-white text-xs px-3 py-1.5 transition"
                  >
                    Share on X
                  </a>
                  <button
                    onClick={tryWebShare}
                    className="rounded-md bg-fuchsia-600/80 hover:bg-fuchsia-600 border border-fuchsia-300/40 text-white text-xs px-3 py-1.5 transition"
                  >
                    Share on TikTok
                  </button>
                  <button
                    onClick={async () => { await navigator.clipboard.writeText(shareText); alert('Copied! Paste in Instagram.'); }}
                    className="rounded-md bg-pink-600/80 hover:bg-pink-600 border border-pink-300/40 text-white text-xs px-3 py-1.5 transition"
                  >
                    Share on Instagram
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}