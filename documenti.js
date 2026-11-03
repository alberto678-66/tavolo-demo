/* Tavolo — riempie le pagine Privacy, Cookie, Condizioni di licenza e Accordo dati
   con i dati del locale (Impostazioni → Dati fiscali) e dell'assistenza (dalla licenza).
   Sul computer del locale li chiede a /api/documenti; sulla pagina Prenota pubblicata su GitHub li legge da Firebase. */
(function () {
  "use strict";
  const TAVOLO_FB=/*FIREBASE*/null/*FINE*/;
  const q = new URLSearchParams(location.search);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PRED = { nome: "Alberto Malic", tel: "349 699 1941", email: "malicalberto604@gmail.com" };
  function riempi(d) {
    d = d || {};
    const loc = d.locale || {}, f = Object.assign({}, PRED, d.fornitore || {});
    const sede = loc.sede || [loc.ind, loc.cap, loc.com, loc.prov ? "(" + loc.prov + ")" : ""].filter(Boolean).join(" ");
    const val = {
      locale: loc.nome || q.get("n") || "", den: loc.den || "", piva: loc.piva || "", sede, email: loc.email || "",
      fornitore: String(f.nome || "").replace(/\s*·.*$/, ""), ftel: f.tel || "", femail: f.email || "",
      account: d.account ? String(d.account) : "", piano: d.piano || ""
    };
    document.querySelectorAll("[data-k]").forEach(el => {
      const v = val[el.dataset.k];
      el.innerHTML = v ? esc(v) : `<span class="manca">${esc(el.dataset.vuoto || "[da completare]")}</span>`;
    });
    document.querySelectorAll("[data-mail]").forEach(el => { const v = val[el.dataset.mail]; if (v) el.href = "mailto:" + v; });
  }
  async function carica() {
    const l = (q.get("l") || "").replace(/[^\w-]/g, "");
    let d = null;
    if (l && TAVOLO_FB) {
      try {
        const r = await fetch(`https://firestore.googleapis.com/v1/projects/${TAVOLO_FB.progetto}/databases/(default)/documents/locali/${l}?key=${TAVOLO_FB.apiKey}`, { cache: "no-store" });
        const fl = (await r.json()).fields || {}, sv = k => (fl[k] && fl[k].stringValue) || "";
        const t = sv("tit").split("|");
        d = { locale: { nome: sv("nome"), den: t[0] || "", piva: t[1] || "", sede: t[2] || "", email: t[3] || "" } };
      } catch (e) { d = null; }
    } else {
      try { const r = await fetch("/api/documenti", { cache: "no-store" }); if (r.ok) d = await r.json(); } catch (e) { d = null; }
    }
    riempi(d);
  }
  carica();
  // i collegamenti tra le pagine dei documenti si portano dietro il locale (?l=…) e la lingua
  if (location.search) document.querySelectorAll('a[href$=".html"]').forEach(a => { if (!/^[a-z]+:/i.test(a.getAttribute("href"))) a.href = a.getAttribute("href") + location.search; });
  // pulsante "Cancella i dati salvati su questo dispositivo" (pagina Cookie)
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-cancella]"); if (!b) return;
    try { Object.keys(localStorage).filter(k => /^tavolo-/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (_) {}
    try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())); } catch (_) {}
    b.textContent = "Fatto: i dati di Tavolo su questo dispositivo sono stati cancellati"; b.disabled = true;
  });
})();
