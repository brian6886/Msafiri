import { onAuthStateChanged, type User } from 'firebase/auth';
import React, { useEffect, useMemo, useState } from 'react';
import { AccountModal } from './components/AccountModal';
import { AuthModal } from './components/AuthModal';
import { BookingView } from './components/BookingView';
import { LiveTrackingView } from './components/LiveTrackingView';
import { MyTicketsView } from './components/MyTicketsView';
import { Navbar, type AppPage } from './components/Navbar';
import { OperationsView } from './components/OperationsView';
import { ParcelView } from './components/ParcelView';
import { RoutesView } from './components/RoutesView';
import { SeatMapModal } from './components/SeatMapModal';
import { KENYA_SACCOS, KENYA_VEHICLES, buildSeedTrips } from './data/kenyaTransitData';
import { auth, signOutUser, testFirestoreConnection } from './firebase';
import {
  ADMIN_EMAIL,
  ensureUserProfile,
  isBootstrappedAdmin,
  seedKenyanFleetIfAdmin,
  subscribeSaccos,
  subscribeTrips,
  subscribeUserBookings,
  subscribeUserParcels,
  subscribeVehicles,
} from './services/firestoreService';
import type { Booking, Parcel, Sacco, Trip, UserProfile, Vehicle } from './types';

const LOCAL_BOOKING_REFS_KEY = 'msafiri_booking_refs_v1';
const LOCAL_PARCEL_REFS_KEY = 'msafiri_parcel_refs_v1';

