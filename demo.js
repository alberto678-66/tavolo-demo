/* Tavolo · demo nel browser. Simula il computer del locale: i dati restano solo su questo dispositivo. */
(function () {
  "use strict";
  // dentro la finestra "telefono del cliente": usa i dati della pagina principale
  try {
    if (window.parent !== window && window.parent.TavoloDemo && window.parent.TavoloDemo.fetch) {
      var pf = window.parent.TavoloDemo.fetch, fv = window.fetch.bind(window);
      window.fetch = function (i, o) { var u = new URL(typeof i === "string" ? i : i.url, location.href); return u.pathname.indexOf("/api/") >= 0 ? pf(u.href, o) : fv(i, o); };
      return;
    }
  } catch (e) {}
  var VERSIONE = "1.10.1-demo";
  var ASS = { nome: "Alberto Malic · Tavolo", tel: "349 699 1941", email: "malicalberto604@gmail.com" };
  var KEY = "tavolo-demo-v2", DURATA = 3 * 864e5;

  /* ---- piccolo sostituto di crypto/Buffer di Node, sufficiente per la demo ---- */
  var hex = function (a) { return Array.prototype.map.call(a, function (x) { return x.toString(16).padStart(2, "0"); }).join(""); };
  function randomBytes(n) {
    var a = new Uint8Array(n); self.crypto.getRandomValues(a); var o = Array.from(a);
    o.toString = function (enc) { if (enc === "base64url") return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); return hex(a); };
    return o;
  }
  function hashStr(s) { var out = "", h = 2166136261; for (var i = 0; i < 8; i++) { for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j) + i; h = Math.imul(h, 16777619) >>> 0; } out += h.toString(16).padStart(8, "0"); } return out; }
  var CR = {
    randomBytes: randomBytes,
    scryptSync: function (pin, salt) { var h = hashStr(salt + "|" + pin); return { hex: h, toString: function () { return h; } }; },
    timingSafeEqual: function (a, b) { return a.hex === b.hex; }
  };
  var Buffer = { from: function (s) { return { hex: String(s) }; } };
  var require = function () { return CR; };
  var module = { exports: {} };
  (function (require, module, Buffer) {
"use strict";
/* Tavolo — logica del gestionale (regole, permessi, dati di partenza).
   Tutte le modifiche ai dati passano da applica(): il server la chiama su una copia
   dello stato e la conserva solo se non ci sono errori. */
const crypto = require("crypto");

const REPARTI = ["Cucina", "Pizzeria", "Bar"];
const RUOLI = { titolare: "Titolare", cassa: "Cassa", cameriere: "Cameriere", cucina: "Cucina" };
const METODI = { carta: "Carta / POS", contanti: "Contanti", satispay: "App di pagamento", buoni: "Buoni pasto", piattaforma: "Pagato sulla piattaforma" };
const PIATTAFORME_BASE = [{ id: "glovo", nome: "Glovo", comm: 30 }, { id: "deliveroo", nome: "Deliveroo", comm: 30 }, { id: "justeat", nome: "Just Eat", comm: 30 }, { id: "telefono", nome: "Telefono", comm: 0 }];
const piattaforme = S => S.settings.piattaforme || PIATTAFORME_BASE;
const LINGUE = { en: "Inglese", fr: "Francese", de: "Tedesco", es: "Spagnolo" };
const ALLERGENI_EN = ["Gluten", "Crustaceans", "Eggs", "Fish", "Peanuts", "Soybeans", "Milk", "Nuts", "Celery", "Mustard", "Sesame", "Sulphites", "Lupin", "Molluscs"];
const ALLERGENI = ["Glutine", "Crostacei", "Uova", "Pesce", "Arachidi", "Soia", "Latte", "Frutta a guscio", "Sedano", "Senape", "Sesamo", "Solfiti", "Lupini", "Molluschi"];

const uid = () => crypto.randomBytes(6).toString("hex");
const round2 = n => Math.round((+n || 0) * 100) / 100;
const r3 = n => Math.round((+n || 0) * 1000) / 1000;
const dkey = t => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const ORA_CAMBIO_GIORNO = 5; // una chiusura prima delle 5 del mattino vale per il giorno prima
const giorno = t => dkey(t - ORA_CAMBIO_GIORNO * 3600e3);
const eur = n => round2(n).toFixed(2).replace(".", ",") + " €";
const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

class Errore extends Error {}
const no = m => { throw new Errore(m); };
const txt = (v, max = 80) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const num = (v, min = 0, max = 1e6) => { const n = Number(v); return isFinite(n) && n >= min && n <= max ? n : null; };

/* ---------- PIN ---------- */
function hashPin(pin) { const salt = crypto.randomBytes(8).toString("hex"); return { salt, pinHash: crypto.scryptSync(String(pin), salt, 32).toString("hex") }; }
function verificaPin(p, pin) {
  if (!p || !p.pinHash) return false;
  try { return crypto.timingSafeEqual(crypto.scryptSync(String(pin), p.salt, 32), Buffer.from(p.pinHash, "hex")); } catch (e) { return false; }
}
const pinValido = pin => /^\d{4}$/.test(String(pin));

/* ---------- Calcoli ---------- */
const T = (S, id) => S.tavoli.find(x => x.id === id);
const M = (S, id) => S.menu.find(x => x.id === id);
const ING = (S, id) => S.ing.find(x => x.id === id);
const repOf = (S, it) => (S.categorie.find(c => c.nome === it.cat) || { rep: "Cucina" }).rep;
const isBusy = t => t.righe.length > 0 || t.coperti > 0;
const prezzoRiga = (S, r) => { const it = M(S, r.mid); return it ? round2(it.prezzo + (+r.extra || 0)) : 0; };
const sub = (S, t) => t.righe.reduce((s, r) => s + prezzoRiga(S, r) * r.q, 0);
const copertoTot = (S, t) => t.posti > 0 ? t.coperti * S.settings.coperto : 0;
const scontoVal = (S, t) => { if (!t.sconto) return 0; const l = sub(S, t) + copertoTot(S, t); return Math.min(l, t.sconto.tipo === "%" ? l * t.sconto.val / 100 : t.sconto.val); };
const tTot = (S, t) => round2(sub(S, t) + copertoTot(S, t) - scontoVal(S, t));
const avail = (S, it) => it.disp && (!S.settings.moduli.magazzino || it.ing.every(([id, q]) => { const g = ING(S, id); return !g || g.qta >= q; }));
const tavLabel = t => /^\d+$/.test(t.nome) ? "Tavolo " + t.nome : t.nome;
const tavLabelNome = n => /^\d+$/.test(n) ? "Tavolo " + n : n;
const resetTav = t => Object.assign(t, { coperti: 0, righe: [], aperto: null, conto: false, sconto: null, cam: null, chiamata: 1, avviso: "", cliente: null, premio: null });
const nuovoTavolo = (id, nome, sala, posti) => resetTav({ id, nome, sala, posti });
function log(S, u, t) { S.log.unshift({ ora: Date.now(), chi: u ? u.nome : "Sistema", txt: t }); if (S.log.length > 1000) S.log.length = 1000; }

/* ---------- Menu di partenza ---------- */
function presetMenu(tipo) {
  const C = (nome, rep) => ({ nome, rep });
  const P = (cat, nome, prezzo, all, ing) => ({ id: uid(), cat, nome, prezzo, disp: true, all: all || [], ing: ing || [] });
  if (tipo === "bar") return { cat: [C("Caffetteria", "Bar"), C("Colazione", "Bar"), C("Panini", "Cucina"), C("Aperitivi", "Bar"), C("Bibite", "Bar")], menu: [
    P("Caffetteria", "Caffè", 1.2, [], [["caffe", .008]]), P("Caffetteria", "Cappuccino", 1.6, [7], [["caffe", .008], ["latte", .15]]), P("Caffetteria", "Caffè freddo alla mandorla", 2.5, [8], [["caffe", .008]]),
    P("Colazione", "Cornetto", 1.3, [1, 3, 7]), P("Colazione", "Granita e brioche", 5, [1, 3, 7, 8]), P("Colazione", "Spremuta d'arancia", 3.5),
    P("Panini", "Panino con la mortadella", 4.5, [1, 7], [["mortadella", .06]]), P("Panini", "Toast prosciutto e formaggio", 4, [1, 7]),
    P("Aperitivi", "Spritz", 6, [12]), P("Aperitivi", "Birra media", 5, [1], [["birra", .02]]), P("Aperitivi", "Calice Nero d'Avola", 6, [12], [["vino", .2]]), P("Aperitivi", "Tagliere misto", 12, [1, 7]),
    P("Bibite", "Acqua 75cl", 2.5, [], [["acqua", 1]]), P("Bibite", "Bibita in lattina", 2.5)] };
  if (tipo === "pizzeria") return { cat: [C("Fritti", "Cucina"), C("Pizze rosse", "Pizzeria"), C("Pizze bianche", "Pizzeria"), C("Dolci", "Cucina"), C("Bevande", "Bar")], menu: [
    P("Fritti", "Arancina al ragù", 3.5, [1, 3, 7, 9], [["carne", .04], ["pom", .03]]), P("Fritti", "Panelle e crocchè", 6, [1, 3, 7]), P("Fritti", "Patatine", 4),
    P("Pizze rosse", "Margherita", 7, [1, 7], [["farina", .25], ["mozz", .12], ["pom", .08]]), P("Pizze rosse", "Norma", 9.5, [1, 7], [["farina", .25], ["mozz", .1], ["melanz", .1], ["ricotta", .02], ["pom", .06]]), P("Pizze rosse", "Capricciosa", 10, [1, 7], [["farina", .25], ["mozz", .12], ["pom", .08]]),
    P("Pizze bianche", "Pistacchio e mortadella", 12, [1, 7, 8], [["farina", .25], ["mozz", .12], ["pistacchio", .04], ["mortadella", .06]]), P("Pizze bianche", "Quattro formaggi", 10, [1, 7], [["farina", .25], ["mozz", .15]]),
    P("Dolci", "Cannolo", 4.5, [1, 3, 7, 8], [["ricotta", .06]]), P("Dolci", "Tiramisù", 5, [1, 3, 7]),
    P("Bevande", "Birra media", 5, [1], [["birra", .02]]), P("Bevande", "Acqua 75cl", 2.5, [], [["acqua", 1]]), P("Bevande", "Bibita in lattina", 2.5)] };
  return { cat: [C("Antipasti", "Cucina"), C("Primi", "Cucina"), C("Secondi", "Cucina"), C("Pizze", "Pizzeria"), C("Dolci", "Cucina"), C("Bar", "Bar")], menu: [
    P("Antipasti", "Arancina al ragù", 3.5, [1, 3, 7, 9], [["carne", .04], ["pom", .03]]), P("Antipasti", "Caponata", 7, [9], [["melanz", .2], ["pom", .05]]), P("Antipasti", "Panelle e crocchè", 6, [1, 3, 7]),
    P("Primi", "Pasta alla Norma", 12, [1, 7], [["pasta", .12], ["melanz", .15], ["ricotta", .03], ["pom", .1]]), P("Primi", "Busiate al pesto trapanese", 13, [1, 7, 8], [["pasta", .12], ["pom", .1]]), P("Primi", "Pasta con le sarde", 14, [1, 4, 8], [["pasta", .12], ["sarde", .1]]),
    P("Secondi", "Involtini di pesce spada", 18, [1, 4, 7], [["pesce", .18]]), P("Secondi", "Polpette al sugo", 13, [1, 3, 7], [["carne", .15], ["pom", .1]]),
    P("Pizze", "Margherita", 7, [1, 7], [["farina", .25], ["mozz", .12], ["pom", .08]]), P("Pizze", "Norma", 9.5, [1, 7], [["farina", .25], ["mozz", .1], ["melanz", .1], ["ricotta", .02], ["pom", .06]]), P("Pizze", "Pistacchio e mortadella", 12, [1, 7, 8], [["farina", .25], ["mozz", .12], ["pistacchio", .04], ["mortadella", .06]]),
    P("Dolci", "Cannolo", 4.5, [1, 3, 7, 8], [["ricotta", .06]]), P("Dolci", "Cassata", 6, [1, 3, 7, 8], [["ricotta", .05]]), P("Dolci", "Granita e brioche", 5, [1, 3, 7, 8]),
    P("Bar", "Caffè", 1.2, [], [["caffe", .008]]), P("Bar", "Birra media", 5, [1], [["birra", .02]]), P("Bar", "Calice Nero d'Avola", 6, [12], [["vino", .2]]), P("Bar", "Bottiglia Nero d'Avola", 22, [12], [["vino", 1]]), P("Bar", "Acqua 75cl", 2.5, [], [["acqua", 1]])] };
}

function impostazioniBase(o) {
  return { nome: txt(o.nome, 60) || "Il mio locale", tipo: txt(o.tipo, 60) || "Ristorante", citta: txt(o.citta, 40) || "Catania", accent: "#2F6B4F", tema: "auto", coperto: 2, iva: 10,
    moduli: { prenotazioni: true, magazzino: true, cucina: true, consegne: false }, sale: ["Sala interna", "Banco e asporto"],
    stampanti: { Cucina: "", Pizzeria: "", Bar: "", Sala: "" }, stampaAuto: true, colonne: 42 };
}
function base(x) {
  const now = Date.now();
  return Object.assign({ versioneDati: 1, primoAvvio: now, demo: false, licenza: null, contatori: { comanda: 0 }, ing: [], fornitori: [], comande: [], vendite: [], movimenti: [], prenotazioni: [], log: [], storico: [], clienti: [], turni: [], presenze: [], attesa: [], richiesteQr: [] }, x);
}

/* ---------- Creazione del locale ---------- */
function creaStato(o) {
  if (!pinValido(o.pin)) no("Il PIN del titolare deve avere 4 cifre");
  if (o.demo) return seedDemo(o);
  const modello = ["bar", "pizzeria", "trattoria"].includes(o.modello) ? o.modello : "trattoria";
  const pm = presetMenu(modello); pm.menu.forEach(m => m.ing = []);
  const tav = [];
  const n = Math.max(1, Math.min(60, parseInt(o.tavoli, 10) || 10));
  for (let i = 1; i <= n; i++) tav.push(nuovoTavolo("T" + i, String(i), "Sala interna", 4));
  tav.push(nuovoTavolo("BANCO", "Banco", "Banco e asporto", 0), nuovoTavolo("ASP", "Asporto", "Banco e asporto", 0));
  const S = base({ settings: impostazioniBase(o), staff: [{ id: uid(), nome: txt(o.nomeTitolare, 30) || "Titolare", ruolo: "titolare", ...hashPin(o.pin) }], categorie: pm.cat, menu: pm.menu, tavoli: tav });
  if (modello === "bar") { S.settings.moduli.cucina = false; S.settings.moduli.magazzino = false; }
  log(S, S.staff[0], "Locale configurato");
  return S;
}

function seedDemo(o) {
  const now = Date.now(), m = 60000, today = dkey(now), tom = dkey(now + 864e5), after = dkey(now + 2 * 864e5);
  const fornitori = [{ id: "f1", nome: "Molino e Pasta Sud", tel: "095 555 0101" }, { id: "f2", nome: "Caseificio Etna", tel: "095 555 0102" }, { id: "f3", nome: "Mercato del pesce", tel: "095 555 0103" }, { id: "f4", nome: "Ortofrutta Catania", tel: "095 555 0104" }, { id: "f5", nome: "Beverage Sicilia", tel: "095 555 0105" }];
  const ing = [["farina", "Farina 00", "kg", 18, 5, .9, "f1"], ["pasta", "Pasta secca", "kg", 11, 4, 1.8, "f1"], ["mozz", "Mozzarella fiordilatte", "kg", 3.2, 4, 8.5, "f2"], ["ricotta", "Ricotta", "kg", 1.4, 1, 9, "f2"], ["latte", "Latte fresco", "l", 6, 4, 1.2, "f2"],
    ["pom", "Pomodoro pelato", "kg", 9, 3, 2.2, "f4"], ["melanz", "Melanzane", "kg", 2.1, 3, 2, "f4"], ["pesce", "Pesce spada", "kg", 2.6, 2, 22, "f3"], ["sarde", "Sarde", "kg", 1.8, 1, 9, "f3"], ["carne", "Macinato misto", "kg", 3.5, 2, 11, "f4"], ["mortadella", "Mortadella", "kg", 1.2, .5, 14, "f2"],
    ["pistacchio", "Crema di pistacchio", "kg", .6, 1, 28, "f2"], ["caffe", "Caffè in grani", "kg", 4.5, 2, 18, "f5"], ["birra", "Birra fusto 20 L", "pz", 2, 1, 60, "f5"], ["vino", "Nero d'Avola", "bt", 14, 6, 6, "f5"], ["acqua", "Acqua 75 cl", "bt", 40, 24, .35, "f5"]]
    .map(([id, nome, um, qta, soglia, costo, forn]) => ({ id, nome, um, qta, soglia, costo, forn }));
  const pm = presetMenu("trattoria");
  const tav = [];
  [[1, 2], [2, 2], [3, 4], [4, 6], [5, 4], [6, 6], [7, 4], [8, 2], [9, 4], [10, 8]].forEach(([n, p]) => tav.push(nuovoTavolo("T" + n, String(n), "Sala interna", p)));
  [1, 2, 3, 4].forEach(n => tav.push(nuovoTavolo("D" + n, "D" + n, "Dehors", 4)));
  tav.push(nuovoTavolo("BANCO", "Banco", "Banco e asporto", 0), nuovoTavolo("ASP", "Asporto", "Banco e asporto", 0));
  const pinTit = pinValido(o.pin) ? o.pin : "1111";
  const staff = [{ id: "s1", nome: txt(o.nomeTitolare, 30) || "Melo", ruolo: "titolare", ...hashPin(pinTit) }, { id: "s2", nome: "Giusy", ruolo: "cassa", ...hashPin("2222") }, { id: "s3", nome: "Davide", ruolo: "cameriere", ...hashPin("3333") }, { id: "s4", nome: "Rosario", ruolo: "cucina", ...hashPin("4444") }];
  const settings = impostazioniBase({ nome: o.nome || "Trattoria Da Melo", tipo: o.tipo || "Ristorante e pizzeria", citta: o.citta || "Catania" });
  settings.sale = ["Sala interna", "Dehors", "Banco e asporto"];
  const S = base({ demo: true, settings, staff, fornitori, ing, categorie: pm.cat, menu: pm.menu, tavoli: tav });
  const by = n => S.menu.find(x => x.nome === n);
  const open = (tid, cop, items, mins, cam, opt) => {
    opt = opt || {}; const t = T(S, tid);
    Object.assign(t, { coperti: cop, aperto: now - mins * m, cam, conto: !!opt.conto, chiamata: 1 });
    t.righe = items.map(([n, q, us, nota]) => ({ id: uid(), mid: by(n).id, q, inv: true, uscita: us || 1, nota: nota || "" }));
    const reps = {};
    t.righe.forEach(r => { const it = M(S, r.mid); (reps[repOf(S, it)] = reps[repOf(S, it)] || []).push(r); });
    Object.entries(reps).forEach(([rep, rr]) => S.comande.push({ id: uid(), num: ++S.contatori.comanda, tav: tid, tavNome: t.nome, ora: now - (mins - 2) * m, stato: (opt.pronto || []).includes(rep) ? "pronto" : "prep", reparto: rep, cam,
      righe: rr.map(r => ({ rid: r.id, nome: M(S, r.mid).nome, q: r.q, nota: r.nota, uscita: r.uscita })) }));
  };
  open("T3", 4, [["Caponata", 1, 1], ["Pasta alla Norma", 2, 1], ["Involtini di pesce spada", 2, 2, "uno senza pangrattato"], ["Acqua 75cl", 2, 1]], 31, "Davide", { pronto: ["Bar"] });
  open("T6", 5, [["Panelle e crocchè", 1], ["Involtini di pesce spada", 3], ["Busiate al pesto trapanese", 2], ["Bottiglia Nero d'Avola", 1]], 58, "Davide", { conto: true, pronto: ["Cucina", "Bar"] });
  open("T7", 2, [["Pistacchio e mortadella", 1], ["Norma", 1, 1, "ben cotta"], ["Birra media", 2]], 14, "Davide", { pronto: ["Bar"] });
  open("D1", 3, [["Margherita", 2], ["Arancina al ragù", 3], ["Birra media", 3]], 24, "Davide", { pronto: ["Bar"] });
  open("T10", 7, [["Arancina al ragù", 7], ["Panelle e crocchè", 2], ["Calice Nero d'Avola", 4]], 5, "Davide");
  const sale = (tav, righe, metodo, mins, cop, cam, sconto) => {
    const r = righe.map(([n, q]) => ({ nome: n, q, prezzo: by(n).prezzo, cat: by(n).cat }));
    const lordo = r.reduce((s, x) => s + x.q * x.prezzo, 0) + cop * S.settings.coperto;
    S.vendite.push({ id: uid(), tav, righe: r, coperti: cop, lordo, sconto: sconto || 0, tot: round2(lordo - (sconto || 0)), metodo, ora: now - mins * m, cam });
  };
  sale("Banco", [["Caffè", 6], ["Granita e brioche", 3]], "contanti", 330, 0, "Giusy");
  sale("1", [["Caffè", 2], ["Cannolo", 2]], "carta", 300, 0, "Davide");
  sale("4", [["Pasta con le sarde", 2], ["Polpette al sugo", 1], ["Acqua 75cl", 1]], "carta", 250, 3, "Davide");
  sale("2", [["Margherita", 2], ["Birra media", 2]], "contanti", 170, 2, "Davide");
  sale("9", [["Busiate al pesto trapanese", 3], ["Involtini di pesce spada", 2], ["Bottiglia Nero d'Avola", 2], ["Cassata", 3]], "carta", 110, 4, "Davide", 10);
  sale("Asporto", [["Margherita", 3], ["Norma", 2]], "satispay", 95, 0, "Giusy");
  sale("5", [["Norma", 3], ["Calice Nero d'Avola", 3]], "carta", 70, 3, "Davide");
  sale("D3", [["Caponata", 2], ["Pasta alla Norma", 2], ["Cannolo", 2]], "buoni", 50, 2, "Davide");
  S.movimenti = [{ id: uid(), tipo: "fondo", importo: 150, nota: "Fondo cassa di apertura", ora: now - 360 * m, chi: "Giusy" }, { id: uid(), tipo: "prelievo", importo: 40, nota: "Pagamento pane", ora: now - 200 * m, chi: staff[0].nome }];
  S.storico = [[1, 1642, 52, 118], [2, 1388, 47, 101], [3, 2318, 71, 164], [4, 1986, 64, 150], [5, 1402, 49, 109], [6, 1125, 38, 82]]
    .map(([d, tot, n, cop]) => ({ data: giorno(now - d * 864e5), tot, n, coperti: cop, carta: round2(tot * .68), contanti: round2(tot * .27), altro: round2(tot * .05) }));
  S.prenotazioni = [
    { id: uid(), data: today, ora: "20:30", nome: "Rossi", tel: "333 555 0101", persone: 4, tavolo: "T5", note: "compleanno, torta portata da loro", stato: "attesa" },
    { id: uid(), data: today, ora: "21:00", nome: "Bianchi", tel: "333 555 0102", persone: 2, tavolo: "T8", note: "", stato: "attesa" },
    { id: uid(), data: today, ora: "21:15", nome: "Famiglia Russo", tel: "333 555 0103", persone: 6, tavolo: "T4", note: "un seggiolone", stato: "attesa" },
    { id: uid(), data: tom, ora: "13:00", nome: "Ufficio Leotta", tel: "333 555 0104", persone: 8, tavolo: "T10", note: "pranzo di lavoro, fattura", stato: "attesa" },
    { id: uid(), data: tom, ora: "20:45", nome: "Caruso", tel: "333 555 0105", persone: 2, tavolo: "", note: "preferisce dehors", stato: "attesa" },
    { id: uid(), data: after, ora: "21:00", nome: "Greco", tel: "333 555 0106", persone: 5, tavolo: "", note: "celiaco al tavolo", stato: "attesa" }];
  // descrizioni di esempio per il menu stampato e il QR (1.9)
  [["Arancina al ragù", "Riso, ragù di carne, piselli e caciocavallo", "Rice ball with meat ragù, peas and caciocavallo cheese"], ["Caponata", "Melanzane, sedano, olive e capperi in agrodolce", "Sweet and sour aubergine, celery, olives and capers"],
   ["Pasta alla Norma", "Melanzane fritte, pomodoro, basilico e ricotta salata", "Fried aubergine, tomato, basil and salted ricotta"], ["Pasta con le sarde", "Sarde, finocchietto selvatico, uvetta, pinoli e mollica tostata", "Sardines, wild fennel, raisins, pine nuts and toasted breadcrumbs"],
   ["Involtini di pesce spada", "Pesce spada, pangrattato, pecorino e agrumi", "Swordfish rolls with breadcrumbs, pecorino and citrus"], ["Cannolo", "Cialda croccante e ricotta di pecora, riempito al momento", "Crispy shell filled with sheep ricotta on the spot"]]
    .forEach(([n, it, en]) => { const m = by(n); if (m) { m.desc = it; m.descTr = { en }; } });
  if (by("Involtini di pesce spada")) by("Involtini di pesce spada").surg = true;
  log(S, staff[0], "Dati di esempio caricati");
  return S;
}

/* ---------- Testi per le stampanti ---------- */
function righeStampa(cols) {
  const linea = (c = "-") => c.repeat(cols);
  const lr = (l, r) => { l = String(l); r = String(r); const sp = cols - l.length - r.length; return sp >= 1 ? l + " ".repeat(sp) + r : l.slice(0, cols - r.length - 1) + " " + r; };
  const centro = s => { s = String(s).slice(0, cols); return " ".repeat(Math.max(0, Math.floor((cols - s.length) / 2))) + s; };
  return { linea, lr, centro };
}
function testoComanda(S, c, titolo) {
  const cols = S.settings.colonne || 42, { linea, lr } = righeStampa(cols);
  const t = T(S, c.tav);
  const out = [{ grande: true, t: (titolo || c.reparto).toUpperCase() }, { grande: true, t: (t ? tavLabel(t) : c.tavNome) }, lr((c.cam || "") + "  N. " + c.num, new Date(c.ora).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " + hhmm(c.ora))];
  if (t && t.consegna) { if (t.consegna.ritiro) out.push({ grande: true, t: "RITIRO " + t.consegna.ritiro }); if (t.consegna.cliente) out.push("Cliente: " + t.consegna.cliente); if (t.consegna.nota) out.push("Nota: " + t.consegna.nota); }
  if (c.avviso) { out.push(linea()); out.push({ grande: true, t: "!! " + c.avviso }); }
  out.push(linea());
  const byU = {}; c.righe.forEach(r => (byU[r.uscita || 1] = byU[r.uscita || 1] || []).push(r));
  const multi = Object.keys(byU).length > 1;
  Object.entries(byU).forEach(([u, rr]) => {
    if (multi || +u > 1) out.push((+u) + "a USCITA" + (t && +u > t.chiamata ? " (attendere)" : ""));
    rr.forEach(r => { out.push({ grande: true, t: r.q + "x " + r.nome }); if (r.nota) out.push("   > " + r.nota); });
  });
  out.push(linea());
  return out;
}
function testoAvviso(S, righe) { const cols = S.settings.colonne || 42; return [{ grande: true, t: righe[0] }, ...righe.slice(1), "-".repeat(cols)]; }
function testoPreconto(S, t) {
  const cols = S.settings.colonne || 42, { linea, lr, centro } = righeStampa(cols), s = S.settings, sv = scontoVal(S, t);
  const out = [{ grande: true, t: s.nome }, centro(s.citta), linea(), centro("PRECONTO - NON FISCALE"), centro(tavLabel(t) + " - " + hhmm(Date.now())), linea()];
  t.righe.forEach(r => { const it = M(S, r.mid); if (it) { out.push(lr(r.q + " " + it.nome, eur(prezzoRiga(S, r) * r.q))); if (r.extra) out.push("   " + (r.nota || "variante")); } });
  if (t.posti > 0 && t.coperti) out.push(lr(t.coperti + " Coperto", eur(copertoTot(S, t))));
  if (sv) out.push(lr("Sconto", "-" + eur(sv)));
  out.push(linea(), { grande: true, t: "TOTALE " + eur(tTot(S, t)) });
  if (t.coperti > 1) out.push(lr("A persona (" + t.coperti + ")", eur(tTot(S, t) / t.coperti)));
  out.push(linea(), centro("Grazie e a presto!"));
  if (s.recensione) out.push("", centro("Ti e' piaciuto? Lasciaci una"), centro("recensione su Google:"), centro(String(s.recensione).replace(/^https?:\/\//, "").slice(0, cols)));
  return out;
}

/* ---------- Fatture elettroniche (1.9) ----------
   Tavolo prepara il file XML nel formato FatturaPA (FPR12, privati e aziende) e la copia di cortesia.
   Il file si carica sul portale "Fatture e Corrispettivi" dell'Agenzia delle Entrate o si manda al commercialista:
   Tavolo non trasmette da solo al Sistema di Interscambio. */
const REGIMI = { RF01: "Ordinario", RF19: "Forfettario (L. 190/2014)", RF02: "Contribuenti minimi (art. 27 D.L. 98/2011)" };
const ALIQUOTE = [4, 5, 10, 22];
const FORFETTARI = ["RF19", "RF02"];
const CAUSALE_REGIME = {
  RF19: "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, della Legge n. 190/2014 - Regime forfettario. Operazione senza applicazione dell'IVA.",
  RF02: "Operazione effettuata ai sensi dell'art. 27, commi 1 e 2, del D.L. n. 98/2011 - Regime dei contribuenti minimi. Operazione senza applicazione dell'IVA."
};
const RIF_NORMA = { RF19: "Regime forfettario art.1 c.54-89 L.190/2014", RF02: "Contribuenti minimi art.27 c.1-2 DL 98/2011" };
const PAG_FATT = { contanti: "MP01", carta: "MP08", satispay: "MP08", bonifico: "MP05" };
const SOGLIA_BOLLO = 77.47;
function pivaOk(v) {
  const s = String(v || ""); if (!/^\d{11}$/.test(s) || /^0{11}$/.test(s)) return false;
  let t = 0; for (let i = 0; i < 10; i++) { let d = +s[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; }
  return (10 - t % 10) % 10 === +s[10];
}
function cfOk(v) {
  const s = String(v || "").toUpperCase();
  if (/^\d{11}$/.test(s)) return pivaOk(s); // codice fiscale numerico di società e enti
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  const DISP = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  let t = 0;
  for (let i = 0; i < 15; i++) {
    const c = s[i], n = c >= "0" && c <= "9" ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65;
    t += i % 2 ? n : DISP[n];
  }
  return String.fromCharCode(65 + t % 26) === s[15];
}
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ""));
// I campi della FatturaPA accettano solo caratteri latini: niente € e virgolette curve
const latino = (v, max) => String(v == null ? "" : v).replace(/€/g, "EUR").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
  .normalize("NFC").replace(/[^\x20-\x7E -ÿ]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const xe = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const fisc = S => S.settings.fisc || null;
const forfettario = S => !!(fisc(S) && FORFETTARI.includes(fisc(S).regime));
function fiscCompleti(f) {
  return !!(f && f.den && pivaOk(f.piva) && f.ind && /^\d{5}$/.test(f.cap) && f.com && /^[A-Z]{2}$/.test(f.prov) && REGIMI[f.regime]);
}
// Importi: i prezzi del locale sono IVA compresa. Per ogni aliquota si scorpora il totale
// in modo che imponibile + imposta torni esattamente al totale del conto.
function scorporo(lordo, a) {
  // l'imposta può essere arrotondata per eccesso o per difetto (specifiche FatturaPA, controllo 00421)
  const base = round2(lordo / (1 + a / 100));
  for (const d of [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03]) {
    const i = round2(base + d), grezza = i * a / 100;
    for (const v of [round2(grezza), Math.floor(grezza * 100 + 1e-6) / 100, Math.ceil(grezza * 100 - 1e-6) / 100]) if (Math.abs(round2(i + v) - lordo) < 0.001) return { imp: i, iva: round2(v) };
  }
  return { imp: base, iva: round2(lordo - base) };
}
function calcolaFattura(righe, regime, bollo) {
  const forf = FORFETTARI.includes(regime), linee = [], gruppi = {};
  righe.forEach((r, i) => {
    const a = forf ? 0 : r.aliq, lordo = round2(r.prezzo * r.q);
    const unit = a ? r.prezzo / (1 + a / 100) : r.prezzo;
    const pu = Math.round(unit * 1e6) / 1e6, pt = round2(pu * r.q);
    linee.push({ n: i + 1, desc: r.desc, q: r.q, pu, pt, aliq: a, natura: forf ? "N2.2" : "", lordo });
    const k = forf ? "N2.2" : String(a); (gruppi[k] = gruppi[k] || { aliq: a, natura: forf ? "N2.2" : "", lordo: 0, pt: 0 }); gruppi[k].lordo = round2(gruppi[k].lordo + lordo); gruppi[k].pt = round2(gruppi[k].pt + pt);
  });
  let totale = round2(righe.reduce((s, r) => s + round2(r.prezzo * r.q), 0));
  const bolloSi = forf && totale > SOGLIA_BOLLO;
  if (bolloSi && bollo) { linee.push({ n: linee.length + 1, desc: "Rimborso imposta di bollo", q: 1, pu: 2, pt: 2, aliq: 0, natura: "N1", lordo: 2, bollo: true }); gruppi.N1 = { aliq: 0, natura: "N1", lordo: 2, pt: 2 }; totale = round2(totale + 2); }
  const riepilogo = Object.values(gruppi).map(g => {
    const { imp, iva } = g.aliq ? scorporo(g.lordo, g.aliq) : { imp: g.lordo, iva: 0 };
    return { aliq: g.aliq, natura: g.natura, imp, iva, arr: round2(imp - g.pt) };
  }).sort((a, b) => b.aliq - a.aliq);
  const imponibile = round2(riepilogo.reduce((s, x) => s + x.imp, 0)), imposta = round2(riepilogo.reduce((s, x) => s + x.iva, 0));
  return { linee, riepilogo, imponibile, imposta, totale: round2(imponibile + imposta), bollo: bolloSi };
}
// Righe della fattura a partire da un conto: piatti, coperto e sconto, prezzi IVA compresa
function righeDaVendita(S, v) {
  const a = S.settings.iva, out = (v.righe || []).map(r => ({ desc: r.nome + (r.extra && r.nota ? " (" + r.nota + ")" : ""), q: r.q, prezzo: round2(r.prezzo), aliq: a }));
  const somma = (v.righe || []).reduce((s, r) => s + r.q * r.prezzo, 0), cop = round2((v.lordo || 0) - somma);
  if (cop > 0.004) { const n = v.coperti || 1, u = round2(cop / n), ok = Math.abs(u * n - cop) < 0.005; out.push({ desc: "Coperto", q: ok ? n : 1, prezzo: ok ? u : cop, aliq: a }); }
  // lo sconto si ricava dal totale incassato, così la fattura torna al centesimo con il conto
  const sc = round2((v.lordo || 0) - (v.tot || 0)); if (sc > 0.004) out.push({ desc: "Sconto", q: 1, prezzo: -sc, aliq: a });
  return out;
}
function leggiCliente(c) {
  c = c || {};
  const tipo = c.tipo === "privato" ? "privato" : "azienda", naz = /^[A-Z]{2}$/.test(String(c.naz || "IT").toUpperCase()) ? String(c.naz || "IT").toUpperCase() : no("Nazione non valida (due lettere, es. IT)");
  const x = { tipo, naz, den: latino(c.den, 80), nome: latino(c.nome, 60), cognome: latino(c.cognome, 60), piva: String(c.piva || "").replace(/\s/g, "").toUpperCase().replace(/^IT(?=\d{11}$)/, ""), cf: String(c.cf || "").replace(/\s/g, "").toUpperCase(),
    ind: latino(c.ind, 60), civ: latino(c.civ, 8), cap: String(c.cap || "").trim(), com: latino(c.com, 60), prov: String(c.prov || "").trim().toUpperCase(), sdi: String(c.sdi || "").trim().toUpperCase(), pec: String(c.pec || "").trim().slice(0, 256), email: txt(c.email, 80) };
  if (tipo === "azienda" && !x.den) no("Scrivi la ragione sociale del cliente");
  if (tipo === "privato" && (!x.nome || !x.cognome)) no("Scrivi nome e cognome del cliente");
  if (!x.ind || !x.com) no("Servono indirizzo e comune del cliente");
  if (naz === "IT") {
    if (tipo === "azienda") { if (!pivaOk(x.piva)) no("Partita IVA del cliente non valida: controlla le 11 cifre"); if (x.cf && !cfOk(x.cf)) no("Codice fiscale del cliente non valido"); }
    else { if (!cfOk(x.cf)) no("Codice fiscale del cliente non valido: per un privato è obbligatorio"); if (x.piva && !pivaOk(x.piva)) no("Partita IVA del cliente non valida"); }
    if (!/^\d{5}$/.test(x.cap)) no("CAP del cliente non valido (5 cifre)");
    if (!/^[A-Z]{2}$/.test(x.prov)) no("Provincia del cliente: scrivi la sigla, es. CT");
    if (x.sdi && !/^[A-Z0-9]{7}$/.test(x.sdi)) no("Il codice destinatario ha 7 caratteri (lettere e numeri)");
    if (x.pec && !emailOk(x.pec)) no("PEC del cliente non valida");
    if (tipo === "privato") x.sdi = x.sdi || "0000000";
  } else {
    if (tipo !== "azienda" || !/^[A-Z0-9]{2,28}$/.test(x.piva)) no("Per un cliente estero serve un'azienda con il suo numero di partita IVA");
    x.sdi = "XXXXXXX"; x.pec = ""; x.prov = ""; if (!/^\d{5}$/.test(x.cap)) x.cap = "00000";
  }
  return x;
}
const nomeCliente = c => c ? (c.tipo === "privato" ? (c.nome + " " + c.cognome).trim() : c.den) : "";
function nuovaFattura(S, u, o) {
  const f = fisc(S); if (!fiscCompleti(f)) no("Prima completa i dati fiscali del locale in Impostazioni → Fatture elettroniche");
  const oggi = dkey(Date.now()), data = dataOk(o.data) || oggi, anno = data.slice(0, 4); if (data > oggi) no("La data non può essere nel futuro");
  if (data < dkey(new Date(oggi + "T12:00").getTime() - 60 * 864e5)) no("Data troppo vecchia: al massimo 60 giorni fa");
  const ultima = S.fatture.filter(x => x.anno === anno).sort((a, b) => b.num - a.num)[0];
  if (ultima && data < ultima.data) no(`La data non può essere prima dell'ultima fattura (n. ${ultima.numero} del ${ultima.data.split("-").reverse().join("/")})`);
  S.contatori.fatt = S.contatori.fatt || {};
  const num = Math.max(S.contatori.fatt[anno] || 0, ultima ? ultima.num : 0) + 1;
  S.contatori.fatt[anno] = num; S.contatori.invio = (S.contatori.invio || 0) + 1;
  const c = calcolaFattura(o.righe, f.regime, !!f.bolloCliente);
  const x = Object.assign({ id: uid(), tipo: o.tipo || "TD01", anno, num, numero: String(num) + (f.suffisso ? f.suffisso : ""), data, creata: Date.now(), chi: u.nome, stato: "da_inviare",
    prog: S.contatori.invio.toString(36).toUpperCase().padStart(5, "0"), ced: Object.assign({}, f), cli: o.cli, righe: o.righe, metodo: o.metodo || "", docComm: o.docComm || "", nota: o.nota || "", vid: o.vid || "", rif: o.rif || null }, c);
  S.fatture.push(x);
  return x;
}
function xmlFattura(x) {
  const f = x.ced, c = x.cli, n2 = v => round2(v).toFixed(2), forf = FORFETTARI.includes(f.regime);
  const el = (tag, v) => v === "" || v == null ? "" : `<${tag}>${xe(v)}</${tag}>`;
  const sede = s => `<Sede>${el("Indirizzo", s.ind)}${el("NumeroCivico", s.civ)}${el("CAP", s.cap)}${el("Comune", s.com)}${el("Provincia", s.prov)}${el("Nazione", s.naz || "IT")}</Sede>`;
  const cedAna = `<Anagrafica>${el("Denominazione", latino(f.den, 80))}</Anagrafica>`;
  const cliAna = c.tipo === "privato" ? `<Anagrafica>${el("Nome", c.nome)}${el("Cognome", c.cognome)}</Anagrafica>` : `<Anagrafica>${el("Denominazione", c.den)}</Anagrafica>`;
  const cliId = (c.piva ? `<IdFiscaleIVA><IdPaese>${c.naz}</IdPaese><IdCodice>${xe(c.piva)}</IdCodice></IdFiscaleIVA>` : "") + (c.naz === "IT" && c.cf ? el("CodiceFiscale", c.cf) : "");
  const rea = f.reaUff && f.reaNum ? `<IscrizioneREA>${el("Ufficio", f.reaUff)}${el("NumeroREA", f.reaNum)}<StatoLiquidazione>LN</StatoLiquidazione></IscrizioneREA>` : "";
  const contatti = f.tel || f.email ? `<Contatti>${el("Telefono", latino(f.tel, 12))}${el("Email", f.email)}</Contatti>` : "";
  const causali = [];
  if (forf) causali.push(CAUSALE_REGIME[f.regime]);
  if (x.docComm) causali.push(latino("Riferimento documento commerciale: " + x.docComm, 200));
  if (x.nota) causali.push(latino(x.nota, 200));
  if (x.bollo && !x.linee.some(l => l.bollo)) causali.push("Imposta di bollo assolta in modo virtuale.");
  const linee = x.linee.map(l => `<DettaglioLinee><NumeroLinea>${l.n}</NumeroLinea>${el("Descrizione", latino(l.desc, 1000) || "Articolo")}<Quantita>${(+l.q).toFixed(2)}</Quantita><PrezzoUnitario>${(+l.pu).toFixed(Math.max(2, Math.min(6, (String(l.pu).split(".")[1] || "").length)))}</PrezzoUnitario><PrezzoTotale>${n2(l.pt)}</PrezzoTotale><AliquotaIVA>${n2(l.aliq)}</AliquotaIVA>${el("Natura", l.natura)}</DettaglioLinee>`).join("");
  const riep = x.riepilogo.map(r => `<DatiRiepilogo><AliquotaIVA>${n2(r.aliq)}</AliquotaIVA>${el("Natura", r.natura)}${r.arr ? `<Arrotondamento>${n2(r.arr)}</Arrotondamento>` : ""}<ImponibileImporto>${n2(r.imp)}</ImponibileImporto><Imposta>${n2(r.iva)}</Imposta>${r.natura ? "" : "<EsigibilitaIVA>I</EsigibilitaIVA>"}${r.natura ? el("RiferimentoNormativo", r.natura === "N1" ? "Escluso art.15 DPR 633/72" : RIF_NORMA[f.regime]) : ""}</DatiRiepilogo>`).join("");
  const mp = PAG_FATT[x.metodo];
  const pag = mp ? `<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>${mp}</ModalitaPagamento><ImportoPagamento>${n2(x.totale)}</ImportoPagamento>${mp === "MP05" && f.iban ? el("IBAN", f.iban) : ""}</DettaglioPagamento></DatiPagamento>` : "";
  const collegate = x.rif ? `<DatiFattureCollegate>${el("IdDocumento", x.rif.numero)}${el("Data", x.rif.data)}</DatiFattureCollegate>` : "";
  const dest = c.naz === "IT" ? (c.sdi || "0000000") : "XXXXXXX";
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
<FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${xe(f.cf || f.piva)}</IdCodice></IdTrasmittente><ProgressivoInvio>${x.prog}</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>${dest}</CodiceDestinatario>${dest === "0000000" && c.pec ? el("PECDestinatario", c.pec) : ""}</DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${f.piva}</IdCodice></IdFiscaleIVA>${el("CodiceFiscale", f.cf)}${cedAna}<RegimeFiscale>${f.regime}</RegimeFiscale></DatiAnagrafici>${sede(f)}${rea}${contatti}</CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici>${cliId}${cliAna}</DatiAnagrafici>${sede(c)}</CessionarioCommittente></FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>${x.tipo}</TipoDocumento><Divisa>EUR</Divisa><Data>${x.data}</Data>${el("Numero", x.numero)}${x.bollo ? "<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>" : ""}<ImportoTotaleDocumento>${n2(x.totale)}</ImportoTotaleDocumento>${causali.map(t => el("Causale", latino(t, 200))).join("")}</DatiGeneraliDocumento>${collegate}</DatiGenerali>
<DatiBeniServizi>${linee}${riep}</DatiBeniServizi>${pag}</FatturaElettronicaBody>
</p:FatturaElettronica>
`;
}
const nomeFileFattura = x => `IT${x.ced.piva}_${x.prog}.xml`;

/* ---------- HACCP (1.9) ----------
   Registri dell'autocontrollo (Reg. CE 852/2004): temperature, merci in arrivo, pulizie, abbattimento,
   olio di frittura, infestanti, non conformità. Le registrazioni non si cancellano: il titolare può solo annullarle,
   e l'annullamento resta scritto con nome e motivo. */
const TIPI_ATTR = {
  frigo: { nome: "Frigorifero", min: 0, max: 4 }, pesce: { nome: "Frigo del pesce", min: -1, max: 2 }, congelatore: { nome: "Congelatore", min: -30, max: -18 },
  vetrina: { nome: "Vetrina o banco frigo", min: 0, max: 4 }, bibite: { nome: "Frigo bibite", min: 0, max: 10 }, cella: { nome: "Cella frigorifera", min: 0, max: 4 }, caldo: { nome: "Banco caldo", min: 65, max: 95 }
};
const FREQ = { giorno: "Ogni giorno", settimana: "Ogni settimana", mese: "Ogni mese" };
const AZIONI_CORR = ["Regolato il termostato e ricontrollato", "Spostati gli alimenti in un altro frigo", "Alimenti eliminati", "Chiamato il tecnico", "Porta rimasta aperta: chiusa e ricontrollato"];
function haccpBase(S) {
  const pul = [["Piani di lavoro, taglieri e utensili", "giorno"], ["Pavimenti di cucina e bancone", "giorno"], ["Lavelli, lavastoviglie e scarichi", "giorno"], ["Bagni", "giorno"],
    ["Interno dei frigoriferi", "settimana"], ["Forni, piastre e friggitrici", "settimana"], ["Cappa e filtri", "mese"], ["Pareti, porte e maniglie", "mese"]].map(([area, freq]) => ({ id: uid(), area, freq, prodotto: "" }));
  const attr = [{ id: uid(), nome: "Frigorifero cucina", tipo: "frigo", min: 0, max: 4, attiva: true }, { id: uid(), nome: "Congelatore", tipo: "congelatore", min: -30, max: -18, attiva: true }];
  if (S.settings.moduli && S.settings.moduli.cucina === false) attr[0].nome = "Frigorifero";
  return { conf: { resp: "", controlli: 2, orari: ["10:00", "18:00"], acqua: "rete", infestDitta: "", infestFreq: "mese", crudi: false, rev: 1, revData: "", note: "" }, attr, pul, form: [] };
}
const fasciaDi = (S, t) => S.haccp.conf.controlli === 1 ? "giorno" : new Date(t).getHours() < 15 ? "apertura" : "chiusura";
const tempNum = v => { const n = Number(String(v == null ? "" : v).replace(",", ".").trim()); return String(v).trim() !== "" && isFinite(n) && n >= -50 && n <= 120 ? Math.round(n * 10) / 10 : null; };
function registra(S, u, k, dati) {
  const r = Object.assign({ id: uid(), t: Date.now(), g: dkey(Date.now()), k, c: u.nome }, dati);
  S.haccpReg.push(r); return r;
}
// controlli di temperatura che mancano oggi (per il promemoria e il riepilogo serale)
function haccpMancanti(S, ora) {
  if (!S.settings.moduli.haccp || !S.haccp) return [];
  ora = ora || Date.now(); const oggi = dkey(ora), c = S.haccp.conf, hm = hhmm(ora);
  const fasce = c.controlli === 1 ? [["giorno", c.orari[0] || "10:00"]] : [["apertura", c.orari[0] || "10:00"], ["chiusura", c.orari[1] || "18:00"]];
  const fatti = new Set(S.haccpReg.filter(r => r.k === "temp" && r.g === oggi && !r.x).map(r => r.a + "|" + r.f));
  const out = [];
  S.haccp.attr.filter(a => a.attiva !== false).forEach(a => fasce.forEach(([f, h]) => { if (hm >= h && !fatti.has(a.id + "|" + f)) out.push({ a: a.id, nome: a.nome, f }); }));
  return out;
}
function formazioneInScadenza(S, ora) {
  const lim = dkey((ora || Date.now()) + 30 * 864e5);
  return (S.haccp ? S.haccp.form : []).filter(f => f.scadenza && f.scadenza <= lim);
}

/* ---------- Dati nuovi (1.8) su locali creati con versioni precedenti ---------- */
const ELENCHI_18 = ["clienti", "turni", "presenze", "attesa", "richiesteQr", "fatture", "intestatari", "haccpReg"];
function normalizza(S) {
  if (!S) return S;
  ELENCHI_18.forEach(k => { if (!Array.isArray(S[k])) S[k] = []; });
  if (!S.haccp) S.haccp = haccpBase(S);
  { const lim = Date.now() - 3 * 365 * 864e5; if (S.haccpReg.length && S.haccpReg[0].t < lim) S.haccpReg = S.haccpReg.filter(r => r.t >= lim); if (S.haccpReg.length > 40000) S.haccpReg = S.haccpReg.slice(-40000); }
  S.tavoli.forEach(t => { if (!t.consegna && !t.qrk) t.qrk = crypto.randomBytes(5).toString("hex"); });
  const ora = Date.now();
  // richieste dal QR: quelle in attesa scadono dopo 3 ore, lo storico resta 24 ore
  S.richiesteQr = S.richiesteQr.filter(r => ora - r.ora < 24 * 3600e3).slice(-300);
  S.richiesteQr.forEach(r => { if (r.stato === "attesa" && ora - r.ora > 3 * 3600e3) r.stato = "scaduto"; });
  S.attesa = S.attesa.filter(a => a.stato === "attesa" || a.stato === "avvisato" ? ora - a.ora < 12 * 3600e3 : ora - a.ora < 3600e3);
  if (S.presenze.length > 5000) S.presenze = S.presenze.slice(-5000);
  const limTurni = dkey(ora - 120 * 864e5); S.turni = S.turni.filter(x => x.data >= limTurni);
  return S;
}
const telNorm = v => { let d = String(v || "").replace(/\D/g, ""); if (d.startsWith("0039")) d = d.slice(4); else if (d.startsWith("39") && d.length > 10) d = d.slice(2); return d; };
const CLI = (S, id) => S.clienti.find(c => c.id === id);
const puntiConf = S => Object.assign({ euro: 1, soglia: 100, premio: 10 }, S.settings.punti);
const oraOk = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || "")) ? String(v) : null;
const dataOk = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
function accreditaCliente(S, t, tot, righe) {
  const c = t.cliente && CLI(S, t.cliente); if (!c) return;
  const pc = puntiConf(S);
  c.spesa = round2((c.spesa || 0) + tot); c.punti = Math.max(0, (c.punti || 0) + Math.floor(tot * pc.euro)); c.ultima = Date.now();
  c.piatti = c.piatti || {}; (righe || []).forEach(r => { c.piatti[r.nome] = (c.piatti[r.nome] || 0) + r.q; });
  const top = Object.entries(c.piatti).sort((a, b) => b[1] - a[1]).slice(0, 15); c.piatti = Object.fromEntries(top);
  if (t.premio && t.premio.cid === c.id && t.sconto && t.sconto.tipo === "€" && t.sconto.val === t.premio.val) { c.punti = Math.max(0, c.punti - t.premio.punti); t.premio = null; }
}
/* Riepilogo della giornata da mandare su WhatsApp */
function testoRiepilogo(S, V, data) {
  const tot = V.reduce((s, v) => s + v.tot, 0), cop = V.reduce((s, v) => s + (v.coperti || 0), 0), by = k => V.filter(v => v.metodo === k).reduce((s, v) => s + v.tot, 0);
  const gg = new Date(data + "T12:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  const r = [`*${S.settings.nome}* · ${gg}`, "", `Incasso: *${eur(tot)}*`, `${V.length} conti · ${cop} coperti`];
  if (V.length) r.push(`Scontrino medio ${eur(tot / V.length)}${cop ? " · a coperto " + eur(tot / cop) : ""}`);
  r.push(`Carta ${eur(by("carta"))} · Contanti ${eur(by("contanti"))}${tot - by("carta") - by("contanti") > 0.004 ? " · Altro " + eur(tot - by("carta") - by("contanti")) : ""}`);
  const sc = V.reduce((s, v) => s + (v.sconto || 0), 0); if (sc > 0) r.push(`Sconti concessi: ${eur(sc)}`);
  const prima = dkey(new Date(data + "T12:00").getTime() - 7 * 864e5), g7 = (S.storico || []).find(x => x.data === prima);
  if (g7 && g7.tot > 0) { const d = Math.round((tot - g7.tot) / g7.tot * 100); r.push(`Rispetto a ${new Date(prima + "T12:00").toLocaleDateString("it-IT", { weekday: "long" })} scorso: ${d >= 0 ? "+" : ""}${d}% (${eur(g7.tot)})`); }
  const piatti = {}; V.forEach(v => (v.righe || []).forEach(x => { piatti[x.nome] = (piatti[x.nome] || 0) + x.q; }));
  const top = Object.entries(piatti).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) r.push("", "Più venduti:", ...top.map(([n, q], i) => `${i + 1}. ${n} (${q})`));
  const ore = {}; V.forEach(v => { const h = new Date(v.ora).getHours(); ore[h] = (ore[h] || 0) + v.tot; });
  const hp = Object.entries(ore).sort((a, b) => b[1] - a[1])[0]; if (hp) r.push("", `Ora di punta: ${String(hp[0]).padStart(2, "0")}:00–${String(+hp[0] + 1).padStart(2, "0")}:00 (${eur(hp[1])})`);
  if (S.settings.moduli.magazzino) { const low = S.ing.filter(g => g.qta <= g.soglia).map(g => g.nome); if (low.length) r.push("", "Da riordinare: " + low.slice(0, 12).join(", ") + (low.length > 12 ? "…" : "")); }
  if (S.settings.moduli.prenotazioni) { const dom = dkey(new Date(data + "T12:00").getTime() + 864e5), pr = S.prenotazioni.filter(p => p.data === dom && p.stato === "attesa"); r.push("", pr.length ? `Prenotazioni domani: ${pr.length} (${pr.reduce((s, p) => s + (+p.persone || 0), 0)} persone)` : "Nessuna prenotazione per domani"); }
  if (S.settings.moduli.clienti) { const n = new Set(V.map(v => v.cliente).filter(Boolean)).size; if (n) r.push(`Clienti abituali passati oggi: ${n}`); }
  if (S.settings.moduli.haccp && S.haccp) {
    const reg = S.haccpReg.filter(x => x.g === data && !x.x), nc = reg.filter(x => !x.o).length, manc = haccpMancanti(S, Math.min(Date.now(), new Date(data + "T23:59").getTime())).length;
    r.push("", `HACCP: ${reg.filter(x => x.k === "temp").length} temperature registrate${manc ? ` · *${manc} controlli mancanti*` : ""}${nc ? ` · *${nc} non conformità*` : ""}`);
  }
  r.push("", "_Inviato da Tavolo_");
  return r.join("\n");
}

/* ---------- Azioni ---------- */
const ACCESSO = {
  ordina: ["titolare", "cassa", "cameriere"], storno: ["titolare", "cassa"], sconto: ["titolare", "cassa"], incasso: ["titolare", "cassa", "cameriere"],
  cucina: ["titolare", "cassa", "cameriere", "cucina"], disp: ["titolare", "cassa", "cucina"], pren: ["titolare", "cassa", "cameriere"], cassa: ["titolare", "cassa"], admin: ["titolare"],
  tutti: ["titolare", "cassa", "cameriere", "cucina"]
};
const BLOCCATE_SE_SCADUTA = ["tav.aggiungi", "tav.coperti", "pren.arrivo", "cons.nuovo", "qr.accetta", "att.siedi"];
const getT = (S, id) => T(S, id) || no("Tavolo non trovato");
const getR = (t, rid) => t.righe.find(r => r.id === rid) || no("Riga non trovata: forse un collega l'ha già modificata");
const extraOk = v => { if (v === "" || v == null) return 0; const n = Number(String(v).replace(",", ".")); return isFinite(n) && n >= -50 && n <= 100 ? round2(n) : null; };
const uscitaOk = u => { u = parseInt(u, 10); return u >= 1 && u <= 3 ? u : 1; };
const rigaVendita = (S, r, q) => { const it = M(S, r.mid) || { nome: "?", prezzo: 0, cat: "" }; return { nome: it.nome, q, prezzo: prezzoRiga(S, r) || it.prezzo, cat: it.cat, mid: r.mid, nota: r.nota || "", extra: +r.extra || 0, uscita: r.uscita || 1 }; };
function pagamento(S, p, tot) {
  const met = METODI[p.metodo] ? p.metodo : no("Metodo di pagamento non valido");
  let resto = null;
  if (met === "contanti" && p.ricevuti != null && p.ricevuti !== "") { const r = num(p.ricevuti, 0); if (r == null || r + 0.001 < tot) no("I contanti ricevuti non bastano"); resto = round2(r - tot); }
  return { met, resto };
}
function chiudiTavolo(S, t) {
  S.comande = S.comande.filter(c => c.tav !== t.id || c.stato === "prep");
  S.prenotazioni.forEach(pr => { if (pr.tavolo === t.id && pr.stato === "arrivato") pr.stato = "chiusa"; });
  if (t.consegna) S.tavoli = S.tavoli.filter(x => x !== t); else resetTav(t);
}
const datiCanale = (S, t, tot) => { if (!t.consegna) return { canale: "sala" }; const pl = piattaforme(S).find(x => x.id === t.consegna.p) || { comm: 0 }; return { canale: t.consegna.p, commissione: round2(tot * (+pl.comm || 0) / 100), consegna: t.consegna }; };
const stampaReparto = (S, out, rep, righe) => { if (S.settings.stampanti[rep]) out.stampe.push({ dest: rep, righe }); };

const AZIONI = {
  "tav.coperti": ["ordina", (S, p, u) => {
    const t = getT(S, p.tid); if (t.posti === 0) no("Banco e asporto non hanno coperti");
    t.coperti = Math.max(0, Math.min(99, t.coperti + (p.delta > 0 ? 1 : -1)));
    if (t.coperti && !t.aperto) { t.aperto = Date.now(); t.cam = t.cam || u.nome; }
    if (!isBusy(t)) resetTav(t);
  }],
  "tav.aggiungi": ["ordina", (S, p, u) => {
    const t = getT(S, p.tid), it = M(S, p.mid) || no("Piatto non trovato");
    if (!avail(S, it)) no(it.nome + " non è disponibile");
    const us = uscitaOk(p.uscita);
    const r = t.righe.find(x => x.mid === it.id && !x.inv && !x.nota && !x.extra && x.uscita === us);
    if (r) r.q++; else t.righe.push({ id: uid(), mid: it.id, q: 1, inv: false, uscita: us, nota: "" });
    if (!t.aperto) t.aperto = Date.now(); if (!t.cam) t.cam = u.nome; t.conto = false;
  }],
  "tav.qta": ["ordina", (S, p) => {
    const t = getT(S, p.tid), r = getR(t, p.rid); if (r.inv) no("Già inviato: serve lo storno");
    r.q += p.delta > 0 ? 1 : -1; if (r.q <= 0) t.righe = t.righe.filter(x => x !== r);
    if (!isBusy(t)) resetTav(t);
  }],
  "tav.nota": ["ordina", (S, p) => {
    const t = getT(S, p.tid), r = getR(t, p.rid); if (r.inv) no("Già inviato: la nota non arriverebbe in cucina");
    r.nota = txt(p.nota, 120); if (p.uscita) r.uscita = uscitaOk(p.uscita);
    if (p.extra !== undefined) { const e = extraOk(p.extra); if (e === null) no("Prezzo della variante non valido (tra -50 e +100 €)"); r.extra = e; }
  }],
  // avviso per tutto il tavolo (allergie, dieta, esigenze): arriva in cucina su ogni comanda, anche su quelle già inviate
  "tav.avviso": ["ordina", (S, p, u) => {
    const t = getT(S, p.tid), a = txt(p.testo, 160);
    if (a && !isBusy(t)) no("Apri prima il tavolo: imposta i coperti o aggiungi un piatto");
    t.avviso = a; S.comande.forEach(c => { if (c.tav === t.id && c.stato === "prep") c.avviso = a; });
    if (a) log(S, u, `Avviso per ${tavLabel(t)}: ${a}`);
  }],
  "tav.separa": ["ordina", (S, p, u, out) => {
    const t = getT(S, p.tid), r = getR(t, p.rid); if (r.inv || r.q < 2) no("Non si può separare");
    const ex = p.extra !== undefined ? extraOk(p.extra) : (r.extra || 0); if (ex === null) no("Prezzo della variante non valido (tra -50 e +100 €)");
    r.q--; const n = { id: uid(), mid: r.mid, q: 1, inv: false, uscita: p.uscita ? uscitaOk(p.uscita) : r.uscita, nota: txt(p.nota, 120), extra: ex };
    t.righe.splice(t.righe.indexOf(r) + 1, 0, n); out.nuovoId = n.id;
  }],
  "tav.invia": ["ordina", (S, p, u, out) => {
    const t = getT(S, p.tid), nuovi = t.righe.filter(r => !r.inv); if (!nuovi.length) no("Niente da inviare");
    const reps = {};
    nuovi.forEach(r => {
      const it = M(S, r.mid) || no("Un piatto non esiste più nel menu: toglilo");
      r.inv = true;
      if (S.settings.moduli.magazzino) it.ing.forEach(([id, q]) => { const g = ING(S, id); if (g) g.qta = Math.max(0, r3(g.qta - q * r.q)); });
      (reps[repOf(S, it)] = reps[repOf(S, it)] || []).push({ rid: r.id, nome: it.nome, q: r.q, nota: r.nota, uscita: r.uscita });
    });
    if (!t.cam) t.cam = u.nome;
    if (S.settings.moduli.cucina) Object.entries(reps).forEach(([rep, rr]) => {
      const c = { id: uid(), num: ++S.contatori.comanda, tav: t.id, tavNome: t.nome, ora: Date.now(), stato: "prep", reparto: rep, cam: t.cam, righe: rr, avviso: t.avviso || "" };
      S.comande.push(c); if (S.settings.stampaAuto) stampaReparto(S, out, rep, testoComanda(S, c));
    });
    log(S, u, `Comanda da ${tavLabel(t)}: ${nuovi.reduce((s, r) => s + r.q, 0)} pezzi`);
    out.msg = S.settings.moduli.cucina ? "Inviato a " + Object.keys(reps).join(", ") : "Ordine registrato";
  }],
  "tav.chiama": ["ordina", (S, p, u, out) => {
    const t = getT(S, p.tid), maxU = Math.max(1, ...t.righe.filter(r => r.inv).map(r => r.uscita || 1));
    if (t.chiamata >= maxU) no("Non ci sono altre uscite da chiamare");
    t.chiamata++;
    const reps = new Set(S.comande.filter(c => c.tav === t.id && c.righe.some(r => r.uscita === t.chiamata)).map(c => c.reparto));
    reps.forEach(rep => S.settings.stampaAuto && stampaReparto(S, out, rep, testoAvviso(S, [`VIA ${t.chiamata}a USCITA`, tavLabel(t), hhmm(Date.now())])));
    log(S, u, `${t.chiamata}ª uscita chiamata per ${tavLabel(t)}`); out.msg = `${t.chiamata}ª uscita chiamata`;
  }],
  "tav.storno": ["storno", (S, p, u, out) => {
    const t = getT(S, p.tid), r = getR(t, p.rid); if (!r.inv) no("Riga non ancora inviata: togli con −");
    const it = M(S, r.mid);
    t.righe = t.righe.filter(x => x !== r);
    S.comande.forEach(c => { if (c.tav === t.id) c.righe = c.righe.filter(x => x.rid !== r.id); });
    const vuote = S.comande.filter(c => c.tav === t.id && !c.righe.length);
    S.comande = S.comande.filter(c => !vuote.includes(c));
    if (it && S.settings.stampaAuto) stampaReparto(S, out, repOf(S, it), testoAvviso(S, ["ANNULLATO", tavLabel(t), `${r.q}x ${it.nome}`]));
    log(S, u, `Storno ${r.q}× ${it ? it.nome : "piatto"} da ${tavLabel(t)}`);
    if (!isBusy(t)) resetTav(t); out.msg = "Riga stornata";
  }],
  "tav.conto": ["ordina", (S, p) => { const t = getT(S, p.tid); if (!isBusy(t)) no("Tavolo vuoto"); t.conto = true; }],
  "tav.sposta": ["ordina", (S, p, u) => {
    const a = getT(S, p.da), b = getT(S, p.a); if (a.consegna || b.consegna) no("Le consegne non si spostano"); if (isBusy(b)) no("Il tavolo di arrivo è occupato"); if (!isBusy(a)) no("Niente da spostare");
    ["coperti", "righe", "aperto", "conto", "sconto", "cam", "chiamata", "avviso", "cliente", "premio"].forEach(k => b[k] = a[k]); if (!b.posti) b.coperti = 0;
    S.comande.forEach(c => { if (c.tav === a.id) { c.tav = b.id; c.tavNome = b.nome; } });
    S.richiesteQr.forEach(r => { if (r.tav === a.id && r.stato === "attesa") { r.tav = b.id; r.tavNome = b.nome; } });
    log(S, u, `Spostato ${tavLabel(a)} → ${tavLabel(b)}`); resetTav(a);
  }],
  "tav.sconto": ["sconto", (S, p, u) => {
    const t = getT(S, p.tid);
    t.premio = null;
    if (p.val == null) { t.sconto = null; log(S, u, `Sconto tolto da ${tavLabel(t)}`); return; }
    const tipo = p.tipo === "€" ? "€" : "%", v = num(p.val, 0.01, tipo === "%" ? 100 : 100000);
    if (v == null) no(tipo === "%" ? "Scrivi una percentuale tra 1 e 100" : "Scrivi un importo maggiore di zero");
    t.sconto = { tipo, val: v }; log(S, u, `Sconto ${tipo === "%" ? v + "%" : eur(v)} su ${tavLabel(t)}`);
  }],
  "tav.incassa": ["incasso", (S, p, u, out) => {
    const t = getT(S, p.tid); if (!isBusy(t)) no("Tavolo vuoto"); if (t.righe.some(r => !r.inv)) no("Invia prima i piatti non ancora inviati");
    const tot = tTot(S, t), { met, resto } = pagamento(S, p, tot);
    S.vendite.push({ id: uid(), tav: t.nome, tid: t.id, righe: t.righe.map(r => rigaVendita(S, r, r.q)),
      coperti: t.posti > 0 ? t.coperti : 0, lordo: round2(sub(S, t) + copertoTot(S, t)), sconto: round2(scontoVal(S, t)), tot, metodo: met, ora: Date.now(), cam: t.cam || u.nome, chi: u.nome,
      aperto: t.aperto, scontoTav: t.sconto, cliente: t.cliente || undefined, ...datiCanale(S, t, tot) });
    out.vendita = S.vendite[S.vendite.length - 1].id;
    if (t.cliente) { accreditaCliente(S, t, tot, S.vendite[S.vendite.length - 1].righe); const c = CLI(S, t.cliente); if (c) c.visite = (c.visite || 0) + 1; }
    log(S, u, `Incasso ${eur(tot)} ${METODI[met]} da ${tavLabel(t)}`);
    out.msg = `Incassati ${eur(tot)}${resto != null ? " · resto " + eur(resto) : ""} · ${tavLabel(t)} libero`;
    chiudiTavolo(S, t);
  }],
  "tav.incassaParte": ["incasso", (S, p, u, out) => {
    const t = getT(S, p.tid); if (!isBusy(t)) no("Tavolo vuoto"); if (t.righe.some(r => !r.inv)) no("Invia prima i piatti non ancora inviati");
    const scelte = (Array.isArray(p.righe) ? p.righe : []).map(x => ({ r: getR(t, x.rid), q: Math.round(+x.q || 0) })).filter(x => x.q > 0);
    scelte.forEach(x => { if (x.q > x.r.q) no("Quantità non valida per " + (M(S, x.r.mid) || { nome: "un piatto" }).nome); });
    const cop = t.posti > 0 ? Math.max(0, Math.min(t.coperti, Math.round(+p.coperti || 0))) : 0;
    if (!scelte.length && !cop) no("Scegli almeno un piatto o un coperto");
    const lordo = round2(scelte.reduce((s, x) => s + prezzoRiga(S, x.r) * x.q, 0) + cop * S.settings.coperto);
    const sconto = t.sconto && t.sconto.tipo === "%" ? round2(lordo * t.sconto.val / 100) : 0, tot = round2(lordo - sconto);
    const { met, resto } = pagamento(S, p, tot);
    S.vendite.push({ id: uid(), tav: t.nome, tid: t.id, righe: scelte.map(x => rigaVendita(S, x.r, x.q)), coperti: cop, lordo, sconto, tot, metodo: met, ora: Date.now(), cam: t.cam || u.nome, chi: u.nome, parziale: true, cliente: t.cliente || undefined, ...datiCanale(S, t, tot) });
    out.vendita = S.vendite[S.vendite.length - 1].id;
    if (t.cliente) accreditaCliente(S, t, tot, S.vendite[S.vendite.length - 1].righe);
    scelte.forEach(x => { x.r.q -= x.q; }); t.righe = t.righe.filter(r => r.q > 0); t.coperti -= cop;
    log(S, u, `Incasso parziale ${eur(tot)} ${METODI[met]} da ${tavLabel(t)}`);
    if (!t.righe.length && !t.coperti) { const c = t.cliente && CLI(S, t.cliente); if (c) c.visite = (c.visite || 0) + 1; out.msg = `Incassati ${eur(tot)}${resto != null ? " · resto " + eur(resto) : ""} · ${tavLabel(t)} libero`; chiudiTavolo(S, t); }
    else out.msg = `Incassati ${eur(tot)}${resto != null ? " · resto " + eur(resto) : ""} · restano ${eur(tTot(S, t))}`;
  }],
  "tav.unisci": ["ordina", (S, p, u) => {
    const a = getT(S, p.da), b = getT(S, p.a); if (a === b) no("Scegli un altro tavolo"); if (a.consegna || b.consegna) no("Le consegne non si uniscono ai tavoli"); if (!isBusy(a) || !isBusy(b)) no("Per unire servono due tavoli occupati");
    b.righe.push(...a.righe); if (b.posti > 0) b.coperti = Math.min(99, b.coperti + a.coperti);
    b.aperto = Math.min(a.aperto || Date.now(), b.aperto || Date.now()); b.chiamata = Math.max(a.chiamata || 1, b.chiamata || 1); b.conto = false; if (!b.sconto && a.sconto) b.sconto = a.sconto;
    if (a.avviso && a.avviso !== b.avviso) b.avviso = txt([b.avviso, a.avviso].filter(Boolean).join(" · "), 160);
    if (!b.cliente && a.cliente) b.cliente = a.cliente;
    S.comande.forEach(c => { if (c.tav === a.id) { c.tav = b.id; c.tavNome = b.nome; } });
    log(S, u, `Unito ${tavLabel(a)} a ${tavLabel(b)}`); resetTav(a);
  }],
  "tav.libera": ["ordina", (S, p, u) => { const t = getT(S, p.tid); if (t.righe.length) no("Ci sono piatti nel conto"); log(S, u, `${tavLabel(t)} ${t.consegna ? "annullato" : "liberato senza incasso"}`); if (t.consegna) S.tavoli = S.tavoli.filter(x => x !== t); else resetTav(t); }],
  "cons.nuovo": ["ordina", (S, p, u, out) => {
    if (!S.settings.moduli.consegne) no("Il modulo Consegne è spento");
    const pl = piattaforme(S).find(x => x.id === p.p) || no("Scegli la piattaforma");
    const codice = txt(p.codice, 20), ritiro = /^\d{2}:\d{2}$/.test(p.ritiro || "") ? p.ritiro : "";
    S.contatori.consegna = (S.contatori.consegna || 0) + 1;
    const t = nuovoTavolo("K" + uid(), `${pl.nome} ${codice || "#" + S.contatori.consegna}`, "Consegne", 0);
    Object.assign(t, { aperto: Date.now(), cam: u.nome, consegna: { p: pl.id, codice, ritiro, cliente: txt(p.cliente, 40), nota: txt(p.nota, 120) } });
    S.tavoli.push(t); out.nuovoId = t.id; log(S, u, `Nuova consegna ${t.nome}${ritiro ? " ritiro " + ritiro : ""}`);
  }],
  "cons.piattaforme": ["admin", (S, p, u) => {
    const lista = (Array.isArray(p.lista) ? p.lista : []).slice(0, 12).map(x => ({ id: txt(x.id, 30) || txt(x.nome, 30).toLowerCase().replace(/[^a-z0-9]+/g, ""), nome: txt(x.nome, 20), comm: num(x.comm, 0, 100) }));
    if (!lista.length || lista.some(x => !x.nome || !x.id || x.comm == null)) no("Ogni piattaforma vuole un nome e una commissione tra 0 e 100%");
    if (new Set(lista.map(x => x.id)).size !== lista.length) no("Due piattaforme hanno lo stesso nome");
    S.settings.piattaforme = lista; log(S, u, "Piattaforme di consegna aggiornate");
  }],
  "stampa.preconto": ["ordina", (S, p, u, out) => { const t = getT(S, p.tid); if (!S.settings.stampanti.Sala) no("Nessuna stampante di sala impostata"); out.stampe.push({ dest: "Sala", righe: testoPreconto(S, t) }); out.msg = "Preconto inviato alla stampante"; }],

  "com.stato": ["cucina", (S, p) => { const c = S.comande.find(x => x.id === p.cid) || no("Comanda non trovata"); c.stato = p.stato === "pronto" ? "pronto" : "prep"; c.pronta = c.stato === "pronto" ? Date.now() : null; }],
  "com.servito": ["cucina", (S, p) => { S.comande = S.comande.filter(c => c.id !== p.cid); }],

  "pren.nuova": ["pren", (S, p, u) => {
    const nome = txt(p.nome, 50), pers = num(p.persone, 1, 200);
    if (!nome || !/^\d{4}-\d{2}-\d{2}$/.test(p.data) || !/^\d{2}:\d{2}$/.test(p.ora) || !pers) no("Servono nome, giorno, ora e numero di persone");
    if (p.tavolo && !T(S, p.tavolo)) no("Tavolo non trovato");
    S.prenotazioni.push({ id: uid(), data: p.data, ora: p.ora, nome, tel: txt(p.tel, 30), persone: Math.round(pers), tavolo: p.tavolo || "", note: txt(p.note, 160), stato: "attesa", da: u.nome, acc: !!p.acc });
    log(S, u, `Prenotazione ${nome}, ${pers} pers. ${p.data} ${p.ora}`);
  }],
  "pren.stato": ["pren", (S, p, u) => { const pr = S.prenotazioni.find(x => x.id === p.pid) || no("Prenotazione non trovata"); pr.stato = p.stato === "annullata" ? "annullata" : "attesa"; if (pr.stato === "annullata") log(S, u, `Prenotazione annullata: ${pr.nome}`); }],
  "pren.arrivo": ["pren", (S, p, u) => {
    const pr = S.prenotazioni.find(x => x.id === p.pid) || no("Prenotazione non trovata"), t = getT(S, p.tid);
    if (isBusy(t)) no("Il tavolo è occupato"); if (!t.posti) no("Scegli un tavolo con posti");
    pr.stato = "arrivato"; pr.tavolo = t.id; Object.assign(t, { coperti: Math.min(pr.persone, 99), aperto: Date.now(), cam: u.nome });
  }],

  "menu.prezzo": ["admin", (S, p, u) => { const m = M(S, p.mid) || no("Piatto non trovato"), v = num(p.prezzo, 0, 10000); if (v == null) no("Prezzo non valido"); if (m.prezzo !== v) log(S, u, `Prezzo ${m.nome}: ${eur(m.prezzo)} → ${eur(v)}`); m.prezzo = round2(v); }],
  "menu.disp": ["disp", (S, p, u) => { const m = M(S, p.mid) || no("Piatto non trovato"); m.disp = !m.disp; log(S, u, `${m.nome}: ${m.disp ? "di nuovo disponibile" : "non disponibile"}`); }],
  "menu.salva": ["admin", (S, p, u) => {
    const d = p.piatto || {}, nome = txt(d.nome, 60), prezzo = num(d.prezzo, 0, 10000);
    if (!nome) no("Dai un nome al piatto"); if (prezzo == null) no("Prezzo non valido");
    if (!S.categorie.some(c => c.nome === d.cat)) no("Scegli una categoria");
    const all = [...new Set((d.all || []).map(Number).filter(a => a >= 1 && a <= 14))].sort((a, b) => a - b);
    const ing = (d.ing || []).filter(r => Array.isArray(r) && ING(S, r[0]) && num(r[1], 0.0001, 1000) != null).map(r => [r[0], r3(r[1])]);
    const vari = (Array.isArray(d.var) ? d.var : []).slice(0, 12).map(x => ({ n: txt(x && x.n, 30), p: extraOk(x && x.p) })).filter(x => x.n && x.p !== null);
    const tr = {}; for (const l of Object.keys(LINGUE)) { const v = txt(d.tr && d.tr[l], 60); if (v) tr[l] = v; }
    if (!tr.en && txt(d.en, 60) && !(d.tr && "en" in d.tr)) tr.en = txt(d.en, 60);
    const en = tr.en || "";
    const desc = txt(d.desc, 200), descTr = {}; for (const l of Object.keys(LINGUE)) { const v = txt(d.descTr && d.descTr[l], 200); if (v) descTr[l] = v; }
    const surg = !!d.surg;
    if (d.id) { const m = M(S, d.id) || no("Piatto non trovato"); if (m.prezzo !== prezzo) log(S, u, `Prezzo ${m.nome}: ${eur(m.prezzo)} → ${eur(prezzo)}`); Object.assign(m, { nome, prezzo: round2(prezzo), cat: d.cat, all, ing, var: vari, en, tr, desc, descTr, surg }); }
    else { S.menu.push({ id: uid(), nome, prezzo: round2(prezzo), cat: d.cat, all, ing, var: vari, disp: true, en, tr, desc, descTr, surg }); log(S, u, `Nuovo piatto: ${nome}`); }
  }],
  "menu.elimina": ["admin", (S, p, u) => { const m = M(S, p.mid) || no("Piatto non trovato"); if (S.tavoli.some(t => t.righe.some(r => r.mid === m.id))) no("Il piatto è in un conto aperto: chiudi prima quel tavolo"); S.menu = S.menu.filter(x => x !== m); log(S, u, `Piatto eliminato: ${m.nome}`); }],
  "cat.nuova": ["admin", (S, p) => { const n = txt(p.nome, 40); if (!n) no("Scrivi il nome della categoria"); if (S.categorie.some(c => c.nome.toLowerCase() === n.toLowerCase())) no("Esiste già"); S.categorie.push({ nome: n, rep: REPARTI.includes(p.rep) ? p.rep : "Cucina" }); }],
  "cat.reparto": ["admin", (S, p) => { const c = S.categorie[p.i] || no("Categoria non trovata"); if (!REPARTI.includes(p.rep)) no("Reparto non valido"); c.rep = p.rep; }],
  "cat.en": ["admin", (S, p) => { const c = S.categorie[p.i] || no("Categoria non trovata"); c.en = txt(p.en, 40); c.tr = Object.assign({}, c.tr, { en: c.en }); }],
  // traduzioni di piatti e categorie in una lingua, anche molte insieme (dalla finestra Traduzioni)
  "menu.trad": ["admin", (S, p, u) => {
    const l = p.l; if (!LINGUE[l]) no("Lingua non valida");
    const voci = Array.isArray(p.voci) ? p.voci.slice(0, 500) : []; let n = 0;
    for (const v of voci) {
      const x = v && v.m ? M(S, v.m) : v && v.c != null ? S.categorie[+v.c] : null; if (!x) continue;
      const t = txt(v.v, v.m ? 60 : 40); x.tr = Object.assign({}, x.tr); if (t) x.tr[l] = t; else delete x.tr[l];
      if (l === "en") x.en = t; n++;
    }
    if (n) log(S, u, `Traduzioni in ${LINGUE[l].toLowerCase()} aggiornate (${n})`);
  }],
  "cat.su": ["admin", (S, p) => { const i = +p.i; if (!(i > 0 && i < S.categorie.length)) no("Non si può spostare"); [S.categorie[i - 1], S.categorie[i]] = [S.categorie[i], S.categorie[i - 1]]; }],
  "cat.elimina": ["admin", (S, p) => { const c = S.categorie[p.i] || no("Categoria non trovata"); if (S.menu.some(m => m.cat === c.nome)) no("Svuota prima la categoria"); S.categorie.splice(p.i, 1); }],

  "mag.carico": ["admin", (S, p, u) => { const g = ING(S, p.iid) || no("Ingrediente non trovato"), q = num(p.q, 0.001); if (q == null) no("Scrivi la quantità arrivata"); g.qta = r3(g.qta + q); const c = num(p.costo, 0); if (c != null && p.costo !== "") g.costo = c; log(S, u, `Carico ${q} ${g.um} ${g.nome}`); }],
  "mag.conta": ["admin", (S, p, u) => { const g = ING(S, p.iid) || no("Ingrediente non trovato"), q = num(p.q, 0); if (q == null) no("Quantità non valida"); const d = r3(q - g.qta); g.qta = r3(q); log(S, u, `Inventario ${g.nome}: ${d >= 0 ? "+" : ""}${d} ${g.um}`); }],
  "mag.nuovo": ["admin", (S, p) => { const nome = txt(p.nome, 50); if (!nome) no("Scrivi il nome"); S.ing.push({ id: uid(), nome, um: ["kg", "l", "pz", "bt"].includes(p.um) ? p.um : "kg", qta: num(p.qta, 0) || 0, soglia: num(p.soglia, 0) || 0, costo: num(p.costo, 0) || 0, forn: p.forn || "" }); }],
  "mag.modifica": ["admin", (S, p) => { const g = ING(S, p.iid) || no("Ingrediente non trovato"); const s = num(p.soglia, 0); if (s != null) g.soglia = s; if (p.forn != null) g.forn = String(p.forn); }],
  "forn.nuovo": ["admin", (S, p) => { const n = txt(p.nome, 50); if (!n) no("Scrivi il nome del fornitore"); S.fornitori.push({ id: uid(), nome: n, tel: txt(p.tel, 30) }); }],

  "cassa.mov": ["cassa", (S, p, u) => {
    const tipo = ["fondo", "prelievo", "versamento"].includes(p.tipo) ? p.tipo : no("Tipo non valido"), v = num(p.importo, 0.01, 1e6); if (v == null) no("Scrivi un importo");
    S.movimenti.push({ id: uid(), tipo, importo: round2(v), nota: txt(p.nota, 80), ora: Date.now(), chi: u.nome });
    log(S, u, `${{ fondo: "Fondo cassa", prelievo: "Prelievo", versamento: "Versamento" }[tipo]} ${eur(v)}${p.nota ? ": " + txt(p.nota, 80) : ""}`);
  }],
  "cassa.annulla": ["storno", (S, p, u, out) => {
    const v = S.vendite.find(x => x.id === p.vid) || no("Conto non trovato: forse la giornata è già stata chiusa");
    S.vendite = S.vendite.filter(x => x !== v);
    let t = v.tid && T(S, v.tid); const ok = r => r.mid && M(S, r.mid);
    if (!t && v.consegna && v.tid) { t = nuovoTavolo(v.tid, v.tav, "Consegne", 0); t.consegna = v.consegna; S.tavoli.push(t); }
    const righe = (v.righe || []).filter(ok).map(r => ({ id: uid(), mid: r.mid, q: r.q, inv: true, uscita: r.uscita || 1, nota: r.nota || "", extra: +r.extra || 0 }));
    if (t && righe.length && (!isBusy(t) || v.parziale)) {
      if (!isBusy(t)) Object.assign(t, { aperto: v.aperto || Date.now(), cam: v.cam, sconto: v.scontoTav || null, chiamata: 3 });
      t.righe.push(...righe); if (t.posti > 0) t.coperti = Math.min(99, t.coperti + (v.coperti || 0)); t.conto = false;
      out.msg = `Incasso annullato: ${tavLabel(t)} riaperto con il conto`;
    } else out.msg = t && isBusy(t) ? `Incasso annullato. ${tavLabel(t)} è occupato: il conto non è stato riaperto` : "Incasso annullato";
    if (v.rt && v.rt.stato === "ok") out.msg += ". Lo scontrino già emesso va annullato sul registratore";
    log(S, u, `Annullato incasso di ${eur(v.tot)} (${METODI[v.metodo] || v.metodo}) da ${/^\d+$/.test(v.tav) ? "Tavolo " + v.tav : v.tav}`);
  }],
  "cassa.chiudi": ["cassa", (S, p, u, out) => {
    if (S.tavoli.some(isBusy)) no("Ci sono tavoli aperti: chiudili prima");
    const V = S.vendite, tot = V.reduce((s, v) => s + v.tot, 0), by = k => V.filter(v => v.metodo === k).reduce((s, v) => s + v.tot, 0);
    const k = giorno(Date.now()), rec = { data: k, tot: round2(tot), n: V.length, coperti: V.reduce((s, v) => s + v.coperti, 0), carta: round2(by("carta")), contanti: round2(by("contanti")), altro: round2(tot - by("carta") - by("contanti")) };
    const ex = S.storico.find(x => x.data === k);
    if (ex) ["tot", "n", "coperti", "carta", "contanti", "altro"].forEach(f => ex[f] = round2((ex[f] || 0) + rec[f])); else S.storico.push(rec);
    out.archivio = { vendite: V, movimenti: S.movimenti };
    out.riepilogo = testoRiepilogo(S, V, k);
    S.attesa = S.attesa.filter(a => a.stato === "attesa" || a.stato === "avvisato");
    S.vendite = []; S.movimenti = []; S.comande = S.comande.filter(c => c.stato === "prep");
    log(S, u, `Chiusura giornata: ${eur(tot)}`); out.msg = "Giornata chiusa e archiviata";
  }],

  /* ----- Ordini dal tavolo con il QR ----- */
  "qr.accetta": ["ordina", (S, p, u, out) => {
    const r = S.richiesteQr.find(x => x.id === p.id) || no("Richiesta non trovata"); if (r.tipo !== "ordine" || r.stato !== "attesa") no("Questo ordine è già stato gestito");
    const t = getT(S, r.tav); const saltati = [];
    for (const x of r.righe) {
      const it = M(S, x.mid); if (!it || !avail(S, it)) { saltati.push(x.nome); continue; }
      t.righe.push({ id: uid(), mid: it.id, q: Math.max(1, Math.min(20, x.q | 0)), inv: false, uscita: 1, nota: txt(x.nota, 120) });
    }
    if (r.nota) t.avviso = t.avviso ? txt(t.avviso + " · " + r.nota, 160) : txt(r.nota, 160);
    if (!t.aperto) t.aperto = Date.now(); if (!t.cam) t.cam = u.nome; t.conto = false;
    r.stato = "accettato"; r.chi = u.nome; r.gestito = Date.now();
    log(S, u, `Ordine dal QR accettato: ${tavLabel(t)}`);
    out.msg = (saltati.length ? `Non disponibili: ${saltati.join(", ")}. ` : "") + "Ordine aggiunto al tavolo: controlla e tocca Invia";
  }],
  "qr.rifiuta": ["ordina", (S, p, u) => {
    const r = S.richiesteQr.find(x => x.id === p.id) || no("Richiesta non trovata"); if (r.stato !== "attesa") no("Già gestita");
    r.stato = r.tipo === "ordine" ? "rifiutato" : "visto"; r.chi = u.nome; r.gestito = Date.now();
    if (r.tipo === "ordine") log(S, u, `Ordine dal QR non accettato: ${tavLabelNome(r.tavNome)}`);
  }],
  "qr.codici": ["admin", (S, p, u) => { S.tavoli.forEach(t => { if (!t.consegna) t.qrk = crypto.randomBytes(5).toString("hex"); }); log(S, u, "Codici QR dei tavoli rigenerati: i vecchi non funzionano più"); }],
  "imp.recensione": ["admin", (S, p) => {
    const v = txt(p.url, 300); if (v && !/^https:\/\/[^\s]+$/.test(v)) no("Incolla il link completo, che inizia con https://"); S.settings.recensione = v;
  }],
  "imp.riepilogo": ["admin", (S, p) => { const n = txt(p.tel, 20); if (n && telNorm(n).length < 8) no("Numero di telefono non valido"); S.settings.waTitolare = n; }],

  /* ----- Clienti abituali ----- */
  "cli.salva": ["pren", (S, p, u, out) => {
    const nome = txt(p.nome, 50); if (!nome) no("Scrivi il nome del cliente");
    const comp = p.compleanno ? String(p.compleanno).slice(-5) : ""; if (comp && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(comp)) no("Data di compleanno non valida");
    const tel = txt(p.tel, 20), tn = telNorm(tel);
    let c = p.id ? CLI(S, p.id) || no("Cliente non trovato") : null;
    if (!c) {
      if (!p.consenso) no("Serve il consenso del cliente per salvare i suoi dati");
      if (tn && S.clienti.some(x => telNorm(x.tel) === tn)) no("C'è già un cliente con questo numero");
      c = { id: uid(), creato: Date.now(), consenso: Date.now(), punti: 0, visite: 0, spesa: 0, piatti: {} }; S.clienti.push(c);
      log(S, u, `Nuovo cliente abituale: ${nome}`);
    } else if (tn && S.clienti.some(x => x !== c && telNorm(x.tel) === tn)) no("C'è già un cliente con questo numero");
    Object.assign(c, { nome, tel, compleanno: comp, note: txt(p.note, 160), email: txt(p.email, 80) });
    if (p.tid) { const t = getT(S, p.tid); t.cliente = c.id; }
    out.nuovoId = c.id;
  }],
  "cli.elimina": ["cassa", (S, p, u) => {
    const c = CLI(S, p.id) || no("Cliente non trovato"); S.clienti = S.clienti.filter(x => x !== c);
    S.tavoli.forEach(t => { if (t.cliente === c.id) { t.cliente = null; t.premio = null; } });
    S.vendite.forEach(v => { if (v.cliente === c.id) delete v.cliente; });
    log(S, u, "Cliente abituale cancellato con i suoi dati");
  }],
  "cli.tavolo": ["ordina", (S, p) => {
    const t = getT(S, p.tid); if (p.cid) { CLI(S, p.cid) || no("Cliente non trovato"); t.cliente = p.cid; } else { t.cliente = null; if (t.premio) { t.premio = null; t.sconto = null; } }
  }],
  "cli.premio": ["sconto", (S, p, u, out) => {
    const t = getT(S, p.tid), c = t.cliente && CLI(S, t.cliente) || no("Collega prima un cliente al tavolo"), pc = puntiConf(S);
    if (!isBusy(t)) no("Il tavolo è vuoto"); if ((c.punti || 0) < pc.soglia) no(`Servono ${pc.soglia} punti, ${c.nome} ne ha ${c.punti || 0}`);
    t.sconto = { tipo: "€", val: round2(pc.premio) }; t.premio = { cid: c.id, punti: pc.soglia, val: round2(pc.premio) };
    log(S, u, `Premio fedeltà ${eur(pc.premio)} a ${c.nome} su ${tavLabel(t)}`); out.msg = `Sconto di ${eur(pc.premio)}: i punti si scalano all'incasso`;
  }],
  "imp.punti": ["admin", (S, p) => {
    const e = num(p.euro, 0, 100), so = num(p.soglia, 1, 100000), pr = num(p.premio, 0, 1000); if (e == null || so == null || pr == null) no("Valori non validi");
    S.settings.punti = { euro: e, soglia: Math.round(so), premio: round2(pr) };
  }],

  /* ----- Turni e presenze ----- */
  "turno.salva": ["admin", (S, p) => {
    const st = S.staff.find(x => x.id === p.sid) || no("Persona non trovata"), data = dataOk(p.data) || no("Giorno non valido");
    const ini = oraOk(p.inizio) || no("Ora di inizio non valida"), fine = oraOk(p.fine) || no("Ora di fine non valida");
    const x = p.id ? S.turni.find(y => y.id === p.id) || no("Turno non trovato") : (S.turni.push({ id: uid() }), S.turni[S.turni.length - 1]);
    Object.assign(x, { sid: st.id, data, inizio: ini, fine, nota: txt(p.nota, 60) });
  }],
  "turno.elimina": ["admin", (S, p) => { S.turni = S.turni.filter(x => x.id !== p.id); }],
  "turno.copia": ["admin", (S, p, u, out) => {
    const da = dataOk(p.da) || no("Settimana non valida"), a = dataOk(p.a) || no("Settimana non valida");
    const d0 = new Date(da + "T12:00").getTime(), a0 = new Date(a + "T12:00").getTime(), sett = k => { const t = new Date(k + "T12:00").getTime(); return t >= d0 && t < d0 + 7 * 864e5; };
    const fonte = S.turni.filter(x => sett(x.data)); if (!fonte.length) no("La settimana di partenza non ha turni");
    const occupato = new Set(S.turni.map(x => x.sid + x.data + x.inizio)); let n = 0;
    fonte.forEach(x => { const nd = dkey(new Date(x.data + "T12:00").getTime() - d0 + a0); if (occupato.has(x.sid + nd + x.inizio)) return; S.turni.push({ id: uid(), sid: x.sid, data: nd, inizio: x.inizio, fine: x.fine, nota: x.nota }); n++; });
    out.msg = n ? `Copiati ${n} turni` : "I turni c'erano già";
  }],
  "pres.timbra": ["tutti", (S, p, u, out) => {
    if (u.tecnico) no("L'assistenza non segna entrate e uscite");
    const aperta = S.presenze.find(x => x.sid === u.id && !x.out);
    if (aperta) { aperta.out = Date.now(); const m = Math.round((aperta.out - aperta.in) / 60000); out.msg = `Uscita alle ${hhmm(aperta.out)} · ${Math.floor(m / 60)} h ${m % 60} min`; }
    else { S.presenze.push({ id: uid(), sid: u.id, in: Date.now(), out: null }); out.msg = `Entrata alle ${hhmm(Date.now())}`; }
  }],
  "pres.modifica": ["admin", (S, p, u) => {
    const x = S.presenze.find(y => y.id === p.id) || no("Presenza non trovata"), i = num(p.in, 1e12, 9e12), o = p.out == null || p.out === "" ? null : num(p.out, 1e12, 9e12);
    if (i == null || (p.out != null && p.out !== "" && o == null)) no("Orari non validi"); if (o != null && o <= i) no("L'uscita deve essere dopo l'entrata"); if (o != null && o - i > 20 * 3600e3) no("Più di 20 ore: controlla gli orari");
    x.in = i; x.out = o; x.corretta = u.nome; log(S, u, "Presenza corretta a mano");
  }],
  "pres.elimina": ["admin", (S, p, u) => { S.presenze = S.presenze.filter(x => x.id !== p.id); log(S, u, "Presenza cancellata"); }],

  /* ----- Lista d'attesa ----- */
  "att.nuovo": ["pren", (S, p) => {
    const nome = txt(p.nome, 40) || no("Scrivi il nome"), pers = num(p.persone, 1, 99) || no("Numero di persone non valido");
    S.attesa.push({ id: uid(), nome, persone: Math.round(pers), tel: txt(p.tel, 20), nota: txt(p.nota, 80), ora: Date.now(), stato: "attesa" });
  }],
  "att.avvisato": ["pren", (S, p) => { const a = S.attesa.find(x => x.id === p.id) || no("Non trovato"); a.stato = "avvisato"; a.avvisato = Date.now(); }],
  "att.siedi": ["pren", (S, p, u) => {
    const a = S.attesa.find(x => x.id === p.id) || no("Non trovato"), t = getT(S, p.tid);
    if (isBusy(t)) no("Il tavolo è occupato"); if (!t.posti) no("Scegli un tavolo con posti");
    Object.assign(t, { coperti: Math.min(a.persone, 99), aperto: Date.now(), cam: u.nome }); a.stato = "seduto"; a.seduto = Date.now(); a.tavolo = t.nome;
  }],
  "att.togli": ["pren", (S, p) => { const a = S.attesa.find(x => x.id === p.id) || no("Non trovato"); a.stato = "andato"; }],

  "imp.locale": ["admin", (S, p, u) => {
    const s = S.settings; s.nome = txt(p.nome, 60) || s.nome; s.tipo = txt(p.tipo, 60) || s.tipo; s.citta = txt(p.citta, 40) || s.citta;
    const c = num(p.coperto, 0, 50), iv = num(p.iva, 0, 30); if (c != null) s.coperto = round2(c); if (iv != null) s.iva = iv;
    log(S, u, "Impostazioni del locale aggiornate");
  }],
  "imp.indirizzo": ["tecnico", (S, p) => {
    const ip = txt(p.ip, 15).replace(/^https?:\/\//, "").replace(/:\d+.*$/, "");
    if (ip && !/^(10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) no("Scrivi l'indirizzo del computer nel Wi-Fi, es. 192.168.1.20");
    S.settings.indirizzoLan = ip;
  }],
  "imp.ai": ["admin", (S, p, u) => {
    const a = Object.assign({ servizio: "claude", modello: "", url: "", limite: 60 }, S.settings.ai);
    if (p.servizio != null) { if (!["claude", "compat"].includes(p.servizio)) no("Servizio non valido"); a.servizio = p.servizio; }
    if (p.modello != null) a.modello = txt(p.modello, 80).replace(/\s/g, "");
    if (p.url != null) { const v = txt(p.url, 200).replace(/\/+$/, ""); if (v && !/^https?:\/\/[^\s]+$/.test(v)) no("Indirizzo del servizio non valido"); a.url = v; }
    if (p.limite != null) { const n = num(p.limite, 1, 1000); if (n == null) no("Limite tra 1 e 1000 domande al giorno"); a.limite = Math.round(n); }
    if (p.chiave != null) { const k = txt(p.chiave, 300).replace(/\s/g, ""); if (k) S.aiChiave = k; }
    if (p.togliChiave) delete S.aiChiave;
    S.settings.ai = a; log(S, u, "Impostazioni dell'assistente AI aggiornate");
  }],
  "imp.traduzione": ["admin", (S, p, u) => {
    if (!["mymemory", "deepl", "spento"].includes(p.servizio)) no("Servizio non valido");
    if (p.servizio === "deepl") { const k = txt(p.chiave, 100).replace(/\s/g, ""); if (k) S.trChiave = k; if (!S.trChiave) no("Incolla la chiave DeepL"); }
    S.settings.traduzione = p.servizio; log(S, u, "Traduzione automatica: " + p.servizio);
  }],
  "imp.aspetto": ["admin", (S, p) => { if (/^#[0-9a-fA-F]{6}$/.test(p.accent || "")) S.settings.accent = p.accent; if (["auto", "chiaro", "scuro"].includes(p.tema)) S.settings.tema = p.tema; }],
  "imp.modulo": ["tecnico", (S, p, u, out, ctx) => {
    const k = p.k; if (!["prenotazioni", "magazzino", "cucina", "consegne", "ai", "qr", "clienti", "turni", "attesa", "haccp"].includes(k)) no("Modulo non valido");
    if (!S.settings.moduli[k] && ctx.piano === "bar" && (k === "cucina" || k === "magazzino")) no("Questo modulo è incluso dal piano Ristorante: contatta l'assistenza");
    S.settings.moduli[k] = !S.settings.moduli[k]; log(S, u, `Modulo ${k} ${S.settings.moduli[k] ? "attivato" : "spento"}`);
    if (k === "cucina" && !S.settings.moduli.cucina && S.staff.some(x => x.ruolo === "cucina")) out.msg = "Cucina e bar spento: chi ha il ruolo Cucina non vedrà più le comande";
  }],
  "imp.sala.nuova": ["admin", (S, p) => { const n = txt(p.nome, 30); if (!n) no("Scrivi il nome della sala"); if (S.settings.sale.includes(n)) no("Esiste già"); S.settings.sale.push(n); }],
  "imp.sala.elimina": ["admin", (S, p) => { if (S.tavoli.some(t => t.sala === p.nome)) no("Togli prima i tavoli della sala"); S.settings.sale = S.settings.sale.filter(s => s !== p.nome); }],
  "imp.tavolo.nuovo": ["admin", (S, p) => {
    if (!S.settings.sale.includes(p.sala)) no("Sala non trovata");
    const nome = txt(p.nome, 12) || String(Math.max(0, ...S.tavoli.map(t => parseInt(t.nome, 10)).filter(n => !isNaN(n))) + 1);
    if (S.tavoli.some(t => t.nome.toLowerCase() === nome.toLowerCase())) no("Esiste già un tavolo " + nome);
    S.tavoli.push(nuovoTavolo("X" + uid(), nome, p.sala, num(p.posti, 0, 30) ?? 4));
  }],
  "imp.tavolo.elimina": ["admin", (S, p) => { const t = getT(S, p.tid); if (isBusy(t)) no("Il tavolo è occupato"); S.tavoli = S.tavoli.filter(x => x !== t); }],
  "imp.tavolo.modifica": ["admin", (S, p) => {
    const t = getT(S, p.tid); const ps = num(p.posti, 0, 30); if (ps != null) t.posti = Math.round(ps);
    if (p.nome != null) { const n = txt(p.nome, 12); if (!n) no("Il nome non può essere vuoto"); if (S.tavoli.some(x => x !== t && x.nome.toLowerCase() === n.toLowerCase())) no("Nome già usato"); t.nome = n; }
    if (p.acc != null) t.acc = !!p.acc;
  }],
  "imp.tavolo.pos": ["admin", (S, p) => {
    const t = getT(S, p.tid); if (t.consegna) no("Le consegne non stanno sulla mappa");
    const x = Number(p.x), y = Number(p.y); if (p.x === "" || p.y === "" || p.x == null || p.y == null || !isFinite(x) || !isFinite(y)) no("Posizione non valida");
    const lim = v => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10; t.x = lim(x); t.y = lim(y);
  }],
  "imp.tavolo.forma": ["admin", (S, p) => { const t = getT(S, p.tid); if (!["q", "t", "r"].includes(p.forma)) no("Forma non valida"); t.forma = p.forma; }],
  "imp.mappa.auto": ["admin", (S, p) => {
    if (!S.settings.sale.includes(p.sala)) no("Sala non trovata");
    const ts = S.tavoli.filter(t => t.sala === p.sala && !t.consegna).sort((a, b) => a.nome.localeCompare(b.nome, "it", { numeric: true }));
    posGriglia(ts).forEach((q, i) => { ts[i].x = q.x; ts[i].y = q.y; });
  }],
  "imp.staff.nuovo": ["admin", (S, p, u) => {
    const nome = txt(p.nome, 30); if (!nome) no("Scrivi il nome"); if (!RUOLI[p.ruolo]) no("Ruolo non valido"); if (!pinValido(p.pin)) no("Il PIN deve avere 4 cifre");
    if (S.staff.some(x => verificaPin(x, p.pin))) no("PIN già usato da un'altra persona");
    S.staff.push({ id: uid(), nome, ruolo: p.ruolo, ...hashPin(p.pin) }); log(S, u, `Nuova persona nello staff: ${nome} (${RUOLI[p.ruolo]})`);
  }],
  "imp.staff.modifica": ["admin", (S, p, u, out) => {
    const x = S.staff.find(s => s.id === p.id) || no("Persona non trovata");
    if (p.nome != null) x.nome = txt(p.nome, 30) || x.nome;
    if (p.ruolo != null) { if (!RUOLI[p.ruolo]) no("Ruolo non valido"); if (x.ruolo === "titolare" && p.ruolo !== "titolare" && S.staff.filter(s => s.ruolo === "titolare").length < 2) no("Serve almeno un titolare"); if (x.ruolo !== p.ruolo) out.revoca = x.id; x.ruolo = p.ruolo; }
    if (p.pin != null) { if (!pinValido(p.pin)) no("Il PIN deve avere 4 cifre"); if (S.staff.some(s => s !== x && verificaPin(s, p.pin))) no("PIN già usato da un'altra persona"); Object.assign(x, hashPin(p.pin)); out.revoca = x.id; log(S, u, `PIN cambiato per ${x.nome}`); }
    if (out.revoca === u.id) out.revoca = null;
  }],
  "imp.staff.elimina": ["admin", (S, p, u, out) => {
    const x = S.staff.find(s => s.id === p.id) || no("Persona non trovata"); if (x.id === u.id) no("Non puoi eliminare te stesso");
    if (x.ruolo === "titolare" && S.staff.filter(s => s.ruolo === "titolare").length < 2) no("Serve almeno un titolare");
    S.staff = S.staff.filter(s => s !== x); out.revoca = x.id; log(S, u, `Tolto dallo staff: ${x.nome}`);
  }],
  "imp.prenOnline": ["admin", (S, p, u) => {
    const w = String(p.whatsapp || "").replace(/[^\d+]/g, ""), orari = String(p.orari || "").replace(/\s+/g, "");
    if (w && w.replace(/\D/g, "").length < 8) no("Numero WhatsApp del locale non valido");
    if (orari && !/^(\d{2}:\d{2}-\d{2}:\d{2})(,\d{2}:\d{2}-\d{2}:\d{2})*$/.test(orari)) no("Orari non chiari: scrivi per esempio 12:30-14:30, 19:30-23:00");
    const chiuso = [...new Set((Array.isArray(p.chiuso) ? p.chiuso : []).map(Number).filter(d => d >= 0 && d <= 6))];
    S.settings.prenOnline = { whatsapp: w, orari: orari || "12:30-14:30,19:30-23:00", chiuso, max: Math.round(num(p.max, 1, 50) || 10), pagina: /^https?:\/\/\S+$/.test(p.pagina || "") ? p.pagina : "" };
    log(S, u, "Prenotazioni online aggiornate");
  }],
  "imp.rt": ["tecnico", (S, p, u) => {
    const modo = ["spento", "prova", "epson"].includes(p.modo) ? p.modo : no("Modalità non valida"), ip = txt(p.ip, 60);
    if (modo === "epson" && !/^[\w.\-]+(:\d{1,5})?$/.test(ip)) no("Scrivi l'indirizzo IP del registratore, es. 192.168.1.60");
    const reparto = Math.round(num(p.reparto, 1, 99) || 1);
    S.settings.rt = { modo, ip, reparto, auto: !!p.auto, piattaforma: !!p.piattaforma };
    log(S, u, `Registratore: ${{ spento: "spento", prova: "prova senza registratore", epson: "Epson " + ip }[modo]}`);
  }],
  "cat.rt": ["tecnico", (S, p) => { const c = S.categorie[p.i] || no("Categoria non trovata"); const r = p.rep === "" || p.rep == null ? null : Math.round(num(p.rep, 1, 99) || 0); if (r === 0) no("Reparto del registratore tra 1 e 99"); c.rt = r; }],
  "pren.online": ["pren", (S, p, u) => {
    const nome = txt(p.nome, 50), pers = num(p.persone, 1, 200);
    if (!nome || !/^\d{4}-\d{2}-\d{2}$/.test(p.data) || !/^\d{2}:\d{2}$/.test(p.ora) || !pers) no("Dal messaggio mancano nome, giorno, ora o persone");
    S.prenotazioni.push({ id: uid(), data: p.data, ora: p.ora, nome, tel: txt(p.tel, 30), persone: Math.round(pers), tavolo: "", note: txt(p.note, 160), stato: "attesa", da: u.nome, fonte: "online", acc: !!p.acc });
    log(S, u, `Prenotazione online ${nome}, ${pers} pers. ${p.data} ${p.ora}`);
  }],
  "imp.aggAuto": ["tecnico", (S, p, u) => { S.settings.aggAuto = S.settings.aggAuto === false; log(S, u, `Aggiornamenti automatici ${S.settings.aggAuto ? "attivati" : "spenti"}`); }],
  "imp.preset": ["tecnico", (S, p, u) => {
    if (S.tavoli.some(t => t.righe.length)) no("Chiudi prima i tavoli aperti");
    const k = ["bar", "pizzeria", "trattoria"].includes(p.modello) ? p.modello : no("Modello non valido");
    const pm = presetMenu(k); pm.menu.forEach(m => m.ing = m.ing.filter(([id]) => ING(S, id)));
    S.menu = pm.menu; S.categorie = pm.cat; log(S, u, "Caricato modello " + k);
  }],
  /* ----- Fatture (1.9) ----- */
  "imp.fisc": ["admin", (S, p, u, out) => {
    const d = p.fisc || {}, piva = String(d.piva || "").replace(/\s/g, "").replace(/^IT/i, ""), cf = String(d.cf || "").replace(/\s/g, "").toUpperCase();
    const f = { den: latino(d.den, 80), piva, cf, regime: REGIMI[d.regime] ? d.regime : "RF01", ind: latino(d.ind, 60), civ: latino(d.civ, 8), cap: String(d.cap || "").trim(), com: latino(d.com, 60), prov: String(d.prov || "").trim().toUpperCase(), naz: "IT",
      tel: txt(d.tel, 12), email: txt(d.email, 80), iban: String(d.iban || "").replace(/\s/g, "").toUpperCase(), reaUff: String(d.reaUff || "").trim().toUpperCase(), reaNum: latino(d.reaNum, 20), bolloCliente: !!d.bolloCliente, suffisso: latino(d.suffisso, 8) };
    if (!f.den) no("Scrivi la denominazione o ragione sociale"); if (!pivaOk(f.piva)) no("Partita IVA del locale non valida: controlla le 11 cifre");
    if (f.cf && !cfOk(f.cf)) no("Codice fiscale non valido"); if (!f.ind || !f.com) no("Servono indirizzo e comune della sede");
    if (!/^\d{5}$/.test(f.cap)) no("CAP non valido (5 cifre)"); if (!/^[A-Z]{2}$/.test(f.prov)) no("Provincia: scrivi la sigla, es. CT");
    if (f.email && !emailOk(f.email)) no("Email non valida"); if (f.iban && !/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(f.iban)) no("IBAN non valido");
    if ((f.reaUff || f.reaNum) && (!/^[A-Z]{2}$/.test(f.reaUff) || !f.reaNum)) no("REA: servono la sigla della provincia e il numero");
    if (f.suffisso && !/^[\/\-A-Za-z0-9]+$/.test(f.suffisso)) no("Il suffisso del numero può avere solo lettere, numeri, / e -");
    S.settings.fisc = f;
    if (p.prossimo != null && p.prossimo !== "") {
      const anno = dkey(Date.now()).slice(0, 4), n = num(p.prossimo, 1, 999999); if (n == null || n % 1) no("Numero della prossima fattura non valido");
      const max = Math.max(0, ...S.fatture.filter(x => x.anno === anno).map(x => x.num));
      if (n <= max) no(`In Tavolo c'è già la fattura n. ${max} del ${anno}: il prossimo numero deve essere almeno ${max + 1}`);
      S.contatori.fatt = S.contatori.fatt || {}; S.contatori.fatt[anno] = n - 1;
    }
    log(S, u, "Dati per le fatture aggiornati"); out.msg = "Dati per le fatture salvati";
  }],
  "fatt.crea": ["cassa", (S, p, u, out) => {
    const cli = leggiCliente(p.cli);
    const righe = (Array.isArray(p.righe) ? p.righe : []).slice(0, 200).map(r => {
      const q = num(String(r.q).replace(",", "."), 0.01, 10000), prezzo = num(String(r.prezzo).replace(",", "."), -100000, 100000), aliq = +r.aliq;
      const desc = latino(r.desc, 200);
      if (!desc) no("Ogni riga vuole una descrizione"); if (q == null) no(`Quantità non valida per "${desc}"`); if (prezzo == null || prezzo === 0) no(`Prezzo non valido per "${desc}"`);
      if (!forfettario(S) && !ALIQUOTE.includes(aliq)) no(`Aliquota IVA non valida per "${desc}"`);
      return { desc, q: Math.round(q * 100) / 100, prezzo: round2(prezzo), aliq: forfettario(S) ? 0 : aliq };
    });
    if (!righe.length) no("La fattura è vuota");
    if (round2(righe.reduce((s, r) => s + r.prezzo * r.q, 0)) <= 0) no("Il totale della fattura deve essere maggiore di zero");
    const v = p.vid ? S.vendite.find(x => x.id === p.vid) : null;
    if (p.vid && v && v.fatt) no(`Questo conto ha già la fattura n. ${v.fatt}`);
    const x = nuovaFattura(S, u, { cli, righe, data: p.data, metodo: v ? v.metodo : (PAG_FATT[p.metodo] ? p.metodo : ""), docComm: latino(p.docComm, 80), nota: latino(p.nota, 200), vid: v ? v.id : "" });
    if (v) v.fatt = x.numero;
    // rubrica: per ritrovare l'intestatario la prossima volta
    const chiave = cli.piva || cli.cf; S.intestatari = S.intestatari.filter(y => (y.piva || y.cf) !== chiave);
    S.intestatari.unshift(Object.assign({ ultima: Date.now() }, cli)); S.intestatari.length = Math.min(S.intestatari.length, 500);
    log(S, u, `Fattura n. ${x.numero} a ${nomeCliente(cli)}: ${eur(x.totale)}`);
    out.nuovoId = x.id; out.msg = `Fattura n. ${x.numero} creata: scarica il file XML e caricalo sul portale Fatture e Corrispettivi`;
  }],
  "fatt.nc": ["cassa", (S, p, u, out) => {
    const o = S.fatture.find(x => x.id === p.id) || no("Fattura non trovata");
    if (o.tipo !== "TD01") no("La nota di credito si fa solo su una fattura"); if (o.nc) no(`Questa fattura ha già la nota di credito n. ${o.nc}`);
    const x = nuovaFattura(S, u, { tipo: "TD04", cli: o.cli, righe: o.righe, data: p.data, metodo: "", nota: latino(p.nota || `Storno totale della fattura n. ${o.numero} del ${o.data.split("-").reverse().join("/")}`, 200), rif: { numero: o.numero, data: o.data } });
    o.nc = x.numero; log(S, u, `Nota di credito n. ${x.numero} sulla fattura n. ${o.numero}`);
    out.nuovoId = x.id; out.msg = `Nota di credito n. ${x.numero} creata`;
  }],
  "fatt.stato": ["cassa", (S, p, u) => {
    const x = S.fatture.find(y => y.id === p.id) || no("Fattura non trovata");
    x.stato = x.stato === "inviata" ? "da_inviare" : "inviata"; x.inviata = x.stato === "inviata" ? Date.now() : null;
    log(S, u, `Fattura n. ${x.numero} segnata come ${x.stato === "inviata" ? "inviata" : "da inviare"}`);
  }],
  "fatt.elimina": ["cassa", (S, p, u, out) => {
    const x = S.fatture.find(y => y.id === p.id) || no("Fattura non trovata");
    if (x.stato === "inviata") no("Fattura già inviata: per annullarla serve una nota di credito");
    const ultima = S.fatture.filter(y => y.anno === x.anno).sort((a, b) => b.num - a.num)[0];
    if (ultima !== x) no("Si può cancellare solo l'ultima fattura dell'anno, per non lasciare buchi nella numerazione. Per le altre fai una nota di credito");
    S.fatture = S.fatture.filter(y => y !== x); if (S.contatori.fatt && S.contatori.fatt[x.anno] === x.num) S.contatori.fatt[x.anno] = x.num - 1;
    if (x.vid) { const v = S.vendite.find(y => y.id === x.vid); if (v && v.fatt === x.numero) delete v.fatt; }
    if (x.rif) { const o = S.fatture.find(y => y.numero === x.rif.numero && y.data === x.rif.data); if (o && o.nc === x.numero) delete o.nc; }
    log(S, u, `${x.tipo === "TD04" ? "Nota di credito" : "Fattura"} n. ${x.numero} cancellata prima dell'invio`); out.msg = "Cancellata";
  }],
  "fatt.rubricaTogli": ["cassa", (S, p) => { S.intestatari = S.intestatari.filter(y => (y.piva || y.cf) !== p.k); }],

  /* ----- HACCP (1.9) ----- */
  "haccp.conf": ["admin", (S, p, u) => {
    const c = S.haccp.conf, d = p.conf || {};
    c.resp = txt(d.resp, 60); c.controlli = +d.controlli === 1 ? 1 : 2;
    const o = (Array.isArray(d.orari) ? d.orari : []).map(oraOk); if (o.some(x => !x)) no("Orari dei controlli non validi"); if (o.length) c.orari = o;
    c.acqua = d.acqua === "pozzo" ? "pozzo" : "rete"; c.infestDitta = txt(d.infestDitta, 80); c.infestFreq = FREQ[d.infestFreq] ? d.infestFreq : "mese";
    c.crudi = !!d.crudi; c.note = txt(d.note, 600); log(S, u, "Impostazioni HACCP aggiornate");
  }],
  "haccp.rev": ["admin", (S, p, u) => { const c = S.haccp.conf; c.rev = (c.rev || 0) + (c.revData ? 1 : 0); c.revData = dkey(Date.now()); log(S, u, `Piano HACCP: revisione ${c.rev} del ${c.revData}`); }],
  "haccp.attr.salva": ["admin", (S, p, u) => {
    const d = p.attr || {}, nome = txt(d.nome, 40) || no("Dai un nome all'attrezzatura"), tipo = TIPI_ATTR[d.tipo] ? d.tipo : "frigo";
    const min = tempNum(d.min), max = tempNum(d.max); if (min == null || max == null) no("Scrivi la temperatura minima e massima"); if (min >= max) no("La minima deve essere più bassa della massima");
    if (d.id) { const a = S.haccp.attr.find(x => x.id === d.id) || no("Attrezzatura non trovata"); Object.assign(a, { nome, tipo, min, max }); }
    else { if (S.haccp.attr.filter(x => x.attiva !== false).length >= 30) no("Al massimo 30 attrezzature"); S.haccp.attr.push({ id: uid(), nome, tipo, min, max, attiva: true }); }
    log(S, u, `HACCP: ${nome} da ${min} a ${max} °C`);
  }],
  // le attrezzature tolte restano nei registri passati, non compaiono più nei controlli
  "haccp.attr.togli": ["admin", (S, p, u) => { const a = S.haccp.attr.find(x => x.id === p.id) || no("Attrezzatura non trovata"); a.attiva = false; log(S, u, `HACCP: tolta l'attrezzatura ${a.nome}`); }],
  "haccp.pul.salva": ["admin", (S, p) => {
    const d = p.pul || {}, area = txt(d.area, 60) || no("Scrivi cosa si pulisce"), freq = FREQ[d.freq] ? d.freq : "giorno", prodotto = txt(d.prodotto, 60);
    if (d.id) Object.assign(S.haccp.pul.find(x => x.id === d.id) || no("Voce non trovata"), { area, freq, prodotto }); else S.haccp.pul.push({ id: uid(), area, freq, prodotto });
  }],
  "haccp.pul.togli": ["admin", (S, p) => { S.haccp.pul = S.haccp.pul.filter(x => x.id !== p.id); }],
  "haccp.form.salva": ["admin", (S, p) => {
    const d = p.form || {}, nome = txt(d.nome, 50) || no("Scrivi il nome della persona");
    const data = d.data ? dataOk(d.data) || no("Data dell'attestato non valida") : "", scadenza = d.scadenza ? dataOk(d.scadenza) || no("Data di scadenza non valida") : "";
    const x = { nome, mansione: txt(d.mansione, 40), data, scadenza, ente: txt(d.ente, 60) };
    if (d.id) Object.assign(S.haccp.form.find(y => y.id === d.id) || no("Persona non trovata"), x); else S.haccp.form.push(Object.assign({ id: uid() }, x));
  }],
  "haccp.form.togli": ["admin", (S, p) => { S.haccp.form = S.haccp.form.filter(x => x.id !== p.id); }],
  "haccp.temp": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const a = S.haccp.attr.find(x => x.id === p.a && x.attiva !== false) || no("Scegli l'attrezzatura"), v = tempNum(p.v);
    if (v == null) no("Scrivi la temperatura letta sul termometro, es. 3 oppure -19");
    const ok = v >= a.min && v <= a.max, n = txt(p.n, 200);
    if (!ok && !n) no(`${v} °C è fuori dai limiti (${a.min} / ${a.max} °C): scrivi cosa hai fatto`);
    registra(S, u, "temp", { a: a.id, an: a.nome, v, min: a.min, max: a.max, o: ok, f: fasciaDi(S, Date.now()), n });
    if (!ok) log(S, u, `HACCP: ${a.nome} a ${v} °C, fuori limite. ${n}`);
    out.msg = ok ? `${a.nome}: ${String(v).replace(".", ",")} °C registrati` : `${a.nome}: non conformità registrata`;
  }],
  "haccp.merce": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const forn = txt(p.forn, 60) || no("Scrivi il fornitore"), prod = txt(p.prod, 80) || no("Scrivi il prodotto");
    const t = p.temp === "" || p.temp == null ? null : tempNum(p.temp); if (p.temp !== "" && p.temp != null && t == null) no("Temperatura non valida");
    const ok = p.conf !== false && p.conf !== "no", n = txt(p.n, 200); if (!ok && !n) no("Merce non conforme: scrivi cosa hai fatto (es. respinta al fornitore)");
    registra(S, u, "merce", { forn, prod, lotto: txt(p.lotto, 40), scad: p.scad ? dataOk(p.scad) || "" : "", temp: t, o: ok, n });
    out.msg = ok ? "Merce registrata" : "Merce non conforme registrata";
  }],
  "haccp.pulizia": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const x = S.haccp.pul.find(y => y.id === p.p) || no("Voce del piano non trovata");
    registra(S, u, "pulizia", { p: x.id, pn: x.area, o: true, n: txt(p.n, 120) }); out.msg = `${x.area}: fatto`;
  }],
  "haccp.abbatt": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const prod = txt(p.prod, 80) || no("Scrivi il prodotto"), tipo = p.tipo === "surg" ? "surg" : "refr";
    const t0 = tempNum(p.t0), t1 = tempNum(p.t1), min = num(p.min, 1, 1440);
    if (t0 == null || t1 == null) no("Scrivi la temperatura al cuore all'inizio e alla fine"); if (min == null) no("Scrivi quanti minuti è durato");
    const ok = tipo === "refr" ? t1 <= 3 && min <= 90 : t1 <= -18 && min <= 240, n = txt(p.n, 200);
    if (!ok && !n) no(tipo === "refr" ? "Serve +3 °C al cuore entro 90 minuti: scrivi cosa hai fatto" : "Serve -18 °C al cuore entro 4 ore: scrivi cosa hai fatto");
    registra(S, u, "abbatt", { prod, tipo, t0, t1, min: Math.round(min), o: ok, n }); out.msg = ok ? "Abbattimento registrato" : "Non conformità registrata";
  }],
  "haccp.olio": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const fr = txt(p.fr, 40) || "Friggitrice", az = p.az === "cambio" ? "cambio" : "controllo";
    const v = p.v === "" || p.v == null ? null : num(String(p.v).replace(",", "."), 0, 60); if (p.v !== "" && p.v != null && v == null) no("Valore dei composti polari non valido (0-60%)");
    const ok = az === "cambio" || v == null || v <= 25, n = txt(p.n, 200); if (!ok && !n) no("Oltre il 25% di composti polari l'olio va cambiato: scrivi cosa hai fatto");
    registra(S, u, "olio", { fr, az, v, o: ok, n }); out.msg = az === "cambio" ? "Cambio olio registrato" : ok ? "Controllo olio registrato" : "Non conformità registrata";
  }],
  "haccp.infest": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const ok = p.ok !== false, n = txt(p.n, 200); if (!ok && !n) no("Scrivi cosa hai trovato e cosa hai fatto");
    registra(S, u, "infest", { o: ok, n, ditta: !!p.ditta }); out.msg = "Controllo infestanti registrato";
  }],
  "haccp.nc": ["tutti", (S, p, u, out) => {
    if (!S.settings.moduli.haccp) no("Il modulo HACCP è spento");
    const n = txt(p.n, 300) || no("Descrivi il problema e cosa hai fatto");
    registra(S, u, "nc", { o: false, n }); log(S, u, "HACCP: non conformità " + n.slice(0, 80)); out.msg = "Non conformità registrata";
  }],
  "haccp.annulla": ["admin", (S, p, u) => {
    const r = S.haccpReg.find(x => x.id === p.id) || no("Registrazione non trovata"); if (r.x) no("Già annullata");
    const m = txt(p.motivo, 120) || no("Scrivi perché la annulli (es. valore scritto sbagliato)");
    r.x = { chi: u.nome, t: Date.now(), m }; log(S, u, `HACCP: annullata una registrazione (${m})`);
  }],
  /* ----- Menu da stampare (1.9) ----- */
  "imp.menuStampa": ["admin", (S, p) => {
    const d = p.conf || {};
    const cats = new Set(S.categorie.map(c => c.nome)), ids = new Set(S.menu.map(m => m.id));
    S.settings.menuStampa = {
      titolo: txt(d.titolo, 60), sotto: txt(d.sotto, 120), testoSu: txt(d.testoSu, 300), testoGiu: txt(d.testoGiu, 400),
      stile: ["classico", "moderno", "trattoria"].includes(d.stile) ? d.stile : "classico", formato: ["A4", "A5", "A4x2"].includes(d.formato) ? d.formato : "A4",
      colonne: [1, 2].includes(+d.colonne) ? +d.colonne : 1, lingua: ["it", ...Object.keys(LINGUE)].includes(d.lingua) ? d.lingua : "it", bi: !!d.bi,
      desc: d.desc !== false, all: d.all !== false, prezzi: d.prezzi !== false, coperto: d.coperto !== false, esauriti: !!d.esauriti, unaPagina: d.unaPagina !== false,
      escluse: (Array.isArray(d.escluse) ? d.escluse : []).filter(c => cats.has(c)).slice(0, 100), nascosti: (Array.isArray(d.nascosti) ? d.nascosti : []).filter(id => ids.has(id)).slice(0, 1000)
    };
  }],
  "imp.stampanti": ["tecnico", (S, p, u) => {
    const st = {}; ["Cucina", "Pizzeria", "Bar", "Sala"].forEach(k => { const v = txt((p.stampanti || {})[k], 60); if (v && !/^[\w.\-]+(:\d{1,5})?$/.test(v)) no(`Indirizzo della stampante ${k} non valido (es. 192.168.1.50 o 192.168.1.50:9100)`); st[k] = v; });
    S.settings.stampanti = st; S.settings.stampaAuto = !!p.auto; const c = parseInt(p.colonne, 10); if ([32, 42, 48].includes(c)) S.settings.colonne = c;
    log(S, u, "Stampanti aggiornate");
  }]
};

