// Gestione: orders to approve, people and their codes, recent orders. Gabriele sees all of it; a manager sees the parts
// their rights allow. Uses $, esc, api, vai, st, WA from app.js.
const g = {ordini: [], q: {}, persone: {}};
const LOGIN = {passkey: "Face ID o impronta", pin: "PIN", nessuno: "da attivare"};
const codiceLeggibile = c => c.slice(0, 5) + "-" + c.slice(5);

async function apriGestione(){
  if (location.hash !== "#gestione") history.replaceState(null, "", "#gestione");
  $("#chi-gest").textContent = st.nome; $("#err-gest").textContent = ""; $("#g-prova").hidden = !(st.prova && st.approva);
  $("#g-sez-ordini").hidden = $("#g-sez-recenti").hidden = !st.approva; $("#g-sez-persone").hidden = !st.gestisce;
  vai("gestione");
  await Promise.all([st.approva && caricaOrdini(), st.gestisce && caricaPersone()]);
}
function errore(r){ if (r.status === 401) { st.dopo = "gestione"; sessione(); return true; } if (!r.ok) { $("#err-gest").textContent = r.d.errore || "Non riuscito."; return true; } return false; }

async function caricaOrdini(){
  const r = await api("/api/ordini");
  if (errore(r)) return;
  g.ordini = r.d.da_approvare; g.q = {};
  for (const o of g.ordini) g.q[o.id] = o.righe.map(x => x.q);
  $("#g-ordini").innerHTML = g.ordini.length ? g.ordini.map(schedaOrdine).join("") : `<p class="vuoto">Nessun ordine da approvare.</p>`;
  $("#g-recenti").innerHTML = r.d.recenti.length ? r.d.recenti.map(o => `<div class="riga"><span class="nome">${esc(o.reparto)}, ${esc(o.sede)}<span class="dett">venerdì ${breve(o.settimana)} · ${o.stato === "approvato" ? "approvato" : "non approvato"}</span></span>${o.stato === "approvato" ? `<a class="indietro" href="/api/ordini?pdf=${o.id}">Scarica PDF</a>` : ""}</div>`).join("") : `<p class="vuoto">Ancora nessuno.</p>`;
}
const valore = q => q === null ? "—" : q;
function schedaOrdine(o){
  return `<div class="scheda" data-ordine="${o.id}"><p class="etichetta">${esc(o.reparto)}, ${esc(o.sede)} · venerdì ${breve(o.settimana)}</p><div class="scelte">` +
    o.righe.map((x, i) => `<div class="riga${g.q[o.id][i] === 0 ? "" : " scelto"}" data-i="${i}"><span class="nome">${esc(x.nome)}<span class="dett">${esc([x.formato, x.chi.map(c => c.nome + " " + (c.q ?? "da indicare")).join(", ")].filter(Boolean).join(" · "))}</span></span><span class="passo"><button class="meno" aria-label="Togli uno">−</button><output>${valore(g.q[o.id][i])}</output><button class="piu" aria-label="Aggiungi uno">+</button></span></div>`).join("") +
    `</div>${o.note.map(n => `<p class="nota">${esc(n.nome)}: ${esc(n.nota)}</p>`).join("")}<button class="pill" data-approva style="width:100%;margin-top:14px">Approva con Face ID</button></div>`;
}
$("#g-ordini").addEventListener("click", async e => {
  const scheda = e.target.closest("[data-ordine]"); if (!scheda) return;
  const id = Number(scheda.dataset.ordine), qs = g.q[id];
  const b = e.target.closest(".passo button");
  if (b) {
    const riga = b.closest(".riga"), i = Number(riga.dataset.i), piu = b.classList.contains("piu");
    qs[i] = qs[i] === null ? (piu ? 1 : 0) : Math.min(99, Math.max(0, qs[i] + (piu ? 1 : -1)));
    riga.querySelector("output").textContent = valore(qs[i]); riga.classList.toggle("scelto", qs[i] !== 0);
    return;
  }
  if (!e.target.closest("[data-approva]")) return;
  if (qs.every(q => q === 0) && !confirm("Hai tolto tutte le righe: l'ordine non verrà approvato. Confermi?")) return;
  const btn = e.target.closest("[data-approva]"); btn.disabled = true; $("#err-gest").textContent = "";
  try {
    const o = await api("/api/ordini", "POST", {passo: "opzioni", ordine: id, righe: qs.map((q, indice) => ({indice, q}))});
    if (errore(o)) return;
    let risposta;
    try { risposta = await WA.startAuthentication({optionsJSON: o.d.opzioni}); }
    catch (x) { $("#err-gest").textContent = "Conferma annullata. L'ordine non è stato approvato."; return; }
    const v = await api("/api/ordini", "POST", {passo: "approva", sfida: o.d.sfida, risposta});
    if (errore(v)) return;
    alert(v.d.stato === "rifiutato" ? "Ordine non approvato." : v.d.email ? "Approvato. Il PDF è partito per email." : "Approvato. L'email non è partita: scarica il PDF da \"Approvati di recente\".");
    await caricaOrdini();
  } finally { btn.disabled = false; }
});

