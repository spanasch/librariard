/*
  Librariard PWA - app.js
  Updates:
    - Fix date parsing to treat originalDue as local date (no timezone shift)
    - If originalDue < today, realDue = originalDue
    - Sort on realDue
    - Show both overdue (!) and renew badges when applicable
    - Clear "Loading..." before rendering, and update loading message per account
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
  const ul = $('#accounts-list'); ul.innerHTML = '';
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
    const idx = +e.target.dataset.index;
    const accts = getAccounts(); accts.splice(idx, 1);
    saveAccounts(accts); renderAccounts();
  }
});

// ── Fetch helper ─────────────────────────────────────────────────────────────
async function fetchCheckoutsViaProxy(acct) {
  const query = new URLSearchParams({
    name: acct.cardNumber, user_pin: acct.pin, accountId: acct.accountId
  }).toString();
  const backendUrl = window.BACKEND_URL || "http://localhost:5000";
  const res = await fetch(`${backendUrl}/checkouts?${query}`);
  return res.json();
}

// ── IndexedDB setup ──────────────────────────────────────────────────────────
const DB_NAME='librariardDB', DB_VERSION=1;
const STORE_CHECKOUTS='checkouts', STORE_META='meta';
function openDB(){return new Promise((res,rej)=>{const rq=indexedDB.open(DB_NAME,DB_VERSION);
  rq.onupgradeneeded=e=>{const db=e.target.result;
    if(!db.objectStoreNames.contains(STORE_CHECKOUTS)) db.createObjectStore(STORE_CHECKOUTS,{keyPath:'id'});
    if(!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META,{keyPath:'key'});
  };
  rq.onsuccess=e=>res(e.target.result);
  rq.onerror=e=>rej(e.target.error);
});}
function getMeta(db,key){return new Promise((res,rej)=>{const tx=db.transaction(STORE_META,'readonly');const st=tx.objectStore(STORE_META);const r=st.get(key);
  r.onsuccess=()=>res(r.result? r.result.value:null);
  r.onerror=()=>rej(r.error);
});}
function setMeta(db,key,val){return new Promise((res,rej)=>{const tx=db.transaction(STORE_META,'readwrite');const st=tx.objectStore(STORE_META);const r=st.put({key,val});
  r.onsuccess=()=>res();r.onerror=()=>rej(r.error);
});}
function clearStore(db,name){return new Promise((res,rej)=>{const tx=db.transaction(name,'readwrite');const st=tx.objectStore(name);const r=st.clear();
  r.onsuccess=()=>res();r.onerror=()=>rej(r.error);
});}
function saveRawRecords(db,recs){return new Promise((res,rej)=>{const tx=db.transaction(STORE_CHECKOUTS,'readwrite');const st=tx.objectStore(STORE_CHECKOUTS);
  recs.forEach(r=>st.put(r)); tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);
});}
function getAllRaw(db){return new Promise((res,rej)=>{const tx=db.transaction(STORE_CHECKOUTS,'readonly');const st=tx.objectStore(STORE_CHECKOUTS);const r=st.getAll();
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
});}
function isSameDay(iso){const d1=new Date(iso),d2=new Date();return d1.getFullYear()===d2.getFullYear()&&d1.getMonth()===d2.getMonth()&&d1.getDate()===d2.getDate();}

// ── Data extraction & processing ─────────────────────────────────────────────
function extractRawBooks(json,acct){
  const arr=[];
  const acctName=acct.displayName||acct.accountId;
  Object.values(json.entities.checkouts).forEach(chk=>{
    const meta=json.entities.bibs[chk.metadataId].briefInfo;
    arr.push({
      id:`${acct.accountId}_${chk.metadataId}`,accountId:acct.accountId,
      accountName:acctName,metadataId:chk.metadataId,
      timesRenewed:chk.timesRenewed||0,
      dueDate:chk.dueDate,title:meta.title,cover:meta.jacket.medium
    });
  });
  return arr;
}
function processRaw(rec){
  const MAX=2;const today=Date.now();
  // parse originalDue as local Y-M-D
  const [y,m,d]=rec.dueDate.split('T')[0].split('-').map(Number);
  const origDateLocal=new Date(y,m-1,d).getTime();
  const renewsLeft=Math.max(0,MAX-(rec.timesRenewed||0));
  // if original due before today, keep that
  const realDueMs=origDateLocal<today?origDateLocal:origDateLocal+renewsLeft*21*24*3600*1000;
  const diff=realDueMs-today;
  const week=7*24*3600*1000,two=14*24*3600*1000;
  const d1=new Date(realDueMs);const dd=`${d1.getMonth()+1}/${d1.getDate()}`;
  return {...rec,renewsLeft,realDueMs,
    overdue:diff<0,dueWithinWeek:diff>=0&&diff<week,
    dueWithin2Wks:diff>=week&&diff<two,displayDate:dd};
}

// ── Templates ───────────────────────────────────────────────────────────────
function summaryTemplate(b,i){
  const color=b.overdue?'darkred':b.dueWithinWeek?'darkorange':b.dueWithin2Wks?'darkblue':'black';
  const badges=[b.overdue?'<span class="badge">!</span>':'',
                b.renewsLeft>0?`<span class="badge">Renews: ${b.renewsLeft}</span>`:''
               ].join('');
  return `<div class="card-header" style="background-color:${color};color:white;">
    <div class="header-left"><span class="index">${i+1}</span><span class="date">${b.displayDate}</span></div>
    ${badges}
  </div><div class="card-body">
    <img src="${b.cover}" alt="Cover of ${b.title}"><h2>${b.title}</h2>
  </div>`;
}
function detailTemplate(b){return `<div class="card-header" style="background-color:gray;color:white;">
    <span>Details</span></div>
  <div class="card-detail">
    <p><strong>Title:</strong> ${b.title}</p>
    <p><strong>Original Due:</strong> ${rec.dueDate.split('T')[0]}</p>
    <p><strong>Real Due:</strong> ${b.displayDate}</p>
    <p><strong>Renews Left:</strong> ${b.renewsLeft}</p>
    <p><strong>Account:</strong> ${b.accountName}</p>
  </div>`;}

// ── Load & render checkouts ───────────────────────────────────────────────────
async function loadAndRenderCheckouts({force=false}={}){
  show('#checkouts-view');
  const grid=$('#books-grid');grid.innerHTML='';
  try{
    const db=await openDB();const last=await getMeta(db,'lastFetchedDate');
    let raws=[];
    if(!force&&last&&isSameDay(last)) raws=await getAllRaw(db);
    else{ const accts=getAccounts();
      for(const acct of accts){
        grid.textContent=`Loading checkouts for ${acct.displayName||acct.accountId}…`;
        const json=await fetchCheckoutsViaProxy(acct);
        raws.push(...extractRawBooks(json,acct));
      }
      await clearStore(db,STORE_CHECKOUTS);
      await setMeta(db,'lastFetchedDate',new Date().toISOString());
      await saveRawRecords(db,raws);
    }
    const books=raws.map(processRaw).sort((a,b)=>a.realDueMs-b.realDueMs);
    grid.innerHTML='';
    books.forEach((b,i)=>{
      const card=document.createElement('div');card.className='book-card';card.dataset.index=i;
      card.innerHTML=summaryTemplate(b,i);
      card.addEventListener('click',()=>{
        if(card.classList.contains('expanded')){card.classList.remove('expanded');card.innerHTML=summaryTemplate(b,i);} else{card.classList.add('expanded');card.innerHTML=detailTemplate(b);} });
      grid.appendChild(card);
    });
  }catch(e){grid.textContent='Error loading checkouts.';console.error(e);} }
$('#see-checkouts-btn').addEventListener('click',()=>loadAndRenderCheckouts());
$('#refresh-btn').addEventListener('click',()=>loadAndRenderCheckouts({force:true}));

// ── Init ─────────────────────────────────────────────────────────────────────
renderAccounts();
