/**
 * Monobank — Покупка частинами.
 *
 * Implementation note: Monobank's Acquiring API (`/api/merchant/invoice/create`)
 * does not expose a per-invoice "force parts" flag — the parts option is shown
 * to the customer on the Mono pay page when the merchant has the parts
 * contract enabled on their account.
 *
 * From the platform's point of view this is just another method the merchant
 * can offer in the checkout. We reuse the Acquiring transport but:
 *   - present it as a separate provider (`mono_parts`) in the dashboard,
 *   - tag the invoice description so the merchant can distinguish parts
 *     orders in their own backoffice,
 *   - the customer is redirected to the same Mono page where Mono itself
 *     surfaces the "Купити частинами" button.
 *
 * The merchant can:
 *   - reuse the same X-Token they configured for `mono`, OR
 *   - paste a different X-Token if Monobank issued one specifically for parts.
 */

const monoAcquiring = require('./monobankAcquiring');

const provider = {
  code: 'mono_parts',
  name: 'Monobank — Покупка частинами',

  resolveCredentials: monoAcquiring.resolveCredentials,
  verifyWebhook: monoAcquiring.verifyWebhook,
  parseWebhook: monoAcquiring.parseWebhook,
  getInvoice: monoAcquiring.getInvoice,
  verifyCredentials: monoAcquiring.verifyCredentials,

  async createInvoice(args) {
    const description = args.description || `Замовлення ${args.orderRef}`;
    return monoAcquiring.createInvoice({
      ...args,
      // Tag for merchant-side reporting so they can pick parts orders out
      // of the Mono cabinet at a glance.
      description: `[Купити частинами] ${description}`,
    });
  },
};

module.exports = provider;
