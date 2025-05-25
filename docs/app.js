/*
  Librariard PWA - app.js
  Updated to use IndexedDB for caching checkouts once per day,
  with automatic clear-before-write and rendering from the DB.
*/

const LOGIN_URL   = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

// ── View helpers ─────────────────────────────────────────────────────────────
const $    = s => document.querySelector(s);
const show = id => {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
};

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
    ul.append(li);
  });
}

$('#accounts-list').addEventListener('click', e => {
  if (e.target.matches('button')) {
    const idx    = +e.target.dataset.index;
    const accts  = getAccounts();
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

// ── IndexedDB configuration ──────────────────────────────────────────────────
const DB_NAME        = 'librariardDB';
const DB_VERSION     = 1;
const STORE_CHECKOUTS = 'checkouts';
const STORE_META     = 'meta';

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
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    const r = store.clear();
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
  const d1 = new Date(isoDateStr);
  const d2 = new Date();
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth()    === d2.getMonth()    &&
         d1.getDate()     === d2.getDate();
}

// Extracts the raw fields used later for calculation
function extractRawBooks(json, acct) {
  const arr = [];
  for (const chk of Object.values(json.entities.checkouts)) {
    const meta = json.entities.bibs[chk.metadataId].briefInfo;
    arr.push({
      id:            `${acct.accountId}_${chk.metadataId}`,
      accountId:     acct.accountId,
      metadataId:    chk.metadataId,
      timesRenewed:  chk.timesRenewed || 0,
      dueDate:       chk.dueDate,        // ISO string from backend
      title:         meta.title,
      cover:         meta.cover
    });
  }
  return arr;
}

// Recalculate everything that might change over time
function processRaw(rec) {
  const MAX_RENEWS = 2;
  const todayMs    = Date.now();
  const dueDateObj = new Date(rec.dueDate);
  const timesRenewed = rec.timesRenewed;
  const renewsLeft = Math.max(0, MAX_RENEWS - timesRenewed);
  const realDueMs   = dueDateObj.getTime() + renewsLeft * 21 * 24 * 3600 * 1000;

  return {
    ...rec,
    renewLabel: renewsLeft ? `+${renewsLeft * 3}wk` : '',
    realDue:    realDueMs,
    dueSoon:    (realDueMs - todayMs) < 7 * 24 * 3600 * 1000,
    dueDate:    dueDateObj.toLocaleDateString()
  };
}

// ── Fetch & render (with IndexedDB) ────────────────────────────────────────
$('#see-checkouts-btn').addEventListener('click', async () => {
  show('#checkouts-view');
  const grid = $('#books-grid');
  grid.innerHTML = 'Loading…';

  try {
    const db        = await openDB();
    const lastFetch = await getMeta(db, 'lastFetchedDate');
    let rawRecords;

    if (lastFetch && isSameDay(lastFetch)) {
      rawRecords = await getAllRaw(db);
    } else {
      rawRecords = [];
      for (const acct of getAccounts()) {
        const json = await fetchCheckoutsViaProxy(acct);
        rawRecords.push(...extractRawBooks(json, acct));
      }
      await clearStore(db, STORE_CHECKOUTS);
      await setMeta(db, 'lastFetchedDate', new Date().toISOString());
      await saveRawRecords(db, rawRecords);
    }

    const books = rawRecords
      .map(processRaw)
      .sort((a, b) => a.realDue - b.realDue);

    grid.innerHTML = books.map((b, i) => `
      <div class="book-card">
        <h2>${i + 1}. ${b.title}</h2>
        <div class="due" style="color:${b.dueSoon ? 'red' : 'black'}">
          ${b.dueDate}${b.renewLabel ? ` <em>${b.renewLabel}</em>` : ''}
        </div>
        <img src="${b.cover}" alt="Cover of ${b.title}">
      </div>
    `).join('');

  } catch (err) {
    grid.textContent = 'Error loading checkouts.';
    console.error(err);
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
renderAccounts();
