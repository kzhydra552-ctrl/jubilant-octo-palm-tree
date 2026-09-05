const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startWsBridge } = require('./ws-bridge');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'logs.json');
const API_KEY = process.env.API_KEY || '';
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const THRESHOLD = Number(process.env.THRESHOLD || 10000000);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(morgan('combined'));

function ensureStorage() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}

function readLogs() {
  ensureStorage();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLogs(logs) {
  ensureStorage();
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(logs, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function parseValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return NaN;
  const normalized = value.trim().toUpperCase().replace(/,/g, '.').replace(/\s/g, '');
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([KMBT])?$/);
  if (!match) return Number(normalized.replace(/[^0-9.]/g, ''));
  const n = Number(match[1]);
  const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return n * (multipliers[match[2]] || 1);
}

function secureCompare(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function apiAuth(req, res, next) {
  if (!API_KEY) return res.status(503).json({ error: 'API_KEY não configurada no servidor.' });
  const supplied = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secureCompare(supplied, API_KEY)) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

function dashboardAuth(req, res, next) {
  const header = req.get('authorization') || '';
  if (!DASHBOARD_PASSWORD) return res.status(503).send('DASHBOARD_PASSWORD não configurada.');
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Brainrot Dashboard"');
    return res.status(401).send('Autenticação necessária.');
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const user = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (!secureCompare(user, DASHBOARD_USER) || !secureCompare(password, DASHBOARD_PASSWORD)) return res.status(403).send('Acesso negado.');
  next();
}

async function sendDiscord(log) {
  if (!DISCORD_WEBHOOK_URL) return { sent: false, reason: 'DISCORD_WEBHOOK_URL não configurada' };
  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'Brainrot Detector',
      embeds: [{
        title: 'Brainrot 10M+ detectado',
        color: 0x00c853,
        fields: [
          { name: 'Nome', value: String(log.name || 'Desconhecido'), inline: true },
          { name: 'Valor', value: String(log.valueLabel), inline: true },
          { name: 'Valor numérico', value: log.value.toLocaleString('pt-BR'), inline: true },
          { name: 'Servidor', value: String(log.server || 'Não informado'), inline: true },
          { name: 'Jogador', value: String(log.player || 'Não informado'), inline: true }
        ],
        footer: { text: `ID: ${log.id}` },
        timestamp: log.createdAt
      }]
    })
  });
  if (!response.ok) throw new Error(`Discord respondeu HTTP ${response.status}`);
  return { sent: true };
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'brainrot-private-api' }));

app.post('/api/brainrots', apiAuth, async (req, res) => {
  const body = req.body || {};
  const value = parseValue(body.value ?? body.price ?? body.amount ?? body.rarity);
  if (!body.name || !Number.isFinite(value)) return res.status(400).json({ error: 'Envie name e value. value aceita número ou formatos como 10M, 12.5M e 1B.' });
  if (value < THRESHOLD) return res.status(202).json({ accepted: false, reason: 'Abaixo do limite.', threshold: THRESHOLD });

  const logs = readLogs();
  const eventId = String(body.eventId || body.id || crypto.randomUUID());
  const existing = logs.find((item) => item.eventId === eventId);
  if (existing) return res.json({ accepted: true, duplicate: true, log: existing });

  const log = {
    id: crypto.randomUUID(),
    eventId,
    name: String(body.name),
    value,
    valueLabel: String(body.value ?? body.price ?? body.amount),
    player: body.player ? String(body.player) : null,
    server: body.server ? String(body.server) : null,
    source: body.source ? String(body.source) : 'game-script',
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    createdAt: new Date().toISOString(),
    discordSent: false
  };
  logs.unshift(log);
  writeLogs(logs.slice(0, 5000));
  // O envio para o Discord é feito exclusivamente pelo ws-bridge.js,
  // que aplica as listas nominais MID/HIG/ULTRA/OG. A rota da API
  // registra o evento, mas não envia diretamente por valor.
  log.discordSent = false;
  writeLogs(readLogs().map((item) => item.id === log.id ? log : item));
  res.status(201).json({ accepted: true, log });
});

app.get('/api/logs', apiAuth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 5000);
  res.json({ threshold: THRESHOLD, count: readLogs().length, logs: readLogs().slice(0, limit) });
});

app.delete('/api/logs', apiAuth, (_req, res) => {
  writeLogs([]);
  res.json({ ok: true, message: 'Registros apagados.' });
});

app.get('/dashboard', dashboardAuth, (req, res) => {
  const logs = readLogs();
  const rows = logs.map((log) => `<tr><td>${escapeHtml(log.createdAt)}</td><td>${escapeHtml(log.name)}</td><td>${escapeHtml(log.valueLabel)}</td><td>${escapeHtml(log.player || '-')}</td><td>${escapeHtml(log.server || '-')}</td><td>${log.discordSent ? 'Enviado' : 'Pendente/erro'}</td></tr>`).join('');
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brainrot Logs</title><style>body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:28px}h1{margin-top:0}main{max-width:1200px;margin:auto}.card{background:#1e293b;border-radius:12px;padding:20px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:11px;border-bottom:1px solid #334155;text-align:left;white-space:nowrap}th{color:#93c5fd}small{color:#94a3b8}</style></head><body><main><h1>Brainrot Detector</h1><p><small>Registros iguais ou superiores a ${THRESHOLD.toLocaleString('pt-BR')}</small></p><div class="card"><table><thead><tr><th>Data</th><th>Nome</th><th>Valor</th><th>Jogador</th><th>Servidor</th><th>Discord</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Nenhum registro.</td></tr>'}</tbody></table></div></main></body></html>`);
});

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
startWsBridge();
app.listen(PORT, '0.0.0.0', () => console.log(`Brainrot API ouvindo na porta ${PORT}`));
