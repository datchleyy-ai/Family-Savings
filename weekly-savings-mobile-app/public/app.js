const currency = (digits) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
const weekList = document.querySelector('#weekList');
const categoryList = document.querySelector('#categoryList');
const noticeList = document.querySelector('#noticeList');
const template = document.querySelector('#weekTemplate');
const categoryTemplate = document.querySelector('#categoryTemplate');
const billTemplate = document.querySelector('#billTemplate');
const noticeTemplate = document.querySelector('#noticeTemplate');
const toast = document.querySelector('#toast');
let deferredInstall;
let state;
let activeScreen = 'savings';
let familyPin = localStorage.getItem('familySavingsPin') || '';

const $ = (id) => document.querySelector(id);

function formatMoney(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  const hasCents = Math.abs(rounded % 1) > 0;
  return currency(hasCents ? 2 : 0).format(rounded);
}

function pct(saved, target) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((saved / target) * 100)));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-family-pin': familyPin };
  const response = await fetch(path, {
    headers,
    ...options
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Something went wrong');
  state = await response.json();
  render();
}

async function load() {
  await api('/api/state');
}

function showApp() {
  $('#pinScreen').hidden = true;
  $('#appShell').hidden = false;
}

function showPin() {
  $('#pinScreen').hidden = false;
  $('#appShell').hidden = true;
  $('#pinInput').focus();
}

async function unlockWithPin(event) {
  event.preventDefault();
  familyPin = $('#pinInput').value.trim();
  try {
    await load();
    localStorage.setItem('familySavingsPin', familyPin);
    showApp();
    showToast('Unlocked');
  } catch (error) {
    familyPin = '';
    localStorage.removeItem('familySavingsPin');
    showPin();
    showToast('Wrong PIN');
  }
}

function switchScreen(screen) {
  activeScreen = screen;
  const showingSavings = screen === 'savings';
  const showingBills = screen === 'bills';
  const showingNotices = screen === 'notices';

  $('#savingsScreen').hidden = !showingSavings;
  $('#billsScreen').hidden = !showingBills;
  $('#noticesScreen').hidden = !showingNotices;
  $('#savingsScreen').classList.toggle('active', showingSavings);
  $('#billsScreen').classList.toggle('active', showingBills);
  $('#noticesScreen').classList.toggle('active', showingNotices);
  $('#savingsTab').classList.toggle('active', showingSavings);
  $('#billsTab').classList.toggle('active', showingBills);
  $('#noticesTab').classList.toggle('active', showingNotices);
  $('#bottomActions').hidden = !showingSavings;
}

function renderSummary() {
  const totals = state.totals;
  $('#youSaved').textContent = `${formatMoney(totals.youSaved)} / ${formatMoney(totals.youTarget)}`;
  $('#wifeSaved').textContent = `${formatMoney(totals.wifeSaved)} / ${formatMoney(totals.wifeTarget)}`;
  $('#combinedSaved').textContent = `${formatMoney(totals.combinedSaved)} / ${formatMoney(totals.combinedTarget)}`;
  $('#youProgress').textContent = `${formatMoney(Math.max(totals.youTarget - totals.youSaved, 0))} left`;
  $('#wifeProgress').textContent = `${formatMoney(Math.max(totals.wifeTarget - totals.wifeSaved, 0))} left`;
  $('#combinedProgress').textContent = `${formatMoney(Math.max(totals.combinedTarget - totals.combinedSaved, 0))} left`;
  $('#youMeter').style.width = `${pct(totals.youSaved, totals.youTarget)}%`;
  $('#wifeMeter').style.width = `${pct(totals.wifeSaved, totals.wifeTarget)}%`;
  $('#combinedMeter').style.width = `${pct(totals.combinedSaved, totals.combinedTarget)}%`;
  $('#youTarget').value = state.targets.you;
  $('#wifeTarget').value = state.targets.wife;
}

function renderWeeks() {
  weekList.replaceChildren();
  for (const week of state.weeks) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('h2').textContent = week.label;
    node.querySelector('.week-total').textContent = `${formatMoney(week.combinedSaved)} / ${formatMoney(week.combinedTarget)}`;
    const form = node.querySelector('form');
    form.dataset.weekId = week.id;
    form.youAmount.value = week.youSaved || '';
    form.youDone.checked = week.youDone || week.youSaved >= week.youTarget;
    form.wifeAmount.value = week.wifeSaved || '';
    form.wifeDone.checked = week.wifeDone || week.wifeSaved >= week.wifeTarget;
    form.youPaycheck.value = week.youPaycheck || '';
    form.youPutBack.value = week.youPutBack || '';
    form.wifePaycheck.value = week.wifePaycheck || '';
    form.wifePutBack.value = week.wifePutBack || '';
    form.note.value = week.note || '';
    form.addEventListener('submit', submitWeek);
    weekList.append(node);
  }
}

