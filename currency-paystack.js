/* ============================================================
   Overdesk — Currency Detection + Paystack Checkout
   (Nigeria, Ghana, South Africa, Kenya, Côte d'Ivoire)
   ============================================================
   What this does:
   1. Detects which country the visitor is in (client-side geo-IP, cached).
   2. If they're in one of the 5 markets Paystack covers, swaps displayed
      prices from USD to that country's local currency (fixed rates below),
      and swaps "Purchase" buttons to open a Paystack checkout instead of
      linking straight to Gumroad.
   3. Everyone else: site behaves exactly as before (Gumroad links untouched).
   4. Paystack's own script only loads the moment someone actually clicks a
      purchase button — not proactively for every visitor from these
      countries. Lighter/faster, and avoids loading third-party cookies
      before the visitor has taken an action (works with cookie-consent.js).

   ============================================================
   IMPORTANT — Paystack accounts and currency
   ============================================================
   A single Paystack account can't process multiple currencies at once
   (except Nigeria + Kenya, which can add USD alongside their base currency).
   In practice this means: as you activate each new market below, you'll
   likely need a SEPARATE Paystack sub-account configured for that country's
   currency, each with its own PUBLIC key. Put each one in PAYSTACK_PUBLIC_KEY
   below once you have it — until then, that market just won't get a
   Paystack key and can be left as a placeholder (see NOTE per entry).

   The exchange rates below are fixed/approximate starting points (similar
   to the ₦1000 = $1 rate already agreed for Nigeria) — update them
   periodically; they are NOT live-fetched.
   ============================================================ */

