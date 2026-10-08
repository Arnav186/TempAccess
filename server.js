import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { argon2id, argon2Verify, bcrypt, bcryptVerify } from 'hash-wasm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_API_KEY || '';
// Local-only issuing is convenient for this prototype. Set false before any remote deployment.
const allowLocalAdmin = process.env.ALLOW_LOCAL_ADMIN !== 'false';
const db = new DatabaseSync(path.join(__dirname, 'temp-access.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    algorithm TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, credential_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    FOREIGN KEY (credential_id) REFERENCES credentials(id)
  );
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '8kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const random = size => crypto.randomBytes(size);
const randomId = () => random(8).toString('hex');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
const safePrefix = value => String(value || 'learner').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24) || 'learner';
const password = length => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*_-';
  return Array.from(random(length), byte => alphabet[byte % alphabet.length]).join('');
};

function requireAdmin(req, res, next) {
  if (allowLocalAdmin && isLocal(req)) return next();
  const suppliedKey = Buffer.from(req.get('x-admin-key') || '');
  const configuredKey = Buffer.from(adminKey);
  if (!adminKey || suppliedKey.length !== configuredKey.length || !crypto.timingSafeEqual(suppliedKey, configuredKey)) {
    return res.status(401).json({ error: 'Administrator authorization is required.' });
  }
  next();
}

app.post('/api/credentials', requireAdmin, async (req, res, next) => {
  try {
    const durationMinutes = Number(req.body.durationMinutes);
    const passwordLength = Number(req.body.passwordLength);
    const algorithm = req.body.algorithm === 'bcrypt' ? 'bcrypt' : 'argon2id';
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10_080) return res.status(400).json({ error: 'Duration must be 1–10,080 minutes.' });
    if (!Number.isInteger(passwordLength) || passwordLength < 16 || passwordLength > 64) return res.status(400).json({ error: 'Password length must be 16–64.' });

    const plainPassword = password(passwordLength);
    const hash = algorithm === 'argon2id'
      ? await argon2id({ password: plainPassword, salt: random(16), parallelism: 1, iterations: 3, memorySize: 19_456, hashLength: 32, outputType: 'encoded' })
      : await bcrypt({ password: plainPassword, salt: random(16), costFactor: Number(process.env.BCRYPT_ROUNDS || 12), outputType: 'encoded' });
    const createdAt = Date.now();
    const expiresAt = createdAt + durationMinutes * 60_000;
    const username = `${safePrefix(req.body.prefix)}-${randomId()}@temporary.local`;
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO credentials (id, username, password_hash, algorithm, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, username, hash, algorithm, createdAt, expiresAt);
    res.status(201).json({ id, username, password: plainPassword, expiresAt, algorithm });
  } catch (error) { next(error); }
});

app.post('/api/login', loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || '');
    const plainPassword = String(req.body.password || '');
    const credential = db.prepare('SELECT * FROM credentials WHERE username = ?').get(username);
    const now = Date.now();
    if (!credential || credential.revoked_at || credential.expires_at <= now) return res.status(401).json({ error: 'Invalid, expired, or revoked credentials.' });
    const matches = credential.algorithm === 'argon2id' ? await argon2Verify({ password: plainPassword, hash: credential.password_hash }) : await bcryptVerify({ password: plainPassword, hash: credential.password_hash });
    if (!matches) return res.status(401).json({ error: 'Invalid, expired, or revoked credentials.' });
    const token = random(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, credential_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), credential.id, credential.expires_at);
    res.cookie('temp_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', expires: new Date(credential.expires_at) });
    res.json({ ok: true, expiresAt: credential.expires_at });
  } catch (error) { next(error); }
});

app.post('/api/revoke/:id', requireAdmin, (req, res) => {
  const outcome = db.prepare('UPDATE credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), req.params.id);
  db.prepare('DELETE FROM sessions WHERE credential_id = ?').run(req.params.id);
  res.json({ revoked: outcome.changes === 1 });
});

app.get('/api/me', (req, res) => {
  const token = (req.get('cookie') || '').match(/(?:^|; )temp_session=([^;]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  const row = db.prepare(`SELECT c.username, c.expires_at FROM sessions s JOIN credentials c ON c.id = s.credential_id WHERE s.token_hash = ? AND s.expires_at > ? AND c.revoked_at IS NULL`).get(hashToken(token), Date.now());
  if (!row) return res.status(401).json({ error: 'Session expired or revoked.' });
  res.json({ username: row.username, expiresAt: row.expires_at });
});

app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Server error.' }); });
app.listen(port, () => console.log(`Temporary access app: http://localhost:${port}`));
