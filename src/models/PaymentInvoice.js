/**
 * Lightweight repo over the `payment_invoices` table.
 * Uses Supabase service-role REST client (no direct pg connection required).
 */

const supabase = require('../config/supabase');

class PaymentInvoice {
  constructor(row = {}) {
    Object.assign(this, row);
  }

  static async create({
    shopId,
    orderId = null,
    providerCode,
    externalId,
    orderRef,
    amount,
    currency = 'UAH',
    isTest = false,
    redirectUrl,
    payload = {},
  }) {
    const { data, error } = await supabase
      .from('payment_invoices')
      .insert({
        shop_id: shopId,
        order_id: orderId,
        provider_code: providerCode,
        external_id: externalId,
        order_ref: orderRef,
        amount,
        currency,
        is_test: isTest,
        redirect_url: redirectUrl,
        payload,
      })
      .select()
      .single();
    if (error) throw new Error(`PaymentInvoice.create failed: ${error.message}`);
    return new PaymentInvoice(data);
  }

  static async findByExternalId(providerCode, externalId) {
    const { data, error } = await supabase
      .from('payment_invoices')
      .select('*')
      .eq('provider_code', providerCode)
      .eq('external_id', externalId)
      .maybeSingle();
    if (error) throw new Error(`PaymentInvoice.findByExternalId failed: ${error.message}`);
    return data ? new PaymentInvoice(data) : null;
  }

  static async findById(id) {
    const { data, error } = await supabase
      .from('payment_invoices')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`PaymentInvoice.findById failed: ${error.message}`);
    return data ? new PaymentInvoice(data) : null;
  }

  async setStatus(status, { webhook = null, failureReason = null } = {}) {
    const patch = { status };
    if (webhook != null) patch.webhook = webhook;
    if (failureReason != null) patch.failure_reason = failureReason;
    const { data, error } = await supabase
      .from('payment_invoices')
      .update(patch)
      .eq('id', this.id)
      .select()
      .single();
    if (error) throw new Error(`PaymentInvoice.setStatus failed: ${error.message}`);
    Object.assign(this, data);
    return this;
  }
}

module.exports = PaymentInvoice;
