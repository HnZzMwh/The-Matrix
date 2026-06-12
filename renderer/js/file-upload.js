/**
 * FILE UPLOAD — /file command + Ctrl+V paste → attach to messages
 *
 * Supported:
 *   Text (.txt .md .json .js .ts .py .html .css .yaml ... ) → read as UTF-8
 *   Images (.png .jpg .gif .webp .bmp .svg) → base64 data-URL
 *   Office (.docx .xlsx .pptx) → JSZip extraction
 *   Other → filename + size + base64 fallback
 */

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'scss', 'less',
  'yaml', 'yml', 'xml', 'svg', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'toml',
  'sh', 'bash', 'zsh', 'bat', 'ps1', 'sql', 'java', 'c', 'cpp', 'h', 'hpp',
  'rs', 'go', 'rb', 'php', 'swift', 'kt', 'r', 'm', 'mm', 'lua', 'pl',
  'gitignore', 'env', 'editorconfig', 'dockerfile', 'makefile', 'cmake',
  'vue', 'svelte', 'astro', 'graphql', 'prisma', 'proto',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff']);

const MAX_TEXT_SIZE = 200000;   // 200KB max for text content
const MAX_IMAGE_SIZE = 5000000; // 5MB max for images

// ─── Pending files state ────────────────────────────────────────
if (!window._pendingFiles) window._pendingFiles = [];

function getPendingFiles() { return window._pendingFiles; }
function clearPendingFiles() { window._pendingFiles = []; renderAttachPreview(); }

function removePendingFile(index) {
  window._pendingFiles.splice(index, 1);
  renderAttachPreview();
}

// ─── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-upload-input');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileSelect);
  }

  // /file command in the textarea opens file picker
  const msgInput = document.getElementById('msg-input');
  if (msgInput) {
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = msgInput.value.trim();
        if (val === '/file') {
          e.preventDefault();
          msgInput.value = '';
          fileInput?.click();
        }
      }
    });
  }

  // Also support paste for images
  document.addEventListener('paste', handlePaste);
});

// ─── File selection ────────────────────────────────────────────
async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  for (const file of files) {
    await processFile(file);
  }

  renderAttachPreview();
  e.target.value = ''; // reset so same file can be re-selected
}

// ─── Paste handler (images from clipboard) ─────────────────────
async function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  // Only handle paste if input is focused
  const active = document.activeElement;
  if (active?.id !== 'msg-input' && active?.closest('#msg-input') !== active) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) {
        await processFile(new File([blob], 'clipboard.' + (item.type.split('/')[1] || 'png'), { type: item.type }));
        renderAttachPreview();
      }
    }
  }
}

// ─── Process a single file ─────────────────────────────────────
async function processFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const entry = { name: file.name, size: file.size, type: file.type, ext, content: null, dataUrl: null, kind: 'file' };

  try {
    if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_SIZE) {
        entry.content = `[Image too large: ${formatSize(file.size)} > ${formatSize(MAX_IMAGE_SIZE)}]`;
        entry.kind = 'error';
      } else {
        entry.dataUrl = await readAsDataURL(file);
        entry.content = `[Image: ${file.name} (${formatSize(file.size)})]\n${entry.dataUrl.slice(0, 120)}...`;
        entry.kind = 'image';
      }
    } else if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/')) {
      const text = await readAsText(file);
      if (text.length > MAX_TEXT_SIZE) {
        entry.content = text.slice(0, MAX_TEXT_SIZE) + `\n[...truncated at ${formatSize(MAX_TEXT_SIZE)}, original ${formatSize(file.size)}]`;
      } else {
        entry.content = text;
      }
      entry.kind = 'text';
    } else if (ext === 'docx') {
      entry.content = await extractDocxText(file);
      entry.kind = entry.content ? 'doc' : 'binary';
    } else if (ext === 'xlsx') {
      entry.content = await extractXlsxText(file);
      entry.kind = entry.content ? 'doc' : 'binary';
    } else if (ext === 'pptx') {
      entry.content = await extractPptxText(file);
      entry.kind = entry.content ? 'doc' : 'binary';
    } else if (ext === 'pdf') {
      entry.content = await extractPdfText(file);
      entry.kind = entry.content ? 'doc' : 'binary';
      if (entry.kind === 'binary') {
        entry.dataUrl = await readAsDataURL(file);
      }
    } else {
      // Unknown type: store as base64 reference
      entry.dataUrl = await readAsDataURL(file);
      entry.content = `[Binary file: ${file.name} (${formatSize(file.size)})]`;
      entry.kind = 'binary';
    }
  } catch (err) {
    entry.content = `[Error reading ${file.name}: ${err.message}]`;
    entry.kind = 'error';
  }

  window._pendingFiles.push(entry);
  return entry;
}

// ─── Render preview chips ──────────────────────────────────────
function renderAttachPreview() {
  const strip = document.getElementById('attach-preview');
  if (!strip) return;

  const files = window._pendingFiles;

  if (files.length === 0) {
    strip.classList.remove('active');
    strip.innerHTML = '';
    return;
  }

  strip.classList.add('active');

  strip.innerHTML = files.map((f, i) => {
    const icon = f.kind === 'image' ? '🖼' : f.kind === 'text' ? '📄' : f.kind === 'doc' ? '📑' : f.kind === 'error' ? '⚠️' : '📦';
    const cls = f.kind === 'image' ? 'chip-image' : f.kind === 'doc' ? 'chip-doc' : '';
    return `<span class="attach-chip ${cls}">
      <span class="chip-icon">${icon}</span>
      <span class="chip-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="chip-size">${formatSize(f.size)}</span>
      <span class="chip-remove" onclick="removePendingFile(${i})" title="Remove">✕</span>
    </span>`;
  }).join('');
}

