import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
  KENYA_SACCOS,
  KENYA_VEHICLES,
  buildSeedTrips,
} from '../data/kenyaTransitData';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type {
  Booking,
  BookingStatus,
  Parcel,
  ParcelStatus,
  Sacco,
  Trip,
  TripStatus,
  UserProfile,
  Vehicle,
} from '../types';

export const ADMIN_EMAIL = 'khaneribrian@gmail.com';

export function isBootstrappedAdmin(user: User | null): boolean {
  if (!user || !user.emailVerified) return false;
  return user.email === ADMIN_EMAIL;
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const profilePayload = {
      uid: user.uid,
      displayName: (user.displayName || user.email?.split('@')[0] || 'Passenger').slice(0, 100),
      email: (user.email || 'passenger@msafiri.ke').slice(0, 150),
      phone: '',
      preferredStage: 'Moi Avenue Terminal',
      role: 'passenger' as const,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profilePayload);
    return {
      uid: profilePayload.uid,
      displayName: profilePayload.displayName,
      email: profilePayload.email,
      phone: profilePayload.phone,
      preferredStage: profilePayload.preferredStage,
      role: 'passenger',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateUserProfileContact(
  uid: string,
  updates: { displayName: string; phone: string; preferredStage: string }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: updates.displayName.trim().slice(0, 100),
      phone: updates.phone.trim().slice(0, 15),
      preferredStage: updates.preferredStage.trim().slice(0, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function seedKenyanFleetIfAdmin(user: User): Promise<void> {
  if (!isBootstrappedAdmin(user)) return;
  try {
    const existingTrips = await getDocs(collection(db, 'trips'));
    if (!existingTrips.empty) return;

    const saccoBatch = writeBatch(db);
    for (const sacco of KENYA_SACCOS) {
      saccoBatch.set(doc(db, 'saccos', sacco.id), {
        ...sacco,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await saccoBatch.commit();

    const vehicleBatch = writeBatch(db);
    for (const vehicle of KENYA_VEHICLES) {
      vehicleBatch.set(doc(db, 'vehicles', vehicle.id), {
        ...vehicle,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await vehicleBatch.commit();

    const tripBatch = writeBatch(db);
    for (const trip of buildSeedTrips()) {
      tripBatch.set(doc(db, 'trips', trip.id), {
        ...trip,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await tripBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'trips');
  }
}

export function subscribeTrips(
  onData: (trips: Trip[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'trips';
  const q = query(collection(db, 'trips'), orderBy('departureTime', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as Trip);
      onData(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeSaccos(onData: (saccos: Sacco[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'saccos'),
    (snapshot) => {
      onData(snapshot.docs.map((d) => d.data() as Sacco));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'saccos')
  );
}

export function subscribeVehicles(onData: (vehicles: Vehicle[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'vehicles'),
    (snapshot) => {
      onData(snapshot.docs.map((d) => d.data() as Vehicle));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'vehicles')
  );
}

export function subscribeUserBookings(
  user: User,
  isAdminUser: boolean,
  onData: (bookings: Booking[]) => void
): Unsubscribe {
  const path = 'bookings';
  const q = isAdminUser
    ? query(collection(db, 'bookings'))
    : query(collection(db, 'bookings'), where('passengerUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => d.data() as Booking);
      rows.sort((a, b) => {
        const dateA = `${a.departureDate} ${a.departureTime}`;
        const dateB = `${b.departureDate} ${b.departureTime}`;
        return dateB.localeCompare(dateA);
      });
      onData(rows);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeUserParcels(
  user: User,
  isAdminUser: boolean,
  onData: (parcels: Parcel[]) => void
): Unsubscribe {
  const path = 'parcels';
  const q = isAdminUser
    ? query(collection(db, 'parcels'))
    : query(collection(db, 'parcels'), where('senderUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => d.data() as Parcel));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createConfirmedBookingBatch(
  trip: Trip,
  booking: Omit<Booking, 'createdAt'>
): Promise<void> {
  const batch = writeBatch(db);
  const bookingRef = doc(db, 'bookings', booking.id);
  const tripRef = doc(db, 'trips', trip.id);

  const mergedSeats = Array.from(new Set([...trip.bookedSeats, ...booking.seats]));
  const nextAvailable = Math.max(0, trip.capacity - mergedSeats.length);

  batch.set(bookingRef, {
    ...booking,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(tripRef, {
    bookedSeats: mergedSeats,
    availableSeats: nextAvailable,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `bookings/${booking.id}`);
  }
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus
): Promise<void> {
  const path = `bookings/${bookingId}`;
  try {
    await updateDoc(doc(db, 'bookings', bookingId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createParcelWaybill(
  parcel: Omit<Parcel, 'createdAt'>
): Promise<void> {
  const path = `parcels/${parcel.id}`;
  try {
    await setDoc(doc(db, 'parcels', parcel.id), {
      ...parcel,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateParcelStatus(
  parcelId: string,
  status: ParcelStatus
): Promise<void> {
  const path = `parcels/${parcelId}`;
  try {
    await updateDoc(doc(db, 'parcels', parcelId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createTripAdmin(trip: Trip): Promise<void> {
  const path = `trips/${trip.id}`;
  try {
    await setDoc(doc(db, 'trips', trip.id), {
      ...trip,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTripStatusAdmin(
  tripId: string,
  status: TripStatus
): Promise<void> {
  const path = `trips/${tripId}`;
  try {
    await updateDoc(doc(db, 'trips', tripId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateVehicleStatusAdmin(
  vehicleId: string,
  status: Vehicle['status']
): Promise<void> {
  const path = `vehicles/${vehicleId}`;
  try {
    await updateDoc(doc(db, 'vehicles', vehicleId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createVehicleAdmin(vehicle: Vehicle): Promise<void> {
  const path = `vehicles/${vehicle.id}`;
  try {
    await setDoc(doc(db, 'vehicles', vehicle.id), {
      ...vehicle,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteVehicleAdmin(vehicleId: string): Promise<void> {
  const path = `vehicles/${vehicleId}`;
  try {
    await deleteDoc(doc(db, 'vehicles', vehicleId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

