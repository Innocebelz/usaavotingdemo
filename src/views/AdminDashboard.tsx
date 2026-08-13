import React, { useState, useEffect, useRef } from 'react';
import { ELECTION_DATA, RUNOFF_ELECTION_DATA } from '../constants';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, Users, Download, Lock, Unlock, LogOut, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL || 'https://laa-voting-system.onrender.com';

interface TurnoutData {
    total_eligible:     number;
    votes_cast:         number;
    total_ballots_cast: number;   // source of truth for per-position % and 50% threshold
    turnout_percentage: number;
}

// Raw tally from backend — only candidates with at least 1 vote appear here
interface TallyData {
    [position: string]: { candidate_id: string; votes: number }[];
}

// ── Animated count-up hook ────────────────────────────────────────────────
function useCountUp(target: number, duration = 1000, delay = 0) {
    const [value, setValue]   = useState(0);
    const rafRef   = useRef<number>(0);
    const startRef = useRef<number | null>(null);

    useEffect(() => {
        if (target === 0) { setValue(0); return; }
        const timeout = setTimeout(() => {
            startRef.current = null;
            const step = (ts: number) => {
                if (!startRef.current) startRef.current = ts;
                const p = Math.min((ts - startRef.current) / duration, 1);
                setValue(Math.round((1 - Math.pow(1 - p, 3)) * target));
                if (p < 1) rafRef.current = requestAnimationFrame(step);
            };
            rafRef.current = requestAnimationFrame(step);
        }, delay);
        return () => { clearTimeout(timeout); cancelAnimationFrame(rafRef.current); };
    }, [target, duration, delay]);

    return value;
}

