/* ============================================================
   Overdesk — Cookie Consent Banner
   ============================================================
   - Shows once per visitor (remembered in localStorage).
   - "Accept" enables auto-loading of third-party embeds (Calendly
     preview, Paystack) ahead of time for a smoother experience.
   - "Decline" still lets the site work fully — third-party embeds
     (Calendly, Paystack) simply load only at the moment the visitor
     clicks something that needs them (Book A Demo, Purchase), which
     counts as their own direct action/consent at that point.
   - Fires a 'overdeskCookieConsent' event other scripts can listen for.
   ============================================================ */

(function () {
  'use strict';

  var STORAGE_KEY = 'overdesk_cookie_consent'; // 'accepted' | 'declined'

  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('overdeskCookieConsent', { detail: { consent: value } }));
  }

  function showBanner() {
    var wrap = document.createElement('div');
    wrap.id = 'odCookieBanner';
    wrap.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:99998;' +
      'display:flex;justify-content:center;padding:1rem;' +
      'font-family:Inter,sans-serif;';
    wrap.innerHTML =
      '<div style="max-width:720px;width:100%;background:rgba(20,20,23,0.92);backdrop-filter:blur(16px);' +
      '-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.1);border-radius:18px;' +
      'padding:1.1rem 1.3rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;' +
      'box-shadow:0 20px 50px rgba(0,0,0,0.4);">' +
        '<p style="flex:1;min-width:220px;margin:0;color:rgba(255,255,255,0.75);font-size:0.85rem;line-height:1.5;">' +
          'We use cookies for things like booking demos and processing payments. ' +
          '<a href="/privacy-policy/" style="color:#a78bfa;text-decoration:underline;">Learn more</a>' +
        '</p>' +
        '<div style="display:flex;gap:0.6rem;flex-shrink:0;">' +
          '<button id="odCookieDecline" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:0.82rem;font-weight:600;padding:0.55rem 1.1rem;border-radius:999px;cursor:pointer;">Decline</button>' +
          '<button id="odCookieAccept" style="background:linear-gradient(135deg,#7c3aed,#00d2ff);border:none;color:#fff;font-size:0.82rem;font-weight:700;padding:0.55rem 1.3rem;border-radius:999px;cursor:pointer;">Accept</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    document.getElementById('odCookieAccept').addEventListener('click', function () {
      setConsent('accepted');
      wrap.remove();
    });
    document.getElementById('odCookieDecline').addEventListener('click', function () {
      setConsent('declined');
      wrap.remove();
    });
  }

  var existing = getConsent();
  if (existing) {
    // Already decided on a previous visit — fire the event immediately so
    // dependent scripts (Calendly preload, etc.) know where they stand.
    document.dispatchEvent(new CustomEvent('overdeskCookieConsent', { detail: { consent: existing } }));
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }

  // Expose a small helper other scripts can check synchronously.
  window.odHasCookieConsent = function () {
    return getConsent() === 'accepted';
  };
})();
