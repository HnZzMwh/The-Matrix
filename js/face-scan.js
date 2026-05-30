// ============================================================
// FACE LOCK — Biometric authentication + feature scan
// ============================================================

let capturedFrame = null;
let cameraStream = null;
let fsAnimId = null;
let fsRunning = false;
let fsAuthFailed = false;
let fsPasswordOK = false;
let fsAllTasksDone = false;
let fsSmoothProgress = 0;
let fsHasFacePrint = false;   // whether a face print is saved

const FACE_PRINT_KEY = 'matrix_face_print';

// ─── Face print (biometric signature) ───────────────────────
// Extract a set of normalized facial proportions from MediaPipe landmarks
function extractFacePrint(landmarks) {
  const lm = landmarks;
  const get = i => ({ x: lm[i].x, y: lm[i].y, z: lm[i].z });

  const nose     = get(1);
  const lEyeO    = get(33);
  const lEyeI    = get(133);
  const rEyeO    = get(263);
  const rEyeI    = get(362);
  const lMouth   = get(61);
  const rMouth   = get(291);
  const chin     = get(199);
  const brow     = get(10);
  const nBridge  = get(168);

  // Inter-ocular distance (scale normalization factor)
  const eyeDist = Math.sqrt((rEyeO.x - lEyeO.x) ** 2 + (rEyeO.y - lEyeO.y) ** 2);
  if (eyeDist < 0.01) return null; // face too small/far

  const norm = v => v / eyeDist;
  const dx = (a, b) => a.x - b.x;
  const dy = (a, b) => a.y - b.y;
  const dist = (a, b) => Math.sqrt(dx(a,b)**2 + dy(a,b)**2);
  const dz = (a, b) => a.z - b.z;

  return [
    norm(dist(nose, nBridge)),           // 0: nose bridge length
    norm(dist(lEyeI, rEyeI)),            // 1: inner eye distance
    norm(dist(lEyeO, rEyeO)),            // 2: outer eye distance
    norm(dist(lMouth, rMouth)),          // 3: mouth width
    norm(dist(chin, brow)),              // 4: face height
    norm(dist(nose, lMouth)),            // 5: nose to left mouth
    norm(dist(nose, rMouth)),            // 6: nose to right mouth
    norm(dist(chin, nose)),              // 7: chin to nose
    norm(dist(nose, brow)),              // 8: nose to brow
    norm(dz(nose, nBridge)),             // 9: nose bridge depth
    norm(dz(lEyeO, rEyeO)),             // 10: eye depth difference
    norm(dist(lEyeO, nBridge)),          // 11: left eye to bridge
    norm(dist(rEyeO, nBridge)),          // 12: right eye to bridge
  ];
}

function compareFacePrints(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let totalDiff = 0;
  for (let i = 0; i < a.length; i++) {
    totalDiff += Math.abs(a[i] - b[i]);
  }
  const avgDiff = totalDiff / a.length;
  // Convert to similarity percentage: 0 diff = 100%, 0.3 diff = 0%
  return Math.max(0, Math.round((1 - Math.min(avgDiff, 0.3) / 0.3) * 100));
}

function saveFacePrint(print) {
  try {
    localStorage.setItem(FACE_PRINT_KEY, JSON.stringify(print));
    fsHasFacePrint = true;
    return true;
  } catch(e) { return false; }
}

