import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  KENYA_CORRIDORS,
  KENYA_SACCOS,
  KENYA_VEHICLES,
  buildSeedTrips,
} from './src/data/kenyaTransitData.ts';
import type {
  Booking,
  LatLngPoint,
  LiveTelemetryPoint,
  MapsGroundingSource,
  MpesaStkResponse,
  NtsaPlateReport,
  Parcel,
  RouteQuote,
  TicketVerificationResult,
  Trip,
  VehicleClassTier,
} from './src/types.ts';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'msafiri_server_db.json');
const TICKET_SIGNING_SECRET = process.env.TICKET_SECRET || 'msafiri-ke-psv-hmac-2026-key';
const DEFAULT_SETTLEMENT_PHONE = '254112898591';
const ADMIN_EMAIL = 'khaneribrian@gmail.com';
const ADMIN_PASSWORD_SALT = 'msafiri_admin_salt_2026';
const ADMIN_PASSWORD_SCRYPT_HEX =
  '88dc3c3f0fd515fef2fc390a1faf6c0d743e9b953839a575b611a83890b47e46b304b2d6af9169f66120c1211c027aedc7afd1889b64d1088e3fc565a50e2b63';
const ADMIN_COOKIE_NAME = 'msafiri_admin_session';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || TICKET_SIGNING_SECRET;

interface StoredMpesaTx extends MpesaStkResponse {
  createdAtMs: number;
  lastQueriedAtMs?: number;
  lastQueryRaw?: string;
  accountRef: string;
  b2cConversationId?: string;
}

interface LiveTrackOverride {
  progress: number;
  speedKmh: number;
  paused?: boolean;
  updatedAtMs: number;
}

interface ServerDb {
  trips: Trip[];
  vehicles?: typeof KENYA_VEHICLES;
  bookings: Booking[];
  parcels: Parcel[];
  mpesaTransactions: Record<string, StoredMpesaTx>;
  verifiedScans: Array<{ ticketRef: string; verifiedAt: string; plateNumber: string }>;
  liveTracking?: Record<string, LiveTrackOverride>;
}

const KENYA_TOWN_COORDS: Record<string, LatLngPoint> = {
  Nairobi: { lat: -1.286389, lng: 36.817223 },
  Mombasa: { lat: -4.043477, lng: 39.668206 },
  Kisumu: { lat: -0.091702, lng: 34.767956 },
  Nakuru: { lat: -0.303099, lng: 36.080026 },
  Eldoret: { lat: 0.514277, lng: 35.26978 },
  Nyeri: { lat: -0.416667, lng: 36.95 },
  Nanyuki: { lat: 0.016667, lng: 37.0728 },
  Kisii: { lat: -0.677334, lng: 34.779603 },
  Kericho: { lat: -0.367742, lng: 35.283141 },
  Naivasha: { lat: -0.717178, lng: 36.431026 },
  'JKIA Airport': { lat: -1.319167, lng: 36.927778 },
};

const CORRIDOR_WAYPOINTS: Record<
  string,
  Array<{ name: string; lat: number; lng: number }>
> = {
  'Nairobi->Eldoret': [
    { name: 'Moi Avenue Terminal, Nairobi', lat: -1.2833, lng: 36.8233 },
    { name: 'Westlands & Kangemi A104', lat: -1.2647, lng: 36.7586 },
    { name: 'Mai Mahiu / Viewpoint Escarpment', lat: -0.9858, lng: 36.5882 },
    { name: 'Naivasha Highway Junction', lat: -0.7172, lng: 36.431 },
    { name: 'Gilgil Weighbridge', lat: -0.4936, lng: 36.3175 },
    { name: 'Nakuru Town Bypass', lat: -0.2896, lng: 36.066 },
    { name: 'Salgaa Checkpoint', lat: -0.1755, lng: 35.8384 },
    { name: 'Timboroa Summit', lat: 0.0686, lng: 35.5469 },
    { name: 'Burnt Forest Stage', lat: 0.2143, lng: 35.4301 },
    { name: 'Eldoret Main Stage', lat: 0.5143, lng: 35.2698 },
  ],
  'Nairobi->Nakuru': [
    { name: 'Tea Room CBD, Nairobi', lat: -1.2819, lng: 36.8277 },
    { name: 'Westlands Stage', lat: -1.2647, lng: 36.8019 },
    { name: 'Limuru Uplands', lat: -1.1066, lng: 36.6425 },
    { name: 'Naivasha Junction', lat: -0.7172, lng: 36.431 },
    { name: 'Gilgil Stage', lat: -0.4936, lng: 36.3175 },
    { name: 'Nakuru Main Stage', lat: -0.3031, lng: 36.08 },
  ],
  'Nairobi->Mombasa': [
    { name: 'Railways Terminal CBD', lat: -1.2907, lng: 36.8273 },
    { name: 'Mlolongo Expressway Gate', lat: -1.3944, lng: 36.9428 },
    { name: 'Machakos Junction', lat: -1.5944, lng: 37.1394 },
    { name: 'Sultan Hamud', lat: -2.0196, lng: 37.3672 },
    { name: 'Mtito Andei Highway Stop', lat: -2.6897, lng: 38.1656 },
    { name: 'Voi Town Terminal', lat: -3.3961, lng: 38.5561 },
    { name: 'Mariakani Stage', lat: -3.8617, lng: 39.4733 },
    { name: 'Mwembe Tayari Terminal, Mombasa', lat: -4.0547, lng: 39.6636 },
  ],
  'Nairobi->Kisumu': [
    { name: 'Railways Terminal CBD', lat: -1.2907, lng: 36.8273 },
    { name: 'Kikuyu Bypass', lat: -1.2464, lng: 36.6626 },
    { name: 'Naivasha Highway', lat: -0.7172, lng: 36.431 },
    { name: 'Nakuru West Bypass', lat: -0.2896, lng: 36.048 },
    { name: 'Kericho Tea Highlands', lat: -0.3677, lng: 35.2831 },
    { name: 'Ahero Junction', lat: -0.1753, lng: 34.9183 },
    { name: 'Kisumu Jubilee Stage', lat: -0.0917, lng: 34.768 },
  ],
  'Nairobi->Nanyuki': [
    { name: 'Tea Room CBD, Nairobi', lat: -1.2819, lng: 36.8277 },
    { name: 'Thika Road Mall', lat: -1.2195, lng: 36.8891 },
    { name: 'Kenol Highway Junction', lat: -0.9277, lng: 37.1277 },
    { name: 'Karatina Stage', lat: -0.4833, lng: 37.1333 },
    { name: 'Nyeri Town Stage', lat: -0.4167, lng: 36.95 },
    { name: 'Nanyuki Main Stage', lat: 0.0167, lng: 37.0728 },
  ],
  'Nairobi->JKIA Airport': [
    { name: 'Westlands Stage', lat: -1.2647, lng: 36.8019 },
    { name: 'Museum Hill Expressway Toll', lat: -1.2743, lng: 36.8147 },
    { name: 'Capital Centre Viaduct', lat: -1.3095, lng: 36.8351 },
    { name: 'JKIA Terminal 1A', lat: -1.3192, lng: 36.9278 },
  ],
};

