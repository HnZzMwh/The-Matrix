// ============================================================
// UTILITIES — Shared helper functions
// ============================================================

// ─── TOAST ───
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>'); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
function timeAgo(ts) { const d=Date.now()-ts; if(d<60000)return'JUST NOW'; if(d<3600000)return Math.floor(d/60000)+'M AGO'; if(d<86400000)return Math.floor(d/86400000)+'D AGO'; return Math.floor(d/86400000)+'D AGO'; }

// ─── TOKEN USAGE PANEL ───
function fmtTokens(n) { return n.toLocaleString(); }

const USAGE_RANGES = [
  { key: '1h', label: '1HOUR' },
  { key: '1d', label: '1DAY' },
  { key: '7d', label: '7DAY' },
  { key: '1m', label: '1MONTH' },
];

function usagePad(n) { return String(n).padStart(2, '0'); }
function usageDateKey(ts) { return new Date(ts).toISOString().slice(0, 10); }
function usageTimeLabel(ts) {
  const d = new Date(ts);
  return usagePad(d.getHours())+':'+usagePad(d.getMinutes());
}
function usageDayLabel(ts) {
  const d = new Date(ts);
  return usagePad(d.getMonth()+1)+'-'+usagePad(d.getDate());
}

function emptyUsageBucket(start, end, label) {
  return { start, end, label, input: 0, output: 0, calls: 0 };
}

/**
 * Get per-agent usage for a date range — used for "Usage by Agent" display.
 */
function getAgentUsageForRange(rangeStart, rangeEnd, usage) {
  if (!usage) return {};

  // Use events for per-agent granularity within range
  const events = Array.isArray(usage.events) ? usage.events : [];
  const agentMap = {};

  for (const e of events) {
    if (!e || !e.ts || e.ts < rangeStart || e.ts > rangeEnd) continue;
    const agent = e.agent || '_unassigned';
    if (!agentMap[agent]) agentMap[agent] = { calls: 0, input: 0, output: 0, byModel: {} };
    agentMap[agent].calls++;
    agentMap[agent].input += e.input || 0;
    agentMap[agent].output += e.output || 0;
    const key = (e.provider || '') + ':' + (e.model || '');
    if (!agentMap[agent].byModel[key]) agentMap[agent].byModel[key] = { calls: 0, input: 0, output: 0 };
    agentMap[agent].byModel[key].calls++;
    agentMap[agent].byModel[key].input += e.input || 0;
    agentMap[agent].byModel[key].output += e.output || 0;
  }

  return agentMap;
}

// ── State ──────────────────────────────────────────────────
let usageSelectedRange = '7d';

function setUsageRange(rangeKey) {
  if (!USAGE_RANGES.some(r => r.key === rangeKey)) return;
  usageSelectedRange = rangeKey;
  renderTokenUsage();
}

/**
 * Bar chart bucket click: switch USAGE BY AGENT to the clicked bucket's range.
 * Re-renders so that USAGE BY AGENT and the main chart reflect the new range.
 */
function setUsageRangeFromBucket(index) {
  let bucketMs, count;
  if (usageSelectedRange === '1h') {
    bucketMs = 5 * 60 * 1000; count = 12;
  } else if (usageSelectedRange === '1d') {
    bucketMs = 60 * 60 * 1000; count = 24;
  } else if (usageSelectedRange === '1m') {
    bucketMs = 24 * 60 * 60 * 1000; count = 30;
  } else {
    bucketMs = 24 * 60 * 60 * 1000; count = 7;
  }

  const now = Date.now();
  let start;
  if (usageSelectedRange === '1h') {
    start = now - count * bucketMs;
  } else if (usageSelectedRange === '1d') {
    start = now - count * bucketMs;
  } else if (usageSelectedRange === '1m') {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    start = d.getTime() - (count - 1) * bucketMs;
  } else {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    start = d.getTime() - (count - 1) * bucketMs;
  }

  const bucketStart = start + index * bucketMs;
  const bucketEnd = bucketStart + bucketMs;

  // Override usageSelectedRange to a sentinel so render uses this exact range
  usageSelectedRange = '__custom__';
  usageCustomStart = bucketStart;
  usageCustomEnd = bucketEnd;
  renderTokenUsage();
}

/**
 * Get usage buckets for a date range [rangeStart, rangeEnd].
 * Uses daily buckets for ≤31 days, ~weekly for ≤93, monthly otherwise.
 */
