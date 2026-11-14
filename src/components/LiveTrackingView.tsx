import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Clock,
  Compass,
  ExternalLink,
  Gauge,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LatLngPoint,
  LiveTelemetryPoint,
  MapsGroundingResponse,
  Trip,
} from '../types';

interface LiveTrackingViewProps {
  trips: Trip[];
  initialTripId?: string | null;
  isAdmin: boolean;
  hasAdminSession: boolean;
  onSelectTripForBooking: (trip: Trip) => void;
}

interface LatLngBoundsLiteralLike {
  east: number;
  north: number;
  south: number;
  west: number;
}

interface LatLngBoundsLike {
  toJSON: () => LatLngBoundsLiteralLike;
}

interface PolylineInstance {
  setMap: (map: unknown) => void;
  setOptions: (opts: { strokeColor?: string; strokeWeight?: number; strokeOpacity?: number }) => void;
  getPath?: () => { getArray: () => Array<{ lat: () => number; lng: () => number }> };
}

interface ComputedRouteSummary {
  distanceMeters: number;
  durationMillis: number;
  pathCoords: LatLngPoint[];
  boundsLiteral: LatLngBoundsLiteralLike | null;
}

interface CorridorRouteLayerProps {
  tripId: string;
  origin: LatLngPoint;
  destination: LatLngPoint;
  onRouteComputed: (summary: { distanceMeters: number; durationMillis: number } | null) => void;
  onRouteError: (message: string | null) => void;
}

const CorridorRouteLayer: React.FC<CorridorRouteLayerProps> = ({
  tripId,
  origin,
  destination,
  onRouteComputed,
  onRouteError,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');
  const polylinesRef = useRef<PolylineInstance[]>([]);
  const routeCacheRef = useRef<Record<string, ComputedRouteSummary>>({});

  useEffect(() => {
    if (!routesLib || !map || !tripId) return;

    let cancelled = false;

    const clearPolylines = () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };

    clearPolylines();
    onRouteError(null);

    const cacheKey = `${tripId}:${origin.lat},${origin.lng}->${destination.lat},${destination.lng}`;
    const cached = routeCacheRef.current[cacheKey];

    if (cached && cached.pathCoords.length > 0 && mapsLib?.Polyline) {
      const polyline = new (mapsLib.Polyline as unknown as new (opts: {
        path: LatLngPoint[];
        strokeColor: string;
        strokeWeight: number;
        strokeOpacity: number;
      }) => PolylineInstance)({
        path: cached.pathCoords,
        strokeColor: '#047857',
        strokeWeight: 5,
        strokeOpacity: 0.9,
      });
      polyline.setMap(map);
      polylinesRef.current = [polyline];
      if (cached.boundsLiteral) {
        map.fitBounds(cached.boundsLiteral, { top: 48, right: 48, bottom: 48, left: 48 });
      }
      onRouteComputed({
        distanceMeters: cached.distanceMeters,
        durationMillis: cached.durationMillis,
      });
      return () => {
        clearPolylines();
      };
    }

    const request = {
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    };

    (routesLib.Route as unknown as {
      computeRoutes: (req: typeof request) => Promise<{ routes: Array<Record<string, unknown>> }>;
    })
      .computeRoutes(request)
      .then(({ routes }) => {
        if (cancelled) return;
        if (!routes || routes.length === 0) {
          onRouteError('No driving route returned for this corridor.');
          onRouteComputed(null);
          return;
        }

        const primaryRoute = routes[0] as {
          createPolylines: () => PolylineInstance[];
          viewport?: LatLngBoundsLike;
          distanceMeters?: number;
          durationMillis?: number;
        };

        const newPolylines = primaryRoute.createPolylines();
        const extractedCoords: LatLngPoint[] = [];

        newPolylines.forEach((polyline) => {
          polyline.setOptions({
            strokeColor: '#047857',
            strokeWeight: 5,
            strokeOpacity: 0.9,
          });
          polyline.setMap(map);
          const pathArr = polyline.getPath?.()?.getArray() || [];
          pathArr.forEach((pt) => {
            extractedCoords.push({ lat: pt.lat(), lng: pt.lng() });
          });
        });

        polylinesRef.current = newPolylines;

        let boundsLiteral: LatLngBoundsLiteralLike | null = null;
        if (primaryRoute.viewport) {
          map.fitBounds(
            primaryRoute.viewport as unknown as Parameters<typeof map.fitBounds>[0],
            {
              top: 48,
              right: 48,
              bottom: 48,
              left: 48,
            }
          );
          boundsLiteral = primaryRoute.viewport.toJSON();
        }

        const summary = {
          distanceMeters: primaryRoute.distanceMeters ?? 0,
          durationMillis: primaryRoute.durationMillis ?? 0,
        };

        if (extractedCoords.length > 0) {
          routeCacheRef.current[cacheKey] = {
            ...summary,
            pathCoords: extractedCoords,
            boundsLiteral,
          };
        }

        onRouteComputed(summary);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err || 'Failed to compute route.');
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429') ||
          msg.includes('Quota')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteError(msg);
      });

    return () => {
      cancelled = true;
      clearPolylines();
    };
  }, [routesLib, mapsLib, map, tripId, origin.lat, origin.lng, destination.lat, destination.lng, onRouteComputed, onRouteError]);

  return null;
};

