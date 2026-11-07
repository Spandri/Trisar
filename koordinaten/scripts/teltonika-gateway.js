/* global process, Buffer */
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(process.cwd());
const ENV_PATH = path.join(ROOT, '.env.local');
const SOURCE_NAME = 'teltonika_fmb010';
const MAPPING_CACHE_MS = 60_000;
const RELATION_MISSING_RE = /relation .* does not exist|table .* does not exist/i;

const state = {
  startedAt: new Date().toISOString(),
  connections: 0,
  packets: 0,
  records: 0,
  writesOk: 0,
  writesFailed: 0,
  unknownImeiPackets: 0,
  malformedPackets: 0,
  staleLiveSkipped: 0,
  oldRecordsDropped: 0,
  invalidLiveSkipped: 0,
  implausibleLiveSkipped: 0,
  mappingCache: new Map(),
  activeJobsCache: new Map(),
  routeEndpointsCache: new Map(),
  writeQueueByImei: new Map(),
  liveViewSyncByDriver: new Map(),
  activeConnectionsByImei: new Map(),
  pendingCommandsByImei: new Map(),
  sentCommands: 0,
  commandResponses: 0,
  commandTimeouts: 0,
  commandErrors: 0,
  commandHistory: [],
  commandTableAvailable: true,
  historyTableAvailable: true,
  telemetryTableAvailable: true,
  telemetryWrites: 0,
  telemetryEvents: 0,
};

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
};

loadEnvFile(ENV_PATH);

const getEnv = (key, fallback = '') => process.env[key] || fallback;
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const LOG_LEVEL = String(getEnv('LOG_LEVEL', 'info')).trim().toLowerCase();
const TCP_HOST = getEnv('TELTONIKA_TCP_HOST', '0.0.0.0');
const TCP_PORT = toInt(getEnv('TELTONIKA_TCP_PORT', '5027'), 5027);
const HEALTH_PORT = toInt(getEnv('TELTONIKA_HEALTH_PORT', '8788'), 8788);
const SUPABASE_URL = getEnv('SUPABASE_URL', getEnv('VITE_SUPABASE_URL', ''));
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', getEnv('VITE_SUPABASE_KEY', ''));
const SOURCE = getEnv('TELTONIKA_SOURCE', SOURCE_NAME);
const ACTIVE_JOB_CACHE_MS = toInt(getEnv('TELTONIKA_ACTIVE_JOB_CACHE_MS', '15000'), 15000);
const LIVE_VIEW_SYNC_INTERVAL_MS = toInt(getEnv('LIVE_VIEW_SYNC_INTERVAL_MS', '12000'), 12000);
const LIVE_JUMP_WINDOW_SEC = toInt(getEnv('TELTONIKA_LIVE_JUMP_WINDOW_SEC', '180'), 180);
// Records aelter als dieses Alter (Sekunden) werden komplett verworfen. 0 = aus.
// Verhindert, dass ein Tracker nach Verbindungsabbruch stundenalte Positionen nachliefert.
const MAX_RECORD_AGE_SEC = toInt(getEnv('TELTONIKA_MAX_RECORD_AGE_SEC', '600'), 600);
// Nur Fahrten mit ride_date in diesem Fenster um heute gelten als Kandidat fuer die aktive Fahrt.
// Sonst wird eine monatealte, nie abgeschlossene Fahrt zur Live-Fahrt (und loest Routen-/Flug-Syncs aus).
const JOB_WINDOW_DAYS = toInt(getEnv('TELTONIKA_JOB_WINDOW_DAYS', '1'), 1);
const LIVE_JUMP_MAX_METERS_AT_STANDSTILL = toInt(getEnv('TELTONIKA_LIVE_JUMP_MAX_METERS', '1500'), 1500);
const LIVE_JUMP_MIN_SPEED_MPS = Number(getEnv('TELTONIKA_LIVE_JUMP_MIN_SPEED_MPS', '2'));
const MIN_SATELLITES_FOR_FIX = toInt(getEnv('TELTONIKA_MIN_SATELLITES_FOR_FIX', '1'), 1);
const BLOCK_NO_GPS_FIX_FOR_LIVE = String(getEnv('TELTONIKA_BLOCK_NO_GPS_FIX_FOR_LIVE', 'false')).trim().toLowerCase() === 'true';
const ZERO_COORD_EPSILON = Number(getEnv('TELTONIKA_ZERO_COORD_EPSILON', '0.0001'));
const COMMAND_RESPONSE_TIMEOUT_MS = toInt(getEnv('TELTONIKA_COMMAND_RESPONSE_TIMEOUT_MS', '15000'), 15000);
const COMMAND_DEFAULT = String(getEnv('TELTONIKA_COMMAND_DEFAULT', 'getgps')).trim() || 'getgps';
const COMMAND_TOKEN = String(getEnv('TELTONIKA_COMMAND_TOKEN', '')).trim();
const COMMAND_HISTORY_LIMIT = toInt(getEnv('TELTONIKA_COMMAND_HISTORY_LIMIT', '100'), 100);
const OPEN_JOB_STATUSES = ['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen'];
const AT_PICKUP_JOB_STATUSES = ['at_pickup', 'pickup', 'beim_pickup', 'beim pickup'];
const IN_PROGRESS_JOB_STATUSES = ['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
const AUTO_ACTIVE_STATUSES = Array.from(
  new Set([...OPEN_JOB_STATUSES, ...AT_PICKUP_JOB_STATUSES, ...IN_PROGRESS_JOB_STATUSES]),
);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Fehlende Supabase Konfiguration. Benoetigt: SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sanitizeTextForDbLogs = (value) => String(value || '').replace(/\u0000/g, '');
const sanitizeForDbLogs = (value) => {
  if (typeof value === 'string') return sanitizeTextForDbLogs(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeForDbLogs(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeForDbLogs(entry)]),
    );
  }
  return value;
};

const log = (level, event, fields = {}) => {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] ?? 20) < (order[LOG_LEVEL] ?? 20)) return;
  const payload = sanitizeForDbLogs({ ts: new Date().toISOString(), level, event, ...fields });
  console.log(JSON.stringify(payload));
};