function loadFacePrint() {
  try {
    const raw = localStorage.getItem(FACE_PRINT_KEY);
    if (!raw) { fsHasFacePrint = false; return null; }
    fsHasFacePrint = true;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

function clearFacePrint() {
  localStorage.removeItem(FACE_PRINT_KEY);
  fsHasFacePrint = false;
}

// Scan tasks for the real scan
const SCAN_TASKS = [
  { label: 'DETECTING FACE...', done: false },
  { label: 'ROTATE HEAD SLOWLY...', done: false },
  { label: 'MOVE CLOSER...', done: false },
  { label: 'MOVE BACK...', done: false },
  { label: 'FACE CAPTURED', done: false },
];

function initCameraScreen() {
  fsAuthFailed = false;
  fsPasswordOK = false;
  fsAllTasksDone = false;
  SCAN_TASKS.forEach(t => t.done = false);

  const screen = document.getElementById('upload-screen');
  screen.classList.add('active');

  // Show camera start overlay — wait for user click
  const overlay = document.getElementById('fs-camera-overlay');
  if (overlay) overlay.style.display = 'flex';

  // Set the initial stage label
  document.getElementById('fs-stage-label').textContent = 'WAITING FOR CAMERA...';
  document.getElementById('fs-hdr-status').innerHTML = '<span class="blink">▌</span> STANDBY';

  // Reset progress bar
  document.getElementById('fs-prog-fill').style.width = '0%';
  document.getElementById('fs-prog-pct').textContent = '0%';
  document.getElementById('fs-dv-verts').textContent = '0';
  document.getElementById('fs-dv-depth').textContent = '---';
  document.getElementById('fs-dv-lm').textContent = '0 / 68';
  document.getElementById('fs-dv-conf').textContent = '0%';

  // Hide any previous error modal
  const modal = document.getElementById('auth-error-modal');
  if (modal) modal.classList.remove('open');
}

// ─── Auth failure modal ────────────────────────────────────
function showAuthError() {
  // Update modal text based on whether a face print exists
  const iconEl = document.querySelector('#auth-error-modal .auth-error-icon');
  const textEl = document.querySelector('#auth-error-modal .auth-error-text');
  const hintEl = document.querySelector('#auth-error-modal .auth-error-hint');

  if (fsHasFacePrint) {
    // Face exists but doesn't match
    if (iconEl) iconEl.textContent = '⚠';
    if (textEl) textEl.innerHTML = 'FACE RECOGNITION FAILED.<br>YOUR FACE DOES NOT MATCH THE REGISTERED PROFILE.<br>ACCESS DENIED.';
    if (hintEl) hintEl.textContent = '// ENTER EMERGENCY ACCESS KEY //';
  } else {
    // First time — no face registered yet
    if (iconEl) iconEl.textContent = '';
    if (textEl) textEl.innerHTML = 'NO BIOMETRIC DATA FOUND.<br>THIS IS YOUR FIRST ACCESS.<br>ENTER ACCESS KEY TO REGISTER YOUR FACE.';
    if (hintEl) hintEl.textContent = '// ENTER SYSTEM ACCESS KEY //';
  }

  const modal = document.getElementById('auth-error-modal');
  if (modal) modal.classList.add('open');
}

function closeAuthError() {
  const modal = document.getElementById('auth-error-modal');
  if (modal) modal.classList.remove('open');
  // Focus the password input
  const pwInput = document.getElementById('auth-password-input');
  if (pwInput) pwInput.focus();
}

function checkPassword() {
  const input = document.getElementById('auth-password-input');
  const val = input.value.trim().toUpperCase();
  const errEl = document.getElementById('auth-password-error');

  if (val === 'RED') {
    fsPasswordOK = true;
    closeAuthError();
    startRealFaceScan();
  } else {
    errEl.textContent = '// ACCESS DENIED // INVALID KEY //';
    errEl.style.display = 'block';
    input.value = '';
    input.focus();
    // Shake animation
    input.style.animation = 'none';
    input.offsetHeight;
    input.style.animation = 'shake 0.4s ease';
  }
}

// ─── First stage: biometric authentication ──────────────────
function initFaceLock() {
  try {
    const overlay = document.getElementById('fs-camera-overlay');
    if (overlay) overlay.style.display = 'none';

    fsRunning = true;
    const video = document.getElementById('camera-video');
    if (!video) { showToast('// CAMERA ELEMENT NOT FOUND //'); return; }
    if (typeof FaceMesh === 'undefined') { showToast('// FACE MESH LIBRARY NOT LOADED //'); return; }
    if (typeof Camera === 'undefined') { showToast('// CAMERA LIBRARY NOT LOADED //'); return; }

    document.getElementById('fs-stage-label').textContent = 'SCANNING FACE...';
    document.getElementById('fs-hdr-status').innerHTML = '<span class="blink">▌</span> AUTHENTICATING';

    loadFacePrint(); // Check if we have a registered face

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });

    let stableFrames = 0;
    let bestMatch = 0;
    let matched = false;

    faceMesh.onResults((results) => {
      if (!fsRunning || fsPasswordOK || matched) return;
      fsUpdateParticles();
      fsDrawFX();
      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const lms = results.multiFaceLandmarks[0];
        fsDrawFaceMesh(lms);
        stableFrames++;

        // Real-time display: match percentage or NEW FACE
        const currentPrint = extractFacePrint(lms);
        if (currentPrint) {
          const savedPrint = loadFacePrint();
          if (savedPrint) {
            const sim = compareFacePrints(currentPrint, savedPrint);
            bestMatch = Math.max(bestMatch, sim);
            document.getElementById('fs-dv-depth').textContent = sim + '% match';
            document.getElementById('fs-dv-conf').textContent = Math.min(99, Math.floor(stableFrames * 1.5)) + '%';
          } else {
            document.getElementById('fs-dv-depth').textContent = 'NEW FACE';
            document.getElementById('fs-dv-conf').textContent = 'SCANNING';
          }
        }

        // After ~2 seconds (60 frames), decide
        if (stableFrames > 60) {
          if (fsHasFacePrint) {
            if (bestMatch >= 55) {
              matched = true;
              fsPasswordOK = true;
              document.getElementById('fs-stage-label').textContent = 'IDENTITY CONFIRMED';
              document.getElementById('fs-hdr-status').innerHTML = '<span class="blink">▌</span> AUTHORIZED';
              document.getElementById('fs-dv-conf').textContent = '98%';
              setTimeout(() => { stopFaceScan(); startTransition(); }, 500);
            } else {
              fsAuthFailed = true;
              document.getElementById('fs-stage-label').textContent = 'MATCH FAILED';
              stopFaceScan();
              setTimeout(() => showAuthError(), 100);
            }
          } else {
            // First time — auto-register from current scan data
            const fp = extractFacePrint(lms);
            if (fp) saveFacePrint(fp);
            matched = true;
            fsPasswordOK = true;
            document.getElementById('fs-stage-label').textContent = 'IDENTITY LOCKED';
            document.getElementById('fs-hdr-status').innerHTML = '<span class="blink">▌</span> REGISTERED';
            document.getElementById('fs-dv-conf').textContent = '100%';
            stopFaceScan();
            setTimeout(() => startTransition(), 500);
          }
        }
      }
      fsUpdateHUD();
    });

    const mpCamera = new Camera(video, {
      onFrame: async () => {
        if (fsRunning && !fsPasswordOK) await faceMesh.send({ image: video });
      },
      width: 480, height: 360
    });
    fsCamera = mpCamera;
    mpCamera.start();
  } catch (e) {
    showToast('// CAMERA ERROR: ' + (e.message || 'UNKNOWN') + ' //');
    console.error('initFaceLock error:', e);
  }
}

