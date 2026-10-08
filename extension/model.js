export function summarize(data, now) {
    const sessions = Object.entries(data?.sessions ?? {})
        .filter(([,s]) => s && Number.isFinite(s.updated) && now - s.updated < 86400)
        .map(([id,s]) => ({...s, id,
            status: now - s.updated > 900 && ['working','thinking'].includes(s.status)
                ? 'stale' : s.status === 'finished' && now - s.updated > 8 ? 'idle' : s.status}))
        .sort((a,b) => b.updated - a.updated);
    const active = sessions.filter(s => ['working','thinking'].includes(s.status));
    const status = active.length ? (active.some(s=>s.status==='working') ? 'working' : 'thinking')
        : sessions.some(s=>s.status==='error') ? 'error'
        : sessions.some(s=>s.status==='finished') ? 'finished'
        : sessions.some(s=>s.status==='stale') ? 'stale' : 'idle';
    return {sessions, active:active.length, status};
}

export function visibleSessions(result, {maxSessions = 6, activeOnly = false} = {}) {
    const busy = s => ['working', 'thinking'].includes(s.status);
    return result.sessions.filter(s => !activeOnly || busy(s))
        .sort((a,b) => Number(busy(b)) - Number(busy(a)) || b.updated - a.updated)
        .slice(0, Math.max(1, Math.min(12, maxSessions)));
}

export function usageWindows(data) {
    const buckets = data?.rateLimitsByLimitId && Object.keys(data.rateLimitsByLimitId).length
        ? Object.entries(data.rateLimitsByLimitId) : [['codex', data?.rateLimits ?? {}]];
    return buckets.flatMap(([id, bucket]) => ['primary','secondary'].map((key,index) => {
        const w = bucket?.[key];
        const mins = w?.windowDurationMins;
        const label = mins === 10080 ? 'Mingguan' : Number.isFinite(mins) && mins > 0
            ? mins % 60 === 0 ? `${mins/60} jam` : `${mins} menit`
            : index === 0 ? 'Batas utama' : 'Batas tambahan';
        return {id, label, remaining:Number.isFinite(w?.usedPercent)
            ? Math.max(0,Math.min(100,100-w.usedPercent)) : null,
            resetsAt:Number.isFinite(w?.resetsAt) ? w.resetsAt : null};
    }));
}

export function applyMessage(messages, event) {
    const id = event.itemId || 'message';
    messages[id] = (event.event === 'message' ? event.text : (messages[id] ?? '') + event.text).slice(0,16000);
}
