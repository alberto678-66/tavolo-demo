/* Tavolo — avviso su cookie e dati salvati sul dispositivo, per le pagine dei clienti (Prenota, Ordina dal tavolo).
   Tavolo non usa cookie né strumenti di profilazione o di terze parti: per legge basta informare
   (art. 122 Codice privacy, Linee guida del Garante del 10 giugno 2021). L'avviso resta finché non si tocca "Ho capito". */
(function () {
  "use strict";
  const V = "2026-11-01", K = "tavolo-cookie-info";
  const pref = (() => { try { return localStorage.getItem("tavolo-prenota-lingua") || localStorage.getItem("tavolo-ordina-lingua"); } catch (e) { return null; } })();
  const it = /[?&]lang=it/.test(location.search) || (!/[?&]lang=en/.test(location.search) && (pref || (navigator.language || "it").slice(0, 2)) === "it");
  const T = it
    ? { testo: "Questa pagina non usa cookie né pubblicità. Salva sul tuo telefono solo ciò che serve a farla funzionare (lingua, le tue prenotazioni, nome e telefono per non riscriverli).", ok: "Ho capito", cookie: "Cookie", privacy: "Privacy" }
    : { testo: "This page uses no cookies and no ads. It only saves on your phone what it needs to work (language, your bookings, name and phone so you don't retype them).", ok: "Got it", cookie: "Cookies", privacy: "Privacy" };
  const l = (new URLSearchParams(location.search).get("l") || "").replace(/[^\w-]/g, "");
  const suff = (l ? "?l=" + encodeURIComponent(l) + "&" : "?") + "lang=" + (it ? "it" : "en");
  const get = () => { try { return localStorage.getItem(K); } catch (e) { return null; } };
  const set = v => { try { localStorage.setItem(K, v); } catch (e) {} };
  const css = "position:fixed;left:12px;right:12px;top:12px;z-index:99999;max-width:560px;margin:0 auto;background:#1B2E24;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:14px/1.45 system-ui,-apple-system,sans-serif";
  function avviso() {
    if ((get() || "").split("|")[0] === V) return;
    const d = document.createElement("div");
    d.setAttribute("role", "dialog"); d.setAttribute("aria-live", "polite"); d.setAttribute("aria-label", T.cookie); d.style.cssText = css;
    d.innerHTML = `<div>${T.testo}</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px"><button type="button" style="background:#CFE6D7;color:#1B2E24;border:0;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer">${T.ok}</button><a href="cookie.html${suff}" target="_blank" rel="noopener" style="color:#CFE6D7">${T.cookie}</a><a href="privacy.html${suff}" target="_blank" rel="noopener" style="color:#CFE6D7">${T.privacy}</a></div>`;
    d.querySelector("button").onclick = () => { set(V + "|" + Date.now()); d.remove(); };
    document.body.appendChild(d);
  }
  function piede() {
    const p = document.createElement("div");
    p.style.cssText = "text-align:center;font:12px system-ui,sans-serif;opacity:.7;padding:18px 0 110px";
    p.innerHTML = `<a href="privacy.html${suff}" target="_blank" rel="noopener" style="color:inherit">${T.privacy}</a> · <a href="cookie.html${suff}" target="_blank" rel="noopener" style="color:inherit">${T.cookie}</a>`;
    document.body.appendChild(p);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { avviso(); piede(); }); else { avviso(); piede(); }
})();