// ─── Quick registration (after password RED) ──────────────
function startRealFaceScan() {
  fsRunning = true;
  fsAuthFailed = false;
  fsSmoothProgress = 0;

  document.getElementById('fs-stage-label').textContent = 'REGISTERING FACE...';
  document.getElementById('fs-prog-fill').style.width = '0%';
  document.getElementById('fs-prog-pct').textContent = '0%';
  document.getElementById('fs-dv-conf').textContent = '0%';
  document.getElementById('fs-hdr-status').innerHTML = '<span class="blink">▌</span> REGISTERING';

  setTimeout(() => {
    const video = document.getElementById('camera-video');
    if (!video) return;
    quickRegisterCamera(video);
  }, 300);
}

function quickRegisterCamera(video) {
  const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 1, refineLandmarks: true,
    minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
  });

  let stableFrames = 0;
  let registered = false;

  faceMesh.onResults((results) => {
    if (!fsRunning || registered) return;
    fsUpdateParticles();
    fsDrawFX();

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const lms = results.multiFaceLandmarks[0];
      fsDrawFaceMesh(lms);
      stableFrames++;

      document.getElementById('fs-dv-conf').textContent = Math.min(99, Math.floor(stableFrames * 16)) + '%';

      if (stableFrames > 5) {
        registered = true;
        const fp = extractFacePrint(lms);
        if (fp) saveFacePrint(fp);

        document.getElementById('fs-prog-fill').style.width = '100%';
        document.getElementById('fs-prog-pct').textContent = '100%';
        document.getElementById('fs-dv-conf').textContent = '100%';
        document.getElementById('fs-stage-label').textContent = 'IDENTITY LOCKED';
        document.getElementById('fs-hdr-status').innerHTML = '<span class="blink">▌</span> REGISTERED';

        stopFaceScan();
        setTimeout(() => startTransition(), 500);
      }
    } else {
      document.getElementById('fs-stage-label').textContent = 'NO FACE DETECTED';
      fsCtx?.clearRect(0, 0, fsW, fsH);
      if (fsCtx) {
        fsCtx.fillStyle = 'rgba(0,255,65,0.3)';
        fsCtx.font = '14px Courier New';
        fsCtx.textAlign = 'center';
        fsCtx.fillText('POSITION FACE IN FRAME', fsCX, fsCY);
        fsCtx.textAlign = 'left';
      }
    }
  });

  const mpCamera = new Camera(video, {
    onFrame: async () => {
      if (fsRunning) await faceMesh.send({ image: video });
    },
    width: 480, height: 360
  });
  fsCamera = mpCamera;
  mpCamera.start();
}