async function caricaPersone(){
  const r = await api("/api/persone");
  if (errore(r)) return;
  g.persone = Object.fromEntries(r.d.map(p => [p.id, p]));
  const admin = st.ruolo === "admin";
  $("#g-persone").innerHTML = r.d.map(p => {
    // A manager acts on staff only; nobody acts on Gabriele from here.
    const puo = p.ruolo === "staff" || (admin && p.ruolo === "manager");
    return `<div class="riga" data-persona="${p.id}" data-nome="${esc(p.nome)}"><span class="nome">${esc(p.nome)}<span class="dett">${RUOLO(p)}${LOGIN[p.accesso]}${p.bloccato ? " · PIN bloccato" : ""}</span></span>${puo ? `<span class="azioni"><button class="indietro" data-azione="codice">Codice</button><button class="indietro" data-azione="telefono-perso">Perso</button><button class="indietro" data-azione="rimuovi">Togli</button>${admin ? `<button class="indietro" data-azione="ruolo">Ruolo</button>` : ""}</span>` : ""}</div>`;
  }).join("");
}
function RUOLO(p){
  if (p.ruolo === "admin") return "Gestione · ";
  if (p.ruolo !== "manager") return "";
  const d = [p.approva && "approva ordini", p.gestisce && "gestisce persone"].filter(Boolean);
  return "Responsabile" + (d.length ? " (" + d.join(", ") + ")" : ", nessun permesso") + " · ";
}
// Sends a people request; when the server asks for Face ID first, asks for it and sends the confirmation.
async function conConferma(dati){
  let r = await api("/api/persone", "POST", dati);
  if (r.ok && r.d.conferma) {
    let risposta;
    try { risposta = await WA.startAuthentication({optionsJSON: r.d.opzioni}); }
    catch (x) { $("#err-gest").textContent = "Conferma annullata. Non è cambiato niente."; return null; }
    r = await api("/api/persone", "POST", {azione: "conferma", sfida: r.d.sfida, risposta});
  }
  return errore(r) ? null : r;
}
function editorRuolo(riga, p){
  document.querySelectorAll("[data-editor]").forEach(x => x.remove());
  const casella = (c, testo, dett, on) => `<label class="riga"><span class="nome">${testo}${dett ? `<span class="dett">${dett}</span>` : ""}</span><input type="checkbox" data-c="${c}"${on ? " checked" : ""} style="width:22px;height:22px;accent-color:var(--pomodoro)"></label>`;
  riga.insertAdjacentHTML("afterend", `<div class="scheda" data-editor="${p.id}"><p class="etichetta">Ruolo di ${esc(p.nome)}</p><div class="scelte">` +
    casella("manager", "Responsabile", "entra solo con Face ID o impronta", p.ruolo === "manager") +
    casella("approva", "Approva ordini", "", p.approva) + casella("gestisce", "Gestisce persone", "solo lo staff", p.gestisce) +
    `</div><p class="nota">Dare un ruolo o un permesso chiede il tuo Face ID.</p><div class="azioni"><button class="pill" data-salva>Salva</button><button class="indietro" data-annulla>Annulla</button></div></div>`);
  const ed = riga.nextElementSibling, c = n => ed.querySelector(`[data-c="${n}"]`);
  const aggiorna = () => { for (const n of ["approva", "gestisce"]) { c(n).disabled = !c("manager").checked; if (!c("manager").checked) c(n).checked = false; } };
  c("manager").onchange = aggiorna; aggiorna();
  ed.querySelector("[data-annulla]").onclick = () => ed.remove();
  ed.querySelector("[data-salva]").onclick = async e => {
    e.target.disabled = true; $("#err-gest").textContent = "";
    try {
      const r = await conConferma({persona: p.id, azione: "ruolo", ruolo: c("manager").checked ? "manager" : "staff", approva: c("approva").checked, gestisce: c("gestisce").checked});
      if (r) caricaPersone();
    } finally { e.target.disabled = false; }
  };
}
function mostraCodice(nome, codice){
  $("#g-codice").hidden = false;
  $("#g-codice").innerHTML = `<p>Codice per <b>${esc(nome)}</b>:</p><p style="font-size:24px;letter-spacing:.12em"><b>${esc(codiceLeggibile(codice))}</b></p><p>Vale 48 ore e una sola volta. Daglielo a voce o per messaggio: lo scrive nell'app, in "Ho un codice di attivazione".</p>`;
  $("#g-codice").scrollIntoView({block: "center"});
}
$("#f-persona").onsubmit = async e => {
  e.preventDefault(); const nome = $("#g-nome").value.trim(); if (!nome) return;
  const r = await api("/api/persone", "POST", {nome});
  if (errore(r)) return;
  $("#g-nome").value = ""; mostraCodice(nome, r.d.codice); caricaPersone();
};
$("#g-persone").addEventListener("click", async e => {
  const b = e.target.closest("[data-azione]"); if (!b) return;
  const riga = b.closest("[data-persona]"), persona = Number(riga.dataset.persona), nome = riga.dataset.nome, azione = b.dataset.azione;
  if (azione === "telefono-perso" && !confirm(nome + " non potrà più entrare finché non gli dai un nuovo codice. Continuo?")) return;
  if (azione === "rimuovi" && !confirm("Togliere " + nome + " dall'app?")) return;
  if (azione === "ruolo") return editorRuolo(riga, g.persone[persona]);
  $("#err-gest").textContent = "";
  let r = azione === "rimuovi" ? await api("/api/persone?persona=" + persona, "DELETE") : await conConferma({persona, azione});
  if (azione === "rimuovi" && errore(r)) r = null;
  if (!r) return;
  if (r.d.codice) mostraCodice(nome, r.d.codice);
  caricaPersone();
});
$("#vai-gestione").onclick = apriGestione;
$("#g-chiudi").onclick = async () => {
  if (!confirm("Chiudere adesso la settimana? (solo nella versione di prova)")) return;
  const r = await api("/api/chiusura", "POST", {});
  if (!errore(r)) caricaOrdini();
};