function applica(S, a, u, ctx) {
  ctx = ctx || {};
  const out = { stampe: [], msg: null };
  const def = AZIONI[a && a.type];
  if (!def) return { errore: "Azione sconosciuta" };
  if (def[0] === "tecnico") { if (!u.tecnico && !ctx.tecnicoLibero) return { errore: "Questa impostazione la cambia l'assistenza Tavolo: contatta Alberto" }; }
  else if (!ACCESSO[def[0]].includes(u.ruolo)) return { errore: "Il tuo ruolo non può farlo" };
  if (ctx.bloccata && BLOCCATE_SE_SCADUTA.includes(a.type)) return { errore: ctx.sospesa ? "Servizio sospeso: contatta l'assistenza" : "Licenza scaduta: contatta l'assistenza per rinnovarla" };
  normalizza(S);
  try { def[1](S, a.payload || {}, u, out, ctx); } catch (e) { if (e instanceof Errore) return { errore: e.message }; throw e; }
  normalizza(S);
  return out;
}

/* Stato senza dati riservati, per i tablet */
// posizioni a griglia per la mappa della sala (in percentuale, centro del tavolo)
function posGriglia(ts) {
  const n = ts.length, col = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(n * 1.6)))), righe = Math.max(1, Math.ceil(n / col));
  return ts.map((_, i) => ({ x: Math.round((100 / col) * ((i % col) + 0.5) * 10) / 10, y: Math.round((100 / righe) * (Math.floor(i / col) + 0.5) * 10) / 10 }));
}

