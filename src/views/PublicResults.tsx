import React, { useState, useEffect, useRef } from 'react';
import { ELECTION_DATA, RUNOFF_ELECTION_DATA } from '../constants';
import {
    Users, TrendingUp, Search,
    CheckCircle2, XCircle, Loader2, Clock, Share2, Check, ShieldCheck, MinusCircle, Vote
} from 'lucide-react';

const BACKEND_URL =  'https://usaavotingdemo.onrender.com';

function useCountUp(target: number, duration = 1200, delay = 0) {
    const [value, setValue] = useState(0);
    const raf = useRef<number>(0);
    useEffect(() => {
        if (!target) { setValue(0); return; }
        const t = setTimeout(() => {
            let start: number | null = null;
            const step = (ts: number) => {
                if (!start) start = ts;
                const p = Math.min((ts - start) / duration, 1);
                setValue(Math.round((1 - Math.pow(1 - p, 3)) * target));
                if (p < 1) raf.current = requestAnimationFrame(step);
            };
            raf.current = requestAnimationFrame(step);
        }, delay);
        return () => { clearTimeout(t); cancelAnimationFrame(raf.current); };
    }, [target, duration, delay]);
    return value;
}

interface CandidateResult { candidate_id: string; votes: number; }
interface Tally { [position: string]: CandidateResult[]; }
interface Turnout {
    total_eligible:     number;
    votes_cast:         number;
    total_ballots_cast: number;   // source of truth for per-position % and 50% threshold
    turnout_percentage: number;
}

interface WinnerInfo {
    candidate: { id: string; name: string; image: string; votes: number } | null;
    pct:    number;
    reason: 'winner' | 'failed_threshold' | 'tied' | 'no_votes' | 'runoff_pending';
}

interface RunoffInfo {
    active:    boolean;
    open:      boolean;
    positions: string[];
    results:   Tally | null;
    turnout:   Turnout | null;
}

