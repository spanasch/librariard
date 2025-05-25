/*
  Librariard PWA - app.js
  Updated: display calculated real due date, new header colors, formatted dates, and overdue badge
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

// ── IndexedDB configuration ──────────────────────────────────────────────────
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
  const d1 = new Date(isoDateStr);
  const d2 = new Date();
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth()    === d2.getMonth()    &&
         d1.getDate()     === d2.getDate();
}

// ── Data extraction & processing ─────────────────────────────────────────────
function extractRawBooks(json, acct) {
  const arr = [];
  for (const chk of Object.values(json.entities.checkouts)) {
    const meta = json.entities.bibs[chk.metadataId].briefInfo;
    arr.push({
      id:            `${acct.accountId}_${chk.metadataId}`,
      accountId:     acct.accountId,
      metadataId:    chk.metadataId,
      timesRenewed:  chk.timesRenewed || 0,
      dueDate:       chk.dueDate,
      title:         meta.title,
      cover:         meta.jacket.medium
    });
  }
  return arr;
}

function processRaw(rec) {
  const MAX_RENEWS    = 2;
  const todayMs       = Date.now();
  const originalDue   = new Date(rec.dueDate).getTime();
  const renewsLeft    = Math.max(0, MAX_RENEWS - (rec.timesRenewed || 0));
  const realDueMs     = originalDue + renewsLeft * 21 * 24 * 3600 * 1000;
  const diffMs        = realDueMs - todayMs;
  const dueWithinWeek = diffMs >= 0 && diffMs < 7 * 24 * 3600 * 1000;
  const dueWithin2Wks = diffMs >= 0 && diffMs < 14 * 24 * 3600 * 1000;
  const realDueDate   = new Date(realDueMs);

  // format as M/D
  const fmtDate       = `${realDueDate.getMonth()+1}/${realDueDate.getDate()}`;

  return {
    ...rec,
    renewsLeft,
    realDueMs,
    overdue:    diffMs < 0,
    dueWithinWeek,
    dueWithin2Wks,
    displayDate: fmtDate
  };
}

// ── Load & render checkouts ───────────────────────────────────────────────────
async function loadAndRenderCheckouts({ force = false } = {}) {
  show('#checkouts-view');
  const grid = $('#books-grid');
  grid.innerHTML = 'Loading…';

  try {
    const db        = await openDB();
    const lastFetch = await getMeta(db, 'lastFetchedDate');
    let rawRecords;

    if (!force && lastFetch && isSameDay(lastFetch)) {
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
      .sort((a, b) => a.realDueMs - b.realDueMs);

    grid.innerHTML = books.map((b, i) => {
      // header color logic
      const headerColor = b.overdue
        ? 'darkred'
        : b.dueWithinWeek
          ? 'darkorange'
          : b.dueWithin2Wks
            ? 'darkblue'
            : 'black';

      // badge: exclamation if overdue, else renew count if >0
      const badge = b.overdue
        ? '<span class="badge">!</span>'
        : (b.renewsLeft > 0)
          ? `<span class="badge">Renews: ${b.renewsLeft}</span>`
          : '';

      return `
        <div class="book-card">
          <div class="card-header" style="background-color:${headerColor}; color:white;">
            <div class="header-left">
              <span class="index">${i + 1}</span>
              <span class="date">${b.displayDate}</span>
            </div>
            ${badge}
          </div>
          <div class="card-body">
            <img src="${b.cover}" alt="Cover of ${b.title}">
            <h2>${b.title}</h2>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    grid.textContent = 'Error loading checkouts.';
    console.error(err);
  }
}

$('#see-checkouts-btn').addEventListener('click', () => loadAndRenderCheckouts());
$('#refresh-btn').addEventListener('click', () => loadAndRenderCheckouts({ force: true }));

// ── Init ─────────────────────────────────────────────────────────────────────
renderAccounts();
