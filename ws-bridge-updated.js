'use strict';

const WebSocket = require('ws');

function env(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();
  return value.replace(/^['"]|['"]$/g, '').trim();
}

const WS_URL = env('WS_URL');
const SECRET_KEY = env('SECRET_KEY');
const WS_URL_2 = env('WS_URL_2', 'wss://zlhub.net/ws');
// A zlhub opera sem Authorization; SECRET_KEY_2 não é usado.
const SECRET_KEY_2 = '';
const WEBHOOK_MID = env('WEBHOOK_MID');
const WEBHOOK_HIGH = env('WEBHOOK_HIGH');
const WEBHOOK_ULTRA = env('WEBHOOK_ULTRA');
const WEBHOOK_JOBID = env('WEBHOOK_JOBID');
const WEBHOOK_OG = env('WEBHOOK_OG');
const IMAGE_API = env('IMAGE_API', 'https://stealabrainrot.fandom.com/api.php');
const USER_AGENT = 'BrainrotPrivateAPI/1.0';
const BRAINROT_API_URL = env('BRAINROT_API_URL', 'https://hydranotifier.up.railway.app/api/brainrots');
const BRAINROT_API_KEY = env('BRAINROT_API_KEY', env('API_KEY'));
const FILTER_VERSION = 'explicit-channel-filters-v13-dex-zlhub-no-auth';
// Compatibilidade com o comportamento antigo: WS_URL/SECRET_KEY continuam suficientes.
const ENABLE_DEX_WS = env('ENABLE_DEX_WS', 'true').toLowerCase() === 'true';

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const DISPLAY_NAMES = new Map();

function makeNameSet(value) {
  const names = value.split(';').map((item) => item.trim()).filter(Boolean);
  for (const name of names) DISPLAY_NAMES.set(normalizeName(name), name);
  return new Set(names.map(normalizeName));
}

const MID_NAMES = makeNameSet(`
Nuclearo Dinossauro; DJ Panda; Money Money Puggy; Noodle Noodle Poodle; Tang Tang Keletang; Ketupat Kepat; Tictac Sahur; Ketchuru and Musturu; Lavadorito Spinito; Ventoliero Pavonero; Syrup Samurai; John Doe; Burrito Bat; Conetto Morsetto; Mariachi Corazoni; Tacorillo Crocodillo; Pogo Pogo Penguin; Swag Soda; Noo my Heart; Noo my Gold; Chimnino; Gattino Hydrantino; Los Combinasionas; Chicleteira Noelteira; Baskito; Chicleteira Surfeiteira; Tacorita Bicicleta; Los Sweethearts; Motorino Bumbino; Camera Ramena; Spinny Hammy; Las Sis; Girafini Raftini; Chicleteira Cupideira; Los Planitos; Snailo Clovero; Peschito Machito; Chicleteira Champeona; Los Hotspotsitos; Frullato Framingo; Los Spooky Combinasionas; Los Jolly Combinasionas; Churrito Bunnito; Capitano Gullini; Los Mobilis; Celularcini Viciosini; Los 67; Los Candies; Los Fruits; La Extinct Grande; Los Bros; Bacuru and Egguru; La Spooky Grande; Chipso and Queso; Chillin Chili; Money Money Reindeer; Mieteteira Bicicleteira; Tacoturbo Tacorito; Tuff Toucan; Gobblino Uniciclino; Globa Steppa; Esok Sekolah; Los Cupids; Sand Sand Sand; W or L; La Jolly Grande; Los Mariachis; Los Primos; Eviledon; Bufalino Boomberino; Los Tacoritas; Esok Goala; Noo my Resume; Noo my Examen; Lovin Rose; Coco and Mango; Honey Honey Bear; La Taco Combinasion; Orcaledon; Los Puggies; Swaggy Bros; La Lucky Grande; La Romantic Grande; Los Tangcitos; Money Money Puggy; Scorpino Coasterino; La Anniversary Grande; Nachorilla; Rosetti Tualetti; Nacho Spyder; La Easter Grande; Steakini Fattini; Caylusaurus; Candini Fluffini; Los Tictacs; Spaghetti Tualetti
`);

const HIG_NAMES = makeNameSet(`
Garama and Madundung; Cangurato Gelato; Cash or Card; Burguro And Fryuro; Capitano Moby; Cerberus; Chillin Chili; Money Money Reindeer; Hopilikalika Hopilikalako; Polaroidini; Grabatron; Pop Pop Petalini; Quackini Snackini; Queen Bee; Guest 666; Festive 67; Los Spaghettis; Examen Bros; Bearito Cabinito; Capitano Americano; Rubrikiko; Sammyni Fattini; Rubiko and Kubiko; Los Chillis; Ginger Gerat; La Ginger Sekolah; Los Hackers; Spooky and Pumpky; Boppin Bunny; Sammyni Cakini; Duggy Bros; La Food Combinasion; Los Admins; La Casa Boo; Los Sekolahs; Sammyni Truckini; Foxini Lanternini; Kalika Bros; Fishino Clownino; Pancake and Syrup; La Secret Combinasion; Antonio; Los Amigos; Fortunu and Cashuru; Reinito Sleighito; Ketupat Bros; Los Secret Combinasionas; Orchidox; La Breakfast Combinasion; Popcuru and Fizzuru; Celestial Pegasus; Bumbatron; Jelly Moby; Moby Bros
`);

const ULTRA_NAMES = makeNameSet(`
Orchidox; Cooki and Milki; Rosey and Teddy; La Breakfast Combinasion; Popcuru and Fizzuru; Bunny and Eggy; Celestial Pegasus; Bumbatron; Venuspino; Jelly Moby; Hydra Bunny; Kraken; La Supreme Combinasion; Digi Narwhal; Arcadragon; Moby Bros; Love Love Bear; Signore Carapace; Dragon Gingerini; Hydra Dragon Cannelloni; Dragon Aquanini; Dragon Cannelloni Lazy Ducky
`);

const OG_NAMES = makeNameSet(`Skibidi Toilet; John Pork; Meowl; Strawberry Elephant; Headless Horseman; Spyder Elephant`);

const seen = new Set();
const sentFingerprints = new Map();
const DUPLICATE_WINDOW_MS = Math.max(Number(env('DUPLICATE_WINDOW_MS', '30000')) || 30000, 1000);
const imageCache = new Map();
const connections = [
  { label: 'DEX', url: WS_URL, secret: SECRET_KEY, reconnectDelay: 2000, reconnectTimer: null, socket: null },
  { label: 'ACEFINDER', url: WS_URL_2, secret: SECRET_KEY_2, reconnectDelay: 2000, reconnectTimer: null, socket: null },
];

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
  if (!Number.isFinite(value)) return 'N/A';
  if (value >= 1e9) return `${(value / 1e9).toFixed(value % 1e9 ? 2 : 0)}B/s`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value % 1e6 ? 2 : 0)}M/s`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value % 1e3 ? 2 : 0)}K/s`;
  return `${value}/s`;
}

