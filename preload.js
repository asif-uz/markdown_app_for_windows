const { contextBridge, ipcRenderer } = require('electron');

// Note: preload scripts run in a sandboxed context (Electron 20+ default),
// which only allows require()-ing Electron/Node built-ins — not third-party
// npm packages like markdown-it. So markdown rendering is delegated to the
// main process over IPC instead of being done here directly.
contextBridge.exposeInMainWorld('api', {
  renderMarkdown: (text) => ipcRenderer.invoke('render-markdown', text),
  openMarkdownFile: () => ipcRenderer.invoke('open-md-file'),
  // Word export re-renders the markdown itself (so equations can become
  // images instead of unsupported KaTeX HTML), so it takes the raw
  // markdown text rather than the already-rendered preview HTML.
  exportDocx: (markdownText, suggestedName) => ipcRenderer.invoke('export-docx', { text: markdownText, suggestedName }),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('export-pdf', { html, suggestedName }),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
});
