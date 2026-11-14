import { Loader2, Lock, Mail, User as UserIcon, X } from 'lucide-react';
import React, { useState } from 'react';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  formatFirebaseAuthError,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../firebase';
import { ADMIN_EMAIL } from '../services/firestoreService';

interface AuthModalProps {
  initialMode?: 'signin' | 'signup';
  onClose: () => void;
  onAuthenticated: () => void;
  onAdminAuthenticated?: (email: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  initialMode = 'signin',
  onClose,
  onAuthenticated,
  onAdminAuthenticated,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConsoleGuide, setShowConsoleGuide] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    setErrorMsg(null);
    setShowConsoleGuide(false);
    try {
      await signInWithGoogle();
      onAuthenticated();
      onClose();
    } catch (err) {
      const formatted = formatFirebaseAuthError(err);
      setErrorMsg(formatted.message);
      setShowConsoleGuide(formatted.needsEmailProviderEnable);
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setShowConsoleGuide(false);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      if (mode === 'signup') {
        if (normalizedEmail === ADMIN_EMAIL) {
          setErrorMsg(
            'This email is reserved for the SACCO Administrator. Switch to Sign In and use your master password or Continue with Google.'
          );
          setBusy(false);
          return;
        }
        if (fullName.trim().length < 2) {
          setErrorMsg('Enter your full name to create an account.');
          setBusy(false);
          return;
        }
        await signUpWithEmail(fullName, email, password);
        onAuthenticated();
        onClose();
        return;
      }

      if (normalizedEmail === ADMIN_EMAIL) {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: normalizedEmail, password }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          email?: string;
          error?: string;
        };
        if (!res.ok || !data.authenticated) {
          setErrorMsg(data.error || 'Invalid master password for admin account.');
          setBusy(false);
          return;
        }
        onAdminAuthenticated?.(data.email || ADMIN_EMAIL);
        // Attempt Firebase email sync quietly if enabled, without failing admin sign-in
        signInWithEmail(normalizedEmail, password).catch(() => {});
        onAuthenticated();
        onClose();
        return;
      }

      await signInWithEmail(email, password);
      onAuthenticated();
      onClose();
    } catch (err) {
      const formatted = formatFirebaseAuthError(err);
      setErrorMsg(formatted.message);
      setShowConsoleGuide(formatted.needsEmailProviderEnable);
    } finally {
      setBusy(false);
    }
  };

  const consoleProvidersUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 id="auth-modal-title" className="font-display text-lg font-bold text-slate-900">
              {mode === 'signin' ? 'Sign In to Msafiri' : 'Create Msafiri Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sync QR boarding passes and parcel waybills across devices.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            aria-label="Close sign in dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Segmented Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMsg(null);
              }}
              className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                mode === 'signin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMsg(null);
              }}
              className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                mode === 'signup'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* 1-Click Google Auth */}
          <button
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            className="w-full py-2.5 px-4 text-sm font-semibold text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors flex items-center justify-center gap-2.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-slate-200" />
            <span className="px-3 bg-white text-xs text-slate-400 whitespace-nowrap">
              or use email &amp; password
            </span>
            <div className="w-full border-t border-slate-200" />
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Wanjiku Kamau"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg space-y-2">
                <p>{errorMsg}</p>
                {showConsoleGuide && (
                  <div className="pt-1 border-t border-red-200 text-red-900 space-y-1">
                    <p className="font-semibold">How to enable Email/Password in Firebase:</p>
                    <p>
                      1. Open Firebase Authentication Providers ({consoleProvidersUrl}).
                    </p>
                    <p>2. Click Add new provider, select Email/Password, enable it, and Save.</p>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-400 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-xs text-center text-slate-500">
            You can also book and pay via M-Pesa STK Push directly without signing in first.
          </p>
        </div>
      </div>
    </div>
  );
};
