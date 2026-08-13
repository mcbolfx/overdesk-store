/* ============================================================
   Overdesk — Currency Selector + Paystack Checkout
   ============================================================
   What this does:
   1. Detects which country the visitor is in (client-side geo-IP, cached).
   2. African markets Paystack covers (NG, GH, ZA, KE, CI): defaults to
      that local currency, buttons go through Paystack. The currency
      dropdown for these visitors offers only their local currency or USD.
      Switching to USD sends them to Gumroad directly instead of Paystack.
   3. Everyone else (international): defaults to USD, dropdown offers
      USD / EUR / GBP. All three always link straight to Gumroad —
      Paystack is never used for these currencies.
   4. Paystack's own script only loads the moment someone actually clicks a
      purchase button while a Paystack-backed currency is active.

   ============================================================
   IMPORTANT — Paystack accounts and currency
   ============================================================
   A single Paystack account can't process multiple currencies at once
   (except Nigeria + Kenya, which can add USD alongside their base currency).
   As you activate each new African market below, you'll likely need a
   SEPARATE Paystack sub-account for that country's currency, each with its
   own PUBLIC key. Put each one in paystackKey below once you have it —
   until then, that market is skipped and those visitors just see USD/Gumroad.

   EUR/GBP rates below are fixed/approximate starting points — they are NOT
   live-fetched, update periodically.
   ============================================================ */

