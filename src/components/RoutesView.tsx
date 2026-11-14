import { ArrowRight, Calculator, Loader2, MapPin } from 'lucide-react';
import React, { useState } from 'react';
import { KENYA_CORRIDORS, KENYA_TOWNS } from '../data/kenyaTransitData';
import type { RouteQuote, VehicleClassTier } from '../types';

interface RoutesViewProps {
  onJumpToBook: () => void;
}

export const RoutesView: React.FC<RoutesViewProps> = ({ onJumpToBook }) => {
  const [origin, setOrigin] = useState<string>('Nairobi');
  const [destination, setDestination] = useState<string>('Mombasa');
  const [classTier, setClassTier] = useState<VehicleClassTier>('Executive 11');
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCalculateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (origin === destination) {
      setErrorMsg('Origin and destination towns must be different.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/routes/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, classTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not compute fare quote.');
      setQuote(data as RouteQuote);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Quote calculation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">
            Kenyan Intercity Corridors &amp; Boarding Stages
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Official highway routes, CBD &amp; Expressway stage pickups, and live backend fare
            breakdowns inclusive of NTSA safety levy.
          </p>
        </div>
        <button
          type="button"
          onClick={onJumpToBook}
          className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          Book a Departure
        </button>
      </div>

      {/* Interactive Backend Fare & Expressway Toll Calculator */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center gap-2 text-slate-900">
              <Calculator className="w-5 h-5 text-emerald-700" />
              <h2 className="font-display text-xl font-bold">Official Fare &amp; Levy Calculator</h2>
            </div>
            <p className="text-sm text-slate-600">
              Compute transparent per-seat pricing including Nairobi Expressway viaduct toll,
              cabin class multiplier, and baggage allowance directly from the Msafiri pricing API.
            </p>

            <form onSubmit={handleCalculateQuote} className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Origin</label>
                  <select
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
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
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
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
                  Vehicle Cabin Class
                </label>
                <select
                  value={classTier}
                  onChange={(e) => setClassTier(e.target.value as VehicleClassTier)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg"
                >
                  <option value="Standard 14">Standard 14-Seater Shuttle</option>
                  <option value="Executive 11">Executive 11-Seater Van</option>
                  <option value="VIP Coach 33">VIP 33-Seater Coach</option>
                </select>
              </div>

              {errorMsg && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Calculate Official Fare
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-xl p-6">
            {quote ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <p className="text-xs text-slate-500">Calculated Corridor</p>
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      {quote.origin} to {quote.destination} · {quote.classTier}
                    </h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Distance / Est. Time</p>
                    <p className="font-mono text-sm font-semibold text-slate-900">
                      {quote.distanceKm} km · {quote.durationLabel}
                    </p>
                  </div>
                </div>

                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Base Corridor Fare</dt>
                    <dd className="font-mono text-slate-900">
                      KES {quote.baseFareKes.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">
                      Cabin Multiplier ({quote.tierMultiplier.toFixed(2)}x)
                    </dt>
                    <dd className="font-mono text-slate-900">
                      KES {Math.round(quote.baseFareKes * quote.tierMultiplier).toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Expressway / Bypass Toll</dt>
                    <dd className="font-mono text-slate-900">
                      KES {quote.expresswayTollKes.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">NTSA Road Safety &amp; Manifest Levy</dt>
                    <dd className="font-mono text-slate-900">
                      KES {quote.ntsaSafetyLevyKes.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Checked Luggage Allowance</dt>
                    <dd className="font-mono text-slate-900">{quote.baggageAllowanceKg} kg</dd>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-slate-200 text-base font-bold">
                    <dt className="text-slate-900">Total Per Seat</dt>
                    <dd className="font-mono text-emerald-700">
                      KES {quote.totalPerSeatKes.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="h-full min-h-[210px] flex flex-col items-center justify-center text-center space-y-2 text-slate-500">
                <p className="font-medium text-slate-800">
                  Select a Kenyan corridor to view itemized fare breakdown
                </p>
                <p className="text-xs max-w-sm">
                  Quotes dynamically factor highway distance, Nairobi Expressway tolls, cabin tier,
                  and checked luggage limits.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Corridor Directory Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {KENYA_CORRIDORS.map((corridor) => (
          <article
            key={corridor.id}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500">{corridor.highway}</p>
                <h3 className="font-display text-xl font-bold text-slate-900 mt-0.5 flex items-center gap-2">
                  <span>{corridor.origin}</span>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                  <span>{corridor.destination}</span>
                </h3>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-base font-bold text-emerald-700">
                  From KES {corridor.baseFareKes.toLocaleString()}
                </p>
                <p className="text-xs font-mono text-slate-500">
                  {corridor.distanceKm} km · {corridor.durationLabel}
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-600">{corridor.highlights}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
              <div>
                <p className="font-semibold text-slate-800 mb-1.5 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                  Pickup Stages
                </p>
                <ul className="space-y-1 text-slate-600">
                  {corridor.pickupStages.map((st) => (
                    <li key={st}>{st}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-slate-800 mb-1.5 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  Dropoff Stages
                </p>
                <ul className="space-y-1 text-slate-600">
                  {corridor.dropoffStages.map((st) => (
                    <li key={st}>{st}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
};
