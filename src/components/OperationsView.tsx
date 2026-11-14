import type { User } from 'firebase/auth';
import {
  Bus,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Package,
  Plus,
  QrCode,
  ShieldAlert,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { KENYA_TOWNS, getDefaultTravelDate } from '../data/kenyaTransitData';
import {
  ADMIN_EMAIL,
  createTripAdmin,
  createVehicleAdmin,
  deleteVehicleAdmin,
  isBootstrappedAdmin,
  updateBookingStatus,
  updateParcelStatus,
  updateTripStatusAdmin,
  updateVehicleStatusAdmin,
} from '../services/firestoreService';
import type {
  Booking,
  BookingStatus,
  NtsaPlateReport,
  Parcel,
  ParcelStatus,
  Sacco,
  TicketVerificationResult,
  Trip,
  TripStatus,
  Vehicle,
  VehicleClassTier,
} from '../types';

interface OperationsViewProps {
  user: User | null;
  isAdmin: boolean;
  hasAdminSession: boolean;
  trips: Trip[];
  saccos: Sacco[];
  vehicles: Vehicle[];
  bookings: Booking[];
  parcels: Parcel[];
  onAdminDataChanged: () => void;
}

type OpsTab = 'verify' | 'dispatch' | 'fleet' | 'parcels' | 'ledger';

export const OperationsView: React.FC<OperationsViewProps> = ({
  user,
  isAdmin,
  hasAdminSession,
  trips,
  saccos,
  vehicles,
  bookings,
  parcels,
  onAdminDataChanged,
}) => {
  const [activeTab, setActiveTab] = useState<OpsTab>('verify');

  // Conductor QR Verification State
  const [qrInput, setQrInput] = useState('');
  const [verifyingQr, setVerifyingQr] = useState(false);
  const [verifyResult, setVerifyResult] = useState<TicketVerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // NTSA Plate Verification State
  const [plateQuery, setPlateQuery] = useState('KDL 482G');
  const [plateReport, setPlateReport] = useState<NtsaPlateReport | null>(null);
  const [plateError, setPlateError] = useState<string | null>(null);
  const [checkingPlate, setCheckingPlate] = useState(false);

  // New Trip Dispatch Form
  const [newOrigin, setNewOrigin] = useState('Nairobi');
  const [newDestination, setNewDestination] = useState('Nakuru');
  const [newSaccoId, setNewSaccoId] = useState(saccos[0]?.id || 'sacco_2nk');
  const [newVehicleId, setNewVehicleId] = useState(vehicles[0]?.id || 'veh_kdm_915q');
  const [newDepartureTime, setNewDepartureTime] = useState('14:30');
  const [newArrivalTime, setNewArrivalTime] = useState('17:15');
  const [newFareKes, setNewFareKes] = useState(800);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);

  // Add / Delete Fleet Vehicle State
  const [fleetPlate, setFleetPlate] = useState('');
  const [fleetSaccoId, setFleetSaccoId] = useState(saccos[0]?.id || 'sacco_north_rift');
  const [fleetModel, setFleetModel] = useState('Toyota Hiace Executive High-Roof');
  const [fleetTier, setFleetTier] = useState<VehicleClassTier>('Executive 11');
  const [fleetDriver, setFleetDriver] = useState('');
  const [fleetExpiry, setFleetExpiry] = useState('2027-12-31');
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [fleetMessage, setFleetMessage] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [confirmDeleteVehicleId, setConfirmDeleteVehicleId] = useState<string | null>(null);
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null);

  const [darajaStatus, setDarajaStatus] = useState<{
    configured: boolean;
    b2cConfigured: boolean;
    credentialMode?: 'encrypted-from-password' | 'pre-encrypted' | 'missing';
    environment: string;
    missingVars: string[];
    shortcode: string | null;
    settlementPhone: string;
    callbackUrl: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/mpesa/config-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setDarajaStatus(data);
      })
      .catch(() => {});
  }, []);

  const revenueStats = useMemo(() => {
    const ticketRevenue = bookings
      .filter((b) => b.paymentStatus === 'Paid' && b.status !== 'Cancelled')
      .reduce((acc, b) => acc + b.totalKes, 0);
    const parcelRevenue = parcels
      .filter((p) => p.status !== 'Cancelled')
      .reduce((acc, p) => acc + p.feeKes, 0);
    const totalSeatsSold = bookings
      .filter((b) => b.status !== 'Cancelled')
      .reduce((acc, b) => acc + b.seats.length, 0);
    return { ticketRevenue, parcelRevenue, totalSeatsSold };
  }, [bookings, parcels]);

  const handleVerifyPayload = async (rawPayload: string) => {
    setVerifyingQr(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      const parsed = JSON.parse(rawPayload);
      const res = await fetch('/api/tickets/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = (await res.json()) as TicketVerificationResult;
      setVerifyResult(data);
    } catch {
      setVerifyError('Paste a valid JSON QR boarding pass payload from My Tickets.');
    } finally {
      setVerifyingQr(false);
    }
  };

  const handleMarkBoarded = async (bookingId: string) => {
    if (!isAdmin) return;
    if (hasAdminSession) {
      await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'Boarded' as BookingStatus }),
      });
    }
    if (isBootstrappedAdmin(user)) {
      await updateBookingStatus(bookingId, 'Boarded').catch(() => {});
    }
    onAdminDataChanged();
  };

  const handleUpdateTripStatus = async (tripId: string, status: TripStatus) => {
    if (!isAdmin) return;
    if (hasAdminSession) {
      await fetch(`/api/admin/trips/${encodeURIComponent(tripId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
    }
    if (isBootstrappedAdmin(user)) {
      await updateTripStatusAdmin(tripId, status).catch(() => {});
    }
    onAdminDataChanged();
  };

  const handleUpdateVehicleStatus = async (
    vehicleId: string,
    status: Vehicle['status']
  ) => {
    if (!isAdmin) return;
    if (hasAdminSession) {
      await fetch(`/api/admin/vehicles/${encodeURIComponent(vehicleId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
    }
    if (isBootstrappedAdmin(user)) {
      await updateVehicleStatusAdmin(vehicleId, status).catch(() => {});
    }
    onAdminDataChanged();
  };

  const handleAddFleetVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setFleetError(null);
    setFleetMessage(null);

    const cleanPlate = fleetPlate.trim().toUpperCase().replace(/\s+/g, ' ');
    const cleanModel = fleetModel.trim();
    const cleanDriver = fleetDriver.trim();

    if (cleanPlate.length < 6 || cleanPlate.length > 12) {
      setFleetError('Enter a valid Kenyan PSV registration plate (e.g. KDP 312Z).');
      return;
    }
    if (!cleanModel || !cleanDriver) {
      setFleetError('Vehicle model and assigned driver name are required.');
      return;
    }

    const capacity =
      fleetTier === 'Executive 11' ? 11 : fleetTier === 'VIP Coach 33' ? 33 : 14;
    const vehiclePayload: Vehicle = {
      id: `veh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      saccoId: fleetSaccoId,
      plateNumber: cleanPlate,
      model: cleanModel,
      capacity,
      classTier: fleetTier,
      ntsaExpiry: fleetExpiry || '2027-12-31',
      speedGovernorStatus: 'Calibrated 80km/h',
      driverName: cleanDriver,
      status: 'Active',
    };

    setCreatingVehicle(true);
    try {
      if (hasAdminSession) {
        const res = await fetch('/api/admin/vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(vehiclePayload),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Could not register fleet vehicle.');
        }
      }
      if (isBootstrappedAdmin(user)) {
        await createVehicleAdmin(vehiclePayload).catch(() => {});
      }
      setFleetPlate('');
      setFleetDriver('');
      setFleetMessage(`Registered ${cleanPlate} (${fleetTier}) to fleet.`);
      onAdminDataChanged();
    } catch (err) {
      setFleetError(err instanceof Error ? err.message : 'Failed to add fleet vehicle.');
    } finally {
      setCreatingVehicle(false);
    }
  };

  const handleDeleteFleetVehicle = async (vehicleId: string, plateNumber: string) => {
    if (!isAdmin) return;
    setFleetError(null);
    setFleetMessage(null);
    setDeletingVehicleId(vehicleId);
    try {
      if (hasAdminSession) {
        const res = await fetch(`/api/admin/vehicles/${encodeURIComponent(vehicleId)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to delete vehicle from fleet.');
        }
      }
      if (isBootstrappedAdmin(user)) {
        await deleteVehicleAdmin(vehicleId).catch(() => {});
      }
      setConfirmDeleteVehicleId(null);
      setFleetMessage(`Removed ${plateNumber} from registered PSV fleet.`);
      onAdminDataChanged();
    } catch (err) {
      setFleetError(err instanceof Error ? err.message : 'Could not delete fleet vehicle.');
    } finally {
      setDeletingVehicleId(null);
    }
  };

  const handleUpdateParcelStatus = async (parcelId: string, status: ParcelStatus) => {
    if (!isAdmin) return;
    if (hasAdminSession) {
      await fetch(`/api/admin/parcels/${encodeURIComponent(parcelId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
    }
    if (isBootstrappedAdmin(user)) {
      await updateParcelStatus(parcelId, status).catch(() => {});
    }
    onAdminDataChanged();
  };

  const handleCheckNtsaPlate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckingPlate(true);
    setPlateError(null);
    setPlateReport(null);
    try {
      const res = await fetch(`/api/ntsa/verify?plate=${encodeURIComponent(plateQuery)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'NTSA lookup failed.');
      setPlateReport(data as NtsaPlateReport);
    } catch (err) {
      setPlateError(err instanceof Error ? err.message : 'Plate lookup error.');
    } finally {
      setCheckingPlate(false);
    }
  };

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setCreatingTrip(true);
    setDispatchMessage(null);
    try {
      const sacco = saccos.find((s) => s.id === newSaccoId) || saccos[0];
      const vehicle = vehicles.find((v) => v.id === newVehicleId) || vehicles[0];
      if (!sacco || !vehicle) {
        throw new Error('Register at least one active PSV vehicle before dispatching a trip.');
      }
      const tripPayload: Trip = {
        id: `trip_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        saccoId: sacco.id,
        saccoName: sacco.name,
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        classTier: vehicle.classTier,
        origin: newOrigin,
        originStage: `${newOrigin} Main Terminal`,
        destination: newDestination,
        destinationStage: `${newDestination} Central Stage`,
        departureDate: getDefaultTravelDate(),
        departureTime: newDepartureTime,
        arrivalTime: newArrivalTime,
        durationLabel: '3h 00m',
        fareKes: Number(newFareKes),
        capacity: vehicle.capacity,
        availableSeats: vehicle.capacity,
        bookedSeats: [],
        status: 'Scheduled',
      };

      if (hasAdminSession) {
        const res = await fetch('/api/admin/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(tripPayload),
        });
        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errJson.error || 'Could not publish trip.');
        }
      }
      if (isBootstrappedAdmin(user)) {
        await createTripAdmin(tripPayload).catch(() => {});
      }
      onAdminDataChanged();
      setDispatchMessage(`Dispatched ${vehicle.plateNumber} (${newOrigin} to ${newDestination}).`);
    } catch (err) {
      setDispatchMessage(err instanceof Error ? err.message : 'Could not create trip.');
    } finally {
      setCreatingTrip(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  const navTabs: Array<{ id: OpsTab; label: string; icon: React.ReactNode }> = [
    { id: 'verify', label: 'Conductor Check-In', icon: <QrCode className="w-4 h-4" /> },
    { id: 'dispatch', label: 'Dispatch & Trips', icon: <Bus className="w-4 h-4" /> },
    { id: 'fleet', label: 'NTSA Fleet Registry', icon: <ClipboardCheck className="w-4 h-4" /> },
    { id: 'parcels', label: 'Parcel Desk', icon: <Package className="w-4 h-4" /> },
    { id: 'ledger', label: 'M-Pesa Ledger', icon: <TrendingUp className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sidebar Navigation (matching SaaS dashboard architecture) */}
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="px-2 pt-1 pb-3 border-b border-slate-100">
            <h1 className="font-display text-lg font-bold text-slate-900">
              Admin Operations
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{ADMIN_EMAIL}</p>
          </div>

          <nav className="space-y-1" aria-label="Operations sections">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-2.5 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-950 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-emerald-700" />
              Restricted Admin Console
            </p>
            <p>
              Visible exclusively when signed in as <span className="font-mono">{ADMIN_EMAIL}</span>.
            </p>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="lg:col-span-9 space-y-6">
          {activeTab === 'verify' && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  Conductor QR Boarding Verification
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Validate cryptographic HMAC-SHA256 boarding passes against the backend signing
                  authority and clear passengers onto the PSV manifest.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-medium text-slate-700">
                  Scanned QR Boarding Pass Payload (JSON)
                </label>
                <textarea
                  rows={4}
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder='{"ticketRef":"MSF-XXXXXX","tripId":"...","seats":["3"],"plateNumber":"KDL 482G","passengerName":"...","qrSignature":"MSF1...."}'
                  className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={verifyingQr || !qrInput.trim()}
                    onClick={() => handleVerifyPayload(qrInput)}
                    className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg transition-colors inline-flex items-center gap-2"
                  >
                    {verifyingQr && <Loader2 className="w-4 h-4 animate-spin" />}
                    Verify Boarding Pass
                  </button>
                </div>
              </div>

              {verifyError && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {verifyError}
                </div>
              )}

              {verifyResult && (
                <div
                  className={`p-4 rounded-xl border ${
                    verifyResult.valid
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  <p className="font-semibold text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    {verifyResult.valid ? 'AUTHENTIC TICKET CLEARED' : 'VERIFICATION FAILED'}
                  </p>
                  <p className="text-xs mt-1">{verifyResult.reason}</p>
                  {verifyResult.ticketRef && (
                    <p className="text-xs font-mono mt-2">
                      Ref: {verifyResult.ticketRef} · Plate: {verifyResult.plateNumber} · Seats:{' '}
                      {verifyResult.seats?.join(', ')}
                    </p>
                  )}
                </div>
              )}

              {/* Active Bookings Quick Check-In Table */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Recent Passenger Manifest ({bookings.length})
                </h3>
                {bookings.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No active passenger tickets loaded in this session.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-medium">Ticket Ref</th>
                          <th className="py-2 pr-3 font-medium">Passenger</th>
                          <th className="py-2 pr-3 font-medium">Vehicle / Seats</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bookings.map((b) => (
                          <tr key={b.id}>
                            <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">
                              {b.ticketRef}
                            </td>
                            <td className="py-2.5 pr-3">
                              {b.passengerName}
                              <div className="font-mono text-slate-400">{b.mpesaReceipt}</div>
                            </td>
                            <td className="py-2.5 pr-3 font-mono">
                              {b.plateNumber} · {b.seats.join(', ')}
                            </td>
                            <td className="py-2.5 pr-3 font-medium">{b.status}</td>
                            <td className="py-2.5 text-right space-x-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const payload = JSON.stringify({
                                    ticketRef: b.ticketRef,
                                    tripId: b.tripId,
                                    seats: b.seats,
                                    plateNumber: b.plateNumber,
                                    passengerName: b.passengerName,
                                    qrSignature: b.qrSignature,
                                  });
                                  setQrInput(payload);
                                  handleVerifyPayload(payload);
                                }}
                                className="text-emerald-700 hover:text-emerald-800 font-medium"
                              >
                                Verify QR
                              </button>
                              {isAdmin && b.status === 'Confirmed' && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkBoarded(b.id)}
                                  className="text-slate-900 hover:underline font-medium"
                                >
                                  Mark Boarded
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'dispatch' && (
            <section className="space-y-6">
              {isAdmin && (
                <form
                  onSubmit={handleCreateTrip}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="w-5 h-5 text-emerald-700" />
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      Schedule New Kenyan Departure
                    </h2>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Origin
                      </label>
                      <select
                        value={newOrigin}
                        onChange={(e) => setNewOrigin(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
                      >
                        {KENYA_TOWNS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Destination
                      </label>
                      <select
                        value={newDestination}
                        onChange={(e) => setNewDestination(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
                      >
                        {KENYA_TOWNS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Fare (KES)
                      </label>
                      <input
                        type="number"
                        min={100}
                        max={15000}
                        value={newFareKes}
                        onChange={(e) => setNewFareKes(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        SACCO
                      </label>
                      <select
                        value={newSaccoId}
                        onChange={(e) => setNewSaccoId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
                      >
                        {saccos.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Vehicle Plate
                      </label>
                      <select
                        value={newVehicleId}
                        onChange={(e) => setNewVehicleId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
                      >
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.plateNumber} ({v.classTier})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Departure
                      </label>
                      <input
                        type="time"
                        value={newDepartureTime}
                        onChange={(e) => setNewDepartureTime(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Est. Arrival
                      </label>
                      <input
                        type="time"
                        value={newArrivalTime}
                        onChange={(e) => setNewArrivalTime(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  {dispatchMessage && (
                    <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                      {dispatchMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={creatingTrip}
                    className="px-5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                  >
                    {creatingTrip ? 'Publishing...' : 'Publish Departure to Live Board'}
                  </button>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Live Trip Dispatch Board
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">Time</th>
                        <th className="py-2 pr-3 font-medium">Corridor</th>
                        <th className="py-2 pr-3 font-medium">Plate / SACCO</th>
                        <th className="py-2 pr-3 font-medium">Occupancy</th>
                        <th className="py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trips.map((t) => (
                        <tr key={t.id}>
                          <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">
                            {t.departureTime}
                          </td>
                          <td className="py-2.5 pr-3">
                            {t.origin} to {t.destination}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="font-mono font-semibold">{t.plateNumber}</span> ·{' '}
                            {t.saccoName}
                          </td>
                          <td className="py-2.5 pr-3 font-mono">
                            {t.capacity - t.availableSeats}/{t.capacity} seats
                          </td>
                          <td className="py-2.5 text-right">
                              <select
                                value={t.status}
                                onChange={(e) =>
                                  handleUpdateTripStatus(t.id, e.target.value as TripStatus)
                                }
                                className="px-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded"
                              >
                                <option value="Scheduled">Scheduled</option>
                                <option value="Boarding">Boarding</option>
                                <option value="Departed">Departed</option>
                                <option value="Arrived">Arrived</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'fleet' && (
            <section className="space-y-6">
              {/* NTSA Verification Lookup */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-slate-900">
                  NTSA PSV Plate &amp; Speed Governor Lookup
                </h2>
                <form onSubmit={handleCheckNtsaPlate} className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    value={plateQuery}
                    onChange={(e) => setPlateQuery(e.target.value)}
                    placeholder="e.g. KDL 482G"
                    className="px-3 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    disabled={checkingPlate}
                    className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                  >
                    {checkingPlate ? 'Checking...' : 'Verify NTSA Compliance'}
                  </button>
                </form>

                {plateError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                    {plateError}
                  </p>
                )}

                {plateReport && (
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div>
                      <dt className="text-slate-500">Plate &amp; SACCO</dt>
                      <dd className="font-semibold text-slate-900 mt-0.5">
                        {plateReport.plateNumber} · {plateReport.registeredOwnerSacco}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Speed Governor</dt>
                      <dd className="font-semibold text-emerald-700 mt-0.5">
                        {plateReport.speedGovernor}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">TLB License</dt>
                      <dd className="font-mono text-slate-900 mt-0.5">
                        {plateReport.tlbLicenseNo}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Inspection Expiry</dt>
                      <dd className="font-mono text-slate-900 mt-0.5">
                        {plateReport.inspectionExpiry}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>

              {/* Add New Fleet Vehicle */}
              <form
                onSubmit={handleAddFleetVehicle}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <Plus className="w-5 h-5 text-emerald-700" />
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Register New Fleet Vehicle
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      PSV Plate Number
                    </label>
                    <input
                      type="text"
                      value={fleetPlate}
                      onChange={(e) => setFleetPlate(e.target.value)}
                      placeholder="e.g. KDP 312Z"
                      className="w-full px-3 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      SACCO Operator
                    </label>
                    <select
                      value={fleetSaccoId}
                      onChange={(e) => setFleetSaccoId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    >
                      {saccos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Cabin Class Tier
                    </label>
                    <select
                      value={fleetTier}
                      onChange={(e) => setFleetTier(e.target.value as VehicleClassTier)}
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    >
                      <option value="Executive 11">Executive 11 (11 seats)</option>
                      <option value="Standard 14">Standard 14 (14 seats)</option>
                      <option value="VIP Coach 33">VIP Coach 33 (33 seats)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Vehicle Make &amp; Model
                    </label>
                    <input
                      type="text"
                      value={fleetModel}
                      onChange={(e) => setFleetModel(e.target.value)}
                      placeholder="Toyota Hiace Executive"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Assigned Driver Name
                    </label>
                    <input
                      type="text"
                      value={fleetDriver}
                      onChange={(e) => setFleetDriver(e.target.value)}
                      placeholder="e.g. David Kamau"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      NTSA Inspection Expiry
                    </label>
                    <input
                      type="date"
                      value={fleetExpiry}
                      onChange={(e) => setFleetExpiry(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                {fleetError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                    {fleetError}
                  </p>
                )}

                {fleetMessage && (
                  <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                    {fleetMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={creatingVehicle}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg transition-colors"
                >
                  {creatingVehicle ? 'Adding Vehicle...' : 'Add Vehicle to Fleet'}
                </button>
              </form>

              {/* Fleet Table */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Registered PSV Fleet ({vehicles.length})
                </h2>
                {vehicles.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No vehicles currently registered in the fleet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-medium">Plate</th>
                          <th className="py-2 pr-3 font-medium">SACCO &amp; Model</th>
                          <th className="py-2 pr-3 font-medium">Driver</th>
                          <th className="py-2 pr-3 font-medium">Governor</th>
                          <th className="py-2 pr-3 font-medium text-right">Status</th>
                          <th className="py-2 font-medium text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vehicles.map((v) => {
                          const saccoName =
                            saccos.find((s) => s.id === v.saccoId)?.name || v.saccoId;
                          const isConfirming = confirmDeleteVehicleId === v.id;
                          const isDeleting = deletingVehicleId === v.id;
                          return (
                            <tr key={v.id}>
                              <td className="py-2.5 pr-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                {v.plateNumber}
                              </td>
                              <td className="py-2.5 pr-3">
                                <div className="font-medium text-slate-900">
                                  {v.model} ({v.capacity} seats)
                                </div>
                                <div className="text-[11px] text-slate-500">{saccoName}</div>
                              </td>
                              <td className="py-2.5 pr-3">{v.driverName}</td>
                              <td className="py-2.5 pr-3 text-emerald-700 font-medium whitespace-nowrap">
                                {v.speedGovernorStatus}
                              </td>
                              <td className="py-2.5 pr-3 text-right">
                                <select
                                  value={v.status}
                                  onChange={(e) =>
                                    handleUpdateVehicleStatus(
                                      v.id,
                                      e.target.value as Vehicle['status']
                                    )
                                  }
                                  className="px-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded"
                                >
                                  <option value="Active">Active</option>
                                  <option value="Maintenance">Maintenance</option>
                                  <option value="Grounded">Grounded</option>
                                </select>
                              </td>
                              <td className="py-2.5 text-right whitespace-nowrap">
                                {isConfirming ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() =>
                                        void handleDeleteFleetVehicle(v.id, v.plateNumber)
                                      }
                                      className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
                                    >
                                      {isDeleting ? 'Removing...' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => setConfirmDeleteVehicleId(null)}
                                      className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteVehicleId(v.id)}
                                    className="px-2 py-1 text-xs font-medium text-red-700 hover:text-red-800 hover:bg-red-50 rounded inline-flex items-center gap-1"
                                    title={`Remove ${v.plateNumber}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'parcels' && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="font-display text-lg font-bold text-slate-900">
                SACCO Parcel Waybill Management
              </h2>
              {parcels.length === 0 ? (
                <p className="text-sm text-slate-500">No parcel waybills currently logged.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">Waybill</th>
                        <th className="py-2 pr-3 font-medium">Route</th>
                        <th className="py-2 pr-3 font-medium">Recipient</th>
                        <th className="py-2 pr-3 font-medium">Fee</th>
                        <th className="py-2 font-medium text-right">Dispatch Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parcels.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-3 font-mono font-semibold">{p.waybillNo}</td>
                          <td className="py-2.5 pr-3">
                            {p.originCity} to {p.destinationCity}
                          </td>
                          <td className="py-2.5 pr-3">
                            {p.recipientName} ({p.recipientPhone})
                          </td>
                          <td className="py-2.5 pr-3 font-mono">
                            KES {p.feeKes.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-right">
                              <select
                                value={p.status}
                                onChange={(e) =>
                                  handleUpdateParcelStatus(p.id, e.target.value as ParcelStatus)
                                }
                                className="px-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded"
                              >
                                <option value="Booked">Booked</option>
                                <option value="In Transit">In Transit</option>
                                <option value="Ready for Pickup">Ready for Pickup</option>
                                <option value="Collected">Collected</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'ledger' && (
            <section className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Ticket Revenue (M-Pesa)</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 mt-1">
                    KES {revenueStats.ticketRevenue.toLocaleString()}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Parcel Waybill Revenue</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 mt-1">
                    KES {revenueStats.parcelRevenue.toLocaleString()}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Seats Booked</p>
                  <p className="font-mono text-2xl font-bold text-emerald-700 mt-1">
                    {revenueStats.totalSeatsSold}
                  </p>
                </div>
              </div>

              {darajaStatus && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      Safaricom Daraja STK &amp; Settlement Routing
                    </h2>
                    <span
                      className={`text-xs font-semibold ${
                        darajaStatus.configured ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {darajaStatus.configured
                        ? `Live Daraja (${darajaStatus.environment})`
                        : 'Awaiting Daraja API Secrets'}
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs pt-2 border-t border-slate-100">
                    <div>
                      <dt className="text-slate-500">Settlement Number (Redirect)</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        {darajaStatus.settlementPhone} (0112898591)
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Paybill / Shortcode</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        {darajaStatus.shortcode || '174379'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">B2C SecurityCredential</dt>
                      <dd className="font-medium text-slate-900 mt-0.5">
                        {darajaStatus.credentialMode === 'encrypted-from-password'
                          ? 'Encrypted (SandboxCertificate.cer)'
                          : darajaStatus.credentialMode === 'pre-encrypted'
                          ? 'Configured (Pre-encrypted)'
                          : 'Awaiting MPESA_INITIATOR_PASSWORD'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Daraja Callback URL</dt>
                      <dd className="font-mono text-slate-700 truncate mt-0.5">
                        {darajaStatus.callbackUrl || 'Server APP_URL /api/mpesa/callback'}
                      </dd>
                    </div>
                  </dl>
                  {!darajaStatus.configured && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Add{' '}
                      <span className="font-mono font-semibold">
                        {darajaStatus.missingVars.join(', ')}
                      </span>{' '}
                      in AI Studio Secrets to dispatch live M-Pesa STK Push popups to phones and
                      route settlements to <span className="font-mono">0112898591</span>.
                    </p>
                  )}
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Licensed SACCO Paybill Directory
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">SACCO</th>
                        <th className="py-2 pr-3 font-medium">M-Pesa Paybill</th>
                        <th className="py-2 pr-3 font-medium">NTSA License</th>
                        <th className="py-2 pr-3 font-medium">Dispatch Hotline</th>
                        <th className="py-2 font-medium text-right">Fleet Size</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {saccos.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5 pr-3 font-semibold text-slate-900">{s.name}</td>
                          <td className="py-2.5 pr-3 font-mono">{s.mpesaPaybill}</td>
                          <td className="py-2.5 pr-3 font-mono">{s.ntsaLicense}</td>
                          <td className="py-2.5 pr-3 font-mono">{s.supportPhone}</td>
                          <td className="py-2.5 font-mono text-right">{s.fleetCount} PSVs</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
