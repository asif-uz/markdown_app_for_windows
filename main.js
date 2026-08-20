const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fsSync = require('fs');
const fs = require('fs/promises');
const HTMLtoDOCX = require('html-to-docx');
const MarkdownIt = require('markdown-it');
const { extractMath, renderMathHtml } = require('./math');

const md = new MarkdownIt({
  html: false,       // don't allow raw HTML in the source markdown (safety)
  linkify: true,      // auto-detect URLs
  typographer: true,  // nicer quotes/dashes
  breaks: false,
});

const KATEX_DIR = path.join(__dirname, 'vendor', 'katex');

// PDF export and the equation-image rasterizer (see rasterizeMathToImages,
// below) both load their content as data: URLs in an offscreen window.
// Chromium won't load a file:// <link rel="stylesheet"> from a data: page
// (different, restricted origin), so referencing katex.min.css normally
// there silently fails to apply -- Chromium then falls back to rendering
// the equation's raw (unstyled, undordium-native) MathML, which is why
// exported equations were showing an ugly duplicated/unstyled line
// underneath the properly-typeset one. The fix: read the CSS once and inline it
// directly into a <style> tag, with its relative url(fonts/...) references
// rewritten to absolute file:// paths so the fonts still resolve correctly
// regardless of the page's own origin.
let katexCssInlineCache = null;
function getKatexCssInline() {
  if (katexCssInlineCache === null) {
    const raw = fsSync.readFileSync(path.join(KATEX_DIR, 'katex.min.css'), 'utf-8');
    const fontsUrl = pathToFileURL(path.join(KATEX_DIR, 'fonts')).href;
    katexCssInlineCache = raw.replace(/url\(fonts\//g, `url(${fontsUrl}/`);
  }
  return katexCssInlineCache;
}

function renderMarkdownToHtml(text) {
  const { text: substituted, mathBlocks } = extractMath(text);
  const html = md.render(substituted);
  return renderMathHtml(html, mathBlocks);
}

// html-to-docx renders plain HTML+CSS into native Word XML elements and has
// no support for KaTeX's CSS-positioned layout (nested spans, negative
// margins, custom fonts for glyphs like radicals/fractions) -- feeding it
// KaTeX markup directly produces garbled text in Word. Instead, each
// equation is rendered offscreen in a real Chromium window (where the CSS
// *does* work correctly, same as the live preview) and captured as a PNG,
// which Word can always display correctly regardless of its HTML support.
const katex = require('katex');

async function rasterizeMathToImages(mathBlocks) {
  const images = new Map();
  if (mathBlocks.length === 0) return images;

  const wrappers = mathBlocks
    .map(({ latex, display }, i) => {
      let rendered;
      try {
        rendered = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: false });
      } catch (err) {
        rendered = `<span>${require('./math').escapeHtml(latex)}</span>`;
      }
      // Generous padding/margin between rows: guards against the capture
      // rect for one equation bleeding into its neighbor if a measurement
      // is ever off by a few pixels.
      return `<div id="m${i}" style="display:table; padding:10px 8px; margin-bottom:24px;">${rendered}</div>`;
    })
    .join('\n');

  // Rendered at 2x font-size for crisper images in Word, then scaled back
  // down via the <img> width/height attributes. This (rather than
  // webContents.setZoomFactor) is what supplies the extra pixel density:
  // Electron's capturePage() rect is specified in unzoomed CSS px, but
  // getBoundingClientRect() reports *zoomed* px once a zoom factor is
  // applied, so combining zoom with capturePage silently captures the wrong
  // (too-small) region. Scaling the actual content instead keeps
  // measurement and capture in the same coordinate space.
  const SCALE = 2;
  const pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>${getKatexCssInline()}</style>
    <style>body{margin:0;background:#ffffff;font-size:${16 * SCALE}px;}</style>
  </head><body>${wrappers}</body></html>`;

  const win = new BrowserWindow({ show: false, width: 2800, height: 800 });
  try {
    await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(pageHtml));
    // Wait for KaTeX's web fonts to actually finish loading before measuring
    // anything -- until then the browser lays text out with fallback font
    // metrics, so getBoundingClientRect() returns sizes that are too small
    // and don't match what's rendered once the real fonts swap in, which
    // was clipping the captured equation images.
    await win.webContents.executeJavaScript(
      'document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))'
    );

    for (let i = 0; i < mathBlocks.length; i += 1) {
      const { token, latex } = mathBlocks[i];
      try {
        const rect = await win.webContents.executeJavaScript(
          `(() => { const el = document.getElementById('m${i}'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
        );
        if (!rect || rect.width < 1 || rect.height < 1) throw new Error('empty rect');
        const pad = 4; // small safety margin against subpixel/antialiasing clipping
        const image = await win.webContents.capturePage({
          x: Math.max(0, Math.round(rect.x) - pad),
          y: Math.max(0, Math.round(rect.y) - pad),
          width: Math.ceil(rect.width) + pad * 2,
          height: Math.ceil(rect.height) + pad * 2,
        });
        const dataUrl = image.toDataURL();
        const w = Math.max(1, Math.round((rect.width + pad * 2) / SCALE));
        const h = Math.max(1, Math.round((rect.height + pad * 2) / SCALE));
        images.set(token, `<img src="${dataUrl}" width="${w}" height="${h}" style="vertical-align:middle;" alt="equation" />`);
      } catch (err) {
        // Fall back to plain text rather than leaving the raw placeholder in the document.
        images.set(token, `<code>${require('./math').escapeHtml(latex)}</code>`);
      }
    }
  } finally {
    win.destroy();
  }
  return images;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Markdown to Word',
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null); // clean UI, no default menu bar
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Render markdown to HTML ----
// This runs in the (unsandboxed) main process because preload scripts are
// sandboxed by default in Electron 20+, which blocks require() of
// third-party npm packages like markdown-it. Doing the render here avoids
// that restriction entirely.
ipcMain.handle('render-markdown', (event, text) => {
  return renderMarkdownToHtml(text || '');
});

