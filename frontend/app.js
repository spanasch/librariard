const LOGIN_URL = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

// ── View helpers ─────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const show = (id) => {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
};

// ── LocalStorage accounts ────────────────────────────────────────────────────
function getAccounts() {
  return JSON.parse(localStorage.getItem('librariard_accounts')||'[]');
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
      <span>${acct.displayName}</span>
      <button data-index="${i}">−</button>
    `;
    ul.appendChild(li);
  });
}

// ── Add/Delete handlers ──────────────────────────────────────────────────────
$('#add-account-btn').addEventListener('click', ()=> { show('#account-form-view'); });
$('#back-to-main-1').addEventListener('click', ()=> { show('#main-view'); });
$('#back-to-main-2').addEventListener('click', ()=> { show('#main-view'); });

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

$('#accounts-list').addEventListener('click', e => {
  if (e.target.matches('button')) {
    const idx = +e.target.dataset.index;
    const accts = getAccounts();
    accts.splice(idx,1);
    saveAccounts(accts);
    renderAccounts();
  }
});

// ── Fetch & render checkouts ─────────────────────────────────────────────────
async function fetchCheckoutsViaProxy(acct) {
  const query = new URLSearchParams({
    name:      acct.cardNumber,
    user_pin:  acct.pin,
    accountId: acct.accountId
  }).toString();

  const backendUrl = window.BACKEND_URL || "http://localhost:5000"; // fallback for local dev
  const res = await fetch(`${backendUrl}/checkouts?${query}`);

  return res.json();
}

function processBooks(json) {
  const MAX_RENEWS = 2;
  const today = new Date();
  return Object.values(json.entities.checkouts).map(chk => {
    const meta = json.entities.bibs[chk.metadataId].briefInfo;
    const timesRenewed = chk.timesRenewed||0;
    const renewsLeft = Math.max(0, MAX_RENEWS - timesRenewed);
    const origDue = new Date(chk.dueDate);
    const realDue = new Date(origDue.getTime() + renewsLeft*3*7*24*60*60*1000);
    return {
      title: meta.title,
      cover: meta.jacket.medium,
      dueDate: chk.dueDate,
      renewLabel: renewsLeft>0? `+${3*renewsLeft}wk`:'',
      realDue,
      dueSoon: realDue <= new Date(today.getTime() + 7*24*60*60*1000)
    };
  });
}

$('#see-checkouts-btn').addEventListener('click', async () => {
  show('#checkouts-view');
  const grid = $('#books-grid');
  grid.innerHTML = 'Loading…';
  try {
    const allBooks = [];
    for (let acct of getAccounts()) {
      const json = await fetchCheckoutsViaProxy(acct);
      allBooks.push(...processBooks(json));
    }
    allBooks.sort((a,b)=>a.realDue - b.realDue);
    grid.innerHTML = allBooks.map((b,i)=>`
      <div class="book">
        <h2>${i+1}. ${b.title}</h2>
        <div class="due" style="color:${b.dueSoon?'red':'black'}">
          ${b.dueDate}${b.renewLabel?` <em>${b.renewLabel}</em>`:''}
        </div>
        <img src="${b.cover}" alt="Cover of ${b.title}">
      </div>
    `).join('');
  } catch(err) {
    grid.textContent = 'Error loading checkouts.';
    console.error(err);
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
renderAccounts();
