import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LOGO_URL = '';

// ── Voting-themed watermark icons ───────────────────────────────────────────
// Each entry: [iconType, left%, top%, sizePx, rotateDeg]
const WATERMARKS: [number, number, number, number, number][] = [
    // type 0=envelope  1=ballot  2=check  3=person  4=hand  5=document  6=shield  7=pencil
    [0, 2,   3,  42,  -12], [1, 14,  1,  36,   8], [2, 26,  4,  50, -20], [3, 38,  2,  40,  10], [4, 52,  0,  44, -15], [5, 66,  3,  38,   5], [6, 80,  1,  46, -10], [7, 92,  5,  34,  18],
    [7, 4,  14,  34,  15],  [0, 17, 12,  48, -8],  [1, 29, 15,  38,  22], [2, 43, 11,  44, -18], [3, 57, 13,  36,   6], [4, 70, 16,  52, -12], [5, 83, 12,  40,  14], [6, 95, 15,  42,  -6],
    [5, 1,  26,  46,  20],  [6, 12, 24,  36,  -5], [7, 24, 27,  54, -22], [0, 36, 25,  40,  12], [1, 49, 23,  48,  -9], [2, 62, 26,  36,  20], [3, 75, 24,  44, -16], [4, 88, 28,  38,   8],
    [3, 6,  38,  40,  -8],  [4, 20, 36,  52,  16], [5, 33, 39,  36,  -4], [6, 47, 37,  46,  24], [7, 61, 35,  40, -14], [0, 74, 38,  48,   6], [1, 87, 36,  34, -20], [2, 98, 40,  44,  10],
    [1, 3,  50,  38,  12],  [2, 16, 48,  44, -18], [3, 28, 51,  50,   8], [4, 41, 49,  36, -10], [5, 54, 52,  48,  22], [6, 67, 50,  40,  -6], [7, 81, 48,  36,  16], [0, 93, 52,  52, -14],
    [6, 5,  62,  44,  -4],  [7, 18, 60,  38,  18], [0, 31, 63,  46, -12], [1, 44, 61,  34,   6], [2, 57, 64,  52, -22], [3, 71, 62,  40,  14], [4, 84, 60,  44,  -8], [5, 96, 65,  36,  20],
    [4, 2,  74,  48, -16],  [5, 14, 72,  40,  10], [6, 27, 75,  36, -24], [7, 40, 73,  50,   4], [0, 53, 76,  38,  -6], [1, 66, 74,  44,  20], [2, 79, 72,  48, -12], [3, 92, 77,  36,   8],
    [2, 7,  86,  36,   6],  [3, 20, 84,  48, -14], [4, 33, 87,  40,  22], [5, 46, 85,  36, -10], [6, 59, 88,  52,  16], [7, 72, 86,  38,  -4], [0, 85, 84,  44,  18], [1, 97, 89,  40, -20],
];

// Individual icon SVG paths (24×24 viewBox, stroke only, no fill)
function IconPath({ type }: { type: number }) {
    const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (type) {
        case 0: // Envelope
            return <><rect x="2" y="4" width="20" height="16" rx="2" {...s}/><polyline points="2,4 12,13 22,4" {...s}/></>;
        case 1: // Ballot box
            return <><rect x="3" y="8" width="18" height="14" rx="1" {...s}/><path d="M8 8V5a2 2 0 014 0v3" {...s}/><path d="M9 14l2 2 4-4" {...s}/><line x1="8" y1="5" x2="16" y2="5" {...s}/></>;
        case 2: // Checkmark
            return <><circle cx="12" cy="12" r="10" {...s}/><polyline points="7,12.5 10.5,16 17,9" {...s}/></>;
        case 3: // Person
            return <><circle cx="12" cy="7" r="4" {...s}/><path d="M4 21v-1a8 8 0 0116 0v1" {...s}/></>;
        case 4: // Raised hand / vote
            return <><path d="M12 2v10M8 5v7M16 5v7M6 10v5a6 6 0 0012 0v-5" {...s}/><path d="M6 10a2 2 0 00-2 2v1a8 8 0 0016 0v-1a2 2 0 00-2-2" {...s}/></>;
        case 5: // Clipboard / document
            return <><rect x="5" y="3" width="14" height="19" rx="2" {...s}/><path d="M9 3h6v3H9V3z" {...s}/><line x1="9" y1="11" x2="15" y2="11" {...s}/><line x1="9" y1="15" x2="13" y2="15" {...s}/></>;
        case 6: // Shield
            return <><path d="M12 2L3 7v6c0 5.25 4.05 10.15 9 11 4.95-.85 9-5.75 9-11V7L12 2z" {...s}/><polyline points="9,12 11,14 15,10" {...s}/></>;
        case 7: // Pencil / pen
            return <><path d="M17 3a2.85 2.83 0 014 4L7.5 20.5 2 22l1.5-5.5L17 3z" {...s}/><line x1="15" y1="5" x2="19" y2="9" {...s}/></>;
        default: return null;
    }
}

const VotingWatermark: React.FC = () => (
    <div
        className="absolute inset-0 pointer-events-none select-none overflow-hidden"
        aria-hidden="true"
        style={{ opacity: 0.065 }}
    >
        {WATERMARKS.map(([type, left, top, size, rotate], i) => (
            <div
                key={i}
                className="absolute text-zinc-500"
                style={{
                    left:      `${left}%`,
                    top:       `${top}%`,
                    width:     size,
                    height:    size,
                    transform: `rotate(${rotate}deg)`,
                }}
            >
                <svg viewBox="0 0 24 24" width={size} height={size}>
                    <IconPath type={type} />
                </svg>
            </div>
        ))}
    </div>
);
// ────────────────────────────────────────────────────────────────────────────

