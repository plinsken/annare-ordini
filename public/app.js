// Staff app: login (passkey or PIN), requests, "Le mie richieste". Gabriele's section is in gestione.js.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const breve = s => s.slice(8, 10) + "/" + s.slice(5, 7);
const WA = window.SimpleWebAuthnBrowser;
let DATI = {}, SEDI = [];
const st = {nome:"", ruolo:"", approva:false, gestisce:false, sedi:null, reparti:null, prova:false, sede:"", reparto:"", q:{}, aperte:{}, altroNome:"", altroQ:"", note:"", modifica:null, modificaSettimana:"", dopo:"", mie:[]};
function salva(){try{localStorage.setItem("annare-ordini",JSON.stringify({sede:st.sede}))}catch(e){}}
try{const v=JSON.parse(localStorage.getItem("annare-ordini")||"{}");st.sede=v.sede||""}catch(e){}

function vai(n){document.querySelectorAll(".vista").forEach(v=>v.classList.toggle("attiva",v.id==="v-"+n));window.scrollTo(0,0);if(n!=="gestione"&&location.hash==="#gestione")history.replaceState(null,"",location.pathname)}
document.querySelectorAll("[data-vai]").forEach(b=>b.onclick=()=>vai(b.dataset.vai));
const key=(c,p)=>c+"|"+p;

// Every call to the server. Never throws: a lost connection comes back as status 0.
async function api(url, metodo = "GET", dati) {
  try {
    const r = await fetch(url, {method: metodo, headers: dati ? {"Content-Type": "application/json"} : {}, body: dati ? JSON.stringify(dati) : undefined});
    return {ok: r.ok, status: r.status, d: await r.json().catch(() => ({}))};
  } catch (e) { return {ok: false, status: 0, d: {errore: "Nessuna connessione. Riprova."}}; }
}

function scelte(el,lista,att,on){el.innerHTML=lista.map(([v,s])=>`<button class="scelta" aria-pressed="${v===att}" data-v="${esc(v)}">${esc(v)}${s?`<small>${esc(s)}</small>`:""}</button>`).join("");
  el.querySelectorAll("button").forEach(b=>b.onclick=()=>{on(b.dataset.v);el.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b))})}
function inizio(){
  $("#nome").textContent=st.nome;
  $("#vai-gestione").hidden=!(st.approva||st.gestisce);
  // Only the shops and departments this person may order for; with just one, it is already chosen.
  const sedi=SEDI.filter(s=>!st.sedi||st.sedi.includes(s)),reparti=Object.keys(DATI).filter(r=>!st.reparti||st.reparti.includes(r));
  if(!sedi.includes(st.sede))st.sede=sedi.length===1?sedi[0]:"";
  if(st.reparto&&!reparti.includes(st.reparto)){st.reparto="";st.q={};st.aperte={}}
  if(reparti.length===1&&!st.reparto)st.reparto=reparti[0];
  // One shop and one department: nothing to choose, the product list is home and this page is the menu.
  st.unico=!!st.nome&&sedi.length===1&&reparti.length===1;
  $("#dove").hidden=st.unico;$("#vai-lista").textContent=st.unico?"Nuova richiesta":"Avanti";
  $("#v-lista .testa [data-vai]").textContent=st.unico?"Menu":"Indietro";
  scelte($("#sedi"),sedi.map(s=>[s,""]),st.sede,v=>{st.sede=v;salva();$("#err-inizio").textContent=""});
  scelte($("#reparti"),reparti.map(r=>[r,Object.values(DATI[r]).reduce((a,c)=>a+c.length,0)+" prodotti"]),st.reparto,v=>{if(v!==st.reparto){st.q={};st.aperte={}}st.reparto=v;$("#err-inizio").textContent=""});
}

// ---- Login ----
async function sessione(){
  const r = await api("/api/sessione");
  st.prova = !!r.d.prova; $(".prova").hidden = !st.prova;
  if (r.ok) { Object.assign(st, {nome: r.d.nome, ruolo: r.d.ruolo, approva: !!r.d.approva, gestisce: !!r.d.gestisce, sedi: r.d.sedi ?? null, reparti: r.d.reparti ?? null}); return dopoAccesso(); }
  if (r.status === 401) { vai(r.d.dispositivo ? "pin" : "accesso"); $("#err-pin").textContent = r.d.bloccato ? "Telefono bloccato. Chiedi un nuovo codice a Gabriele." : ""; }
  else if (r.status) { $("#err-accesso").textContent = r.d.errore || "Servizio non disponibile."; vai("accesso"); }
}
function dopoAccesso(){
  inizio();
  if ((st.approva || st.gestisce) && location.hash === "#gestione") return apriGestione();
  if (!st.dopo && st.unico) return apriLista();
  vai(st.dopo || "inizio"); st.dopo = "";
}
// The session route also says which rights this person has.
function entrato(){ sessione(); }

