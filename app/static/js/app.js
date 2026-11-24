// Retriever Pilot: upload documents, ask questions, get cited answers.
// Single-workspace demo; no login. All DOM text is set via textContent (never innerHTML with data).
const $ = id => document.getElementById(id);
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['.pdf', '.docx', '.txt', '.md'];

let conversationId = sessionStorage.getItem('pilot_conversation_id') || crypto.randomUUID();
sessionStorage.setItem('pilot_conversation_id', conversationId);

/* ---------- helpers ---------- */
let toastTimer;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.display = 'none', 3500);
}
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw Error(typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`);
  return data;
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const ext = name => (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/* ---------- documents ---------- */
async function loadDocs() {
  const list = $('docs');
  try {
    const { documents } = await api('/api/documents');
    list.replaceChildren();
    const ready = documents.filter(d => d.status === 'ready').length;
    $('statusText').textContent = `${ready} document${ready === 1 ? '' : 's'} ready`;
    $('status').classList.toggle('ready', ready > 0);
    if (!documents.length) {
      list.append(el('li', 'doc-empty', 'No documents yet. Upload one to start asking questions.'));
      return;
    }
    for (const d of documents) {
      const li = el('li', 'doc');
      li.append(el('span', 'doc-icon', ext(d.title).slice(1) || 'doc'));
      const main = el('div', 'doc-main');
      const title = el('div', 'doc-title', d.title); title.title = d.title;
      main.append(title, el('div', 'doc-meta', timeAgo(d.created_at)));
      li.append(main, el('span', 'chip ' + d.status, d.status));
      const del = el('button', 'icon-btn'); del.type = 'button';
      del.title = `Delete ${d.title}`; del.setAttribute('aria-label', `Delete ${d.title}`);
      del.append(trashIcon());
      del.disabled = d.status === 'processing';
      del.onclick = () => deleteDoc(d, li, del);
      li.append(del);
      list.append(li);
    }
  } catch (e) {
    list.replaceChildren(el('li', 'doc-empty', `Couldn't load documents: ${e.message}`));
  }
}

function trashIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  for (const d of ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 11v6M14 11v6']) {
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.append(p);
  }
  return svg;
}

async function deleteDoc(d, li, btn) {
  if (!confirm(`Delete "${d.title}"?\n\nIt will be removed from the search index and storage, and won't be used in answers any more. This can't be undone.`)) return;
  btn.disabled = true; li.classList.add('deleting');
  try {
    const r = await api(`/api/documents/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
    toast(r.file_removed ? `Deleted "${d.title}"` : `Deleted "${d.title}" (the stored file couldn't be removed from S3)`);
  } catch (e) {
    toast(e.message); btn.disabled = false; li.classList.remove('deleting');
  }
  loadDocs();
}

let selectedFile = null;
function selectFile(f) {
  if (!f) return;
  if (!ALLOWED.includes(ext(f.name))) { toast('Only PDF, DOCX, TXT or Markdown files'); return; }
  if (f.size > MAX_BYTES) { toast('Maximum file size is 10 MB'); return; }
  selectedFile = f;
  $('dropTitle').textContent = f.name;
  $('dropSub').textContent = `${(f.size / 1024 / 1024).toFixed(2)} MB · click to change`;
  $('drop').classList.add('has-file');
  $('uploadBtn').disabled = false;
}
function resetUpload() {
  selectedFile = null; $('file').value = '';
  $('dropTitle').replaceChildren('Drop a file here or ', el('u', null, 'browse'));
  $('dropSub').textContent = 'PDF, DOCX, TXT or Markdown · up to 10 MB';
  $('drop').classList.remove('has-file');
  $('uploadBtn').disabled = true;
}
function setStep(step, error = false) {
  const order = ['upload', 'index', 'ready'];
  const i = order.indexOf(step);
  $('progress').classList.remove('hidden');
  $('progress').classList.toggle('error', error);
  document.querySelectorAll('.progress-steps span').forEach((s, j) => {
    s.className = j < i || step === 'ready' ? 'done' : j === i ? 'on' : '';
  });
  $('fill').style.width = { upload: '30%', index: '70%', ready: '100%' }[step];
}

$('file').onchange = e => selectFile(e.target.files[0]);
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));

