// ============================================================
// API CONFIG PANEL UI — Single config (profile-backed)
// ============================================================

function setActiveTab(groupId, targetId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.dataset.target === targetId));
  const section = group.closest('.config-section') || document.querySelector('.config-modal');
  section.querySelectorAll('.provider-fields').forEach(f => f.classList.toggle('active', f.id === targetId));
}

function showConfigStatus(type, msg) {
  const el = document.getElementById('config-status');
  el.className = 'config-status ' + type;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function readConfigFields() {
  const llmActive = document.querySelector('#llm-tabs .ptab.active');
  const provider = llmActive ? llmActive.dataset.target.replace('llm-', '') : cfg.llmProvider;
  return {
    llmProvider: provider,
    claudeKey: document.getElementById('key-claude').value.trim(),
    openaiKey: document.getElementById('key-openai').value.trim(),
    openaiModel: document.getElementById('model-openai').value.trim() || 'gpt-4o',
    geminiKey: document.getElementById('key-gemini').value.trim(),
    llmCustomUrl: document.getElementById('llm-custom-url').value.trim(),
    llmCustomKey: document.getElementById('llm-custom-key').value.trim(),
    llmCustomModel: document.getElementById('llm-custom-model').value.trim(),
    ollamaUrl: document.getElementById('ollama-url').value.trim() || 'http://localhost:11434',
    ollamaModel: document.getElementById('ollama-model').value.trim() || 'qwen2.5:7b-instruct',
    llmMaxConcurrency: parseInt(document.getElementById('llm-max-concurrency')?.value) || 1,
    githubToken: document.getElementById('key-github-token')?.value.trim() || '',
  };
}

function writeConfigFields(fields) {
  document.getElementById('key-claude').value = fields.claudeKey || '';
  document.getElementById('key-openai').value = fields.openaiKey || '';
  document.getElementById('model-openai').value = fields.openaiModel || 'gpt-4o';
  document.getElementById('key-gemini').value = fields.geminiKey || '';
  document.getElementById('llm-custom-url').value = fields.llmCustomUrl || '';
  document.getElementById('llm-custom-key').value = fields.llmCustomKey || '';
  document.getElementById('llm-custom-model').value = fields.llmCustomModel || '';
  document.getElementById('ollama-url').value = fields.ollamaUrl || 'http://localhost:11434';
  const omv = fields.ollamaModel || '';
  document.getElementById('ollama-model').value = omv;
  const mc = document.getElementById('llm-max-concurrency');
  if (mc) mc.value = fields.llmMaxConcurrency || 1;
  const gt = document.getElementById('key-github-token');
  if (gt) gt.value = fields.githubToken || '';
  // Sync ollama model dropdown
  const omTrig = document.getElementById('cs-ollama-trigger');
  if (omTrig) {
    const omOpts = document.querySelectorAll('#cs-ollama-options .cs-opt');
    let omFound = false;
    omOpts.forEach(o => {
      const isMatch = o.dataset.value === omv;
      o.classList.toggle('selected', isMatch);
      if (isMatch) { omTrig.textContent = o.textContent; omFound = true; }
    });
    if (!omFound) omTrig.textContent = omv || '-- Select model --';
  }
  // Sync URL custom dropdown
  const u = fields.llmCustomUrl || '';
  const trigger = document.getElementById('cs-url-trigger');
  const opts = document.querySelectorAll('#cs-url-options .cs-opt');
  let found = false;
  opts.forEach(o => {
    const isMatch = o.dataset.value === u;
    o.classList.toggle('selected', isMatch);
    if (isMatch) { trigger.textContent = o.textContent; found = true; }
  });
    if (!found) trigger.textContent = u ? 'Custom...' : '-- Select preset --';
  // Sync provider tab
  const p = fields.llmProvider || 'ollama';
  setActiveTab('llm-tabs', 'llm-' + p);
}

async function testConnection() {
  showConfigStatus('ok', '// Testing connection...');
  const fields = readConfigFields();
  const saved = { ...cfg };
  Object.assign(cfg, fieldsToProfile(fields));
  try {
    const reply = await callLLM(
      [{ role: 'user', content: 'Reply "Connection OK" and nothing else.' }],
      'You are a test assistant.'
    );
    showConfigStatus('ok', '// Connection OK  Reply: "' + reply.slice(0, 30) + '"');
  } catch (e) {
    showConfigStatus('err', '// Connection failed: ' + (e.message || '').slice(0, 60));
  } finally {
    Object.assign(cfg, saved);
  }
}

async function detectOllamaModels() {
  const url = document.getElementById('ollama-url').value.trim() || 'http://localhost:11434';
  const trigger = document.getElementById('cs-ollama-trigger');
  const optionsEl = document.getElementById('cs-ollama-options');
  const input = document.getElementById('ollama-model');
  showConfigStatus('ok', '// Detecting Ollama models at ' + url + '...');
  try {
    const resp = await fetchWithTimeout(url.replace(/\/+$/, '') + '/api/tags', {}, 5000);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data.models || data.models.length === 0) {
      showConfigStatus('err', '// No models found. Is Ollama running?');
      return;
    }
    optionsEl.innerHTML = '<div class="cs-opt" data-value="">-- Select model --</div>';
    for (const m of data.models) {
      const opt = document.createElement('div');
      opt.className = 'cs-opt';
      opt.dataset.value = m.name;
      opt.textContent = m.name + (m.size ? ' (' + (m.size / 1e9).toFixed(1) + 'GB)' : '');
      optionsEl.appendChild(opt);
    }
    showConfigStatus('ok', '// Found ' + data.models.length + ' model(s)');
  } catch (e) {
    showConfigStatus('err', '// Detect failed: ' + (e.message || '').slice(0, 50));
  }
}

