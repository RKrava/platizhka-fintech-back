const supabaseAdmin = require('../config/supabase');

function asPgResult(data) {
    return { rows: data || [], rowCount: Array.isArray(data) ? data.length : data ? 1 : 0 };
}

class Invoice {
    constructor({ id, status, storeid }) {
        this.id = id;
        this.status = status;
        this.storeid = storeid;
    }

    async save() {
        const { data, error } = await supabaseAdmin
            .from('mono_invoices')
            .insert({
                id: this.id,
                status: this.status,
                storeid: this.storeid,
            })
            .select('*');

        if (error) throw error;
        return asPgResult(data);
    }

    async changeStatus() {
        const { data, error } = await supabaseAdmin
            .from('mono_invoices')
            .update({ status: true })
            .eq('id', this.id)
            .select('*');

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('Invoice not found or already updated');
        }

        this.status = true;
        return asPgResult(data);
    }

    static async findById(id) {
        const { data, error } = await supabaseAdmin
            .from('mono_invoices')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        return data ? new Invoice(data) : null;
    }
}

module.exports = Invoice;
