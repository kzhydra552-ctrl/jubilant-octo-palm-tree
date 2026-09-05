const WebSocket = require('ws');

function env(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();
  return value.replace(/^['\"]|['\"]$/g, '').trim();
}

const WS_URL = env('WS_URL');
const SECRET_KEY = env('SECRET_KEY');
const WEBHOOK_MID = env('WEBHOOK_MID');
const WEBHOOK_HIGH = env('WEBHOOK_HIGH');
const WEBHOOK_ULTRA = env('WEBHOOK_ULTRA');
const WEBHOOK_JOBID = env('WEBHOOK_JOBID');
const IMAGE_API = env('IMAGE_API', 'https://stealabrainrot.fandom.com/api.php');
const USER_AGENT = 'BrainrotPrivateAPI/1.0';

const seen = new Set();
const imageCache = new Map();
let reconnectDelay = 2000;
let reconnectTimer = null;
let socket = null;

function log(message) {
  console.log(`[ws-bridge] ${new Date().toISOString()} ${message}`);
}

function parseValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return NaN;
  const normalized = value.trim().toUpperCase().replace(/,/g, '.').replace(/\s/g, '');
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([KMBT])?/);
  if (!match) return Number(normalized.replace(/[^0-9.]/g, ''));
  const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return Number(match[1]) * (multipliers[match[2]] || 1);
}

function formatValue(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value % 1e9 ? 2 : 0)}B/s`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value % 1e6 ? 2 : 0)}M/s`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value % 1e3 ? 2 : 0)}K/s`;
  return `${value}/s`;
}

function classify(value) {
  if (value >= 500e6) return ['ULTRA', WEBHOOK_ULTRA, 0xff1744];
  if (value >= 100e6) return ['HIG', WEBHOOK_HIGH, 0xff9100];
  if (value >= 10e6) return ['MID', WEBHOOK_MID, 0x00c853];
  return [null, null, 0];
}

function parseEvent(raw) {
  let data = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch (_) {}

  if (data && typeof data === 'object') {
    const name = data.name || data.itemName || data.brainrot || data.title;
    const rawValue = data.value ?? data.price ?? data.amount ?? data.rate;
    const value = parseValue(rawValue);
    if (name && Number.isFinite(value)) {
      return {
        name: String(name),
        value,
        count: String(data.count ?? data.quantity ?? '-'),
        eventId: String(data.eventId || data.id || `${name}|${rawValue}|${Date.now()}`),
      };
    }
  }

  const parts = String(raw).split('|').map((part) => part.trim());
  if (parts.length < 2) return null;
  const value = parseValue(parts[1]);
  if (!parts[0] || !Number.isFinite(value)) return null;
  return {
    name: parts[0],
    value,
    count: parts[2] || '-',
    eventId: parts.slice(0, 4).join('|'),
  };
}

async function getImageUrl(name) {
  if (imageCache.has(name)) return imageCache.get(name);
  const url = new URL(IMAGE_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', name);
  url.searchParams.set('prop', 'pageimages');
  url.searchParams.set('piprop', 'original');
  url.searchParams.set('format', 'json');
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`image-api-${response.status}`);
    const data = await response.json();
    const page = Object.values(data?.query?.pages || {})[0];
    const image = page?.original?.source || null;
    imageCache.set(name, image);
    return image;
  } catch (error) {
    log(`image lookup failed for ${name}: ${error.message}`);
    imageCache.set(name, null);
    return null;
  }
}

async function sendWebhook(url, event, tier, color) {
  if (!url) return { skipped: true };
  const imageUrl = await getImageUrl(event.name);
  const receivedAt = Math.floor(Date.now() / 1000);
  const labels = { MID: 'Midlights', HIG: 'Highlights', ULTRA: 'Ultralights', 'JOB ID': 'Job Id' };
  const headerText = `## Hydra • ${labels[tier] || tier}`;
  const titleLine = `# ${event.name}`;
  const valueLine = `### $${formatValue(event.value)}`;
  const components = [
    { type: 10, content: headerText },
    { type: 14, divider: true, spacing: 1 },
  ];

  if (imageUrl) {
    components.push({
      type: 9,
      components: [
        { type: 10, content: titleLine },
        { type: 10, content: valueLine },
      ],
      accessory: { type: 11, media: { url: imageUrl } },
    });
  } else {
    components.push({ type: 10, content: titleLine });
    components.push({ type: 10, content: valueLine });
  }

  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: `-# Hydra Notifier | <t:${receivedAt}:R>` });

  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}with_components=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({
      username: 'HYDRA NOTIFIER',
      flags: 32768,
      components: [{ type: 17, components }],
    }),
  });
  if (!response.ok) throw new Error(`webhook-${response.status}`);
  return { sent: true };
}

async function routeEvent(event) {
  const key = event.eventId;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 5000) seen.clear();

  const [tier, tierUrl, color] = classify(event.value);
  const jobs = [];
  if (WEBHOOK_JOBID) jobs.push(sendWebhook(WEBHOOK_JOBID, event, 'JOB ID', color));
  if (tierUrl) jobs.push(sendWebhook(tierUrl, event, tier, color));
  if (!jobs.length) return;
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) log(`event ${event.name} sent with ${failed.length} webhook error(s)`);
  else log(`event ${event.name} ${formatValue(event.value)} forwarded`);
}

function scheduleReconnect() {
  if (reconnectTimer || !WS_URL) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  log(`reconnecting in ${delay}ms`);
}

function connect() {
  if (!WS_URL) {
    log('disabled: WS_URL is not configured');
    return;
  }
  if (!/^wss?:\/\/[^\s]+$/i.test(WS_URL)) {
    log('disabled: WS_URL inválida; use somente wss://... ou ws://..., sem WS_URL= e sem aspas');
    return;
  }
  log('connecting');
  const headers = SECRET_KEY ? { Authorization: `Bearer ${SECRET_KEY}` } : undefined;
  let currentSocket;
  try {
    currentSocket = new WebSocket(WS_URL, headers ? { headers } : undefined);
  } catch (error) {
    log(`connection setup error: ${error.message}`);
    scheduleReconnect();
    return;
  }
  socket = currentSocket;
  const heartbeat = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.ping();
  }, 20000);

  socket.on('open', () => {
    reconnectDelay = 2000;
    log('connected');
  });
  socket.on('message', (message) => {
    const event = parseEvent(message.toString());
    if (event) routeEvent(event).catch((error) => log(`route error: ${error.message}`));
  });
  socket.on('error', (error) => log(`socket error: ${error.message}`));
  socket.on('close', (code, reason) => {
    clearInterval(heartbeat);
    log(`closed code=${code} reason=${reason.toString().slice(0, 120)}`);
    scheduleReconnect();
  });
}

function startWsBridge() {
  connect();
}

module.exports = { startWsBridge };