(function () {
  'use strict';

  // ---- CONFIG: one entry per supported market ----
  var COUNTRY_CONFIG = {
    NG: {
      currency: 'NGN',
      symbol: '\u20A6', // ₦
      rate: 1000, // $1 = ₦1000
      paystackKey: 'pk_test_7d99dac45a30695424e3263f06f5d3e3204743de' // TEST key
    },
    GH: {
      currency: 'GHS',
      symbol: 'GH\u20B5', // GH₵
      rate: 12, // approx $1 = GH₵12 — update as needed
      paystackKey: 'pk_test_REPLACE_GH' // <-- add your Ghana Paystack sub-account public key
    },
    ZA: {
      currency: 'ZAR',
      symbol: 'R',
      rate: 17, // approx $1 = R17 — update as needed
      paystackKey: 'pk_test_REPLACE_ZA' // <-- add your South Africa Paystack sub-account public key
    },
    KE: {
      currency: 'KES',
      symbol: 'KSh',
      rate: 130, // approx $1 = KSh130 — update as needed
      paystackKey: 'pk_test_REPLACE_KE' // <-- add your Kenya Paystack sub-account public key
    },
    CI: {
      currency: 'XOF',
      symbol: 'CFA',
      rate: 600, // approx $1 = 600 XOF — update as needed
      paystackKey: 'pk_test_REPLACE_CI' // <-- add your Côte d'Ivoire Paystack sub-account public key
    }
  };

  var PRODUCT_NAMES = {
    app: 'Overdesk',
    app2: 'Overdesk Nexus',
    app3: 'Overdesk Checklist',
    bundle: 'Overdesk Full Suite (Bundle)',
    everyone: 'Overdesk Checklist — Everyone Edition'
  };

  function formatAmountFull(amount) {
    return Math.round(amount).toLocaleString('en-US');
  }
  function formatAmountK(amount) {
    var thousands = amount / 1000;
    return (amount % 1000 === 0) ? thousands + 'K' : thousands.toFixed(1) + 'K';
  }

  // ---- 1. Detect country (cached in localStorage for 24h) ----
  function getCachedGeo() {
    try {
      var raw = localStorage.getItem('overdesk_geo');
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return null; // expired
      return data;
    } catch (e) {
      return null;
    }
  }

  function setCachedGeo(countryCode) {
    try {
      localStorage.setItem('overdesk_geo', JSON.stringify({
        countryCode: countryCode,
        timestamp: Date.now()
      }));
    } catch (e) { /* localStorage unavailable, ignore */ }
  }

  function detectCountry(callback) {
    var cached = getCachedGeo();
    if (cached) {
      callback(cached.countryCode);
      return;
    }
    fetch('https://ipapi.co/json/')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var code = data && data.country_code ? data.country_code : null;
        setCachedGeo(code);
        callback(code);
      })
      .catch(function () {
        // If geo lookup fails, fail safe to default Gumroad/USD experience
        callback(null);
      });
  }

  // ---- 2. Swap price displays + button behavior for a supported market ----
  function applyLocalPricing(config) {
    // Swap price text
    document.querySelectorAll('[data-usd]').forEach(function (el) {
      var usd = parseFloat(el.getAttribute('data-usd'));
      if (isNaN(usd)) return;
      var local = usd * config.rate;
      var display = formatAmountK(local);
      // Only overwrite if this element is a price display (has data-usd and starts with $)
      if (el.textContent.trim().indexOf('$') === 0) {
        el.textContent = config.symbol + display;
      }
    });

    // Swap "Secure Payment via Gumroad" labels
    document.querySelectorAll('.js-secure-text').forEach(function (el) {
      el.textContent = 'Secure Payment via Paystack';
    });

    // Swap purchase button behavior
    document.querySelectorAll('.js-purchase-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var product = btn.getAttribute('data-product');
        var usd = parseFloat(btn.getAttribute('data-usd'));
        openCheckoutModal(config, product, usd);
      });
      // Update button label so it's clear this is a different payment path
      var svg = btn.querySelector('svg');
      btn.innerHTML = '';
      if (svg) btn.appendChild(svg);
      btn.appendChild(document.createTextNode(' Pay with Paystack'));
    });
  }

  // ---- 3. Simple checkout modal: product, price, email, then Paystack ----
  function openCheckoutModal(config, productKey, usdAmount) {
    var localAmount = Math.round(usdAmount * config.rate);
    var productName = PRODUCT_NAMES[productKey] || 'Overdesk';

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,5,14,0.75);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:Inter,sans-serif;';

    overlay.innerHTML =
      '<div style="background:#141417;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:1.8rem;max-width:380px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,0.5);">' +
        '<h3 style="color:#fff;font-size:1.05rem;font-weight:800;margin:0 0 0.3rem;">' + productName + '</h3>' +
        '<p style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin:0 0 1.3rem;">' + config.symbol + formatAmountFull(localAmount) + ' \u2014 enter your email to continue to Paystack.</p>' +
        '<input type="email" id="opStackEmail" placeholder="you@example.com" required style="width:100%;box-sizing:border-box;padding:0.75rem 1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;font-size:0.9rem;margin-bottom:1rem;">' +
        '<button id="opStackContinue" style="width:100%;padding:0.85rem;border:none;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#00d2ff);color:#fff;font-weight:700;font-size:0.9rem;cursor:pointer;">Continue to Payment</button>' +
        '<button id="opStackCancel" style="width:100%;padding:0.6rem;border:none;background:none;color:rgba(255,255,255,0.4);font-size:0.8rem;margin-top:0.6rem;cursor:pointer;">Cancel</button>' +
      '</div>';

    document.body.appendChild(overlay);

    var emailInput = overlay.querySelector('#opStackEmail');
    emailInput.focus();

    overlay.querySelector('#opStackCancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    overlay.querySelector('#opStackContinue').addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email || email.indexOf('@') === -1) {
        emailInput.style.borderColor = '#ef4444';
        return;
      }
      var continueBtn = overlay.querySelector('#opStackContinue');
      continueBtn.textContent = 'Loading secure payment…';
      continueBtn.disabled = true;

      loadPaystackScript(function () {
        document.body.removeChild(overlay);
        launchPaystackPopup(config, email, productKey, productName, localAmount);
      });
    });
  }

  function launchPaystackPopup(config, email, productKey, productName, localAmount) {
    if (typeof PaystackPop === 'undefined') {
      alert('Payment system is still loading — please try again in a moment.');
      return;
    }
    var handler = PaystackPop.setup({
      key: config.paystackKey,
      email: email,
      amount: localAmount * 100, // Paystack expects the smallest currency unit (kobo/pesewas/cents)
      currency: config.currency,
      ref: 'OD-' + productKey + '-' + Date.now(),
      metadata: {
        product: productKey,
        product_name: productName,
        custom_fields: [
          { display_name: 'Product', variable_name: 'product', value: productName }
        ]
      },
      callback: function (response) {
        // Client-side "success" — real delivery is triggered server-side by the
        // Paystack webhook (see the Cloudflare Worker), not from this callback.
        alert('Payment received! Check your email (' + email + ') shortly for your download link.');
      },
      onClose: function () {
        // user closed the popup — no action needed
      }
    });
    handler.openIframe();
  }

  // ---- 4. Load the Paystack Inline script only when someone actually clicks purchase ----
  var paystackScriptLoading = false;
  var paystackScriptCallbacks = [];
  function loadPaystackScript(callback) {
    if (typeof PaystackPop !== 'undefined') { callback(); return; }
    paystackScriptCallbacks.push(callback);
    if (paystackScriptLoading) return;
    paystackScriptLoading = true;
    var s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.onload = function () {
      paystackScriptCallbacks.forEach(function (cb) { cb(); });
      paystackScriptCallbacks = [];
    };
    document.head.appendChild(s);
  }

  // A market is only "live" once its placeholder key has been swapped for a
  // real Paystack public key. Until then, treat it like an unsupported market
  // so visitors get the working Gumroad/USD flow instead of a broken checkout.
  function isKeyConfigured(config) {
    return !!config.paystackKey && config.paystackKey.indexOf('REPLACE') === -1;
  }

  // ---- Boot ----
  detectCountry(function (countryCode) {
    var config = countryCode ? COUNTRY_CONFIG[countryCode] : null;
    if (config && isKeyConfigured(config)) {
      // Price/button swaps happen immediately — Paystack's own script only
      // loads later, at the moment of an actual purchase click.
      applyLocalPricing(config);
    }
    // Visitors outside the 5 supported markets, or in a market whose
    // Paystack key hasn't been configured yet: do nothing, site behaves
    // exactly as before (Gumroad/USD).
  });
})();
