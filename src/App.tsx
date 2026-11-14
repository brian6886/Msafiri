import { onAuthStateChanged, type User } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import { AccountModal } from './components/AccountModal';
import { BookingView } from './components/BookingView';
import { MyTicketsView } from './components/MyTicketsView';
import { Navbar, type AppPage } from './components/Navbar';
import { OperationsView } from './components/OperationsView';
import { ParcelView } from './components/ParcelView';
import { RoutesView } from './components/RoutesView';
import { SeatMapModal } from './components/SeatMapModal';
import { KENYA_SACCOS, KENYA_VEHICLES, buildSeedTrips } from './data/kenyaTransitData';
import { auth, signInWithGoogle, signOutUser, testFirestoreConnection } from './firebase';
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

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('book');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [trips, setTrips] = useState<Trip[]>(() => buildSeedTrips());
  const [saccos, setSaccos] = useState<Sacco[]>(KENYA_SACCOS);
  const [vehicles, setVehicles] = useState<Vehicle[]>(KENYA_VEHICLES);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(true);

  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isAdmin = isBootstrappedAdmin(user);

  // 1. Validate Firestore connectivity and subscribe to public transit catalog
  useEffect(() => {
    testFirestoreConnection();

    // Load initial catalog from Express backend so visitors see live trips immediately
    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.trips?.length) setTrips(data.trips);
        if (data?.saccos?.length) setSaccos(data.saccos);
        if (data?.vehicles?.length) setVehicles(data.vehicles);
      })
      .catch(() => {})
      .finally(() => setLoadingTrips(false));

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
        setProfile(null);
        setBookings([]);
        setParcels([]);
      }
    });
    return () => unsub();
  }, []);

  // 3. Subscribe to user-scoped Bookings & Parcels once auth is ready
  useEffect(() => {
    if (!authReady || !user) return;
    const unsubBookings = subscribeUserBookings(user, isAdmin, setBookings);
    const unsubParcels = subscribeUserParcels(user, isAdmin, setParcels);
    return () => {
      unsubBookings();
      unsubParcels();
    };
  }, [authReady, user, isAdmin]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or blocked.'
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar
        activePage={activePage}
        onNavigate={setActivePage}
        user={user}
        onOpenAccount={() => setShowAccountModal(true)}
        onSignIn={handleSignIn}
      />

      {authError && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
          <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="font-semibold underline ml-4"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
            onSignIn={handleSignIn}
            onJumpToBook={() => setActivePage('book')}
          />
        )}

        {activePage === 'parcel' && (
          <ParcelView user={user} parcels={parcels} onSignIn={handleSignIn} />
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
            onSignIn={handleSignIn}
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
          onClose={() => setSelectedTrip(null)}
          onSignIn={handleSignIn}
          onBookingCompleted={() => {
            setSelectedTrip(null);
            setActivePage('tickets');
          }}
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