// ─── Build file context for LLM ────────────────────────────────
function buildFileContext() {
  const files = window._pendingFiles;
  if (!files.length) return '';

  const parts = ['\n\n## ATTACHED FILES\n'];
  files.forEach((f, i) => {
    parts.push(`\n### File ${i + 1}: ${f.name} (${f.kind}, ${formatSize(f.size)})`);
    if (f.content) {
      if (f.kind === 'text') {
        // Include full text content for text files
        parts.push(`\n\`\`\`${f.ext || ''}\n${f.content}\n\`\`\``);
      } else if (f.kind === 'image') {
        // Base64 too large for prompt — use description line instead
        parts.push(`\n[Image data: base64 encoded, ${formatSize(f.size)}]`);
      } else {
        parts.push(`\n${f.content}`);
      }
    } else {
      parts.push(`\n[No content extracted]`);
    }
  });

  return parts.join('\n');
}

// ─── File reading helpers ──────────────────────────────────────
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsText(file, 'UTF-8');
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Office format extraction ──────────────────────────────────

async function extractDocxText(file) {
  try {
    const buf = await readAsArrayBuffer(file);
    // .docx is a ZIP of XML files — find document.xml
    const { unzipSync, strFromU8 } = await loadJSZip();
    const zip = unzipSync(new Uint8Array(buf));
    const docXml = zip.files['word/document.xml'];
    if (!docXml) return '[Could not extract text from .docx]';
    const xml = strFromU8(docXml);
    // Strip XML tags, keep text
    const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 50000) || '[Empty .docx document]';
  } catch (e) {
    return `[.docx extraction failed: ${e.message}]`;
  }
}

async function extractXlsxText(file) {
  try {
    const buf = await readAsArrayBuffer(file);
    const { unzipSync, strFromU8 } = await loadJSZip();
    const zip = unzipSync(new Uint8Array(buf));
    // .xlsx — read shared strings + sheet data
    const sharedStrings = zip.files['xl/sharedStrings.xml'];
    const sheet1 = zip.files['xl/worksheets/sheet1.xml'];
    if (!sheet1) return '[Could not extract data from .xlsx]';
    const ssMap = new Map();
    if (sharedStrings) {
      const ssXml = strFromU8(sharedStrings);
      const matches = ssXml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      matches.forEach((m, i) => {
        const txt = m.replace(/<[^>]+>/g, '');
        ssMap.set(i, txt);
      });
    }
    const sheetXml = strFromU8(sheet1);
    const rows = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
    const lines = rows.slice(0, 500).map(row => {
      const cells = row.match(/<c[^>]*>[\s\S]*?<\/c>/g) || [];
      return cells.map(c => {
        const vMatch = c.match(/<v[^>]*>([^<]*)<\/v>/);
        const tMatch = c.match(/t="s"/);
        if (vMatch && tMatch) {
          const idx = parseInt(vMatch[1]);
          return ssMap.get(idx) || '';
        }
        return vMatch ? vMatch[1] : '';
      }).join('\t');
    });
    return lines.join('\n').slice(0, 50000) || '[Empty .xlsx spreadsheet]';
  } catch (e) {
    return `[.xlsx extraction failed: ${e.message}]`;
  }
}

async function extractPptxText(file) {
  try {
    const buf = await readAsArrayBuffer(file);
    const { unzipSync, strFromU8 } = await loadJSZip();
    const zip = unzipSync(new Uint8Array(buf));
    const slides = Object.keys(zip.files)
      .filter(k => k.startsWith('ppt/slides/slide') && k.endsWith('.xml'))
      .sort();
    if (!slides.length) return '[Could not extract text from .pptx]';
    const texts = slides.map(key => {
      const xml = strFromU8(zip.files[key]);
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    });
    return texts.join('\n---\n').slice(0, 30000) || '[Empty .pptx presentation]';
  } catch (e) {
    return `[.pptx extraction failed: ${e.message}]`;
  }
}

async function extractPdfText(file) {
  // PDF text extraction requires a full PDF parser (pdf.js ~2MB).
  // For now: store as base64 reference — the LLM can't read it,
  // but a future vision model could.
  return null; // signals "use binary fallback"
}

// ─── Lazy JSZip loader ─────────────────────────────────────────
let _jszip = null;
async function loadJSZip() {
  if (_jszip) return _jszip;
  // Use CDN for JSZip — loaded once
  return new Promise((resolve, reject) => {
    if (typeof JSZip !== 'undefined') {
      _jszip = JSZip;
      resolve(JSZip);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => {
      _jszip = JSZip;
      resolve(JSZip);
    };
    script.onerror = () => reject(new Error('JSZip CDN load failed'));
    document.head.appendChild(script);
  });
}

// ─── Utility ────────────────────────────────────────────────────
function formatSize(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ─── Expose globally ───────────────────────────────────────────
window.FileUpload = {
  getPendingFiles,
  clearPendingFiles,
  removePendingFile,
  buildFileContext,
};