function statoPubblico(S) {
  const c = Object.assign({}, S);
  c.staff = S.staff.map(({ id, nome, ruolo }) => ({ id, nome, ruolo }));
  delete c.licenza; delete c.sblocco; delete c.trChiave; delete c.aiChiave; delete c.tecnico; delete c.sbloccoTec;
  return c;
}

function validaBackup(o) {
  return o && typeof o === "object" && o.settings && Array.isArray(o.menu) && Array.isArray(o.tavoli) && Array.isArray(o.staff) && Array.isArray(o.categorie)
    && o.staff.some(s => s.ruolo === "titolare" && s.pinHash);
}

module.exports = { haccpMancanti, formazioneInScadenza, TIPI_ATTR, FREQ, AZIONI_CORR, pivaOk, cfOk, calcolaFattura, righeDaVendita, xmlFattura, nomeFileFattura, nomeCliente, fiscCompleti, REGIMI, ALIQUOTE, FORFETTARI, SOGLIA_BOLLO, latino, normalizza, testoRiepilogo, telNorm, puntiConf, LINGUE, posGriglia, piattaforme, PIATTAFORME_BASE, giorno, ORA_CAMBIO_GIORNO, prezzoRiga, REPARTI, RUOLI, METODI, ALLERGENI, ALLERGENI_EN, AZIONI, ACCESSO, applica, creaStato, presetMenu, statoPubblico, verificaPin, hashPin, validaBackup, testoComanda, testoPreconto, testoAvviso, dkey, eur, round2, uid };

})(require, module, Buffer);
  var L = module.exports;

  /* ---- stato salvato sul dispositivo ---- */
  var mem = null;
  function leggi() { try { var t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; } catch (e) { return mem; } }
  function scrivi(o) { mem = o; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function nuovo() {
    var S = L.normalizza(L.creaStato({ demo: true, pin: "1111" }));
    ["qr", "clienti", "turni", "attesa", "haccp"].forEach(function (k) { if (S.settings.moduli && k in S.settings.moduli) S.settings.moduli[k] = true; else if (S.settings.moduli) S.settings.moduli[k] = true; });
    L.normalizza(S);
    // dati fiscali d'esempio (inventati), così nella demo si possono provare le fatture
    if (!S.settings.fisc) S.settings.fisc = { den: "Trattoria Da Melo (esempio)", piva: "01234567897", cf: "", regime: "RF01", ind: "Via Etnea", civ: "1", cap: "95100", com: "Catania", prov: "CT", naz: "IT", tel: "", email: "", iban: "", reaUff: "", reaNum: "", bolloCliente: false, suffisso: "" };
    if (S.haccp && S.haccp.conf && !S.haccp.conf.resp) S.haccp.conf.resp = "Melo (titolare)";
    return { creato: Date.now(), S: S, sessioni: {}, mesi: [] };
  }
  var D = leggi();
  if (!D || !D.S || Date.now() - D.creato > DURATA) { D = nuovo(); scrivi(D); }
  var salva = function () { scrivi(D); };

  /* ---- licenza di prova: tutte le funzioni attive ---- */
  function lic() {
    var scad = D.creato + DURATA;
    return { tipo: "licenza", stato: "valida", scadenza: L.dkey(Date.now() + 365 * 864e5), giorni: 365, intestatario: "Demo", piano: "pro", assistenza: ASS, bloccata: false };
  }
  function base() { var u = location.href.split("#")[0].split("?")[0]; return u.slice(0, u.lastIndexOf("/")); }

  /* ---- collegamenti in tempo reale (al posto di EventSource) ---- */
  var clienti = new Set();
  function utente(t) { var s = t && D.sessioni[t]; return s ? D.S.staff.find(function (x) { return x.id === s.sid; }) : null; }
  function inviaStato(c) {
    var u = utente(c.t); if (!u) { c.emit("esci", {}); return; }
    var dati = Object.assign(L.statoPubblico(D.S), { io: u.id, meta: { versione: VERSIONE, origine: "demo", licenza: lic(), ora: Date.now(), giorno: L.giorno(Date.now()),
      aggiornamento: { configurato: false, auto: true }, traduzione: { servizio: "mymemory", chiave: false }, ai: { chiave: false, usate: 0, modelloPredefinito: "" },
      paginaPrenota: "", copiaEsterna: { docker: false, cartella: "", ora: null, file: null, errore: null } } });
    if (u.ruolo === "cucina") dati.clienti = [];
    { var limH = L.dkey(Date.now() - 10 * 864e5); dati.haccpReg = (D.S.haccpReg || []).filter(function (r) { return r.g >= limH; }); }
    if (["titolare", "cassa"].indexOf(u.ruolo) < 0) { dati.fatture = []; dati.intestatari = []; }
    else { dati.fatture = (D.S.fatture || []).map(function (f) { var c = Object.assign({}, f); delete c.ced; return c; }); dati.fattureTot = dati.fatture.length; dati.intestatari = D.S.intestatari || []; }
    if (u.ruolo !== "titolare") dati.presenze = (dati.presenze || []).filter(function (x) { return x.sid === u.id; });
    c.emit("stato", dati);
  }
  var diffondi = function () { clienti.forEach(inviaStato); };
  var avvisa = function (msg) { clienti.forEach(function (c) { c.emit("avviso", { msg: msg }); }); };
  function FintoES(url) {
    var self = this; this.readyState = 0; this.l = {};
    try { this.t = new URL(url, location.href).searchParams.get("t"); } catch (e) { this.t = null; }
    clienti.add(this);
    setTimeout(function () { if (self.readyState === 2) return; self.readyState = 1; if (self.onopen) self.onopen(); inviaStato(self); }, 40);
  }
  FintoES.prototype.addEventListener = function (n, f) { (this.l[n] = this.l[n] || []).push(f); };
  FintoES.prototype.emit = function (n, d) { var ev = { data: JSON.stringify(d) }; (this.l[n] || []).forEach(function (f) { try { f(ev); } catch (e) { console.error(e); } }); };
  FintoES.prototype.close = function () { this.readyState = 2; clienti.delete(this); };
  window.EventSource = FintoES;

  // un'altra scheda (ad esempio il menu del cliente) ha cambiato i dati
  window.addEventListener("storage", function (e) { if (e.key === KEY && e.newValue) { try { D = JSON.parse(e.newValue); diffondi(); } catch (_) {} } });

  /* ---- le risposte del "computer del locale" ---- */
  var json = function (st, b) { return new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } }); };
  var NONDEMO = "Nella demo questa funzione non è attiva: nel locale funziona con il computer di Tavolo";
  var qrLim = {};
  async function api(p, url, opt) {
    var metodo = (opt.method || "GET").toUpperCase();
    var corpo = {}; if (opt.body) { try { corpo = JSON.parse(opt.body); } catch (e) { corpo = {}; } }
    var h = opt.headers || {}; var auth = (h.Authorization || h.authorization || "").replace(/^Bearer /, "");
    var token = auth || url.searchParams.get("t");
    var S = D.S;

    if (p === "/api/info") return json(200, { configurato: true, demo: true, versione: VERSIONE, nome: S.settings.nome, accent: S.settings.accent, indirizzi: [base()], licenza: lic(), assistenza: ASS });
    if (p === "/api/staff") return json(200, S.staff.map(function (x) { return { id: x.id, nome: x.nome, ruolo: x.ruolo }; }));
    if (p === "/api/setup") return json(409, { errore: "Il locale è già configurato" });
    if (p === "/api/login") {
      var u0 = S.staff.find(function (x) { return x.id === corpo.id; });
      if (!u0 || !L.verificaPin(u0, corpo.pin)) return json(401, { errore: "PIN sbagliato" });
      var t = randomBytes(24).toString("base64url"); D.sessioni[t] = { sid: u0.id, creato: Date.now() };
      S.log.unshift({ ora: Date.now(), chi: u0.nome, txt: "Accesso" }); salva();
      return json(200, { token: t, utente: { id: u0.id, nome: u0.nome, ruolo: u0.ruolo } });
    }
    if (p === "/api/sblocco/richiesta") return url.searchParams.get("id") ? json(400, { errore: "Nella demo i PIN sono 1111, 2222, 3333 e 4444" }) : json(200, { attiva: false });
    if (p === "/api/sblocco") return json(400, { errore: NONDEMO });

    if (p.indexOf("/api/qr/") === 0) {
      var q = metodo === "POST" ? corpo : Object.fromEntries(url.searchParams);
      var tq = S.tavoli.find(function (x) { return x.id === String(q.t || "") && !x.consegna; });
      if (!S.settings.moduli.qr) return json(403, { errore: "chiuso" });
      if (!tq || !tq.qrk || String(q.k || "") !== tq.qrk) return json(404, { errore: "codice" });
      if (p === "/api/qr/menu") {
        var disp = function (it) { return it.disp && (!S.settings.moduli.magazzino || it.ing.every(function (z) { var g = S.ing.find(function (x) { return x.id === z[0]; }); return !g || g.qta >= z[1]; })); };
        var cats = S.categorie.filter(function (c) { return S.menu.some(function (m) { return m.cat === c.nome && disp(m); }); });
        return json(200, { locale: { nome: S.settings.nome, citta: S.settings.citta, accent: S.settings.accent, coperto: S.settings.coperto, recensione: S.settings.recensione || "" }, tavolo: tq.nome, aperto: true,
          categorie: cats.map(function (c) { return { nome: c.nome, tr: c.tr || (c.en ? { en: c.en } : {}) }; }),
          menu: S.menu.filter(disp).map(function (m) { return { id: m.id, nome: m.nome, prezzo: m.prezzo, cat: m.cat, all: m.all || [], tr: m.tr || (m.en ? { en: m.en } : {}) }; }),
          richieste: S.richiesteQr.filter(function (r) { return r.tav === tq.id && Date.now() - r.ora < 4 * 3600e3; }).map(function (r) { return { id: r.id, tipo: r.tipo, motivo: r.motivo, stato: r.stato, ora: r.ora, n: (r.righe || []).reduce(function (s2, x) { return s2 + x.q; }, 0) }; }) });
      }
      var lim = qrLim[tq.id] = (qrLim[tq.id] || []).filter(function (x) { return Date.now() - x < 600e3; });
      if (lim.length >= 10) return json(429, { errore: "troppe" }); lim.push(Date.now());
      var nomeT = /^\d+$/.test(tq.nome) ? "Tavolo " + tq.nome : tq.nome;
      if (p === "/api/qr/ordine") {
        var righe = (Array.isArray(q.righe) ? q.righe : []).slice(0, 40).map(function (x) { var m = S.menu.find(function (y) { return y.id === x.mid; }); return m && m.disp ? { mid: m.id, nome: m.nome, q: Math.max(1, Math.min(20, parseInt(x.q, 10) || 1)), nota: String(x.nota || "").trim().slice(0, 100) } : null; }).filter(Boolean);
        if (!righe.length) return json(400, { errore: "vuoto" });
        if (S.richiesteQr.filter(function (r) { return r.tav === tq.id && r.tipo === "ordine" && r.stato === "attesa"; }).length >= 3) return json(429, { errore: "attesa" });
        var r = { id: randomBytes(6).toString("hex"), tav: tq.id, tavNome: tq.nome, tipo: "ordine", righe: righe, nota: String(q.nota || "").trim().slice(0, 120), lingua: /^(it|en|fr|de|es)$/.test(q.lingua) ? q.lingua : "it", ora: Date.now(), stato: "attesa" };
        S.richiesteQr.push(r); L.normalizza(S); salva(); diffondi(); avvisa("Nuovo ordine dal QR: " + nomeT);
        return json(200, { ok: true, id: r.id });
      }
      if (p === "/api/qr/chiama") {
        var motivo = q.motivo === "conto" ? "conto" : "cameriere";
        if (!S.richiesteQr.some(function (r) { return r.tav === tq.id && r.tipo === "chiamata" && r.motivo === motivo && r.stato === "attesa"; })) {
          S.richiesteQr.push({ id: randomBytes(6).toString("hex"), tav: tq.id, tavNome: tq.nome, tipo: "chiamata", motivo: motivo, ora: Date.now(), stato: "attesa" });
          L.normalizza(S); salva(); diffondi(); avvisa(nomeT + ": " + (motivo === "conto" ? "chiede il conto" : "chiama il cameriere"));
        }
        return json(200, { ok: true });
      }
      return json(404, { errore: "Non trovato" });
    }

    var u = utente(token);
    if (!u) return json(401, { errore: "Accesso scaduto: entra di nuovo con il tuo PIN" });

    if (p === "/api/io") return json(200, { id: u.id, nome: u.nome, ruolo: u.ruolo });
    if (p === "/api/diagnostica") return json(200, { versione: VERSIONE, locale: S.settings.nome, citta: S.settings.citta, utente: u.nome + " (" + L.RUOLI[u.ruolo] + ")", licenza: "demo · piano pro", sistema: "Demo nel browser", ora: new Date().toLocaleString("it-IT"), ultimiErrori: [] });
    if (p === "/api/logout") { delete D.sessioni[token]; salva(); return json(200, { ok: true }); }
    if (p === "/api/traduci") return json(502, { errore: "Nella demo la traduzione automatica è spenta. Nel locale Tavolo traduce il menu da solo in inglese, francese, tedesco e spagnolo" });
    if (p === "/api/ai") return json(200, { risposta: "Questa è la demo: l'assistente AI non è collegato. Nel locale risponde alle domande sul programma e, per titolare e cassa, sui numeri del locale (incassi, piatti più venduti, scorte), usando solo dati riassunti.", rimaste: 60 });

    if (p === "/api/azione") {
      var bozza = structuredClone(S);
      var r2;
      try { r2 = L.applica(bozza, corpo, u, { bloccata: false, sospesa: false, piano: "pro", tecnicoLibero: true }); } catch (e) { return json(400, { errore: e.message }); }
      if (r2.errore) return json(400, { errore: r2.errore });
      D.S = bozza;
      if (r2.archivio) { var mese = L.giorno(Date.now()).slice(0, 7); if (D.mesi.indexOf(mese) < 0) D.mesi.unshift(mese); }
      if (r2.revoca) Object.keys(D.sessioni).forEach(function (k) { if (D.sessioni[k].sid === r2.revoca) delete D.sessioni[k]; });
      if (r2.stampe && r2.stampe.length) setTimeout(function () { avvisa("Demo: la comanda andrebbe in stampa su " + r2.stampe.map(function (s) { return s.dest; }).join(", ")); }, 300);
      salva(); diffondi();
      return json(200, { ok: true, msg: r2.msg, nuovoId: r2.nuovoId, riepilogo: r2.riepilogo });
    }
    var cassa = u && ["titolare", "cassa"].indexOf(u.ruolo) >= 0;
    if (p === "/api/haccp") {
      var mese = url.searchParams.get("mese") || ""; if (!/^\d{4}-\d{2}$/.test(mese)) return json(400, { errore: "Mese non valido" });
      return json(200, { mese: mese, registro: (S.haccpReg || []).filter(function (r) { return r.g.indexOf(mese) === 0; }) });
    }
    if (p === "/api/fatture") {
      if (!cassa) return json(403, { errore: "Solo cassa e titolare" });
      var anno = url.searchParams.get("anno") || "", anni = [];
      (S.fatture || []).forEach(function (f) { if (anni.indexOf(f.anno) < 0) anni.push(f.anno); }); anni.sort().reverse();
      return json(200, { anni: anni, fatture: (S.fatture || []).filter(function (f) { return f.anno === anno; }).map(function (f) { var c = Object.assign({}, f); delete c.ced; delete c.righe; delete c.linee; return c; }) });
    }
    if (p === "/api/fattura") {
      if (!cassa) return json(403, { errore: "Solo cassa e titolare" });
      var fx = (S.fatture || []).find(function (f) { return f.id === url.searchParams.get("id"); });
      return fx ? json(200, fx) : json(404, { errore: "Fattura non trovata" });
    }
    if (p === "/api/riepilogo") return json(200, { testo: L.testoRiepilogo(S, S.vendite, L.giorno(Date.now())) });
    if (p === "/api/rt/invia") {
      var v = S.vendite.find(function (x) { return x.id === corpo.vid; });
      if (!v) return json(400, { errore: "Conto non trovato: forse la giornata è già stata chiusa" });
      v.rt = { stato: "ok", ora: Date.now(), numero: corpo.manuale ? "" : "DEMO-" + Math.floor(Math.random() * 9000 + 1000), manuale: !!corpo.manuale };
      salva(); diffondi(); return json(200, { ok: true, msg: corpo.manuale ? "Segnato come emesso" : "Demo: scontrino simulato (nel locale lo stampa il registratore Epson)" });
    }
    if (p === "/api/mesi") return json(200, D.mesi || []);
    if (p === "/api/stampa-prova" || p === "/api/rt/prova") return json(200, { ok: true, msg: "Demo: nel locale qui parte una stampa di prova" });
    if (p === "/api/aggiornamento") return json(200, { disponibile: null });
    if (p === "/api/azzera") { D = nuovo(); salva(); clienti.forEach(function (c) { c.emit("esci", {}); }); return json(200, { ok: true }); }
    return json(400, { errore: NONDEMO });
  }

  var fetchVero = window.fetch.bind(window);
  window.fetch = function (input, opt) {
    var url; try { url = new URL(typeof input === "string" ? input : input.url, location.href); } catch (e) { return fetchVero(input, opt); }
    var i = url.pathname.indexOf("/api/");
    if (i < 0 || url.origin !== location.origin) return fetchVero(input, opt);
    return new Promise(function (ok) { setTimeout(function () { api(url.pathname.slice(i), url, opt || {}).then(ok, function (e) { ok(json(500, { errore: e.message })); }); }, 60); });
  };

  // link di download (backup, CSV): nella demo non scaricano nulla
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href*='/api/']");
    if (a) { e.preventDefault(); avvisa("Nella demo i download sono spenti: nel locale qui scarichi il file per il commercialista o il backup"); }
  }, true);

  window.TavoloDemo = {
    ricomincia: function () { D = nuovo(); salva(); try { localStorage.removeItem("tavolo-token"); } catch (e) {} location.reload(); },
    linkQr: function () { var t = D.S.tavoli.find(function (x) { return x.id === "T1"; }) || D.S.tavoli.find(function (x) { return !x.consegna; }); return t ? "ordina.html?t=" + encodeURIComponent(t.id) + "&k=" + t.qrk : ""; },
    fetch: window.fetch
  };
})();
