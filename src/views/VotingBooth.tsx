import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, AlertCircle, CheckCircle2, ChevronDown, ShieldCheck, ZoomIn, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ELECTION_DATA, RUNOFF_ELECTION_DATA } from '../constants';

const VotingBooth: React.FC = () => {
    const [selections, setSelections]     = useState<Record<string, string>>({});
    const [expanded, setExpanded]         = useState<Record<string, boolean>>({});
    const [showConfirm, setShowConfirm]   = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError]   = useState('');
    const [visible, setVisible]           = useState(false);
    const [justSelected, setJustSelected] = useState<string | null>(null);
    const [lightboxPhoto, setLightboxPhoto] = useState<{ image: string; name: string; position: string } | null>(null);
    const { user, vote } = useAuth();
    const navigate = useNavigate();
    const confirmRef = useRef<HTMLDivElement>(null);

    // Runoff voters see only President + Minister of Education, with only
    // the top 2 candidates from round one. Keyed off the phase this login
    // session was verified under (set once at OTP verification), not the
    // live/global phase, so an in-progress ballot never shifts underneath
    // a voter mid-session if the EC changes phase elsewhere.
    const isRunoff = user?.phase === 'runoff';
    const ELECTION_DATA_ACTIVE = isRunoff ? RUNOFF_ELECTION_DATA : ELECTION_DATA;

    // ── Scroll-reveal + stacking animation ───────────────────────────────
    // Purely visual — does not touch selections, submission, or any vote
    // state. Set STICKY_STACK_ENABLED to false to disable the "stacking
    // cards" pinning effect if it ever feels disorienting during real
    // voting, while keeping the fade/slide reveal on scroll.
    const STICKY_STACK_ENABLED = true;
    const [revealedCards, setRevealedCards] = useState<Record<string, boolean>>({});
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const key = (entry.target as HTMLElement).dataset.revealKey;
                    if (entry.isIntersecting && key) {
                        // Reveal once — never re-hide on scroll back up, so
                        // completed cards don't flicker or feel unstable.
                        setRevealedCards(prev => (prev[key] ? prev : { ...prev, [key]: true }));
                    }
                });
            },
            { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
        );

        Object.values(cardRefs.current).forEach(el => { if (el) observer.observe(el); });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 30);
        return () => clearTimeout(t);
    }, []);

    const handleSelect = (position: string, candidateId: string) => {
        setSelections(prev => {
            const category = ELECTION_DATA_ACTIVE.find(c => c.position === position);

            if (category?.unopposed && prev[position] === candidateId) {
                const newSelections = { ...prev };
                delete newSelections[position];
                return newSelections;
            }

            return { ...prev, [position]: candidateId };
        });

        setJustSelected(candidateId);
        setTimeout(() => setJustSelected(null), 600);
    };

    const toggleManifesto = (candidateId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(prev => ({ ...prev, [candidateId]: !prev[candidateId] }));
    };

    const opposedCategories = ELECTION_DATA_ACTIVE.filter(c => !c.unopposed);
    const requiredPositionsCount = opposedCategories.length;
    const selectedRequiredCount = opposedCategories.filter(c => selections[c.position]).length;

    const remaining = requiredPositionsCount - selectedRequiredCount;
    const isFormComplete = remaining === 0;

    const progressPct = requiredPositionsCount === 0
        ? 100
        : Math.round((selectedRequiredCount / requiredPositionsCount) * 100);

    const handleVoteSubmit = async () => {
        try {
            setSubmitError('');
            setIsSubmitting(true);
            await vote(selections);
            navigate('/results');
            setShowConfirm(false);
        } catch (error: any) {
            const message: string = error?.message || 'Something went wrong. Please try again.';
            console.error('[VotingBooth] vote failed:', message);
            if (message.toLowerCase().includes('session') || message.toLowerCase().includes('expired') || message.toLowerCase().includes('401')) {
                setShowConfirm(false);
                navigate('/verify');
            } else {
                setSubmitError(message);
            }
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className={`w-full flex-1 flex flex-col transition-all duration-500 ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
        >
            {/* ── Page header ────────────────────────────────────────────── */}
            <div className="mb-6 pt-2">
                <div className="flex items-center gap-3 mb-1">
                    <span className={`text-xs font-black border px-2.5 py-1 rounded-full uppercase tracking-widest ${
                        isRunoff
                            ? 'bg-orange-100 text-orange-800 border-orange-300'
                            : 'bg-green-100 text-green-800 border-green-300'
                    }`}>
                        {isRunoff ? 'Runoff Voting Open' : 'Voting Open'}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-black tracking-tight uppercase text-zinc-900">
                        {isRunoff ? 'Runoff Ballot' : 'Official Ballot'}
                    </h2>
                </div>
                <p className="text-zinc-500 font-medium text-sm">
                    {isRunoff
                        ? 'No candidate reached the 50% threshold in the first round for these positions. Pick one candidate per position below.'
                        : <>Select one candidate per position. Tap <strong>Read more</strong> to see their manifesto.</>}
                </p>
                <div className="mt-3 inline-flex items-center bg-zinc-100 border border-zinc-200 px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-zinc-700 uppercase tracking-widest">
                    Voter: {user?.matNumber}
                </div>
            </div>

            {/* ── Progress bar ───────────────────────────────────────────── */}
            <div className="mb-6 bg-white rounded-xl border-2 border-zinc-200 p-4">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-black uppercase tracking-widest text-zinc-600">
                        Progress
                    </span>
                    <span className={`text-xs font-black uppercase tracking-widest ${isFormComplete ? 'text-green-600' : 'text-yellow-600'}`}>
                        {isFormComplete ? '✓ Ready to Submit' : `${remaining} Required remaining`}
                    </span>
                </div>
                <div className="w-full h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${isFormComplete ? 'bg-green-500' : 'bg-yellow-500'}`}
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-widest mt-3 text-center">
                    Unopposed positions are optional. Leaving them blank counts as an abstention.
                </p>
            </div>

            {/* ── Ballot positions ───────────────────────────────────────── */}
            <div className="flex-1 space-y-6 mb-4">
                {ELECTION_DATA_ACTIVE.map((category, index) => {
                    const positionSelected  = !!selections[category.position];
                    const selectedCandidate = category.candidates.find(c => c.id === selections[category.position]);
                    const isPresident       = category.position.toLowerCase() === 'president';
                    const isRevealed        = !!revealedCards[category.dbKey];

                    return (
                        <div
                            key={category.position}
                            ref={(el) => { cardRefs.current[category.dbKey] = el; }}
                            data-reveal-key={category.dbKey}
                            style={STICKY_STACK_ENABLED ? {
                                position: 'sticky',
                                top: `${5 + index * 0.9}rem`,
                                zIndex: 10 + index,
                            } : undefined}
                            className={`bg-white rounded-2xl overflow-hidden transition-all duration-700 ease-out will-change-transform ${
                                isRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
                            } ${
                                isPresident
                                    ? `border-4 ${positionSelected ? 'border-yellow-400 shadow-lg' : 'border-zinc-300 shadow-md'}`
                                    : `border-2 ${positionSelected ? 'border-yellow-400 shadow-md' : 'border-zinc-200'}`
                            }`}
                        >
                            {/* Position header */}
                            <div className={`px-4 flex items-center justify-between border-b-2 ${
                                positionSelected ? 'bg-yellow-50 border-yellow-200' : 'bg-zinc-50 border-zinc-100'
                            } ${isPresident ? 'py-4' : 'py-3'}`}>
                                <div className="flex items-center gap-2 min-w-0">
                                    {positionSelected
                                        ? <CheckCircle2 className={`shrink-0 text-yellow-600 ${isPresident ? 'w-5 h-5' : 'w-4 h-4'}`} />
                                        : <div className={`rounded-full border-2 border-zinc-300 shrink-0 ${isPresident ? 'w-5 h-5' : 'w-4 h-4'}`} />
                                    }
                                    <div className="min-w-0">
                                        <h3 className={`font-black text-zinc-900 uppercase tracking-tight ${isPresident ? 'text-base sm:text-lg' : 'text-sm sm:text-base'}`}>
                                            {category.position}
                                        </h3>
                                        {/* Text confirmation of who was picked */}
                                        <p className={`text-xs font-bold text-yellow-700 truncate overflow-hidden transition-all duration-200 ${
                                            selectedCandidate ? 'max-h-5 opacity-100 mt-0.5' : 'max-h-0 opacity-0'
                                        }`}>
                                            {selectedCandidate ? `Selected: ${selectedCandidate.name}` : ''}
                                        </p>
                                    </div>
                                </div>
                                {category.unopposed && (
                                    <span className="text-[10px] font-black text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                                        Unopposed
                                    </span>
                                )}
                            </div>

                            {/* Candidate list — larger, more visible photos */}
                            <div className="divide-y divide-zinc-100">
                                {category.candidates.map((candidate) => {
                                    const isSelected  = selections[category.position] === candidate.id;
                                    const isExpanded  = expanded[candidate.id] ?? false;
                                    const isPulsing   = justSelected === candidate.id;
                                    const photoSize   = isPresident ? 'w-20 h-20 sm:w-24 sm:h-24' : 'w-16 h-16 sm:w-20 sm:h-20';

                                    return (
                                        <div key={candidate.id} className="flex flex-col">

                                            {/* ── Candidate row ── */}
                                            <div
                                                onClick={() => handleSelect(category.position, candidate.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        handleSelect(category.position, candidate.id);
                                                    }
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                className={`w-full flex items-center gap-4 px-4 py-4 text-left transition-all duration-200 active:bg-zinc-50 cursor-pointer select-none ${
                                                    isSelected ? 'bg-yellow-50' : 'bg-white hover:bg-zinc-50'
                                                } ${isPulsing ? 'scale-[0.99]' : 'scale-100'}`}
                                            >
                                                {/* Photo — meaningfully larger, this is a person, not an icon */}
                                                <div className={`relative shrink-0 transition-all duration-300 ${isSelected ? 'ring-4 ring-yellow-500 ring-offset-2 rounded-full' : ''}`}>
                                                    <img
                                                        src={candidate.image}
                                                        alt={candidate.name}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src =
                                                                `https://ui-avatars.com/api/?name=${encodeURIComponent(candidate.name)}&background=18181b&color=eab308&size=256`;
                                                        }}
                                                        className={`${photoSize} rounded-full object-cover border-2 border-zinc-200 transition-all duration-300`}
                                                    />
                                                    {isSelected && (
                                                        <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-yellow-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                                            <CheckCircle2 className="w-4 h-4 text-zinc-900" />
                                                        </div>
                                                    )}
                                                    {/* Tap-to-enlarge — shows the real, uncropped campaign photo */}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setLightboxPhoto({ image: candidate.image, name: candidate.name, position: category.position });
                                                        }}
                                                        aria-label={`View full photo of ${candidate.name}`}
                                                        className="absolute -top-1 -right-1 w-6 h-6 bg-zinc-900/80 hover:bg-zinc-900 rounded-full flex items-center justify-center border-2 border-white shadow-sm transition-colors"
                                                    >
                                                        <ZoomIn className="w-3 h-3 text-yellow-400" />
                                                    </button>
                                                </div>

                                                {/* Name + position */}
                                                <div className="flex-1 min-w-0">
                                                    <p className={`font-black truncate ${isPresident ? 'text-base sm:text-lg' : 'text-sm sm:text-base'} ${isSelected ? 'text-zinc-900' : 'text-zinc-800'}`}>
                                                        {candidate.name}
                                                    </p>
                                                    <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                                                        {category.position}
                                                    </p>
                                                </div>

                                                {/* Radio indicator */}
                                                <div className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                                                    isSelected
                                                        ? 'border-yellow-500 bg-yellow-500'
                                                        : 'border-zinc-300'
                                                }`}>
                                                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-zinc-900" />}
                                                </div>
                                            </div>

                                            {/* Read more toggle */}
                                            <button
                                                onClick={(e) => toggleManifesto(candidate.id, e)}
                                                className={`flex items-center gap-1 px-4 pb-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                                                    isSelected ? 'text-yellow-600 hover:text-yellow-700' : 'text-zinc-400 hover:text-zinc-600'
                                                }`}
                                            >
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                {isExpanded ? 'Hide manifesto' : 'Read manifesto'}
                                            </button>

                                            {/* Manifesto — expands/collapses. Renders structured campaign
                                                material (Vision / Key Priorities / Motto) when a candidate
                                                has submitted it; falls back to the plain manifesto text
                                                for candidates who only sent a short paragraph. */}
                                            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[32rem]' : 'max-h-0'}`}>
                                                <div className={`px-4 pb-4 border-t pt-3 space-y-3 ${
                                                    isSelected ? 'border-yellow-100' : 'border-zinc-100'
                                                }`}>
                                                    {candidate.vision && (
                                                        <div>
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Vision</p>
                                                            <p className="text-sm text-zinc-600 leading-relaxed">{candidate.vision}</p>
                                                        </div>
                                                    )}

                                                    {candidate.keyPriorities && candidate.keyPriorities.length > 0 && (
                                                        <div>
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5">Key Priorities</p>
                                                            <ul className="space-y-1.5">
                                                                {candidate.keyPriorities.map((priority, i) => (
                                                                    <li key={i} className="flex gap-2 text-sm text-zinc-600 leading-relaxed">
                                                                        <span className={`shrink-0 font-black ${isSelected ? 'text-yellow-600' : 'text-zinc-400'}`}>•</span>
                                                                        <span>{priority}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}

                                                    {!candidate.vision && !candidate.keyPriorities && candidate.manifesto && (
                                                        <p className="text-sm italic leading-relaxed text-zinc-500">
                                                            "{candidate.manifesto}"
                                                        </p>
                                                    )}

                                                    {candidate.motto && (
                                                        <p className={`text-xs font-black uppercase tracking-widest text-center pt-2 ${
                                                            isSelected ? 'text-yellow-600' : 'text-zinc-400'
                                                        }`}>
                                                            "{candidate.motto}"
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Sticky submit bar ──────────────────────────────────────── */}
            <div className="sticky bottom-0 z-20 bg-stone-50 border-t-2 border-zinc-200 pt-4 pb-6 px-0 -mx-4 sm:mx-0 sm:px-0 px-4">
                {!isFormComplete && (
                    <p className="text-center text-xs font-black text-zinc-400 uppercase tracking-widest mb-3">
                        {remaining} required position{remaining !== 1 ? 's' : ''} still need{remaining === 1 ? 's' : ''} a selection
                    </p>
                )}
                <button
                    onClick={() => setShowConfirm(true)}
                    disabled={!isFormComplete || isSubmitting}
                    className={`w-full max-w-sm mx-auto flex items-center justify-center gap-3 py-4 px-8 rounded-xl text-sm font-black shadow-lg transition-all duration-200 border-b-4 active:border-b-0 active:scale-95 uppercase tracking-widest ${
                        isFormComplete
                            ? 'bg-zinc-900 text-white border-zinc-700 hover:bg-zinc-800'
                            : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'
                    }`}
                >
                    <ShieldCheck className={`w-5 h-5 ${isFormComplete ? 'text-yellow-400' : 'text-zinc-400'}`} />
                    Submit Secure Vote
                </button>
            </div>

            {/* ── Confirm modal ──────────────────────────────────────────── */}
            {/* Rendered via portal directly into document.body — the parent
                wrapper above uses translate-y for its fade-in animation,
                and ANY transform on an ancestor (even translateY(0)) creates
                a new containing block that breaks `position: fixed` for
                descendants. Without the portal, this modal would render
                fixed relative to that transformed wrapper instead of the
                actual viewport — which is why it required scrolling to see. */}
            {showConfirm && createPortal(
                <div className="fixed inset-0 bg-zinc-900/60 flex items-end sm:items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div
                        ref={confirmRef}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border-2 border-zinc-200 overflow-hidden"
                    >
                        <div className="h-1.5 bg-yellow-500 w-full" />

                        <div className="p-6">
                            <div className="flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mb-4 mx-auto border-2 border-amber-200">
                                <AlertCircle className="h-6 w-6 text-amber-600" />
                            </div>
                            <h3 className="text-lg font-black text-zinc-900 text-center mb-2 uppercase tracking-tight">
                                Confirm Your Vote
                            </h3>

                            {submitError && (
                                <div className="bg-red-50 border-2 border-red-300 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 font-bold text-center">
                                    ⚠️ {submitError}
                                </div>
                            )}

                            <p className="text-sm text-zinc-500 text-center mb-1 font-medium">
                                You are about to submit your ballot for{' '}
                                <strong className="text-zinc-800">{ELECTION_DATA_ACTIVE.length} positions</strong>.
                            </p>
                            <p className="text-xs text-zinc-400 text-center mb-6 font-semibold uppercase tracking-wider">
                                This cannot be undone.
                            </p>

                            <div className="bg-zinc-50 rounded-lg border border-zinc-200 divide-y divide-zinc-100 mb-6 text-left max-h-48 overflow-y-auto">
                                {ELECTION_DATA_ACTIVE.map(cat => {
                                    const sel = cat.candidates.find(c => c.id === selections[cat.position]);

                                    return (
                                        <div key={cat.position} className="flex items-center gap-3 px-3 py-2">
                                            {sel ? (
                                                <>
                                                    <img
                                                        src={sel.image}
                                                        alt={sel.name}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src =
                                                                `https://ui-avatars.com/api/?name=${encodeURIComponent(sel.name)}&background=18181b&color=eab308&size=64`;
                                                        }}
                                                        className="w-8 h-8 rounded-full object-cover border border-zinc-200 shrink-0"
                                                    />
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-black text-zinc-900 truncate">{sel.name}</p>
                                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{cat.position}</p>
                                                    </div>
                                                    <CheckCircle2 className="w-4 h-4 text-yellow-500 shrink-0 ml-auto" />
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-8 h-8 rounded-full bg-zinc-200 border border-zinc-300 shrink-0 flex items-center justify-center">
                                                        <span className="text-[10px] font-bold text-zinc-400">-</span>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-black text-zinc-500 truncate italic">Abstained (Blank)</p>
                                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{cat.position}</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={handleVoteSubmit}
                                    disabled={isSubmitting}
                                    className="w-full bg-zinc-900 text-white rounded-xl py-3.5 font-black hover:bg-zinc-800 disabled:opacity-50 flex justify-center items-center transition-all uppercase text-sm border-b-4 border-zinc-700 active:border-b-0 active:scale-95 tracking-widest"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5 text-yellow-400" />
                                            <span className="text-yellow-400">Casting Vote...</span>
                                        </>
                                    ) : (
                                        'Yes, Submit My Ballot'
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setShowConfirm(false);
                                        setSubmitError('');
                                    }}
                                    disabled={isSubmitting}
                                    className="w-full bg-white text-zinc-600 border-2 border-zinc-200 rounded-xl py-3.5 font-black hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-50 transition-all uppercase text-sm tracking-widest"
                                >
                                    Go Back &amp; Review
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Photo lightbox — shows the real, uncropped campaign photo ── */}
            {/* Also portaled to document.body — same containing-block issue
                as the confirm modal above applies here too. */}
            {lightboxPhoto && createPortal(
                <div
                    className="fixed inset-0 bg-zinc-900/90 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
                    onClick={() => setLightboxPhoto(null)}
                >
                    <button
                        onClick={() => setLightboxPhoto(null)}
                        aria-label="Close photo"
                        className="absolute top-5 right-5 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors"
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                    <div
                        className="max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={lightboxPhoto.image}
                            alt={lightboxPhoto.name}
                            onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                    `https://ui-avatars.com/api/?name=${encodeURIComponent(lightboxPhoto.name)}&background=18181b&color=eab308&size=512`;
                            }}
                            className="w-full rounded-2xl object-cover shadow-2xl border-4 border-white/10"
                        />
                        <div className="text-center mt-4">
                            <p className="text-white font-black text-lg uppercase tracking-tight">
                                {lightboxPhoto.name}
                            </p>
                            <p className="text-yellow-400 text-xs font-bold uppercase tracking-widest mt-0.5">
                                {lightboxPhoto.position}
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default VotingBooth;