function computeBearingDeg(a: LatLngPoint, b: LatLngPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
}

function getDurationMinutesEstimate(origin: string, destination: string): number {
  const corridor = KENYA_CORRIDORS.find(
    (c) =>
      (c.origin.toLowerCase() === origin.toLowerCase() &&
        c.destination.toLowerCase() === destination.toLowerCase()) ||
      (c.destination.toLowerCase() === origin.toLowerCase() &&
        c.origin.toLowerCase() === destination.toLowerCase())
  );
  if (!corridor) return 240;
  return Math.round((corridor.distanceKm / 68) * 60);
}

function buildTripTelemetry(
  trip: Trip,
  db: ServerDb,
  nowMs: number
): LiveTelemetryPoint {
  const key = `${trip.origin}->${trip.destination}`;
  const fallbackOrigin = KENYA_TOWN_COORDS[trip.origin] || KENYA_TOWN_COORDS.Nairobi;
  const fallbackDest = KENYA_TOWN_COORDS[trip.destination] || KENYA_TOWN_COORDS.Mombasa;
  const waypoints = CORRIDOR_WAYPOINTS[key] || [
    { name: trip.originStage, lat: fallbackOrigin.lat, lng: fallbackOrigin.lng },
    { name: trip.destinationStage, lat: fallbackDest.lat, lng: fallbackDest.lng },
  ];

  const vehicle = (db.vehicles || KENYA_VEHICLES).find((v) => v.id === trip.vehicleId);
  const driverName = vehicle?.driverName || 'Assigned SACCO Driver';
  const override = db.liveTracking?.[trip.id];

  // Calculate baseline deterministic progress so vehicles appear cleanly positioned on corridor
  let progress = 0;
  let speedKmh = 0;

  if (override) {
    if (override.paused || trip.status === 'Boarding' || trip.status === 'Scheduled') {
      progress = Math.max(0, Math.min(1, override.progress));
      speedKmh = trip.status === 'Departed' ? override.speedKmh : 0;
    } else {
      const elapsedSec = Math.max(0, (nowMs - override.updatedAtMs) / 1000);
      progress = (override.progress + elapsedSec * 0.0022) % 0.96;
      speedKmh = override.speedKmh;
    }
  } else if (trip.status === 'Arrived') {
    progress = 1;
    speedKmh = 0;
  } else if (trip.status === 'Boarding') {
    progress = 0.04;
    speedKmh = 0;
  } else if (trip.status === 'Departed') {
    const hash = trip.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const phase = ((nowMs / 1000) * 0.0022 + (hash % 60) / 100) % 0.92;
    progress = Math.max(0.08, phase);
    speedKmh = 68 + Math.round(Math.sin(nowMs / 7000 + hash) * 5 + 5); // 68 - 78 km/h (NTSA <= 80)
  } else {
    // Scheduled — subtly staggered along staging / dispatch preview
    const hash = trip.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const phase = ((nowMs / 1000) * 0.0014 + (hash % 75) / 100) % 0.85;
    progress = Math.max(0.06, phase);
    speedKmh = 64 + Math.round(Math.cos(nowMs / 9000 + hash) * 6 + 6); // 64 - 76 km/h (NTSA <= 80)
  }

  speedKmh = Math.min(80, Math.max(0, speedKmh));

  const segments = Math.max(1, waypoints.length - 1);
  const scaled = progress * segments;
  const segIndex = Math.min(segments - 1, Math.floor(scaled));
  const localT = scaled - segIndex;

  const p1 = waypoints[segIndex];
  const p2 = waypoints[Math.min(waypoints.length - 1, segIndex + 1)];

  const currentCoords: LatLngPoint = {
    lat: Number((p1.lat + (p2.lat - p1.lat) * localT).toFixed(6)),
    lng: Number((p1.lng + (p2.lng - p1.lng) * localT).toFixed(6)),
  };

  const headingDeg = computeBearingDeg(
    { lat: p1.lat, lng: p1.lng },
    { lat: p2.lat, lng: p2.lng }
  );
  const totalEstMin = getDurationMinutesEstimate(trip.origin, trip.destination);
  const etaMinutesRemaining = Math.max(
    1,
    Math.round(totalEstMin * (1 - progress))
  );

  return {
    tripId: trip.id,
    saccoName: trip.saccoName,
    plateNumber: trip.plateNumber,
    classTier: trip.classTier,
    origin: trip.origin,
    originStage: trip.originStage,
    destination: trip.destination,
    destinationStage: trip.destinationStage,
    originCoords: { lat: waypoints[0].lat, lng: waypoints[0].lng },
    destinationCoords: {
      lat: waypoints[waypoints.length - 1].lat,
      lng: waypoints[waypoints.length - 1].lng,
    },
    currentCoords,
    speedKmh,
    headingDeg,
    progressPercent: Math.round(progress * 100),
    currentSector: progress < 0.06 ? `Staging at ${waypoints[0].name}` : `En route near ${p1.name}`,
    nextStage: p2.name,
    status: trip.status,
    etaMinutesRemaining,
    driverName,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

function ensureDb(): ServerDb {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial: ServerDb = {
      trips: buildSeedTrips(),
      vehicles: [...KENYA_VEHICLES],
      bookings: [],
      parcels: [],
      mpesaTransactions: {},
      verifiedScans: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as ServerDb;
    if (!Array.isArray(parsed.trips) || parsed.trips.length === 0) {
      parsed.trips = buildSeedTrips();
    }
    if (!Array.isArray(parsed.vehicles) || parsed.vehicles.length === 0) {
      parsed.vehicles = [...KENYA_VEHICLES];
    }
    parsed.bookings = parsed.bookings || [];
    parsed.parcels = parsed.parcels || [];
    parsed.mpesaTransactions = parsed.mpesaTransactions || {};
    parsed.verifiedScans = parsed.verifiedScans || [];
    return parsed;
  } catch {
    const fallback: ServerDb = {
      trips: buildSeedTrips(),
      vehicles: [...KENYA_VEHICLES],
      bookings: [],
      parcels: [],
      mpesaTransactions: {},
      verifiedScans: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

function saveDb(db: ServerDb): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function normalizeKenyanPhone(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('07') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith('01') && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`;
  return null;
}

const SANDBOX_CERT_PATH = path.resolve(process.cwd(), 'certs', 'SandboxCertificate.cer');

function encryptInitiatorPassword(initiatorPassword: string): string {
  const certPem = fs.readFileSync(SANDBOX_CERT_PATH, 'utf8');
  const encrypted = crypto.publicEncrypt(
    {
      key: certPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(initiatorPassword, 'utf8')
  );
  return encrypted.toString('base64');
}

function getDarajaConfig(reqHost?: string, reqProto?: string) {
  const env = (process.env.MPESA_ENV || 'sandbox').toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
  const baseUrl =
    env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const consumerKey = (process.env.MPESA_CONSUMER_KEY || '').trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || '').trim();
  const passkey = (process.env.MPESA_PASSKEY || '').trim();
  const shortcode = (process.env.MPESA_SHORTCODE || (env === 'sandbox' ? '174379' : '')).trim();
  const partyB = (process.env.MPESA_PARTY_B || shortcode).trim();
  const transactionType = (process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline').trim();

  const settlementPhone =
    normalizeKenyanPhone(process.env.MPESA_SETTLEMENT_PHONE || DEFAULT_SETTLEMENT_PHONE) ||
    DEFAULT_SETTLEMENT_PHONE;
  const initiatorName = (
    process.env.MPESA_INITIATOR_NAME || (env === 'sandbox' ? 'testapi' : '')
  ).trim();
  const initiatorPassword = (process.env.MPESA_INITIATOR_PASSWORD || '').trim();
  const rawCredential = (process.env.MPESA_SECURITY_CREDENTIAL || '').trim();

  let securityCredential = rawCredential;
  let credentialMode: 'encrypted-from-password' | 'pre-encrypted' | 'missing' = rawCredential
    ? 'pre-encrypted'
    : 'missing';

  if (initiatorPassword) {
    securityCredential = encryptInitiatorPassword(initiatorPassword);
    credentialMode = 'encrypted-from-password';
  }

  const originBase =
    (process.env.APP_URL || '').trim().replace(/\/$/, '') ||
    (reqHost ? `${reqProto || 'https'}://${reqHost}` : '');

  const rawCallback = (process.env.MPESA_CALLBACK_URL || '').trim();
  const callbackUrl =
    rawCallback && rawCallback.includes('/api/mpesa/callback')
      ? rawCallback
      : originBase
      ? `${originBase}/api/mpesa/callback`
      : rawCallback;

  const missingVars: string[] = [];
  if (!consumerKey) missingVars.push('MPESA_CONSUMER_KEY');
  if (!consumerSecret) missingVars.push('MPESA_CONSUMER_SECRET');
  if (!passkey) missingVars.push('MPESA_PASSKEY');
  if (!shortcode) missingVars.push('MPESA_SHORTCODE');

  return {
    configured: missingVars.length === 0,
    b2cConfigured: Boolean(missingVars.length === 0 && initiatorName && securityCredential),
    credentialMode,
    missingVars,
    env: env as 'sandbox' | 'production',
    baseUrl,
    consumerKey,
    consumerSecret,
    passkey,
    shortcode,
    partyB,
    transactionType,
    settlementPhone,
    initiatorName,
    securityCredential,
    originBase,
    callbackUrl,
  };
}

function getKenyanTimestamp(): string {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const yyyy = eat.getUTCFullYear();
  const mm = String(eat.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(eat.getUTCDate()).padStart(2, '0');
  const hh = String(eat.getUTCHours()).padStart(2, '0');
  const min = String(eat.getUTCMinutes()).padStart(2, '0');
  const ss = String(eat.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

const cachedOAuthTokens = new Map<string, { token: string; expiresAtMs: number }>();

async function fetchDarajaAccessToken(
  baseUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<string> {
  const cacheKey = `${baseUrl}:${consumerKey.slice(0, 8)}`;
  const cached = cachedOAuthTokens.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.token;
  }

  const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: 'application/json',
      'User-Agent': 'MsafiriKenya/1.0 (+https://safaricom.co.ke)',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Daraja OAuth failed (${res.status}): ${text.slice(0, 180)}`);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: string | number };
  if (!json.access_token) {
    throw new Error('Daraja OAuth response did not include access_token.');
  }
  const ttlSec = Math.max(120, Number(json.expires_in || 3599));
  cachedOAuthTokens.set(cacheKey, {
    token: json.access_token,
    expiresAtMs: Date.now() + ttlSec * 1000,
  });
  return json.access_token;
}

async function forwardPaymentViaB2C(
  tx: StoredMpesaTx,
  cfg: ReturnType<typeof getDarajaConfig>
): Promise<void> {
  if (!cfg.b2cConfigured || !cfg.originBase.startsWith('https://')) {
    tx.b2cForwardStatus = 'NotConfigured';
    return;
  }

  try {
    const token = await fetchDarajaAccessToken(
      cfg.baseUrl,
      cfg.consumerKey,
      cfg.consumerSecret
    );
    const res = await fetch(`${cfg.baseUrl}/mpesa/b2c/v3/paymentrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        OriginatorConversationID: `MSF_B2C_${Date.now()}`,
        InitiatorName: cfg.initiatorName,
        SecurityCredential: cfg.securityCredential,
        CommandID: 'BusinessPayment',
        Amount: tx.amountKes,
        PartyA: cfg.shortcode,
        PartyB: cfg.settlementPhone,
        Remarks: `Msafiri ${tx.accountRef}`,
        QueueTimeOutURL: `${cfg.originBase}/api/mpesa/b2c-timeout`,
        ResultURL: `${cfg.originBase}/api/mpesa/b2c-result`,
        Occasion: tx.accountRef,
      }),
    });
    const data = (await res.json()) as {
      ResponseCode?: string;
      ConversationID?: string;
    };
    if (res.ok && data.ResponseCode === '0') {
      tx.b2cForwardStatus = 'Dispatched';
      tx.b2cConversationId = data.ConversationID;
    } else {
      tx.b2cForwardStatus = 'Failed';
    }
  } catch {
    tx.b2cForwardStatus = 'Failed';
  }
}

function signTicketPayload(payload: {
  ticketRef: string;
  tripId: string;
  seats: string[];
  plateNumber: string;
  passengerName: string;
}): string {
  const canonical = `${payload.ticketRef}|${payload.tripId}|${payload.seats.join(',')}|${payload.plateNumber}|${payload.passengerName}`;
  const hmac = crypto.createHmac('sha256', TICKET_SIGNING_SECRET).update(canonical).digest('hex');
  return `MSF1.${hmac.slice(0, 32).toUpperCase()}`;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function verifyAdminPassword(password: string): boolean {
  const envOverride = (process.env.ADMIN_MASTER_PASSWORD || '').trim();
  if (envOverride) {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(envOverride, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const derived = crypto.scryptSync(password, ADMIN_PASSWORD_SALT, 64);
  const expected = Buffer.from(ADMIN_PASSWORD_SCRYPT_HEX, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function createAdminSessionToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      email?: string;
      exp?: number;
    };
    if (!parsed.exp || parsed.exp <= Date.now()) return null;
    if (parsed.email !== ADMIN_EMAIL) return null;
    return parsed.email;
  } catch {
    return null;
  }
}

function getAdminSessionEmail(req: express.Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifyAdminSessionToken(cookies[ADMIN_COOKIE_NAME]);
}

function buildAdminCookieHeader(req: express.Request, value: string, maxAgeSeconds: number): string {
  const isHttps =
    req.secure ||
    req.get('x-forwarded-proto') === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const sameSite = isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; ${sameSite}`;
}

function requireAdminSession(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const email = getAdminSessionEmail(req);
  if (email !== ADMIN_EMAIL) {
    res.status(401).json({ error: 'Administrator session required.' });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  ensureDb();

  app.get('/api/health', (_req, res) => {
    const db = ensureDb();
    const daraja = getDarajaConfig();
    res.json({
      status: 'ok',
      service: 'msafiri-kenya-matatu-api',
      darajaConfigured: daraja.configured,
      darajaEnv: daraja.env,
      settlementPhone: daraja.settlementPhone,
      tripsCount: db.trips.length,
      mpesaTransactionsCount: Object.keys(db.mpesaTransactions).length,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/maps/config', (_req, res) => {
    const apiKey = (
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ''
    ).trim();
    res.json({
      configured: Boolean(apiKey),
      apiKey,
    });
  });

  app.get('/api/tracking/live', (req, res) => {
    const db = ensureDb();
    const tripIdParam = String(req.query.tripId || '').trim();
    const nowMs = Date.now();
    const activeTrips = db.trips.filter((t) => t.status !== 'Cancelled');
    const filtered = tripIdParam
      ? activeTrips.filter((t) => t.id === tripIdParam)
      : activeTrips;
    const telemetry = filtered.map((trip) => buildTripTelemetry(trip, db, nowMs));
    res.json({
      telemetry,
      updatedAt: new Date(nowMs).toISOString(),
    });
  });

  app.post('/api/tracking/update', requireAdminSession, (req, res) => {
    const { tripId, progressPercent, speedKmh, status } = req.body as {
      tripId?: string;
      progressPercent?: number;
      speedKmh?: number;
      status?: Trip['status'];
    };
    if (!tripId) {
      res.status(400).json({ error: 'tripId is required.' });
      return;
    }
    const db = ensureDb();
    const tripIdx = db.trips.findIndex((t) => t.id === tripId);
    if (tripIdx === -1) {
      res.status(404).json({ error: 'Trip not found.' });
      return;
    }
    if (status) {
      db.trips[tripIdx] = { ...db.trips[tripIdx], status };
    }
    const clampedProgress =
      typeof progressPercent === 'number'
        ? Math.max(0, Math.min(1, progressPercent / 100))
        : 0.35;
    const governedSpeed =
      typeof speedKmh === 'number' ? Math.max(0, Math.min(80, Math.round(speedKmh))) : 74;

    db.liveTracking = db.liveTracking || {};
    db.liveTracking[tripId] = {
      progress: clampedProgress,
      speedKmh: governedSpeed,
      updatedAtMs: Date.now(),
    };
    saveDb(db);
    const point = buildTripTelemetry(db.trips[tripIdx], db, Date.now());
    res.json({ telemetry: point, trip: db.trips[tripIdx] });
  });

  app.post('/api/maps/grounding', async (req, res) => {
    const { query, lat, lng, origin, destination } = req.body as {
      query?: string;
      lat?: number;
      lng?: number;
      origin?: string;
      destination?: string;
    };

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      res.status(400).json({ error: 'Query is required.' });
      return;
    }

    const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiApiKey) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const corridorContext =
        origin && destination
          ? `Context: Kenyan intercity PSV matatu corridor from ${origin} to ${destination}. `
          : 'Context: Kenyan intercity PSV matatu terminals, highway stages, and commuter stops. ';

      const hasCoords =
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        Number.isFinite(lat) &&
        Number.isFinite(lng);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `${corridorContext}${cleanQuery}`,
        config: {
          tools: [{ googleMaps: {} }],
          ...(hasCoords
            ? {
                toolConfig: {
                  retrievalConfig: {
                    latLng: { latitude: lat as number, longitude: lng as number },
                  },
                },
              }
            : {}),
        },
      });

      const candidate = response.candidates?.[0];
      const rawChunks =
        (candidate?.groundingMetadata?.groundingChunks as
          | Array<{
              maps?: {
                uri?: string;
                title?: string;
                placeAnswerSources?: {
                  reviewSnippets?: Array<{ content?: string }>;
                };
              };
            }>
          | undefined) || [];

      const sources: MapsGroundingSource[] = [];
      const seenUris = new Set<string>();

      for (const chunk of rawChunks) {
        const uri = chunk?.maps?.uri;
        const title = chunk?.maps?.title;
        if (!uri || seenUris.has(uri)) continue;
        seenUris.add(uri);
        const snippets =
          chunk.maps?.placeAnswerSources?.reviewSnippets
            ?.map((s) => s.content?.trim())
            .filter((s): s is string => Boolean(s)) || [];
        sources.push({
          title: title || 'View on Google Maps',
          uri,
          reviewSnippets: snippets.length > 0 ? snippets : undefined,
        });
      }

      res.json({
        text: response.text || 'No place insights returned for this corridor query.',
        sources,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Maps grounding request failed.';
      const isQuota =
        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota');
      res.status(isQuota ? 429 : 502).json({
        error: isQuota
          ? 'Google Maps grounding quota exceeded. Please try again shortly or switch to your own Gemini API key.'
          : msg,
      });
    }
  });

  app.get('/api/mpesa/config-status', (req, res) => {
    const cfg = getDarajaConfig(req.get('host'), req.protocol);
    res.json({
      configured: cfg.configured,
      b2cConfigured: cfg.b2cConfigured,
      credentialMode: cfg.credentialMode,
      environment: cfg.env,
      missingVars: cfg.missingVars,
      shortcode: cfg.shortcode || null,
      settlementPhone: cfg.settlementPhone,
      callbackUrl: cfg.callbackUrl,
    });
  });

  app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (normalizedEmail !== ADMIN_EMAIL) {
      res.status(403).json({ error: 'Only the authorized administrator email can access Admin.' });
      return;
    }
    if (!password || !verifyAdminPassword(String(password))) {
      res.status(401).json({ error: 'Invalid master password for admin account.' });
      return;
    }
    const token = createAdminSessionToken(ADMIN_EMAIL);
    res.setHeader('Set-Cookie', buildAdminCookieHeader(req, token, 7 * 24 * 60 * 60));
    res.json({ authenticated: true, email: ADMIN_EMAIL });
  });

  app.get('/api/admin/session', (req, res) => {
    const email = getAdminSessionEmail(req);
    res.json({ authenticated: email === ADMIN_EMAIL, email });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', buildAdminCookieHeader(req, '', 0));
    res.json({ ok: true });
  });

  app.get('/api/admin/overview', requireAdminSession, (_req, res) => {
    const db = ensureDb();
    res.json({
      trips: db.trips,
      vehicles: db.vehicles || KENYA_VEHICLES,
      bookings: db.bookings,
      parcels: db.parcels,
    });
  });

  app.post('/api/admin/trips', requireAdminSession, (req, res) => {
    const trip = req.body as Trip;
    if (!trip?.id || !trip?.origin || !trip?.destination || !trip?.plateNumber) {
      res.status(400).json({ error: 'Incomplete trip dispatch fields.' });
      return;
    }
    const db = ensureDb();
    const idx = db.trips.findIndex((t) => t.id === trip.id);
    if (idx === -1) db.trips.unshift(trip);
    else db.trips[idx] = trip;
    saveDb(db);
    res.json({ trip });
  });

  app.patch('/api/admin/trips/:id/status', requireAdminSession, (req, res) => {
    const { id } = req.params;
    const { status } = req.body as { status?: Trip['status'] };
    if (!status) {
      res.status(400).json({ error: 'Trip status is required.' });
      return;
    }
    const db = ensureDb();
    const idx = db.trips.findIndex((t) => t.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Trip not found.' });
      return;
    }
    db.trips[idx] = { ...db.trips[idx], status };
    saveDb(db);
    res.json({ trip: db.trips[idx] });
  });

  app.patch('/api/admin/bookings/:id/status', requireAdminSession, (req, res) => {
    const { id } = req.params;
    const { status } = req.body as { status?: Booking['status'] };
    if (!status) {
      res.status(400).json({ error: 'Booking status is required.' });
      return;
    }
    const db = ensureDb();
    const idx = db.bookings.findIndex((b) => b.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    db.bookings[idx] = { ...db.bookings[idx], status };
    saveDb(db);
    res.json({ booking: db.bookings[idx] });
  });

  app.patch('/api/admin/parcels/:id/status', requireAdminSession, (req, res) => {
    const { id } = req.params;
    const { status } = req.body as { status?: Parcel['status'] };
    if (!status) {
      res.status(400).json({ error: 'Parcel status is required.' });
      return;
    }
    const db = ensureDb();
    const idx = db.parcels.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Parcel not found.' });
      return;
    }
    db.parcels[idx] = { ...db.parcels[idx], status };
    saveDb(db);
    res.json({ parcel: db.parcels[idx] });
  });

  app.patch('/api/admin/vehicles/:id/status', requireAdminSession, (req, res) => {
    const { id } = req.params;
    const { status } = req.body as { status?: 'Active' | 'Maintenance' | 'Grounded' };
    if (!status) {
      res.status(400).json({ error: 'Vehicle status is required.' });
      return;
    }
    const db = ensureDb();
    const list = db.vehicles || [...KENYA_VEHICLES];
    const idx = list.findIndex((v) => v.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Vehicle not found.' });
      return;
    }
    list[idx] = { ...list[idx], status };
    db.vehicles = list;
    saveDb(db);
    res.json({ vehicle: list[idx] });
  });

  app.post('/api/admin/vehicles', requireAdminSession, (req, res) => {
    const body = req.body as Partial<typeof KENYA_VEHICLES[number]>;
    const plateNumber = String(body.plateNumber || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    const model = String(body.model || '').trim();
    const driverName = String(body.driverName || '').trim();
    const saccoId = String(body.saccoId || '').trim();
    const classTier = body.classTier;

    if (plateNumber.length < 6 || plateNumber.length > 12) {
      res.status(400).json({ error: 'Enter a valid Kenyan PSV plate (e.g. KDP 312Z).' });
      return;
    }
    if (!model || !driverName || !saccoId) {
      res.status(400).json({ error: 'SACCO, vehicle model, and driver name are required.' });
      return;
    }
    if (
      classTier !== 'Executive 11' &&
      classTier !== 'Standard 14' &&
      classTier !== 'VIP Coach 33'
    ) {
      res.status(400).json({ error: 'Invalid vehicle class tier.' });
      return;
    }

    const db = ensureDb();
    const list = db.vehicles || [...KENYA_VEHICLES];
    const duplicate = list.some(
      (v) => v.plateNumber.replace(/\s+/g, '') === plateNumber.replace(/\s+/g, '')
    );
    if (duplicate) {
      res.status(409).json({ error: `Vehicle ${plateNumber} is already registered in the fleet.` });
      return;
    }

    const capacity =
      typeof body.capacity === 'number' && body.capacity >= 7 && body.capacity <= 65
        ? Math.round(body.capacity)
        : classTier === 'Executive 11'
        ? 11
        : classTier === 'VIP Coach 33'
        ? 33
        : 14;

    const newVehicle: typeof KENYA_VEHICLES[number] = {
      id: body.id && /^[a-zA-Z0-9_-]+$/.test(body.id) ? body.id : `veh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      saccoId,
      plateNumber,
      model,
      capacity,
      classTier,
      ntsaExpiry: String(body.ntsaExpiry || '2027-12-31').trim(),
      speedGovernorStatus: body.speedGovernorStatus || 'Calibrated 80km/h',
      driverName,
      status: body.status || 'Active',
    };

    list.unshift(newVehicle);
    db.vehicles = list;
    saveDb(db);
    res.json({ vehicle: newVehicle, vehicles: list });
  });

  app.delete('/api/admin/vehicles/:id', requireAdminSession, (req, res) => {
    const { id } = req.params;
    const db = ensureDb();
    const list = db.vehicles || [...KENYA_VEHICLES];
    const idx = list.findIndex((v) => v.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Vehicle not found in registered fleet.' });
      return;
    }
    const [removed] = list.splice(idx, 1);
    db.vehicles = list;
    saveDb(db);
    res.json({ deletedId: removed.id, vehicles: list });
  });

  app.get('/api/catalog', (_req, res) => {
    const db = ensureDb();
    res.json({
      saccos: KENYA_SACCOS,
      vehicles: db.vehicles || KENYA_VEHICLES,
      corridors: KENYA_CORRIDORS,
      trips: db.trips,
    });
  });

  app.post('/api/routes/quote', (req, res) => {
    const { origin, destination, classTier } = req.body as {
      origin?: string;
      destination?: string;
      classTier?: VehicleClassTier;
    };

    if (!origin || !destination) {
      res.status(400).json({ error: 'Origin and destination are required.' });
      return;
    }

    const tier: VehicleClassTier = classTier || 'Standard 14';
    const match = KENYA_CORRIDORS.find(
      (c) =>
        (c.origin.toLowerCase() === origin.toLowerCase() &&
          c.destination.toLowerCase() === destination.toLowerCase()) ||
        (c.destination.toLowerCase() === origin.toLowerCase() &&
          c.origin.toLowerCase() === destination.toLowerCase())
    );

    const distanceKm = match ? match.distanceKm : 240;
    const durationLabel = match ? match.durationLabel : '4h 15m';
    const baseFareKes = match ? match.baseFareKes : Math.round(distanceKm * 4.5);
    const expresswayTollKes = match ? match.expresswayTollKes : 100;
    const tierMultiplier = tier === 'Executive 11' ? 1.25 : tier === 'VIP Coach 33' ? 1.15 : 1.0;
    const ntsaSafetyLevyKes = 50;
    const totalPerSeatKes = Math.round(baseFareKes * tierMultiplier) + expresswayTollKes + ntsaSafetyLevyKes;

    const quote: RouteQuote = {
      origin,
      destination,
      classTier: tier,
      distanceKm,
      durationLabel,
      baseFareKes,
      tierMultiplier,
      expresswayTollKes,
      ntsaSafetyLevyKes,
      totalPerSeatKes,
      baggageAllowanceKg: tier === 'VIP Coach 33' ? 25 : tier === 'Executive 11' ? 20 : 15,
    };

    res.json(quote);
  });

  // Live Safaricom M-Pesa Daraja STK Push
  app.post('/api/mpesa/stk-push', async (req, res) => {
    const { phone, amountKes, accountRef } = req.body as {
      phone?: string;
      amountKes?: number;
      accountRef?: string;
    };

    const cfg = getDarajaConfig(req.get('host'), req.protocol);
    const normalized = normalizeKenyanPhone(phone || cfg.settlementPhone);
    if (!normalized) {
      res.status(400).json({
        error: 'Enter a valid Kenyan mobile number (e.g. 0712 345 678 or 0112 898 591).',
      });
      return;
    }

    const parsedAmount = Math.round(Number(amountKes || 0));
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || parsedAmount > 150000) {
      res.status(400).json({ error: 'Amount must be between KES 1 and KES 150,000.' });
      return;
    }

    if (!cfg.configured) {
      res.status(503).json({
        error: `Live Safaricom Daraja STK Push requires ${cfg.missingVars.join(', ')} in AI Studio Secrets. Once added, STK Push prompts will be sent directly to ${normalized} and payments settled to ${cfg.settlementPhone}.`,
        missingVars: cfg.missingVars,
        settlementPhone: cfg.settlementPhone,
      });
      return;
    }

    if (!cfg.callbackUrl || !cfg.callbackUrl.startsWith('https://')) {
      res.status(400).json({
        error: 'A public HTTPS callback URL (APP_URL or MPESA_CALLBACK_URL) is required by Safaricom Daraja.',
      });
      return;
    }

    try {
      const accessToken = await fetchDarajaAccessToken(
        cfg.baseUrl,
        cfg.consumerKey,
        cfg.consumerSecret
      );
      const timestamp = getKenyanTimestamp();
      const password = Buffer.from(`${cfg.shortcode}${cfg.passkey}${timestamp}`).toString('base64');
      const cleanRef =
        String(accountRef || 'MSAFIRI')
          .replace(/[^a-zA-Z0-9-]/g, '')
          .slice(0, 12) || 'MSAFIRI';

      const stkPayload = {
        BusinessShortCode: cfg.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: cfg.transactionType,
        Amount: parsedAmount,
        PartyA: normalized,
        PartyB: cfg.partyB,
        PhoneNumber: normalized,
        CallBackURL: cfg.callbackUrl,
        AccountReference: cleanRef,
        TransactionDesc: 'Msafiri Tkt',
      };

      const darajaRes = await fetch(`${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'MsafiriKenya/1.0 (+https://safaricom.co.ke)',
        },
        body: JSON.stringify(stkPayload),
      });

      const rawText = await darajaRes.text();
      let darajaJson: {
        MerchantRequestID?: string;
        CheckoutRequestID?: string;
        ResponseCode?: string;
        ResponseDescription?: string;
        CustomerMessage?: string;
        errorMessage?: string;
      };
      try {
        darajaJson = JSON.parse(rawText);
      } catch {
        throw new Error(`Unexpected Daraja response (${darajaRes.status}): ${rawText}`);
      }

      if (!darajaRes.ok || darajaJson.ResponseCode !== '0' || !darajaJson.CheckoutRequestID) {
        const msg =
          darajaJson.errorMessage ||
          darajaJson.ResponseDescription ||
          'Safaricom Daraja rejected the STK Push request.';
        res.status(502).json({ error: msg });
        return;
      }

      const record: StoredMpesaTx = {
        checkoutRequestId: darajaJson.CheckoutRequestID,
        merchantRequestId: darajaJson.MerchantRequestID || `MR_${Date.now()}`,
        customerMessage:
          darajaJson.CustomerMessage ||
          `M-Pesa STK Push sent to ${normalized}. Enter your M-Pesa PIN on your phone.`,
        phone: normalized,
        amountKes: parsedAmount,
        status: 'PENDING',
        darajaMode: cfg.env,
        settlementPhone: cfg.settlementPhone,
        b2cForwardStatus: cfg.b2cConfigured ? 'NotConfigured' : 'NotConfigured',
        createdAtMs: Date.now(),
        accountRef: cleanRef,
      };

      const db = ensureDb();
      db.mpesaTransactions[record.checkoutRequestId] = record;
      saveDb(db);

      res.json({
        checkoutRequestId: record.checkoutRequestId,
        merchantRequestId: record.merchantRequestId,
        customerMessage: record.customerMessage,
        phone: record.phone,
        amountKes: record.amountKes,
        status: record.status,
        darajaMode: record.darajaMode,
        settlementPhone: record.settlementPhone,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Daraja STK Push request failed.';
      res.status(502).json({ error: msg });
    }
  });

  // Official Safaricom Daraja STK Callback Webhook
  app.post('/api/mpesa/callback', async (req, res) => {
    try {
      const stkCallback = req.body?.Body?.stkCallback as
        | {
            MerchantRequestID?: string;
            CheckoutRequestID?: string;
            ResultCode?: number | string;
            ResultDesc?: string;
            CallbackMetadata?: {
              Item?: Array<{ Name: string; Value?: string | number }>;
            };
          }
        | undefined;

      if (stkCallback?.CheckoutRequestID) {
        const db = ensureDb();
        const existing = db.mpesaTransactions[stkCallback.CheckoutRequestID];
        if (existing) {
          const code = Number(stkCallback.ResultCode);
          if (code === 0) {
            const items = stkCallback.CallbackMetadata?.Item || [];
            const receiptItem = items.find((i) => i.Name === 'MpesaReceiptNumber');
            existing.status = 'COMPLETED';
            existing.mpesaReceipt = receiptItem?.Value
              ? String(receiptItem.Value)
              : `MPESA-${stkCallback.CheckoutRequestID.slice(-6).toUpperCase()}`;
            existing.completedAt = new Date().toISOString();

            const cfg = getDarajaConfig(req.get('host'), req.protocol);
            await forwardPaymentViaB2C(existing, cfg);
          } else {
            existing.status = 'FAILED';
            existing.failureReason =
              stkCallback.ResultDesc || 'M-Pesa transaction was cancelled or failed.';
          }
          db.mpesaTransactions[stkCallback.CheckoutRequestID] = existing;
          saveDb(db);
        }
      }
    } catch (err) {
      console.error('Error processing M-Pesa callback:', err);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  // Daraja B2C Result & Timeout Webhooks (for payout forwarding to 254112898591)
  app.post('/api/mpesa/b2c-result', (req, res) => {
    try {
      const result = req.body?.Result as
        | { ConversationID?: string; ResultCode?: number | string }
        | undefined;
      if (result?.ConversationID) {
        const db = ensureDb();
        for (const key of Object.keys(db.mpesaTransactions)) {
          const tx = db.mpesaTransactions[key];
          if (tx.b2cConversationId === result.ConversationID) {
            tx.b2cForwardStatus = Number(result.ResultCode) === 0 ? 'Completed' : 'Failed';
            db.mpesaTransactions[key] = tx;
            saveDb(db);
            break;
          }
        }
      }
    } catch (err) {
      console.error('Error processing B2C result:', err);
    }
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  app.post('/api/mpesa/b2c-timeout', (_req, res) => {
    res.json({ ResultCode: 0, ResultDesc: 'Timeout received' });
  });

  // Poll Transaction Status (reads callback result OR actively queries Daraja stkpushquery)
  app.get('/api/mpesa/status/:checkoutRequestId', async (req, res) => {
    const { checkoutRequestId } = req.params;
    const db = ensureDb();
    const tx = db.mpesaTransactions[checkoutRequestId];
    if (!tx) {
      res.status(404).json({ error: 'M-Pesa CheckoutRequestID not found.' });
      return;
    }

    if (tx.status === 'PENDING') {
      const cfg = getDarajaConfig(req.get('host'), req.protocol);
      const nowMs = Date.now();
      if (cfg.configured && (!tx.lastQueriedAtMs || nowMs - tx.lastQueriedAtMs >= 5000)) {
        tx.lastQueriedAtMs = nowMs;
        try {
          const accessToken = await fetchDarajaAccessToken(
            cfg.baseUrl,
            cfg.consumerKey,
            cfg.consumerSecret
          );
          const timestamp = getKenyanTimestamp();
          const password = Buffer.from(`${cfg.shortcode}${cfg.passkey}${timestamp}`).toString(
            'base64'
          );
          const queryRes = await fetch(`${cfg.baseUrl}/mpesa/stkpushquery/v1/query`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'User-Agent': 'MsafiriKenya/1.0 (+https://safaricom.co.ke)',
            },
            body: JSON.stringify({
              BusinessShortCode: cfg.shortcode,
              Password: password,
              Timestamp: timestamp,
              CheckoutRequestID: checkoutRequestId,
            }),
          });

          const qRawText = await queryRes.text();
          tx.lastQueryRaw = `${queryRes.status}: ${qRawText}`;

          if (queryRes.ok) {
            const qJson = JSON.parse(qRawText) as {
              ResultCode?: string | number;
              ResultDesc?: string;
            };
            if (qJson.ResultCode !== undefined && qJson.ResultCode !== null) {
              const code = String(qJson.ResultCode);
              if (code === '0') {
                const latestDb = ensureDb();
                const latestTx = latestDb.mpesaTransactions[checkoutRequestId];
                if (latestTx?.status === 'COMPLETED' && latestTx.mpesaReceipt) {
                  res.json({
                    checkoutRequestId: latestTx.checkoutRequestId,
                    merchantRequestId: latestTx.merchantRequestId,
                    customerMessage: latestTx.customerMessage,
                    phone: latestTx.phone,
                    amountKes: latestTx.amountKes,
                    status: latestTx.status,
                    mpesaReceipt: latestTx.mpesaReceipt,
                    darajaMode: latestTx.darajaMode,
                    settlementPhone: latestTx.settlementPhone,
                    b2cForwardStatus: latestTx.b2cForwardStatus,
                    completedAt: latestTx.completedAt,
                    lastQueryRaw: latestTx.lastQueryRaw,
                  });
                  return;
                }
                tx.status = 'COMPLETED';
                tx.mpesaReceipt =
                  tx.mpesaReceipt || `MPESA-${checkoutRequestId.slice(-8).toUpperCase()}`;
                tx.completedAt = new Date().toISOString();
                await forwardPaymentViaB2C(tx, cfg);
              } else {
                tx.status = 'FAILED';
                tx.failureReason = qJson.ResultDesc || 'Payment cancelled or declined on handset.';
              }
            }
          }
        } catch (err) {
          tx.lastQueryRaw = err instanceof Error ? err.message : 'Query error';
        }
        db.mpesaTransactions[checkoutRequestId] = tx;
        saveDb(db);
      }
    }

    res.json({
      checkoutRequestId: tx.checkoutRequestId,
      merchantRequestId: tx.merchantRequestId,
      customerMessage: tx.customerMessage,
      phone: tx.phone,
      amountKes: tx.amountKes,
      status: tx.status,
      mpesaReceipt: tx.mpesaReceipt,
      failureReason: tx.failureReason,
      darajaMode: tx.darajaMode,
      settlementPhone: tx.settlementPhone,
      b2cForwardStatus: tx.b2cForwardStatus,
      completedAt: tx.completedAt,
      lastQueryRaw: tx.lastQueryRaw,
    });
  });

  app.post('/api/tickets/sign', (req, res) => {
    const { ticketRef, tripId, seats, plateNumber, passengerName } = req.body as {
      ticketRef?: string;
      tripId?: string;
      seats?: string[];
      plateNumber?: string;
      passengerName?: string;
    };

    if (
      !ticketRef ||
      !tripId ||
      !Array.isArray(seats) ||
      seats.length === 0 ||
      !plateNumber ||
      !passengerName
    ) {
      res.status(400).json({ error: 'Incomplete ticket fields for cryptographic signing.' });
      return;
    }

    const signature = signTicketPayload({
      ticketRef,
      tripId,
      seats,
      plateNumber,
      passengerName,
    });

    res.json({ signature });
  });

  app.post('/api/tickets/verify', (req, res) => {
    const { ticketRef, tripId, seats, plateNumber, passengerName, qrSignature } = req.body as {
      ticketRef?: string;
      tripId?: string;
      seats?: string[];
      plateNumber?: string;
      passengerName?: string;
      qrSignature?: string;
    };

    if (
      !ticketRef ||
      !tripId ||
      !Array.isArray(seats) ||
      !plateNumber ||
      !passengerName ||
      !qrSignature
    ) {
      res.status(400).json({
        valid: false,
        reason: 'Malformed boarding pass payload.',
        verifiedAt: new Date().toISOString(),
      });
      return;
    }

    const expected = signTicketPayload({
      ticketRef,
      tripId,
      seats,
      plateNumber,
      passengerName,
    });

    const valid = qrSignature === expected;
    if (valid) {
      const db = ensureDb();
      db.verifiedScans.unshift({
        ticketRef,
        plateNumber,
        verifiedAt: new Date().toISOString(),
      });
      db.verifiedScans = db.verifiedScans.slice(0, 50);
      saveDb(db);
    }

    const result: TicketVerificationResult = {
      valid,
      reason: valid
        ? 'Valid HMAC-SHA256 boarding pass cleared for PSV boarding.'
        : 'Signature mismatch — ticket could not be authenticated.',
      ticketRef,
      tripId,
      seats,
      plateNumber,
      passengerName,
      verifiedAt: new Date().toISOString(),
    };

    res.json(result);
  });

  app.get('/api/ntsa/verify', (req, res) => {
    const rawPlate = String(req.query.plate || '').trim().toUpperCase();
    const cleaned = rawPlate.replace(/\s+/g, ' ');
    const validFormat = /^K[A-Z]{2}\s?\d{3}[A-Z]$/.test(cleaned);

    if (!validFormat) {
      res.status(400).json({
        error: 'Invalid Kenyan PSV registration format. Expected e.g. KDL 482G.',
      });
      return;
    }

    const matchedVehicle = KENYA_VEHICLES.find(
      (v) => v.plateNumber.replace(/\s+/g, '') === cleaned.replace(/\s+/g, '')
    );
    const matchedSacco = matchedVehicle
      ? KENYA_SACCOS.find((s) => s.id === matchedVehicle.saccoId)
      : undefined;

    const report: NtsaPlateReport = {
      plateNumber: matchedVehicle ? matchedVehicle.plateNumber : cleaned,
      validFormat: true,
      registeredOwnerSacco: matchedSacco ? matchedSacco.name : 'Verified Independent PSV Operator',
      psvBadgeStatus: 'Valid',
      speedGovernor: 'Calibrated 80km/h',
      inspectionExpiry: matchedVehicle ? matchedVehicle.ntsaExpiry : '2027-09-15',
      tlbLicenseNo: matchedSacco ? matchedSacco.ntsaLicense : 'NTSA-TLB-2026-8831',
      insuranceClass: 'PSV Comprehensive + Passenger Liability',
    };

    res.json(report);
  });

  // Persist confirmed bookings & update seat inventory in server DB (supports guest & synced bookings)
  app.post('/api/bookings', (req, res) => {
    const booking = req.body as Booking;
    if (!booking?.id || !booking?.ticketRef || !booking?.tripId || !Array.isArray(booking?.seats)) {
      res.status(400).json({ error: 'Invalid booking payload.' });
      return;
    }

    const db = ensureDb();
    const tripIdx = db.trips.findIndex((t) => t.id === booking.tripId);
    if (tripIdx !== -1) {
      const trip = db.trips[tripIdx];
      const mergedSeats = Array.from(new Set([...trip.bookedSeats, ...booking.seats]));
      db.trips[tripIdx] = {
        ...trip,
        bookedSeats: mergedSeats,
        availableSeats: Math.max(0, trip.capacity - mergedSeats.length),
      };
    }

    const existingIdx = db.bookings.findIndex((b) => b.id === booking.id);
    if (existingIdx === -1) {
      db.bookings.unshift(booking);
    } else {
      db.bookings[existingIdx] = booking;
    }
    saveDb(db);
    res.json({ booking, trip: tripIdx !== -1 ? db.trips[tripIdx] : null });
  });

  app.get('/api/bookings', (req, res) => {
    const db = ensureDb();
    const refsParam = String(req.query.refs || '').trim();
    if (refsParam) {
      const refSet = new Set(refsParam.split(',').map((r) => r.trim()).filter(Boolean));
      res.json({ bookings: db.bookings.filter((b) => refSet.has(b.ticketRef) || refSet.has(b.id)) });
      return;
    }
    res.json({ bookings: db.bookings });
  });

  app.patch('/api/bookings/:id/cancel', (req, res) => {
    const { id } = req.params;
    const db = ensureDb();
    const idx = db.bookings.findIndex((b) => b.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const target = db.bookings[idx];
    db.bookings[idx] = { ...target, status: 'Cancelled' };
    const tripIdx = db.trips.findIndex((t) => t.id === target.tripId);
    if (tripIdx !== -1) {
      const trip = db.trips[tripIdx];
      const nextBooked = trip.bookedSeats.filter((s) => !target.seats.includes(s));
      db.trips[tripIdx] = {
        ...trip,
        bookedSeats: nextBooked,
        availableSeats: Math.min(trip.capacity, trip.capacity - nextBooked.length),
      };
    }
    saveDb(db);
    res.json({ booking: db.bookings[idx] });
  });

  app.post('/api/parcels', (req, res) => {
    const parcel = req.body as Parcel;
    if (!parcel?.id || !parcel?.waybillNo) {
      res.status(400).json({ error: 'Invalid parcel payload.' });
      return;
    }
    const db = ensureDb();
    const idx = db.parcels.findIndex((p) => p.id === parcel.id);
    if (idx === -1) db.parcels.unshift(parcel);
    else db.parcels[idx] = parcel;
    saveDb(db);
    res.json({ parcel });
  });

  app.get('/api/parcels', (req, res) => {
    const db = ensureDb();
    const refsParam = String(req.query.refs || '').trim();
    if (refsParam) {
      const refSet = new Set(refsParam.split(',').map((r) => r.trim()).filter(Boolean));
      res.json({ parcels: db.parcels.filter((p) => refSet.has(p.waybillNo) || refSet.has(p.id)) });
      return;
    }
    res.json({ parcels: db.parcels });
  });

  app.get('/api/parcels/track/:waybillNo', (req, res) => {
    const cleanWaybill = String(req.params.waybillNo || '').trim().toUpperCase();
    if (!cleanWaybill) {
      res.status(400).json({ error: 'Waybill number is required.' });
      return;
    }

    const db = ensureDb();
    const parcel = db.parcels.find(
      (p) => p.waybillNo.toUpperCase() === cleanWaybill
    );

    if (!parcel) {
      res.status(404).json({
        error: `No parcel found with waybill ${cleanWaybill}. Verify the code on your receipt.`,
      });
      return;
    }

    const key = `${parcel.originCity}->${parcel.destinationCity}`;
    const waypoints = CORRIDOR_WAYPOINTS[key];
    const originCoords = KENYA_TOWN_COORDS[parcel.originCity] || KENYA_TOWN_COORDS.Nairobi;
    const destCoords = KENYA_TOWN_COORDS[parcel.destinationCity] || KENYA_TOWN_COORDS.Mombasa;

    let lastKnownLocation = `${parcel.originCity} ${parcel.saccoName} Parcel Office`;
    let highwayCheckpoint = `${parcel.originCity} Terminal Dispatch Desk`;
    let currentCoords: LatLngPoint = originCoords;

    if (parcel.status === 'Booked') {
      lastKnownLocation = `${parcel.originCity} — ${parcel.saccoName} Parcel Bay`;
      highwayCheckpoint = 'Awaiting next scheduled departure manifest';
      currentCoords = waypoints?.[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : originCoords;
    } else if (parcel.status === 'In Transit') {
      const midIdx = waypoints ? Math.max(1, Math.floor(waypoints.length / 2)) : 0;
      const midPoint = waypoints?.[midIdx];
      lastKnownLocation = midPoint
        ? `${midPoint.name} (${parcel.originCity}–${parcel.destinationCity} Corridor)`
        : `En route between ${parcel.originCity} and ${parcel.destinationCity}`;
      highwayCheckpoint = `In luggage bay · Heading toward ${parcel.destinationCity}`;
      currentCoords = midPoint ? { lat: midPoint.lat, lng: midPoint.lng } : originCoords;
    } else if (parcel.status === 'Ready for Pickup') {
      const lastPoint = waypoints?.[waypoints.length - 1];
      lastKnownLocation = `${parcel.destinationCity} — ${parcel.saccoName} Collection Counter`;
      highwayCheckpoint = lastPoint ? lastPoint.name : `${parcel.destinationCity} Central Stage`;
      currentCoords = lastPoint ? { lat: lastPoint.lat, lng: lastPoint.lng } : destCoords;
    } else if (parcel.status === 'Collected') {
      const lastPoint = waypoints?.[waypoints.length - 1];
      lastKnownLocation = `${parcel.destinationCity} — Handed over to ${parcel.recipientName}`;
      highwayCheckpoint = 'Recipient signature & ID verified at SACCO desk';
      currentCoords = lastPoint ? { lat: lastPoint.lat, lng: lastPoint.lng } : destCoords;
    } else if (parcel.status === 'Cancelled') {
      lastKnownLocation = `${parcel.originCity} — Waybill Cancelled`;
      highwayCheckpoint = 'Dispatch cancelled prior to departure';
      currentCoords = originCoords;
    }

    res.json({
      waybillNo: parcel.waybillNo,
      originCity: parcel.originCity,
      destinationCity: parcel.destinationCity,
      saccoName: parcel.saccoName,
      description: parcel.description,
      weightKg: parcel.weightKg,
      status: parcel.status,
      lastKnownLocation,
      highwayCheckpoint,
      currentCoords,
      updatedAt: new Date().toISOString(),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Msafiri Kenya Matatu Booking Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Msafiri server:', err);
  process.exit(1);
});