const toSignedInt32 = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
const asIsoFromMs = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return new Date().toISOString();
  return new Date(ms).toISOString();
};
const toRadians = (value) => (value * Math.PI) / 180;
const haversineMeters = (from, to) => {
  const fromLat = Number(from?.lat);
  const fromLng = Number(from?.lng);
  const toLat = Number(to?.lat);
  const toLng = Number(to?.lng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return null;
  const earthRadiusM = 6371000;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
};
const isFiniteCoordinate = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
const isNearZeroCoordinate = (lat, lng) => Math.abs(Number(lat)) <= ZERO_COORD_EPSILON && Math.abs(Number(lng)) <= ZERO_COORD_EPSILON;
let commandSeq = 0;
const nextCommandId = () => {
  commandSeq += 1;
  return `cmd_${Date.now()}_${commandSeq}`;
};
const pushLimited = (list, item, limit = COMMAND_HISTORY_LIMIT) => {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
};
const toPlainState = () => ({
  ...state,
  mappingCache: { size: state.mappingCache.size },
  activeJobsCache: { size: state.activeJobsCache.size },
  routeEndpointsCache: { size: state.routeEndpointsCache.size },
  writeQueueByImei: { size: state.writeQueueByImei.size },
  liveViewSyncByDriver: { size: state.liveViewSyncByDriver.size },
  activeConnectionsByImei: { size: state.activeConnectionsByImei.size },
  pendingCommandsByImei: Object.fromEntries(
    Array.from(state.pendingCommandsByImei.entries()).map(([imei, queue]) => [imei, queue.length]),
  ),
  commandHistory: state.commandHistory,
});
const writeJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};
const readJsonBody = async (req, maxBytes = 64 * 1024) =>
  new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error(`Request body too large (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error?.message || 'parse error'}`));
      }
    });
    req.on('error', reject);
  });
const crc16Ibm = (buffer) => {
  let crc = 0x0000;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 1) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xFFFF;
};
const buildCodec12CommandFrame = (commandText) => {
  const command = String(commandText || '').trim();
  if (!command) throw new Error('Command text is empty');
  const commandBytes = Buffer.from(command, 'ascii');
  const payload = Buffer.alloc(1 + 1 + 1 + 4 + commandBytes.length + 1);
  let offset = 0;
  payload.writeUInt8(0x0C, offset); offset += 1; // codec id
  payload.writeUInt8(0x01, offset); offset += 1; // quantity 1
  payload.writeUInt8(0x05, offset); offset += 1; // type: command
  payload.writeUInt32BE(commandBytes.length, offset); offset += 4;
  commandBytes.copy(payload, offset); offset += commandBytes.length;
  payload.writeUInt8(0x01, offset); // quantity 2

  const preamble = Buffer.alloc(4, 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16Ibm(payload), 0);
  return Buffer.concat([preamble, length, payload, crc]);
};

const cursor = (buffer) => ({
  offset: 0,
  remaining() {
    return buffer.length - this.offset;
  },
  ensure(length) {
    if (this.offset + length > buffer.length) {
      throw new Error(`Buffer underrun at ${this.offset}, need ${length}, have ${this.remaining()}`);
    }
  },
  u8() {
    this.ensure(1);
    const value = buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  },
  u16() {
    this.ensure(2);
    const value = buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  },
  u32() {
    this.ensure(4);
    const value = buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  },
  i32() {
    this.ensure(4);
    const raw = buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return toSignedInt32(raw);
  },
  i64Ms() {
    this.ensure(8);
    const value = Number(buffer.readBigInt64BE(this.offset));
    this.offset += 8;
    return value;
  },
  bytes(length) {
    this.ensure(length);
    const value = buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  },
});

// Teltonika AVL-IDs (FMB-Serie). Vorzeichenbehaftete Temperaturen sind markiert.
const IO_SIGNED_IDS = new Set([32, 53, 58]);
const bytesToNumber = (bytes, signed) => {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  if (signed) {
    const bits = BigInt(bytes.length * 8);
    if (value >= (1n << (bits - 1n))) value -= (1n << bits);
  }
  return Number(value);
};

const parseCodec8Io = (c) => {
  const eventIoId = c.u8();
  c.u8(); // total io count
  const io = new Map();
  [1, 2, 4, 8].forEach((size) => {
    const count = c.u8();
    for (let i = 0; i < count; i += 1) {
      const id = c.u8();
      io.set(id, bytesToNumber(c.bytes(size), IO_SIGNED_IDS.has(id)));
    }
  });
  return { eventIoId, io, ioText: new Map() };
};

const parseCodec8eIo = (c) => {
  const eventIoId = c.u16();
  c.u16(); // total io count
  const io = new Map();
  const ioText = new Map();
  [1, 2, 4, 8].forEach((size) => {
    const count = c.u16();
    for (let i = 0; i < count; i += 1) {
      const id = c.u16();
      io.set(id, bytesToNumber(c.bytes(size), IO_SIGNED_IDS.has(id)));
    }
  });
  const nxCount = c.u16();
  for (let i = 0; i < nxCount; i += 1) {
    const id = c.u16();
    const len = c.u16();
    const raw = c.bytes(len);
    ioText.set(id, sanitizeTextForDbLogs(raw.toString('ascii')).trim());
  }
  return { eventIoId, io, ioText };
};

// Aus den rohen IO-Werten die Fahrzeugdaten lesen, die wir speichern.
// Fehlt ein Element im Paket, bleibt das Feld weg (Upsert ueberschreibt dann nicht).
const IO_FIELDS = [
  [239, 'ignition', (v) => v === 1],
  [240, 'movement', (v) => v === 1],
  [21, 'gsm_signal', (v) => v],
  [66, 'ext_voltage_v', (v) => v / 1000],
  [67, 'battery_voltage_v', (v) => v / 1000],
  [16, 'total_odometer_km', (v) => v / 1000],
  [199, 'trip_odometer_km', (v) => v / 1000],
  [30, 'dtc_count', (v) => v],
  [31, 'engine_load_pct', (v) => v],
  [32, 'coolant_c', (v) => v],
  [36, 'rpm', (v) => v],
  [37, 'obd_speed_kph', (v) => v],
  [41, 'throttle_pct', (v) => v],
  [42, 'engine_runtime_s', (v) => v],
  [43, 'mil_distance_km', (v) => v],
  [48, 'fuel_level_pct', (v) => v],
  [51, 'control_module_voltage_v', (v) => v / 1000],
  [53, 'ambient_c', (v) => v],
  [58, 'oil_temp_c', (v) => v],
  [60, 'fuel_rate_lph', (v) => v / 100],
  [389, 'oem_mileage_km', (v) => v],
  [390, 'oem_fuel_l', (v) => v / 10],
  [755, 'oem_remaining_distance_km', (v) => v],
  [12, 'fuel_used_gps_l', (v) => v / 1000],
];
const IO_TEXT_FIELDS = [
  [256, 'vin'],
  [281, 'fault_codes'],
];
const extractTelemetry = (record) => {
  const out = {};
  let any = false;
  if (record.io) {
    for (const [id, field, map] of IO_FIELDS) {
      if (record.io.has(id)) { out[field] = map(record.io.get(id)); any = true; }
    }
  }
  if (record.ioText) {
    for (const [id, field] of IO_TEXT_FIELDS) {
      const text = record.ioText.get(id);
      if (text) { out[field] = text; any = true; }
    }
  }
  return any ? out : null;
};

