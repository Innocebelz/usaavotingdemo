import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, ElectionPhase } from '../types';
import { ELECTION_DATA, RUNOFF_ELECTION_DATA } from '../constants';

// --- LIVE BACKEND URL ---
// Reads from VITE_API_BASE_URL when set (so a demo deployment can point at
// its own separate backend via a Vercel env var), falling back to the real
// production backend for any deployment that doesn't set it.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://usaavotingdemo.onrender.com';

// ── Session expiry ────────────────────────────────────────────────────────────
// Voter sessions expire after 12 hours. After that, the stored auth state is
// wiped on the next page load so nobody gets stuck in a stale voting or
// "already voted" state from a previous day / previous election.
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;   // 12 hours in milliseconds
const AUTH_KEYS = ['laa_user', 'laa_matric', 'laa_email', 'laa_vote_token', 'laa_session_at'];

const clearAuthStorage = () => AUTH_KEYS.forEach(k => localStorage.removeItem(k));

// Runs synchronously at module load — before any useState initializer reads storage.
// If there is no timestamp or it's older than SESSION_MAX_AGE_MS, wipe everything.
const purgeStaleSession = () => {
  try {
    const raw = localStorage.getItem('laa_session_at');
    const isStale = !raw || (Date.now() - parseInt(raw, 10)) > SESSION_MAX_AGE_MS;
    if (isStale) clearAuthStorage();
  } catch {
    // localStorage blocked (e.g. Safari private mode) — nothing to clear
  }
};
purgeStaleSession();   // ← runs once when this module is first imported
// ─────────────────────────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  matNumber: string | null;
  maskedEmail: string | null;
  phase: ElectionPhase;
  electionData: typeof ELECTION_DATA;
  demoMode: boolean;
  demoOtp: string | null;
  login: (matNumber: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  vote: (userBallot: Record<string, string>) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {

  // 1. Initialize state by checking Local Storage first
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('laa_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [matNumber, setMatNumber] = useState<string | null>(() => {
    return localStorage.getItem('laa_matric') || null;
  });

  const [maskedEmail, setMaskedEmail] = useState<string | null>(() => {
    return localStorage.getItem('laa_email') || null;
  });

  // Proof that OTP verification succeeded — required by the backend to cast a vote.
  // Without this, POST /api/vote would accept any matric number with no proof
  // the OTP step ever happened.
  const [voteToken, setVoteToken] = useState<string | null>(() => {
    return localStorage.getItem('laa_vote_token') || null;
  });

  // ── Election phase ────────────────────────────────────────────────────────
  // "general" | "runoff" | "closed" — tells us which set of backend endpoints
  // to call (general-election endpoints vs runoff endpoints) and which
  // ELECTION_DATA array (all 7 positions vs the 2-position runoff ballot)
  // to render. Fetched once on load; re-fetched on every fresh login attempt
  // so a voter who opens the app during a phase change always gets the
  // current one.
  const [phase, setPhase] = useState<ElectionPhase>('general');

  const fetchPhase = async (): Promise<ElectionPhase> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/election/phase`);
      const data = await res.json().catch(() => ({}));
      const p: ElectionPhase = data.phase === 'runoff' || data.phase === 'closed' ? data.phase : 'general';
      setPhase(p);
      return p;
    } catch {
      return phase; // keep whatever we last knew on network failure
    }
  };

  useEffect(() => { fetchPhase(); }, []);

  const electionData = phase === 'runoff' ? RUNOFF_ELECTION_DATA : ELECTION_DATA;

  // ── Demo mode ──────────────────────────────────────────────────────────
  // Set by the backend (DEMO_MODE env var on that deployment only) — never
  // hardcoded here, so the exact same frontend code works for both the real
  // site and a demo deployment, just pointed at a different backend URL.
  const [demoMode, setDemoMode] = useState(false);
  const [demoOtp, setDemoOtp]   = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/demo/status`)
      .then(res => res.json())
      .then(data => setDemoMode(!!data.demo_mode))
      .catch(() => setDemoMode(false));
  }, []);

  // 2. Automatically sync state changes to Local Storage
  useEffect(() => {
    if (user) localStorage.setItem('laa_user', JSON.stringify(user));
    else localStorage.removeItem('laa_user');
  }, [user]);

  useEffect(() => {
    if (matNumber) localStorage.setItem('laa_matric', matNumber);
    else localStorage.removeItem('laa_matric');
  }, [matNumber]);

  useEffect(() => {
    if (maskedEmail) localStorage.setItem('laa_email', maskedEmail);
    else localStorage.removeItem('laa_email');
  }, [maskedEmail]);

  useEffect(() => {
    if (voteToken) localStorage.setItem('laa_vote_token', voteToken);
    else localStorage.removeItem('laa_vote_token');
  }, [voteToken]);

  // 3. API Functions (Connected to Cloud Backend)
  const login = async (matNum: string) => {
    // Always ask the backend which election is currently open right before
    // logging in — this is the moment it matters most (e.g. the EC could
    // have just switched from general to runoff).
    const currentPhase = await fetchPhase();
    const otpEndpoint = currentPhase === 'runoff' ? '/api/runoff/request-otp' : '/api/request-otp';

    const res = await fetch(`${API_BASE_URL}${otpEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matric_number: matNum })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Failed to request OTP');
    }

    setMatNumber(matNum);
    setMaskedEmail(data.email);
    setDemoOtp(data.demo_otp || null); // present only when the backend is in demo mode
    // Start the session clock — the 12-hour expiry is measured from here.
    localStorage.setItem('laa_session_at', String(Date.now()));
  };

  const verifyOtp = async (otp: string) => {
    if (!matNumber) throw new Error('Matriculation number is missing.');

    const verifyEndpoint = phase === 'runoff' ? '/api/runoff/verify-otp' : '/api/verify-otp';

    const res = await fetch(`${API_BASE_URL}${verifyEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matric_number: matNumber, otp_code: otp })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Invalid OTP');
    }

    setUser({
      matNumber: data.user.matric,
      name: data.user.name,
      hasVoted: data.hasVoted,
      userBallot: data.userBallot,
      phase,
    });

    // Present only when hasVoted is false — proves OTP was just verified.
    setVoteToken(data.voteToken || null);
    setDemoOtp(null); // no longer needed once verified
  };

  const vote = async (userBallot: Record<string, string>) => {
    if (!matNumber) throw new Error('Not authenticated');
    if (!voteToken) throw new Error('Your voting session has expired. Please verify your OTP again.');

    const isRunoff = phase === 'runoff';
    const activeData = isRunoff ? RUNOFF_ELECTION_DATA : ELECTION_DATA;
    const voteEndpoint = isRunoff ? '/api/runoff/vote' : '/api/vote';

    const payload: Record<string, unknown> = { matric_number: matNumber, choices: {} };

    // Build choices dynamically from the active ballot's positions so that
    // adding/renaming positions only requires updating constants.ts.
    const choices: Record<string, string> = {};
    activeData.forEach(cat => {
      choices[cat.dbKey] = userBallot[cat.position] || '';
    });
    payload.choices = choices;
    // Also spread individual fields for backwards-compat with the backend model
    Object.assign(payload, choices);

    const res = await fetch(`${API_BASE_URL}${voteEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voteToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to cast vote');
    }

    const result = await res.json();

    setVoteToken(null); // single-use: no longer needed once the ballot is recorded
    setUser((prev) => prev ? {
      ...prev,
      hasVoted:  true,
      userBallot,
      ballotId:  result.ballot_id ?? undefined,
    } : null);
  };

  const logout = () => {
    setUser(null);
    setMatNumber(null);
    setMaskedEmail(null);
    setVoteToken(null);
    setDemoOtp(null);
    clearAuthStorage();   // wipes all laa_* keys including laa_session_at
  };

  return (
      <AuthContext.Provider value={{ user, matNumber, maskedEmail, phase, electionData, demoMode, demoOtp, login, verifyOtp, vote, logout }}>
        {children}
      </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};