function getUsageBucketsForRange(rangeStart, rangeEnd, usage) {
  const diffMs = rangeEnd - rangeStart;
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  let bucketMs, count;
  if (diffMs <= 31 * oneDay) {
    bucketMs = oneDay;
    count = Math.ceil(diffMs / oneDay);
  } else if (diffMs <= 93 * oneDay) {
    bucketMs = oneWeek;
    count = Math.ceil(diffMs / oneWeek);
  } else {
    bucketMs = 30 * oneDay;
    count = Math.ceil(diffMs / (30 * oneDay));
  }

  const buckets = [];
  for (let i = 0; i < count; i++) {
    const bStart = rangeStart + i * bucketMs;
    const bEnd = i === count - 1 ? rangeEnd + 1 : bStart + bucketMs;
    let label;
    if (bucketMs === oneDay) {
      label = usageDayLabel(bStart);
    } else if (bucketMs === oneWeek) {
      const s = new Date(bStart);
      const e = new Date(Math.min(bEnd - 1, rangeEnd));
      label = usagePad(s.getMonth()+1)+'-'+usagePad(s.getDate()) + ' → ' + usagePad(e.getMonth()+1)+'-'+usagePad(e.getDate());
    } else {
      const s = new Date(bStart);
      label = usagePad(s.getMonth()+1)+'月';
    }
    buckets.push(emptyUsageBucket(bStart, bEnd, label));
  }

  // Fill from daily data
  if (usage && usage.daily) {
    for (const bucket of buckets) {
      const dayData = usage.daily[usageDateKey(bucket.start)];
      if (dayData) {
        bucket.input = dayData.input || 0;
        bucket.output = dayData.output || 0;
        bucket.calls = dayData.calls || 0;
      }
    }
  }

  return buckets;
}