// Ereignisse, die das Geraet selbst meldet (Event-IO-ID des Datensatzes).
const describeEvent = (record) => {
  const id = record.eventIoId;
  if (!id || !record.io) return null;
  const v = record.io.get(id);
  switch (id) {
    case 239: return { type: v === 1 ? 'ignition_on' : 'ignition_off', value: v };
    case 250: return { type: v === 1 ? 'trip_start' : 'trip_end', value: v };
    case 251: return { type: v === 1 ? 'idling_start' : 'idling_end', value: v };
    case 252: return { type: v === 1 ? 'unplugged' : 'plugged_in', value: v };
    case 253: {
      const art = { 1: 'harsh_acceleration', 2: 'harsh_braking', 3: 'harsh_cornering' }[v] || 'eco_driving';
      return { type: art, value: record.io.get(254) ?? v };
    }
    case 255: return { type: 'overspeeding', value: v };
    case 247: return { type: 'crash', value: v };
    case 249: return { type: 'jamming', value: v };
    case 236: return { type: 'alarm', value: v };
    case 246: return { type: 'towing', value: v };
    default: return null;
  }
};

const parseAvlPayload = (payload) => {
  const c = cursor(payload);
  const codec = c.u8();
  const isCodec8 = codec === 0x08;
  const isCodec8e = codec === 0x8e;
  if (!isCodec8 && !isCodec8e) {
    throw new Error(`Unsupported codec ${codec}`);
  }

  const declaredCount = c.u8();
  const records = [];

  for (let i = 0; i < declaredCount; i += 1) {
    const tsMs = c.i64Ms();
    c.u8(); // priority
    const lngRaw = c.i32();
    const latRaw = c.i32();
    const altitude = c.u16();
    const angle = c.u16();
    const satellites = c.u8();
    const speedKph = c.u16();
    const ioData = isCodec8 ? parseCodec8Io(c) : parseCodec8eIo(c);
    records.push({
      capturedAt: asIsoFromMs(tsMs),
      lat: latRaw / 10_000_000,
      lng: lngRaw / 10_000_000,
      speedKph,
      headingDeg: angle,
      satellites,
      altitude,
      eventIoId: ioData.eventIoId,
      io: ioData.io,
      ioText: ioData.ioText,
    });
  }

  const count2 = c.u8();
  if (count2 !== declaredCount) {
    throw new Error(`Record count mismatch ${declaredCount} != ${count2}`);
  }
  if (c.remaining() !== 0) {
    throw new Error(`Trailing bytes in AVL payload: ${c.remaining()}`);
  }

  return { codec, declaredCount, records };
};

const parseCodec12Payload = (payload) => {
  const c = cursor(payload);
  const codec = c.u8();
  if (codec !== 0x0C) throw new Error(`Unsupported codec ${codec}`);
  const declaredCount = c.u8();
  const messages = [];
  for (let i = 0; i < declaredCount; i += 1) {
    const type = c.u8();
    const size = c.u32();
    const body = c.bytes(size);
    messages.push({
      type,
      size,
      text: sanitizeTextForDbLogs(body.toString('ascii')).trim(),
      hex: body.toString('hex'),
    });
  }
  const count2 = c.u8();
  if (count2 !== declaredCount) {
    throw new Error(`Codec12 record count mismatch ${declaredCount} != ${count2}`);
  }
  if (c.remaining() !== 0) {
    throw new Error(`Trailing bytes in Codec12 payload: ${c.remaining()}`);
  }
  return { codec, declaredCount, messages };
};

const parseTeltonikaFrame = (buffer) => {
  if (buffer.length < 12) return null;
  const preamble = buffer.readUInt32BE(0);
  if (preamble !== 0) {
    return { malformed: true, consumed: 1, reason: `Invalid preamble ${preamble}` };
  }
  const dataLength = buffer.readUInt32BE(4);
  const totalLength = 8 + dataLength + 4;
  if (buffer.length < totalLength) return null;

  const payload = buffer.subarray(8, 8 + dataLength);
  try {
    const codec = payload.readUInt8(0);
    if (codec === 0x08 || codec === 0x8e) {
      const parsed = parseAvlPayload(payload);
      return {
        consumed: totalLength,
        kind: 'avl',
        ackCount: parsed.declaredCount,
        codec: parsed.codec,
        records: parsed.records,
      };
    }
    if (codec === 0x0C) {
      const parsed = parseCodec12Payload(payload);
      return {
        consumed: totalLength,
        kind: 'codec12',
        codec: parsed.codec,
        messages: parsed.messages,
      };
    }
    throw new Error(`Unsupported frame codec ${codec}`);
  } catch (error) {
    return {
      malformed: true,
      consumed: totalLength,
      reason: error?.message || 'Unknown parse error',
    };
  }
};

const readImeiFrame = (buffer) => {
  if (buffer.length < 2) return null;
  const imeiLength = buffer.readUInt16BE(0);
  if (imeiLength <= 0 || imeiLength > 64) {
    return { malformed: true, consumed: 1, reason: `Invalid IMEI length ${imeiLength}` };
  }
  if (buffer.length < 2 + imeiLength) return null;
  const imei = buffer.subarray(2, 2 + imeiLength).toString('ascii').trim();
  if (!/^\d{14,17}$/.test(imei)) {
    return { malformed: true, consumed: 2 + imeiLength, reason: `Invalid IMEI "${imei}"` };
  }
  return { consumed: 2 + imeiLength, imei };
};

const normalizeJobStatus = (value) => String(value || '').trim().toLowerCase();

const toTimestamp = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const toMinutesFromPgTime = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return (Number(match[1]) * 60) + Number(match[2]);
};

const jobPriority = (job) => {
  const status = normalizeJobStatus(job?.status);
  if (IN_PROGRESS_JOB_STATUSES.includes(status)) return 0;
  if (AT_PICKUP_JOB_STATUSES.includes(status)) return 1;
  if (OPEN_JOB_STATUSES.includes(status)) return 2;
  return 9;
};

const compareJobs = (left, right) => {
  const byPriority = jobPriority(left) - jobPriority(right);
  if (byPriority !== 0) return byPriority;

  const rideDateLeft = String(left?.ride_date || '');
  const rideDateRight = String(right?.ride_date || '');
  if (rideDateLeft !== rideDateRight) return rideDateLeft.localeCompare(rideDateRight);

  const etdLeft = toMinutesFromPgTime(left?.etd);
  const etdRight = toMinutesFromPgTime(right?.etd);
  if (etdLeft !== etdRight) return etdLeft - etdRight;

  return toTimestamp(left?.created_at) - toTimestamp(right?.created_at);
};

const jobDateWindow = () => {
  const toYmd = (date) => date.toISOString().slice(0, 10);
  const now = new Date();
  const from = new Date(now); from.setUTCDate(from.getUTCDate() - JOB_WINDOW_DAYS);
  const to = new Date(now); to.setUTCDate(to.getUTCDate() + JOB_WINDOW_DAYS);
  return { from: toYmd(from), to: toYmd(to) };
};