function daysUntilDue(dueDate) {
  const value = String(dueDate || '').toLowerCase();
  if (value === 'weekly') return 'Due weekly';

  const match = value.match(/\d+/);
  if (!match) return 'Due date not set';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = Number(match[0]);
  let due = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (due < today) due = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);

  const days = Math.round((due - today) / 86400000);
  if (days === 0) return 'Due today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

function renderBills() {
  const categories = state.billCategories || [];
  $('#billsTotal').textContent = formatMoney(state.billTotals?.grandTotal || 0);
  categoryList.replaceChildren();

  for (const category of categories) {
    const categoryNode = categoryTemplate.content.firstElementChild.cloneNode(true);
    categoryNode.querySelector('h2').textContent = category.name;
    categoryNode.querySelector('.category-head strong').textContent = formatMoney(category.total);
    const rows = categoryNode.querySelector('.bill-list');

    for (const bill of category.bills) {
      const row = billTemplate.content.firstElementChild.cloneNode(true);
      row.dataset.categoryId = category.id;
      row.dataset.billId = bill.id;
      row.classList.toggle('is-paid', Boolean(bill.paid));
      row.querySelector('.bill-name').textContent = bill.name;
      row.querySelector('.bill-due').textContent = bill.dueDate ? `Due ${bill.dueDate}` : 'Due monthly';
      row.querySelector('.bill-countdown').textContent = daysUntilDue(bill.dueDate);
      row.querySelector('strong').textContent = formatMoney(bill.amount);
      const paidInput = row.querySelector('.paid-check input');
      paidInput.checked = Boolean(bill.paid);
      paidInput.addEventListener('change', () => updateBillPaid(category.id, bill.id, paidInput.checked));
      rows.append(row);
    }

    categoryList.append(categoryNode);
  }
}
function renderNotices() {
  const notices = state.notices || [];
  noticeList.replaceChildren();

  for (const notice of notices) {
    const node = noticeTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('strong').textContent = notice.title;
    node.querySelector('p').textContent = notice.body;
    noticeList.append(node);
  }
}

function render() {
  renderSummary();
  renderWeeks();
  renderBills();
  renderNotices();
  switchScreen(activeScreen);
}

async function submitWeek(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const note = form.note.value.trim();
  await api('/api/savings', {
    method: 'POST',
    body: JSON.stringify({ weekId: Number(form.dataset.weekId), person: 'you', amount: Number(form.youAmount.value || 0), done: form.youDone.checked, paycheck: Number(form.youPaycheck.value || 0), putBack: Number(form.youPutBack.value || 0), note })
  });
  await api('/api/savings', {
    method: 'POST',
    body: JSON.stringify({ weekId: Number(form.dataset.weekId), person: 'wife', amount: Number(form.wifeAmount.value || 0), done: form.wifeDone.checked, paycheck: Number(form.wifePaycheck.value || 0), putBack: Number(form.wifePutBack.value || 0), note })
  });
  showToast('Week saved');
}

async function updateBillPaid(categoryId, billId, paid) {
  await api('/api/bills/paid', {
    method: 'POST',
    body: JSON.stringify({ categoryId, billId, paid })
  });
  showToast(paid ? 'Bill marked paid' : 'Bill marked unpaid');
}

async function submitNotice(event) {
  event.preventDefault();
  const text = $('#noticeText').value.trim();
  if (!text) {
    showToast('Type a notice first');
    return;
  }

  await api('/api/notices', {
    method: 'POST',
    body: JSON.stringify({ body: text })
  });
  $('#noticeText').value = '';
  showToast('Notice posted');
}

$('#pinForm').addEventListener('submit', unlockWithPin);
$('#savingsTab').addEventListener('click', () => switchScreen('savings'));
$('#billsTab').addEventListener('click', () => switchScreen('bills'));
$('#noticesTab').addEventListener('click', () => switchScreen('notices'));
$('#noticeForm').addEventListener('submit', submitNotice);

$('#saveTargets').addEventListener('click', async () => {
  await api('/api/targets', {
    method: 'PATCH',
    body: JSON.stringify({ youTarget: Number($('#youTarget').value || 0), wifeTarget: Number($('#wifeTarget').value || 0) })
  });
  showToast('Targets updated');
});

$('#refreshButton').addEventListener('click', () => load().then(() => showToast('Updated')));
$('#resetButton').addEventListener('click', async () => {
  if (!confirm('Reset saved amounts and notes for this month?')) return;
  await api('/api/reset', { method: 'POST' });
  showToast('Month reset');
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  $('#installButton').hidden = false;
});

$('#installButton').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('#installButton').hidden = true;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
if (familyPin) {
  load().then(showApp).catch(() => showPin());
} else {
  showPin();
}