function renderTokenUsage() {
  const u = getTokenUsage();
  const body = document.getElementById('usage-body');
  if (!body) return;

  // ── Determine the effective date range ──
  let buckets, rangeLabel, rangeStart, rangeEnd;

  if (usageSelectedRange === '__custom__' && usageCustomStart !== null && usageCustomEnd !== null) {
    // Clicked a bar: use exact custom range
    rangeStart = usageCustomStart;
    rangeEnd = usageCustomEnd;
    rangeLabel = usageDateKey(rangeStart) + ' → ' + usageDateKey(rangeEnd);
    buckets = getUsageBucketsForRange(rangeStart, rangeEnd, u);
  } else {
    // Preset range
    const now = Date.now();
    let start;
    let bucketMs;
    let count;

    if (usageSelectedRange === '1h') {
      bucketMs = 5 * 60 * 1000;
      count = 12;
      start = now - count * bucketMs;
      rangeLabel = 'LAST 1 HOUR';
    } else if (usageSelectedRange === '1d') {
      bucketMs = 60 * 60 * 1000;
      count = 24;
      start = now - count * bucketMs;
      rangeLabel = 'TODAY';
    } else if (usageSelectedRange === '1m') {
      bucketMs = 24 * 60 * 60 * 1000;
      count = 30;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      start = d.getTime() - (count - 1) * bucketMs;
      rangeLabel = 'LAST 30 DAYS';
    } else {
      bucketMs = 24 * 60 * 60 * 1000;
      count = 7;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      start = d.getTime() - (count - 1) * bucketMs;
      rangeLabel = 'LAST 7 DAYS';
    }

    rangeStart = start;
    rangeEnd = now;

    const bucketsFromEvents = [];
    for (let i = 0; i < count; i++) {
      const bStart = start + i * bucketMs;
      const bEnd = i === count - 1 ? now + 1 : bStart + bucketMs;
      const label = bucketMs < 24 * 60 * 60 * 1000 ? usageTimeLabel(bStart) : usageDayLabel(bStart);
      bucketsFromEvents.push(emptyUsageBucket(bStart, bEnd, label));
    }

    const events = Array.isArray(u.events) ? u.events : [];
    if (usageSelectedRange === '7d' || usageSelectedRange === '1m') {
      for (const bucket of bucketsFromEvents) {
        const dayData = u.daily && u.daily[usageDateKey(bucket.start)];
        if (dayData) {
          bucket.input = dayData.input || 0;
          bucket.output = dayData.output || 0;
          bucket.calls = dayData.calls || 0;
        }
      }
      buckets = bucketsFromEvents;
    } else if (events.length > 0) {
      for (const e of events) {
        if (!e || e.ts < start || e.ts > now) continue;
        const idx = Math.min(count - 1, Math.max(0, Math.floor((e.ts - start) / bucketMs)));
        bucketsFromEvents[idx].input += e.input || 0;
        bucketsFromEvents[idx].output += e.output || 0;
        bucketsFromEvents[idx].calls += 1;
      }
      buckets = bucketsFromEvents;
    } else {
      buckets = bucketsFromEvents;
    }
  }

  const totalTokens = u.totalInput + u.totalOutput;

  // ── Summary row ──
  let html = '<div class="usage-summary">';
  html += '<div class="usage-stat"><div class="usage-stat-val">'+u.totalCalls+'</div><div class="usage-stat-label">Total Calls</div></div>';
  html += '<div class="usage-stat"><div class="usage-stat-val">'+totalTokens.toLocaleString()+'</div><div class="usage-stat-label">Total Tokens</div></div>';
  html += '</div>';

  // ── Abbreviated format for chart values (M/K) ──
  function fmtTokensShort(n) { if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return String(n); }

  // ── Range tabs only (no DATE RANGE) ──
  html += '<div class="usage-range-row">';
  html += '<div class="chart-section-title">Usage / '+rangeLabel+'</div>';
  html += '<div class="usage-range-tabs">';
  for (const r of USAGE_RANGES) {
    const isActive = (r.key === usageSelectedRange);
    html += '<button class="usage-range-tab '+(isActive ? 'active' : '')+'" onclick="setUsageRange(\''+r.key+'\')">'+r.label+'</button>';
  }
  html += '</div></div>';

  // ── Bar chart (overview — clickable bars drill down to USAGE BY AGENT; overview view follows range tabs) ──
  if (buckets.length === 0) {
    html += '<div class="chart-empty">No data for this period</div>';
  } else {
    const maxBucket = Math.max(1, ...buckets.map(b => b.input + b.output));
    html += '<div class="chart-row">';
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      const tokens = bucket.input + bucket.output;
      const pct = tokens / maxBucket * 100;
      html += '<div class="chart-col">';
      html += '<div class="chart-val">'+fmtTokensShort(tokens)+'</div>';
      html += '<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+pct+'%" onclick="setUsageRangeFromBucket('+i+')" title="'+bucket.label+'"></div></div>';
      html += '<div class="chart-label">'+bucket.label+'</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  // ── Per-agent bar chart (driven by time-range buttons / overview bar clicks) ──
  // Events give per-agent granularity within a specific range, but fall back
  // to byAgent (lifetime aggregation) if no events exist in the window.
  const agentMap = getAgentUsageForRange(rangeStart, rangeEnd, u) || {};
  const agentKeysInRange = Object.keys(agentMap).filter(k => k !== '_unassigned');
  if (agentKeysInRange.length === 0 && u.byAgent) {
    for (const k of Object.keys(u.byAgent)) {
      if (k !== '_unassigned') agentMap[k] = u.byAgent[k];
    }
  }

  const agentKeys = Object.keys(agentMap).filter(k => k !== '_unassigned');
  if (agentKeys.length > 0) {
    const maxAgent = Math.max(1, ...agentKeys.map(k => agentMap[k].input + agentMap[k].output));
    html += '<div class="chart-section-title">Usage by Agent</div>';
    html += '<div class="chart-row">';
    const sortedAgents = agentKeys.map(k => ({ id: k, data: agentMap[k] }))
      .sort((a, b) => (b.data.input + b.data.output) - (a.data.input + a.data.output));
    for (const { id, data } of sortedAgents) {
      const tokens = data.input + data.output;
      const pct = tokens / maxAgent * 100;
      const ag = agents.find(a => a.id === id);
      const label = ag ? ag.name : id;
      html += '<div class="chart-col">';
      html += '<div class="chart-val">'+fmtTokensShort(tokens)+'</div>';
      html += '<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+pct+'%" title="'+escapeHtml(label)+'"></div></div>';
      html += '<div class="chart-label" style="font-size:7px;">'+escapeHtml(label)+'</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  // ── Per-model breakdown ──
  const models = Object.values(u.byModel).sort((a, b) => b.cost - a.cost);
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 4px;">';
  html += '<span class="usage-table-hdr" style="margin:0;padding:0;border:0;">Usage by Model</span>';
  html += '<button class="modal-close" onclick="resetTokenUsage()" style="margin:0;float:none;">[ RESET ]</button>';
  html += '</div>';

  if (models.length === 0) {
    html += '<div style="color:#004400;padding:16px;text-align:center;">No usage records</div>';
  } else {
    for (const m of models) {
      const pct = totalTokens > 0 ? ((m.input + m.output) / totalTokens * 100).toFixed(1) : 0;
      html += '<div class="usage-model-row">';
      html += '<div><div class="usage-model-name">'+escapeHtml(m.provider)+' / '+escapeHtml(m.model)+'</div>';
      html += '<div class="usage-model-counts">'+m.calls+' calls · in '+m.input.toLocaleString()+' · out '+m.output.toLocaleString()+' ('+pct+'%)</div></div>';
      html += '</div>';
    }
  }

  body.innerHTML = html;
}

function resetTokenUsage() {
  showConfirmModal('Reset all token usage stats?', () => {
    saveTokenUsage(freshUsage());
    renderTokenUsage();
    showToast('Token stats reset');
  });
}

function showConfirmModal(msg, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const body = document.getElementById('confirm-body');
  const yes = document.getElementById('confirm-yes');
  const no = document.getElementById('confirm-no');
  if (!modal || !body || !yes || !no) return;
  body.textContent = msg;
  modal.classList.add('open');
  const cleanup = () => { modal.classList.remove('open'); yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); };
  const onYes = () => { cleanup(); if (onConfirm) onConfirm(); };
  const onNo = () => { cleanup(); };
  yes.addEventListener('click', onYes);
  no.addEventListener('click', onNo);
}

function closeUsagePanel() {
  document.getElementById('usage-panel').classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('usage-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      renderTokenUsage();
      document.getElementById('usage-panel').classList.add('active');
    });
  }
});