$("#entra").onclick = async () => {
  const err = $("#err-accesso"), btn = $("#entra"); err.textContent = "";
  if (!WA.browserSupportsWebAuthn()) { err.textContent = "Questo telefono non può entrare con Face ID o impronta. Tocca \"Ho un codice di attivazione\" e scegli un PIN."; return; }
  btn.disabled = true;
  try {
    const o = await api("/api/accesso", "POST", {passo: "opzioni"});
    if (!o.ok) { err.textContent = o.d.errore || "Accesso non riuscito."; return; }
    let risposta;
    try { risposta = await WA.startAuthentication({optionsJSON: o.d.opzioni}); }
    catch (e) { err.textContent = "Accesso non riuscito. Riprova. Se entravi con il PIN, questo telefono non è più attivo: chiedi un nuovo codice a Gabriele."; return; }
    const v = await api("/api/accesso", "POST", {passo: "verifica", sfida: o.d.sfida, risposta});
    if (!v.ok) { err.textContent = v.d.errore || "Accesso non riuscito."; return; }
    entrato(v.d);
  } finally { btn.disabled = false; }
};

let att = null;   // activation in progress: {sfida, opzioni, ruolo}
function modoPin(msg){
  $("#f-attiva").hidden = true; $("#blocco-pin").hidden = false;
  $("#msg-pin").textContent = msg; $("#riprova-passkey").hidden = !WA.browserSupportsWebAuthn();
}
async function creaPasskey(){
  const err = $("#err-attiva"); err.textContent = ""; $("#err-pin1").textContent = "";
  let risposta;
  try { risposta = await WA.startRegistration({optionsJSON: att.opzioni}); }
  catch (e) {
    if (att.ruolo === "staff") return modoPin("Il telefono non è riuscito a creare l'accesso. Riprova con Face ID, oppure scegli un PIN di 6 cifre.");
    err.textContent = "Non sono riuscito a creare l'accesso. Riprova."; return;
  }
  const r = await api("/api/attiva", "POST", {passo: "passkey", sfida: att.sfida, risposta});
  att = null;
  if (!r.ok) { $("#f-attiva").hidden = false; $("#blocco-pin").hidden = true; err.textContent = r.d.errore || "Attivazione non riuscita."; return; }
  $("#codice").value = ""; entrato(r.d);
}
$("#f-attiva").onsubmit = async e => {
  e.preventDefault(); const err = $("#err-attiva"), btn = $("#attiva"); err.textContent = ""; btn.disabled = true;
  try {
    const r = await api("/api/attiva", "POST", {passo: "codice", codice: $("#codice").value});
    if (!r.ok) { err.textContent = r.d.errore || "Codice non valido."; return; }
    att = r.d;
    if (WA.browserSupportsWebAuthn()) await creaPasskey();
    else if (att.ruolo === "staff") modoPin("Questo telefono non può usare Face ID o impronta per l'app. Scegli un PIN di 6 cifre.");
    else err.textContent = "Per questo account serve un telefono con Face ID, impronta o blocco schermo.";
  } finally { btn.disabled = false; }
};
$("#riprova-passkey").onclick = () => att ? creaPasskey() : vai("attiva");
$("#f-nuovo-pin").onsubmit = async e => {
  e.preventDefault(); const err = $("#err-pin1"), a = $("#pin1").value, b = $("#pin2").value; err.textContent = "";
  if (!/^\d{6}$/.test(a)) { err.textContent = "Il PIN deve avere 6 cifre."; return; }
  if (a !== b) { err.textContent = "I due PIN non sono uguali."; return; }
  if (!att) { err.textContent = "Attivazione scaduta. Inserisci di nuovo il codice."; $("#f-attiva").hidden = false; $("#blocco-pin").hidden = true; return; }
  const r = await api("/api/attiva", "POST", {passo: "pin", sfida: att.sfida, pin: a});
  if (!r.ok) { err.textContent = r.d.errore || "Non riuscito."; if (r.status !== 400 || /scaduta/.test(r.d.errore || "")) { att = null; } return; }
  att = null; $("#pin1").value = $("#pin2").value = $("#codice").value = ""; $("#f-attiva").hidden = false; $("#blocco-pin").hidden = true;
  entrato(r.d);
};
$("#f-pin").onsubmit = async e => {
  e.preventDefault(); const err = $("#err-pin"); err.textContent = "";
  const r = await api("/api/accesso", "POST", {passo: "pin", pin: $("#pin").value});
  $("#pin").value = "";
  if (!r.ok) { err.textContent = r.d.errore || "PIN sbagliato."; return; }
  entrato(r.d);
};
$("#esci").onclick = async () => { await api("/api/sessione", "DELETE"); Object.assign(st, {nome: "", ruolo: "", approva: false, gestisce: false, sedi: null, reparti: null}); sessione(); };