const fetchDriverCandidateJobs = async (driverId) => {
  const baseSelect = 'id,driver_id,status,ride_date,etd,created_at';
  const window = jobDateWindow();
  const [directJobsResult, convoyAssignmentsResult] = await Promise.all([
    supabase
      .from('jobs')
      .select(baseSelect)
      .eq('driver_id', driverId)
      .in('status', AUTO_ACTIVE_STATUSES)
      .gte('ride_date', window.from)
      .lte('ride_date', window.to)
      .order('ride_date', { ascending: true })
      .order('etd', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20),
    supabase
      .from('convoy_assignments')
      .select('job_id,response_status')
      .eq('driver_id', driverId)
      .limit(50),
  ]);

  if (directJobsResult.error) throw directJobsResult.error;
  if (convoyAssignmentsResult.error) throw convoyAssignmentsResult.error;

  const directJobs = Array.isArray(directJobsResult.data) ? directJobsResult.data : [];
  const assignments = Array.isArray(convoyAssignmentsResult.data) ? convoyAssignmentsResult.data : [];
  const convoyJobIds = Array.from(
    new Set(
      assignments
        .filter((row) => normalizeJobStatus(row?.response_status) !== 'refused')
        .map((row) => row?.job_id)
        .filter(Boolean),
    ),
  );

  let convoyJobs = [];
  if (convoyJobIds.length > 0) {
    const convoyJobsResult = await supabase
      .from('jobs')
      .select(baseSelect)
      .in('id', convoyJobIds)
      .in('status', AUTO_ACTIVE_STATUSES)
      .gte('ride_date', window.from)
      .lte('ride_date', window.to);
    if (convoyJobsResult.error) throw convoyJobsResult.error;
    convoyJobs = Array.isArray(convoyJobsResult.data) ? convoyJobsResult.data : [];
  }

  const mergedMap = new Map();
  [...directJobs, ...convoyJobs].forEach((job) => {
    if (!job?.id) return;
    mergedMap.set(job.id, job);
  });

  return Array.from(mergedMap.values()).sort(compareJobs);
};

const getDriverCandidateJobs = async (driverId, forceRefresh = false) => {
  const now = Date.now();
  const cached = state.activeJobsCache.get(driverId);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.jobs;
  const jobs = await fetchDriverCandidateJobs(driverId);
  state.activeJobsCache.set(driverId, { jobs, expiresAt: now + ACTIVE_JOB_CACHE_MS });
  return jobs;
};

const resolveActiveJobId = async (driverId, latestRecord) => {
  void latestRecord;
  const jobs = await getDriverCandidateJobs(driverId);
  if (!jobs.length) return null;
  return jobs[0]?.id || null;
};

