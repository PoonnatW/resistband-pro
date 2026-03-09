/**
 * /api/status — Device heartbeat and online check
 *
 * POST { status }  → ESP32 posts current state ("ready", "moving", "workout")
 * GET              → Web app checks if device is online + its current state
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

// Device is considered online if it pinged in the last 15 seconds
const ONLINE_TIMEOUT_MS = 15000;

module.exports = async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getSupabase();

    // ── POST: ESP32 heartbeat ─────────────────────────────────────────────────
    if (req.method === 'POST') {
        const { status } = req.body || {};
        if (!status) return res.status(400).json({ error: 'Missing status' });

        const { error } = await supabase.from('device_status').upsert({
            id: 1,
            status,
            last_seen_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    // ── GET: Web app checks device status ────────────────────────────────────
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('device_status')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(200).json({ status: 'offline', online: false });

        const lastSeenMs = new Date(data.last_seen_at).getTime();
        const online = Date.now() - lastSeenMs < ONLINE_TIMEOUT_MS;

        return res.status(200).json({
            status: data.status,
            online,
            last_seen_at: data.last_seen_at
        });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