function classifyByName(name) {
  const normalized = normalizeName(name);
  const matches = [];
  if (OG_NAMES.has(normalized)) matches.push({ tier: 'OG', url: WEBHOOK_OG, color: 0xffd600 });
  if (ULTRA_NAMES.has(normalized)) matches.push({ tier: 'ULTRA', url: WEBHOOK_ULTRA, color: 0xff1744 });
  if (HIG_NAMES.has(normalized)) matches.push({ tier: 'HIG', url: WEBHOOK_HIGH, color: 0xff9100 });
  if (MID_NAMES.has(normalized)) matches.push({ tier: 'MID', url: WEBHOOK_MID, color: 0x00c853 });
  return matches;
}

function findKnownNameInText(raw) {
  const text = normalizeName(raw);
  const allNames = [...new Set([...MID_NAMES, ...HIG_NAMES, ...ULTRA_NAMES, ...OG_NAMES])]
    .sort((a, b) => b.length - a.length);
  for (const candidate of allNames) {
    let start = text.indexOf(candidate);
    while (start >= 0) {
      const before = start === 0 ? '' : text[start - 1];
      const after = start + candidate.length >= text.length ? '' : text[start + candidate.length];
      const beforeOk = !before || !/[a-z0-9]/i.test(before);
      const afterOk = !after || !/[a-z0-9]/i.test(after);
      if (beforeOk && afterOk) return DISPLAY_NAMES.get(candidate) || candidate;
      start = text.indexOf(candidate, start + 1);
    }
  }
  return null;
}