// ---- Open a .md file from disk ----
ipcMain.handle('open-md-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown File',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  return { filePath, content, fileName: path.basename(filePath) };
});

// ---- Export current preview HTML to a .docx file ----
ipcMain.handle('export-docx', async (event, { text, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to Word',
    defaultPath: (suggestedName || 'document') + '.docx',
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // Render markdown -> HTML ourselves (rather than reusing the preview's
  // already-rendered HTML) so math placeholders can be swapped for images
  // instead of KaTeX markup -- see rasterizeMathToImages() above.
  const { text: substituted, mathBlocks } = extractMath(text || '');
  let html = md.render(substituted);
  const mathImages = await rasterizeMathToImages(mathBlocks);
  for (const [token, imgHtml] of mathImages) {
    html = html.split(token).join(imgHtml);
  }

  // html-to-docx ignores CSS white-space, so plain <pre><code> content collapses
  // onto one line. Convert each code line into its own paragraph so Word preserves
  // line breaks and indentation.
  const codeFixedHtml = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (match, attrs, inner) => {
    const lines = inner.replace(/\n$/, '').split('\n');
    const paras = lines.map((line) => {
      const withNbsp = line.replace(/^( +)/, (m) => '&nbsp;'.repeat(m.length));
      return `<p style="font-family:Consolas,monospace;background-color:#f2f2f2;margin:0;">${withNbsp || '&nbsp;'}</p>`;
    });
    return paras.join('');
  });

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${codeFixedHtml}</body></html>`;

  const fileBuffer = await HTMLtoDOCX(fullHtml, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
    font: 'Calibri',
    fontSize: 22, // half-points -> 11pt
    margins: {
      top: 1440,
      bottom: 1440,
      left: 1440,
      right: 1440,
      // html-to-docx has no fallback for these and writes the literal
      // string "undefined" into word/document.xml's <w:pgMar> if they're
      // left out, which produces a .docx Word refuses to open ("problems
      // with the contents"). Standard Word defaults: 0.5" header/footer
      // distance, no gutter.
      header: 720,
      footer: 720,
      gutter: 0,
    },
  });

  await fs.writeFile(result.filePath, fileBuffer);
  return { canceled: false, filePath: result.filePath };
});

// ---- Export current preview HTML to a PDF file (via Chromium's PDF engine) ----
ipcMain.handle('export-pdf', async (event, { html, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to PDF',
    defaultPath: (suggestedName || 'document') + '.pdf',
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // Render the HTML in a hidden offscreen window so the PDF matches the preview exactly,
  // independent of the main window's UI chrome.
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });

  const styledHtml = `<!DOCTYPE html>
  <html><head><meta charset="utf-8">
  <style>${getKatexCssInline()}</style>
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #1a1a1a; padding: 0 4px; }
    h1,h2,h3,h4 { font-family: Calibri, Arial, sans-serif; margin-top: 1.2em; }
    code, pre { font-family: Consolas, monospace; background:#f4f4f4; }
    pre { padding: 8px; border-radius: 4px; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; }
    img { max-width: 100%; }
    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12px; color: #555; }
    .katex-display { margin: 1em 0; }
  </style></head><body>${html}</body></html>`;

  await printWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(styledHtml));

  const pdfBuffer = await printWin.webContents.printToPDF({
    marginsType: 0,
    pageSize: 'Letter',
    printBackground: true,
  });

  printWin.destroy();
  await fs.writeFile(result.filePath, pdfBuffer);
  return { canceled: false, filePath: result.filePath };
});

// ---- Reveal exported file in folder ----
ipcMain.handle('show-in-folder', async (event, filePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});
