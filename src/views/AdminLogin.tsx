import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldAlert, Eye, EyeOff } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL || 'https://laa-voting-system.onrender.com';

const AdminLogin: React.FC = () => {
    const [username, setUsername]   = useState('');
    const [password, setPassword]   = useState('');
    const [show, setShow]           = useState(false);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState('');
    const [visible, setVisible]     = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 30);
        return () => clearTimeout(t);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) { setError('Username and password are required.'); return; }

        try {
            setError('');
            setLoading(true);
            const res  = await fetch(`${BACKEND_URL}/api/admin/login`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ username: username.trim(), password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Incorrect credentials.');

            sessionStorage.setItem('laa_admin_token',     data.token);
            sessionStorage.setItem('laa_admin_username',  data.username);
            sessionStorage.setItem('laa_admin_full_name', data.full_name);
            sessionStorage.setItem('laa_admin_user_role', data.user_role);
            navigate('/admin');
        } catch (err: any) {
            setError(err.message || 'Incorrect credentials.');
            setPassword('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`w-full max-w-sm mx-auto self-center transition-all duration-500 ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
        >
            <div className="bg-white rounded-2xl shadow-md border-2 border-zinc-200 overflow-hidden">

                {/* Dark top bar — distinguishes admin from voter pages */}
                <div className="h-1.5 bg-zinc-900 w-full" />

                <div className="p-8">

                    {/* Icon + heading */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-zinc-900 border-2 border-yellow-500 mb-4">
                            <ShieldAlert className="w-7 h-7 text-yellow-400" />
                        </div>
                        <h1 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">
                            Admin Access
                        </h1>
                        <p className="text-zinc-500 mt-2 text-sm font-medium">
                            Election Control Center — authorised personnel only.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Username */}
                        <div>
                            <label htmlFor="adminUsername" className="block text-xs font-black uppercase tracking-widest text-zinc-800 mb-2">
                                Username
                            </label>
                            <input
                                type="text"
                                id="adminUsername"
                                autoFocus
                                autoComplete="username"
                                className={`block w-full rounded-lg border-2 py-3 px-4 text-zinc-900 shadow-sm outline-none transition-all duration-200 text-sm ${
                                    error ? 'border-red-400 bg-red-50' : 'border-zinc-200 bg-zinc-50 focus:border-yellow-500 focus:bg-white'
                                } placeholder:text-zinc-400`}
                                placeholder="your.username"
                                value={username}
                                onChange={(e) => { setUsername(e.target.value); if (error) setError(''); }}
                                disabled={loading}
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label
                                htmlFor="adminPassword"
                                className="block text-xs font-black uppercase tracking-widest text-zinc-800 mb-2"
                            >
                                Password
                            </label>

                            {/* Password field with show/hide toggle */}
                            <div className="relative">
                                <input
                                    type={show ? 'text' : 'password'}
                                    id="adminPassword"
                                    autoFocus
                                    className={`block w-full rounded-lg border-2 py-3 pl-4 pr-11 text-zinc-900 shadow-sm outline-none transition-all duration-200 text-sm ${
                                        error
                                            ? 'border-red-400 bg-red-50 focus:border-red-500'
                                            : 'border-zinc-200 bg-zinc-50 focus:border-yellow-500 focus:bg-white'
                                    } placeholder:text-zinc-400`}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShow(s => !s)}
                                    tabIndex={-1}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                                >
                                    {show
                                        ? <EyeOff className="w-4 h-4" />
                                        : <Eye    className="w-4 h-4" />
                                    }
                                </button>
                            </div>

                            {/* Sliding error */}
                            <div className={`overflow-hidden transition-all duration-300 ${error ? 'max-h-10 mt-2' : 'max-h-0'}`}>
                                <p className="text-sm text-red-600 font-semibold">{error}</p>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !username || !password}
                            className="w-full flex justify-center items-center rounded-xl bg-zinc-900 px-3 py-4 text-sm font-black text-white shadow-lg hover:bg-zinc-800 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 border-b-4 border-zinc-700 active:border-b-0 uppercase tracking-widest"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5 text-yellow-400" />
                                    <span className="text-yellow-400">Verifying...</span>
                                </>
                            ) : (
                                'Enter Control Center'
                            )}
                        </button>
                    </form>
                </div>
            </div>

            <p className="mt-5 text-center text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                Authorised EC personnel only. Session expires when this tab is closed.
            </p>
        </div>
    );
};

export default AdminLogin;
