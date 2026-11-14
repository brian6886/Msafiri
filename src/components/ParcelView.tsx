import type { User } from 'firebase/auth';
import { CheckCircle2, Loader2, Package } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { KENYA_SACCOS, KENYA_TOWNS } from '../data/kenyaTransitData';
import { createParcelWaybill } from '../services/firestoreService';
import type { MpesaStkResponse, Parcel } from '../types';
import { ParcelTracking } from './ParcelTracking';

interface ParcelViewProps {
  user: User | null;
  parcels: Parcel[];
  onSignIn: () => void;
  onParcelCreated: (parcel: Parcel) => void;
}

export const ParcelView: React.FC<ParcelViewProps> = ({
  user,
  parcels,
  onSignIn,
  onParcelCreated,
}) => {
  const [originCity, setOriginCity] = useState('Nairobi');
  const [destinationCity, setDestinationCity] = useState('Eldoret');
  const [saccoName, setSaccoName] = useState(KENYA_SACCOS[0].name);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [description, setDescription] = useState('');
  const [weightKg, setWeightKg] = useState<number>(3);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successWaybill, setSuccessWaybill] = useState<string | null>(null);
  const [trackedWaybill, setTrackedWaybill] = useState<string>('');

  const feeKes = useMemo(() => {
    const base = 300;
    const perKg = 60;
    return Math.round(base + Math.max(1, weightKg) * perKg);
  }, [weightKg]);

  const handleDispatchParcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (originCity === destinationCity) {
      setErrorMsg('Origin and destination towns must differ.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessWaybill(null);

    try {
      const waybillNo = `WB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const pushRes = await fetch('/api/mpesa/stk-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: senderPhone,
          amountKes: feeKes,
          accountRef: waybillNo,
        }),
      });
      const pushData = await pushRes.json();
      if (!pushRes.ok) throw new Error(pushData.error || 'M-Pesa STK Push failed.');

      let receipt = '';
      for (let i = 0; i < 15; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        const stRes = await fetch(`/api/mpesa/status/${pushData.checkoutRequestId}`);
        const stData = (await stRes.json()) as MpesaStkResponse;
        if (stData.status === 'COMPLETED' && stData.mpesaReceipt) {
          receipt = stData.mpesaReceipt;
          break;
        }
        if (stData.status === 'FAILED') {
          throw new Error(
            stData.failureReason || 'M-Pesa payment was cancelled or declined on phone.'
          );
        }
      }

      if (!receipt) {
        throw new Error(
          pushData.darajaMode === 'sandbox'
            ? `Safaricom Daraja Sandbox accepted CheckoutRequestID ${pushData.checkoutRequestId}, but Sandbox (174379) does not send live SIM popups to real phones unless MPESA_ENV=production with Go-Live credentials.`
            : 'M-Pesa confirmation timed out before PIN entry.'
        );
      }

      const parcelId = `pcl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const parcelRecord: Omit<Parcel, 'createdAt'> = {
        id: parcelId,
        waybillNo,
        senderUid: user ? user.uid : `guest_${senderPhone.replace(/\D/g, '')}`,
        senderName: (user?.displayName || 'Sender').slice(0, 100),
        senderPhone: senderPhone.trim().slice(0, 16),
        recipientName: recipientName.trim().slice(0, 100),
        recipientPhone: recipientPhone.trim().slice(0, 16),
        originCity,
        destinationCity,
        saccoName,
        description: description.trim().slice(0, 200),
        weightKg: Number(weightKg),
        feeKes,
        mpesaReceipt: receipt,
        status: 'Booked',
      };

      await fetch('/api/parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parcelRecord),
      });

      if (user && user.emailVerified) {
        await createParcelWaybill(parcelRecord).catch(() => {});
      }

      onParcelCreated(parcelRecord as Parcel);
      setSuccessWaybill(`${waybillNo} · M-Pesa ${receipt}`);
      setRecipientName('');
      setDescription('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to book parcel.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="font-display text-3xl font-bold text-slate-900">
          SACCO Intercity Parcel &amp; Courier
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Same-day luggage bay parcel dispatch across Nairobi, Nakuru, Eldoret, Kisumu, Mt.
          Kenya, and Mombasa terminals.
        </p>
      </div>

      <ParcelTracking parcels={parcels} initialWaybill={trackedWaybill} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Dispatch Form */}
        <form
          onSubmit={handleDispatchParcel}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-bold text-slate-900">Book Parcel Waybill</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">From Town</label>
              <select
                value={originCity}
                onChange={(e) => setOriginCity(e.target.value)}
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
              <label className="block text-xs font-medium text-slate-700 mb-1">To Town</label>
              <select
                value={destinationCity}
                onChange={(e) => setDestinationCity(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
              >
                {KENYA_TOWNS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Operating SACCO Office
            </label>
            <select
              value={saccoName}
              onChange={(e) => setSaccoName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
            >
              {KENYA_SACCOS.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                required
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. Brian Kipchoge"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recipient Phone
              </label>
              <input
                type="tel"
                required
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="0722 000 000"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Sender M-Pesa Number
              </label>
              <input
                type="tel"
                required
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                placeholder="0712 345 678"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Approx Weight (kg)
              </label>
              <input
                type="number"
                min={0.5}
                max={200}
                step={0.5}
                required
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Parcel Contents Description
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Sealed electronics carton"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-sm font-semibold">
            <span className="text-slate-700">Courier Fee</span>
            <span className="font-mono text-emerald-700">KES {feeKes.toLocaleString()}</span>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {errorMsg}
            </p>
          )}
          {successWaybill && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Waybill issued: <span className="font-mono font-semibold">{successWaybill}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-400 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Pay via M-Pesa &amp; Generate Waybill (KES {feeKes})
          </button>
        </form>

        {/* Right: Active Waybills List */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-display text-lg font-bold text-slate-900">
              Active Parcel Waybills
            </h2>
            <span className="text-xs font-mono text-slate-500">{parcels.length} records</span>
          </div>

          {parcels.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <Package className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm text-slate-600">
                No parcel waybills dispatched yet. Book a parcel or sign in to view saved
                waybills.
              </p>
              {!user && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Sign In / Sign Up
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Waybill</th>
                    <th className="py-2.5 pr-4 font-medium">Corridor</th>
                    <th className="py-2.5 pr-4 font-medium">Recipient</th>
                    <th className="py-2.5 pr-4 font-medium">Status</th>
                    <th className="py-2.5 font-medium text-right">Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parcels.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <p className="font-mono font-semibold text-slate-900">{p.waybillNo}</p>
                        <p className="text-xs text-slate-500">{p.saccoName}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-slate-800">
                          {p.originCity} to {p.destinationCity}
                        </p>
                        <p className="text-xs text-slate-500 truncate max-w-[180px]">
                          {p.description} ({p.weightKg} kg)
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="text-slate-800">{p.recipientName}</p>
                        <p className="text-xs font-mono text-slate-500">{p.recipientPhone}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs font-medium text-emerald-700">{p.status}</span>
                        <p className="text-[11px] font-mono text-slate-400">{p.mpesaReceipt}</p>
                      </td>
                      <td className="py-3 font-mono font-semibold text-slate-900 text-right">
                        <div>KES {p.feeKes.toLocaleString()}</div>
                        <button
                          type="button"
                          onClick={() => setTrackedWaybill(p.waybillNo)}
                          className="text-[11px] font-sans font-semibold text-emerald-700 hover:underline mt-0.5"
                        >
                          Track Status
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
