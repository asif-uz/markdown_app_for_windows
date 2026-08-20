const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const btnUpload = document.getElementById('btnUpload');
const btnClear = document.getElementById('btnClear');
const btnExportDocx = document.getElementById('btnExportDocx');
const btnExportPdf = document.getElementById('btnExportPdf');

let currentFileName = 'document';
let debounceTimer = null;

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.style.color = isError ? '#dc2626' : '#6b7280';
}

function renderPreview() {
  const text = editor.value;
  preview.innerHTML = window.api.renderMarkdown(text);
}

function scheduleRender() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderPreview, 150);
}

function deriveFileNameFromContent(text) {
  const match = text.match(/^\s*#\s+(.+)$/m);
  if (match) {
    return match[1].trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'document';
  }
  return currentFileName;
}

editor.addEventListener('input', () => {
  scheduleRender();
});

btnUpload.addEventListener('click', async () => {
  const result = await window.api.openMarkdownFile();
  if (!result) return;
  editor.value = result.content;
  currentFileName = (result.fileName || 'document').replace(/\.(md|markdown|txt)$/i, '');
  renderPreview();
  setStatus(`Loaded ${result.fileName}`);
});

btnClear.addEventListener('click', () => {
  editor.value = '';
  currentFileName = 'document';
  renderPreview();
  setStatus('Cleared');
});

btnExportDocx.addEventListener('click', async () => {
  if (!editor.value.trim()) {
    setStatus('Nothing to export — the editor is empty.', true);
    return;
  }
  setStatus('Exporting to Word...');
  btnExportDocx.disabled = true;
  try {
    const html = window.api.renderMarkdown(editor.value);
    const suggestedName = deriveFileNameFromContent(editor.value);
    const result = await window.api.exportDocx(html, suggestedName);
    if (result.canceled) {
      setStatus('Export canceled.');
    } else {
      setStatus(`Saved: ${result.filePath}`);
    }
  } catch (err) {
    console.error(err);
    setStatus('Export failed: ' + err.message, true);
  } finally {
    btnExportDocx.disabled = false;
  }
});

btnExportPdf.addEventListener('click', async () => {
  if (!editor.value.trim()) {
    setStatus('Nothing to export — the editor is empty.', true);
    return;
  }
  setStatus('Exporting to PDF...');
  btnExportPdf.disabled = true;
  try {
    const html = window.api.renderMarkdown(editor.value);
    const suggestedName = deriveFileNameFromContent(editor.value);
    const result = await window.api.exportPdf(html, suggestedName);
    if (result.canceled) {
      setStatus('Export canceled.');
    } else {
      setStatus(`Saved: ${result.filePath}`);
    }
  } catch (err) {
    console.error(err);
    setStatus('Export failed: ' + err.message, true);
  } finally {
    btnExportPdf.disabled = false;
  }
});

// Initial render (empty state)
renderPreview();
