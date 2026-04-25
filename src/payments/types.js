/**
 * Payment provider interface (documented as a comment).
 *
 * Every provider exports an object that conforms to:
 *
 * {
 *   code: 'mono' | 'liqpay' | 'wayforpay' | 'fondy' | 'portmone' | ...,
 *   name: 'Human-readable name',
 *
 *   // Resolve the credentials object that should be used for this request.
 *   // Reads merchant's saved credentials from shop_payment_methods.credentials,
 *   // and if `isTest` is true falls back to platform test env vars.
 *   //
 *   // Returns: { token: string, ...providerSpecific }
 *   // Throws if neither merchant creds nor platform fallback are configured.
 *   resolveCredentials(merchantCredsJson, { isTest }),
 *
 *   // Build & POST an invoice. Returns:
 *   //   { externalId: string, redirectUrl: string, raw: object }
 *   createInvoice({
 *     amount,         // number, currency-major (UAH)
 *     currency,       // 'UAH'
 *     orderRef,       // our reference
 *     description,    // text
 *     items,          // [{ name, qty, price }]
 *     returnUrl,      // where to redirect user after pay
 *     webhookUrl,     // where provider should POST status
 *     customer,       // { email, phone, firstName, lastName }
 *     credentials,    // resolved credentials
 *   }),
 *
 *   // Verify webhook signature, throw if invalid.
 *   verifyWebhook({ rawBody, headers, credentials, isTest }),
 *
 *   // Parse webhook into normalised event:
 *   //   { externalId, status: 'success'|'failed'|'pending'|'expired', amount, raw }
 *   parseWebhook({ rawBody, body, headers }),
 *
 *   // Optional: poll provider for current status (used as fallback).
 *   //   Returns { status, raw }
 *   getInvoice?(externalId, credentials),
 * }
 */

/** @typedef {'pending'|'success'|'failed'|'expired'|'refunded'} InvoiceStatus */

module.exports = {};
