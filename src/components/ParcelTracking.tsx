import {
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Package,
  Search,
  Truck,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { Parcel, ParcelStatus, ParcelTrackingResult } from '../types';

interface ParcelTrackingProps {
  parcels?: Parcel[];
  initialWaybill?: string;
}

const TRACKING_STEPS: Array<{
  status: Exclude<ParcelStatus, 'Cancelled'>;
  label: string;
  caption: string;
}> = [
  {
    status: 'Booked',
    label: 'Booked',
    caption: 'Logged at origin SACCO office',
  },
  {
    status: 'In Transit',
    label: 'In Transit',
    caption: 'En route on intercity coach',
  },
  {
    status: 'Ready for Pickup',
    label: 'Ready for Pickup',
    caption: 'Arrived at destination desk',
  },
  {
    status: 'Collected',
    label: 'Collected',
    caption: 'Released to recipient',
  },
];

function deriveLocalTracking(parcel: Parcel): ParcelTrackingResult {
  let lastKnownLocation = `${parcel.originCity} — ${parcel.saccoName} Parcel Bay`;
  let highwayCheckpoint = 'Awaiting next scheduled departure manifest';

  if (parcel.status === 'In Transit') {
    lastKnownLocation = `${parcel.originCity}–${parcel.destinationCity} Highway Corridor`;
    highwayCheckpoint = `In luggage bay · Heading toward ${parcel.destinationCity}`;
  } else if (parcel.status === 'Ready for Pickup') {
    lastKnownLocation = `${parcel.destinationCity} — ${parcel.saccoName} Collection Counter`;
    highwayCheckpoint = `${parcel.destinationCity} Central Stage`;
  } else if (parcel.status === 'Collected') {
    lastKnownLocation = `${parcel.destinationCity} — Handed over to ${parcel.recipientName}`;
    highwayCheckpoint = 'Recipient ID & signature verified';
  } else if (parcel.status === 'Cancelled') {
    lastKnownLocation = `${parcel.originCity} — Waybill Cancelled`;
    highwayCheckpoint = 'Dispatch cancelled prior to departure';
  }

  return {
    waybillNo: parcel.waybillNo,
    originCity: parcel.originCity,
    destinationCity: parcel.destinationCity,
    saccoName: parcel.saccoName,
    description: parcel.description,
    weightKg: parcel.weightKg,
    status: parcel.status,
    lastKnownLocation,
    highwayCheckpoint,
    updatedAt: new Date().toISOString(),
  };
}

export const ParcelTracking: React.FC<ParcelTrackingProps> = ({
  parcels = [],
  initialWaybill = '',
}) => {
  const [waybillInput, setWaybillInput] = useState(initialWaybill);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ParcelTrackingResult | null>(null);

  const performLookup = async (rawCode: string) => {
    const clean = rawCode.trim().toUpperCase();
    if (!clean) {
      setErrorMsg('Enter a parcel waybill number (e.g. WB-A1B2C3).');
      return;
    }

    setWaybillInput(clean);
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/parcels/track/${encodeURIComponent(clean)}`);
      if (res.ok) {
        const data = (await res.json()) as ParcelTrackingResult;
        setResult(data);
        return;
      }

      // Fallback to synced Firestore / session parcels list if present
      const localMatch = parcels.find(
        (p) => p.waybillNo.toUpperCase() === clean
      );
      if (localMatch) {
        setResult(deriveLocalTracking(localMatch));
        return;
      }

      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      setResult(null);
      setErrorMsg(
        errData.error || `No parcel found with waybill ${clean}.`
      );
    } catch {
      const localMatch = parcels.find(
        (p) => p.waybillNo.toUpperCase() === clean
      );
      if (localMatch) {
        setResult(deriveLocalTracking(localMatch));
      } else {
        setErrorMsg('Unable to check parcel tracking right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialWaybill && initialWaybill.trim()) {
      void performLookup(initialWaybill);
    }
  }, [initialWaybill]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void performLookup(waybillInput);
  };

  const activeStepIndex = result
    ? TRACKING_STEPS.findIndex((s) => s.status === result.status)
    : -1;

  const progressWidthPercent =
    activeStepIndex <= 0
      ? 0
      : Math.min(100, Math.round((activeStepIndex / (TRACKING_STEPS.length - 1)) * 100));

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            SACCO Waybill Lookup
          </p>
          <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
            Track Parcel Status &amp; Location
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Enter your waybill number to check current transit stage and last known SACCO checkpoint.
          </p>
        </div>

        {parcels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Recent:</span>
            {parcels.slice(0, 3).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void performLookup(p.waybillNo)}
                className="px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              >
                {p.waybillNo}
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={waybillInput}
            onChange={(e) => setWaybillInput(e.target.value.toUpperCase())}
            placeholder="Enter Waybill Number (e.g. WB-A1B2C3)"
            aria-label="Waybill number"
            className="w-full pl-10 pr-4 py-2.5 text-sm font-mono uppercase bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !waybillInput.trim()}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Package className="w-4 h-4" />
          )}
          {loading ? 'Checking...' : 'Track Parcel'}
        </button>
      </form>

      {errorMsg && (
        <div className="p-3.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
          {errorMsg}
        </div>
      )}

      {result && (
        <div className="space-y-6 pt-2 border-t border-slate-100">
          {/* Summary Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500">
                {result.saccoName} · {result.originCity} to {result.destinationCity}
              </p>
              <h3 className="font-mono text-lg font-bold text-slate-900 mt-0.5">
                {result.waybillNo}
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                {result.description} ({result.weightKg} kg)
              </p>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-[11px] text-slate-500">Current Status</p>
              <p
                className={`text-sm font-bold mt-0.5 ${
                  result.status === 'Cancelled'
                    ? 'text-red-700'
                    : result.status === 'Collected'
                    ? 'text-slate-900'
                    : 'text-emerald-700'
                }`}
              >
                {result.status}
              </p>
            </div>
          </div>

          {/* Step-Indicator Progress Bar */}
          {result.status === 'Cancelled' ? (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-900">
              <XCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <p className="font-semibold">Waybill Cancelled</p>
                <p>{result.lastKnownLocation}</p>
              </div>
            </div>
          ) : (
            <div className="py-2" aria-label="Parcel delivery progress">
              {/* Desktop Horizontal Stepper */}
              <div className="relative">
                <div
                  className="hidden sm:block absolute top-4 left-6 right-6 h-1 bg-slate-200 rounded-full"
                  aria-hidden="true"
                >
                  <div
                    className="h-full bg-emerald-700 rounded-full transition-all duration-300"
                    style={{ width: `${progressWidthPercent}%` }}
                  />
                </div>

                <ol className="relative grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-3">
                  {TRACKING_STEPS.map((step, idx) => {
                    const isCompleted = idx < activeStepIndex;
                    const isCurrent = idx === activeStepIndex;

                    return (
                      <li
                        key={step.status}
                        className="flex sm:flex-col items-start sm:items-center sm:text-center gap-3 sm:gap-2"
                      >
                        <div
                          className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors border-2 ${
                            isCompleted
                              ? 'bg-emerald-700 border-emerald-700 text-white'
                              : isCurrent
                              ? 'bg-white border-emerald-700 text-emerald-700 ring-4 ring-emerald-100'
                              : 'bg-white border-slate-300 text-slate-400'
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <span>{idx + 1}</span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p
                            className={`text-xs font-bold ${
                              isCurrent || isCompleted ? 'text-slate-900' : 'text-slate-400'
                            }`}
                          >
                            {step.label}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{step.caption}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}

          {/* Last Known Location Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-medium text-slate-500">Last Known Location</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {result.lastKnownLocation}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-medium text-slate-500">Checkpoint Notes</p>
                <p className="text-xs font-medium text-slate-800 mt-0.5">
                  {result.highwayCheckpoint}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
