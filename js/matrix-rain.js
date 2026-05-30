// ============================================================
// MATRIX RAIN — Background & Chat (LetterGlitch background)
// ============================================================

// Background rain (runs immediately on page load)
const rainCanvas = document.getElementById('rain-canvas');
const rCtx = rainCanvas.getContext('2d');
rainCanvas.width = window.innerWidth;
rainCanvas.height = window.innerHeight;

const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>[]{}|\\/:;!?~^';
const FONT_SIZE = 14;
const COLS = Math.floor(rainCanvas.width / FONT_SIZE);
const drops = Array(COLS).fill(1);

function drawRain() {
  rCtx.fillStyle = 'rgba(0,0,0,0.05)';
  rCtx.fillRect(0, 0, rainCanvas.width, rainCanvas.height);
  rCtx.font = FONT_SIZE + 'px Share Tech Mono';
  drops.forEach((y, i) => {
    const char = CHARS[Math.floor(Math.random() * CHARS.length)];
    const bright = Math.random() > 0.95;
    rCtx.fillStyle = bright ? '#ccffcc' : '#00ff41';
    rCtx.fillText(char, i * FONT_SIZE, y * FONT_SIZE);
    if (y * FONT_SIZE > rainCanvas.height && Math.random() > 0.975) drops[i] = 0;
    drops[i]++;
  });
}
setInterval(drawRain, 50);

// ─── LetterGlitch chat background (replaces Matrix rain) ──
let glitchAnimId = null;

function startMatrixRain() {
  const canvas = document.getElementById('chat-bg');
  if (!canvas) return;

  // Add vignette overlays (above canvas, below UI)
  // Outer: dark edges
  if (!document.getElementById('glitch-outer-vig')) {
    const ov = document.createElement('div');
    ov.id = 'glitch-outer-vig';
    ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(circle,rgba(0,0,0,0) 50%,rgba(0,0,0,0.92) 100%)';
    canvas.insertAdjacentElement('afterend', ov);
  }
  // Center: subtle green glow
  if (!document.getElementById('glitch-center-vig')) {
    const cv = document.createElement('div');
    cv.id = 'glitch-center-vig';
    cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(circle,rgba(0,255,65,0.04) 0%,rgba(0,0,0,0) 60%)';
    canvas.insertAdjacentElement('afterend', cv);
  }

  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;

  // Glitch config
  const config = {
    glitchSpeed: 50,
    smooth: true,
    colors: ['#0a2a10', '#00aa2a', '#00ff41'],
    characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789',
    fontSize: 16,
    charWidth: 10,
    charHeight: 20,
  };

  let letters = [];
  let grid = { columns: 0, rows: 0 };
  let lastGlitchTime = Date.now();

  const chars = Array.from(config.characters);

  function getRandomChar() {
    return chars[Math.floor(Math.random() * chars.length)];
  }
  function getRandomColor() {
    return config.colors[Math.floor(Math.random() * config.colors.length)];
  }
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }
  function interpolateColor(start, end, factor) {
    return `rgb(${Math.round(start.r + (end.r - start.r) * factor)}, ${Math.round(start.g + (end.g - start.g) * factor)}, ${Math.round(start.b + (end.b - start.b) * factor)})`;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    grid.columns = Math.ceil(w / config.charWidth);
    grid.rows = Math.ceil(h / config.charHeight);
    const total = grid.columns * grid.rows;
    letters = Array.from({ length: total }, () => ({
      char: getRandomChar(),
      color: getRandomColor(),
      targetColor: getRandomColor(),
      colorProgress: 1,
    }));
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.font = config.fontSize + 'px monospace';
    ctx.textBaseline = 'top';
    letters.forEach((l, i) => {
      const x = (i % grid.columns) * config.charWidth;
      const y = Math.floor(i / grid.columns) * config.charHeight;
      ctx.fillStyle = l.color;
      ctx.fillText(l.char, x, y);
    });
  }

  function updateLetters() {
    const updateCount = Math.max(1, Math.floor(letters.length * 0.05));
    for (let i = 0; i < updateCount; i++) {
      const idx = Math.floor(Math.random() * letters.length);
      if (!letters[idx]) continue;
      letters[idx].char = getRandomChar();
      letters[idx].targetColor = getRandomColor();
      letters[idx].colorProgress = config.smooth ? 0 : 1;
      if (!config.smooth) letters[idx].color = letters[idx].targetColor;
    }
  }

  function animate() {
    const now = Date.now();
    if (now - lastGlitchTime >= config.glitchSpeed) {
      updateLetters();
      draw();
      lastGlitchTime = now;
    }
    if (config.smooth) {
      let needsRedraw = false;
      letters.forEach(l => {
        if (l.colorProgress < 1) {
          l.colorProgress = Math.min(1, l.colorProgress + 0.05);
          const start = hexToRgb(l.color);
          const end = hexToRgb(l.targetColor);
          if (start && end) {
            l.color = interpolateColor(start, end, l.colorProgress);
            needsRedraw = true;
          }
        }
      });
      if (needsRedraw) draw();
    }
    glitchAnimId = requestAnimationFrame(animate);
  }

  resize();
  animate();

  window.addEventListener('resize', resize);
}

// Ensure animation stops cleanly on page exit
window.addEventListener('beforeunload', () => {
  if (glitchAnimId) cancelAnimationFrame(glitchAnimId);
});