const PublicResults: React.FC = () => {
    const [status, setStatus]           = useState<'loading' | 'in_progress' | 'closed'>('loading');
    const [tally, setTally]             = useState<Tally | null>(null);
    const [turnout, setTurnout]         = useState<Turnout | null>(null);
    const [runoff, setRunoff]           = useState<RunoffInfo | null>(null);
    const [visible, setVisible]         = useState(false);

    const [receiptInput, setReceiptInput] = useState('');
    const [verifying, setVerifying]       = useState(false);
    const [verifyResult, setVerifyResult] = useState<'counted' | 'not_found' | null>(null);

    const [shareCopied, setShareCopied] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 30);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        let cancelled = false;
        let pollTimer: ReturnType<typeof setTimeout> | undefined;

        const fetchResults = async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/api/public/results`);
                if (!res.ok) throw new Error(`Results request failed: ${res.status}`);
                const data = await res.json();
                if (cancelled) return;

                if (data.status === 'in_progress') {
                    setStatus('in_progress');
                    // Poll while voting is still open so the page flips to
                    // results automatically once the election closes,
                    // instead of requiring a manual refresh.
                    pollTimer = setTimeout(fetchResults, 30000);
                } else if (data.status === 'closed') {
                    setStatus('closed');
                    setTally(data.results);
                    setTurnout(data.turnout);
                    setRunoff(data.runoff ?? null);

                    // Keep polling while a runoff is underway so this page
                    // flips from "Runoff In Progress" to the final runoff
                    // winner automatically once the EC closes it — same as
                    // how the general election flips from in-progress to
                    // closed above.
                    if (data.runoff?.active && data.runoff?.open) {
                        pollTimer = setTimeout(fetchResults, 30000);
                    }
                }
            } catch (e) {
                console.error('Failed to load results:', e);
            }
        };
        fetchResults();

        return () => {
            cancelled = true;
            if (pollTimer) clearTimeout(pollTimer);
        };
    }, []);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!receiptInput.trim()) return;
        try {
            setVerifyResult(null);
            setVerifying(true);
            const res = await fetch(`${BACKEND_URL}/api/verify-ballot/${encodeURIComponent(receiptInput.trim())}`);
            if (!res.ok) throw new Error(`Verify request failed: ${res.status}`);
            const data = await res.json();
            setVerifyResult(data.counted ? 'counted' : 'not_found');
        } catch {
            setVerifyResult('not_found');
        } finally {
            setVerifying(false);
        }
    };

    const handleShare = async () => {
        const shareData = {
            title: 'NorthSetif Student Council Election Results',
            text:  'See the official results of the NorthSetif Student Council Election.',
            url:   window.location.href,
        };
        if (navigator.share) {
            try { await navigator.share(shareData); } catch { /* user cancelled — ignore */ }
        } else {
            try {
                await navigator.clipboard.writeText(window.location.href);
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 2000);
            } catch { /* clipboard unavailable — silently ignore */ }
        }
    };

    // General-election results — always reflects the ORIGINAL first-round
    // tally for every position, including President and Minister of
    // Education. This never gets swapped out for runoff data — the runoff
    // is shown as its own separate section further down the page, so
    // visitors can see both what happened in round one AND the runoff
    // outcome side by side, instead of one replacing the other.
    const buildResults = (dbKey: string) => {
        const category = ELECTION_DATA.find(c => c.dbKey === dbKey);
        if (!category || !tally) return null;
        const raw      = tally[dbKey] ?? [];
        const voteMap  = Object.fromEntries(raw.map(r => [r.candidate_id, r.votes]));
        const total    = raw.reduce((s, r) => s + r.votes, 0);
        const candidates = category.candidates
            .map(c => ({ ...c, votes: voteMap[c.id] ?? 0 }))
            .sort((a, b) => b.votes - a.votes);
        return { label: category.position, candidates, total };
    };

    // Runoff-election results — only ever has data for the 2 runoff
    // positions, and only once the runoff has closed. Used exclusively by
    // the dedicated "Runoff Election" section below.
    const buildRunoffResults = (dbKey: string) => {
        if (!runoff?.results) return null;
        const category = RUNOFF_ELECTION_DATA.find(c => c.dbKey === dbKey);
        if (!category) return null;
        const raw     = runoff.results[dbKey] ?? [];
        const voteMap = Object.fromEntries(raw.map(r => [r.candidate_id, r.votes]));
        const total   = raw.reduce((s, r) => s + r.votes, 0);
        const candidates = category.candidates
            .map(c => ({ ...c, votes: voteMap[c.id] ?? 0 }))
            .sort((a, b) => b.votes - a.votes);
        return { label: category.position, candidates, total };
    };

    // ── Single source of truth for "who won this position" ──────────────
    // Used by BOTH the winner spotlight grid and the detailed breakdown
    // below, so the two sections can never disagree with each other.
    // Always reflects the ORIGINAL first-round result — see buildResults.
    const getWinnerInfo = (dbKey: string): WinnerInfo | null => {
        const result   = buildResults(dbKey);
        const category = ELECTION_DATA.find(c => c.dbKey === dbKey);
        if (!result || !category) return null;

        const { candidates } = result;
        const totalBallotsCast = turnout?.total_ballots_cast ?? turnout?.votes_cast ?? 0;

        if (category.unopposed) {
            const only = candidates[0];
            const pct  = totalBallotsCast > 0 ? Math.round(((only?.votes ?? 0) / totalBallotsCast) * 100) : 0;
            const cleared50 = !!only && only.votes >= (totalBallotsCast / 2) && only.votes > 0;
            return {
                candidate: cleared50 ? only : null,
                pct,
                reason: cleared50 ? 'winner' : (only && only.votes > 0 ? 'failed_threshold' : 'no_votes'),
            };
        } else {
            // The 50% Vote of Confidence rule applies here too: a
            // competitive candidate needs BOTH a plurality (more votes
            // than every opponent) AND at least half of all ballots cast
            // in the election to be declared elected.
            const top  = candidates[0];
            const next = candidates[1];
            const pct  = totalBallotsCast > 0 && top ? Math.round((top.votes / totalBallotsCast) * 100) : 0;

            const isTied       = !!top && !!next && top.votes === next.votes && top.votes > 0;
            const hasPlurality = !!top && top.votes > 0 && !isTied && (!next || top.votes > next.votes);
            const cleared50    = hasPlurality && top.votes >= (totalBallotsCast / 2);

            return {
                candidate: cleared50 ? top : null,
                pct,
                reason: cleared50
                    ? 'winner'
                    : (isTied ? 'tied' : (hasPlurality ? 'failed_threshold' : 'no_votes')),
            };
        }
    };

    // Winner logic for the dedicated Runoff section only — a simple 2-way
    // race, so it's just plurality + the same 50% Vote of Confidence rule.
    const getRunoffWinnerInfo = (dbKey: string): WinnerInfo | null => {
        if (!runoff?.active || !runoff.positions.includes(dbKey)) return null;
        if (runoff.open || !runoff.results) {
            return { candidate: null, pct: 0, reason: 'runoff_pending' };
        }

        const result = buildRunoffResults(dbKey);
        if (!result) return null;
        const { candidates } = result;
        const totalBallotsCast = runoff.turnout?.total_ballots_cast ?? runoff.turnout?.votes_cast ?? 0;

        const top  = candidates[0];
        const next = candidates[1];
        const pct  = totalBallotsCast > 0 && top ? Math.round((top.votes / totalBallotsCast) * 100) : 0;

        const isTied       = !!top && !!next && top.votes === next.votes && top.votes > 0;
        const hasPlurality = !!top && top.votes > 0 && !isTied && (!next || top.votes > next.votes);
        const cleared50    = hasPlurality && top.votes >= (totalBallotsCast / 2);

        return {
            candidate: cleared50 ? top : null,
            pct,
            reason: cleared50
                ? 'winner'
                : (isTied ? 'tied' : (hasPlurality ? 'failed_threshold' : 'no_votes')),
        };
    };

    const positionKeys  = ELECTION_DATA.map(c => c.dbKey);
    const animPct       = useCountUp(turnout?.turnout_percentage ?? 0, 1200, 400);
    const animCast      = useCountUp(turnout?.votes_cast          ?? 0, 1000, 500);
    const animEligible  = useCountUp(turnout?.total_eligible      ?? 0, 1000, 600);
    const animRunoffPct = useCountUp(runoff?.turnout?.turnout_percentage ?? 0, 1200, 400);

    const R       = 15.9155;
    const CIRCUMF = 2 * Math.PI * R;
    const offset  = CIRCUMF - (animPct / 100) * CIRCUMF;
    const runoffOffset = CIRCUMF - (animRunoffPct / 100) * CIRCUMF;

    if (status === 'loading') return (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-zinc-500">
            <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
            <p className="text-xs font-black uppercase tracking-widest">Loading Results...</p>
        </div>
    );

    if (status === 'in_progress') return (
        <div className={`w-full max-w-lg mx-auto self-center transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden shadow-sm text-center">
                <div className="h-1.5 bg-yellow-500 w-full" />
                <div className="p-10">
                    <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-yellow-500">
                        <Clock className="w-8 h-8 text-yellow-400" />
                    </div>
                    <h1 className="text-2xl font-black text-zinc-900 uppercase tracking-tight mb-3">
                        Election In Progress
                    </h1>
                    <p className="text-zinc-500 text-sm font-medium leading-relaxed">
                        Voting is currently open. Results will be published here
                        as soon as the Electoral Commission closes the election.
                    </p>
                    <div className="mt-6 flex items-center justify-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-xs font-black text-zinc-400 uppercase tracking-widest">
              Accepting votes now
            </span>
                    </div>
                </div>
            </div>
        </div>
    );

    // ── Winner spotlight card renderer — shared by President's large
    // spotlight and the 2-column grid for the other 6 positions ──────────
    const renderWinnerCard = (categoryLabel: string, info: WinnerInfo, large = false) => {
        if (info.reason === 'winner' && info.candidate) {
            const c = info.candidate;
            return (
                <div className={`relative bg-white rounded-2xl border-2 border-yellow-300 overflow-hidden shadow-md ${large ? 'p-7' : 'p-5'}`}>
                    <div className="absolute top-0 right-0 w-28 h-28 bg-yellow-400/10 rounded-full -mr-10 -mt-10" aria-hidden="true" />
                    <div className="relative flex flex-col items-center text-center">
                        <div className="relative mb-3">
                            <img
                                src={c.image}
                                alt={c.name}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src =
                                        `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=18181b&color=eab308&size=256`;
                                }}
                                className={`${large ? 'w-28 h-28' : 'w-20 h-20'} rounded-full object-cover border-4 border-yellow-400`}
                            />
                            <div className={`absolute -bottom-1 -right-1 ${large ? 'w-10 h-10' : 'w-8 h-8'} bg-yellow-400 rounded-full flex items-center justify-center border-2 border-white shadow`}>
                                <ShieldCheck className={large ? 'w-5 h-5 text-zinc-900' : 'w-4 h-4 text-zinc-900'} />
                            </div>
                        </div>
                        <p className="text-[10px] font-black text-yellow-600 uppercase tracking-widest mb-1">
                            {categoryLabel}
                        </p>
                        <p className={`font-black text-zinc-900 uppercase ${large ? 'text-xl' : 'text-sm'}`}>
                            {c.name}
                        </p>
                        <p className="text-[9px] font-black text-yellow-700 bg-yellow-100 border border-yellow-300 px-2 py-0.5 rounded-full uppercase tracking-widest mt-1.5 inline-block">
                            Elected
                        </p>
                        <p className="text-xs text-zinc-400 font-bold mt-1.5">
                            {c.votes} vote{c.votes !== 1 ? 's' : ''} · {info.pct}%
                        </p>
                    </div>
                </div>
            );
        }

        if (info.reason === 'failed_threshold') {
            return (
                <div className={`bg-zinc-50 rounded-2xl border-2 border-zinc-200 ${large ? 'p-7' : 'p-5'}`}>
                    <div className="flex flex-col items-center text-center">
                        <div className={`${large ? 'w-20 h-20' : 'w-16 h-16'} rounded-full bg-zinc-100 border-2 border-zinc-300 flex items-center justify-center mb-3`}>
                            <MinusCircle className={large ? 'w-9 h-9 text-zinc-400' : 'w-7 h-7 text-zinc-400'} />
                        </div>
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                            {categoryLabel}
                        </p>
                        <p className={`font-black text-zinc-600 uppercase ${large ? 'text-base' : 'text-sm'}`}>
                            No Candidate Above 50%
                        </p>
                        <p className="text-xs text-zinc-400 font-bold mt-1">
                            Leading candidate reached {info.pct}%
                        </p>
                    </div>
                </div>
            );
        }

        if (info.reason === 'runoff_pending') {
            return (
                <div className={`bg-orange-50 rounded-2xl border-2 border-orange-200 ${large ? 'p-7' : 'p-5'}`}>
                    <div className="flex flex-col items-center text-center">
                        <div className={`${large ? 'w-20 h-20' : 'w-16 h-16'} rounded-full bg-orange-100 border-2 border-orange-300 flex items-center justify-center mb-3`}>
                            <Vote className={large ? 'w-9 h-9 text-orange-500' : 'w-7 h-7 text-orange-500'} />
                        </div>
                        <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">
                            {categoryLabel}
                        </p>
                        <p className={`font-black text-orange-700 uppercase ${large ? 'text-base' : 'text-sm'}`}>
                            Runoff In Progress
                        </p>
                        <p className="text-xs text-orange-500 font-bold mt-1">
                            No candidate reached 50% in round one — results pending
                        </p>
                    </div>
                </div>
            );
        }

        if (info.reason === 'tied') {
            return (
                <div className={`bg-orange-50 rounded-2xl border-2 border-orange-200 ${large ? 'p-7' : 'p-5'}`}>
                    <div className="flex flex-col items-center text-center">
                        <div className={`${large ? 'w-20 h-20' : 'w-16 h-16'} rounded-full bg-orange-100 border-2 border-orange-300 flex items-center justify-center mb-3`}>
                            <Users className={large ? 'w-9 h-9 text-orange-500' : 'w-7 h-7 text-orange-500'} />
                        </div>
                        <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">
                            {categoryLabel}
                        </p>
                        <p className={`font-black text-orange-700 uppercase ${large ? 'text-base' : 'text-sm'}`}>
                            Tied — Runoff Required
                        </p>
                        <p className="text-xs text-orange-500 font-bold mt-1">
                            Leading candidates tied at {info.pct}%
                        </p>
                    </div>
                </div>
            );
        }

        // reason === 'no_votes' — the election is already closed at this
        // point (this component only renders once status === 'closed'),
        // so this means no valid votes were recorded for this position,
        // not that results are still pending.
        return (
            <div className={`bg-zinc-50 rounded-2xl border-2 border-zinc-200 ${large ? 'p-7' : 'p-5'}`}>
                <div className="flex flex-col items-center text-center">
                    <div className={`${large ? 'w-20 h-20' : 'w-16 h-16'} rounded-full bg-zinc-100 border-2 border-zinc-300 flex items-center justify-center mb-3`}>
                        <MinusCircle className={large ? 'w-9 h-9 text-zinc-400' : 'w-7 h-7 text-zinc-400'} />
                    </div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                        {categoryLabel}
                    </p>
                    <p className={`font-black text-zinc-500 uppercase ${large ? 'text-base' : 'text-sm'}`}>
                        No Votes Recorded
                    </p>
                </div>
            </div>
        );
    };

    const presidentCategory = ELECTION_DATA.find(c => c.position.toLowerCase() === 'president');
    const otherCategories    = ELECTION_DATA.filter(c => c.position.toLowerCase() !== 'president');

    return (
        <div className={`w-full max-w-3xl mx-auto space-y-6 py-2 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <div className="text-center pb-4 border-b-2 border-zinc-200">
        <span className="text-[10px] font-black bg-zinc-900 text-yellow-400 px-3 py-1 rounded-full uppercase tracking-widest mb-3 inline-block border border-yellow-500">
          Official Results
        </span>
                <h1 className="text-3xl sm:text-4xl font-black text-zinc-900 uppercase tracking-tight mt-2">
                    NorthSetif Student Council Election
                </h1>
                <p className="text-zinc-400 text-sm font-medium mt-1">
                    Final results · Demo 2026
                </p>

                <button
                    onClick={handleShare}
                    className="mt-4 inline-flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-yellow-400 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full transition-all active:scale-95"
                >
                    {shareCopied ? (
                        <><Check className="w-3.5 h-3.5" /> Link Copied!</>
                    ) : (
                        <><Share2 className="w-3.5 h-3.5" /> Share Results</>
                    )}
                </button>
            </div>

            {/* ── Turnout ────────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                    <div className="h-1 bg-zinc-200" />
                    <div className="p-5 flex flex-col items-center text-center">
                        <Users className="w-5 h-5 text-zinc-300 mb-2" />
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Eligible</p>
                        <p className="text-4xl font-black text-zinc-900 tabular-nums">{animEligible}</p>
                    </div>
                </div>

                <div className="bg-zinc-900 rounded-2xl border-2 border-zinc-900 overflow-hidden">
                    <div className="h-1 bg-yellow-500" />
                    <div className="p-5 flex flex-col items-center text-center">
                        <TrendingUp className="w-5 h-5 text-yellow-400 mb-2" />
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Votes Cast</p>
                        <p className="text-4xl font-black text-white tabular-nums">{animCast}</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                    <div className="h-1 bg-yellow-500" />
                    <div className="p-5 flex flex-col items-center text-center">
                        <div className="relative w-16 h-16 mb-1">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r={R} fill="none" stroke="#f4f4f5" strokeWidth="3.5" />
                                <circle cx="18" cy="18" r={R} fill="none" stroke="#eab308" strokeWidth="3.5"
                                        strokeLinecap="round"
                                        strokeDasharray={`${CIRCUMF} ${CIRCUMF}`}
                                        strokeDashoffset={offset}
                                        style={{ transition: 'stroke-dashoffset 0.05s linear' }}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-sm font-black text-zinc-900 tabular-nums">{animPct}%</span>
                            </div>
                        </div>
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Turnout</p>
                    </div>
                </div>
            </div>

            {/* ── Winner Spotlight Grid ──────────────────────────────────────────── */}
            <div className="space-y-4">
                <div className="text-center pt-2">
                    <h2 className="text-lg font-black text-zinc-900 uppercase tracking-tight flex items-center justify-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-yellow-500" />
                        Elected Representatives
                    </h2>
                    <p className="text-xs text-zinc-400 font-medium mt-1">
                        Official results across all 7 positions
                    </p>
                </div>

                {presidentCategory && (() => {
                    const info = getWinnerInfo(presidentCategory.dbKey);
                    return info ? renderWinnerCard(presidentCategory.position, info, true) : null;
                })()}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {otherCategories.map(cat => {
                        const info = getWinnerInfo(cat.dbKey);
                        if (!info) return null;
                        return (
                            <div key={cat.dbKey}>
                                {renderWinnerCard(cat.position, info)}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Runoff Election ──────────────────────────────────────────────────
                Separate from the spotlight/breakdown above — shows the runoff
                status/result for President & Minister of Education alongside
                (never instead of) their original first-round numbers. */}
            {runoff?.active && (
                <div className="space-y-4">
                    <div className="text-center pt-2">
                        <h2 className="text-lg font-black text-zinc-900 uppercase tracking-tight flex items-center justify-center gap-2">
                            <Vote className="w-5 h-5 text-orange-500" />
                            Runoff Election
                        </h2>
                        <p className="text-xs text-zinc-400 font-medium mt-1">
                            President & Minister of Education — no candidate reached 50% in round one
                        </p>
                    </div>

                    {runoff.turnout && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                                <div className="h-1 bg-zinc-200" />
                                <div className="p-5 flex flex-col items-center text-center">
                                    <Users className="w-5 h-5 text-zinc-300 mb-1.5" />
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Eligible</span>
                                    <span className="text-3xl font-black text-zinc-900 tabular-nums">{runoff.turnout.total_eligible}</span>
                                </div>
                            </div>
                            <div className="bg-white rounded-2xl border-2 border-orange-200 overflow-hidden">
                                <div className="h-1 bg-orange-400" />
                                <div className="p-5 flex flex-col items-center text-center">
                                    <TrendingUp className="w-5 h-5 text-orange-400 mb-1.5" />
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Runoff Votes Cast</span>
                                    <span className="text-3xl font-black text-zinc-900 tabular-nums">{runoff.turnout.votes_cast}</span>
                                </div>
                            </div>
                            <div className="bg-white rounded-2xl border-2 border-orange-200 overflow-hidden">
                                <div className="h-1 bg-orange-400" />
                                <div className="p-5 flex flex-col items-center text-center">
                                    <div className="relative w-16 h-16 mb-1">
                                        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                            <circle cx="18" cy="18" r={R} fill="none" stroke="#f4f4f5" strokeWidth="3.5" />
                                            <circle cx="18" cy="18" r={R} fill="none" stroke="#f97316" strokeWidth="3.5"
                                                    strokeLinecap="round"
                                                    strokeDasharray={`${CIRCUMF} ${CIRCUMF}`}
                                                    strokeDashoffset={runoffOffset}
                                                    style={{ transition: 'stroke-dashoffset 0.05s linear' }}
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-sm font-black text-zinc-900 tabular-nums">{animRunoffPct}%</span>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1">Runoff Turnout</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {runoff.positions.map(posKey => {
                            const info = getRunoffWinnerInfo(posKey);
                            const category = RUNOFF_ELECTION_DATA.find(c => c.dbKey === posKey);
                            if (!info || !category) return null;
                            return (
                                <div key={posKey}>
                                    {renderWinnerCard(category.position, info)}
                                </div>
                            );
                        })}
                    </div>

                    {/* Runoff breakdown — only once closed */}
                    {!runoff.open && runoff.results && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {runoff.positions.map(posKey => {
                                const result = buildRunoffResults(posKey);
                                if (!result) return null;
                                const { label, candidates, total } = result;
                                const totalBallotsCast = runoff.turnout?.total_ballots_cast ?? total;

                                return (
                                    <div key={posKey} className="bg-white rounded-2xl border-2 border-orange-200 overflow-hidden">
                                        <div className="h-1 bg-orange-400" />
                                        <div className="p-5">
                                            <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-zinc-100">
                                                <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">{label} · Runoff</h3>
                                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                                    {total} vote{total !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div className="space-y-4">
                                                {candidates.map((candidate, index) => {
                                                    const nextCandidate = candidates[1];
                                                    const isTiedRace = !!nextCandidate && candidates[0]?.votes === nextCandidate.votes && candidates[0].votes > 0;
                                                    const hasPlurality = index === 0 && candidate.votes > 0 && !isTiedRace && (!nextCandidate || candidate.votes > nextCandidate.votes);
                                                    const isWinner = hasPlurality && candidate.votes >= (totalBallotsCast / 2);
                                                    const pct = totalBallotsCast > 0 ? Math.round((candidate.votes / totalBallotsCast) * 100) : 0;

                                                    return (
                                                        <div key={candidate.id}>
                                                            <div className="flex items-center gap-3 mb-1.5">
                                                                <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isWinner ? 'bg-yellow-400' : 'bg-zinc-100'}`}>
                                                                    {isWinner
                                                                        ? <ShieldCheck className="w-3.5 h-3.5 text-zinc-900" />
                                                                        : <span className="text-[11px] font-black text-zinc-500">{index + 1}</span>}
                                                                </span>
                                                                <img
                                                                    src={candidate.image}
                                                                    alt={candidate.name}
                                                                    onError={(e) => {
                                                                        (e.target as HTMLImageElement).src =
                                                                            `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate.name)}&background=18181b&color=eab308&size=64`;
                                                                    }}
                                                                    className={`w-9 h-9 rounded-full object-cover border-2 shrink-0 ${isWinner ? 'border-yellow-400' : 'border-zinc-200'}`}
                                                                />
                                                                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                                                    <span className={`font-black text-sm truncate uppercase ${isWinner ? 'text-zinc-900' : 'text-zinc-500'}`}>
                                                                        {candidate.name}
                                                                    </span>
                                                                    {isWinner && (
                                                                        <span className="text-[9px] font-black bg-yellow-400 text-zinc-900 px-1.5 py-0.5 rounded-full uppercase tracking-widest shrink-0">
                                                                            Elected
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <span className={`text-xl font-black tabular-nums ${isWinner ? 'text-yellow-600' : 'text-zinc-400'}`}>
                                                                        {candidate.votes}
                                                                    </span>
                                                                    <span className="text-[10px] font-bold text-zinc-400 ml-1 uppercase">{pct}%</span>
                                                                </div>
                                                            </div>
                                                            <div className="ml-9 h-2 bg-zinc-100 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full transition-all duration-700 ease-out ${isWinner ? 'bg-yellow-400' : 'bg-zinc-300'}`}
                                                                    style={{ width: `${pct}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Full breakdown per position ─────────────────────────────────────── */}
            <div className="space-y-4">
                <div className="text-center pt-2">
                    <h2 className="text-lg font-black text-zinc-900 uppercase tracking-tight">
                        Full Results Breakdown
                    </h2>
                    <p className="text-xs text-zinc-400 font-medium mt-1">
                        Complete vote counts for every candidate
                    </p>
                </div>

                {positionKeys.map(dbKey => {
                    const result = buildResults(dbKey);
                    if (!result) return null;
                    const { label, candidates, total } = result;
                    const category = ELECTION_DATA.find(c => c.dbKey === dbKey);

                    return (
                        <div key={dbKey} className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                            <div className="h-1 bg-yellow-500" />
                            <div className="p-5">

                                <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-zinc-100">
                                    <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">
                                        {label}
                                    </h3>
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                        {category?.unopposed ? 'Vote of Confidence Required' : `${total} vote${total !== 1 ? 's' : ''}`}
                                    </span>
                                </div>

                                <div className="space-y-4">
                                    {candidates.map((candidate, index) => {

                                        const totalBallotsCast = turnout?.total_ballots_cast ?? turnout?.votes_cast ?? 0;
                                        let isWinner = false;
                                        let failedVoteOfConfidence = false;
                                        let isTiedCandidate = false;

                                        if (category?.unopposed) {
                                            // RULE 1: Unopposed candidates MUST secure >= 50% of total ballots
                                            isWinner = candidate.votes >= (totalBallotsCast / 2) && candidate.votes > 0;
                                            failedVoteOfConfidence = !isWinner && candidate.votes > 0;
                                        } else {
                                            // RULE 2: Competitive candidates need BOTH a plurality (most
                                            // votes among the field) AND >= 50% of total ballots cast —
                                            // same Vote of Confidence rule as unopposed races.
                                            const nextCandidate = candidates[1];
                                            const isTiedRace = !!nextCandidate && candidates[0]?.votes === nextCandidate.votes && candidates[0].votes > 0;
                                            const hasPlurality = index === 0 && candidate.votes > 0 && !isTiedRace && (!nextCandidate || candidate.votes > nextCandidate.votes);
                                            isWinner = hasPlurality && candidate.votes >= (totalBallotsCast / 2);
                                            failedVoteOfConfidence = hasPlurality && !isWinner;
                                            isTiedCandidate = isTiedRace && index <= 1;
                                        }

                                        // Percentage always out of TOTAL BALLOTS CAST — the same
                                        // denominator the 50% rule is checked against, for every position.
                                        const pct = totalBallotsCast > 0 ? Math.round((candidate.votes / totalBallotsCast) * 100) : 0;

                                        return (
                                            <div key={candidate.id}>
                                                <div className="flex items-center gap-3 mb-2">

                                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                                                        isWinner ? 'bg-yellow-400' : (failedVoteOfConfidence ? 'bg-zinc-100' : (isTiedCandidate ? 'bg-orange-50' : 'bg-zinc-100'))
                                                    }`}>
                                                        {isWinner
                                                            ? <ShieldCheck className="w-3.5 h-3.5 text-zinc-900" />
                                                            : (failedVoteOfConfidence
                                                                ? <MinusCircle className="w-4 h-4 text-zinc-400" />
                                                                : (isTiedCandidate
                                                                    ? <Users className="w-3.5 h-3.5 text-orange-500" />
                                                                    : <span className="text-xs font-black text-zinc-400">{index + 1}</span>))
                                                        }
                                                    </div>

                                                    <img
                                                        src={candidate.image}
                                                        alt={candidate.name}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src =
                                                                `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate.name)}&background=18181b&color=eab308&size=128`;
                                                        }}
                                                        className={`w-10 h-10 rounded-full object-cover border-2 shrink-0 ${
                                                            isWinner ? 'border-yellow-400' : (failedVoteOfConfidence ? 'border-zinc-300' : (isTiedCandidate ? 'border-orange-300' : 'border-zinc-200'))
                                                        }`}
                                                    />

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className={`font-black text-sm uppercase ${
                                                                isWinner ? 'text-zinc-900' : (failedVoteOfConfidence ? 'text-zinc-500' : (isTiedCandidate ? 'text-orange-700' : 'text-zinc-500'))
                                                            }`}>
                                                                {candidate.name}
                                                            </span>
                                                            {isWinner && (
                                                                <span className="text-[9px] font-black bg-yellow-400 text-zinc-900 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                                                    ELECTED
                                                                </span>
                                                            )}
                                                            {failedVoteOfConfidence && (
                                                                <span className="text-[9px] font-black bg-zinc-100 text-zinc-500 border border-zinc-200 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                                                    BELOW 50%
                                                                </span>
                                                            )}
                                                            {isTiedCandidate && (
                                                                <span className="text-[9px] font-black bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                                                    TIED
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="text-right shrink-0">
                                                        <span className={`text-2xl font-black tabular-nums ${
                                                            isWinner ? 'text-yellow-600' : (failedVoteOfConfidence ? 'text-zinc-400' : (isTiedCandidate ? 'text-orange-500' : 'text-zinc-400'))
                                                        }`}>
                                                            {candidate.votes}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-zinc-400 ml-1">{pct}%</span>
                                                    </div>
                                                </div>

                                                <div className="ml-10 h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                                                            isWinner ? 'bg-yellow-400' : (failedVoteOfConfidence ? 'bg-zinc-300' : (isTiedCandidate ? 'bg-orange-400' : 'bg-zinc-300'))
                                                        }`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Ballot verification ─────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                <div className="h-1.5 bg-zinc-900 w-full" />
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center shrink-0">
                            <Search className="w-5 h-5 text-yellow-400" />
                        </div>
                        <div>
                            <h2 className="text-sm font-black text-zinc-900 uppercase tracking-widest">
                                Verify Your Ballot
                            </h2>
                            <p className="text-[11px] text-zinc-400 font-medium mt-0.5">
                                Enter your receipt code to confirm your vote was counted.
                                Your choices remain private.
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleVerify} className="flex gap-2">
                        <input
                            type="text"
                            value={receiptInput}
                            onChange={e => { setReceiptInput(e.target.value); setVerifyResult(null); }}
                            placeholder="Paste your ballot receipt UUID here"
                            className="flex-1 rounded-xl border-2 border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-mono text-zinc-800 outline-none focus:border-yellow-500 focus:bg-white transition-all"
                            disabled={verifying}
                        />
                        <button
                            type="submit"
                            disabled={verifying || !receiptInput.trim()}
                            className="shrink-0 bg-zinc-900 text-white font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl hover:bg-zinc-800 active:scale-95 transition-all disabled:opacity-40 border-b-4 border-zinc-700 active:border-b-0"
                        >
                            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                        </button>
                    </form>

                    {verifyResult && (
                        <div className={`mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border-2 ${
                            verifyResult === 'counted'
                                ? 'bg-green-50 border-green-200'
                                : 'bg-red-50 border-red-200'
                        }`}>
                            {verifyResult === 'counted'
                                ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                                : <XCircle     className="w-5 h-5 text-red-500 shrink-0" />
                            }
                            <p className={`text-sm font-bold ${
                                verifyResult === 'counted' ? 'text-green-800' : 'text-red-700'
                            }`}>
                                {verifyResult === 'counted'
                                    ? '✓ Your ballot was counted in the final results.'
                                    : '✗ No ballot found with this receipt code. Check for typos or contact the EC.'
                                }
                            </p>
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
};

export default PublicResults;