(function () {
  'use strict';

  // ---- CONFIG: African markets — Paystack-backed ----
  var AFRICAN_CONFIG = {
    NG: {
      code: 'NG', currency: 'NGN', symbol: '\u20A6', rate: 1000,
      usePaystack: true, useKSuffix: true,
      paystackKey: 'pk_live_f7ba68167086e33059d3916b66948d1a85f3ccaf'
    },
    GH: {
      code: 'GH', currency: 'GHS', symbol: 'GH\u20B5', rate: 12,
      usePaystack: true, useKSuffix: true,
      paystackKey: 'pk_test_REPLACE_GH'
    },
    ZA: {
      code: 'ZA', currency: 'ZAR', symbol: 'R', rate: 17,
      usePaystack: true, useKSuffix: true,
      paystackKey: 'pk_test_REPLACE_ZA'
    },
    KE: {
      code: 'KE', currency: 'KES', symbol: 'KSh', rate: 130,
      usePaystack: true, useKSuffix: true,
      paystackKey: 'pk_test_REPLACE_KE'
    },
    CI: {
      code: 'CI', currency: 'XOF', symbol: 'CFA', rate: 600,
      usePaystack: true, useKSuffix: true,
      paystackKey: 'pk_test_REPLACE_CI'
    }
  };

  // ---- CONFIG: international currencies — Gumroad-only, no Paystack ----
  var INTERNATIONAL_CONFIG = {
    USD: { code: 'USD', currency: 'USD', symbol: '$', rate: 1,    usePaystack: false, useKSuffix: false, label: 'USD ($)' },
    EUR: { code: 'EUR', currency: 'EUR', symbol: '\u20AC', rate: 0.92, usePaystack: false, useKSuffix: false, label: 'EUR (\u20AC)' },
    GBP: { code: 'GBP', currency: 'GBP', symbol: '\u00A3', rate: 0.79, usePaystack: false, useKSuffix: false, label: 'GBP (\u00A3)' }
  };

  var CURRENCY_LABELS = {
    NGN: 'NGN (\u20A6)', GHS: 'GHS (GH\u20B5)', ZAR: 'ZAR (R)', KES: 'KES (KSh)', XOF: 'XOF (CFA)',
    USD: 'USD ($)', EUR: 'EUR (\u20AC)', GBP: 'GBP (\u00A3)'
  };

  var PRODUCT_NAMES = {
    app: 'Overdesk',
    app2: 'Overdesk Nexus',
    app3: 'Overdesk Checklist',
    bundle: 'Overdesk Full Suite (Bundle)',
    everyone: 'Overdesk for Everyone'
  };

  var currentConfig = INTERNATIONAL_CONFIG.USD; // module-level state, read at click time

  function formatAmountK(amount) {
    if (amount === 0) return '0';
    var thousands = amount / 1000;
    return (amount % 1000 === 0) ? thousands + 'K' : thousands.toFixed(1) + 'K';
  }
  function formatAmountPlain(amount) {
    if (amount === 0) return '0';
    return Math.round(amount).toLocaleString('en-US');
  }
  function formatAmountFull(amount) {
    return Math.round(amount).toLocaleString('en-US');
  }
  function formatDisplay(amount, config) {
    return config.useKSuffix ? formatAmountK(amount) : formatAmountPlain(amount);
  }

  // ---- 1. Detect country (cached in localStorage for 24h) ----
  function getCachedGeo() {
    try {
      var raw = localStorage.getItem('overdesk_geo');
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return null;
      return data;
    } catch (e) { return null; }
  }
  function setCachedGeo(countryCode) {
    try {
      localStorage.setItem('overdesk_geo', JSON.stringify({ countryCode: countryCode, timestamp: Date.now() }));
    } catch (e) {}
  }
  function detectCountry(callback) {
    var cached = getCachedGeo();
    if (cached) { callback(cached.countryCode); return; }
    fetch('https://ipapi.co/json/')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var code = data && data.country_code ? data.country_code : null;
        setCachedGeo(code);
        callback(code);
      })
      .catch(function () { callback(null); });
  }

  function isKeyConfigured(config) {
    return !!config.paystackKey && config.paystackKey.indexOf('REPLACE') === -1;
  }

  // ---- 2. Apply a currency to every priced element + purchase button label on the page ----
  function applyCurrency(config) {
    currentConfig = config;

    document.querySelectorAll('.price-current[data-usd], .price-original[data-usd]').forEach(function (el) {
      var usd = parseFloat(el.getAttribute('data-usd'));
      if (isNaN(usd)) return;
      var local = usd * config.rate;
      var display = formatDisplay(local, config);
      el.textContent = config.symbol + display;
    });

    document.querySelectorAll('.js-secure-text').forEach(function (el) {
      el.textContent = config.usePaystack ? 'Secure Payment via Paystack' : 'Secure Payment via Gumroad';
    });
  }

  // ---- 3. Purchase button click handling — one listener, decides at click-time ----
  function attachPurchaseHandlers() {
    document.querySelectorAll('.js-purchase-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (!currentConfig.usePaystack) {
          // Let the browser follow the button's normal href straight to Gumroad.
          return;
        }
        e.preventDefault();
        var product = btn.getAttribute('data-product');
        var usd = parseFloat(btn.getAttribute('data-usd'));
        openCheckoutModal(currentConfig, product, usd);
      });
    });
  }

  // ---- 4. Paystack checkout modal (only ever opened when currentConfig.usePaystack) ----
  function openCheckoutModal(config, productKey, usdAmount) {
    var localAmount = Math.round(usdAmount * config.rate);
    var productName = PRODUCT_NAMES[productKey] || 'Overdesk';

    loadPaystackScript(function () {});

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,5,14,0.75);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:Inter,sans-serif;';

    overlay.innerHTML =
      '<div style="background:#141417;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:1.8rem;max-width:380px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,0.5);">' +
        '<h3 style="color:#fff;font-size:1.05rem;font-weight:800;margin:0 0 0.3rem;">' + productName + '</h3>' +
        '<p style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin:0 0 1.3rem;">' + config.symbol + formatAmountFull(localAmount) + ' \u2014 enter your email to continue to Paystack.</p>' +
        '<input type="email" id="opStackEmail" placeholder="you@example.com" required style="width:100%;box-sizing:border-box;padding:0.75rem 1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;font-size:0.9rem;margin-bottom:1rem;">' +
        '<button id="opStackContinue" style="width:100%;padding:0.85rem;border:none;border-radius:999px;background:linear-gradient(135deg,#3D81E3,#FF7A18);color:#fff;font-weight:700;font-size:0.9rem;cursor:pointer;">Continue to Payment</button>' +
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
      continueBtn.textContent = 'Loading secure payment\u2026';
      continueBtn.disabled = true;

      loadPaystackScript(function () {
        document.body.removeChild(overlay);
        launchPaystackPopup(config, email, productKey, productName, localAmount);
      });
    });
  }

  function launchPaystackPopup(config, email, productKey, productName, localAmount) {
    if (typeof PaystackPop === 'undefined') {
      alert('Payment system is still loading \u2014 please try again in a moment.');
      return;
    }
    var handler = PaystackPop.setup({
      key: config.paystackKey,
      email: email,
      amount: localAmount * 100,
      currency: config.currency,
      ref: 'OD-' + productKey + '-' + Date.now(),
      metadata: {
        product: productKey,
        product_name: productName,
        custom_fields: [{ display_name: 'Product', variable_name: 'product', value: productName }]
      },
      callback: function (response) {
        alert('Payment received! Check your email (' + email + ') shortly for your download link.');
      },
      onClose: function () {}
    });
    handler.openIframe();
  }

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

  // ---- 5. Currency dropdown — inserted above the pricing tabs, on any page that has #pricing ----
  function buildDropdown(options, selectedCode) {
    var pricingSection = document.getElementById('pricing');
    if (!pricingSection) return;

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:1.2rem;position:relative;z-index:1;';

    var glassPill = document.createElement('div');
    glassPill.style.cssText =
      'display:inline-flex;align-items:center;gap:0.5rem;' +
      'background:rgba(255,255,255,0.07);' +
      'backdrop-filter:blur(18px) saturate(1.4);' +
      '-webkit-backdrop-filter:blur(18px) saturate(1.4);' +
      'border:1px solid rgba(255,255,255,0.16);' +
      'border-radius:999px;' +
      'padding:0.5rem 1rem;' +
      'box-shadow:inset 0 1px 1px rgba(255,255,255,0.15), 0 8px 20px rgba(0,0,0,0.25);';

    var icon = document.createElement('span');
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    icon.style.cssText = 'display:flex;align-items:center;color:rgba(255,255,255,0.5);flex-shrink:0;';

    var select = document.createElement('select');
    select.id = 'currencySelect';
    select.style.cssText =
      'background:transparent;color:#fff;border:none;outline:none;' +
      'font-size:0.82rem;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;' +
      'appearance:none;-webkit-appearance:none;padding-right:0.2rem;';

    options.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.code;
      o.textContent = CURRENCY_LABELS[opt.currency] || opt.currency;
      o.style.color = '#000';
      if (opt.code === selectedCode) o.selected = true;
      select.appendChild(o);
    });

    select.addEventListener('change', function () {
      var chosen = options.filter(function (o) { return o.code === select.value; })[0];
      if (chosen) applyCurrency(chosen);
    });

    glassPill.appendChild(icon);
    glassPill.appendChild(select);
    wrap.appendChild(glassPill);

    var firstChild = pricingSection.querySelector('.pricing-tabs') || pricingSection.querySelector('h2') || pricingSection.firstChild;
    if (firstChild) {
      pricingSection.insertBefore(wrap, firstChild);
    } else {
      pricingSection.appendChild(wrap);
    }
  }

  // ---- Boot ----
  detectCountry(function (countryCode) {
    var africanConfig = countryCode ? AFRICAN_CONFIG[countryCode] : null;

    if (africanConfig && isKeyConfigured(africanConfig)) {
      // African visitor in a supported market: default to their local currency,
      // dropdown offers [local currency, USD] only.
      applyCurrency(africanConfig);
      buildDropdown([africanConfig, INTERNATIONAL_CONFIG.USD], africanConfig.code);
    } else {
      // International (or unconfigured African market): default USD,
      // dropdown offers USD / EUR / GBP — always Gumroad, never Paystack.
      applyCurrency(INTERNATIONAL_CONFIG.USD);
      buildDropdown(
        [INTERNATIONAL_CONFIG.USD, INTERNATIONAL_CONFIG.EUR, INTERNATIONAL_CONFIG.GBP],
        'USD'
      );
    }

    attachPurchaseHandlers();
  });
})();
