const supabaseAdmin = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

function asPgResult(data) {
    return { rows: data || [], rowCount: Array.isArray(data) ? data.length : data ? 1 : 0 };
}

class InvoiceConnector {
    constructor({ id = null, mono_id = null, order_shopify_id = null, orderRef = null } = {}) {
        this.id = id;
        this.mono_id = mono_id;
        this.order_shopify_id = order_shopify_id;
        this.orderRef = orderRef;
    }

    static fromRow(row) {
        return row ? new InvoiceConnector(row) : null;
    }

    async createWithDbUuid() {
        return this.create();
    }

    async create() {
        const newId = this.id || uuidv4();

        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .insert({
                id: newId,
                mono_id: null,
                order_shopify_id: null,
                orderRef: null,
            })
            .select('*')
            .single();

        if (error) throw error;

        this.id = data.id;
        this.mono_id = data.mono_id;
        this.order_shopify_id = data.order_shopify_id;
        this.orderRef = data.orderRef;
        return this;
    }

    async addMonoId(monoId) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .update({ mono_id: monoId })
            .eq('id', this.id)
            .is('mono_id', null)
            .select('*')
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Connector not found or already has mono_id');

        this.mono_id = data.mono_id;
        this.order_shopify_id = data.order_shopify_id;
        this.orderRef = data.orderRef;
        return this;
    }

    async addShopifyOrderId(shopifyOrderId) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .update({ order_shopify_id: shopifyOrderId })
            .eq('id', this.id)
            .is('order_shopify_id', null)
            .select('*')
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Connector not found or already has order_shopify_id');

        this.mono_id = data.mono_id;
        this.order_shopify_id = data.order_shopify_id;
        this.orderRef = data.orderRef;
        return this;
    }

    async addOrderRef(orderRef) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .update({ orderRef })
            .eq('id', this.id)
            .is('orderRef', null)
            .select('*')
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Connector not found or already has orderRef');

        this.mono_id = data.mono_id;
        this.order_shopify_id = data.order_shopify_id;
        this.orderRef = data.orderRef;
        return this;
    }

    static async findById(id) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        return InvoiceConnector.fromRow(data);
    }

    static async findByMonoId(monoId) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .select('*')
            .eq('mono_id', monoId)
            .maybeSingle();

        if (error) throw error;
        return InvoiceConnector.fromRow(data);
    }

    static async findByShopifyOrderId(shopifyOrderId) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .select('*')
            .eq('order_shopify_id', shopifyOrderId)
            .maybeSingle();

        if (error) throw error;
        return InvoiceConnector.fromRow(data);
    }

    static async findByOrderRef(orderRef) {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .select('*')
            .eq('orderRef', orderRef)
            .maybeSingle();

        if (error) throw error;
        return InvoiceConnector.fromRow(data);
    }

    static async getUnusedConnectors() {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .select('*')
            .is('mono_id', null);

        if (error) throw error;
        return (data || []).map((row) => InvoiceConnector.fromRow(row));
    }

    async delete() {
        const { data, error } = await supabaseAdmin
            .from('invoice_connectors')
            .delete()
            .eq('id', this.id)
            .select('*');

        if (error) throw error;
        return asPgResult(data);
    }

    static async getConnectorData(connectorId) {
        const connector = await InvoiceConnector.findById(connectorId);
        if (!connector) return null;

        return {
            id: connector.id,
            mono_id: connector.mono_id,
            order_shopify_id: connector.order_shopify_id,
            orderRef: connector.orderRef,
        };
    }
}

module.exports = InvoiceConnector;
