const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const root = __dirname;
const publicDir = path.join(root, 'public');
const seedDataPath = path.join(root, 'data', 'tracker.json');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dataPath = process.env.DATA_PATH || path.join(dataDir, 'tracker.json');
const FAMILY_PIN = process.env.FAMILY_PIN || '02110630';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

async function ensureDataFile() {
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  try {
    await fs.access(dataPath);
  } catch {
    await fs.copyFile(seedDataPath, dataPath);
  }
}

async function readState() {
  await ensureDataFile();
  const raw = await fs.readFile(dataPath, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

async function writeState(state) {
  await ensureDataFile();
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(dataPath, JSON.stringify(state, null, 2));
}

async function parseBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function hasPin(req) {
  return req.headers['x-family-pin'] === FAMILY_PIN;
}

function requirePin(req, res) {
  if (hasPin(req)) return true;
  sendJson(res, 401, { error: 'PIN required' });
  return false;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function normalizedBills(state) {
  return (state.billCategories || []).map((category) => {
    const bills = (category.bills || []).map((bill, index) => ({
      id: bill.id || index + 1,
      name: String(bill.name || 'Bill'),
      dueDate: String(bill.dueDate || 'Monthly'),
      amount: money(bill.amount),
      paid: Boolean(bill.paid),
      paidAt: bill.paidAt || null
    }));
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    return { id: category.id, name: String(category.name || 'Bills'), total: money(total), bills };
  });
}

function billTotals(categories) {
  const byCategory = categories.reduce((acc, category) => ({ ...acc, [category.name]: category.total }), {});
  const grandTotal = categories.reduce((sum, category) => sum + category.total, 0);
  return { ...byCategory, grandTotal: money(grandTotal) };
}

function totals(state) {
  const weekly = state.weeks.map((week) => {
    const combinedTarget = Number(week.youTarget || 0) + Number(week.wifeTarget || 0);
    const combinedSaved = Number(week.youSaved || 0) + Number(week.wifeSaved || 0);
    return { ...week, combinedTarget, combinedSaved, combinedDone: combinedSaved >= combinedTarget && combinedTarget > 0 };
  });

  const categories = normalizedBills(state);
  const sum = (field) => weekly.reduce((total, week) => total + Number(week[field] || 0), 0);
  return {
    ...state,
    weeks: weekly,
    billCategories: categories,
    billTotals: billTotals(categories),
    totals: {
      youTarget: money(sum('youTarget')),
      wifeTarget: money(sum('wifeTarget')),
      combinedTarget: money(sum('combinedTarget')),
      youSaved: money(sum('youSaved')),
      wifeSaved: money(sum('wifeSaved')),
      combinedSaved: money(sum('combinedSaved'))
    }
  };
}

async function handleApi(req, res) {
  if (!requirePin(req, res)) return;

  if (req.method === 'GET' && req.url === '/api/state') {
    return sendJson(res, 200, totals(await readState()));
  }

  if (req.method === 'PATCH' && req.url === '/api/targets') {
    const body = await parseBody(req);
    const state = await readState();
    const youTarget = money(body.youTarget);
    const wifeTarget = money(body.wifeTarget);
    state.targets.you = youTarget;
    state.targets.wife = wifeTarget;

    const youWeekly = splitTarget(youTarget, state.weeks.length);
    const wifeWeekly = splitTarget(wifeTarget, state.weeks.length);
    state.weeks = state.weeks.map((week, index) => ({ ...week, youTarget: youWeekly[index], wifeTarget: wifeWeekly[index] }));
    await writeState(state);
    return sendJson(res, 200, totals(state));
  }

  if (req.method === 'POST' && req.url === '/api/savings') {
    const body = await parseBody(req);
    const state = await readState();
    const week = state.weeks.find((item) => item.id === Number(body.weekId));
    if (!week) return sendJson(res, 404, { error: 'Week not found' });

    if (body.person === 'you') {
      week.youSaved = money(body.amount);
      week.youDone = Boolean(body.done);
      week.youPaycheck = money(body.paycheck);
      week.youPutBack = money(body.putBack);
    } else if (body.person === 'wife') {
      week.wifeSaved = money(body.amount);
      week.wifeDone = Boolean(body.done);
      week.wifePaycheck = money(body.paycheck);
      week.wifePutBack = money(body.putBack);
    } else {
      return sendJson(res, 400, { error: 'Choose Dennis or Havin' });
    }
    week.note = String(body.note || week.note || '').slice(0, 240);
    await writeState(state);
    return sendJson(res, 200, totals(state));
  }



  if (req.method === 'POST' && req.url === '/api/bills/paid') {
    const body = await parseBody(req);
    const state = await readState();
    const category = (state.billCategories || []).find((item) => item.id === String(body.categoryId));
    if (!category) return sendJson(res, 404, { error: 'Bill category not found' });

    const bill = (category.bills || []).find((item) => Number(item.id) === Number(body.billId));
    if (!bill) return sendJson(res, 404, { error: 'Bill not found' });

    bill.paid = Boolean(body.paid);
    bill.paidAt = bill.paid ? new Date().toISOString() : null;
    await writeState(state);
    return sendJson(res, 200, totals(state));
  }
  if (req.method === 'POST' && req.url === '/api/notices') {
    const body = await parseBody(req);
    const text = String(body.body || '').trim().slice(0, 500);
    if (!text) return sendJson(res, 400, { error: 'Notice text is required' });

    const state = await readState();
    const notices = Array.isArray(state.notices) ? state.notices : [];
    const nextId = notices.reduce((max, notice) => Math.max(max, Number(notice.id || 0)), 0) + 1;
    const postedAt = new Date().toISOString();
    notices.unshift({
      id: nextId,
      title: `Posted ${new Date(postedAt).toLocaleDateString('en-US')}`,
      body: text,
      postedAt
    });
    state.notices = notices;
    await writeState(state);
    return sendJson(res, 200, totals(state));
  }
  if (req.method === 'POST' && req.url === '/api/reset') {
    const state = await readState();
    state.weeks = state.weeks.map((week) => ({ ...week, youSaved: 0, wifeSaved: 0, youDone: false, wifeDone: false, youPaycheck: 0, youPutBack: 0, wifePaycheck: 0, wifePutBack: 0, note: '' }));
    await writeState(state);
    return sendJson(res, 200, totals(state));
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function splitTarget(total, weeks) {
  const base = Math.floor((total / weeks) * 100) / 100;
  const values = Array.from({ length: weeks }, () => base);
  values[weeks - 1] = Math.round((total - base * (weeks - 1)) * 100) / 100;
  return values;
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    const fallback = await fs.readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': mime['.html'] });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true });
    if (req.url.startsWith('/api/')) return await handleApi(req, res);
    return await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Weekly Savings app running at http://localhost:${PORT}`);
});







