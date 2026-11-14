import type { User } from 'firebase/auth';
import { Navigation, Printer, Ticket, XCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import React, { useState } from 'react';
import { updateBookingStatus } from '../services/firestoreService';
import type { Booking } from '../types';

interface MyTicketsViewProps {
  user: User | null;
  bookings: Booking[];
  onSignIn: () => void;
  onJumpToBook: () => void;
  onCancelGuestBooking: (bookingId: string) => Promise<void>;
  onTrackTrip?: (tripId: string) => void;
}

export const MyTicketsView: React.FC<MyTicketsViewProps> = ({
  user,
  bookings,
  onSignIn,
  onJumpToBook,
  onCancelGuestBooking,
  onTrackTrip,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleCancelBooking = async (booking: Booking) => {
    setBusyId(booking.id);
    try {
      if (user && user.emailVerified && !booking.passengerUid.startsWith('guest_')) {
        await updateBookingStatus(booking.id, 'Cancelled').catch(() => {});
      }
      await onCancelGuestBooking(booking.id);
    } finally {
      setBusyId(null);
    }
  };

  if (!user && bookings.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 text-slate-700 flex items-center justify-center">
          <Ticket className="w-6 h-6" />
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Your Digital Boarding Passes
        </h1>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Book a departure with M-Pesa to generate an instant QR boarding pass, or sign in to
          sync tickets saved to your account.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onJumpToBook}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
          >
            Browse Departures
          </button>
          <button
            type="button"
            onClick={onSignIn}
            className="px-5 py-2.5 text-sm font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
          >
            Sign In / Sign Up
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5 no-print">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">
            My Digital Boarding Passes
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Present the QR code below to the SACCO stage marshal or conductor before boarding.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Printer className="w-4 h-4" />
          Print Tickets
        </button>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <p className="font-display text-lg font-semibold text-slate-900">
            No matatu bookings found yet
          </p>
          <p className="text-sm text-slate-600">
            Reserve a seat on any scheduled Kenyan departure to generate your signed QR boarding
            pass.
          </p>
          <button
            type="button"
            onClick={onJumpToBook}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
          >
            Browse Departures
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {bookings.map((b) => {
            const qrPayload = JSON.stringify({
              ticketRef: b.ticketRef,
              tripId: b.tripId,
              seats: b.seats,
              plateNumber: b.plateNumber,
              passengerName: b.passengerName,
              qrSignature: b.qrSignature,
            });

            const statusColor =
              b.status === 'Confirmed'
                ? 'text-emerald-700'
                : b.status === 'Boarded'
                ? 'text-slate-900'
                : b.status === 'Cancelled'
                ? 'text-red-700'
                : 'text-amber-700';

            return (
              <article
                key={b.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-12"
              >
                <div className="md:col-span-8 p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <p className="text-xs text-slate-500">
                        {b.saccoName} ·{' '}
                        <span className="font-mono font-semibold text-slate-800">
                          {b.plateNumber}
                        </span>
                      </p>
                      <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
                        {b.routeLabel}
                      </h2>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${statusColor}`}>{b.status}</p>
                      <p className="text-xs font-mono text-slate-500">{b.ticketRef}</p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Date &amp; Departure</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        {b.departureDate} · {b.departureTime}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Cabin Seats</dt>
                      <dd className="font-mono font-bold text-emerald-700 mt-0.5">
                        {b.seats.join(', ')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">M-Pesa Receipt</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        {b.mpesaReceipt || 'Pending'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Fare Paid</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        KES {b.totalKes.toLocaleString()}
                      </dd>
                    </div>
                  </dl>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
                    <div>
                      <span className="text-slate-500">Passenger:</span>{' '}
                      <span className="font-medium text-slate-900">{b.passengerName}</span> (
                      <span className="font-mono">{b.passengerPhone}</span>)
                    </div>
                    <div>
                      <span className="text-slate-500">Stage:</span>{' '}
                      <span className="font-medium text-slate-900">{b.pickupStage}</span> to{' '}
                      <span className="font-medium text-slate-900">{b.dropoffStage}</span>
                    </div>
                  </div>

                  {b.status === 'Confirmed' && (
                    <div className="pt-2 flex flex-wrap items-center gap-4 no-print">
                      {onTrackTrip && (
                        <button
                          type="button"
                          onClick={() => onTrackTrip(b.tripId)}
                          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1.5"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          Track Live Matatu
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleCancelBooking(b)}
                        className="text-xs font-medium text-red-700 hover:text-red-800 inline-flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {busyId === b.id ? 'Cancelling...' : 'Cancel Reservation'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Right QR Code Stub */}
                <div className="md:col-span-4 bg-slate-50 border-t md:border-t-0 md:border-l border-slate-200 p-6 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="p-3 bg-white border border-slate-200 rounded-xl">
                    <QRCodeSVG value={qrPayload} size={132} level="M" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs font-mono font-semibold text-slate-900">
                      {b.ticketRef}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 truncate max-w-[180px]">
                      {b.qrSignature}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
