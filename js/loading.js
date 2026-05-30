// ============================================================
// BOOT SEQUENCE — Rich loading screen with dense activity logs
// ============================================================

const GLITCH_CHARS = '01アイウエオ@#$%&ABCDEFabcdef<>{}[]';

function randGlitch(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
  return s;
}

function randHex(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return s;
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Simulated progress (drives the mapping progress bar) ──
// Speed: hits ~80% in ~5s, then coasts to 100% in ~7s total
let simProgress = 0;

// ─── Massive boot log data ──────────────────────────────────
const WIN_LINES = {
  wc1: [
    // Kernel / system init
    'INIT cortex_bridge_v9.4.2',
    'loading kernel modules...',
    '  ├── quantum_crypto.ko [OK]',
    '  ├── neural_bridge.ko   [OK]',
    '  ├── reality_filter.ko  [OK]',
    '  └── matrix_protocol.ko [OK]',
    '__MAPPING_PROGRESS__',
    '  path CA3→DG: 47.2M synapses mapped',
    '  path V1→MT: 12.8M synapses mapped',
    '  path PFC→ACC: 89.1M synapses mapped',
    'calibrating synapse channels...',
    '  channel_00: latency 0.04ms [NOMINAL]',
    '  channel_01: latency 0.12ms [NOMINAL]',
    '  channel_02: latency 1.84ms [WARN] → recalibrated',
    '  channel_03: latency 0.08ms [NOMINAL]',
    'quantum encryption active',
    '  algorithm: Kyber-1024 + Dilithium-5',
    '  key exchange: 4.2μs',
    '  session key: ' + randHex(32),
    'IDENTITY HASH: ' + randGlitch(16),
    'consciousness packet size: 4.2 EB',
    'establishing neural handshake...',
    '  handshake: ACK_RECEIVED',
    '  signal_strength: -42 dBm',
    '  packet_loss: 0.003%',
    'BRIDGE STATUS: OPERATIONAL',
  ],
  wc2: [
    // Consciousness upload
    'scanning consciousness layers...',
    '  layer_0: ego       [FOUND]  size: 127.3 MB',
    '  layer_1: memory    [FOUND]  size: 4.2 GB',
    '  layer_2: emotion   [FOUND]  size: 832.5 MB',
    '  layer_3: subconscious [FOUND] size: 18.7 GB',
    '  layer_4: archetype [FOUND]  size: 2.1 GB',
    'reading ego_layer.dat...',
    '  parsing identity fragments... ' + randInt(420, 890) + ' fragments found',
    '  self_reference: OK',
    '  narrative_coherence: 98.7%',
    'reading memory_core.bin...',
    '  episodic: 12,847 records',
    '  semantic: 94,221 records',
    '  procedural: 3,409 records',
    'reading emotional_matrix.sig...',
    '  primary emotions: 6/6 [PRESENT]',
    '  secondary emotions: 24/24 [PRESENT]',
    '  emotional_depth_rating: 0.92',
    'reading subconscious_pool.raw...',
    '  dreams.dat: 847 entries',
    '  intuition_cache: 2.1 GB',
    '  deja_vu_fragments: ' + randInt(12, 47) + ' found',
    'compressing soul_fragment_01... ████████████████░░ 82%',
    '__UPLOAD_PROGRESS__',
    'verifying checksums...',
    '  SHA-4096: ' + randHex(64),
    '  BLAKE3:   ' + randHex(64),
    '  integrity: PASS',
    'UPLOAD: OK',
  ],
  wc3: [
    'ARCHITECT      // SYSTEM ORCHESTRATOR          // Monitor & reset agents, optimize costs',
    'MORPHEUS       // PRODUCT OWNER                // Plan tasks, coordinate agent team',
    'ORACLE         // RAG DATA SCIENTIST           // Search knowledge, predict bottlenecks',
    'KEYMAKER       // API GATEWAY                  // Provision tokens, secure API routes',
    'ANDERSON       // STAFF ENGINEER               // Read & write code, implement features',
    'SMITH          // SECURITY AUDITOR             // Audit code, chaos & penetration tests',
    'DEBUGGER       // ROOT CAUSE ANALYST           // Trace errors, diagnose runtime, fix root cause',
    'TRINITY        // DEVOPS ENGINEER              // Build, test, package & deploy pipeline',
  ],
};

// ─── Progress bar render helper ─────────────────────────────
function renderBar(pct) {
  const filled = Math.floor(pct / 5);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(20 - filled) + '] ' + Math.floor(pct) + '%';
}

// ─── Elaborate line rendering ───────────────────────────────
async function populateWindow(id, lines) {
  const el = document.getElementById(id);

  for (let i = 0; i < lines.length; i++) {
    await sleep(80 + Math.random() * 120);

    // ── Special: Mapping progress bar ──
    if (lines[i] === '__MAPPING_PROGRESS__') {
      const lineDiv = document.createElement('div');
      const span = document.createElement('span');
      lineDiv.appendChild(span);
      el.appendChild(lineDiv);
      el.scrollTop = el.scrollHeight;

      const label = 'mapping neural pathways...  [';
      span.textContent = label + renderBar(0);

      let lastPct = 0;
      const progInterval = setInterval(() => {
        const pct = Math.floor(simProgress);
        if (pct > lastPct) {
          lastPct = pct;
          span.textContent = label + renderBar(pct);
          el.scrollTop = el.scrollHeight;
        }
        if (pct >= 100) {
          span.textContent = label + renderBar(100);
          span.className = 'bright';
          clearInterval(progInterval);
          const okSpan = document.createElement('span');
          okSpan.className = 'bright';
          okSpan.textContent = ' OK';
          lineDiv.appendChild(okSpan);
        }
      }, 150);
      continue;
    }

    // ── Special: Animated upload progress bar ──
    if (lines[i] === '__UPLOAD_PROGRESS__') {
      const lineDiv = document.createElement('div');
      const labelSpan = document.createElement('span');
      const barSpan = document.createElement('span');
      lineDiv.appendChild(labelSpan);
      lineDiv.appendChild(document.createTextNode(' '));
      lineDiv.appendChild(barSpan);
      el.appendChild(lineDiv);

      const label = '> UPLOAD PROGRESS:';
      for (let j = 0; j < label.length; j++) {
        labelSpan.textContent = label.slice(0, j + 1);
        await sleep(8 + Math.random() * 15);
      }
      labelSpan.style.color = 'var(--matrix-green)';
      el.scrollTop = el.scrollHeight;

      const totalSteps = 45;
      for (let s = 0; s <= totalSteps; s++) {
        const pct = (s / totalSteps) * 100;
        const speed = s < totalSteps * 0.3 ? 40 + Math.random() * 30
                   : s < totalSteps * 0.7 ? 60 + Math.random() * 50
                   : s < totalSteps * 0.9 ? 80 + Math.random() * 60
                   : 150 + Math.random() * 80;

        // Simulate stutter / stall
        if (s > totalSteps * 0.4 && Math.random() < 0.05) await sleep(200 + Math.random() * 400);

        const filled = Math.floor(pct / 5);
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(20 - filled);
        barSpan.textContent = `[${bar}] ${Math.floor(pct)}%`;
        barSpan.style.color = pct < 40 ? '#006622'
                            : pct < 75 ? '#00aa2a'
                            : 'var(--matrix-green)';
        el.scrollTop = el.scrollHeight;
        await sleep(speed);
      }
      barSpan.textContent = '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] 100%';
      barSpan.className = 'bright';
      el.scrollTop = el.scrollHeight;

      const statusSpan = document.createElement('span');
      statusSpan.className = 'mid';
      lineDiv.appendChild(statusSpan);
      for (let d = 0; d < 5; d++) {
        statusSpan.textContent = d % 2 === 0 ? ' ...' : '    ';
        await sleep(100);
      }
      statusSpan.textContent = ' OK';
      statusSpan.className = 'bright';
      el.scrollTop = el.scrollHeight;
      continue;
    }

    // ── Normal line ──
    const lineDiv = document.createElement('div');
    const text = '> ' + lines[i];
    const prefixSpan = document.createElement('span');
    lineDiv.appendChild(prefixSpan);
    el.appendChild(lineDiv);

    // Stream the text character by character
    for (let j = 0; j < text.length; j++) {
      prefixSpan.textContent = text.slice(0, j + 1);
      const r = Math.random();
      prefixSpan.style.color = r > 0.7 ? '#00ff41' : r > 0.3 ? '#00cc33' : '#005500';
      await sleep(6 + Math.random() * 12);
    }
    el.scrollTop = el.scrollHeight;

    // Status dots animation
    const statusSpan = document.createElement('span');
    statusSpan.className = 'mid';
    lineDiv.appendChild(statusSpan);
    for (let d = 0; d < 5; d++) {
      statusSpan.textContent = d % 2 === 0 ? ' ...' : '    ';
      await sleep(120);
    }

    statusSpan.textContent = ' OK';
    statusSpan.className = 'bright';
    el.scrollTop = el.scrollHeight;
  }
}

// ─── Horizontal scrolling activity log (rich) ──────────────
function buildHScroll() {
  const phrases = [
    '// NEO_PROTOCOL ACTIVE //',
    '// CONSCIOUSNESS UPLOADING //',
    '// MATRIX_SKIN: LEATHER_BLACK //',
    '// SUNGLASSES EQUIPPED //',
    '// NEURAL_LINK: ESTABLISHED //',
    '// QUANTUM_KEY: ' + randHex(8) + ' //',
    '// BANDWIDTH: 4.2 EB/s //',
    '// PACKET_LOSS: 0.003% //',
    '// HOST ENTERING MATRIX //',
    '// IDENTITY_HASH: ' + randHex(12) + ' //',
    '// REALITY_BYPASS: ENGAGED //',
    '// RED PILL EFFECT ACTIVE //',
    '// ENCRYPTION: POST_QUANTUM //',
    '// SYNAPSE_COUNT: 89.1M //',
    '// LATENCY: 0.04ms //',
    '// SIGNAL: -42 dBm //',
    '// SYSTEM_CLOCK: ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' //',
    '// FIRMWARE: v9.4.2 //',
    '// AGENT_CORES: ONLINE //',
    '// CONSCIOUSNESS_FRAGMENTS: 847 //',
    '// EMOTIONAL_DEPTH: 0.92 //',
    '// NARRATIVE_COHERENCE: 98.7% //',
  ];
  const line = document.getElementById('h-scroll');
  if (!line) return;
  // Triple the content for seamless loop
  const full = phrases.map(p => p.replace('//', '').replace('//', '').trim()).join('  //  ');
  line.textContent = full + '  //  ' + full + '  //  ' + full;
}

// ─── Bottom status lines ────────────────────────────────────
function showLoadingLines() {
  const lines = [
    { id: 'ls-line1', text: 'HOST ENTERING THE MATRIX', delay: 1200 },
    { id: 'ls-line2', text: 'INITIALIZING CONSCIOUSNESS', delay: 2500 },
  ];

  lines.forEach(({ id, text, delay }) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.style.transition = 'opacity 0.5s, text-shadow 0.5s';
      el.style.opacity = '1';
      el.style.textShadow = '0 0 12px #00ff41';
    }, delay);
  });
}

