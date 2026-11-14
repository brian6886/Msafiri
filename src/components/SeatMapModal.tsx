import type { User } from 'firebase/auth';
import { CheckCircle2, Loader2, ShieldCheck, Smartphone, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { KENYA_CORRIDORS } from '../data/kenyaTransitData';
import { createConfirmedBookingBatch } from '../services/firestoreService';
import type { Booking, MpesaStkResponse, Trip, UserProfile } from '../types';

interface SeatMapModalProps {
  trip: Trip;
  user: User | null;
  profile: UserProfile | null;
  onClose: () => void;
  onSignIn: () => Promise<void>;
  onBookingCompleted: (booking: Booking) => void;
}

function buildSeatRows(trip: Trip): Array<Array<{ id: string; label: string; isDriver?: boolean }>> {
  if (trip.classTier === 'Standard 14' || trip.capacity === 14) {
    return [
      [
        { id: 'DRV', label: 'Driver', isDriver: true },
        { id: '1', label: '1 · Front' },
        { id: '2', label: '2 · Front' },
      ],
      [
        { id: '3', label: '3' },
        { id: '4', label: '4' },
        { id: '5', label: '5' },
      ],
      [
        { id: '6', label: '6' },
        { id: '7', label: '7' },
        { id: '8', label: '8' },
      ],
      [
        { id: '9', label: '9' },
        { id: '10', label: '10' },
        { id: '11', label: '11' },
      ],
      [
        { id: '12', label: '12' },
        { id: '13', label: '13' },
        { id: '14', label: '14' },
      ],
    ];
  }

  if (trip.classTier === 'Executive 11' || trip.capacity === 11) {
    return [
      [
        { id: 'DRV', label: 'Driver', isDriver: true },
        { id: '1', label: '1 · VIP Front' },
      ],
      [
        { id: '2', label: '2' },
        { id: '3', label: '3' },
        { id: '4', label: '4' },
      ],
      [
        { id: '5', label: '5' },
        { id: '6', label: '6' },
        { id: '7', label: '7' },
      ],
      [
        { id: '8', label: '8' },
        { id: '9', label: '9' },
        { id: '10', label: '10' },
        { id: '11', label: '11' },
      ],
    ];
  }

  // VIP Coach 33 (11 rows of 3 seats: 2+1 layout)
  const rows: Array<Array<{ id: string; label: string; isDriver?: boolean }>> = [
    [
      { id: 'DRV', label: 'Driver', isDriver: true },
      { id: 'CON', label: 'Conductor', isDriver: true },
    ],
  ];
  let seatNum = 1;
  for (let r = 0; r < 11; r += 1) {
    const rowSeats: Array<{ id: string; label: string }> = [];
    for (let c = 0; c < 3; c += 1) {
      if (seatNum <= trip.capacity) {
        rowSeats.push({ id: String(seatNum), label: String(seatNum) });
        seatNum += 1;
      }
    }
    rows.push(rowSeats);
  }
  return rows;
}

export const SeatMapModal: React.FC<SeatMapModalProps> = ({
  trip,
  user,
  profile,
  onClose,
  onSignIn,
  onBookingCompleted,
}) => {
  const corridor = useMemo(
    () =>
      KENYA_CORRIDORS.find(
        (c) =>
          c.origin.toLowerCase() === trip.origin.toLowerCase() &&
          c.destination.toLowerCase() === trip.destination.toLowerCase()
      ),
    [trip]
  );

  const pickupOptions = corridor?.pickupStages || [trip.originStage];
  const dropoffOptions = corridor?.dropoffStages || [trip.destinationStage];

  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [pickupStage, setPickupStage] = useState<string>(trip.originStage || pickupOptions[0]);
  const [dropoffStage, setDropoffStage] = useState<string>(trip.destinationStage || dropoffOptions[0]);
  const [passengerName, setPassengerName] = useState<string>(
    profile?.displayName || user?.displayName || ''
  );
  const [mpesaPhone, setMpesaPhone] = useState<string>(profile?.phone || '07');
  const [stage, setStage] = useState<'select' | 'stk_pending' | 'success'>('select');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stkInfo, setStkInfo] = useState<MpesaStkResponse | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const seatRows = useMemo(() => buildSeatRows(trip), [trip]);
  const totalKes = selectedSeats.length * trip.fareKes;

  const toggleSeat = (seatId: string) => {
    if (trip.bookedSeats.includes(seatId)) return;
    setErrorMsg(null);
    setSelectedSeats((prev) => {
      if (prev.includes(seatId)) return prev.filter((s) => s !== seatId);
      if (prev.length >= 6) {
        setErrorMsg('Maximum 6 seats per single M-Pesa transaction.');
        return prev;
      }
      return [...prev, seatId];
    });
  };

  const handleTriggerSignIn = async () => {
    setIsSigningIn(true);
    setErrorMsg(null);
    try {
      await onSignIn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not complete sign in.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePayWithMpesa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!user) {
      setErrorMsg('Sign in with Google first to save your boarding pass to your account.');
      return;
    }
    if (selectedSeats.length === 0) {
      setErrorMsg('Select at least one available seat from the cabin layout.');
      return;
    }
    if (passengerName.trim().length < 2) {
      setErrorMsg('Enter passenger full name for the PSV manifest.');
      return;
    }

    setStage('stk_pending');

    try {
      const ticketRef = `MSF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const pushRes = await fetch('/api/mpesa/stk-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: mpesaPhone,
          amountKes: totalKes,
          accountRef: ticketRef,
        }),
      });
      const pushData = await pushRes.json();
      if (!pushRes.ok) {
        setStage('select');
        setErrorMsg(pushData.error || 'Failed to initiate M-Pesa STK Push.');
        return;
      }

      setStkInfo(pushData as MpesaStkResponse);

      // Poll Daraja callback / stkpushquery status for up to 60s while user enters M-Pesa PIN
      let completedTx: MpesaStkResponse | null = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(`/api/mpesa/status/${pushData.checkoutRequestId}`);
        const statusData = (await statusRes.json()) as MpesaStkResponse;
        if (statusData.status === 'COMPLETED' && statusData.mpesaReceipt) {
          completedTx = statusData;
          break;
        }
        if (statusData.status === 'FAILED') {
          throw new Error(
            statusData.failureReason || 'M-Pesa transaction was cancelled or failed on handset.'
          );
        }
      }

      if (!completedTx || !completedTx.mpesaReceipt) {
        throw new Error(
          'M-Pesa confirmation timed out before PIN entry completed. Please retry.'
        );
      }

      // Sign boarding pass QR payload via Express HMAC endpoint
      const signRes = await fetch('/api/tickets/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketRef,
          tripId: trip.id,
          seats: selectedSeats,
          plateNumber: trip.plateNumber,
          passengerName: passengerName.trim(),
        }),
      });
      const signData = await signRes.json();
      if (!signRes.ok || !signData.signature) {
        throw new Error('Failed to generate cryptographic ticket signature.');
      }

      const bookingId = `bkg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const bookingRecord: Omit<Booking, 'createdAt'> = {
        id: bookingId,
        ticketRef,
        tripId: trip.id,
        passengerUid: user.uid,
        passengerName: passengerName.trim().slice(0, 100),
        passengerPhone: completedTx.phone,
        pickupStage,
        dropoffStage,
        saccoName: trip.saccoName,
        plateNumber: trip.plateNumber,
        routeLabel: `${trip.origin} to ${trip.destination}`,
        departureDate: trip.departureDate,
        departureTime: trip.departureTime,
        seats: selectedSeats,
        totalKes,
        mpesaReceipt: completedTx.mpesaReceipt,
        checkoutRequestId: completedTx.checkoutRequestId,
        paymentStatus: 'Paid',
        status: 'Confirmed',
        qrSignature: signData.signature,
      };

      await createConfirmedBookingBatch(trip, bookingRecord);
      setStkInfo(completedTx);
      setStage('success');
    } catch (err) {
      setStage('select');
      setErrorMsg(err instanceof Error ? err.message : 'Booking could not be completed.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="seat-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl overflow-hidden shadow-xl my-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="seat-modal-title" className="font-display text-lg font-bold text-slate-900">
              {trip.origin} to {trip.destination}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {trip.saccoName} · {trip.plateNumber} · {trip.classTier} · Departs{' '}
              <span className="font-mono">{trip.departureTime}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Close seat selection"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {stage === 'stk_pending' && (
          <div className="p-10 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <h3 className="font-display text-xl font-bold text-slate-900">
              Awaiting M-Pesa PIN Confirmation
            </h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              An STK Push prompt for{' '}
              <span className="font-mono font-semibold text-slate-900">
                KES {totalKes.toLocaleString()}
              </span>{' '}
              has been sent to <span className="font-mono">{mpesaPhone}</span>. Enter your M-Pesa
              PIN on your handset.
            </p>
            {stkInfo && (
              <p className="text-xs font-mono text-slate-500">
                Request ID: {stkInfo.checkoutRequestId}
              </p>
            )}
          </div>
        )}

        {stage === 'success' && (
          <div className="p-10 text-center space-y-5">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-2xl font-bold text-slate-900">
                Seat Reservation Confirmed
              </h3>
              <p className="text-sm text-slate-600">
                M-Pesa Receipt{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {stkInfo?.mpesaReceipt}
                </span>{' '}
                · Seats <span className="font-mono font-semibold">{selectedSeats.join(', ')}</span>
              </p>
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Your signed QR boarding pass is now stored under My Tickets. Present it at{' '}
              {pickupStage} 15 minutes before departure.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onBookingCompleted({} as Booking)}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
              >
                View Boarding Pass
              </button>
            </div>
          </div>
        )}

        {stage === 'select' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left: Interactive Matatu Seat Map */}
            <div className="lg:col-span-6 p-6 bg-slate-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Select Cabin Seats
                </h3>
                <div className="flex items-center gap-4 text-xs text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs border border-slate-300 bg-white inline-block" />
                    Available
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-emerald-700 inline-block" />
                    Selected
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-slate-300 inline-block" />
                    Taken
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-sm mx-auto space-y-3">
                <div className="text-center text-xs text-slate-400 border-b border-slate-100 pb-2">
                  Front Windscreen · {trip.plateNumber}
                </div>
                {seatRows.map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className={`grid gap-2.5 ${
                      row.length === 2
                        ? 'grid-cols-2'
                        : row.length === 4
                        ? 'grid-cols-4'
                        : 'grid-cols-3'
                    }`}
                  >
                    {row.map((seat) => {
                      if (seat.isDriver) {
                        return (
                          <div
                            key={seat.id}
                            className="h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-medium text-slate-500 select-none"
                          >
                            {seat.label}
                          </div>
                        );
                      }

                      const isBooked = trip.bookedSeats.includes(seat.id);
                      const isSelected = selectedSeats.includes(seat.id);

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          disabled={isBooked}
                          onClick={() => toggleSeat(seat.id)}
                          className={`h-11 rounded-lg text-xs font-mono font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                            isBooked
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed line-through'
                              : isSelected
                              ? 'bg-emerald-700 text-white border border-emerald-800'
                              : 'bg-white text-slate-900 border border-slate-300 hover:border-emerald-700 hover:bg-emerald-50/40'
                          }`}
                        >
                          {seat.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Stage Selection & M-Pesa Checkout */}
            <form onSubmit={handlePayWithMpesa} className="lg:col-span-6 p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Pickup Stage
                  </label>
                  <select
                    value={pickupStage}
                    onChange={(e) => setPickupStage(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {pickupOptions.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dropoff Stage
                  </label>
                  <select
                    value={dropoffStage}
                    onChange={(e) => setDropoffStage(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {dropoffOptions.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Passenger Full Name (NTSA Manifest)
                </label>
                <input
                  type="text"
                  required
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  placeholder="e.g. Wanjiku Kamau"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  M-Pesa Mobile Number (STK Push)
                </label>
                <div className="relative">
                  <Smartphone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    value={mpesaPhone}
                    onChange={(e) => setMpesaPhone(e.target.value)}
                    placeholder="0712 345 678 or 0112 898 591"
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-2 text-sm">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Selected Seats</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {selectedSeats.length > 0 ? selectedSeats.join(', ') : 'None selected'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Fare per Seat</span>
                  <span className="font-mono">KES {trip.fareKes.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Daraja Settlement Target</span>
                  <span className="font-mono text-slate-900">0112898591</span>
                </div>
                <div className="flex items-center justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-100">
                  <span>Total M-Pesa STK Push</span>
                  <span className="font-mono text-emerald-700">
                    KES {totalKes.toLocaleString()}
                  </span>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {errorMsg}
                </div>
              )}

              {!user ? (
                <button
                  type="button"
                  disabled={isSigningIn}
                  onClick={handleTriggerSignIn}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isSigningIn ? 'Connecting...' : 'Sign In with Google to Pay & Lock Seat'}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={selectedSeats.length === 0}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Send M-Pesa STK Push (KES {totalKes.toLocaleString()})
                </button>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