function parseEvent(raw) {
  let data = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch (_) {}

  // AceFinder pode envelopar o evento em data/payload/event/result.
  const candidates = [];
  const collect = (value, depth = 0) => {
    if (!value || depth > 3) return;
    if (Array.isArray(value)) return value.forEach((item) => collect(item, depth + 1));
    if (typeof value !== 'object') return;
    candidates.push(value);
    for (const key of ['data', 'payload', 'event', 'result', 'brainrotData']) collect(value[key], depth + 1);
  };
  collect(data);

  for (const candidate of candidates) {
    const name = candidate.name || candidate.itemName || candidate.brainrot || candidate.brainrotName || candidate.characterName || candidate.title;
    const rawValue = candidate.value ?? candidate.price ?? candidate.amount ?? candidate.rate ?? candidate.generationRate;
    if (name) {
      return {
        name: String(name),
        value: parseValue(rawValue),
        count: String(candidate.count ?? candidate.quantity ?? '-'),
        eventId: String(candidate.eventId || candidate.id || candidate.uuid || `${name}|${rawValue}|${Date.now()}`),
      };
    }
  }

  const parts = String(raw).split('|').map((part) => part.trim());
  const pipeName = parts[0];
  if (pipeName && !pipeName.startsWith('{') && !pipeName.startsWith('[')) {
    const value = parts.length >= 2 ? parseValue(parts[1]) : NaN;
    if (classifyByName(pipeName).length) return { name: pipeName, value, count: parts[2] || '-', eventId: parts.slice(0, 4).join('|') || `${pipeName}|${Date.now()}` };
  }

  // Alguns servidores enviam texto/status com o nome embutido, sem JSON ou delimitador.
  // Só aceitamos nomes presentes nas listas; texto desconhecido continua bloqueado.
  const embeddedName = findKnownNameInText(String(raw));
  if (!embeddedName) return null;
  const embeddedValue = String(raw).match(/[0-9]+(?:[.,][0-9]+)?\s*[KMBT](?:\/s)?/i)?.[0] || '';
  return {
    name: embeddedName,
    value: parseValue(embeddedValue),
    count: '-',
    eventId: `${embeddedName}|${String(raw).slice(0, 240)}|${Date.now()}`,
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
  const labels = { MID: 'Midlights', HIG: 'Highlights', ULTRA: 'Ultralights', OG: 'OG', 'JOB ID': 'Job Id' };
  const components = [
    { type: 10, content: `## Hydra • ${labels[tier] || tier}` },
    { type: 14, divider: true, spacing: 1 },
  ];
  const titleLine = `# ${event.name}`;
  const valueLine = `### $${formatValue(event.value)}`;
  if (imageUrl) components.push({ type: 9, components: [{ type: 10, content: titleLine }, { type: 10, content: valueLine }], accessory: { type: 11, media: { url: imageUrl } } });
  else { components.push({ type: 10, content: titleLine }); components.push({ type: 10, content: valueLine }); }
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: `-# Hydra Notifier | <t:${receivedAt}:R>` });

  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}with_components=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ username: 'HYDRA NOTIFIER', flags: 32768, components: [{ type: 17, components }] }),
  });
  if (!response.ok) throw new Error(`webhook-${response.status}`);
  return { sent: true };
}

async function saveBrainrotEvent(event, source) {
  if (!BRAINROT_API_KEY || !Number.isFinite(event.value)) return;
  try {
    const response = await fetch(BRAINROT_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': BRAINROT_API_KEY, 'user-agent': USER_AGENT },
      body: JSON.stringify({
        eventId: event.eventId,
        name: event.name,
        value: event.value,
        valueLabel: formatValue(event.value).replace(/\/s$/, ''),
        source,
      }),
    });
    if (!response.ok) throw new Error("api-" + response.status);
    log("[" + source + "] API_SAVED name='" + event.name + "' value='" + formatValue(event.value) + "'");
  } catch (error) {
    log("[" + source + "] API_ERROR name='" + event.name + "' error='" + error.message + "'");
  }
}