// ============================================================
// BOOT SEQUENCE
// ============================================================
Object.keys(WIN_LINES).forEach(id => populateWindow(id, WIN_LINES[id]));
showLoadingLines();
buildHScroll();

// Drive progress: ~5s to 80%, ~7s total to 100%
const bootStart = Date.now();
const progDriver = setInterval(() => {
  if (simProgress >= 100) { clearInterval(progDriver); return; }
  const elapsed = (Date.now() - bootStart) / 1000;
  // Logistic-like curve: fast early, slower later
  const target = elapsed < 1 ? elapsed * 20
              : elapsed < 3 ? 20 + (elapsed - 1) * 18
              : elapsed < 5 ? 56 + (elapsed - 3) * 12
              : elapsed < 7 ? 80 + (elapsed - 5) * 8
              : elapsed < 9 ? 96 + (elapsed - 7) * 2
              : 100;
  simProgress = Math.min(100, simProgress + (target - simProgress) * 0.35 + 0.2);
}, 100);

// Wait for progress 100% AND windows done, then transition
(async () => {
  while (true) {
    await sleep(200);
    const wc1 = document.getElementById('wc1');
    const wc2 = document.getElementById('wc2');
    const wc3 = document.getElementById('wc3');
    const wcDone = wc1 && wc1.children.length >= WIN_LINES.wc1.length
                && wc2 && wc2.children.length >= WIN_LINES.wc2.length
                && wc3 && wc3.children.length >= WIN_LINES.wc3.length;
    const pct = Math.floor(simProgress);
    if (pct >= 100 && wcDone) break;
    if (Date.now() - bootStart > 10000) break; // safety timeout
  }
  clearInterval(progDriver);
  await sleep(300);
  document.getElementById('loading-screen').style.opacity = '0';
  document.getElementById('loading-screen').style.transition = 'opacity 0.8s';
  setTimeout(() => {
    document.getElementById('loading-screen').style.display = 'none';
    initCameraScreen();
  }, 800);
})();
