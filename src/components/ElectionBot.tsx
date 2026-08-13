import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, MessageSquare, Send, User, X } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL || 'https://usaavotingdemo.onrender.com';

const MAX_MESSAGE_LENGTH = 500;

const QUICK_ACTIONS = [
    { label: 'OTP help',              message: "I haven't received my OTP code." },
    { label: 'Unopposed candidates',  message: 'How do unopposed candidates and blank votes work?' },
    { label: 'Results',               message: 'When will election results be published?' },
    { label: 'Receipt verification',  message: 'How do I verify my ballot receipt?' },
    { label: 'Is my vote anonymous?', message: 'Is my vote really anonymous? Can anyone see who I voted for?' },
    { label: 'Already voted?',        message: "It says I've already voted but I haven't." },
];

interface Message {
    id:   string;
    role: 'bot' | 'user';
    text: string;
}

const ElectionBot: React.FC = () => {
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);

    // ── Mount/animate split ──────────────────────────────────────────────
    // Some mobile browser engines can still hit-test an element that's only
    // hidden via `scale-0 opacity-0 pointer-events-none` — the invisible box
    // can block taps on whatever's underneath it, even though it looks and
    // works fine on desktop. Fix: only put the panel in the DOM while it's
    // actually open (or animating open/closed). When fully closed, it's
    // unmounted completely — nothing left on the page to mis-hit-test.
    const [panelMounted, setPanelMounted] = useState(false);
    const [animateIn,    setAnimateIn]    = useState(false);

    const [input,     setInput]     = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [messages,  setMessages]  = useState<Message[]>([
        {
            id:   'welcome-msg',
            role: 'bot',
            text: "Hello! 🤖 I'm the U.S.A.A Election Assistant. I can help with OTPs, unopposed candidates, receipt verification, and results timing. Choose a quick action or ask me anything.",
        },
    ]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isAdminPage = location.pathname === '/admin' || location.pathname === '/admin/login';

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    // Mount before animating in; animate out before unmounting.
    useEffect(() => {
        let t: ReturnType<typeof setTimeout>;
        if (isOpen) {
            setPanelMounted(true);
            t = setTimeout(() => setAnimateIn(true), 20);
        } else {
            setAnimateIn(false);
            t = setTimeout(() => setPanelMounted(false), 300); // matches transition duration
        }
        return () => clearTimeout(t);
    }, [isOpen]);

    const submitMessage = async (rawMessage: string) => {
        const trimmedMessage = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!trimmedMessage || isLoading) return;

        const userMsg: Message = {
            id:   `${Date.now()}-user`,
            role: 'user',
            text: trimmedMessage,
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const res  = await fetch(`${BACKEND_URL}/api/chat`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ message: userMsg.text }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.reply) {
                throw new Error(data.detail || 'Chat request failed');
            }

            setMessages(prev => [...prev, { id: `${Date.now()}-bot`, role: 'bot', text: data.reply }]);
        } catch {
            setMessages(prev => [...prev, {
                id:   `${Date.now()}-error`,
                role: 'bot',
                text: "Sorry, I'm having trouble connecting to the EC servers right now.",
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        await submitMessage(input);
    };

    if (isAdminPage) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">

            {/* ── Chat Window — only in the DOM while open/animating ───── */}
            {panelMounted && (
                <div className={`mb-4 w-[340px] sm:w-[380px] bg-white rounded-2xl shadow-2xl border-2 border-zinc-200 overflow-hidden transition-all duration-300 origin-bottom-right ${
                    animateIn ? 'scale-100 opacity-100' : 'scale-0 opacity-0 pointer-events-none'
                }`}>

                    {/* Header */}
                    <div className="bg-zinc-900 px-4 py-3 flex items-center justify-between border-b-4 border-yellow-500">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                                <Bot className="w-5 h-5 text-zinc-900" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-white uppercase tracking-wider">EC Assistant</h3>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Online</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="text-zinc-400 hover:text-white transition-colors p-1"
                            aria-label="Close election assistant"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="h-[350px] overflow-y-auto p-4 bg-zinc-50 flex flex-col gap-4">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                                    msg.role === 'user' ? 'bg-zinc-200' : 'bg-yellow-100 border border-yellow-300'
                                }`}>
                                    {msg.role === 'user' ? <User className="w-4 h-4 text-zinc-500" /> : <Bot className="w-4 h-4 text-yellow-700" />}
                                </div>
                                <div className={`px-4 py-2.5 rounded-2xl text-sm font-medium leading-relaxed max-w-[80%] ${
                                    msg.role === 'user'
                                        ? 'bg-zinc-900 text-white rounded-tr-sm'
                                        : 'bg-white border border-zinc-200 text-zinc-700 rounded-tl-sm shadow-sm'
                                }`}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex gap-3">
                                <div className="w-7 h-7 rounded-full bg-yellow-100 border border-yellow-300 flex items-center justify-center shrink-0 mt-1">
                                    <Bot className="w-4 h-4 text-yellow-700" />
                                </div>
                                <div className="px-4 py-3 rounded-2xl bg-white border border-zinc-200 rounded-tl-sm shadow-sm flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Quick actions */}
                    <div className="px-3 py-2 bg-white border-t border-zinc-200 flex gap-2 overflow-x-auto">
                        {QUICK_ACTIONS.map((action) => (
                            <button
                                key={action.label}
                                type="button"
                                onClick={() => submitMessage(action.message)}
                                disabled={isLoading}
                                className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-zinc-700 hover:border-yellow-400 hover:bg-yellow-50 disabled:opacity-50 transition-colors"
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>

                    {/* Input */}
                    <form onSubmit={sendMessage} className="p-3 bg-white border-t border-zinc-200 flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                            placeholder="Ask a question..."
                            maxLength={MAX_MESSAGE_LENGTH}
                            className="flex-1 bg-zinc-100 border border-transparent focus:border-yellow-400 focus:bg-white text-sm font-medium rounded-xl px-4 py-2.5 outline-none transition-all"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="w-11 h-11 flex items-center justify-center bg-zinc-900 text-yellow-400 rounded-xl hover:bg-zinc-800 disabled:opacity-50 transition-all shrink-0 active:scale-95"
                            aria-label="Send message"
                        >
                            <Send className="w-5 h-5 ml-0.5" />
                        </button>
                    </form>
                </div>
            )}

            {/* ── Toggle button ────────────────────────────────────────── */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 active:scale-95 z-50 ${
                    isOpen ? 'bg-zinc-800 text-white hover:bg-zinc-900' : 'bg-yellow-400 text-zinc-900 hover:bg-yellow-500 border-2 border-white'
                }`}
                aria-label={isOpen ? 'Close election assistant' : 'Open election assistant'}
            >
                {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
            </button>
        </div>
    );
};

export default ElectionBot;
