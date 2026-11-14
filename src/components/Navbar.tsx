import type { User } from 'firebase/auth';
import React from 'react';

export type AppPage = 'book' | 'routes' | 'track' | 'tickets' | 'parcel' | 'operations';

interface NavbarProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  user: User | null;
  isAdmin: boolean;
  adminEmail: string | null;
  onOpenAccount: () => void;
  onSignIn: () => void;
}

const PUBLIC_NAV_ITEMS: Array<{ id: AppPage; label: string }> = [
  { id: 'book', label: 'Book Trip' },
  { id: 'routes', label: 'Routes' },
  { id: 'track', label: 'Live Track' },
  { id: 'tickets', label: 'My Tickets' },
  { id: 'parcel', label: 'Parcel' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  onNavigate,
  user,
  isAdmin,
  adminEmail,
  onOpenAccount,
  onSignIn,
}) => {
  const navItems = isAdmin
    ? [...PUBLIC_NAV_ITEMS, { id: 'operations' as AppPage, label: 'Admin' }]
    : PUBLIC_NAV_ITEMS;

  const isSignedIn = Boolean(user || adminEmail);
  const accountLabel = user?.displayName?.split(' ')[0] || (isAdmin ? 'Admin' : 'Account');

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onNavigate('book')}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded"
        >
          Msafiri
        </button>

        <nav className="hidden md:flex items-center gap-7" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded ${
                  isActive
                    ? 'text-slate-900 after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-0.5 after:bg-emerald-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          {isSignedIn ? (
            <button
              type="button"
              onClick={onOpenAccount}
              className="px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 max-w-[180px] truncate"
            >
              {accountLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation strip keeping aggregate sticky height compact */}
      <nav
        className="md:hidden border-t border-slate-100 px-3 py-1.5 flex items-center justify-between gap-1 overflow-x-auto"
        aria-label="Mobile navigation"
      >
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
