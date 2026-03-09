/**
 * /api/rep — Rep event relay from ESP32 to Web App
 *
 * POST { quality, duration_ms, force_data[] } → ESP32 reports a completed rep
 * GET  ?since=<unix_ms>                        → Web app polls for new reps
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

    // ── POST: ESP32 reports a completed rep ──────────────────────────────────
    if (req.method === 'POST') {
        const { quality, duration_ms, force_data } = req.body || {};
        if (!quality) return res.status(400).json({ error: 'Missing quality' });

        const { error } = await supabase.from('device_rep_queue').insert({
            quality,
            duration_ms: duration_ms ?? 0,
            force_data: force_data ?? []
        });

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
    }

    // ── GET: Web app polls for new reps ──────────────────────────────────────
    if (req.method === 'GET') {
        const sinceMs = parseInt(req.query.since || '0');
        const sinceIso = new Date(sinceMs).toISOString();

        const { data, error } = await supabase
            .from('device_rep_queue')
            .select('*')
            .eq('consumed', false)
            .gt('created_at', sinceIso)
            .order('created_at', { ascending: true });

        if (error) return res.status(500).json({ error: error.message });

        if (data && data.length > 0) {
            // Mark all returned reps as consumed
            const ids = data.map(r => r.id);
            await supabase
                .from('device_rep_queue')
                .update({ consumed: true })
                .in('id', ids);
        }

        return res.status(200).json({
            reps: (data || []).map(r => ({
                quality: r.quality,
                duration_ms: r.duration_ms,
                force_data: r.force_data
            }))
        });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