const Layout: React.FC = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const [logoClicks, setLogoClicks] = useState(0);
    const [logoScale, setLogoScale]   = useState(false);

    const isAdminPage = location.pathname === '/admin' || location.pathname === '/admin/login';

    const handleSecretClick = () => {
        setLogoScale(true);
        setTimeout(() => setLogoScale(false), 150);
        const newCount = logoClicks + 1;
        setLogoClicks(newCount);
        if (newCount >= 5) { setLogoClicks(0); navigate('/admin/login'); }
        setTimeout(() => setLogoClicks(0), 2000);
    };

    return (
        <div className="min-h-screen bg-stone-50 font-sans flex flex-col overflow-hidden text-zinc-900 relative">

            {/* ── HEADER ───────────────────────────────────────────────── */}
            <header className="bg-zinc-900 text-white px-6 py-4 flex flex-col sm:flex-row justify-between items-center border-b-4 border-yellow-500 space-y-4 sm:space-y-0 relative z-10 w-full shrink-0">
                <div className="flex items-center space-x-4">
                    <div
                        onClick={handleSecretClick}
                        title="Demo"
                        className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 cursor-pointer select-none overflow-hidden border-2 border-yellow-500 transition-transform duration-150 ${logoScale ? 'scale-110' : 'scale-100'}`}
                    >
                        {LOGO_URL ? (
                            <img src={LOGO_URL} alt="Council Logo" className="w-full h-full object-cover rounded-full" />
                        ) : (
                            <div className="w-full h-full bg-yellow-500 flex items-center justify-center">
                                <span className="text-zinc-900 font-black text-sm tracking-tight">NUSC</span>
                            </div>
                        )}
                    </div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black tracking-tight uppercase leading-tight">
                            NorthSetif University Student Council
                        </h1>
                        <p className="text-yellow-400 text-[10px] font-bold tracking-widest uppercase mt-0.5">
                            Live Demo &nbsp;·&nbsp; Electoral Portal &nbsp;·&nbsp; Fictional Data
                        </p>
                    </div>
                </div>

                {user && (
                    <div className="flex items-center space-x-5">
                        <div className="text-right border-r border-zinc-700 pr-5">
                            <p className={`text-[10px] uppercase tracking-widest font-bold ${isAdminPage ? 'text-yellow-400' : 'text-zinc-400'}`}>
                                {isAdminPage ? 'Elevated Access' : 'Verified Identity'}
                            </p>
                            <p className="font-mono text-sm text-white">
                                {isAdminPage ? 'ROLE: ADMINISTRATOR' : `MATRIC: ${user.matNumber}`}
                            </p>
                        </div>
                        <div className={`px-4 py-2 rounded text-xs font-bold flex items-center border ${isAdminPage ? 'bg-yellow-500 text-zinc-900 border-yellow-600' : 'bg-zinc-800 text-white border-zinc-700'}`}>
                            <span className={`w-2 h-2 rounded-full mr-2 ${isAdminPage ? 'bg-zinc-900' : 'bg-green-400 animate-pulse'}`}></span>
                            {isAdminPage ? 'SECURE MODE' : 'SESSION ACTIVE'}
                        </div>
                    </div>
                )}
            </header>

            {/* ── CONTENT AREA (watermark lives here) ──────────────────── */}
            <div className="flex-1 relative overflow-hidden">

                {/* Voting watermark — behind everything */}
                <VotingWatermark />

                {/* Page content — above the watermark */}
                <main className="relative z-10 max-w-7xl w-full mx-auto p-4 sm:p-10 flex flex-col sm:flex-row min-h-full">
                    <Outlet />
                </main>
            </div>

            {/* ── FOOTER ───────────────────────────────────────────────── */}
            <footer className="bg-zinc-900 shrink-0 select-none border-t-2 border-yellow-500 relative z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">

                    <div className="text-[11px] font-semibold text-zinc-500 tracking-wide text-center sm:text-left">
                        © 2026 NorthSetif Electoral Committee Portfolio Demo, Not a Real Election.
                    </div>

                    <div className="flex items-center gap-5">
                        {/* GitHub */}
                        <a href="https://github.com/Innocebelz" target="_blank" rel="noreferrer" title="Source on GitHub" className="text-zinc-500 hover:text-white transition-colors duration-200">
                            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.11.79-.25.79-.56 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.41-5.28 5.69.42.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.24 0 .32.21.68.8.56C20.71 21.39 24 17.08 24 12c0-6.27-5.23-11.5-12-11.5z"/></svg>
                        </a>
                        {/* Portfolio link */}
                        <a href="https://bulumaenosi-portifolio.vercel.app/" target="_blank" rel="noreferrer" title="My Portfolio" className="text-zinc-500 hover:text-yellow-400 transition-colors duration-200">
                            <svg className="w-6 h-6 fill-none stroke-current" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                        </a>
                        {/* LinkedIn */}
                        <a href="https://linkedin.com/bulumaenosi" target="_blank" rel="noreferrer" title="LinkedIn" className="text-zinc-500 hover:text-[#0A66C2] transition-colors duration-200">
                            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
                        </a>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Status:</span>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"/>
                            <span className="text-[10px] text-zinc-500 font-mono tracking-tight">ONLINE</span>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Layout;