const pickLiveSyncJobIds = (jobs, activeJobId) => {
  const selected = [];
  const seen = new Set();
  const add = (jobId) => {
    const normalized = String(jobId || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    selected.push(normalized);
  };

  add(activeJobId);

  (Array.isArray(jobs) ? jobs : [])
    .filter((job) => {
      const status = normalizeJobStatus(job?.status);
      return IN_PROGRESS_JOB_STATUSES.includes(status) || AT_PICKUP_JOB_STATUSES.includes(status);
    })
    .forEach((job) => add(job?.id));

  if (selected.length === 0) {
    const firstOpen = (Array.isArray(jobs) ? jobs : []).find((job) => OPEN_JOB_STATUSES.includes(normalizeJobStatus(job?.status)));
    add(firstOpen?.id);
  }

  return selected.slice(0, 3);
};

const invokeExternalSyncLiveView = async (driverId, jobIds, currentLocation, capturedAt) => {
  const normalizedDriverId = String(driverId || '').trim();
  const normalizedJobIds = Array.from(new Set(
    (Array.isArray(jobIds) ? jobIds : [])
      .map((jobId) => String(jobId || '').trim())
      .filter(Boolean),
  ));
  if (!normalizedDriverId || !normalizedJobIds.length) return;

  const now = Date.now();
  const syncState = state.liveViewSyncByDriver.get(normalizedDriverId);
  if (syncState?.inFlight) return;
  if (syncState?.lastAt && (now - syncState.lastAt) < LIVE_VIEW_SYNC_INTERVAL_MS) return;

  state.liveViewSyncByDriver.set(normalizedDriverId, { inFlight: true, lastAt: syncState?.lastAt || 0 });
  try {
    const payload = {
      reason: 'live_view',
      job_ids: normalizedJobIds,
      requested_by: normalizedDriverId,
      current_location: currentLocation && Number.isFinite(currentLocation.lat) && Number.isFinite(currentLocation.lng)
        ? { lat: Number(currentLocation.lat), lng: Number(currentLocation.lng) }
        : null,
    };
    const { data, error } = await supabase.functions.invoke('external-sync', { body: payload });
    if (error) {
      throw new Error(error.message || 'external-sync invoke failed');
    }
    state.liveViewSyncByDriver.set(normalizedDriverId, { inFlight: false, lastAt: now });
    log('debug', 'live_view_sync_ok', {
      driverId: normalizedDriverId,
      jobs: normalizedJobIds.length,
      capturedAt: capturedAt || null,
      processed: Number(data?.processed_jobs || 0),
    });
  } catch (error) {
    state.liveViewSyncByDriver.set(normalizedDriverId, { inFlight: false, lastAt: syncState?.lastAt || 0 });
    log('warn', 'live_view_sync_failed', {
      driverId: normalizedDriverId,
      jobs: normalizedJobIds.length,
      capturedAt: capturedAt || null,
      error: error?.message || 'unknown error',
    });
  }
};

const getDriverIdByImei = async (imei) => {
  const now = Date.now();
  const cached = state.mappingCache.get(imei);
  if (cached && cached.expiresAt > now) return cached.driverId;

  const { data, error } = await supabase
    .from('imei_driver_map')
    .select('driver_id')
    .eq('imei', imei)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;

  const driverId = data?.driver_id || null;
  state.mappingCache.set(imei, { driverId, expiresAt: now + MAPPING_CACHE_MS });
  return driverId;
};

const getCommandQueue = (imei) => {
  const key = String(imei || '').trim();
  if (!key) return null;
  if (!state.pendingCommandsByImei.has(key)) state.pendingCommandsByImei.set(key, []);
  return state.pendingCommandsByImei.get(key);
};

// Befehls-Warteschlange in der DB (public.obd_tracker_befehl): ueberlebt Neustarts, die Dispo
// legt dort Stufen-Befehle an (obd_tracker.stufe) und sieht die Quittung. Fehlt die Tabelle
// (Migration noch nicht eingespielt), bleibt die alte Warteschlange im Speicher in Betrieb.
const DB_COMMAND_POLL_MS = toInt(getEnv('TELTONIKA_DB_COMMAND_POLL_MS', '20000'), 20000);
const DB_COMMAND_MAX_TRIES = toInt(getEnv('TELTONIKA_DB_COMMAND_MAX_TRIES', '3'), 3);
const DB_COMMAND_CHECK_MIN_MS = 10_000;

const markDbCommand = async (dbId, fields, { nurOffen = false } = {}) => {
  if (!dbId) return;
  let query = supabase.from('obd_tracker_befehl').update(fields).eq('id', dbId);
  if (nurOffen) query = query.in('status', ['offen', 'gesendet']);
  const { error } = await query;
  if (error) log('warn', 'db_command_update_failed', { dbId, fields, detail: error.message });
};

const insertDbCommand = async ({ imei, command }) => {
  if (!state.commandTableAvailable) return null;
  const { data, error } = await supabase
    .from('obd_tracker_befehl')
    .insert({ imei, befehl: command, art: 'manuell' })
    .select('id')
    .single();
  if (error) {
    if (RELATION_MISSING_RE.test(error.message || '')) {
      state.commandTableAvailable = false;
      log('warn', 'command_table_unavailable', { detail: error.message });
      return null;
    }
    throw error;
  }
  return data?.id ?? null;
};

const enqueueCommand = async ({ imei, command, requestedBy = 'manual' }) => {
  const normalizedImei = String(imei || '').trim();
  const normalizedCommand = String(command || COMMAND_DEFAULT).trim();
  if (!/^\d{14,17}$/.test(normalizedImei)) {
    throw new Error(`Invalid IMEI "${normalizedImei}"`);
  }
  if (!normalizedCommand) {
    throw new Error('Command is empty');
  }

  const dbId = await insertDbCommand({ imei: normalizedImei, command: normalizedCommand });
  if (dbId) {
    const commandItem = { id: `db_${dbId}`, dbId, imei: normalizedImei, command: normalizedCommand, requestedBy };
    pushLimited(state.commandHistory, {
      id: commandItem.id,
      imei: normalizedImei,
      command: normalizedCommand,
      status: 'queued',
      ts: new Date().toISOString(),
      requestedBy,
    });
    return { commandItem, queueSize: null };
  }

  const commandItem = {
    id: nextCommandId(),
    imei: normalizedImei,
    command: normalizedCommand,
    requestedBy: String(requestedBy || 'manual'),
    enqueuedAt: new Date().toISOString(),
  };
  const queue = getCommandQueue(normalizedImei);
  queue.push(commandItem);
  pushLimited(state.commandHistory, {
    id: commandItem.id,
    imei: normalizedImei,
    command: normalizedCommand,
    status: 'queued',
    ts: commandItem.enqueuedAt,
    requestedBy: commandItem.requestedBy,
  });
  return { commandItem, queueSize: queue.length };
};

const clearInFlightCommand = (connection, { status, detail = null } = {}) => {
  if (!connection?.commandInFlight) return null;
  const current = connection.commandInFlight;
  if (current.timer) clearTimeout(current.timer);
  connection.commandInFlight = null;
  if (status) {
    pushLimited(state.commandHistory, {
      id: current.id,
      imei: current.imei,
      command: current.command,
      status,
      ts: new Date().toISOString(),
      detail,
    });
  }
  return current;
};

// Naechsten offenen DB-Befehl fuer diese Verbindung holen (hoechstens alle 10 s, ausser force).
const fetchNextDbCommand = async (connection, force) => {
  if (!state.commandTableAvailable || connection.dbCommandLoading) return;
  const now = Date.now();
  if (!force && now - (connection.dbCommandCheckedAt || 0) < DB_COMMAND_CHECK_MIN_MS) return;
  connection.dbCommandLoading = true;
  connection.dbCommandCheckedAt = now;
  try {
    const { data, error } = await supabase
      .from('obd_tracker_befehl')
      .select('id, befehl, art, stufe, versuche')
      .eq('imei', connection.imei)
      .in('status', ['offen', 'gesendet'])
      .order('id', { ascending: true })
      .limit(1);
    if (error) {
      if (RELATION_MISSING_RE.test(error.message || '')) {
        state.commandTableAvailable = false;
        log('warn', 'command_table_unavailable', { detail: error.message });
        return;
      }
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return;
    if (connection.commandInFlight || connection.socket.destroyed) return;
    if (state.activeConnectionsByImei.get(connection.imei) !== connection) return;
    sendCommand(connection, {
      id: `db_${row.id}`,
      dbId: row.id,
      dbTries: Number(row.versuche) || 0,
      art: row.art,
      imei: connection.imei,
      command: row.befehl,
      requestedBy: row.art === 'stufe' ? `stufe_${row.stufe}` : 'db',
    });
  } catch (error) {
    log('warn', 'db_command_fetch_failed', { imei: connection.imei, detail: error?.message || String(error) });
  } finally {
    connection.dbCommandLoading = false;
  }
};

const sendNextCommandIfIdle = (connection, { force = false } = {}) => {
  if (!connection?.imei || !connection?.socket) return;
  if (connection.commandInFlight) return;
  const queue = state.pendingCommandsByImei.get(connection.imei);
  if (!Array.isArray(queue) || queue.length === 0) {
    fetchNextDbCommand(connection, force);
    return;
  }

  const next = queue.shift();
  if (queue.length === 0) state.pendingCommandsByImei.delete(connection.imei);
  if (!next) return;
  sendCommand(connection, next);
};

const sendCommand = (connection, next) => {
  let frame;
  try {
    frame = buildCodec12CommandFrame(next.command);
  } catch (error) {
    state.commandErrors += 1;
    pushLimited(state.commandHistory, {
      id: next.id,
      imei: next.imei,
      command: next.command,
      status: 'failed_encode',
      ts: new Date().toISOString(),
      detail: error?.message || 'encode_failed',
    });
    markDbCommand(next.dbId, { status: 'fehler', antwort: error?.message || 'encode_failed', quittiert_am: new Date().toISOString() });
    return;
  }

  const inFlight = {
    ...next,
    sentAt: new Date().toISOString(),
    timer: null,
  };
  connection.commandInFlight = inFlight;
  inFlight.timer = setTimeout(() => {
    state.commandTimeouts += 1;
    clearInFlightCommand(connection, { status: 'timeout', detail: 'no_codec12_response' });
    if (inFlight.dbId) {
      // Nochmal versuchen, nach DB_COMMAND_MAX_TRIES Sendungen ohne Antwort als Fehler quittieren.
      const aufgeben = inFlight.dbTries + 1 >= DB_COMMAND_MAX_TRIES;
      Promise.resolve(inFlight.dbSent).then(() => markDbCommand(inFlight.dbId, aufgeben
        ? { status: 'fehler', antwort: 'keine Antwort vom Tracker', quittiert_am: new Date().toISOString() }
        : { status: 'offen' }))
        .finally(() => sendNextCommandIfIdle(connection, { force: true }));
      return;
    }
    sendNextCommandIfIdle(connection);
  }, COMMAND_RESPONSE_TIMEOUT_MS);

  connection.socket.write(frame, (error) => {
    if (error) {
      state.commandErrors += 1;
      clearInFlightCommand(connection, { status: 'failed_send', detail: error?.message || 'socket_write_failed' });
      return;
    }
    state.sentCommands += 1;
    // Quittung/Timeout warten auf dieses Update, sonst ueberschreibt 'gesendet' die Quittung.
    inFlight.dbSent = markDbCommand(inFlight.dbId, {
      status: 'gesendet',
      gesendet_am: inFlight.sentAt,
      versuche: (inFlight.dbTries || 0) + 1,
    }, { nurOffen: true });
    pushLimited(state.commandHistory, {
      id: inFlight.id,
      imei: inFlight.imei,
      command: inFlight.command,
      status: 'sent',
      ts: inFlight.sentAt,
      timeoutMs: COMMAND_RESPONSE_TIMEOUT_MS,
    });
    log('info', 'codec12_command_sent', {
      imei: inFlight.imei,
      commandId: inFlight.id,
      command: inFlight.command,
      timeoutMs: COMMAND_RESPONSE_TIMEOUT_MS,
    });
  });
};

const handleCodec12Message = (connection, message) => {
  state.commandResponses += 1;
  const responseText = String(message?.text || '').trim();
  const inFlight = clearInFlightCommand(connection, {
    status: 'response',
    detail: responseText || message?.hex || null,
  });
  log('info', 'codec12_response', {
    imei: connection?.imei || null,
    commandId: inFlight?.id || null,
    command: inFlight?.command || null,
    type: message?.type ?? null,
    response: responseText || null,
  });
  let quittung = null;
  if (inFlight?.dbId) {
    // setparam bestaetigt der Tracker mit "New value ...", alles andere gilt als Fehler.
    const istSetparam = /^setparam\b/i.test(inFlight.command || '');
    const ok = !istSetparam || /^New value/i.test(responseText);
    quittung = Promise.resolve(inFlight.dbSent).then(() => markDbCommand(inFlight.dbId, {
      status: ok ? 'quittiert' : 'fehler',
      antwort: (responseText || message?.hex || '').slice(0, 500) || null,
      quittiert_am: new Date().toISOString(),
    }));
  }
  const vinTreffer = /VIN:([A-Za-z0-9]{17})\b/.exec(responseText || '');
  if (vinTreffer && connection?.imei) {
    getDriverIdByImei(connection.imei)
      .then((driverId) => saveVehicleVin(driverId, vinTreffer[1], 'obdinfo'))
      .catch((err) => log('warn', 'vin_from_command_failed', { detail: err?.message || String(err) }));
  }
  // Erst quittieren, dann den naechsten holen, sonst kommt derselbe DB-Befehl nochmal.
  if (quittung) quittung.finally(() => sendNextCommandIfIdle(connection, { force: true }));
  else sendNextCommandIfIdle(connection, { force: true });
};

// Echte Fahrgestellnummer aus dem OBD ins Fahrzeug des Fahrers uebernehmen
// (vehicles.vin). Nur gueltige 17-stellige VINs, jede nur einmal je Fahrer.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const savedVinByDriver = new Map();
const saveVehicleVin = async (driverId, rawVin, quelle) => {
  const vin = String(rawVin || '').trim().toUpperCase();
  if (!driverId || !VIN_RE.test(vin)) return;
  if (savedVinByDriver.get(driverId) === vin) return;
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('vehicle_id').eq('id', driverId).maybeSingle();
  if (profileError || !profile?.vehicle_id) {
    log('warn', 'vin_no_vehicle', { driverId, vin, detail: profileError?.message || null });
    return;
  }
  const { error } = await supabase.from('vehicles').update({ vin }).eq('id', profile.vehicle_id);
  if (error) {
    log('warn', 'vin_update_failed', { driverId, vin, detail: error.message });
    return;
  }
  savedVinByDriver.set(driverId, vin);
  log('info', 'vin_saved', { driverId, vehicleId: profile.vehicle_id, vin, quelle });
};

// Fahrzeugdaten aus dem OBD: letzter Stand je Fahrer (vehicle_telemetry_live)
// und gemeldete Ereignisse (vehicle_telemetry_events).
const writeTelemetry = async (imei, driverId, activeJobId, records, latest) => {
  const sorted = [...records].sort((a, b) => Date.parse(a.capturedAt || '') - Date.parse(b.capturedAt || ''));
  // Letzten bekannten Wert je Feld ueber alle Datensaetze des Pakets zusammenfuehren,
  // damit seltene Elemente (VIN, Fehlercodes) nicht vom juengsten Datensatz verdeckt werden.
  const merged = {};
  for (const record of sorted) {
    const fields = extractTelemetry(record);
    if (fields) Object.assign(merged, fields);
  }
  const rawIo = latest?.io ? Object.fromEntries(Array.from(latest.io.entries()).map(([k, v]) => [String(k), v])) : null;

  const events = [];
  for (const record of sorted) {
    const event = describeEvent(record);
    if (!event) continue;
    const hatPos = isFiniteCoordinate(record.lat, record.lng) && !isNearZeroCoordinate(record.lat, record.lng);
    events.push({
      driver_id: driverId,
      imei,
      job_id: activeJobId,
      event_type: event.type,
      value: Number.isFinite(event.value) ? event.value : null,
      lat: hatPos ? record.lat : null,
      lng: hatPos ? record.lng : null,
      captured_at: record.capturedAt,
    });
  }

  const handleError = (error, where) => {
    if (RELATION_MISSING_RE.test(error.message || '')) {
      state.telemetryTableAvailable = false;
      log('warn', 'telemetry_table_unavailable', { where, detail: error.message });
      return true;
    }
    throw error;
  };

  if (Object.keys(merged).length > 0 || rawIo) {
    const liveRow = {
      driver_id: driverId,
      imei,
      captured_at: latest.capturedAt,
      raw_io: rawIo,
      ...merged,
    };
    const { error } = await supabase
      .from('vehicle_telemetry_live')
      .upsert(liveRow, { onConflict: 'driver_id' });
    if (error && handleError(error, 'live')) return;
    state.telemetryWrites += 1;
  }
  if (merged.vin) await saveVehicleVin(driverId, merged.vin, 'io_256');

  if (events.length > 0) {
    const { error } = await supabase.from('vehicle_telemetry_events').insert(events);
    if (error && handleError(error, 'events')) return;
    state.telemetryEvents += events.length;
    log('info', 'telemetry_events_written', { imei, driverId, events: events.map((e) => e.event_type) });
  }
};

const writeLocations = async (imei, records) => {
  if (!Array.isArray(records) || records.length === 0) return;
  if (MAX_RECORD_AGE_SEC > 0) {
    const cutoffMs = Date.now() - MAX_RECORD_AGE_SEC * 1000;
    const fresh = records.filter((record) => {
      const ts = Date.parse(record.capturedAt || '');
      return Number.isFinite(ts) && ts >= cutoffMs;
    });
    if (fresh.length !== records.length) {
      const dropped = records.length - fresh.length;
      state.oldRecordsDropped += dropped;
      log('info', 'old_records_dropped', { imei, dropped, kept: fresh.length, maxAgeSec: MAX_RECORD_AGE_SEC });
    }
    records = fresh;
    if (records.length === 0) return;
  }
  const driverId = await getDriverIdByImei(imei);
  if (!driverId) {
    state.unknownImeiPackets += 1;
    log('warn', 'unknown_imei_mapping', { imei, records: records.length });
    return;
  }

  // Ohne GPS-Fix seit dem Start liefert der Tracker 0/0. Solche Records duerfen weder den
  // Live-Standort noch den Verlauf ueberschreiben, Zuendung & Co. gehen trotzdem in die Telemetrie.
  const positionRecords = records.filter((record) =>
    isFiniteCoordinate(record.lat, record.lng) && !isNearZeroCoordinate(record.lat, record.lng));
  if (positionRecords.length === 0) {
    state.invalidLiveSkipped += records.length;
    log('info', 'records_without_fix', { imei, driverId, records: records.length });
    if (state.telemetryTableAvailable) {
      const newest = records[records.length - 1];
      await writeTelemetry(imei, driverId, null, records, newest);
    }
    return;
  }
  if (positionRecords.length !== records.length) {
    log('info', 'records_without_fix', { imei, driverId, records: records.length - positionRecords.length });
  }
  const telemetryRecords = records;
  records = positionRecords;

  // Teltonika kann Records je nach Gerät/Config in unterschiedlicher Reihenfolge liefern.
  // Für den Live-Standort immer den Datensatz mit dem neuesten capturedAt verwenden.
  const latest = records.reduce((best, current) => {
    if (!best) return current;
    const bestTs = Date.parse(best.capturedAt || '');
    const currentTs = Date.parse(current.capturedAt || '');
    if (!Number.isFinite(bestTs) && Number.isFinite(currentTs)) return current;
    if (Number.isFinite(bestTs) && !Number.isFinite(currentTs)) return best;
    if (!Number.isFinite(bestTs) && !Number.isFinite(currentTs)) return current;
    return currentTs >= bestTs ? current : best;
  }, null);
  if (!latest) return;
  if (!isFiniteCoordinate(latest.lat, latest.lng)) {
    state.invalidLiveSkipped += 1;
    log('warn', 'live_update_skipped_invalid_coordinate', {
      imei,
      driverId,
      lat: latest.lat,
      lng: latest.lng,
      capturedAt: latest.capturedAt,
    });
    return;
  }
  const latestCapturedAtMs = Date.parse(latest.capturedAt || '');
  let shouldUpdateLive = true;
  const existingLiveResult = await supabase
    .from('driver_live_locations')
    .select('captured_at')
    .eq('driver_id', driverId)
    .maybeSingle();
  if (existingLiveResult.error) throw existingLiveResult.error;

  const existingCapturedAtMs = Date.parse(existingLiveResult.data?.captured_at || '');
  if (Number.isFinite(existingCapturedAtMs) && Number.isFinite(latestCapturedAtMs)) {
    shouldUpdateLive = latestCapturedAtMs >= existingCapturedAtMs;
  }

  const activeJobId = await resolveActiveJobId(driverId, latest);
  if (shouldUpdateLive) {
    const liveRow = {
      driver_id: driverId,
      active_job_id: activeJobId,
      lat: latest.lat,
      lng: latest.lng,
      speed_mps: Number.isFinite(latest.speedKph) ? (latest.speedKph / 3.6) : null,
      heading_deg: Number.isFinite(latest.headingDeg) ? latest.headingDeg : null,
      source: SOURCE,
      captured_at: latest.capturedAt,
    };
    const { error: liveError } = await supabase
      .from('driver_live_locations')
      .upsert(liveRow, { onConflict: 'driver_id' });
    if (liveError) throw liveError;
  } else {
    log('debug', 'live_update_skipped_older_capture', {
      imei,
      driverId,
      incomingCapturedAt: latest.capturedAt,
      existingCapturedAt: existingLiveResult.data?.captured_at || null,
    });
  }

  const candidateJobs = await getDriverCandidateJobs(driverId);
  const liveSyncJobIds = pickLiveSyncJobIds(candidateJobs, activeJobId);
  if (shouldUpdateLive) {
    await invokeExternalSyncLiveView(
      driverId,
      liveSyncJobIds,
      { lat: latest.lat, lng: latest.lng },
      latest.capturedAt,
    );
  }

  if (state.historyTableAvailable) {
    const historyRows = records.map((record) => ({
      driver_id: driverId,
      job_id: activeJobId,
      lat: record.lat,
      lng: record.lng,
      speed_mps: Number.isFinite(record.speedKph) ? (record.speedKph / 3.6) : null,
      heading_deg: Number.isFinite(record.headingDeg) ? record.headingDeg : null,
      source: SOURCE,
      captured_at: record.capturedAt,
    }));
    const { error: historyError } = await supabase
      .from('driver_location_history')
      .insert(historyRows);
    if (historyError) {
      if (RELATION_MISSING_RE.test(historyError.message || '')) {
        state.historyTableAvailable = false;
        log('warn', 'history_table_unavailable', { detail: historyError.message });
      } else {
        throw historyError;
      }
    }
  }

  if (state.telemetryTableAvailable) {
    await writeTelemetry(imei, driverId, activeJobId, telemetryRecords, latest);
  }

  state.writesOk += records.length;
  log('info', 'locations_written', {
    imei,
    driverId,
    activeJobId,
    records: records.length,
    liveUpdated: shouldUpdateLive,
    lastCapturedAt: latest.capturedAt,
    lastLat: latest.lat,
    lastLng: latest.lng,
  });
};

const enqueueLocationWrite = (imei, records, onError) => {
  const previous = state.writeQueueByImei.get(imei) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => writeLocations(imei, records));
  state.writeQueueByImei.set(imei, current);
  current
    .catch((error) => {
      if (typeof onError === 'function') onError(error);
    })
    .finally(() => {
      if (state.writeQueueByImei.get(imei) === current) {
        state.writeQueueByImei.delete(imei);
      }
    });
};

const healthServer = http.createServer(async (req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (method === 'GET' && requestUrl.pathname === '/healthz') {
    writeJson(res, 200, {
      ok: true,
      source: SOURCE,
      tcpHost: TCP_HOST,
      tcpPort: TCP_PORT,
      ...toPlainState(),
    });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/commands') {
    const imei = String(requestUrl.searchParams.get('imei') || '').trim();
    if (imei) {
      writeJson(res, 200, {
        ok: true,
        imei,
        connected: state.activeConnectionsByImei.has(imei),
        queueSize: (state.pendingCommandsByImei.get(imei) || []).length,
        inFlight: state.activeConnectionsByImei.get(imei)?.commandInFlight || null,
      });
      return;
    }
    writeJson(res, 200, {
      ok: true,
      queues: Object.fromEntries(
        Array.from(state.pendingCommandsByImei.entries()).map(([key, queue]) => [key, queue.length]),
      ),
      activeConnections: Array.from(state.activeConnectionsByImei.keys()),
      sentCommands: state.sentCommands,
      commandResponses: state.commandResponses,
      commandTimeouts: state.commandTimeouts,
      commandErrors: state.commandErrors,
    });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/command') {
    try {
      if (COMMAND_TOKEN) {
        const headerToken = String(req.headers['x-command-token'] || '').trim();
        if (headerToken !== COMMAND_TOKEN) {
          writeJson(res, 403, { ok: false, error: 'invalid command token' });
          return;
        }
      }

      const body = await readJsonBody(req);
      let imei = String(body?.imei || '').trim();
      const driverId = String(body?.driverId || '').trim();
      if (!imei && driverId) {
        const mapResult = await supabase
          .from('imei_driver_map')
          .select('imei')
          .eq('driver_id', driverId)
          .eq('is_active', true)
          .maybeSingle();
        if (mapResult.error) throw mapResult.error;
        imei = String(mapResult.data?.imei || '').trim();
      }
      if (!imei) {
        writeJson(res, 400, { ok: false, error: 'imei (or driverId) is required' });
        return;
      }
      const command = String(body?.command || COMMAND_DEFAULT).trim();
      const requestedBy = String(body?.requestedBy || 'http_api').trim();
      const { commandItem, queueSize } = await enqueueCommand({ imei, command, requestedBy });
      const connection = state.activeConnectionsByImei.get(imei) || null;
      if (connection) sendNextCommandIfIdle(connection, { force: true });
      writeJson(res, 202, {
        ok: true,
        commandId: commandItem.id,
        imei,
        command,
        queueSize,
        connected: Boolean(connection),
      });
      return;
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error?.message || 'command enqueue failed' });
      return;
    }
  }

  writeJson(res, 404, { ok: false, error: 'not found' });
});