function readStoredRefs(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredRef(key: string, ref: string): string[] {
  const existing = readStoredRefs(key);
  const next = Array.from(new Set([ref, ...existing])).slice(0, 50);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('book');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [trips, setTrips] = useState<Trip[]>(() => buildSeedTrips());
  const [saccos, setSaccos] = useState<Sacco[]>(KENYA_SACCOS);
  const [vehicles, setVehicles] = useState<Vehicle[]>(KENYA_VEHICLES);
  const [fsBookings, setFsBookings] = useState<Booking[]>([]);
  const [guestBookings, setGuestBookings] = useState<Booking[]>([]);
  const [fsParcels, setFsParcels] = useState<Parcel[]>([]);
  const [guestParcels, setGuestParcels] = useState<Parcel[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(true);

  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [trackedTripId, setTrackedTripId] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [adminSessionEmail, setAdminSessionEmail] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const hasAdminSession = adminSessionEmail === ADMIN_EMAIL;
  const isAdmin = isBootstrappedAdmin(user) || hasAdminSession;

  useEffect(() => {
    const handleQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  const bookings = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const b of guestBookings) map.set(b.id, b);
    for (const b of fsBookings) map.set(b.id, b);
    return Array.from(map.values()).sort((a, b) =>
      `${b.departureDate} ${b.departureTime}`.localeCompare(
        `${a.departureDate} ${a.departureTime}`
      )
    );
  }, [fsBookings, guestBookings]);

  const parcels = useMemo(() => {
    const map = new Map<string, Parcel>();
    for (const p of guestParcels) map.set(p.id, p);
    for (const p of fsParcels) map.set(p.id, p);
    return Array.from(map.values());
  }, [fsParcels, guestParcels]);

  const refreshAdminOverview = async () => {
    try {
      if (hasAdminSession) {
        const res = await fetch('/api/admin/overview', { credentials: 'include' });
        if (res.ok) {
          const data = (await res.json()) as {
            trips?: Trip[];
            vehicles?: Vehicle[];
            bookings?: Booking[];
            parcels?: Parcel[];
          };
          if (Array.isArray(data.trips)) setTrips(data.trips);
          if (Array.isArray(data.vehicles)) setVehicles(data.vehicles);
          if (data.bookings) setGuestBookings(data.bookings);
          if (data.parcels) setGuestParcels(data.parcels);
        }
        return;
      }
      if (isBootstrappedAdmin(user)) {
        const [bRes, pRes, cRes] = await Promise.all([
          fetch('/api/bookings'),
          fetch('/api/parcels'),
          fetch('/api/catalog'),
        ]);
        if (bRes.ok) {
          const bData = (await bRes.json()) as { bookings?: Booking[] };
          if (bData.bookings) setGuestBookings(bData.bookings);
        }
        if (pRes.ok) {
          const pData = (await pRes.json()) as { parcels?: Parcel[] };
          if (pData.parcels) setGuestParcels(pData.parcels);
        }
        if (cRes.ok) {
          const cData = (await cRes.json()) as { trips?: Trip[]; vehicles?: Vehicle[] };
          if (Array.isArray(cData.trips)) setTrips(cData.trips);
          if (Array.isArray(cData.vehicles)) setVehicles(cData.vehicles);
        }
      }
    } catch {
      // Ignore transient network errors
    }
  };

  // 1. Validate Firestore connectivity and load public catalog + any locally booked guest refs + admin session
  useEffect(() => {
    testFirestoreConnection();

    fetch('/api/admin/session', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { authenticated?: boolean; email?: string | null } | null) => {
        if (data?.authenticated && data.email === ADMIN_EMAIL) {
          setAdminSessionEmail(data.email);
        } else {
          setAdminSessionEmail(null);
        }
      })
      .catch(() => {});

    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.trips?.length) setTrips(data.trips);
        if (data?.saccos?.length) setSaccos(data.saccos);
        if (data?.vehicles?.length) setVehicles(data.vehicles);
      })
      .catch(() => {})
      .finally(() => setLoadingTrips(false));

    const storedBookingRefs = readStoredRefs(LOCAL_BOOKING_REFS_KEY);
    if (storedBookingRefs.length > 0) {
      fetch(`/api/bookings?refs=${encodeURIComponent(storedBookingRefs.join(','))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.bookings) setGuestBookings(data.bookings);
        })
        .catch(() => {});
    }

    const storedParcelRefs = readStoredRefs(LOCAL_PARCEL_REFS_KEY);
    if (storedParcelRefs.length > 0) {
      fetch(`/api/parcels?refs=${encodeURIComponent(storedParcelRefs.join(','))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.parcels) setGuestParcels(data.parcels);
        })
        .catch(() => {});
    }

    const unsubTrips = subscribeTrips(
      (fsTrips) => {
        if (fsTrips.length > 0) {
          setTrips(fsTrips);
        }
        setLoadingTrips(false);
      },
      () => setLoadingTrips(false)
    );

    const unsubSaccos = subscribeSaccos((fsSaccos) => {
      if (fsSaccos.length > 0) setSaccos(fsSaccos);
    });

    const unsubVehicles = subscribeVehicles((fsVehicles) => {
      if (fsVehicles.length > 0) setVehicles(fsVehicles);
    });

    return () => {
      unsubTrips();
      unsubSaccos();
      unsubVehicles();
    };
  }, []);

  // 2. Track Firebase Authentication state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        if (nextUser.emailVerified) {
          try {
            const userProf = await ensureUserProfile(nextUser);
            setProfile(userProf);
            if (isBootstrappedAdmin(nextUser)) {
              await seedKenyanFleetIfAdmin(nextUser);
            }
          } catch {
            // Handled via structured Firestore error logger
          }
        } else {
          setProfile({
            uid: nextUser.uid,
            displayName: nextUser.displayName || nextUser.email?.split('@')[0] || 'Passenger',
            email: nextUser.email || '',
            role: 'passenger',
          });
        }
      } else {
        setProfile(null);
        setFsBookings([]);
        setFsParcels([]);
      }
    });
    return () => unsub();
  }, []);

  // 3. Subscribe to user-scoped Firestore Bookings & Parcels for verified users
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;
    const unsubBookings = subscribeUserBookings(user, isAdmin, setFsBookings);
    const unsubParcels = subscribeUserParcels(user, isAdmin, setFsParcels);
    return () => {
      unsubBookings();
      unsubParcels();
    };
  }, [authReady, user, isAdmin]);

  // 4. Load full admin server overview when authenticated as khaneribrian@gmail.com and guard Operations route
  useEffect(() => {
    if (!isAdmin && activePage === 'operations') {
      setActivePage('book');
    }
    if (isAdmin) {
      void refreshAdminOverview();
    }
  }, [isAdmin, hasAdminSession, activePage]);

  const handleSignOutAll = async () => {
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    setAdminSessionEmail(null);
    await signOutUser().catch(() => {});
    if (activePage === 'operations') {
      setActivePage('book');
    }
  };

  const handleBookingCompleted = (newBooking: Booking) => {
    if (newBooking?.ticketRef) {
      saveStoredRef(LOCAL_BOOKING_REFS_KEY, newBooking.ticketRef);
      setGuestBookings((prev) => [newBooking, ...prev.filter((b) => b.id !== newBooking.id)]);
      setTrips((prev) =>
        prev.map((t) => {
          if (t.id !== newBooking.tripId) return t;
          const mergedSeats = Array.from(new Set([...t.bookedSeats, ...newBooking.seats]));
          return {
            ...t,
            bookedSeats: mergedSeats,
            availableSeats: Math.max(0, t.capacity - mergedSeats.length),
          };
        })
      );
    }
  };

  const handleParcelCreated = (newParcel: Parcel) => {
    if (newParcel?.waybillNo) {
      saveStoredRef(LOCAL_PARCEL_REFS_KEY, newParcel.waybillNo);
      setGuestParcels((prev) => [newParcel, ...prev.filter((p) => p.id !== newParcel.id)]);
    }
  };

  const handleCancelGuestBooking = async (bookingId: string) => {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'PATCH',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.booking) {
        setGuestBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? data.booking : b))
        );
      }
    }
  };

  const handleTrackTrip = (tripId: string) => {
    setTrackedTripId(tripId);
    setActivePage('track');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {quotaExceeded && (
        <div className="bg-amber-600 text-white px-4 py-2 text-center text-sm font-medium sticky top-0 z-50">
          Demo API quota exceeded.{' '}
          <a
            href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
            className="underline font-bold"
            target="_blank"
            rel="noopener noreferrer"
          >
            Upgrade to your own key
          </a>{' '}
          to continue using Maps features.
        </div>
      )}

      <Navbar
        activePage={activePage}
        onNavigate={(page) => {
          if (page === 'operations' && !isAdmin) return;
          setActivePage(page);
        }}
        user={user}
        isAdmin={isAdmin}
        adminEmail={adminSessionEmail}
        onOpenAccount={() => setShowAccountModal(true)}
        onSignIn={() => setShowAuthModal(true)}
      />

      <main className="flex-1">
        {activePage === 'book' && (
          <BookingView
            trips={trips}
            isLoading={loadingTrips}
            onSelectTrip={(trip) => setSelectedTrip(trip)}
            onExploreRoutes={() => setActivePage('routes')}
            onTrackTrip={handleTrackTrip}
          />
        )}

        {activePage === 'routes' && (
          <RoutesView onJumpToBook={() => setActivePage('book')} />
        )}

        {activePage === 'track' && (
          <LiveTrackingView
            trips={trips}
            initialTripId={trackedTripId}
            isAdmin={isAdmin}
            hasAdminSession={hasAdminSession}
            onSelectTripForBooking={(trip) => setSelectedTrip(trip)}
          />
        )}

        {activePage === 'tickets' && (
          <MyTicketsView
            user={user}
            bookings={bookings}
            onSignIn={() => setShowAuthModal(true)}
            onJumpToBook={() => setActivePage('book')}
            onCancelGuestBooking={handleCancelGuestBooking}
            onTrackTrip={handleTrackTrip}
          />
        )}

        {activePage === 'parcel' && (
          <ParcelView
            user={user}
            parcels={parcels}
            onSignIn={() => setShowAuthModal(true)}
            onParcelCreated={handleParcelCreated}
          />
        )}

        {activePage === 'operations' && isAdmin && (
          <OperationsView
            user={user}
            isAdmin={isAdmin}
            hasAdminSession={hasAdminSession}
            trips={trips}
            saccos={saccos}
            vehicles={vehicles}
            bookings={bookings}
            parcels={parcels}
            onAdminDataChanged={() => {
              void refreshAdminOverview();
            }}
          />
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-8 mt-auto no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="space-y-1">
            <p className="font-display text-sm font-bold text-slate-900">Msafiri Kenya</p>
            <p>
              NTSA-compliant intercity matatu seat reservations, M-Pesa Paybill checkout, and
              SACCO parcel logistics.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <button
              type="button"
              onClick={() => setActivePage('book')}
              className="hover:text-slate-900"
            >
              Departures
            </button>
            <button
              type="button"
              onClick={() => setActivePage('routes')}
              className="hover:text-slate-900"
            >
              Corridors
            </button>
            <button
              type="button"
              onClick={() => setActivePage('track')}
              className="hover:text-slate-900"
            >
              Live Tracking
            </button>
            <button
              type="button"
              onClick={() => setActivePage('parcel')}
              className="hover:text-slate-900"
            >
              Parcel Courier
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActivePage('operations')}
                className="hover:text-slate-900"
              >
                Admin Operations
              </button>
            )}
          </div>
        </div>
      </footer>

      {selectedTrip && (
        <SeatMapModal
          trip={selectedTrip}
          user={user}
          profile={profile}
          onClose={() => {
            setSelectedTrip(null);
          }}
          onSignIn={async () => {
            setShowAuthModal(true);
          }}
          onBookingCompleted={(newBooking) => {
            handleBookingCompleted(newBooking);
          }}
          onViewTickets={() => {
            setSelectedTrip(null);
            setActivePage('tickets');
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onAuthenticated={() => setShowAuthModal(false)}
          onAdminAuthenticated={(email) => setAdminSessionEmail(email)}
        />
      )}

      {showAccountModal && (user || adminSessionEmail) && (
        <AccountModal
          user={user}
          adminEmail={adminSessionEmail}
          profile={profile}
          isAdmin={isAdmin}
          onClose={() => setShowAccountModal(false)}
          onSignOut={handleSignOutAll}
          onProfileSaved={(updated) => setProfile(updated)}
        />
      )}
    </div>
  );
}
