import type { User } from 'firebase/auth';
import { LogOut, MailCheck, Save, ShieldCheck, X } from 'lucide-react';
import React, { useState } from 'react';
import { resendVerificationEmail } from '../firebase';
import { updateUserProfileContact } from '../services/firestoreService';
import type { UserProfile } from '../types';

interface AccountModalProps {
  user: User | null;
  adminEmail: string | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  onClose: () => void;
  onSignOut: () => Promise<void>;
  onProfileSaved: (updated: UserProfile) => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  user,
  adminEmail,
  profile,
  isAdmin,
  onClose,
  onSignOut,
  onProfileSaved,
}) => {
  const [displayName, setDisplayName] = useState(
    profile?.displayName || user?.displayName || 'SACCO Administrator'
  );
  const [phone, setPhone] = useState(profile?.phone || '');
  const [preferredStage, setPreferredStage] = useState(
    profile?.preferredStage || 'Moi Avenue Terminal'
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSavedNotice(false);
    try {
      if (user.emailVerified) {
        await updateUserProfileContact(user.uid, {
          displayName,
          phone,
          preferredStage,
        });
      }
      onProfileSaved({
        uid: user.uid,
        email: user.email || '',
        displayName,
        phone,
        preferredStage,
        role: profile?.role || 'passenger',
      });
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  const handleResendVerification = async () => {
    await resendVerificationEmail().catch(() => {});
    setVerificationSent(true);
  };

  if (!user && adminEmail) {
    return (
      <div
        className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
      >
        <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 id="account-modal-title" className="font-display text-lg font-bold text-slate-900">
                Administrator Session
              </h2>
              <p className="text-xs text-slate-500">{adminEmail} · SACCO Administrator</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              aria-label="Close account profile"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-950 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Exclusive Admin Access Active</p>
                <p>
                  You are authenticated as <span className="font-mono">{adminEmail}</span>. Only
                  this account can view and manage the Admin section.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  await onSignOut();
                  onClose();
                }}
                className="px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-lg inline-flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 id="account-modal-title" className="font-display text-lg font-bold text-slate-900">
              Passenger Profile
            </h2>
            <p className="text-xs text-slate-500">
              {user.email} · {isAdmin ? 'SACCO Administrator' : 'Passenger Account'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            aria-label="Close account profile"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          {!user.emailVerified && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-2">
              <p>
                Verify your email address ({user.email}) to sync tickets directly to your
                cloud Firestore profile.
              </p>
              <button
                type="button"
                onClick={handleResendVerification}
                className="font-semibold text-amber-950 underline inline-flex items-center gap-1"
              >
                <MailCheck className="w-3.5 h-3.5" />
                {verificationSent ? 'Verification link sent' : 'Resend verification email'}
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Full Name (PSV Manifest)
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Default M-Pesa Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678 or 0112 898 591"
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Preferred Nairobi Boarding Stage
            </label>
            <select
              value={preferredStage}
              onChange={(e) => setPreferredStage(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
            >
              <option value="Moi Avenue Terminal">Moi Avenue Terminal</option>
              <option value="Tea Room CBD">Tea Room CBD</option>
              <option value="Railways Terminal CBD">Railways Terminal CBD</option>
              <option value="Afya Centre">Afya Centre</option>
              <option value="Westlands Stage">Westlands Stage</option>
              <option value="Mlolongo Stage">Mlolongo Stage</option>
            </select>
          </div>

          {savedNotice && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
              Profile preferences saved.
            </p>
          )}

          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={async () => {
                await onSignOut();
                onClose();
              }}
              className="px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-lg inline-flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