// ---- New or edited request ----
function apriLista(){
  const m=!st.sede?"Scegli la sede.":!st.reparto?"Scegli il reparto.":"";
  if(m){$("#err-inizio").textContent=m;vai("inizio");return}
  $("#nome-reparto").textContent=st.reparto.toLowerCase();
  $("#chi-lista").textContent=st.nome+", "+st.sede;
  $("#cerca").value="";lista();vai("lista");
}
$("#vai-lista").onclick=()=>{ if(!st.nome)return sessione(); apriLista(); };

function lista(){
  const f=$("#cerca").value.trim().toLowerCase();
  const cats=DATI[st.reparto];let html="";
  for(const c in cats){
    const prod=cats[c].filter(p=>!f||p[0].toLowerCase().includes(f)||(p[1]||"").toLowerCase().includes(f));
    if(!prod.length)continue;
    const n=cats[c].filter(p=>st.q[key(c,p[0])]>0).length;
    const aperta=f||st.aperte[c];
    html+=`<div class="cat${aperta?" aperta":""}" data-c="${esc(c)}"><button aria-expanded="${!!aperta}"><span>${esc(c)}</span><span class="conta">${n?`<b>${n} scelti</b> · `:""}${cats[c].length}</span></button><div class="prodotti">`+
      prod.map(p=>{const k=key(c,p[0]),q=st.q[k]||0;return `<div class="riga${q?" scelto":""}" data-k="${esc(k)}"><span class="nome">${esc(p[0])}<span class="dett">${esc([p[1],p[2]].filter(Boolean).join(", ")||"formato da indicare")}</span></span><span class="passo"><button class="meno" aria-label="Togli uno">−</button><output>${q}</output><button class="piu" aria-label="Aggiungi uno">+</button></span></div>`}).join("")+`</div></div>`;
  }
  $("#categorie").innerHTML=html||`<p class="vuoto">Nessun prodotto con questo nome. Puoi scriverlo in "Altro prodotto".</p>`;
  conta();
}
$("#categorie").addEventListener("click",e=>{
  const cat=e.target.closest(".cat");if(!cat)return;
  if(e.target.closest(".cat>button")){const c=cat.dataset.c;st.aperte[c]=!st.aperte[c];cat.classList.toggle("aperta",st.aperte[c]);e.target.closest("button").setAttribute("aria-expanded",!!st.aperte[c]);return}
  const b=e.target.closest(".passo button");if(!b)return;
  const r=b.closest(".riga"),k=r.dataset.k;
  st.q[k]=Math.min(99,Math.max(0,(st.q[k]||0)+(b.classList.contains("piu")?1:-1)));
  r.querySelector("output").textContent=st.q[k];r.classList.toggle("scelto",st.q[k]>0);
  const c=cat.dataset.c,n=DATI[st.reparto][c].filter(p=>st.q[key(c,p[0])]>0).length;
  cat.querySelector(".conta").innerHTML=(n?`<b>${n} scelti</b> · `:"")+DATI[st.reparto][c].length;
  conta();
});
$("#cerca").oninput=lista;
$("#altro-nome").oninput=e=>{st.altroNome=e.target.value.trim();conta()};
$("#altro-q").oninput=e=>{st.altroQ=e.target.value.trim();conta()};

function scelti(){
  const out=[];const cats=DATI[st.reparto]||{};
  for(const c in cats){const r=cats[c].filter(p=>st.q[key(c,p[0])]>0).map(p=>({nome:p[0],dett:p[1],formato:p[2],q:st.q[key(c,p[0])]}));if(r.length)out.push({cat:c,righe:r})}
  if(st.altroNome)out.push({cat:"Altro",righe:[{nome:st.altroNome,dett:"",formato:"",q:st.altroQ||"da indicare"}]});
  return out;
}
function conta(){const n=scelti().reduce((a,g)=>a+g.righe.length,0);$("#vai-riepilogo").textContent="Riepilogo, "+n+(n===1?" prodotto":" prodotti")}

