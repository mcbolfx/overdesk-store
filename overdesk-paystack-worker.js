/* ============================================================
   Overdesk — Paystack Webhook Handler (Cloudflare Worker)
   ============================================================
   What this does:
   1. Receives a webhook POST from Paystack every time a payment event happens.
   2. Verifies the request is genuinely from Paystack (signature check) —
      this step is critical, skipping it means anyone could fake a "payment
      succeeded" request and get a free license.
   3. On a real successful charge:
        - creates a single-use, 100%-off Gumroad offer code, scoped to the
          product that was bought (via Gumroad's Offer Codes API)
        - emails the buyer a link to claim it: overdesk.gumroad.com/l/<permalink>/<code>
        - the buyer completes a $0 checkout on Gumroad, and Gumroad itself
          delivers the file AND emails a genuine license key — the same
          license key your app already knows how to verify. No app changes
          needed; this Worker never touches the app or invents its own keys.
   4. On a refund, this Worker can't reliably tell which Gumroad license
      resulted from a since-claimed offer code (Gumroad doesn't expose that
      link cleanly), so instead of guessing, it emails you an admin alert so
      you can find and revoke the license manually in the Gumroad dashboard.

   ============================================================
   DEPLOYMENT — Cloudflare Dashboard steps:
   ============================================================
   1. Go to Cloudflare Dashboard → Workers & Pages → Create → Create Worker.
   2. Give it a name (e.g. "overdesk-paystack-webhook"), deploy the default
      template, then click "Edit code" and replace everything with this file.
   3. Click Deploy.
   4. Go to Settings → Variables and Secrets on this Worker, and add:
        PAYSTACK_SECRET_KEY_LIVE = your Paystack LIVE secret key (starts with sk_live_)
        PAYSTACK_SECRET_KEY_TEST = your Paystack TEST secret key (starts with sk_test_)
        RESEND_API_KEY        = your Resend API key
        FROM_EMAIL             = an email address verified in your Resend account
                                  (e.g. hello@overdesk.store)
        GUMROAD_ACCESS_TOKEN   = your Gumroad access token (from gumroad.com/oauth/applications)
        ADMIN_EMAIL            = where refund alerts should go (e.g. your own inbox)
      Mark PAYSTACK_SECRET_KEY_LIVE, PAYSTACK_SECRET_KEY_TEST, and GUMROAD_ACCESS_TOKEN as
      "Encrypt" / secret.
   5. Find each product's real Gumroad product_id (NOT the permalink) by running:
        curl "https://api.gumroad.com/v2/products?access_token=YOUR_ACCESS_TOKEN"
      Match each product by its "custom_permalink" field, copy its "id" value,
      and fill in GUMROAD_PRODUCT_IDS below.
   6. Copy the Worker's URL (looks like https://overdesk-paystack-webhook.YOURNAME.workers.dev)
   7. Go to your Paystack Dashboard → Settings → API Keys & Webhooks →
      set "Webhook URL" to that Worker URL, and save.
   8. Before relying on this in production: manually test that a 100%-off
      offer code actually brings one of your products to a real $0 checkout
      on Gumroad (some platforms enforce a minimum non-zero price). Do this
      once per product.
   ============================================================ */

// ---- CONFIG: map each product key (from Paystack metadata) to its
//      Gumroad permalink (the part after /l/ in your Gumroad URLs) and its
//      real Gumroad product_id (see step 5 above). ----
const GUMROAD_PERMALINKS = {
  app:      'app',
  app2:     'app2',
  app3:     'app3',
  bundle:   'suite',
  everyone: 'everyone'
};

const GUMROAD_PRODUCT_IDS = {
  app:      'P3VOJBoRd4rVh2dHSSv1bg==',
  app2:     'ILe-vFDDL-fYyDeKroOQXw==',
  app3:     'IuGRgU5DfICDDM1w7-eY7Q==',
  bundle:   'b8IUjRQ2mu4N6PxHeFBTeA==',
  everyone: 'njBrop7enJxgaZWr4Y7-dQ=='
};

// For products where the Single Purchase / Lifetime tier is one "option" on a
// shared product page (rather than its own standalone product) — e.g. Nexus
// has Trial/Annual/Lifetime options on one Gumroad product. Only fill in the
// option needed for whichever tier Paystack currently sells (Single Purchase).
// Leave blank for products that don't use Gumroad options.
const GUMROAD_LIFETIME_OPTIONS = {
  app2: 'Z7fDvIm6isjECLjZYPUBqw%3D%3D',
  app3: 'jwNbOTIY4HDd-9ICmPU24w%3D%3D',
  everyone: 'guYugE2gou1zWkk_pMNJKQ%3D%3D'
};

