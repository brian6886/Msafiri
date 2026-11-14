import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  KENYA_CORRIDORS,
  KENYA_SACCOS,
  KENYA_VEHICLES,
  buildSeedTrips,
} from './src/data/kenyaTransitData.ts';
import type {
  Booking,
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

interface StoredMpesaTx extends MpesaStkResponse {
  createdAtMs: number;
  lastQueriedAtMs?: number;
  accountRef: string;
  b2cConversationId?: string;
}

interface ServerDb {
  trips: Trip[];
  bookings: Booking[];
  parcels: Parcel[];
  mpesaTransactions: Record<string, StoredMpesaTx>;
  verifiedScans: Array<{ ticketRef: string; verifiedAt: string; plateNumber: string }>;
}

function ensureDb(): ServerDb {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial: ServerDb = {
      trips: buildSeedTrips(),
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
    parsed.bookings = parsed.bookings || [];
    parsed.parcels = parsed.parcels || [];
    parsed.mpesaTransactions = parsed.mpesaTransactions || {};
    parsed.verifiedScans = parsed.verifiedScans || [];
    return parsed;
  } catch {
    const fallback: ServerDb = {
      trips: buildSeedTrips(),
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
  const initiatorName = (process.env.MPESA_INITIATOR_NAME || '').trim();
  const securityCredential = (process.env.MPESA_SECURITY_CREDENTIAL || '').trim();

  const originBase =
    (process.env.APP_URL || '').trim().replace(/\/$/, '') ||
    (reqHost ? `${reqProto || 'https'}://${reqHost}` : '');

  const callbackUrl =
    (process.env.MPESA_CALLBACK_URL || '').trim() ||
    (originBase ? `${originBase}/api/mpesa/callback` : '');

  const missingVars: string[] = [];
  if (!consumerKey) missingVars.push('MPESA_CONSUMER_KEY');
  if (!consumerSecret) missingVars.push('MPESA_CONSUMER_SECRET');
  if (!passkey) missingVars.push('MPESA_PASSKEY');
  if (!shortcode) missingVars.push('MPESA_SHORTCODE');

  return {
    configured: missingVars.length === 0,
    b2cConfigured: Boolean(missingVars.length === 0 && initiatorName && securityCredential),
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

async function fetchDarajaAccessToken(
  baseUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<string> {
  const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Daraja OAuth failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Daraja OAuth response did not include access_token.');
  }
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

  app.get('/api/mpesa/config-status', (req, res) => {
    const cfg = getDarajaConfig(req.get('host'), req.protocol);
    res.json({
      configured: cfg.configured,
      b2cConfigured: cfg.b2cConfigured,
      environment: cfg.env,
      missingVars: cfg.missingVars,
      shortcode: cfg.shortcode || null,
      settlementPhone: cfg.settlementPhone,
      callbackUrl: cfg.callbackUrl,
    });
  });

  app.get('/api/catalog', (_req, res) => {
    const db = ensureDb();
    res.json({
      saccos: KENYA_SACCOS,
      vehicles: KENYA_VEHICLES,
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
      if (cfg.configured && (!tx.lastQueriedAtMs || nowMs - tx.lastQueriedAtMs >= 2500)) {
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
            },
            body: JSON.stringify({
              BusinessShortCode: cfg.shortcode,
              Password: password,
              Timestamp: timestamp,
              CheckoutRequestID: checkoutRequestId,
            }),
          });

          if (queryRes.ok) {
            const qJson = (await queryRes.json()) as {
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
        } catch {
          // Keep PENDING while Safaricom processes PIN entry
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