$("#vai-riepilogo").onclick=()=>{
  const g=scelti();
  $("#chi-riep").textContent=st.reparto+", "+st.sede;
  $("#riepilogo").innerHTML=g.length?g.map(x=>`<p class="etichetta">${esc(x.cat)}</p><div class="scelte">`+x.righe.map(r=>`<div class="riga scelto"><span class="nome">${esc(r.nome)}<span class="dett">${esc(r.formato||"")}</span></span><b>${esc(r.q)}</b></div>`).join("")+`</div>`).join(""):`<p class="vuoto">Non hai ancora scelto nessun prodotto.</p>`;
  $("#invia").textContent=st.modifica?"Salva le modifiche":"Invia richiesta";
  $("#err-riep").textContent="";vai("riepilogo");
};
$("#note").oninput=e=>st.note=e.target.value.trim();

function pulisci(){st.q={};st.aperte={};st.altroNome=st.altroQ=st.note="";st.modifica=null;st.modificaSettimana="";$("#altro-nome").value=$("#altro-q").value=$("#note").value=""}
$("#invia").onclick=async()=>{
  const g=scelti(),btn=$("#invia"),err=$("#err-riep");
  if(!g.length){err.textContent="Aggiungi almeno un prodotto prima di inviare.";return}
  let aq="";
  if(st.altroNome&&st.altroQ){aq=Number(st.altroQ);if(!Number.isInteger(aq)||aq<1||aq>99){err.textContent='La quantità di "Altro" deve essere un numero da 1 a 99.';return}}
  if(btn.disabled)return;
  const corpo={sede:st.sede,reparto:st.reparto,nota:st.note,righe:[],altro:st.altroNome?{nome:st.altroNome,q:aq}:undefined};
  for(const c in DATI[st.reparto])for(const p of DATI[st.reparto][c]){const q=st.q[key(c,p[0])];if(q>0)corpo.righe.push({cat:c,nome:p[0],q})}
  const testo=btn.textContent;btn.disabled=true;btn.textContent="Salvo";err.textContent="";
  try{
    const r=await api(st.modifica?"/api/richieste?id="+st.modifica:"/api/richieste",st.modifica?"PUT":"POST",corpo);
    if(r.status===401){st.dopo="riepilogo";return sessione()}
    if(!r.ok){err.textContent=(r.d.errore||"Non sono riuscito a salvare.")+(st.modifica?"":" La richiesta non è partita.");return}
    const settimana=r.d.settimana||st.modificaSettimana;
    $("#t-fatto em").textContent=st.modifica?"modificata":"salvata";
    $("#fatto-num").textContent=st.reparto+", "+st.sede+".";
    $("#fatto-msg").textContent="Entra nell'ordine di venerdì "+breve(settimana)+'. Puoi cambiarla o annullarla da "Le mie richieste" fino a venerdì alle 16:00.';
    pulisci();vai("fatto");
  }finally{btn.disabled=false;btn.textContent=testo}
};
$("#nuovo").onclick=()=>{pulisci();inizio();st.unico?apriLista():vai("inizio")};

