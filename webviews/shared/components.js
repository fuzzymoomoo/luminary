/* Shared webview utilities — injected into every panel */

const vscodeApi = acquireVsCodeApi();

function sendMessage(command, data) {
  vscodeApi.postMessage({ command, ...data });
}

// Simple event dispatcher
const _handlers = {};
function onMessage(command, handler) {
  if (!_handlers[command]) _handlers[command] = [];
  _handlers[command].push(handler);
}

window.addEventListener('message', e => {
  const msg = e.data;
  const hs  = _handlers[msg.command];
  if (hs) hs.forEach(h => h(msg));
});

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeIcon(ext) {
  const videos = new Set(['mp4','mov','avi','mkv','mpg','mpeg','m4v','wmv','3gp']);
  const audio  = new Set(['mp3','flac','wav','m4a','aac']);
  if (videos.has(ext)) return '🎬';
  if (audio.has(ext))  return '🎵';
  return '📄';
}