// ─── Stop ───────────────────────────────────────────────────
function stopFaceScan() {
  fsRunning = false;
  if (fsCamera && fsCamera.stop) fsCamera.stop();
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  // Fully release the video element so a new camera can start later
  const video = document.getElementById('camera-video');
  if (video) {
    if (video.srcObject) {
      try { video.srcObject.getTracks().forEach(t => t.stop()); } catch(e) {}
      video.srcObject = null;
    }
    video.load(); // Reset the video element
  }
}

// ─── Reused MediaPipe rendering ─────────────────────────────
const fsW = 480, fsH = 360;
['fs-bg','fs-main','fs-fx'].forEach(id => {
  const c = document.getElementById(id);
  if (c) { c.width = fsW; c.height = fsH; }
});
const fsBgCtx = document.getElementById('fs-bg')?.getContext('2d');
const fsCtx   = document.getElementById('fs-main')?.getContext('2d');
const fsFxCtx = document.getElementById('fs-fx')?.getContext('2d');
const fsCX = fsW/2, fsCY = fsH/2;

const fsParticles = Array.from({length:50}, () => ({
  x: Math.random()*fsW, y: Math.random()*fsH,
  vy: 1.2+Math.random()*2.5, char: '', alpha: 0.05+Math.random()*0.12, size: 8+Math.floor(Math.random()*4), timer:0
}));
const FS_KANA = 'アイウエオカキクケコサシスセソABCDEF0123456789@#';

function fsUpdateParticles() {
  if (!fsBgCtx) return;
  fsBgCtx.clearRect(0,0,fsW,fsH);
  fsParticles.forEach(p => {
    p.timer++;
    if (p.timer % 3 === 0) p.char = FS_KANA[Math.floor(Math.random()*FS_KANA.length)];
    p.y += p.vy;
    if (p.y > fsH) { p.y = -20; p.x = Math.random()*fsW; }
    fsBgCtx.globalAlpha = p.alpha;
    fsBgCtx.fillStyle = '#00ff41';
    fsBgCtx.font = `${p.size}px Courier New`;
    fsBgCtx.fillText(p.char, p.x, p.y);
  });
  fsBgCtx.globalAlpha = 1;
}

function fsDrawFX() {
  if (!fsFxCtx) return;
  fsFxCtx.clearRect(0,0,fsW,fsH);
  const vig = fsFxCtx.createRadialGradient(fsCX,fsCY,60,fsCX,fsCY,260);
  vig.addColorStop(0,'transparent'); vig.addColorStop(1,'rgba(0,0,0,0.6)');
  fsFxCtx.fillStyle = vig; fsFxCtx.fillRect(0,0,fsW,fsH);
  const glow = fsFxCtx.createRadialGradient(fsCX, fsCY-10, 15, fsCX, fsCY-10, 170);
  glow.addColorStop(0,'rgba(0,255,65,0.03)'); glow.addColorStop(1,'transparent');
  fsFxCtx.fillStyle = glow; fsFxCtx.fillRect(0,0,fsW,fsH);
  for (let y = 0; y < fsH; y += 3) {
    fsFxCtx.fillStyle = 'rgba(0,0,0,0.035)'; fsFxCtx.fillRect(0, y, fsW, 1);
  }
}