const AdminDashboard: React.FC = () => {
    const [activeTab, setActiveTab]           = useState<'overview' | 'members' | 'audit' | 'integrity'>('overview');
    const [turnout, setTurnout]               = useState<TurnoutData | null>(null);
    const [tally, setTally]                   = useState<TallyData | null>(null);
    const [isElectionOpen, setIsElectionOpen] = useState<boolean>(true);
    const [loading, setLoading]               = useState(true);
    const [actionLoading, setActionLoading]   = useState(false);
    const [lastRefreshed, setLastRefreshed]   = useState<Date | null>(null);
    const [visible, setVisible]               = useState(false);
    const [confirmToggle, setConfirmToggle]   = useState(false);
    const [toggleError, setToggleError]       = useState<string | null>(null);

    // Runoff election — President & Minister of Education only. Mirrors the
    // general-election state above but reads/writes the /api/admin/runoff/*
    // endpoints, which are backed by their own Runoff_Ballots table.
    const [runoffOpen, setRunoffOpen]             = useState<boolean>(false);
    const [runoffStarted, setRunoffStarted]       = useState<boolean>(false);
    const [runoffPublished, setRunoffPublished]   = useState<boolean>(false);
    const [publishActionLoading, setPublishActionLoading] = useState(false);
    const [confirmPublishToggle, setConfirmPublishToggle] = useState(false);
    const [runoffTally, setRunoffTally]           = useState<TallyData | null>(null);
    const [runoffTurnout, setRunoffTurnout]       = useState<TurnoutData | null>(null);
    const [runoffActionLoading, setRunoffActionLoading] = useState(false);
    const [confirmRunoffToggle, setConfirmRunoffToggle] = useState(false);
    const RUNOFF_POSITION_KEYS = ['president', 'minister_of_education'];

    // EC members tab
    const [members, setMembers]           = useState<any[]>([]);
    const [showAddMember, setShowAddMember] = useState(false);
    const [newMember, setNewMember]       = useState({ username: '', full_name: '', password: '', role: 'ec_member' });
    const [memberError, setMemberError]   = useState('');
    const [memberLoading, setMemberLoading] = useState(false);

    // Audit log tab
    const [auditLog, setAuditLog]         = useState<any[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);

    // Integrity check tab
    const [integrityData, setIntegrityData]     = useState<any | null>(null);
    const [integrityLoading, setIntegrityLoading] = useState(false);

    const isSuperAdmin = sessionStorage.getItem('laa_admin_user_role') === 'super_admin';
    const currentAdminUsername = sessionStorage.getItem('laa_admin_username') || '';

    const navigate = useNavigate();

    // Fade-in on mount
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 30);
        return () => clearTimeout(t);
    }, []);

    // Animated stats
    const animEligible = useCountUp(turnout?.total_eligible      ?? 0, 1000, 300);
    const animCast     = useCountUp(turnout?.votes_cast          ?? 0, 1000, 400);
    const animPct      = useCountUp(turnout?.turnout_percentage  ?? 0, 1200, 500);
    const animRunoffPct = useCountUp(runoffTurnout?.turnout_percentage ?? 0, 1200, 500);

    const getAuthHeaders = (): HeadersInit => {
        const token = sessionStorage.getItem('laa_admin_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const handleSessionExpired = () => {
        sessionStorage.removeItem('laa_admin_token');
        navigate('/admin/login', { replace: true });
    };

    const fetchAdminData = async () => {
        try {
            const [turnoutRes, tallyRes, statusRes, runoffStatusRes, runoffTallyRes, runoffTurnoutRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/results/turnout`),
                fetch(`${BACKEND_URL}/api/admin/tally`,  { headers: getAuthHeaders() }),
                fetch(`${BACKEND_URL}/api/admin/status`, { headers: getAuthHeaders() }),
                fetch(`${BACKEND_URL}/api/admin/runoff/status`,  { headers: getAuthHeaders() }),
                fetch(`${BACKEND_URL}/api/admin/runoff/tally`,   { headers: getAuthHeaders() }),
                fetch(`${BACKEND_URL}/api/admin/runoff/turnout`, { headers: getAuthHeaders() }),
            ]);

            if ([tallyRes, statusRes, runoffStatusRes, runoffTallyRes, runoffTurnoutRes].some(r => r.status === 401)) {
                handleSessionExpired(); return;
            }

            if (turnoutRes.ok && tallyRes.ok && statusRes.ok) {
                const [td, tj, sj] = await Promise.all([
                    turnoutRes.json(), tallyRes.json(), statusRes.json(),
                ]);
                if (td.status === 'success') setTurnout(td);
                if (tj.status === 'success') setTally(tj.data);
                if (sj.status === 'success') setIsElectionOpen(sj.election_open);
                setLastRefreshed(new Date());
            }

            if (runoffStatusRes.ok && runoffTallyRes.ok && runoffTurnoutRes.ok) {
                const [rsj, rtj, rtoj] = await Promise.all([
                    runoffStatusRes.json(), runoffTallyRes.json(), runoffTurnoutRes.json(),
                ]);
                if (rsj.status === 'success') {
                    setRunoffOpen(rsj.runoff_open);
                    setRunoffStarted(rsj.runoff_started);
                    setRunoffPublished(rsj.runoff_results_published);
                }
                if (rtj.status === 'success') setRunoffTally(rtj.data);
                if (rtoj.status === 'success') setRunoffTurnout(rtoj);
            }
        } catch (err) {
            console.error('Failed to connect to backend:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAdminData();
        const interval = setInterval(fetchAdminData, 10000);
        return () => clearInterval(interval);
    }, []);

    // ── Helpers ───────────────────────────────────────────────────────────

    // For each position in ELECTION_DATA, merge in live vote counts from tally.
    // Uses dbKey for matching — safe even when position names contain commas/special chars.
    const buildPositionResults = (dbKey: string) => {
        const category  = ELECTION_DATA.find(c => c.dbKey === dbKey);
        if (!category) return null;

        const rawVotes  = tally?.[dbKey] ?? [];
        const voteMap   = Object.fromEntries(rawVotes.map(r => [r.candidate_id, r.votes]));

        const candidates = category.candidates.map(c => ({
            id:     c.id,
            name:   c.name,
            image:  c.image,
            votes:  voteMap[c.id] ?? 0,
        })).sort((a, b) => b.votes - a.votes);

        const total = candidates.reduce((s, c) => s + c.votes, 0);
        return { label: category.position, candidates, total, unopposed: category.unopposed };
    };

    // Same shape as buildPositionResults, but reads from RUNOFF_ELECTION_DATA
    // (only 2 candidates per position) and the runoff tally/turnout.
    const buildRunoffPositionResults = (dbKey: string) => {
        const category = RUNOFF_ELECTION_DATA.find(c => c.dbKey === dbKey);
        if (!category) return null;

        const rawVotes = runoffTally?.[dbKey] ?? [];
        const voteMap  = Object.fromEntries(rawVotes.map(r => [r.candidate_id, r.votes]));

        const candidates = category.candidates.map(c => ({
            id:    c.id,
            name:  c.name,
            image: c.image,
            votes: voteMap[c.id] ?? 0,
        })).sort((a, b) => b.votes - a.votes);

        const total = candidates.reduce((s, c) => s + c.votes, 0);
        return { label: category.position, candidates, total };
    };

    const toggleRunoffStatus = async () => {
        setConfirmRunoffToggle(false);
        setRunoffActionLoading(true);
        setToggleError(null);
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/runoff/status`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body:    JSON.stringify({ runoff_open: !runoffOpen }),
            });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (res.ok && data.status === 'success') {
                setRunoffOpen(data.runoff_open);
                setRunoffStarted(true);
            } else {
                setToggleError(data.detail || 'Failed to update the runoff status.');
            }
        } catch (err) {
            console.error('Failed to toggle runoff status:', err);
            setToggleError('Failed to reach the server. Please try again.');
        } finally {
            setRunoffActionLoading(false);
        }
    };

    const togglePublishRunoffResults = async () => {
        setConfirmPublishToggle(false);
        setPublishActionLoading(true);
        setToggleError(null);
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/runoff/publish`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body:    JSON.stringify({ publish: !runoffPublished }),
            });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (res.ok && data.status === 'success') {
                setRunoffPublished(data.runoff_results_published);
            } else {
                setToggleError(data.detail || 'Failed to update the publish status.');
            }
        } catch (err) {
            console.error('Failed to toggle runoff publish status:', err);
            setToggleError('Failed to reach the server. Please try again.');
        } finally {
            setPublishActionLoading(false);
        }
    };

    const toggleElectionStatus = async () => {
        setConfirmToggle(false);
        setActionLoading(true);
        setToggleError(null);
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/status`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body:    JSON.stringify({ election_open: !isElectionOpen }),
            });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (res.ok && data.status === 'success') {
                setIsElectionOpen(data.election_open);
            } else {
                setToggleError(data.detail || 'Failed to update the election status.');
            }
        } catch (err) {
            console.error('Failed to toggle election status:', err);
            setToggleError('Failed to reach the server. Please try again.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleExit = () => {
        sessionStorage.removeItem('laa_admin_token');
        navigate('/login');
    };

    const downloadCSV = () => {
        if (!tally) return;
        let csv = 'Position,Candidate,Votes\n';
        Object.keys(tally).forEach(posKey => {
            const result = buildPositionResults(posKey);
            if (!result) return;
            result.candidates.forEach(c => {
                csv += `"${result.label}","${c.name}",${c.votes}\n`;
            });
        });
        const link  = document.createElement('a');
        link.href   = encodeURI('data:text/csv;charset=utf-8,' + csv);
        link.setAttribute('download', `usaa_results_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const fetchMembers = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/users`, { headers: getAuthHeaders() });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (data.status === 'success') setMembers(data.users);
        } catch (e) { console.error('Failed to fetch members:', e); }
    };

    const fetchAuditLog = async () => {
        setAuditLoading(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/audit-log`, { headers: getAuthHeaders() });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (data.status === 'success') setAuditLog(data.log);
        } catch (e) { console.error('Failed to fetch audit log:', e); }
        finally { setAuditLoading(false); }
    };

    const fetchIntegrityCheck = async () => {
        setIntegrityLoading(true);
        setIntegrityData(null);
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/integrity-check`, { headers: getAuthHeaders() });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (data.status === 'success') setIntegrityData(data);
        } catch (e) { console.error('Failed to run integrity check:', e); }
        finally { setIntegrityLoading(false); }
    };

    const handleAddMember = async (e: React.FormEvent) => {
        e.preventDefault();
        setMemberError('');
        if (!newMember.username || !newMember.full_name || !newMember.password) {
            setMemberError('All fields are required.'); return;
        }
        setMemberLoading(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(newMember),
            });
            if (res.status === 401) { handleSessionExpired(); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to create account.');
            setNewMember({ username: '', full_name: '', password: '', role: 'ec_member' });
            setShowAddMember(false);
            await fetchMembers();
        } catch (err: any) {
            setMemberError(err.message);
        } finally {
            setMemberLoading(false);
        }
    };

    const handleToggleMember = async (userId: number, fullName: string) => {
        if (!window.confirm(`Toggle active status for ${fullName}?`)) return;
        try {
            const res = await fetch(`${BACKEND_URL}/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
            });
            if (res.status === 401) { handleSessionExpired(); return; }
            await fetchMembers();
        } catch (e) { console.error('Toggle failed:', e); }
    };

    // ── Loading state ─────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
                <p className="text-xs font-black uppercase tracking-widest">Loading Election Data...</p>
            </div>
        );
    }

    // Arc for the turnout ring
    const R       = 15.9155;
    const CIRCUMF = 2 * Math.PI * R;
    const offset  = CIRCUMF - (animPct / 100) * CIRCUMF;
    const runoffOffset = CIRCUMF - (animRunoffPct / 100) * CIRCUMF;

    // dbKey is the exact Postgres column name — no derivation needed
    const positionKeys = ELECTION_DATA.map(c => c.dbKey);

    // Same denominator used on the public results page — sourced directly
    // from the Ballots table, not Voters.has_voted, so it can never diverge
    // from what each position's own tally sums to.
    const totalBallotsCast = turnout?.total_ballots_cast ?? turnout?.votes_cast ?? 0;

    return (
        <div
            className={`w-full max-w-5xl mx-auto pt-6 pb-16 transition-all duration-500 ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
        >
            {/* ── Page header ────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4 border-b-2 border-zinc-200 pb-6">
                <div>
                    <span className="text-[10px] font-black bg-zinc-900 text-yellow-400 px-3 py-1 rounded-full uppercase tracking-widest mb-3 inline-block border border-yellow-500">
                        Secure Area
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-black text-zinc-900 tracking-tight uppercase">
                        Election Control Center
                    </h1>
                    {lastRefreshed && (
                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                            <RefreshCw className="w-3 h-3" />
                            Last refreshed {lastRefreshed.toLocaleTimeString()}
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block ml-1" />
                        </p>
                    )}
                </div>
                <button
                    onClick={handleExit}
                    className="flex items-center gap-2 text-sm font-black text-zinc-400 hover:text-zinc-800 transition-colors uppercase tracking-wider"
                >
                    <LogOut className="w-4 h-4" />
                    Exit
                </button>
            </div>

            {/* ── Tab bar ────────────────────────────────────────────────── */}
            <div className="flex gap-1 bg-zinc-100 rounded-xl p-1 mb-6 flex-wrap">
                {([
                    { key: 'overview',   label: 'Overview'        },
                    { key: 'members',    label: 'EC Members'      },
                    { key: 'audit',      label: 'Audit Log'       },
                    { key: 'integrity',  label: '🛡 Pre-Election Check' },
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => {
                            setActiveTab(tab.key);
                            if (tab.key === 'members')   fetchMembers();
                            if (tab.key === 'audit')     fetchAuditLog();
                            if (tab.key === 'integrity') fetchIntegrityCheck();
                        }}
                        className={`flex-1 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                            activeTab === tab.key
                                ? 'bg-zinc-900 text-yellow-400 shadow'
                                : 'text-zinc-500 hover:text-zinc-800'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ── OVERVIEW TAB ────────────────────────────────────────────── */}
            {activeTab === 'overview' && <>

                {/* ── Control bar ────────────────────────────────────────────── */}
                <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden mb-8">
                    <div className="h-1 bg-zinc-900 w-full" />
                    <div className="p-4 flex flex-col sm:flex-row justify-between items-center gap-4">

                        {/* Status */}
                        <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                isElectionOpen ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                            }`} />
                            <div>
                                <p className="font-black text-zinc-800 uppercase tracking-wider text-sm leading-none">
                                    {isElectionOpen ? 'Accepting Votes' : 'Election Closed'}
                                </p>
                                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">
                                    {isElectionOpen ? 'Voters can submit ballots' : 'No new votes accepted'}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">

                            {/* Export CSV */}
                            <button
                                onClick={downloadCSV}
                                disabled={!tally}
                                className="flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-b-4 border-zinc-700 active:border-b-0 active:scale-95 disabled:opacity-40"
                            >
                                <Download className="w-4 h-4 text-yellow-400" />
                                Export CSV
                            </button>

                            {/* Toggle election — inline confirm prevents accidental clicks */}
                            {confirmToggle ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={toggleElectionStatus}
                                        disabled={actionLoading}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-b-4 active:border-b-0 active:scale-95 disabled:opacity-50 ${
                                            isElectionOpen
                                                ? 'bg-red-600 text-white border-red-800 hover:bg-red-700'
                                                : 'bg-green-600 text-white border-green-800 hover:bg-green-700'
                                        }`}
                                    >
                                        {actionLoading
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : isElectionOpen
                                                ? <><Lock className="w-4 h-4" /> Yes, Close</>
                                                : <><Unlock className="w-4 h-4" /> Yes, Open</>
                                        }
                                    </button>
                                    <button
                                        onClick={() => setConfirmToggle(false)}
                                        className="px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest bg-zinc-100 text-zinc-600 border-b-4 border-zinc-200 hover:bg-zinc-200 active:border-b-0 transition-all"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-end gap-1">
                                    <button
                                        onClick={() => setConfirmToggle(true)}
                                        disabled={!isElectionOpen && runoffOpen}
                                        title={!isElectionOpen && runoffOpen ? 'Close the runoff first' : undefined}
                                        className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                                            isElectionOpen
                                                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                                : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                                        }`}
                                    >
                                        {isElectionOpen
                                            ? <><Lock className="w-4 h-4" /> Close Election</>
                                            : <><Unlock className="w-4 h-4" /> Open Election</>
                                        }
                                    </button>
                                    {!isElectionOpen && runoffOpen && (
                                        <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">
                                            Close the runoff first
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    {toggleError && (
                        <div className="px-4 pb-4 -mt-2">
                            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {toggleError}
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Turnout stats ───────────────────────────────────────────── */}
                {turnout && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">

                        {/* Total eligible */}
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                            <div className="h-1 bg-zinc-200" />
                            <div className="p-6 flex flex-col items-center text-center">
                                <Users className="w-6 h-6 text-zinc-300 mb-2" />
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                                Total Eligible
                            </span>
                                <span className="text-5xl font-black text-zinc-900 tabular-nums">
                                {animEligible}
                            </span>
                            </div>
                        </div>

                        {/* Votes cast — dark highlight card */}
                        <div className="bg-zinc-900 rounded-2xl border-2 border-zinc-900 overflow-hidden">
                            <div className="h-1 bg-yellow-500" />
                            <div className="p-6 flex flex-col items-center text-center">
                                <TrendingUp className="w-6 h-6 text-yellow-400 mb-2" />
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                                Votes Cast
                            </span>
                                <span className="text-5xl font-black text-white tabular-nums">
                                {animCast}
                            </span>
                            </div>
                        </div>

                        {/* Turnout ring */}
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                            <div className="h-1 bg-yellow-500" />
                            <div className="p-6 flex flex-col items-center text-center">
                                <div className="relative w-24 h-24 mb-1">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                        <circle cx="18" cy="18" r={R} fill="none" stroke="#f4f4f5" strokeWidth="3.5" />
                                        <circle
                                            cx="18" cy="18" r={R}
                                            fill="none" stroke="#eab308" strokeWidth="3.5"
                                            strokeLinecap="round"
                                            strokeDasharray={`${CIRCUMF} ${CIRCUMF}`}
                                            strokeDashoffset={offset}
                                            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xl font-black text-zinc-900 tabular-nums">
                                        {animPct}%
                                    </span>
                                    </div>
                                </div>
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                Turnout Rate
                            </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Live tally ──────────────────────────────────────────────── */}
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-xl font-black text-zinc-900 tracking-tight uppercase">
                        Live Vote Tally
                    </h2>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        Auto-refreshing every 10s
                    </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {positionKeys.map(posKey => {
                        const result = buildPositionResults(posKey);
                        if (!result) return null;
                        const { label, candidates, total, unopposed } = result;

                        return (
                            <div key={posKey} className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                                <div className="h-1 bg-yellow-500" />
                                <div className="p-5">

                                    {/* Position label + vote total */}
                                    <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-zinc-100">
                                        <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">
                                            {label}
                                        </h3>
                                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                        {unopposed ? 'Vote of Confidence Required' : `${total} vote${total !== 1 ? 's' : ''}`}
                                    </span>
                                    </div>

                                    {total === 0 ? (
                                        /* No votes yet state */
                                        <div className="py-4 text-center">
                                            <p className="text-sm text-zinc-400 font-bold italic">
                                                No votes recorded yet.
                                            </p>
                                            <div className="mt-3 space-y-2">
                                                {candidates.map(c => (
                                                    <div key={c.id} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-zinc-50">
                                                        <img
                                                            src={c.image}
                                                            alt={c.name}
                                                            onError={(e) => {
                                                                (e.target as HTMLImageElement).src =
                                                                    `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=18181b&color=eab308&size=64`;
                                                            }}
                                                            className="w-8 h-8 rounded-full object-cover border-2 border-zinc-200 shrink-0"
                                                        />
                                                        <span className="text-sm font-black text-zinc-400 truncate">{c.name}</span>
                                                        <span className="ml-auto text-sm font-black text-zinc-300">—</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        /* Results rows */
                                        <div className="space-y-4">
                                            {candidates.map((candidate, index) => {

                                                // ── THE 50% CONSTITUTIONAL RULE MATH ──────────────────
                                                // Identical logic to the public results page — kept in
                                                // sync so the EC's internal live view always matches
                                                // what voters will eventually see published.
                                                let isWinner = false;
                                                let failedVoteOfConfidence = false;
                                                let isTiedCandidate = false;

                                                if (unopposed) {
                                                    isWinner = candidate.votes >= (totalBallotsCast / 2) && candidate.votes > 0;
                                                    failedVoteOfConfidence = !isWinner && candidate.votes > 0;
                                                } else {
                                                    // Competitive candidates just need a plurality — most
                                                    // votes among the field wins. The 50% Vote of Confidence
                                                    // rule is exclusive to unopposed races.
                                                    const nextCandidate = candidates[1];
                                                    const isTiedRace = !!nextCandidate && candidates[0]?.votes === nextCandidate.votes && candidates[0].votes > 0;
                                                    isWinner = index === 0 && candidate.votes > 0 && !isTiedRace && (!nextCandidate || candidate.votes > nextCandidate.votes);
                                                    isTiedCandidate = isTiedRace && index <= 1;
                                                }

                                                // Unopposed: percentage out of total ballots cast, which is
                                                // what the 50% rule is checked against. Competitive: percentage
                                                // out of this position's own vote total, since no ballots-cast
                                                // threshold applies there.
                                                const baseTotal = unopposed ? totalBallotsCast : total;
                                                const pct = baseTotal > 0 ? Math.round((candidate.votes / baseTotal) * 100) : 0;

                                                return (
                                                    <div key={candidate.id}>
                                                        <div className="flex items-center gap-3 mb-1.5">

                                                            {/* Status badge — checkmark seal / rank / tied / failed */}
                                                            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                                                                isWinner ? 'bg-yellow-400' : (failedVoteOfConfidence ? 'bg-red-50' : (isTiedCandidate ? 'bg-orange-50' : 'bg-zinc-100'))
                                                            }`}>
                                                                {isWinner
                                                                    ? <ShieldCheck className="w-3.5 h-3.5 text-zinc-900" />
                                                                    : (failedVoteOfConfidence
                                                                        ? <XCircle className="w-3.5 h-3.5 text-red-500" />
                                                                        : (isTiedCandidate
                                                                            ? <Users className="w-3.5 h-3.5 text-orange-500" />
                                                                            : <span className="text-[11px] font-black text-zinc-500">{index + 1}</span>))
                                                                }
                                                            </span>

                                                            {/* Photo */}
                                                            <img
                                                                src={candidate.image}
                                                                alt={candidate.name}
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).src =
                                                                        `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate.name)}&background=18181b&color=eab308&size=64`;
                                                                }}
                                                                className={`w-9 h-9 rounded-full object-cover border-2 shrink-0 ${
                                                                    isWinner ? 'border-yellow-400' : (failedVoteOfConfidence ? 'border-red-300' : (isTiedCandidate ? 'border-orange-300' : 'border-zinc-200'))
                                                                }`}
                                                            />

                                                            {/* Name + winner/failed tag */}
                                                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                                                <span className={`font-black text-sm truncate uppercase ${
                                                                    isWinner ? 'text-zinc-900' : (failedVoteOfConfidence ? 'text-red-700' : (isTiedCandidate ? 'text-orange-700' : 'text-zinc-500'))
                                                                }`}>
                                                                    {candidate.name}
                                                                </span>
                                                                {isWinner && (
                                                                    <span className="text-[9px] font-black bg-yellow-400 text-zinc-900 px-1.5 py-0.5 rounded-full uppercase tracking-widest shrink-0">
                                                                        Elected
                                                                    </span>
                                                                )}
                                                                {failedVoteOfConfidence && (
                                                                    <span className="text-[9px] font-black bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full uppercase tracking-widest shrink-0">
                                                                        Failed 50%
                                                                    </span>
                                                                )}
                                                                {isTiedCandidate && (
                                                                    <span className="text-[9px] font-black bg-orange-100 text-orange-700 border border-orange-200 px-1.5 py-0.5 rounded-full uppercase tracking-widest shrink-0">
                                                                        Tied
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Votes + pct */}
                                                            <div className="text-right shrink-0">
                                                            <span className={`text-xl font-black tabular-nums ${
                                                                isWinner ? 'text-yellow-600' : (failedVoteOfConfidence ? 'text-red-500' : (isTiedCandidate ? 'text-orange-500' : 'text-zinc-400'))
                                                            }`}>
                                                                {candidate.votes}
                                                            </span>
                                                                <span className="text-[10px] font-bold text-zinc-400 ml-1 uppercase">
                                                                {pct}%
                                                            </span>
                                                            </div>
                                                        </div>

                                                        {/* Vote bar */}
                                                        <div className="ml-9 h-2 bg-zinc-100 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-700 ease-out ${
                                                                    isWinner ? 'bg-yellow-400' : (failedVoteOfConfidence ? 'bg-red-400' : (isTiedCandidate ? 'bg-orange-400' : 'bg-zinc-300'))
                                                                }`}
                                                                style={{ width: `${pct}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── Runoff Election ─────────────────────────────────────────── */}
                <div className="flex items-center justify-between mb-5 mt-10 pt-8 border-t-2 border-zinc-200">
                    <div>
                        <h2 className="text-xl font-black text-zinc-900 tracking-tight uppercase">
                            Runoff Election
                        </h2>
                        <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-widest mt-1">
                            President & Minister of Education only — no candidate reached 50% in round one
                        </p>
                    </div>
                </div>

                {/* Runoff control bar */}
                <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden mb-8">
                    <div className="h-1 bg-orange-400 w-full" />
                    <div className="p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                runoffOpen ? 'bg-green-500 animate-pulse' : (runoffStarted ? 'bg-red-500' : 'bg-zinc-300')
                            }`} />
                            <div>
                                <p className="font-black text-zinc-800 uppercase tracking-wider text-sm leading-none">
                                    {runoffOpen ? 'Runoff Accepting Votes' : (runoffStarted ? 'Runoff Closed' : 'Runoff Not Started')}
                                </p>
                                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">
                                    {runoffOpen
                                        ? 'Voters can submit runoff ballots'
                                        : (runoffStarted ? 'Final runoff results below' : 'Open it below when the EC is ready')}
                                </p>
                            </div>
                        </div>

                        {isSuperAdmin ? (
                            confirmRunoffToggle ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={toggleRunoffStatus}
                                        disabled={runoffActionLoading}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-b-4 active:border-b-0 active:scale-95 disabled:opacity-50 ${
                                            runoffOpen
                                                ? 'bg-red-600 text-white border-red-800 hover:bg-red-700'
                                                : 'bg-green-600 text-white border-green-800 hover:bg-green-700'
                                        }`}
                                    >
                                        {runoffActionLoading
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : runoffOpen
                                                ? <><Lock className="w-4 h-4" /> Yes, Close Runoff</>
                                                : <><Unlock className="w-4 h-4" /> Yes, {runoffStarted ? 'Reopen' : 'Open'} Runoff</>
                                        }
                                    </button>
                                    <button
                                        onClick={() => setConfirmRunoffToggle(false)}
                                        className="px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest bg-zinc-100 text-zinc-600 border-b-4 border-zinc-200 hover:bg-zinc-200 active:border-b-0 transition-all"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-end gap-1">
                                    <button
                                        onClick={() => setConfirmRunoffToggle(true)}
                                        disabled={!runoffOpen && isElectionOpen}
                                        title={!runoffOpen && isElectionOpen ? 'Close the general election first' : undefined}
                                        className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                                            runoffOpen
                                                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                                : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                                        }`}
                                    >
                                        {runoffOpen
                                            ? <><Lock className="w-4 h-4" /> Close Runoff</>
                                            : <><Unlock className="w-4 h-4" /> {runoffStarted ? 'Reopen' : 'Open'} Runoff</>
                                        }
                                    </button>
                                    {!runoffOpen && isElectionOpen && (
                                        <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">
                                            Close the general election first
                                        </span>
                                    )}
                                </div>
                            )
                        ) : (
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                Only super admins can open/close the runoff
                            </span>
                        )}
                    </div>
                    {toggleError && (
                        <div className="px-4 pb-4">
                            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {toggleError}
                            </p>
                        </div>
                    )}
                </div>

                {/* Publish control — separate from open/close. Closing the
                    runoff only stops accepting votes; the public results page
                    shows nothing about the runoff until this is switched on,
                    so the EC can review the tally privately and send official
                    communication first. */}
                {runoffStarted && (
                    <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden mb-8">
                        <div className={`h-1 w-full ${runoffPublished ? 'bg-green-400' : 'bg-zinc-300'}`} />
                        <div className="p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${runoffPublished ? 'bg-green-500' : 'bg-zinc-300'}`} />
                                <div>
                                    <p className="font-black text-zinc-800 uppercase tracking-wider text-sm leading-none">
                                        {runoffPublished ? 'Runoff Results Published' : 'Runoff Results Hidden'}
                                    </p>
                                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">
                                        {runoffPublished
                                            ? 'Visible to everyone on the public results page'
                                            : 'Not visible on the public results page yet'}
                                    </p>
                                </div>
                            </div>

                            {isSuperAdmin ? (
                                confirmPublishToggle ? (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={togglePublishRunoffResults}
                                            disabled={publishActionLoading}
                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-b-4 active:border-b-0 active:scale-95 disabled:opacity-50 ${
                                                runoffPublished
                                                    ? 'bg-zinc-700 text-white border-zinc-900 hover:bg-zinc-800'
                                                    : 'bg-green-600 text-white border-green-800 hover:bg-green-700'
                                            }`}
                                        >
                                            {publishActionLoading
                                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                                : runoffPublished
                                                    ? <>Yes, Unpublish</>
                                                    : <>Yes, Publish Results</>
                                            }
                                        </button>
                                        <button
                                            onClick={() => setConfirmPublishToggle(false)}
                                            className="px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest bg-zinc-100 text-zinc-600 border-b-4 border-zinc-200 hover:bg-zinc-200 active:border-b-0 transition-all"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-end gap-1">
                                        <button
                                            onClick={() => setConfirmPublishToggle(true)}
                                            disabled={!runoffPublished && runoffOpen}
                                            title={!runoffPublished && runoffOpen ? 'Close the runoff first' : undefined}
                                            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all border-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                                                runoffPublished
                                                    ? 'border-zinc-300 bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                                                    : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                                            }`}
                                        >
                                            {runoffPublished ? 'Unpublish Results' : 'Publish Results'}
                                        </button>
                                        {!runoffPublished && runoffOpen && (
                                            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">
                                                Close the runoff first
                                            </span>
                                        )}
                                    </div>
                                )
                            ) : (
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                    Only super admins can publish results
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Runoff turnout */}
                {runoffStarted && runoffTurnout && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                            <div className="h-1 bg-zinc-200" />
                            <div className="p-6 flex flex-col items-center text-center">
                                <Users className="w-6 h-6 text-zinc-300 mb-2" />
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Eligible</span>
                                <span className="text-5xl font-black text-zinc-900 tabular-nums">{runoffTurnout.total_eligible}</span>
                            </div>
                        </div>
                        <div className="bg-zinc-900 rounded-2xl border-2 border-zinc-900 overflow-hidden">
                            <div className="h-1 bg-orange-400" />
                            <div className="p-6 flex flex-col items-center text-center">
                                <TrendingUp className="w-6 h-6 text-orange-400 mb-2" />
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Runoff Votes Cast</span>
                                <span className="text-5xl font-black text-white tabular-nums">{runoffTurnout.votes_cast}</span>
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                            <div className="h-1 bg-orange-400" />
                            <div className="p-6 flex flex-col items-center text-center justify-center">
                                <span className="text-5xl font-black text-zinc-900 tabular-nums">{runoffTurnout.turnout_percentage}%</span>
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1">Runoff Turnout</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Runoff tally */}
                {runoffStarted ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {RUNOFF_POSITION_KEYS.map(posKey => {
                            const result = buildRunoffPositionResults(posKey);
                            if (!result) return null;
                            const { label, candidates, total } = result;
                            const runoffTotalBallotsCast = runoffTurnout?.total_ballots_cast ?? runoffTurnout?.votes_cast ?? 0;

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

                                        {total === 0 ? (
                                            <div className="py-4 text-center">
                                                <p className="text-sm text-zinc-400 font-bold italic">No runoff votes recorded yet.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                {candidates.map((candidate, index) => {
                                                    const nextCandidate = candidates[1];
                                                    const isTiedRace = !!nextCandidate && candidates[0]?.votes === nextCandidate.votes && candidates[0].votes > 0;
                                                    const hasPlurality = index === 0 && candidate.votes > 0 && !isTiedRace && (!nextCandidate || candidate.votes > nextCandidate.votes);
                                                    const isWinner = hasPlurality && candidate.votes >= (runoffTotalBallotsCast / 2);
                                                    const pct = runoffTotalBallotsCast > 0 ? Math.round((candidate.votes / runoffTotalBallotsCast) * 100) : 0;

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
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="bg-zinc-50 rounded-2xl border-2 border-zinc-200 p-8 text-center">
                        <p className="text-sm font-black text-zinc-500 uppercase tracking-widest">
                            No runoff started yet
                        </p>
                        <p className="text-xs text-zinc-400 font-medium mt-1">
                            Once you open the runoff above, ballots for President and Minister of Education will appear here live.
                        </p>
                    </div>
                )}

            </> /* end overview tab */}

            {/* ── EC MEMBERS TAB ──────────────────────────────────────────── */}
            {activeTab === 'members' && (
                <div className="space-y-5">

                    {/* Add member button (super admin only) */}
                    {isSuperAdmin && (
                        <div className="flex justify-end">
                            <button
                                onClick={() => { setShowAddMember(s => !s); setMemberError(''); }}
                                className="flex items-center gap-2 bg-zinc-900 text-white text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-zinc-800 border-b-4 border-zinc-700 active:border-b-0 active:scale-95 transition-all"
                            >
                                {showAddMember ? '✕  Cancel' : '+ Add EC Member'}
                            </button>
                        </div>
                    )}

                    {/* Add member form */}
                    {showAddMember && (
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                            <div className="h-1 bg-yellow-500" />
                            <form onSubmit={handleAddMember} className="p-5 space-y-4">
                                <h3 className="text-sm font-black text-zinc-900 uppercase tracking-widest">New EC Member Account</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {[
                                        { id: 'u-username',  label: 'Username',  key: 'username',  type: 'text',     placeholder: 'innoce.belz' },
                                        { id: 'u-fullname',  label: 'Full Name', key: 'full_name', type: 'text',     placeholder: 'Innoce belz' },
                                        { id: 'u-password',  label: 'Password',  key: 'password',  type: 'password', placeholder: '••••••••' },
                                    ].map(f => (
                                        <div key={f.id}>
                                            <label htmlFor={f.id} className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">{f.label}</label>
                                            <input
                                                id={f.id}
                                                type={f.type}
                                                placeholder={f.placeholder}
                                                value={(newMember as any)[f.key]}
                                                onChange={e => setNewMember(p => ({ ...p, [f.key]: e.target.value }))}
                                                className="w-full rounded-lg border-2 border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-yellow-500 focus:bg-white transition-all"
                                            />
                                        </div>
                                    ))}
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Role</label>
                                        <select
                                            value={newMember.role}
                                            onChange={e => setNewMember(p => ({ ...p, role: e.target.value }))}
                                            className="w-full rounded-lg border-2 border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-yellow-500 focus:bg-white transition-all"
                                        >
                                            <option value="ec_member">EC Member (view only)</option>
                                            <option value="super_admin">Super Admin (full control)</option>
                                        </select>
                                    </div>
                                </div>
                                {memberError && <p className="text-sm text-red-600 font-bold">{memberError}</p>}
                                <button
                                    type="submit"
                                    disabled={memberLoading}
                                    className="bg-zinc-900 text-white text-xs font-black uppercase tracking-widest px-6 py-3 rounded-xl hover:bg-zinc-800 disabled:opacity-50 transition-all border-b-4 border-zinc-700 active:border-b-0"
                                >
                                    {memberLoading ? 'Creating...' : 'Create Account'}
                                </button>
                            </form>
                        </div>
                    )}

                    {/* Members list */}
                    <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                        <div className="h-1 bg-yellow-500" />
                        <div className="divide-y divide-zinc-100">
                            {members.length === 0 && (
                                <p className="text-center text-zinc-400 text-sm font-bold py-8">No EC members found.</p>
                            )}
                            {members.map((m: any) => (
                                <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm shrink-0 ${
                                        m.is_active ? 'bg-zinc-900 text-yellow-400' : 'bg-zinc-100 text-zinc-400'
                                    }`}>
                                        {m.full_name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-black text-zinc-900 truncate">{m.full_name}</p>
                                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                                            @{m.username} · {m.role.replace('_', ' ')}
                                        </p>
                                    </div>
                                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider ${
                                        m.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-400'
                                    }`}>
                                        {m.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                    {isSuperAdmin && m.username !== currentAdminUsername && (
                                        <button
                                            onClick={() => handleToggleMember(m.id, m.full_name)}
                                            className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 transition-all ${
                                                m.is_active
                                                    ? 'border-red-200 text-red-600 hover:bg-red-50'
                                                    : 'border-green-200 text-green-600 hover:bg-green-50'
                                            }`}
                                        >
                                            {m.is_active ? 'Deactivate' : 'Activate'}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── AUDIT LOG TAB ───────────────────────────────────────────── */}
            {activeTab === 'audit' && (
                <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                    <div className="h-1 bg-yellow-500" />
                    <div className="p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Audit Trail</h2>
                            <button
                                onClick={fetchAuditLog}
                                className="text-[10px] font-black text-zinc-400 hover:text-zinc-700 uppercase tracking-widest transition-colors"
                            >
                                ↻ Refresh
                            </button>
                        </div>
                        {auditLoading ? (
                            <div className="text-center py-8 text-zinc-400">
                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-yellow-500" />
                                <p className="text-xs font-bold uppercase tracking-widest">Loading log...</p>
                            </div>
                        ) : (
                            <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                                {auditLog.length === 0 && (
                                    <p className="text-center text-zinc-400 text-sm font-bold py-8">No audit entries yet.</p>
                                )}
                                {auditLog.map((entry: any) => {
                                    const isAdmin   = !['voter', 'system'].includes(entry.admin_username);
                                    const isVote    = entry.action === 'vote_cast';
                                    const isDanger  = entry.action.includes('closed') || entry.action.includes('deactivat') || entry.action.includes('failed');
                                    const isSuccess = entry.action.includes('opened') || entry.action === 'admin_login' || entry.action === 'admin_user_created';

                                    return (
                                        <div key={entry.id} className={`flex items-start gap-3 px-3 py-2.5 rounded-xl text-xs ${
                                            isDanger  ? 'bg-red-50'    :
                                                isSuccess ? 'bg-green-50'  :
                                                    isVote    ? 'bg-zinc-50'   : 'bg-zinc-50'
                                        }`}>
                                            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                                isDanger  ? 'bg-red-500'    :
                                                    isSuccess ? 'bg-green-500'  :
                                                        isVote    ? 'bg-yellow-500' : 'bg-zinc-300'
                                            }`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-black text-zinc-700 uppercase tracking-wide">
                                                        {entry.action.replace(/_/g, ' ')}
                                                    </span>
                                                    {isAdmin && (
                                                        <span className="font-bold text-zinc-400">
                                                            by @{entry.admin_username}
                                                        </span>
                                                    )}
                                                </div>
                                                {entry.detail && (
                                                    <p className="text-zinc-400 font-medium mt-0.5 truncate">{entry.detail}</p>
                                                )}
                                            </div>
                                            <span className="text-zinc-300 font-mono shrink-0 text-[10px]">
                                                {new Date(entry.logged_at).toLocaleString()}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── INTEGRITY CHECK TAB ─────────────────────────────────────── */}
            {activeTab === 'integrity' && (
                <div className="space-y-5">

                    {/* Run button */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Pre-Election Integrity Check</h2>
                            <p className="text-xs text-zinc-400 font-medium mt-1">
                                Scans the voter database for duplicate emails, duplicate names, and other registration anomalies before opening the election.
                            </p>
                        </div>
                        <button
                            onClick={fetchIntegrityCheck}
                            disabled={integrityLoading}
                            className="shrink-0 flex items-center gap-2 bg-zinc-900 text-white text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-zinc-800 border-b-4 border-zinc-700 active:border-b-0 active:scale-95 transition-all disabled:opacity-50 ml-4"
                        >
                            {integrityLoading ? (
                                <><Loader2 className="w-4 h-4 animate-spin text-yellow-400" /> Running...</>
                            ) : (
                                '▶ Run Check'
                            )}
                        </button>
                    </div>

                    {/* Loading */}
                    {integrityLoading && (
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 p-10 flex flex-col items-center gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
                            <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Scanning voter database...</p>
                        </div>
                    )}

                    {/* Results */}
                    {integrityData && !integrityLoading && (
                        <>
                            {/* Summary row */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[
                                    { label: 'Total Voters',    value: integrityData.total_voters,  color: 'bg-zinc-900 text-white'       },
                                    { label: 'Voted So Far',    value: integrityData.voted_count,   color: 'bg-zinc-100 text-zinc-700'    },
                                    { label: 'Ballot Records',  value: integrityData.ballot_count,  color: 'bg-zinc-100 text-zinc-700'    },
                                    { label: 'Issues Found',    value: integrityData.issue_count,
                                        color: integrityData.issue_count === 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800' },
                                ].map(s => (
                                    <div key={s.label} className={`rounded-xl p-4 text-center ${s.color}`}>
                                        <p className="text-3xl font-black tabular-nums">{s.value}</p>
                                        <p className="text-[10px] font-black uppercase tracking-widest mt-1 opacity-70">{s.label}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Safe-to-open banner */}
                            <div className={`rounded-xl border-2 px-5 py-4 flex items-center gap-3 ${
                                integrityData.safe_to_open
                                    ? 'bg-green-50 border-green-200'
                                    : 'bg-red-50 border-red-200'
                            }`}>
                                <span className="text-2xl">{integrityData.safe_to_open ? '✅' : '⚠️'}</span>
                                <div>
                                    <p className={`text-sm font-black uppercase tracking-wider ${integrityData.safe_to_open ? 'text-green-800' : 'text-red-800'}`}>
                                        {integrityData.safe_to_open
                                            ? 'No high-severity issues detected — safe to open the election'
                                            : 'High-severity issues found — resolve before opening the election'
                                        }
                                    </p>
                                    <p className={`text-xs font-medium mt-0.5 ${integrityData.safe_to_open ? 'text-green-600' : 'text-red-600'}`}>
                                        {integrityData.safe_to_open
                                            ? 'Duplicate name flags (medium severity) may be coincidences, review at your discretion.'
                                            : 'Duplicate emails mean one person may be able to vote twice. Investigate each case in Supabase before proceeding.'
                                        }
                                    </p>
                                </div>
                            </div>

                            {/* Issues list */}
                            {integrityData.issues.length === 0 ? (
                                <div className="bg-white rounded-2xl border-2 border-green-200 p-8 text-center">
                                    <p className="text-4xl mb-3">🎉</p>
                                    <p className="text-sm font-black text-green-800 uppercase tracking-widest">All Clear</p>
                                    <p className="text-xs text-zinc-400 font-medium mt-2">No duplicate emails or suspicious registrations detected.</p>
                                </div>
                            ) : (
                                <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                                    <div className="h-1 bg-yellow-500" />
                                    <div className="p-5">
                                        <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest mb-4">
                                            Issues Requiring EC Review
                                        </h3>
                                        <div className="space-y-3">
                                            {integrityData.issues.map((issue: any, idx: number) => (
                                                <div key={idx} className={`rounded-xl border-2 px-4 py-3 ${
                                                    issue.severity === 'high'
                                                        ? 'bg-red-50 border-red-200'
                                                        : 'bg-amber-50 border-amber-200'
                                                }`}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${
                                                            issue.severity === 'high'
                                                                ? 'bg-red-200 text-red-800'
                                                                : 'bg-amber-200 text-amber-800'
                                                        }`}>
                                                            {issue.severity === 'high' ? '🚨 High' : '⚠️ Medium'} · {issue.type.replace(/_/g, ' ')}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-zinc-700 font-medium leading-relaxed">
                                                        {issue.detail}
                                                    </p>
                                                    <p className={`text-[10px] font-bold mt-1.5 ${
                                                        issue.severity === 'high' ? 'text-red-600' : 'text-amber-700'
                                                    }`}>
                                                        {issue.type === 'duplicate_email'
                                                            ? 'ACTION: Identify which registration is legitimate. Delete the fraudulent row in Supabase → Voters table.'
                                                            : 'ACTION: Verify in university records that these are two different people with the same name. If the same person, remove the duplicate.'}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* What to do guide */}
                            <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden">
                                <div className="h-1 bg-zinc-900" />
                                <div className="p-5 space-y-3">
                                    <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">How to Resolve Issues</h3>
                                    {[
                                        {
                                            title: ' Duplicate email (HIGH)',
                                            body:  'One person registered more than once with different matric numbers. Go to Supabase → Table Editor → Voters, find all rows with that email, and delete the fraudulent one. Keep the row where the matric number matches the student\'s real university ID.',
                                        },
                                        {
                                            title: ' Duplicate name (MEDIUM)',
                                            body:  'Two registrations share the same full name. This may be two different students with the same name, cross-check their matric numbers and emails against university records. If it\'s the same person registered twice, delete the duplicate row.',
                                        },
                                        {
                                            title: ' After resolving',
                                            body:  'Click "Run Check" again to confirm the issues are gone before opening the election. This check is also logged in the Audit Log so the EC has a record that it was performed.',
                                        },
                                    ].map(item => (
                                        <div key={item.title} className="bg-zinc-50 rounded-xl px-4 py-3">
                                            <p className="text-xs font-black text-zinc-800 mb-1">{item.title}</p>
                                            <p className="text-xs text-zinc-500 font-medium leading-relaxed">{item.body}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Prompt to run if not run yet */}
                    {!integrityData && !integrityLoading && (
                        <div className="bg-white rounded-2xl border-2 border-zinc-200 p-10 text-center">
                            <p className="text-4xl mb-3">🛡️</p>
                            <p className="text-sm font-black text-zinc-700 uppercase tracking-widest mb-2">Run Before Opening the Election</p>
                            <p className="text-xs text-zinc-400 font-medium max-w-sm mx-auto">
                                Click "Run Check" above to scan for duplicate registrations, suspicious emails, and potential fraud before votes are cast.
                            </p>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
};

export default AdminDashboard;