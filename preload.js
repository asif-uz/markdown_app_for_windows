const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({
  html: false,       // don't allow raw HTML in the source markdown (safety)
  linkify: true,      // auto-detect URLs
  typographer: true,  // nicer quotes/dashes
  breaks: false,
});

contextBridge.exposeInMainWorld('api', {
  renderMarkdown: (text) => md.render(text || ''),
  openMarkdownFile: () => ipcRenderer.invoke('open-md-file'),
  exportDocx: (html, suggestedName) => ipcRenderer.invoke('export-docx', { html, suggestedName }),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('export-pdf', { html, suggestedName }),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
});
