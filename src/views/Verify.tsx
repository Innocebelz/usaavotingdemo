import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';

const OTP_LENGTH = 6;

const Verify: React.FC = () => {
  // Each digit lives in its own slot
  const [digits, setDigits]     = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError]       = useState('');
  const [countdown, setCountdown] = useState(60);
  const [visible, setVisible]   = useState(false);
  const [shake, setShake]       = useState(false);   // shake animation on wrong code

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { matNumber, verifyOtp, login, user, maskedEmail, demoMode, demoOtp } = useAuth();
  const navigate = useNavigate();

  // Demo mode: the backend hands back the OTP directly (no real inbox to
  // check), so auto-fill it the moment it arrives and let the visitor just
  // hit submit — or edit it if they want to see the "wrong code" state.
  useEffect(() => {
    if (demoOtp && demoOtp.length === OTP_LENGTH) {
      setDigits(demoOtp.split(''));
    }
  }, [demoOtp]);

  // Fade-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearInterval(t);
  }, [countdown]);

  // Focus first empty box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  if (!matNumber) return <Navigate to="/login" replace />;
  if (user)       return <Navigate to={user.hasVoted ? '/results' : '/voting-booth'} replace />;

  // ── OTP digit input handlers ───────────────────────────────────────────

  const handleDigitChange = (index: number, value: string) => {
    // Allow paste of full 6-digit code into any box
    if (value.length > 1) {
      const clean = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
      const next  = [...Array(OTP_LENGTH).fill('')];
      clean.split('').forEach((ch, i) => { next[i] = ch; });
      setDigits(next);
      setError('');
      // Focus the box after the last pasted digit (or the last box)
      const focusIdx = Math.min(clean.length, OTP_LENGTH - 1);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const digit = value.replace(/\D/g, '');
    const next  = [...digits];
    next[index] = digit;
    setDigits(next);
    if (error) setError('');

    // Auto-advance to next box
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        // Clear current box
        const next = [...digits];
        next[index] = '';
        setDigits(next);
      } else if (index > 0) {
        // Move back and clear previous box
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────

  const otp = digits.join('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== OTP_LENGTH) {
      setError('Please fill in all 6 digits.');
      inputRefs.current[digits.findIndex((d) => !d)]?.focus();
      return;
    }

    try {
      setError('');
      setLoading(true);
      await verifyOtp(otp);
    } catch (err: any) {
      // Wrong code — shake the boxes and clear them so they can retry
      setError(err.message || 'Incorrect code. Please try again.');
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setDigits(Array(OTP_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
      }, 500);
    } finally {
      if (!user) setLoading(false);
    }
  };

  // ── Resend ─────────────────────────────────────────────────────────────

  const handleResend = async () => {
    if (countdown > 0 || resending || !matNumber) return;
    try {
      setError('');
      setResending(true);
      await login(matNumber);
      setCountdown(60);
      setDigits(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const allFilled = otp.length === OTP_LENGTH;

  return (
      <div
          className={`w-full max-w-sm mx-auto self-center transition-all duration-500 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
      >
        <div className="bg-white rounded-2xl shadow-md border-2 border-zinc-200 overflow-hidden">

          {/* Gold top bar */}
          <div className="h-1.5 bg-yellow-500 w-full" />

          <div className="p-8">

            {/* Back button */}
            <button
                onClick={() => navigate('/login')}
                className="flex items-center text-xs font-bold text-zinc-400 hover:text-zinc-700 transition-colors uppercase tracking-wider mb-6 group"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1 group-hover:-translate-x-0.5 transition-transform" />
              Back
            </button>

            {/* Icon + heading */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-zinc-900 border-2 border-yellow-500 mb-4">
                <Mail className="w-7 h-7 text-yellow-400" />
              </div>
              <h1 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">
                Enter Code
              </h1>
              <p className="text-zinc-500 mt-2 text-sm font-medium leading-relaxed">
                {demoMode ? (
                  <>Demo code auto-filled below for matric{' '}
                    <span className="font-mono font-bold text-zinc-800">{matNumber}</span>.</>
                ) : (
                  <>A 6-digit code was sent to{' '}
                    <span className="font-bold text-zinc-800">{maskedEmail || 'your email'}</span>
                    {' '}for matric <span className="font-mono font-bold text-zinc-800">{matNumber}</span>.</>
                )}
              </p>
              {demoMode && demoOtp && (
                <p className="mt-2 text-xs font-black text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-1.5 inline-block">
                  Your code: <span className="font-mono">{demoOtp}</span>
                </p>
              )}
            </div>

            {/* 6-digit OTP boxes */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <div
                    className={`flex gap-2 justify-center transition-transform duration-100 ${
                        shake ? 'translate-x-2' : 'translate-x-0'
                    }`}
                    style={shake ? { animation: 'shake 0.4s ease-in-out' } : {}}
                >
                  {digits.map((digit, i) => (
                      <input
                          key={i}
                          ref={(el) => { inputRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={6}   // allows paste into any box
                          value={digit}
                          onChange={(e) => handleDigitChange(i, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(i, e)}
                          onFocus={(e) => e.target.select()}
                          disabled={loading}
                          className={`w-11 h-14 text-center font-mono text-xl font-black rounded-lg border-2 outline-none transition-all duration-200 ${
                              error
                                  ? 'border-red-400 bg-red-50 text-red-600'
                                  : digit
                                      ? 'border-yellow-500 bg-yellow-50 text-zinc-900'
                                      : 'border-zinc-200 bg-zinc-50 text-zinc-900 focus:border-yellow-500 focus:bg-white'
                          }`}
                      />
                  ))}
                </div>

                {/* Error */}
                <div className={`overflow-hidden transition-all duration-300 ${error ? 'max-h-10 mt-3' : 'max-h-0'}`}>
                  <p className="text-sm text-red-600 font-semibold text-center">{error}</p>
                </div>
              </div>

              {/* Submit button */}
              <button
                  type="submit"
                  disabled={loading || !allFilled}
                  className={`w-full flex justify-center items-center rounded-xl px-3 py-4 text-sm font-black shadow-lg transition-all duration-150 border-b-4 active:border-b-0 active:scale-95 uppercase tracking-widest ${
                      allFilled && !loading
                          ? 'bg-zinc-900 text-white hover:bg-zinc-800 border-zinc-700'
                          : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'
                  }`}
              >
                {loading ? (
                    <>
                      <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5 text-yellow-400" />
                      <span className="text-yellow-400">Verifying...</span>
                    </>
                ) : (
                    'Verify & Continue'
                )}
              </button>
            </form>

            {/* Resend */}
            <div className="mt-7 flex items-center justify-center gap-1.5 text-sm">
              <span className="text-zinc-400 font-medium">Didn't receive it?</span>
              <button
                  onClick={handleResend}
                  disabled={countdown > 0 || resending}
                  className={`font-black text-xs uppercase tracking-wider transition-colors ${
                      countdown > 0 || resending
                          ? 'text-zinc-300 cursor-not-allowed'
                          : 'text-yellow-600 hover:text-yellow-700'
                  }`}
              >
                {resending
                    ? 'Sending...'
                    : countdown > 0
                        ? `Resend in ${countdown}s`
                        : 'Resend Code'}
              </button>
            </div>
          </div>
        </div>

        {/* Shake keyframe — injected inline so no extra CSS file needed */}
        <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-6px); }
          30%       { transform: translateX(6px); }
          45%       { transform: translateX(-4px); }
          60%       { transform: translateX(4px); }
          75%       { transform: translateX(-2px); }
          90%       { transform: translateX(2px); }
        }
      `}</style>
      </div>
  );
};

export default Verify;