function initConfigUI() {
  // Load active profile fields into UI
  const activeName = getActiveProfileName();
  const fields = profileToFields(activeName);
  writeConfigFields(fields);

  // Provider tab switching
  document.querySelectorAll('.ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.closest('.provider-tabs').id;
      setActiveTab(groupId, btn.dataset.target);
    });
  });

  // Config panel toggle
  document.getElementById('config-trigger-inline').addEventListener('click', () => {
    const activeName = getActiveProfileName();
    const fields = profileToFields(activeName);
    writeConfigFields(fields);
    document.getElementById('config-panel').classList.toggle('active');
  });

  // Custom URL dropdown (div-based, full green styling)
  const urlInput = document.getElementById('llm-custom-url');
  const urlTrigger = document.getElementById('cs-url-trigger');
  const urlOptions = document.getElementById('cs-url-options');
  if (urlTrigger && urlOptions && urlInput) {
    urlTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      urlOptions.classList.toggle('show');
      urlTrigger.classList.toggle('open');
    });
    urlOptions.querySelectorAll('.cs-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const v = opt.dataset.value;
        urlOptions.querySelectorAll('.cs-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        urlTrigger.textContent = opt.textContent;
        urlOptions.classList.remove('show');
        urlTrigger.classList.remove('open');
        if (v === '__custom__') {
          urlInput.value = '';
          urlInput.focus();
        } else if (v) {
          urlInput.value = v;
        }
      });
    });
    // Close dropdown on outside click
    document.addEventListener('click', () => {
      urlOptions.classList.remove('show');
      urlTrigger.classList.remove('open');
    });
  }

  // Ollama model detect
  const detectBtn = document.getElementById('ollama-detect-btn');
  if (detectBtn) detectBtn.addEventListener('click', detectOllamaModels);
  const detectLink = document.getElementById('ollama-detect-link');
  if (detectLink) {
    detectLink.addEventListener('click', (e) => { e.preventDefault(); detectOllamaModels(); });
  }

  // Ollama model dropdown (div-based, Matrix green theme)
  const omInput = document.getElementById('ollama-model');
  const omTrigger = document.getElementById('cs-ollama-trigger');
  const omOptions = document.getElementById('cs-ollama-options');
  if (omTrigger && omOptions && omInput) {
    omTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      omOptions.classList.toggle('show');
      omTrigger.classList.toggle('open');
    });
    omOptions.addEventListener('click', (e) => {
      const opt = e.target.closest('.cs-opt');
      if (!opt) return;
      const v = opt.dataset.value;
      omOptions.querySelectorAll('.cs-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      omTrigger.textContent = opt.textContent;
      omOptions.classList.remove('show');
      omTrigger.classList.remove('open');
      if (v) omInput.value = v;
    });
    // Close dropdown on outside click
    document.addEventListener('click', () => {
      omOptions.classList.remove('show');
      omTrigger.classList.remove('open');
    });
  }

  // Save button
  document.getElementById('config-save-btn').addEventListener('click', () => {
    const activeName = getActiveProfileName();
    const fields = readConfigFields();
    saveProfile(activeName, fieldsToProfile(fields));
    activateProfile(activeName);
    showConfigStatus('ok', '// Saved');
  });

  // Test button
  document.getElementById('config-test-btn').addEventListener('click', testConnection);

  // Close button — auto-save
  document.getElementById('config-close-btn').addEventListener('click', () => {
    const activeName = getActiveProfileName();
    const fields = readConfigFields();
    saveProfile(activeName, fieldsToProfile(fields));
    activateProfile(activeName);
    document.getElementById('config-panel').classList.remove('active');
  });

  // Custom URL input syncs dropdown trigger text
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const u = urlInput.value.trim();
      const opts = document.querySelectorAll('#cs-url-options .cs-opt');
      let matched = false;
      opts.forEach(o => {
        if (o.dataset.value === u) { urlTrigger.textContent = o.textContent; o.classList.add('selected'); matched = true; }
        else o.classList.remove('selected');
      });
      if (!matched) urlTrigger.textContent = u ? 'Custom...' : '-- Select preset --';
    });
  }

  // Ollama model input syncs dropdown trigger text
  if (omInput) {
    omInput.addEventListener('input', () => {
      const v = omInput.value.trim();
      const opts = document.querySelectorAll('#cs-ollama-options .cs-opt');
      let matched = false;
      opts.forEach(o => {
        if (o.dataset.value === v) { omTrigger.textContent = o.textContent; o.classList.add('selected'); matched = true; }
        else o.classList.remove('selected');
      });
      if (!matched) omTrigger.textContent = v || '-- Select model --';
    });
  }

  // GitHub token verify
  const ghVerifyBtn = document.getElementById('github-verify-btn');
  const ghTokenInput = document.getElementById('key-github-token');
  const ghStatus = document.getElementById('github-token-status');
  if (ghVerifyBtn && ghTokenInput && ghStatus) {
    // Auto-check on load if token exists
    if (ghTokenInput.value.trim()) {
      verifyGitHubTokenUI(ghTokenInput.value.trim(), ghStatus);
    }
    ghVerifyBtn.addEventListener('click', () => {
      const token = ghTokenInput.value.trim();
      if (!token) { ghStatus.textContent = 'No token entered'; ghStatus.style.color = '#f88'; return; }
      ghStatus.textContent = 'Verifying...';
      ghStatus.style.color = '#ff0';
      verifyGitHubTokenUI(token, ghStatus);
    });
  }
}

async function verifyGitHubTokenUI(token, statusEl) {
  if (!token) { statusEl.textContent = 'No token'; statusEl.style.color = '#f88'; return; }
  try {
    // Save token temporarily so GitHub.verify() can use it
    const oldToken = cfg.githubToken;
    cfg.githubToken = token;
    const res = await window.GitHub.verify();
    if (res.ok) {
      statusEl.textContent = `✓ Verified as @${res.user}` + (res.name ? ` (${res.name})` : '');
      statusEl.style.color = '#0f0';
    } else {
      statusEl.textContent = `✗ ${res.error}`;
      statusEl.style.color = '#f88';
      cfg.githubToken = oldToken;
    }
  } catch (e) {
    statusEl.textContent = '✗ ' + (e.message || 'Verification failed');
    statusEl.style.color = '#f88';
  }
}