// ============================================================
// API CONFIG PANEL UI
// ============================================================

function setActiveTab(groupId, targetId) {
  const group = document.getElementById(groupId);
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

async function testConnection() {
  showConfigStatus('ok', '// Testing connection...');
  cfg.claudeKey   = document.getElementById('key-claude').value.trim();
  cfg.openaiKey   = document.getElementById('key-openai').value.trim();
  cfg.openaiModel = document.getElementById('model-openai').value.trim() || 'gpt-4o';
  cfg.ollamaUrl   = document.getElementById('ollama-url').value.trim() || 'http://localhost:11434';
  cfg.ollamaModel = document.getElementById('ollama-model').value.trim() || 'llama3';
  cfg.geminiKey   = document.getElementById('key-gemini').value.trim();
  cfg.geminiVlmKey = document.getElementById('key-gemini-vlm').value.trim();
  try {
    const reply = await callLLM(
      [{ role: 'user', content: 'Reply "Connection OK" and nothing else.' }],
      'You are a test assistant.'
    );
    showConfigStatus('ok', `// Connection OK  Reply: "${reply.slice(0,30)}"`);
  } catch (e) {
    showConfigStatus('err', `// Connection failed: ${e.message.slice(0,60)}`);
  }
}

function initConfigUI() {
  // Load saved values into inputs
  if (cfg.claudeKey) document.getElementById('key-claude').value = cfg.claudeKey;
  if (cfg.openaiKey) document.getElementById('key-openai').value = cfg.openaiKey;
  if (cfg.openaiModel) document.getElementById('model-openai').value = cfg.openaiModel;
  if (cfg.ollamaUrl) document.getElementById('ollama-url').value = cfg.ollamaUrl;
  if (cfg.ollamaModel) document.getElementById('ollama-model').value = cfg.ollamaModel;
  if (cfg.geminiKey) document.getElementById('key-gemini').value = cfg.geminiKey;
  if (cfg.geminiVlmKey) document.getElementById('key-gemini-vlm').value = cfg.geminiVlmKey;
  if (cfg.llmCustomUrl) document.getElementById('llm-custom-url').value = cfg.llmCustomUrl;
  if (cfg.llmCustomKey) document.getElementById('llm-custom-key').value = cfg.llmCustomKey;
  if (cfg.llmCustomModel) document.getElementById('llm-custom-model').value = cfg.llmCustomModel;
  if (cfg.vlmCustomUrl) document.getElementById('vlm-custom-url').value = cfg.vlmCustomUrl;
  if (cfg.vlmCustomKey) document.getElementById('vlm-custom-key').value = cfg.vlmCustomKey;
  if (cfg.vlmCustomModel) document.getElementById('vlm-custom-model').value = cfg.vlmCustomModel;
  if (cfg.googleSearchKey) document.getElementById('key-google-search').value = cfg.googleSearchKey;
  if (cfg.googleSearchCx) document.getElementById('key-google-cx').value = cfg.googleSearchCx;

  // Set active tabs
  setActiveTab('llm-tabs', 'llm-' + cfg.llmProvider);
  setActiveTab('vlm-tabs', 'vlm-' + cfg.vlmProvider);

  // Provider tab switching
  document.querySelectorAll('.ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.closest('.provider-tabs').id;
      setActiveTab(groupId, btn.dataset.target);
    });
  });

  // Config panel toggle
  document.getElementById('config-trigger-inline').addEventListener('click', () => {
    document.getElementById('config-panel').classList.toggle('active');
  });

  // Save button
  document.getElementById('config-save-btn').addEventListener('click', () => {
    cfg.claudeKey   = document.getElementById('key-claude').value.trim();
    cfg.openaiKey   = document.getElementById('key-openai').value.trim();
    cfg.openaiModel = document.getElementById('model-openai').value.trim() || 'gpt-4o';
    cfg.ollamaUrl   = document.getElementById('ollama-url').value.trim() || 'http://localhost:11434';
    cfg.ollamaModel = document.getElementById('ollama-model').value.trim() || 'llama3';
    cfg.geminiKey   = document.getElementById('key-gemini').value.trim();
    cfg.geminiVlmKey = document.getElementById('key-gemini-vlm').value.trim();
    cfg.llmCustomUrl   = document.getElementById('llm-custom-url').value.trim();
    cfg.llmCustomKey   = document.getElementById('llm-custom-key').value.trim();
    cfg.llmCustomModel = document.getElementById('llm-custom-model').value.trim();
    cfg.vlmCustomUrl   = document.getElementById('vlm-custom-url').value.trim();
    cfg.vlmCustomKey   = document.getElementById('vlm-custom-key').value.trim();
    cfg.vlmCustomModel = document.getElementById('vlm-custom-model').value.trim();
    cfg.googleSearchKey = document.getElementById('key-google-search').value.trim();
    cfg.googleSearchCx  = document.getElementById('key-google-cx').value.trim();

    const llmActive = document.querySelector('#llm-tabs .ptab.active');
    if (llmActive) cfg.llmProvider = llmActive.dataset.target.replace('llm-', '');
    const vlmActive = document.querySelector('#vlm-tabs .ptab.active');
    if (vlmActive) cfg.vlmProvider = vlmActive.dataset.target.replace('vlm-', '');

    saveCfg();
    showConfigStatus('ok', '// Configuration saved //');
  });

  // Close button
  document.getElementById('config-close-btn').addEventListener('click', () => {
    document.getElementById('config-panel').classList.remove('active');
  });

  // Test button
  document.getElementById('config-test-btn').addEventListener('click', testConnection);
}
