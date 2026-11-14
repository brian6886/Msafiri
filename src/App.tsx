import { onAuthStateChanged, type User } from 'firebase/auth';
import React, { useEffect, useMemo, useState } from 'react';
import { AccountModal } from './components/AccountModal';
import { AuthModal } from './components/AuthModal';
import { BookingView } from './components/BookingView';
import { MyTicketsView } from './components/MyTicketsView';
import { Navbar, type AppPage } from './components/Navbar';
import { OperationsView } from './components/OperationsView';
import { ParcelView } from './components/ParcelView';
import { RoutesView } from './components/RoutesView';
import { SeatMapModal } from './components/SeatMapModal';
import { KENYA_SACCOS, KENYA_VEHICLES, buildSeedTrips } from './data/kenyaTransitData';
import { auth, signOutUser, testFirestoreConnection } from './firebase';
import {
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
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const isAdmin = isBootstrappedAdmin(user);

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

  // 1. Validate Firestore connectivity and load public catalog + any locally booked guest refs
  useEffect(() => {
    testFirestoreConnection();

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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar
        activePage={activePage}
        onNavigate={setActivePage}
        user={user}
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
          />
        )}

        {activePage === 'routes' && (
          <RoutesView onJumpToBook={() => setActivePage('book')} />
        )}

        {activePage === 'tickets' && (
          <MyTicketsView
            user={user}
            bookings={bookings}
            onSignIn={() => setShowAuthModal(true)}
            onJumpToBook={() => setActivePage('book')}
            onCancelGuestBooking={handleCancelGuestBooking}
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

        {activePage === 'operations' && (
          <OperationsView
            user={user}
            isAdmin={isAdmin}
            trips={trips}
            saccos={saccos}
            vehicles={vehicles}
            bookings={bookings}
            parcels={parcels}
            onSignIn={() => setShowAuthModal(true)}
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
              onClick={() => setActivePage('parcel')}
              className="hover:text-slate-900"
            >
              Parcel Courier
            </button>
            <button
              type="button"
              onClick={() => setActivePage('operations')}
              className="hover:text-slate-900"
            >
              SACCO Operations
            </button>
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
        />
      )}

      {showAccountModal && user && (
        <AccountModal
          user={user}
          profile={profile}
          isAdmin={isAdmin}
          onClose={() => setShowAccountModal(false)}
          onSignOut={signOutUser}
          onProfileSaved={(updated) => setProfile(updated)}
        />
      )}
    </div>
  );
}
