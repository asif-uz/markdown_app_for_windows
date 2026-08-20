const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const HTMLtoDOCX = require('html-to-docx');

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
ipcMain.handle('export-docx', async (event, { html, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to Word',
    defaultPath: (suggestedName || 'document') + '.docx',
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

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
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch
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
  <html><head><meta charset="utf-8"><style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #1a1a1a; padding: 0 4px; }
    h1,h2,h3,h4 { font-family: Calibri, Arial, sans-serif; margin-top: 1.2em; }
    code, pre { font-family: Consolas, monospace; background:#f4f4f4; }
    pre { padding: 8px; border-radius: 4px; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; }
    img { max-width: 100%; }
    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12px; color: #555; }
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