const PRODUCT_NAMES = {
  app: 'Overdesk',
  app2: 'Overdesk Nexus',
  app3: 'Overdesk Checklist',
  bundle: 'Overdesk Full Suite (Bundle)',
  everyone: 'Overdesk Checklist — Everyone Edition'
};

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-paystack-signature');

    // ---- 1. Verify the webhook is genuinely from Paystack (either mode) ----
    const isValid = await verifyPaystackSignature(rawBody, signature, [
      env.PAYSTACK_SECRET_KEY_LIVE,
      env.PAYSTACK_SECRET_KEY_TEST
    ]);
    if (!isValid) {
      return new Response('Invalid signature', { status: 401 });
    }

    const event = JSON.parse(rawBody);

    // ---- 2. Successful charge: create a one-time Gumroad offer code, email it ----
    if (event.event === 'charge.success') {
      const data = event.data;
      const email = data.customer && data.customer.email;
      const productKey = data.metadata && data.metadata.product;
      const productName = PRODUCT_NAMES[productKey] || 'Overdesk';
      const permalink = GUMROAD_PERMALINKS[productKey];
      const gumroadProductId = GUMROAD_PRODUCT_IDS[productKey];

      if (!email || !permalink || !gumroadProductId || gumroadProductId === 'REPLACE-ME') {
        // Log-worthy edge case: unknown/unconfigured product or missing email.
        // Still return 200 so Paystack doesn't keep retrying.
        return new Response('OK (missing data)', { status: 200 });
      }

      try {
        const code = generateOfferCodeName();
        await createGumroadOfferCode(env, gumroadProductId, code);
        const option = GUMROAD_LIFETIME_OPTIONS[productKey];
        const claimUrl = option
          ? `https://overdesk.gumroad.com/l/${permalink}/${code}?option=${option}`
          : `https://overdesk.gumroad.com/l/${permalink}/${code}`;
        await sendClaimEmail(env, email, productName, claimUrl);
      } catch (err) {
        console.error('Offer code creation/email failed:', err);
        if (env.ADMIN_EMAIL) {
          await sendAdminAlert(env, `Delivery failed for a Paystack purchase (product: ${productName}, ` +
            `buyer: ${email}). Error detail: ${err.message || err}`, 'Overdesk: Delivery failed for a purchase');
        }
      }

      return new Response('OK', { status: 200 });
    }

    // ---- 3. Refund: we can't reliably auto-revoke a Gumroad license from
    //         a claimed offer code, so alert an admin to handle it manually ----
    if (event.event === 'refund.processed' && env.ADMIN_EMAIL) {
      const reference =
        (event.data && event.data.transaction && event.data.transaction.reference) ||
        (event.data && event.data.reference) || '(unknown reference)';
      await sendAdminAlert(env, `A Paystack refund was processed (reference: ${reference}). ` +
        `If the buyer already claimed their Gumroad offer code, find and revoke their license ` +
        `manually in the Gumroad dashboard.`, 'Overdesk: Paystack refund needs manual review');
      return new Response('OK', { status: 200 });
    }

    // Any other event type: acknowledge and ignore.
    return new Response('OK (ignored)', { status: 200 });
  }
};

// ---- Generate a random, hard-to-guess offer code ----
function generateOfferCodeName() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---- Create a single-use, 100%-off offer code on the given Gumroad product ----
async function createGumroadOfferCode(env, gumroadProductId, code) {
  const params = new URLSearchParams({
    access_token: env.GUMROAD_ACCESS_TOKEN,
    name: code,
    amount_off: '100',
    offer_type: 'percent',
    max_purchase_count: '1'
  });

  const response = await fetch(
    `https://api.gumroad.com/v2/products/${gumroadProductId}/offer_codes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error('Gumroad offer code creation failed: ' + JSON.stringify(data));
  }
  return data;
}

async function verifyPaystackSignature(rawBody, signature, candidateSecretKeys) {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const msgData = encoder.encode(rawBody);

  for (const secretKey of candidateSecretKeys) {
    if (!secretKey) continue;

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedHex === signature) return true;
  }

  return false;
}

async function sendClaimEmail(env, toEmail, productName, claimUrl) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#0c0c0c;">Thanks for your purchase!</h2>
      <p style="color:#333;line-height:1.6;">
        Your payment for <strong>${productName}</strong> was successful. Click below to
        claim your copy — it's a $0 checkout, just enter your email to get your
        download and license key instantly:
      </p>
      <p style="margin:24px 0;">
        <a href="${claimUrl}" style="background:#7c3aed;color:#fff;padding:12px 24px;
           border-radius:999px;text-decoration:none;font-weight:700;display:inline-block;">
          Claim ${productName}
        </a>
      </p>
      <p style="color:#888;font-size:13px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        ${claimUrl}
      </p>
      <p style="color:#888;font-size:13px;">
        This link works once. Questions? Just reply to this email.
      </p>
    </div>
  `;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: toEmail,
      subject: `Claim your ${productName} download`,
      html: html
    })
  });

  if (!resendResponse.ok) {
    const errText = await resendResponse.text();
    throw new Error(`Resend claim-email send failed (${resendResponse.status}): ${errText}`);
  }
}

async function sendAdminAlert(env, message, subject) {
  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: env.ADMIN_EMAIL,
        subject: subject || 'Overdesk: Needs manual review',
        html: `<p>${message}</p>`
      })
    });
    if (!resendResponse.ok) {
      console.error('Admin alert send failed:', resendResponse.status, await resendResponse.text());
    }
  } catch (err) {
    console.error('Admin alert send threw:', err);
  }
}