async function routeEvent(event, source) {
  const sourceLabel = source || 'UNKNOWN';
  const normalizedName = normalizeName(event.name);
  const valueKey = Number.isFinite(event.value) ? String(event.value) : 'NO_VALUE';
  const fingerprint = `${normalizedName}|${valueKey}`;
  const now = Date.now();
  const previous = sentFingerprints.get(fingerprint);
  if (previous && now - previous < DUPLICATE_WINDOW_MS) {
    log(`[${sourceLabel}] DUPLICATE_IGNORED name="${event.name}" value="${formatValue(event.value)}" fingerprint_window_ms=${DUPLICATE_WINDOW_MS}`);
    return;
  }
  for (const [storedFingerprint, timestamp] of sentFingerprints) {
    if (now - timestamp >= DUPLICATE_WINDOW_MS) sentFingerprints.delete(storedFingerprint);
  }
  sentFingerprints.set(fingerprint, now);

  const key = `${sourceLabel}:${event.eventId}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 5000) seen.clear();

  const matches = classifyByName(event.name);
  if (!matches.length) {
    log(`[${sourceLabel}] IGNORED name="${event.name}" reason="not-in-name-filters"`);
    return;
  }

  void saveBrainrotEvent(event, sourceLabel);

  const jobs = [];
  if (WEBHOOK_JOBID) jobs.push(sendWebhook(WEBHOOK_JOBID, event, 'JOB ID', matches[0].color));
  for (const match of matches) if (match.url) jobs.push(sendWebhook(match.url, event, match.tier, match.color));
  if (!jobs.length) {
    sentFingerprints.delete(fingerprint);
    return;
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length === jobs.length) sentFingerprints.delete(fingerprint);
  const tiers = matches.map((match) => match.tier).join('/');
  if (failed.length) log(`[${sourceLabel}] WEBHOOK_ERROR name="${event.name}" tiers="${tiers}" errors=${failed.length}`);
  else log(`[${sourceLabel}] FORWARDED name="${event.name}" tiers="${tiers}" value="${formatValue(event.value)}" webhooks=${jobs.length}`);
}

function scheduleReconnect(connection) {
  if (connection.reconnectTimer || !connection.url) return;
  const delay = connection.reconnectDelay;
  connection.reconnectDelay = Math.min(connection.reconnectDelay * 2, 30000);
  connection.reconnectTimer = setTimeout(() => { connection.reconnectTimer = null; connect(connection); }, delay);
  log(`[${connection.label}] RECONNECTING delay_ms=${delay}`);
}

function connect(connection) {
  if (!connection.url) { log(`disabled: ${connection.label} WS_URL is not configured`); return; }
  if (!/^wss?:\/\/[^\s]+$/i.test(connection.url)) { log(`disabled: ${connection.label} WS_URL inválida`); return; }
  log(`[${connection.label}] CONNECTING url=${connection.url.split('?')[0]}`);
  const headers = connection.secret ? { Authorization: `Bearer ${connection.secret}` } : undefined;
  let currentSocket;
  try { currentSocket = new WebSocket(connection.url, headers ? { headers } : undefined); }
  catch (error) { log(`${connection.label} connection setup error: ${error.message}`); scheduleReconnect(connection); return; }
  connection.socket = currentSocket;
  const heartbeat = setInterval(() => { if (connection.socket === currentSocket && currentSocket.readyState === WebSocket.OPEN) currentSocket.ping(); }, 20000);
  currentSocket.on('open', () => { connection.reconnectDelay = 2000; log(`[${connection.label}] CONNECTED url=${connection.url.split('?')[0]}`); });
  currentSocket.on('message', (message) => {
    const raw = message.toString();
    const event = parseEvent(raw);
    if (!event) { log(`[${connection.label}] MESSAGE_IGNORED reason="no-name-in-filters"`); return; }
    log(`[${connection.label}] EVENT_RECEIVED name="${event.name}"`);
    routeEvent(event, connection.label).catch((error) => log(`[${connection.label}] ROUTE_ERROR error="${error.message}"`));
  });
  currentSocket.on('error', (error) => log(`[${connection.label}] SOCKET_ERROR error="${error.message}"`));
  currentSocket.on('close', (code, reason) => { clearInterval(heartbeat); if (connection.socket === currentSocket) connection.socket = null; log(`[${connection.label}] CLOSED code=${code} reason="${reason.toString().slice(0, 120)}"`); scheduleReconnect(connection); });
}

function startWsBridge() {
  log(`starting ${FILTER_VERSION}; routing by name filters only`);
  if (!ENABLE_DEX_WS) { log('disabled: all WS connections are OFF in this environment'); return; }
  for (const connection of connections) connect(connection);
}

module.exports = { startWsBridge };