$('uploadForm').onsubmit = async e => {
  e.preventDefault();
  const f = selectedFile; if (!f) return;
  $('uploadBtn').disabled = true;
  $('uploadBtn').textContent = 'Working…';
  try {
    setStep('upload');
    const r = await api('/api/documents/uploads', { method: 'POST', body: JSON.stringify({ filename: f.name }) });
    const up = await fetch(r.upload_url, { method: 'PUT', headers: r.headers, body: f });
    if (!up.ok) throw Error('Upload to storage failed');
    loadDocs();
    setStep('index');
    await api('/api/documents/complete', { method: 'POST', body: JSON.stringify({ document_id: r.document_id }) });
    setStep('ready');
    toast(`"${f.name}" is ready. Ask away!`);
    resetUpload();
    $('question').focus();
  } catch (err) {
    setStep('index', true);
    toast(err.message === 'Failed to fetch' ? 'Upload blocked. Check the S3 bucket CORS settings.' : err.message);
    $('uploadBtn').disabled = false;
  } finally {
    $('uploadBtn').textContent = 'Upload & index';
    loadDocs();
    setTimeout(() => $('progress').classList.add('hidden'), 2500);
  }
};
$('refreshDocs').onclick = loadDocs;

/* ---------- chat ---------- */
const messages = $('messages');
function scrollDown() { messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' }); }

function addUser(text) {
  $('empty').classList.add('hidden');
  messages.append(el('div', 'msg user', text)); scrollDown();
}
function addThinking() {
  const m = el('div', 'msg bot muted', 'Searching your documents');
  const dots = el('span', 'typing'); dots.append(el('i'), el('i'), el('i'));
  m.append(dots); messages.append(m); scrollDown();
  return m;
}
function addAnswer(r) {
  const m = el('div', 'msg bot' + (r.status === 'no_evidence' ? ' muted' : ''), r.answer);
  if (r.sources?.length) {
    const wrap = el('div', 'sources');
    wrap.append(el('div', 'sources-label', `Sources (${r.sources.length})`));
    for (const s of r.sources) {
      const d = el('details'); const sum = el('summary');
      sum.append(el('b', null, `[${s.index}]`), document.createTextNode(`${s.title} · page ${s.page}`));
      d.append(sum, el('p', null, s.excerpt)); wrap.append(d);
    }
    m.append(wrap);
    const actions = el('div', 'msg-actions');
    for (const [label, rating] of [['👍 Helpful', 1], ['👎 Not helpful', -1]]) {
      const b = el('button', null, label); b.type = 'button';
      b.onclick = async () => {
        try { await api('/api/feedback', { method: 'POST', body: JSON.stringify({ rating }) }); actions.replaceChildren(el('span', 'doc-meta', 'Thanks for the feedback')); }
        catch (e) { toast(e.message); }
      };
      actions.append(b);
    }
    m.append(actions);
  }
  messages.append(m); scrollDown();
}

let busy = false;
async function ask(q) {
  if (busy || !q) return;
  busy = true; $('sendBtn').disabled = true;
  addUser(q);
  const thinking = addThinking();
  try {
    const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ question: q, conversation_id: conversationId }) });
    thinking.remove(); addAnswer(r);
  } catch (err) {
    thinking.className = 'msg bot error'; thinking.textContent = err.message;
  } finally {
    busy = false; $('sendBtn').disabled = false; $('question').focus();
  }
}

const qBox = $('question');
function autosize() { qBox.style.height = 'auto'; qBox.style.height = Math.min(qBox.scrollHeight, 160) + 'px'; }
qBox.addEventListener('input', autosize);
qBox.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chatForm').requestSubmit(); }
});
$('chatForm').onsubmit = e => {
  e.preventDefault();
  const q = qBox.value.trim(); if (!q) return;
  qBox.value = ''; autosize(); ask(q);
};
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => ask(b.dataset.q));

$('newChat').onclick = () => {
  conversationId = crypto.randomUUID();
  sessionStorage.setItem('pilot_conversation_id', conversationId);
  messages.querySelectorAll('.msg').forEach(m => m.remove());
  $('empty').classList.remove('hidden');
  qBox.focus();
};

loadDocs();
