/*
  Librariard PWA - app.js
  Updates:
    - Fix date parsing to treat originalDue as local date (no timezone shift)
    - If originalDue < today, realDue = originalDue
    - Sort on realDue
    - Show both overdue (!) and renew badges when applicable
    - Improve loading messages per account
    - Toggle detail view on tap/click ignoring drags
    - Load cached checkouts immediately while refreshing in the background.
    - Disable refresh button during background refresh.
*/

const LOGIN_URL    = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

// ── View helpers ─────────────────────────────────────────────────────────────
const $    = s => document.querySelector(s);
const show = id => {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
};

// ── Navigation & Form handlers ────────────────────────────────────────────────
$('#add-account-btn').addEventListener('click', () => show('#account-form-view'));
$('#back-to-main-1').addEventListener('click', () => show('#main-view'));
$('#back-to-main-2').addEventListener('click', () => show('#main-view'));
$('#account-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const newAcct = {
    displayName: f.displayName.value,
    cardNumber:  f.cardNumber.value,
    pin:         f.pin.value,
    accountId:   f.accountId.value
  };
  const accts = getAccounts();
  accts.push(newAcct);
  saveAccounts(accts);
  f.reset();
  renderAccounts();
  show('#main-view');
});

// ── LocalStorage accounts ────────────────────────────────────────────────────
function getAccounts() {
  return JSON.parse(localStorage.getItem('librariard_accounts') || '[]');
}
function saveAccounts(accts) {
  localStorage.setItem('librariard_accounts', JSON.stringify(accts));
}