// ---- Le mie richieste ----
const puoOrdinare=a=>(!st.sedi||st.sedi.includes(a.sede))&&(!st.reparti||st.reparti.includes(a.reparto));
const ESITO={in_attesa:"In attesa di Gabriele",approvato:"Approvata",non_approvato:"Non approvata"};
const righeMie=l=>l.map(x=>`<div class="riga"><span class="nome">${esc(x.nome)}<span class="dett">${esc(x.formato||"")}${x.cambio?` · Gabriele ha cambiato il totale: ${esc(x.cambio.prima??"da indicare")} → ${x.cambio.dopo===0?"tolto":esc(x.cambio.dopo??"da indicare")}`:""}</span></span><b>${esc(x.q??"da indicare")}</b></div>`).join("");
async function mie(){
  $("#chi-mie").textContent=st.nome;$("#err-mie").textContent="";$("#mie").innerHTML=`<p class="vuoto">Carico…</p>`;vai("mie");
  const r=await api("/api/richieste");
  if(r.status===401)return sessione();
  if(!r.ok){$("#err-mie").textContent=r.d.errore||"Non riesco a caricare le richieste.";return}
  const {settimana,aperte,passate}=r.d;st.mie=aperte;
  $("#mie-scadenza").textContent="Ordine di venerdì "+breve(settimana)+": si chiude venerdì alle 16:00.";
  let h=aperte.length?"":`<p class="vuoto">Nessuna richiesta aperta.</p>`;
  for(const a of aperte)h+=`<div class="scheda"><p class="etichetta">${esc(a.reparto)}, ${esc(a.sede)} · venerdì ${breve(a.settimana)}</p><div class="scelte">${righeMie(a.righe)}</div>${a.nota?`<p class="nota">${esc(a.nota)}</p>`:""}<div class="azioni">${puoOrdinare(a)?`<button class="indietro" data-modifica="${a.id}">Modifica</button>`:""}<button class="indietro" data-annulla="${a.id}">Annulla</button></div></div>`;
  if(passate.length){h+=`<p class="etichetta">Settimane chiuse</p>`;for(const p of passate)h+=`<div class="scheda"><p class="etichetta">${esc(p.reparto)}, ${esc(p.sede)} · venerdì ${breve(p.settimana)}</p><p class="nota"><b>${ESITO[p.esito]}</b></p><div class="scelte">${righeMie(p.righe)}</div></div>`}
  $("#mie").innerHTML=h;
}
function caricaRichiesta(r){
  pulisci();st.sede=r.sede;st.reparto=r.reparto;
  const spariti=[];
  for(const l of r.righe){if(l.cat==="Altro"){st.altroNome=l.nome;st.altroQ=l.q==null?"":String(l.q)}else if((DATI[r.reparto]?.[l.cat]||[]).some(p=>p[0]===l.nome)){st.q[key(l.cat,l.nome)]=l.q;st.aperte[l.cat]=true}else spariti.push(l.nome)}
  if(spariti.length)alert((spariti.length===1?spariti[0]+" non è più in lista":spariti.join(", ")+" non sono più in lista")+". Aggiungilo di nuovo o scrivilo in \"Altro prodotto\", altrimenti con il salvataggio sparisce dalla richiesta.");
  st.note=r.nota||"";st.modifica=r.id;st.modificaSettimana=r.settimana;
  $("#altro-nome").value=st.altroNome;$("#altro-q").value=st.altroQ;$("#note").value=st.note;
  inizio();apriLista();
}
$("#mie").addEventListener("click",async e=>{
  const m=e.target.closest("[data-modifica]"),a=e.target.closest("[data-annulla]");
  if(m)caricaRichiesta(st.mie.find(x=>String(x.id)===m.dataset.modifica));
  if(a&&confirm("Vuoi annullare questa richiesta?")){const r=await api("/api/richieste?id="+a.dataset.annulla,"DELETE");await mie();if(!r.ok)$("#err-mie").textContent=r.d.errore||"Non riuscito."}
});
$("#vai-mie").onclick=mie;
$("#vai-mie-2").onclick=mie;

// ---- Start ----
(async()=>{
  try{const c=await (await fetch("prodotti.json")).json();DATI=c.reparti;SEDI=c.sedi}catch(e){$("#err-inizio").textContent="Non riesco a caricare i prodotti. Controlla la connessione."}
  inizio();
  for(const v of ["#v-accesso","#v-attiva","#v-pin"])$(v).prepend($("#v-inizio .logo").cloneNode(true));
  sessione();
})();
const standalone=matchMedia("(display-mode: standalone)").matches||navigator.standalone;
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
let richiesta=null;
if(!standalone&&ios){$("#installa").hidden=false;$("#installa").innerHTML="<p><b>Installa l'app sul telefono.</b></p><p>In Safari tocca il tasto Condividi, il quadrato con la freccia in su, poi scegli \"Aggiungi alla schermata Home\".</p>"}
addEventListener("beforeinstallprompt",e=>{e.preventDefault();richiesta=e;if(standalone)return;$("#installa").hidden=false;$("#installa").innerHTML='<p><b>Installa l\'app sul telefono.</b> Così la apri dall\'icona, come le altre app.</p><button class="pill" id="btn-installa">Installa l\'app</button>';$("#btn-installa").onclick=async()=>{richiesta.prompt();await richiesta.userChoice;richiesta=null;$("#installa").hidden=true}});
addEventListener("appinstalled",()=>{$("#installa").hidden=true});
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js");