healthServer.listen(HEALTH_PORT, () => {
  log('info', 'health_server_started', { port: HEALTH_PORT });
});

const tcpServer = net.createServer((socket) => {
  state.connections += 1;
  const remote = `${socket.remoteAddress || '-'}:${socket.remotePort || '-'}`;
  const connection = {
    remote,
    imei: null,
    buffer: Buffer.alloc(0),
    socket,
    commandInFlight: null,
  };

  log('info', 'tcp_connect', { remote });

  const processBuffer = () => {
    while (connection.buffer.length > 0) {
      if (!connection.imei) {
        const imeiFrame = readImeiFrame(connection.buffer);
        if (!imeiFrame) return;
        connection.buffer = connection.buffer.subarray(imeiFrame.consumed);
        if (imeiFrame.malformed) {
          state.malformedPackets += 1;
          log('warn', 'imei_malformed', { remote, reason: imeiFrame.reason });
          continue;
        }

        connection.imei = imeiFrame.imei;
        state.activeConnectionsByImei.set(connection.imei, connection);
        socket.write(Buffer.from([0x01]));
        log('info', 'imei_identified', { remote, imei: connection.imei });
        sendNextCommandIfIdle(connection, { force: true });
        continue;
      }

      const frame = parseTeltonikaFrame(connection.buffer);
      if (!frame) return;
      connection.buffer = connection.buffer.subarray(frame.consumed);
      if (frame.malformed) {
        state.malformedPackets += 1;
        log('warn', 'teltonika_frame_malformed', { remote, imei: connection.imei, reason: frame.reason });
        socket.write(Buffer.from([0x00, 0x00, 0x00, 0x00]));
        continue;
      }

      if (frame.kind === 'avl') {
        state.packets += 1;
        state.records += frame.records.length;
        const ack = Buffer.alloc(4);
        ack.writeUInt32BE(frame.ackCount, 0);
        socket.write(ack);
        log('debug', 'avl_packet', {
          remote,
          imei: connection.imei,
          codec: `0x${frame.codec.toString(16)}`,
          ackCount: frame.ackCount,
        });
        enqueueLocationWrite(connection.imei, frame.records, (error) => {
          state.writesFailed += frame.records.length;
          log('error', 'write_failed', {
            imei: connection.imei,
            remote,
            error: error?.message || 'Unknown error',
          });
        });
        sendNextCommandIfIdle(connection);
        continue;
      }

      if (frame.kind === 'codec12') {
        (frame.messages || []).forEach((message) => handleCodec12Message(connection, message));
        continue;
      }
    }
  };

  socket.on('data', (chunk) => {
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    processBuffer();
  });

  socket.on('close', () => {
    if (connection.imei && state.activeConnectionsByImei.get(connection.imei) === connection) {
      state.activeConnectionsByImei.delete(connection.imei);
    }
    const inFlight = clearInFlightCommand(connection);
    // DB-Befehle bleiben 'gesendet' in der Tabelle und gehen beim naechsten Verbinden erneut raus.
    if (inFlight?.imei && !inFlight.dbId) {
      const queue = getCommandQueue(inFlight.imei);
      queue.unshift({
        id: inFlight.id,
        imei: inFlight.imei,
        command: inFlight.command,
        requestedBy: inFlight.requestedBy || 'retry_disconnect',
        enqueuedAt: new Date().toISOString(),
      });
      pushLimited(state.commandHistory, {
        id: inFlight.id,
        imei: inFlight.imei,
        command: inFlight.command,
        status: 'requeued_disconnect',
        ts: new Date().toISOString(),
      });
    }
    log('info', 'tcp_disconnect', { remote, imei: connection.imei });
  });

  socket.on('error', (error) => {
    log('error', 'tcp_socket_error', { remote, imei: connection.imei, error: error?.message || 'Unknown error' });
  });
});

tcpServer.on('error', (error) => {
  log('error', 'tcp_server_error', { error: error?.message || 'Unknown error' });
});

// Neue DB-Befehle (z.B. Stufe aus der Dispo) auch bei laufender Verbindung abholen.
setInterval(() => {
  state.activeConnectionsByImei.forEach((connection) => sendNextCommandIfIdle(connection));
}, DB_COMMAND_POLL_MS).unref();

tcpServer.listen(TCP_PORT, TCP_HOST, () => {
  log('info', 'tcp_server_started', {
    host: TCP_HOST,
    port: TCP_PORT,
    source: SOURCE,
  });
});