// ── Render accounts list ─────────────────────────────────────────────────────
function renderAccounts() {
  const ul = $('#accounts-list');
  ul.innerHTML = '';
  getAccounts().forEach((acct, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${acct.displayName || acct.accountId}</span>
      <button data-index="${i}">Delete</button>
    `;
    ul.appendChild(li);
  });
}
$('#accounts-list').addEventListener('click', e => {
  if (e.target.matches('button')) {
    const idx   = +e.target.dataset.index;
    const accts = getAccounts();
    accts.splice(idx, 1);
    saveAccounts(accts);
    renderAccounts();
  }
});

// ── Fetch helper ─────────────────────────────────────────────────────────────
async function fetchCheckoutsViaProxy(acct) {
  const query = new URLSearchParams({
    name:      acct.cardNumber,
    user_pin:  acct.pin,
    accountId: acct.accountId
  }).toString();

  const backendUrl = window.BACKEND_URL || "http://localhost:5000";
  const res        = await fetch(`${backendUrl}/checkouts?${query}`);
  return res.json();
}

// ── IndexedDB setup ──────────────────────────────────────────────────────────
const DB_NAME         = 'librariardDB';
const DB_VERSION      = 1;
const STORE_CHECKOUTS = 'checkouts';
const STORE_META      = 'meta';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = evt => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains(STORE_CHECKOUTS)) {
        db.createObjectStore(STORE_CHECKOUTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = evt => resolve(evt.target.result);
    req.onerror   = evt => reject(evt.target.error);
  });
}

function getMeta(db, key) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_META, 'readonly');
    const store = tx.objectStore(STORE_META);
    const r     = store.get(key);
    r.onsuccess = () => resolve(r.result ? r.result.value : null);
    r.onerror   = () => reject(r.error);
  });
}

function setMeta(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_META, 'readwrite');
    const store = tx.objectStore(STORE_META);
    const r     = store.put({ key, value });
    r.onsuccess = () => resolve();
    r.onerror   = () => reject(r.error);
  });
}

function clearStore(db, name) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    const r     = store.clear();
    r.onsuccess = () => resolve();
    r.onerror   = () => reject(r.error);
  });
}

function saveRawRecords(db, records) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_CHECKOUTS, 'readwrite');
    const store = tx.objectStore(STORE_CHECKOUTS);
    for (const rec of records) store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function getAllRaw(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_CHECKOUTS, 'readonly');
    const store = tx.objectStore(STORE_CHECKOUTS);
    const r     = store.getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}

function isSameDay(isoDateStr) {
  if (!isoDateStr) return false;
  const d1 = new Date(isoDateStr);
  const d2 = new Date();
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth()    === d2.getMonth()    &&
         d1.getDate()     === d2.getDate();
}

// ── Data extraction & processing ─────────────────────────────────────────────
function extractRawBooks(json, acct) {
  const arr = [];
  const accountName = acct.displayName || acct.accountId;
  // Handle cases where the API returns no checkouts for an account
  if (!json.entities || !json.entities.checkouts) return [];
  Object.values(json.entities.checkouts).forEach(chk => {
    const meta = json.entities.bibs[chk.metadataId].briefInfo;
    arr.push({
      id:            `${acct.accountId}_${chk.metadataId}`,
      accountId:     acct.accountId,
      accountName,
      metadataId:    chk.metadataId,
      timesRenewed:  chk.timesRenewed || 0,
      dueDate:       chk.dueDate,
      title:         meta.title,
      cover:         meta.jacket.medium
    });
  });
  return arr;
}

function processRaw(rec) {
  const MAX_RENEWS     = 2;
  const todayMs        = Date.now();
  const [y, m, d]      = rec.dueDate.split('T')[0].split('-').map(Number);
  const originalMs     = new Date(y, m - 1, d).getTime();
  const renewsLeft     = Math.max(0, MAX_RENEWS - rec.timesRenewed);
  const realDueMs      = originalMs < todayMs
    ? originalMs
    : originalMs + renewsLeft * 21 * 24 * 3600 * 1000;
  const diffMs         = realDueMs - todayMs;
  const weekMs         = 7 * 24 * 3600 * 1000;
  const twoWeekMs      = 14 * 24 * 3600 * 1000;
  const rd             = new Date(realDueMs);
  const displayDate    = `${rd.getMonth() + 1}/${rd.getDate()}`;

  return {
    ...rec,
    renewsLeft,
    realDueMs,
    overdue:        diffMs < 0,
    dueWithinWeek:  diffMs >= 0 && diffMs < weekMs,
    dueWithin2Wks:  diffMs >= weekMs && diffMs < twoWeekMs,
    displayDate
  };
}

// ── Templates ───────────────────────────────────────────────────────────────
function summaryTemplate(b, idx) {
  const headerColor = b.overdue
    ? 'darkred'
    : b.dueWithinWeek
      ? 'darkorange'
      : b.dueWithin2Wks
        ? 'darkblue'
        : 'black';
  const renewBadge = b.renewsLeft > 0 ? `<span class="badge">Renews: ${b.renewsLeft}</span>` : '';
  const overdueBadge = b.overdue ? '<span class="badge">!</span>' : '';
  return `
    <div class="card-header" style="background-color:${headerColor}; color:white;">
      <div class="header-left">
        <span class="index">${idx + 1}</span>
        <span class="date">${b.displayDate}</span>
      </div>
      <div class="header-right">
        ${renewBadge}${overdueBadge}
      </div>
    </div>
    <div class="card-body">
      <img src="${b.cover}" alt="Cover of ${b.title}">
      <h2>${b.title}</h2>
    </div>
  `;
}

function detailTemplate(b) {
  return `
    <div class="card-header" style="background-color:gray; color:white;">
      <span>Details</span>
    </div>
    <div class="card-detail">
      <p><strong>Title:</strong> ${b.title}</p>
      <p><strong>Original Due:</strong> ${b.dueDate.split('T')[0]}</p>
      <p><strong>Real Due:</strong> ${b.displayDate}</p>
      <p><strong>Renews Left:</strong> ${b.renewsLeft}</p>
      <p><strong>Account:</strong> ${b.accountName}</p>
    </div>
  `;
}

// ── Render checkouts ────────────────────────────────────────────────────────
function renderBooks(books) {
    const grid = $('#books-grid');
    grid.innerHTML = '';
    books.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'book-card';
      let downPos = null;
      card.addEventListener('pointerdown', e => { downPos = { x: e.clientX, y: e.clientY }; });
      card.addEventListener('pointerup', e => {
        if (!downPos) return;
        const dx = e.clientX - downPos.x;
        const dy = e.clientY - downPos.y;
        if (Math.hypot(dx, dy) < 5) {
          if (card.classList.contains('expanded')) {
            card.classList.remove('expanded');
            card.innerHTML = summaryTemplate(b, i);
          } else {
            card.classList.add('expanded');
            card.innerHTML = detailTemplate(b);
          }
        }
        downPos = null;
      });
      card.innerHTML = summaryTemplate(b, i);
      grid.appendChild(card);
    });
}

// ── Load & render checkouts ───────────────────────────────────────────────────
let isRefreshing = false;

async function loadAndRenderCheckouts({ force = false } = {}) {
  show('#checkouts-view');
  const grid = $('#books-grid');
  const refreshBtn = $('#refresh-btn');
  const loadingStatus = $('#loading-status');

  // --- 1. Immediate render from cache ---
  try {
    const db = await openDB();
    const cachedRawRecords = await getAllRaw(db);
    if (cachedRawRecords.length > 0) {
      const books = cachedRawRecords.map(processRaw).sort((a, b) => a.realDueMs - b.realDueMs);
      renderBooks(books);
    } else {
      grid.textContent = 'No checkouts found. Try refreshing.';
    }
  } catch(err) {
    console.error("Error loading from cache:", err);
    grid.textContent = 'Could not load checkout data.';
  }

  // --- 2. Check if a background refresh is needed ---
  if (isRefreshing) return;

  const db = await openDB();
  const lastFetch = await getMeta(db, 'lastFetchedDate');
  const needsRefresh = force || !isSameDay(lastFetch);

  if (!needsRefresh) return;

  // --- 3. Start background refresh ---
  try {
    isRefreshing = true;
    refreshBtn.disabled = true;
    loadingStatus.textContent = 'Updating...';

    const newRawRecords = [];
    const accts = getAccounts();
    for (const acct of accts) {
      loadingStatus.textContent = `Loading checkouts for ${acct.displayName || acct.accountId}…`;
      const json = await fetchCheckoutsViaProxy(acct);
      newRawRecords.push(...extractRawBooks(json, acct));
    }

    // --- 4. Update DB and re-render with fresh data ---
    await clearStore(db, STORE_CHECKOUTS);
    await setMeta(db, 'lastFetchedDate', new Date().toISOString());
    await saveRawRecords(db, newRawRecords);

    const updatedBooks = newRawRecords.map(processRaw).sort((a, b) => a.realDueMs - b.realDueMs);
    renderBooks(updatedBooks);
    loadingStatus.textContent = ''; // Clear status on success

  } catch (err) {
    loadingStatus.textContent = 'Error refreshing checkouts.';
    console.error(err);
  } finally {
    // --- 5. Cleanup ---
    isRefreshing = false;
    refreshBtn.disabled = false;
  }
}

$('#see-checkouts-btn').addEventListener('click', () => loadAndRenderCheckouts());
$('#refresh-btn').addEventListener('click', () => loadAndRenderCheckouts({ force: true }));

// ── Init ─────────────────────────────────────────────────────────────────────
renderAccounts();