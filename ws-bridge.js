'use strict';

const WebSocket = require('ws');

function env(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();
  return value.replace(/^['"]|['"]$/g, '').trim();
}

const WS_URL = env('WS_URL');
const SECRET_KEY = env('SECRET_KEY');
const WS_URL_2 = env('WS_URL_2', 'wss://node-vn.lura.blue/ws/public?session_token=DtFAvr8b0sO5saeELgzRFx2qgUAs7o-90jvjZDXtXdyxx0UqUWKucYVJg1hYj49q&proof=7e4b6ffe65eba162256f2d38841a119ec8db67b9d692ccf70e28ecb19b83400f');
const SECRET_KEY_2 = env('SECRET_KEY_2');
const WS_URL_3 = env('WS_URL_3', 'wss://acefinder-901fb3a7c950.kellygrant0527.workers.dev/ws');
const SECRET_KEY_3 = env('SECRET_KEY_3');
const WEBHOOK_MID = env('WEBHOOK_MID');
const WEBHOOK_HIGH = env('WEBHOOK_HIGH');
const WEBHOOK_ULTRA = env('WEBHOOK_ULTRA');
const WEBHOOK_JOBID = env('WEBHOOK_JOBID');
const WEBHOOK_OG = env('WEBHOOK_OG');
const IMAGE_API = env('IMAGE_API', 'https://stealabrainrot.fandom.com/api.php');
const USER_AGENT = 'BrainrotPrivateAPI/1.0';
const FILTER_VERSION = 'explicit-channel-filters-v10-triple-ws';
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

function makeNameSet(value) {
  return new Set(value.split(';').map(normalizeName).filter(Boolean));
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
const imageCache = new Map();
const connections = [
  { label: 'DEX', url: WS_URL, secret: SECRET_KEY, reconnectDelay: 2000, reconnectTimer: null, socket: null },
  { label: 'LURA', url: WS_URL_2, secret: SECRET_KEY_2, reconnectDelay: 2000, reconnectTimer: null, socket: null },
  { label: 'ACEFINDER', url: WS_URL_3, secret: SECRET_KEY_3, reconnectDelay: 2000, reconnectTimer: null, socket: null },
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
    if (name) {
      return {
        name: String(name),
        value,
        count: String(data.count ?? data.quantity ?? '-'),
        eventId: String(data.eventId || data.id || `${name}|${rawValue}|${Date.now()}`),
      };
    }
  }

  const parts = String(raw).split('|').map((part) => part.trim());
  const name = parts[0];
  if (!name) return null;
  const value = parts.length >= 2 ? parseValue(parts[1]) : NaN;
  return { name, value, count: parts[2] || '-', eventId: parts.slice(0, 4).join('|') || `${name}|${Date.now()}` };
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

async function routeEvent(event) {
  const key = event.eventId;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 5000) seen.clear();

  const matches = classifyByName(event.name);
  if (!matches.length) {
    log(`event ${event.name} ignored: exact name not in MID/HIG/ULTRA/OG filters`);
    return;
  }

  const jobs = [];
  if (WEBHOOK_JOBID) jobs.push(sendWebhook(WEBHOOK_JOBID, event, 'JOB ID', matches[0].color));
  for (const match of matches) if (match.url) jobs.push(sendWebhook(match.url, event, match.tier, match.color));
  if (!jobs.length) return;
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((result) => result.status === 'rejected');
  const tiers = matches.map((match) => match.tier).join('/');
  if (failed.length) log(`event ${event.name} (${tiers}) sent with ${failed.length} webhook error(s)`);
  else log(`event ${event.name} (${tiers}) ${formatValue(event.value)} forwarded`);
}

function scheduleReconnect(connection) {
  if (connection.reconnectTimer || !connection.url) return;
  const delay = connection.reconnectDelay;
  connection.reconnectDelay = Math.min(connection.reconnectDelay * 2, 30000);
  connection.reconnectTimer = setTimeout(() => { connection.reconnectTimer = null; connect(connection); }, delay);
  log(`${connection.label} reconnecting in ${delay}ms`);
}

function connect(connection) {
  if (!connection.url) { log(`disabled: ${connection.label} WS_URL is not configured`); return; }
  if (!/^wss?:\/\/[^\s]+$/i.test(connection.url)) { log(`disabled: ${connection.label} WS_URL inválida`); return; }
  log(`${connection.label} connecting`);
  const headers = connection.secret ? { Authorization: `Bearer ${connection.secret}` } : undefined;
  let currentSocket;
  try { currentSocket = new WebSocket(connection.url, headers ? { headers } : undefined); }
  catch (error) { log(`${connection.label} connection setup error: ${error.message}`); scheduleReconnect(connection); return; }
  connection.socket = currentSocket;
  const heartbeat = setInterval(() => { if (connection.socket === currentSocket && currentSocket.readyState === WebSocket.OPEN) currentSocket.ping(); }, 20000);
  currentSocket.on('open', () => { connection.reconnectDelay = 2000; log(`${connection.label} connected`); });
  currentSocket.on('message', (message) => { const event = parseEvent(message.toString()); if (event) routeEvent(event).catch((error) => log(`route error (${connection.label}): ${error.message}`)); });
  currentSocket.on('error', (error) => log(`${connection.label} socket error: ${error.message}`));
  currentSocket.on('close', (code, reason) => { clearInterval(heartbeat); if (connection.socket === currentSocket) connection.socket = null; log(`${connection.label} closed code=${code} reason=${reason.toString().slice(0, 120)}`); scheduleReconnect(connection); });
}

function startWsBridge() {
  log(`starting ${FILTER_VERSION}; routing by name filters only`);
  if (!ENABLE_DEX_WS) { log('disabled: all WS connections are OFF in this environment'); return; }
  for (const connection of connections) connect(connection);
}

module.exports = { startWsBridge };