function fsDrawFaceMesh(landmarks) {
  if (!fsCtx || !landmarks) return;
  fsCtx.clearRect(0,0,fsW,fsH);
  const scaled = landmarks.map(lm => ({ x: lm.x * fsW, y: lm.y * fsH, z: lm.z * 100 }));
  const tessConn = typeof FACEMESH_TESSELATION !== 'undefined'
    ? FACEMESH_TESSELATION : FACE_MESH_CONNECTIONS?.FACEMESH_TESSELATION;
  if (tessConn) {
    tessConn.forEach(([i, j]) => {
      const p1 = scaled[i], p2 = scaled[j];
      if (!p1 || !p2) return;
      const zAvg = (p1.z + p2.z) / 2;
      const bright = Math.max(0.15, 0.5 + zAvg * 0.02);
      fsCtx.beginPath(); fsCtx.moveTo(p1.x, p1.y); fsCtx.lineTo(p2.x, p2.y);
      fsCtx.strokeStyle = `rgba(0,${Math.floor(180*bright)},${Math.floor(80*bright)},${0.25+0.3*bright})`;
      fsCtx.lineWidth = 0.5; fsCtx.stroke();
    });
  }
  const contourConn = typeof FACEMESH_CONTOURS !== 'undefined'
    ? FACEMESH_CONTOURS : FACE_MESH_CONNECTIONS?.FACEMESH_CONTOURS;
  if (contourConn) {
    contourConn.forEach(([i, j]) => {
      const p1 = scaled[i], p2 = scaled[j];
      if (!p1 || !p2) return;
      fsCtx.beginPath(); fsCtx.moveTo(p1.x, p1.y); fsCtx.lineTo(p2.x, p2.y);
      fsCtx.strokeStyle = 'rgba(0,255,65,0.5)'; fsCtx.lineWidth = 0.8; fsCtx.stroke();
    });
  }
  const keyIndices = [1,33,61,199,263,291];
  keyIndices.forEach(idx => {
    const p = scaled[idx];
    if (!p) return;
    fsCtx.beginPath(); fsCtx.arc(p.x, p.y, 2.5, 0, Math.PI*2);
    fsCtx.fillStyle = 'rgba(0,255,65,0.8)'; fsCtx.fill();
    fsCtx.beginPath(); fsCtx.arc(p.x, p.y, 5, 0, Math.PI*2);
    fsCtx.fillStyle = 'rgba(0,255,65,0.1)'; fsCtx.fill();
  });
  const nose = scaled[1];
  if (nose) {
    const glowGrad = fsCtx.createRadialGradient(nose.x, nose.y, 5, nose.x, nose.y, 60);
    glowGrad.addColorStop(0, 'rgba(0,255,65,0.06)');
    glowGrad.addColorStop(1, 'transparent');
    fsCtx.fillStyle = glowGrad;
    fsCtx.beginPath(); fsCtx.arc(nose.x, nose.y, 60, 0, Math.PI*2); fsCtx.fill();
  }
}

// ─── Smooth progress animation ──────────────────────────────
// Each task has a target progress ceiling
const PROGRESS_CEILINGS = [18, 42, 65, 85, 100];

function updateSmoothProgress() {
  const doneCount = SCAN_TASKS.filter(t => t.done).length;
  const target = doneCount > 0 ? PROGRESS_CEILINGS[doneCount - 1] : 0;
  const maxTarget = doneCount < PROGRESS_CEILINGS.length ? PROGRESS_CEILINGS[doneCount] : 100;

  // Smoothly approach the target
  if (fsSmoothProgress < maxTarget) {
    // Speed varies — faster at start, slower near target, random stutter
    const remaining = maxTarget - fsSmoothProgress;
    const step = remaining < 5
      ? 0.1 + Math.random() * 0.2     // very slow near ceiling
      : remaining < 15
        ? 0.2 + Math.random() * 0.5   // slow
        : 0.5 + Math.random() * 1.2;  // faster at low progress

    fsSmoothProgress = Math.min(maxTarget, fsSmoothProgress + step);

    // Occasional stutter (simulates real processing)
    if (Math.random() < 0.03 && remaining > 10) {
      fsSmoothProgress -= 0.5 + Math.random() * 1.5;
    }

    const display = Math.floor(fsSmoothProgress);
    document.getElementById('fs-prog-fill').style.width = display + '%';
    document.getElementById('fs-prog-pct').textContent = display + '%';
  }
}

function fsUpdateHUD() {
  // Only overwrite depth if not in auth matching phase
  if (!fsRunning) {
    document.getElementById('fs-dv-depth').textContent = fsAuthFailed ? 'FAIL' : '---';
  }
  document.getElementById('fs-dv-verts').textContent = fsAuthFailed ? '0000' : '0468';
  document.getElementById('fs-dv-lm').textContent = fsAuthFailed ? '0 / 68' : '68 / 68';
  document.getElementById('fs-dv-conf').textContent = fsAuthFailed ? '0%' : '98%';
}

// ─── Auth modal event binding ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const pwInput = document.getElementById('auth-password-input');
  const pwBtn = document.getElementById('auth-password-btn');
  const pwErr = document.getElementById('auth-password-error');

  if (pwBtn) pwBtn.addEventListener('click', checkPassword);
  if (pwInput) {
    pwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); checkPassword(); }
    });
  }

  // Open modal handler (closeAuthError also opens it)
  const modal = document.getElementById('auth-error-modal');
  if (modal) {
    modal.addEventListener('transitionend', () => {
      if (modal.classList.contains('open') && pwInput) pwInput.focus();
    });
  }
});
