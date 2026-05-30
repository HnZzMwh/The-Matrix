// ============================================================
// APP — Bootstrap & Global State
// ============================================================

let userAvatarGenerated = false;

function enterWhiteRoom() {
  document.getElementById('white-room').classList.add('active');
  initAgents();
  renderSessionsRight();
  startMatrixRain();
  // Migrate old localStorage chats to IndexedDB (fire & forget)
  setTimeout(() => migrateLocalStorageToIndexedDB(), 100);
}

document.addEventListener('DOMContentLoaded', () => {
  // Init config UI (reads from localStorage cfg)
  initConfigUI();

  // Exit button
  document.getElementById('exit-btn').addEventListener('click', () => {
    if (confirm('Disconnect from the Matrix? Unsaved conversations will be lost.')) {
      stopFaceScan();
      saveCurrentAgentChat();
      document.getElementById('messages-area').innerHTML = '';
      updateEmptyChat();
      document.getElementById('save-status').style.display = 'none';
      document.getElementById('white-room').classList.remove('active');
      capturedFrame = null;
      userAvatarGenerated = false;
      // restart
      document.getElementById('loading-screen').style.display = 'grid';
      document.getElementById('loading-screen').style.opacity = '1';
      document.getElementById('loading-screen').style.transition = '';
      document.getElementById('wc1').innerHTML = '';
      document.getElementById('wc2').innerHTML = '';
      document.getElementById('wc3').innerHTML = '';
      Object.keys(WIN_LINES).forEach(id => populateWindow(id, WIN_LINES[id]));
      showLoadingLines();
      setTimeout(() => {
        document.getElementById('loading-screen').style.opacity = '0';
        document.getElementById('loading-screen').style.transition = 'opacity 0.8s';
        setTimeout(() => {
          document.getElementById('loading-screen').style.display = 'none';
          initCameraScreen();
        }, 800);
      }, 12000);
    }
  });
});

// Startup guide (console)
console.log('%c MATRIX UPLOAD // STARTUP GUIDE ', 'background:#000;color:#00ff41;font-size:14px;padding:4px');
console.log('%c 1. Start Ollama CPU mode:', 'color:#00ff41', '$env:OLLAMA_GPU_LAYER_COUNT=0; $env:OLLAMA_ORIGINS="*"; ollama serve');
console.log('%c 2. Load model:', 'color:#00ff41', 'ollama run qwen2.5:7b-instruct  (then Ctrl+D)');
console.log('%c 3. Start server:', 'color:#00ff41', 'python -m http.server 8080');
console.log('%c 4. Open:', 'color:#00ff41', 'http://localhost:8080/matrix-upload.html');
