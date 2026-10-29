require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const DEV_AUTH = process.env.DEV_AUTH === 'true';
const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT 'Player',
    balance INTEGER NOT NULL DEFAULT 1000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    rarity TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) throw new Error('Telegram authentication is not configured.');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing Telegram signature.');
  params.delete('hash');
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now()/1000 - authDate) > 86400) throw new Error('Telegram login data expired.');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculated, 'hex'), b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid Telegram signature.');
  const userRaw = params.get('user');
  if (!userRaw) throw new Error('Missing Telegram user.');
  const user = JSON.parse(userRaw);
  if (!user.id) throw new Error('Invalid Telegram user.');
  return { id: String(user.id), username: user.username || '', firstName: user.first_name || 'Player' };
}
function auth(req, res, next) {
  try {
    const initData = req.get('x-telegram-init-data') || '';
    let user;
    if (DEV_AUTH && process.env.NODE_ENV !== 'production' && !initData) {
      user = { id: 'local-demo-user', username: 'local_demo', firstName: 'Local Demo' };
    } else user = verifyInitData(initData);
    req.user = user;
    db.prepare(`INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name`)
      .run(user.id, user.username, user.firstName);
    next();
  } catch (e) { res.status(401).json({ error: e.message || 'Unauthorized' }); }
}
function adminOnly(req, res, next) {
  if (!ADMIN_IDS.has(String(req.user.id))) return res.status(403).json({ error: 'Admin access required.' });
  next();
}
const getUser = db.prepare('SELECT telegram_id, username, first_name, balance, created_at FROM users WHERE telegram_id = ?');
const getLedger = db.prepare('SELECT amount, reason, actor_id, created_at FROM ledger WHERE telegram_id = ? ORDER BY id DESC LIMIT 10');
const getInventory = db.prepare('SELECT id, item_name, rarity, created_at FROM inventory WHERE telegram_id = ? ORDER BY id DESC LIMIT 30');
function publicUser(id) {
  const u = getUser.get(id);
  return { id: u.telegram_id, username: u.username, firstName: u.first_name, balance: u.balance, createdAt: u.created_at,
    inventory: getInventory.all(id), history: getLedger.all(id) };
}
app.get('/api/me', auth, (req,res) => res.json({ ...publicUser(req.user.id), isAdmin: ADMIN_IDS.has(req.user.id) }));

const cases = [
  { id:'starter', name:'Starter Case', price:100, icon:'🎁', desc:'A small surprise to begin your collection', items:[
    {name:'Silver Spark', rarity:'Common', weight:55},{name:'Neon Charm', rarity:'Rare', weight:30},{name:'Aurora Gem', rarity:'Epic', weight:12},{name:'Golden Comet', rarity:'Legendary', weight:3}
  ]},
  { id:'neon', name:'Neon Case', price:350, icon:'💎', desc:'Bright finds for your showcase', items:[
    {name:'Pixel Bloom', rarity:'Common', weight:40},{name:'Neon Charm', rarity:'Rare', weight:35},{name:'Aurora Gem', rarity:'Epic', weight:20},{name:'Golden Comet', rarity:'Legendary', weight:5}
  ]},
  { id:'royal', name:'Royal Case', price:750, icon:'👑', desc:'A premium demo case', items:[
    {name:'Silver Spark', rarity:'Common', weight:25},{name:'Neon Charm', rarity:'Rare', weight:35},{name:'Aurora Gem', rarity:'Epic', weight:28},{name:'Golden Comet', rarity:'Legendary', weight:12}
  ]}
];
app.get('/api/cases', auth, (req,res) => res.json(cases.map(({items,...c}) => c)));
app.post('/api/cases/:id/open', auth, (req,res) => {
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({error:'Case not found.'});
  const tx = db.transaction(() => {
    const u = getUser.get(req.user.id);
    if (u.balance < c.price) throw new Error('Not enough coins for this case.');
    db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id = ?').run(c.price, req.user.id);
    db.prepare('INSERT INTO ledger (telegram_id, amount, reason, actor_id) VALUES (?, ?, ?, ?)').run(req.user.id, -c.price, `Opened ${c.name}`, req.user.id);
    const total = c.items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total, won = c.items[c.items.length-1];
    for (const item of c.items) { roll -= item.weight; if (roll <= 0) { won = item; break; } }
    db.prepare('INSERT INTO inventory (telegram_id, item_name, rarity) VALUES (?, ?, ?)').run(req.user.id, won.name, won.rarity);
    return won;
  });
  try { const item = tx(); res.json({ item, ...publicUser(req.user.id) }); }
  catch(e) { res.status(400).json({error:e.message}); }
});
app.post('/api/admin/grant', auth, adminOnly, (req,res) => {
  const targetId = String(req.body.targetId || '').trim();
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || 'Admin demo grant').slice(0,120);
  if (!/^\d+$/.test(targetId)) return res.status(400).json({error:'Target must be a numeric Telegram ID.'});
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) return res.status(400).json({error:'Amount must be an integer from 1 to 100,000,000.'});
  const target = getUser.get(targetId);
  if (!target) return res.status(404).json({error:'Player not found yet. They must open the Mini App first.'});
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, targetId);
    db.prepare('INSERT INTO ledger (telegram_id, amount, reason, actor_id) VALUES (?, ?, ?, ?)').run(targetId, amount, reason, req.user.id);
  });
  tx();
  res.json({ok:true, target: publicUser(targetId)});
});
app.get('/api/admin/players', auth, adminOnly, (req,res) => {
  res.json(db.prepare('SELECT telegram_id AS id, username, first_name AS firstName, balance FROM users ORDER BY created_at DESC LIMIT 100').all());
});
app.get('/api/health', (req,res) => res.json({ok:true}));
app.get('*', (req,res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Mini App running on http://localhost:${PORT}`));
