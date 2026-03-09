/**
 * /api/command — Command relay between phone app and ESP32
 *
 * POST  { type, cm }     → Phone enqueues a band-length command
 * GET                    → ESP32 polls; returns oldest pending command and marks it consumed
 */
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
    );
}

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getSupabase();

    // ── POST: Phone sends a command ──────────────────────────────────────────
    if (req.method === 'POST') {
        const { type, cm } = req.body || {};
        if (!type) return res.status(400).json({ error: 'Missing type' });

        const { error } = await supabase
            .from('device_commands')
            .insert({ type, params: { cm: cm ?? 0 } });

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    // ── GET: ESP32 polls for next pending command ────────────────────────────
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('device_commands')
            .select('*')
            .eq('consumed', false)
            .order('created_at', { ascending: true })
            .limit(1);

        if (error) return res.status(500).json({ error: error.message });
        if (!data || data.length === 0) return res.status(200).json({ type: 'none' });

        const cmd = data[0];
        // Mark consumed so we don't re-deliver it
        await supabase
            .from('device_commands')
            .update({ consumed: true })
            .eq('id', cmd.id);

        return res.status(200).json({
            type: cmd.type,
            cm: cmd.params?.cm ?? 0
        });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
