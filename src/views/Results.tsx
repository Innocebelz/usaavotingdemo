import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { CheckCircle2, TrendingUp, Users, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ELECTION_DATA, RUNOFF_ELECTION_DATA } from '../constants';

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL || 'https://laa-voting-system.onrender.com';

// ── Animated count-up hook ────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1400, delay = 200) {
  const [value, setValue] = useState(0);
  const rafRef   = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }

    const start = () => {
      startRef.current = null;
      const step = (timestamp: number) => {
        if (!startRef.current) startRef.current = timestamp;
        const elapsed = timestamp - startRef.current;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    };

    const timeout = setTimeout(start, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, delay]);

  return value;
}

// ── Reusable turnout ring, so general + runoff cards don't duplicate markup ──
interface TurnoutRingProps {
  label: string;
  pct: number;
  cast: number;
  total: number;
  accent: 'yellow' | 'orange';
}
const TurnoutRing: React.FC<TurnoutRingProps> = ({ label, pct, cast, total, accent }) => {
  const RADIUS    = 15.9155;
  const CIRCUMF   = 2 * Math.PI * RADIUS;
  const arcOffset = CIRCUMF - (pct / 100) * CIRCUMF;
  const stroke    = accent === 'orange' ? '#f97316' : '#eab308';
  const barClass  = accent === 'orange' ? 'bg-orange-500' : 'bg-yellow-500';
  const pctTextClass = accent === 'orange' ? 'text-orange-600' : 'text-yellow-600';

  return (
    <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden shadow-sm">
      <div className={`h-1.5 w-full ${accent === 'orange' ? 'bg-orange-500' : 'bg-yellow-500'}`} />
      <div className="p-6">
        <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-6">
          {label}
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-6 mb-6">
          <div className="relative w-44 h-44 shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="#f4f4f5" strokeWidth="3" />
              <circle
                cx="18" cy="18" r={RADIUS}
                fill="none"
                stroke={stroke}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${CIRCUMF} ${CIRCUMF}`}
                strokeDashoffset={arcOffset}
                style={{ transition: 'stroke-dashoffset 0.05s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-black text-zinc-900 leading-none">{pct}%</span>
              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1">Participation</span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-3">
            <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Votes Cast</p>
                <p className="text-3xl font-black text-zinc-900 tabular-nums">{cast}</p>
              </div>
              <TrendingUp className={`w-8 h-8 ${accent === 'orange' ? 'text-orange-400' : 'text-yellow-400'}`} />
            </div>
            <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Eligible</p>
                <p className="text-3xl font-black text-zinc-900 tabular-nums">{total}</p>
              </div>
              <Users className="w-8 h-8 text-zinc-300" />
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Voter Participation</span>
            <span className={`text-[10px] font-black uppercase tracking-widest ${pctTextClass}`}>{pct}%</span>
          </div>
          <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-75 ${barClass}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-zinc-400 font-semibold">0</span>
            <span className="text-[10px] text-zinc-400 font-semibold">{total}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Results: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  // Show the ballot this voter actually cast — keyed to the phase recorded
  // at the time they voted, not whatever phase the election is in now.
  const isRunoff = user?.phase === 'runoff';
  const ELECTION_DATA_ACTIVE = isRunoff ? RUNOFF_ELECTION_DATA : ELECTION_DATA;

  const [turnoutData, setTurnoutData] = useState({
    total_eligible: 0,
    votes_cast: 0,
    turnout_percentage: 0,
  });

  // Runoff turnout — shown alongside the general turnout once a runoff has
  // been started, regardless of which round this particular voter cast
  // their ballot in (so a general-round voter can still see runoff progress
  // if they revisit this page, and vice versa).
  const [runoffTurnoutData, setRunoffTurnoutData] = useState<{
    started: boolean;
    total_eligible: number;
    votes_cast: number;
    turnout_percentage: number;
  }>({ started: false, total_eligible: 0, votes_cast: 0, turnout_percentage: 0 });

  // Fade-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Live polling every 10 s
  useEffect(() => {
    const fetchTurnout = async () => {
      try {
        const [genRes, runoffRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/results/turnout`),
          fetch(`${BACKEND_URL}/api/results/runoff-turnout`),
        ]);
        if (genRes.ok) {
          const data = await genRes.json();
          setTurnoutData({
            total_eligible:     data.total_eligible,
            votes_cast:         data.votes_cast,
            turnout_percentage: data.turnout_percentage,
          });
        }
        if (runoffRes.ok) {
          const data = await runoffRes.json();
          if (data.started) {
            setRunoffTurnoutData({
              started: true,
              total_eligible:     data.total_eligible,
              votes_cast:         data.votes_cast,
              turnout_percentage: data.turnout_percentage,
            });
          } else {
            setRunoffTurnoutData(prev => ({ ...prev, started: false }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch turnout:', err);
      }
    };
    fetchTurnout();
    const interval = setInterval(fetchTurnout, 10000);
    return () => clearInterval(interval);
  }, []);

  const { total_eligible, votes_cast, turnout_percentage } = turnoutData;

  // Animated numbers — general
  const animPct   = useCountUp(turnout_percentage, 1400, 300);
  const animCast  = useCountUp(votes_cast,         1200, 400);
  const animTotal = useCountUp(total_eligible,     1200, 500);

  // Animated numbers — runoff
  const animPctR   = useCountUp(runoffTurnoutData.turnout_percentage, 1400, 300);
  const animCastR  = useCountUp(runoffTurnoutData.votes_cast,         1200, 400);
  const animTotalR = useCountUp(runoffTurnoutData.total_eligible,     1200, 500);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
      <div
          className={`w-full max-w-2xl mx-auto flex flex-col space-y-5 self-start transition-all duration-500 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
      >

        {/* ── Vote confirmed banner ────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border-2 border-green-200 overflow-hidden shadow-sm">
          <div className="h-1.5 bg-green-500 w-full" />
          <div className="px-6 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 border-2 border-green-300 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-green-800 uppercase tracking-wide">
                {isRunoff ? 'Runoff Vote Recorded' : 'Vote Recorded'}
              </p>
              <p className="text-xs text-green-700 font-medium mt-0.5">
                Thank you, <span className="font-black">{user?.name || 'Voter'}</span>. Your ballot has been securely submitted.
              </p>
            </div>
            <button
                onClick={handleLogout}
                title="Sign out"
                className="text-zinc-400 hover:text-zinc-700 p-2 rounded-full hover:bg-zinc-100 transition-colors shrink-0"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Ballot receipt ───────────────────────────────────────────────── */}
        {user?.ballotId && (
            <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden shadow-sm">
              <div className="h-1.5 bg-yellow-500 w-full" />
              <div className="px-6 py-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-zinc-800 uppercase tracking-widest mb-1">
                      Your Ballot Receipt
                    </p>
                    <p className="text-[11px] text-zinc-500 font-medium mb-3 leading-relaxed">
                      Save this reference number. After the election closes, you can use it to confirm your ballot was counted — without revealing how you voted.
                    </p>
                    <div className="bg-zinc-50 border-2 border-zinc-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                      <code className="text-xs font-mono font-bold text-zinc-700 break-all">
                        {user.ballotId}
                      </code>
                      <button
                          onClick={() => navigator.clipboard.writeText(user.ballotId!)}
                          className="text-[10px] font-black text-yellow-600 hover:text-yellow-700 uppercase tracking-widest shrink-0 transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* ── Turnout card(s) ──────────────────────────────────────────────── */}
        <TurnoutRing label="Live Turnout Metrics · General Election" pct={animPct} cast={animCast} total={animTotal} accent="yellow" />

        {runoffTurnoutData.started && (
          <TurnoutRing label="Live Turnout Metrics · Runoff Election" pct={animPctR} cast={animCastR} total={animTotalR} accent="orange" />
        )}

        {/* ── Your ballot summary ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden shadow-sm">
          <div className="h-1.5 bg-yellow-500 w-full" />
          <div className="p-6">
            <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-5">
              Your Cast Ballot
            </p>

            {/* Check if we actually have ballot choices stored in this session */}
            {user?.userBallot && Object.values(user.userBallot).some(v => v) ? (

                /* ── Show choices — only available in the same session as voting ── */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ELECTION_DATA_ACTIVE.map((category) => {
                    const selectedId = user?.userBallot?.[category.position];
                    const candidate  = category.candidates.find(c => c.id === selectedId);

                    return (
                        <div
                            key={category.position}
                            className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3"
                        >
                          {candidate?.image && (
                              <img
                                  src={candidate.image}
                                  alt={candidate.name}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src =
                                        `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate?.name ?? '')}&background=18181b&color=eab308&size=64`;
                                  }}
                                  className="w-9 h-9 rounded-full object-cover border-2 border-zinc-200 shrink-0"
                              />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                              {category.position}
                            </p>
                            <p className="text-sm font-black text-zinc-900 truncate">
                              {candidate?.name || '—'}
                            </p>
                          </div>
                          <CheckCircle2 className="w-4 h-4 text-yellow-500 shrink-0" />
                        </div>
                    );
                  })}
                </div>

            ) : (

                /* ── No ballot data in this session — explain why ── */
                <div className="flex flex-col items-center text-center gap-4 py-4">
                  <div className="w-14 h-14 rounded-full bg-zinc-100 border-2 border-zinc-200 flex items-center justify-center">
                    <ShieldCheck className="w-7 h-7 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-zinc-700 mb-2">
                      Your ballot choices are protected by anonymisation
                    </p>
                    <p className="text-xs text-zinc-400 font-medium leading-relaxed max-w-sm">
                      Your ballot was recorded using a random anonymous ID; No link
                      exists between your identity and your choices, even in the
                      database. Because of this, your specific selections cannot be
                      displayed when you log in again.
                    </p>
                  </div>
                  {user?.ballotId ? (
                      <div className="bg-zinc-50 border-2 border-zinc-200 rounded-xl px-4 py-3 w-full text-left">
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                          Use your receipt code to verify your ballot was counted
                        </p>
                        <code className="text-xs font-mono font-bold text-zinc-700 break-all">
                          {user.ballotId}
                        </code>
                      </div>
                  ) : (
                      <p className="text-xs text-zinc-400 font-medium">
                        Go to the{' '}
                        <span className="font-black text-yellow-600">/election-results</span>
                        {' '}page and use the Ballot Verification box with your receipt code.
                      </p>
                  )}
                </div>

            )}
          </div>
        </div>

        {/* ── Security / status footer ──────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border-2 border-zinc-200 overflow-hidden shadow-sm">
          <div className="h-1.5 bg-zinc-900 w-full" />
          <div className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-yellow-400" />
              </div>
              <p className="text-[11px] text-zinc-600 font-bold uppercase tracking-wider leading-tight">
                Submitted Over a Secure HTTPS Connection
              </p>
            </div>
            <div className="text-center sm:text-right">
              <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">
                Candidate standings remain hidden<br className="hidden sm:block" /> until the election concludes.
              </p>
            </div>
          </div>
        </div>

      </div>
  );
};

export default Results;