interface MatatuMapCanvasProps {
  telemetry: LiveTelemetryPoint;
  userLocation: LatLngPoint | null;
  onRouteComputed: (summary: { distanceMeters: number; durationMillis: number } | null) => void;
  onRouteError: (message: string | null) => void;
}

const MatatuMapCanvas: React.FC<MatatuMapCanvasProps> = ({
  telemetry,
  userLocation,
  onRouteComputed,
  onRouteError,
}) => {
  const [vehicleMarkerRef, vehicleMarker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState<boolean>(true);

  useEffect(() => {
    setInfoOpen(true);
  }, [telemetry.tripId]);

  return (
    <GoogleMap
      mapId="DEMO_MAP_ID"
      defaultCenter={telemetry.currentCoords}
      defaultZoom={7}
      gestureHandling="greedy"
      streetViewControl={false}
      mapTypeControl={false}
      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      className="w-full h-full"
    >
      <CorridorRouteLayer
        tripId={telemetry.tripId}
        origin={telemetry.originCoords}
        destination={telemetry.destinationCoords}
        onRouteComputed={onRouteComputed}
        onRouteError={onRouteError}
      />

      {/* Origin Stage Pin */}
      <AdvancedMarker
        position={telemetry.originCoords}
        title={`Origin: ${telemetry.originStage}`}
      >
        <Pin background="#0f172a" borderColor="#020617" glyphColor="#ffffff" scale={0.95} />
      </AdvancedMarker>

      {/* Destination Stage Pin */}
      <AdvancedMarker
        position={telemetry.destinationCoords}
        title={`Destination: ${telemetry.destinationStage}`}
      >
        <Pin background="#b45309" borderColor="#78350f" glyphColor="#ffffff" scale={0.95} />
      </AdvancedMarker>

      {/* Live Matatu Vehicle Marker */}
      <AdvancedMarker
        ref={vehicleMarkerRef}
        position={telemetry.currentCoords}
        onClick={() => setInfoOpen((prev) => !prev)}
        title={`${telemetry.plateNumber} · ${telemetry.saccoName}`}
        zIndex={50}
      >
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-700 text-white border-2 border-white shadow-md">
          <Navigation
            className="w-3.5 h-3.5 shrink-0"
            style={{ transform: `rotate(${telemetry.headingDeg}deg)` }}
          />
          <span className="font-mono text-xs font-bold tracking-wide whitespace-nowrap">
            {telemetry.plateNumber}
          </span>
        </div>
      </AdvancedMarker>

      {infoOpen && vehicleMarker && (
        <InfoWindow
          anchor={vehicleMarker}
          maxWidth={270}
          onCloseClick={() => setInfoOpen(false)}
        >
          <div className="p-1 space-y-1.5 text-slate-900">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-emerald-800">
                {telemetry.plateNumber}
              </span>
              <span className="text-[11px] font-medium text-slate-600">
                {telemetry.status}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-900">{telemetry.saccoName}</p>
            <p className="text-xs text-slate-600">{telemetry.currentSector}</p>
            <div className="pt-1 border-t border-slate-200 flex items-center justify-between text-[11px] font-mono text-slate-700">
              <span>{telemetry.speedKmh} km/h</span>
              <span>Next: {telemetry.nextStage}</span>
            </div>
          </div>
        </InfoWindow>
      )}

      {/* Optional Passenger Shared Location Pin */}
      {userLocation && (
        <AdvancedMarker position={userLocation} title="Your Shared Location">
          <Pin background="#0284c7" borderColor="#0369a1" glyphColor="#ffffff" scale={1.0} />
        </AdvancedMarker>
      )}
    </GoogleMap>
  );
};

export const LiveTrackingView: React.FC<LiveTrackingViewProps> = ({
  trips,
  initialTripId,
  isAdmin,
  hasAdminSession,
  onSelectTripForBooking,
}) => {
  const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const [mapsApiKey, setMapsApiKey] = useState<string>(envKey);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(!envKey);

  const [telemetryList, setTelemetryList] = useState<LiveTelemetryPoint[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>(initialTripId || '');
  const [loadingTelemetry, setLoadingTelemetry] = useState<boolean>(true);
  const [routeSummary, setRouteSummary] = useState<{
    distanceMeters: number;
    durationMillis: number;
  } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [userLocation, setUserLocation] = useState<LatLngPoint | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);

  const [groundingQuery, setGroundingQuery] = useState<string>('');
  const [groundingLoading, setGroundingLoading] = useState<boolean>(false);
  const [groundingError, setGroundingError] = useState<string | null>(null);
  const [groundingResult, setGroundingResult] = useState<MapsGroundingResponse | null>(null);

  const [adminUpdating, setAdminUpdating] = useState<boolean>(false);

  useEffect(() => {
    if (initialTripId) {
      setSelectedTripId(initialTripId);
    }
  }, [initialTripId]);

  useEffect(() => {
    if (envKey) {
      setMapsApiKey(envKey);
      setLoadingConfig(false);
      return;
    }
    fetch('/api/maps/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { apiKey?: string } | null) => {
        if (data?.apiKey) setMapsApiKey(data.apiKey);
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, [envKey]);

  const fetchLiveTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/tracking/live');
      if (!res.ok) return;
      const data = (await res.json()) as { telemetry?: LiveTelemetryPoint[] };
      if (data.telemetry && data.telemetry.length > 0) {
        setTelemetryList(data.telemetry);
        setSelectedTripId((prev) => {
          if (prev && data.telemetry?.some((t) => t.tripId === prev)) return prev;
          const boardedOrDeparted =
            data.telemetry?.find((t) => t.status === 'Departed' || t.status === 'Boarding') ||
            data.telemetry?.[0];
          return boardedOrDeparted?.tripId || '';
        });
      }
    } catch {
      // Ignore transient telemetry polling error
    } finally {
      setLoadingTelemetry(false);
    }
  }, []);

  useEffect(() => {
    void fetchLiveTelemetry();
    const timer = window.setInterval(() => {
      void fetchLiveTelemetry();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchLiveTelemetry]);

  const selectedTelemetry = useMemo(() => {
    return (
      telemetryList.find((t) => t.tripId === selectedTripId) || telemetryList[0] || null
    );
  }, [telemetryList, selectedTripId]);

  const selectedTripObj = useMemo(() => {
    if (!selectedTelemetry) return null;
    return trips.find((t) => t.id === selectedTelemetry.tripId) || null;
  }, [trips, selectedTelemetry]);

  const handleRequestLocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus('Geolocation is not supported by this browser.');
      return;
    }
    setGeoLoading(true);
    setGeoStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setGeoLoading(false);
        setGeoStatus('Location shared for nearby stage & grounding lookup.');
      },
      (err) => {
        setGeoLoading(false);
        setGeoStatus(err.message || 'Location permission declined.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleClearLocation = () => {
    setUserLocation(null);
    setGeoStatus(null);
  };

  const runMapsGroundingQuery = async (promptText: string) => {
    const clean = promptText.trim();
    if (!clean) return;
    setGroundingQuery(clean);
    setGroundingLoading(true);
    setGroundingError(null);

    const anchorCoords = userLocation || selectedTelemetry?.currentCoords;

    try {
      const res = await fetch('/api/maps/grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: clean,
          lat: anchorCoords?.lat,
          lng: anchorCoords?.lng,
          origin: selectedTelemetry?.origin,
          destination: selectedTelemetry?.destination,
        }),
      });

      const data = (await res.json()) as MapsGroundingResponse & { error?: string };
      if (!res.ok) {
        if (
          res.status === 429 ||
          String(data.error || '').includes('RESOURCE_EXHAUSTED') ||
          String(data.error || '').includes('Quota')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setGroundingError(data.error || 'Could not load corridor place data.');
        return;
      }

      setGroundingResult(data);
    } catch {
      setGroundingError('Network error while querying Google Maps grounding.');
    } finally {
      setGroundingLoading(false);
    }
  };

  const handleAdminAdvancePing = async () => {
    if (!selectedTelemetry || !isAdmin || !hasAdminSession) return;
    setAdminUpdating(true);
    try {
      const nextProgress =
        selectedTelemetry.progressPercent >= 88
          ? 12
          : selectedTelemetry.progressPercent + 15;
      const res = await fetch('/api/tracking/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tripId: selectedTelemetry.tripId,
          progressPercent: nextProgress,
          speedKmh: 74,
          status: 'Departed',
        }),
      });
      if (res.ok) {
        await fetchLiveTelemetry();
      }
    } finally {
      setAdminUpdating(false);
    }
  };

  const formatDuration = (millis: number) => {
    const totalMin = Math.round(millis / 60000);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-emerald-700">
            GPS Corridor Telemetry · NTSA 80 km/h Speed Governor Feed
          </p>
          <h1 className="font-display text-3xl font-bold text-slate-900 mt-1">
            Live Kenyan Matatu Tracking
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Follow scheduled SACCO departures across Kenyan highways, inspect real-time routes,
            and locate boarding stages using Google Maps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {userLocation ? (
            <button
              type="button"
              onClick={handleClearLocation}
              className="px-3.5 py-2 text-xs font-medium text-sky-800 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-lg transition-colors inline-flex items-center gap-1.5"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              Location Shared (Clear)
            </button>
          ) : (
            <button
              type="button"
              disabled={geoLoading}
              onClick={handleRequestLocation}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors inline-flex items-center gap-1.5"
            >
              <LocateFixed className="w-3.5 h-3.5 text-emerald-700" />
              {geoLoading ? 'Locating...' : 'Share My Stage Location'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void fetchLiveTelemetry()}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh GPS
          </button>
        </div>
      </div>

      {geoStatus && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-700">
          {geoStatus}
        </div>
      )}

      {/* Main Map + Fleet Selector Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive Google Map */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="h-[480px] w-full bg-slate-100 relative">
              {loadingConfig || loadingTelemetry ? (
                <div className="w-full h-full flex items-center justify-center text-sm text-slate-500">
                  Initializing live Kenyan corridor map...
                </div>
              ) : !mapsApiKey ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center space-y-2">
                  <MapPin className="w-8 h-8 text-slate-400" />
                  <p className="font-display text-base font-bold text-slate-900">
                    Google Maps API Key Pending
                  </p>
                  <p className="text-xs text-slate-600 max-w-md">
                    Configure <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in
                    environment secrets to render the interactive Kenyan matatu corridor map.
                  </p>
                </div>
              ) : !selectedTelemetry ? (
                <div className="w-full h-full flex items-center justify-center text-sm text-slate-500">
                  No active departures available for tracking.
                </div>
              ) : (
                <APIProvider apiKey={mapsApiKey} language="en" region="KE">
                  <MatatuMapCanvas
                    telemetry={selectedTelemetry}
                    userLocation={userLocation}
                    onRouteComputed={setRouteSummary}
                    onRouteError={setRouteError}
                  />
                </APIProvider>
              )}
            </div>

            {selectedTelemetry && (
              <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                    <Gauge className="w-3.5 h-3.5 text-emerald-700" />
                    Governed Speed
                  </p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5">
                    {selectedTelemetry.speedKmh} km/h
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                    <Compass className="w-3.5 h-3.5 text-emerald-700" />
                    Corridor Progress
                  </p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5">
                    {selectedTelemetry.progressPercent}% complete
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                    Route Distance
                  </p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5">
                    {routeSummary
                      ? `${(routeSummary.distanceMeters / 1000).toFixed(1)} km`
                      : 'Computing...'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-emerald-700" />
                    Est. Remaining
                  </p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5">
                    {routeSummary
                      ? `${formatDuration(
                          Math.max(
                            60000,
                            routeSummary.durationMillis *
                              (1 - selectedTelemetry.progressPercent / 100)
                          )
                        )}`
                      : `${selectedTelemetry.etaMinutesRemaining}m`}
                  </p>
                </div>
              </div>
            )}
          </div>

          {routeError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800">
              Route notice: {routeError}
            </div>
          )}
        </div>

        {/* Right: Active Vehicle List & Telemetry Details */}
        <aside className="lg:col-span-4 space-y-4">
          {selectedTelemetry && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs text-slate-500">{selectedTelemetry.saccoName}</p>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {selectedTelemetry.origin} → {selectedTelemetry.destination}
                  </h2>
                </div>
                <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {selectedTelemetry.plateNumber}
                </span>
              </div>

              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Current Sector</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {selectedTelemetry.currentSector}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Next Scheduled Stage</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {selectedTelemetry.nextStage}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">GPS Coordinates</dt>
                  <dd className="font-mono text-slate-700 text-right">
                    {selectedTelemetry.currentCoords.lat.toFixed(4)},{' '}
                    {selectedTelemetry.currentCoords.lng.toFixed(4)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Assigned Driver</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {selectedTelemetry.driverName}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">NTSA Governor</dt>
                  <dd className="font-medium text-emerald-700 inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Calibrated 80 km/h
                  </dd>
                </div>
              </dl>

              <div className="pt-2 flex flex-col gap-2">
                {selectedTripObj && selectedTripObj.availableSeats > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectTripForBooking(selectedTripObj)}
                    className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                  >
                    Book Seat on {selectedTelemetry.plateNumber} ({selectedTripObj.availableSeats}{' '}
                    left)
                  </button>
                )}

                {isAdmin && hasAdminSession && (
                  <button
                    type="button"
                    disabled={adminUpdating}
                    onClick={handleAdminAdvancePing}
                    className="w-full py-2 px-4 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors"
                  >
                    {adminUpdating
                      ? 'Updating GPS Ping...'
                      : 'Admin: Advance Vehicle Ping (+15%)'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Active Departures Selector */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Tracked SACCO Departures
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                {telemetryList.length} active
              </span>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {telemetryList.map((item) => {
                const isSelected = selectedTelemetry?.tripId === item.tripId;
                return (
                  <button
                    key={item.tripId}
                    type="button"
                    onClick={() => setSelectedTripId(item.tripId)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-emerald-700 bg-emerald-50/70'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {item.plateNumber}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${
                          item.status === 'Departed'
                            ? 'text-emerald-700'
                            : item.status === 'Boarding'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {item.status} · {item.speedKmh} km/h
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800 mt-1">
                      {item.origin} → {item.destination}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {item.saccoName} · {item.progressPercent}%
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      {/* Gemini Maps Grounding: Stage & Highway Stop Finder */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Powered by Google Maps Grounding
            </p>
            <h2 className="font-display text-xl font-bold text-slate-900 mt-1">
              Corridor Stage, Terminal &amp; Highway Stop Lookup
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Ask for live Google Maps place details on Kenyan matatu stages, highway rest stops,
              or nearby terminals.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runMapsGroundingQuery(groundingQuery);
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={groundingQuery}
              onChange={(e) => setGroundingQuery(e.target.value)}
              placeholder={
                selectedTelemetry
                  ? `e.g. Where is ${selectedTelemetry.originStage} or highway fuel & rest stops toward ${selectedTelemetry.destination}?`
                  : 'Ask about Nairobi matatu terminals, highway stages, or rest stops...'
              }
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>
          <button
            type="submit"
            disabled={groundingLoading || !groundingQuery.trim()}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            {groundingLoading ? 'Searching Maps...' : 'Lookup Places'}
          </button>
        </form>

        {/* Quick Grounding Prompts */}
        {selectedTelemetry && (
          <div className="flex flex-wrap gap-2">
            {[
              `Directions and landmarks near ${selectedTelemetry.originStage}, ${selectedTelemetry.origin}`,
              `Highway rest stops and fuel stations between ${selectedTelemetry.origin} and ${selectedTelemetry.destination}`,
              `Matatu drop-off landmarks at ${selectedTelemetry.destinationStage}, ${selectedTelemetry.destination}`,
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => void runMapsGroundingQuery(sample)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-left"
              >
                {sample}
              </button>
            ))}
          </div>
        )}

        {groundingError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 text-xs text-red-800">
            {groundingError}
          </div>
        )}

        {groundingResult && (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
              {groundingResult.text}
            </div>

            {groundingResult.sources.length > 0 && (
              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-slate-700">
                  Verified Google Maps Places &amp; Sources
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {groundingResult.sources.map((src) => (
                    <a
                      key={src.uri}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3.5 rounded-lg border border-slate-200 hover:border-emerald-700 bg-slate-50 hover:bg-emerald-50/40 transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">{src.title}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      </div>
                      {src.reviewSnippets && src.reviewSnippets.length > 0 && (
                        <p className="text-[11px] text-slate-600 line-clamp-2">
                          “{src.reviewSnippets[0]}”
                        </p>
                      )}
                      <p className="text-[11px] font-medium text-emerald-700">
                        Open in Google Maps
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
