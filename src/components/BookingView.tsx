import { ArrowRight, Search, Users } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { KENYA_TOWNS, getDefaultTravelDate } from '../data/kenyaTransitData';
import type { Trip, VehicleClassTier } from '../types';

interface BookingViewProps {
  trips: Trip[];
  isLoading: boolean;
  onSelectTrip: (trip: Trip) => void;
  onExploreRoutes: () => void;
}

export const BookingView: React.FC<BookingViewProps> = ({
  trips,
  isLoading,
  onSelectTrip,
  onExploreRoutes,
}) => {
  const [originFilter, setOriginFilter] = useState<string>('All');
  const [destinationFilter, setDestinationFilter] = useState<string>('All');
  const [dateFilter, setDateFilter] = useState<string>(getDefaultTravelDate());
  const [tierFilter, setTierFilter] = useState<'All' | VehicleClassTier>('All');

  const filteredTrips = useMemo(() => {
    return trips.filter((t) => {
      if (t.status === 'Cancelled' || t.status === 'Arrived') return false;
      if (originFilter !== 'All' && t.origin !== originFilter) return false;
      if (destinationFilter !== 'All' && t.destination !== destinationFilter) return false;
      if (tierFilter !== 'All' && t.classTier !== tierFilter) return false;
      if (dateFilter && t.departureDate !== dateFilter && t.departureDate !== getDefaultTravelDate()) {
        return false;
      }
      return true;
    });
  }, [trips, originFilter, destinationFilter, tierFilter, dateFilter]);

  return (
    <div className="space-y-16 pb-20">
      {/* Editorial Hero Split */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 lg:pt-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <div className="space-y-4">
              <p className="text-xs font-medium text-emerald-700">
                Licensed Kenyan PSV Network · Nairobi, Mombasa, Rift Valley &amp; Western
              </p>
              <h1
                className="font-display font-bold tracking-tight text-slate-900 leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.4rem)', textWrap: 'balance' }}
              >
                Guaranteed matatu seats, paid via M-Pesa in seconds.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Reserve exact cabin seats across verified Kenyan SACCOs—no stage queues, no
                overbooking, and instant QR boarding passes verified by stage marshals.
              </p>
            </div>

            {/* Integrated Corridor Search Form */}
            <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Departure Town
                  </label>
                  <select
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    <option value="All">All Terminals</option>
                    {KENYA_TOWNS.map((town) => (
                      <option key={town} value={town}>
                        {town}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Destination
                  </label>
                  <select
                    value={destinationFilter}
                    onChange={(e) => setDestinationFilter(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    <option value="All">All Destinations</option>
                    {KENYA_TOWNS.map((town) => (
                      <option key={town} value={town}>
                        {town}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Travel Date
                  </label>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['All', 'Executive 11', 'Standard 14', 'VIP Coach 33'] as const).map(
                    (tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setTierFilter(tier)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          tierFilter === tier
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tier === 'All' ? 'All Classes' : tier}
                      </button>
                    )
                  )}
                </div>

                <a
                  href="#departures"
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <Search className="w-4 h-4" />
                  Find Departures
                </a>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 relative rounded-xl overflow-hidden border border-slate-200 min-h-[340px] bg-slate-900">
            <img
              src="/src/assets/images/hero_kenya_matatu_1794579725678.jpg"
              alt="Executive Kenyan 14-seater matatu and VIP coach at Nairobi Transit Hub"
              referrerPolicy="no-referrer"
              className="w-full h-full lg:h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent flex flex-col justify-end p-6 sm:p-8">
              <p className="text-xs font-mono text-emerald-300">
                Nairobi Transit Hub · Daily Scheduled Dispatch
              </p>
              <p className="text-base sm:text-lg font-medium text-white mt-1 max-w-md">
                Direct CBD, Westlands, and Expressway boarding with verified NTSA speed-governed
                SACCO fleets.
              </p>
            </div>
          </div>
        </div>

        {/* Full-Width 4-Column Operational Strip Below Hero Split */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Cabin Precision</p>
            <p className="font-display text-lg font-bold text-slate-900 mt-1">
              Exact Seat Selection
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Lock front co-driver, window, or aisle seats across 11, 14, and 33-seater PSVs.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Daraja Checkout</p>
            <p className="font-display text-lg font-bold text-slate-900 mt-1">
              Instant M-Pesa STK
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Paybill &amp; Till prompt straight to your Safaricom or Airtel line with receipt code.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Regulatory Compliance</p>
            <p className="font-display text-lg font-bold text-slate-900 mt-1">
              NTSA 80 km/h Verified
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Every listed vehicle maintains valid TLB licensing, inspection, and speed governor.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Stage Flexibility</p>
            <p className="font-display text-lg font-bold text-slate-900 mt-1">
              CBD &amp; Highway Pickups
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Board at Tea Room, Afya Centre, Railways, Westlands, Mlolongo, or JKIA.
            </p>
          </div>
        </div>
      </section>

      {/* Live Departure Board */}
      <section id="departures" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Live Kenyan Departures
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Real-time seat inventory across North Rift, 2NK, Ena Coach, Super Metro, and Guardian
              Angel.
            </p>
          </div>
          <p className="text-xs font-mono text-slate-500">
            {filteredTrips.length} {filteredTrips.length === 1 ? 'departure' : 'departures'} available
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : filteredTrips.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <p className="font-display text-lg font-semibold text-slate-900">
              No departures match your selected corridor filters
            </p>
            <p className="text-sm text-slate-600">
              Reset your town or class tier filter to view all scheduled Kenyan departures.
            </p>
            <button
              type="button"
              onClick={() => {
                setOriginFilter('All');
                setDestinationFilter('All');
                setTierFilter('All');
                setDateFilter(getDefaultTravelDate());
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Show All Departures
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTrips.map((trip) => (
              <article
                key={trip.id}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 transition-colors grid grid-cols-1 lg:grid-cols-12 gap-5 items-center"
              >
                {/* SACCO & Vehicle */}
                <div className="lg:col-span-3 space-y-1">
                  <h3 className="font-display text-base font-bold text-slate-900">
                    {trip.saccoName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono text-slate-700 font-medium">{trip.plateNumber}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{trip.classTier}</span>
                  </p>
                </div>

                {/* Route & Times */}
                <div className="lg:col-span-5 flex items-center gap-4">
                  <div className="min-w-0">
                    <p className="font-mono text-lg font-bold text-slate-900">
                      {trip.departureTime}
                    </p>
                    <p className="text-sm font-medium text-slate-800 truncate">{trip.origin}</p>
                    <p className="text-xs text-slate-500 truncate">{trip.originStage}</p>
                  </div>

                  <div className="flex-1 flex flex-col items-center px-2">
                    <span className="text-xs font-mono text-slate-500">{trip.durationLabel}</span>
                    <div className="w-full h-px bg-slate-200 my-1.5 relative">
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 absolute right-0 top-1/2 -translate-y-1/2 bg-white" />
                    </div>
                    <span className="text-xs text-slate-500">{trip.status}</span>
                  </div>

                  <div className="min-w-0 text-right">
                    <p className="font-mono text-lg font-bold text-slate-900">
                      {trip.arrivalTime}
                    </p>
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {trip.destination}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{trip.destinationStage}</p>
                  </div>
                </div>

                {/* Seats & Fare CTA */}
                <div className="lg:col-span-4 flex items-center justify-between lg:justify-end gap-5 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                  <div className="text-left lg:text-right">
                    <p className="font-mono text-lg font-bold text-slate-900">
                      KES {trip.fareKes.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-600 flex items-center lg:justify-end gap-1 mt-0.5">
                      <Users className="w-3.5 h-3.5 text-emerald-700" />
                      <span className="font-mono">{trip.availableSeats}</span> seats left
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={trip.availableSeats === 0}
                    onClick={() => onSelectTrip(trip)}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {trip.availableSeats === 0 ? 'Full' : 'Select Seats'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Cabin Standard & Kenyan Corridor Highlights */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Kenyan Fleet Standards &amp; Signature Corridors
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Executive 11-seaters, reliable 14-seater shuttles, and coastal touring coaches.
            </p>
          </div>
          <button
            type="button"
            onClick={onExploreRoutes}
            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            View All Corridors &amp; Fare Calculator
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden">
              <img
                src="/src/assets/images/sacco_luxury_interior_1794579725421.jpg"
                alt="Executive 11-seater Kenyan matatu leather seating and USB ports"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-5 space-y-2 flex-1">
              <p className="text-xs text-slate-500">Executive 11 &amp; VIP Coach</p>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Reclining Cabin Comfort
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Perforated leather seating, individual USB-C power ports, overhead parcel racks,
                and strict no-standing passenger manifest policy.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden">
              <img
                src="/src/assets/images/corridor_rift_valley_1794579725683.jpg"
                alt="Great Rift Valley highway escarpment corridor in Kenya"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-5 space-y-2 flex-1">
              <p className="text-xs text-slate-500">A104 Corridor · Nakuru, Eldoret &amp; Kisumu</p>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Rift Valley &amp; Western Express
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Every Rift Valley shuttle runs calibrated 80 km/h speed governors and dual driver
                logs verified at Gilgil and Salgaa checkpoints.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden">
              <img
                src="/src/assets/images/corridor_nairobi_mombasa_1794579726706.jpg"
                alt="Nairobi to Mombasa highway crossing Tsavo savannah"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-5 space-y-2 flex-1">
              <p className="text-xs text-slate-500">A109 Corridor · Mombasa &amp; Coast</p>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Day &amp; Night Coastal Coaches
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Morning and overnight departures connecting Nairobi CBD, JKIA Junction, and
                Mlolongo directly to Voi and Mwembe Tayari.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
