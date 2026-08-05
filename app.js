// ---------- versione app ----------
// Cambia SOLO questo numero a ogni modifica, prima di ricaricare i file su GitHub.
// Compare accanto a BACKSTAGE in alto: serve a capire a colpo d'occhio
// se il telefono sta girando la versione vecchia o quella nuova.
const APP_VERSION = 'v2';

// ---------- storage helpers ----------
const SETTINGS_KEY = 'backstage_settings_v1';
const LOG_KEY = 'backstage_log_v1';

function getSettings(){
  try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch(e){ return {}; }
}
function saveSettingsToStorage(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function getLog(){
  try{ return JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
  catch(e){ return []; }
}
function saveLog(items){
  localStorage.setItem(LOG_KEY, JSON.stringify(items.slice(0,50)));
}

// ---------- DOM refs ----------
const settingsBtn = document.getElementById('settingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const groqKeyInput = document.getElementById('groqKeyInput');
const vocabInput = document.getElementById('vocabInput');
const ghTokenInput = document.getElementById('ghTokenInput');
const ghRepoInput = document.getElementById('ghRepoInput');
const projectsInput = document.getElementById('projectsInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

const noteText = document.getElementById('noteText');
const saveBtn = document.getElementById('saveBtn');
const statusLine = document.getElementById('statusLine');
const recordBtn = document.getElementById('recordBtn');
const stageLabel = document.getElementById('stageLabel');
const meter = document.getElementById('meter');

const imageInput = document.getElementById('imageInput');
const imagePreviewWrap = document.getElementById('imagePreviewWrap');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');

const logList = document.getElementById('logList');
const logEmpty = document.getElementById('logEmpty');

let pendingImageBase64 = null; // { data, mime }

// ---------- settings modal ----------
function openSettings(){
  const s = getSettings();
  apiKeyInput.value = s.apiKey || '';
  groqKeyInput.value = s.groqKey || '';
  vocabInput.value = s.vocab || '';
  ghTokenInput.value = s.ghToken || '';
  ghRepoInput.value = s.ghRepo || '';
  projectsInput.value = (s.projects || []).join('\n');
  settingsModal.classList.remove('hidden');
}
function closeSettings(){ settingsModal.classList.add('hidden'); }

settingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e)=>{ if(e.target === settingsModal) closeSettings(); });

saveSettingsBtn.addEventListener('click', ()=>{
  const projects = projectsInput.value.split('\n').map(p=>p.trim()).filter(Boolean);
  saveSettingsToStorage({
    apiKey: apiKeyInput.value.trim(),
    groqKey: groqKeyInput.value.trim(),
    vocab: vocabInput.value.trim(),
    ghToken: ghTokenInput.value.trim(),
    ghRepo: ghRepoInput.value.trim(),
    projects
  });
  closeSettings();
  refreshSaveButton();
});

// ---------- tab delle impostazioni ----------
const settingsTabs = document.querySelectorAll('.tab');
const settingsPanels = document.querySelectorAll('.tab-panel');
settingsTabs.forEach(tab=>{
  tab.addEventListener('click', ()=>{
    const target = tab.dataset.tab;
    settingsTabs.forEach(t => t.classList.toggle('is-active', t === tab));
    settingsPanels.forEach(p => p.classList.toggle('is-active', p.dataset.panel === target));
  });
});

// first run: open settings automatically if nothing configured
if(!getSettings().apiKey){ openSettings(); }

// ---------- text input state ----------
function refreshSaveButton(){
  const hasText = noteText.value.trim().length > 0;
  const hasImage = !!pendingImageBase64;
  saveBtn.disabled = !(hasText || hasImage);
}
noteText.addEventListener('input', refreshSaveButton);

// ---------- image capture ----------
imageInput.addEventListener('change', ()=>{
  const file = imageInput.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    const dataUrl = reader.result; // data:image/jpeg;base64,....
    const [meta, b64] = dataUrl.split(',');
    const mime = meta.match(/data:(.*);base64/)[1];
    pendingImageBase64 = { data:b64, mime };
    imagePreview.src = dataUrl;
    imagePreviewWrap.classList.remove('hidden');
    refreshSaveButton();
  };
  reader.readAsDataURL(file);
});
removeImageBtn.addEventListener('click', ()=>{
  pendingImageBase64 = null;
  imageInput.value = '';
  imagePreviewWrap.classList.add('hidden');
  refreshSaveButton();
});

// ---------- voice capture (record full audio, then transcribe via Groq Whisper) ----------
let mediaRecorder = null;
let audioChunks = [];
let recording = false;
let mediaStream = null;

recordBtn.addEventListener('click', ()=>{
  if(recording){ stopRecording(); return; }
  startRecording();
});

async function startRecording(){
  const settings = getSettings();
  if(!settings.groqKey){
    setStatus('Aggiungi prima la chiave API Groq nelle impostazioni.', true);
    openSettings();
    return;
  }
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }catch(e){
    setStatus('Non riesco ad accedere al microfono: ' + e.message, true);
    return;
  }
  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = (e)=>{ if(e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start();

  recording = true;
  recordBtn.classList.add('recording');
  meter.classList.add('active');
  stageLabel.textContent = 'STO REGISTRANDO — TOCCA PER FERMARE';
  setStatus('');
}

function stopRecording(){
  recording = false;
  recordBtn.classList.remove('recording');
  meter.classList.remove('active');
  stageLabel.textContent = 'TOCCA PER PARLARE';
  if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if(mediaStream) mediaStream.getTracks().forEach(t => t.stop());
}

async function onRecordingStopped(){
  if(audioChunks.length === 0) return;
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
  if(blob.size < 1000){ setStatus('Registrazione troppo breve, riprova.', true); return; }

  setStatus('Trascrivo il vocale…');
  try{
    const transcript = await transcribeWithGroq(blob);
    noteText.value = (noteText.value ? noteText.value + ' ' : '') + transcript;
    refreshSaveButton();
    setStatus('Trascrizione pronta. Controlla il testo e tocca "Smista".');
  }catch(err){
    console.error(err);
    setStatus('Errore trascrizione: ' + err.message, true);
  }
}

async function transcribeWithGroq(audioBlob){
  const settings = getSettings();
  const form = new FormData();
  form.append('file', audioBlob, 'nota.webm');
  form.append('model', 'whisper-large-v3'); // non-turbo: leggermente più precisa sul parlato veloce/tecnico
  form.append('language', 'it');
  if(settings.vocab) form.append('prompt', settings.vocab);

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${settings.groqKey}` },
    body: form
  });
  if(!res.ok){
    const t = await res.text();
    throw new Error(`Groq ${res.status}: ${t.slice(0,200)}`);
  }
  const data = await res.json();
  return (data.text || '').trim();
}

// ---------- status ----------
function setStatus(msg, isError){
  statusLine.textContent = msg;
  statusLine.classList.toggle('error', !!isError);
}

// ---------- log rendering ----------
function renderLog(){
  const items = getLog();
  logList.innerHTML = '';
  logEmpty.classList.toggle('hidden', items.length > 0);
  items.forEach(item=>{
    const li = document.createElement('li');
    li.className = 'log-item';
    const tagClass = item.status === 'ok' ? '' : (item.status === 'error' ? 'err' : 'pending');
    li.innerHTML = `
      <div class="log-item-top">
        <span class="log-tag ${tagClass}">${escapeHtml(item.project || '…')}</span>
        <span class="log-time">${item.time}</span>
      </div>
      <div class="log-text">${escapeHtml(item.preview)}</div>
    `;
    logList.appendChild(li);
  });
}
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
function pushLogEntry(entry){
  const items = getLog();
  items.unshift(entry);
  saveLog(items);
  renderLog();
}
function updateLogEntry(id, patch){
  const items = getLog();
  const idx = items.findIndex(i=>i.id === id);
  if(idx >= 0){ items[idx] = {...items[idx], ...patch}; saveLog(items); renderLog(); }
}

// ---------- Claude categorization ----------
async function categorize(noteContent, hasImage, settings){
  const projectList = settings.projects && settings.projects.length
    ? settings.projects.map(p=>`- ${p}`).join('\n')
    : '(nessun progetto configurato — usa "Da rivedere")';

  const systemPrompt = `Sei un assistente che smista appunti veloci di Bruno nei suoi progetti personali.
Progetti esistenti:
${projectList}

Ricevi un appunto grezzo (a volte trascritto da un vocale, quindi può contenere ripetizioni o essere poco strutturato, o riferirsi a un'immagine allegata).
Rispondi SOLO con un oggetto JSON, senza markdown, nel formato:
{"project": "<uno dei nomi esatti sopra, oppure 'Da rivedere' se non è chiaro>", "title": "<titolo breve, max 8 parole>", "cleaned": "<versione pulita e leggibile dell'appunto in italiano, in markdown, senza ripetizioni, mantenendo tutte le informazioni utili>"}`;

  const userContent = hasImage
    ? (noteContent ? noteContent : 'Appunto composto solo da un\'immagine allegata, nessun testo.')
    : noteContent;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role:'user', content: userContent }]
    })
  });

  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText.slice(0,200)}`);
  }
  const data = await res.json();
  const raw = data.content.map(b=>b.text || '').join('').trim();
  const cleanedJson = raw.replace(/^```json\s*|^```\s*|```$/g, '').trim();
  return JSON.parse(cleanedJson);
}

// ---------- GitHub commit ----------
function slugify(str){
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'da-rivedere';
}

async function ghRequest(path, opts, settings){
  const url = `https://api.github.com/repos/${settings.ghRepo}/contents/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${settings.ghToken}`,
      'Accept': 'application/vnd.github+json',
      ...(opts.headers || {})
    }
  });
  return res;
}

async function commitMarkdown(project, title, cleanedMd, settings){
  const path = `inbox/${slugify(project)}.md`;
  const getRes = await ghRequest(path, { method:'GET' }, settings);
  let existingContent = '';
  let sha = null;
  if(getRes.status === 200){
    const fileData = await getRes.json();
    sha = fileData.sha;
    existingContent = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g,''))));
  } else if(getRes.status !== 404){
    throw new Error(`GitHub GET ${getRes.status}`);
  }

  const stamp = new Date().toLocaleString('it-IT');
  const entry = `\n\n---\n### ${title}\n*${stamp}*\n\n${cleanedMd}\n`;
  const newContent = existingContent
    ? existingContent + entry
    : `# ${project}\n${entry}`;

  const b64 = btoa(unescape(encodeURIComponent(newContent)));
  const putBody = {
    message: `Backstage: nuovo appunto — ${title}`,
    content: b64,
    ...(sha ? { sha } : {})
  };
  const putRes = await ghRequest(path, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(putBody)
  }, settings);
  if(!putRes.ok){
    const t = await putRes.text();
    throw new Error(`GitHub PUT ${putRes.status}: ${t.slice(0,200)}`);
  }
}

async function commitImage(project, base64Image, filenameHint){
  // reserved for future use if you want images committed as separate files
}

// ---------- save / smista flow ----------
saveBtn.addEventListener('click', async ()=>{
  const settings = getSettings();
  if(!settings.apiKey || !settings.ghToken || !settings.ghRepo){
    setStatus('Completa prima le impostazioni (chiave API, token e repo GitHub).', true);
    openSettings();
    return;
  }
  if(recording){
    stopRecording();
    setStatus('Fermo la registrazione — attendi la trascrizione, poi tocca di nuovo "Smista".');
    return;
  }

  const content = noteText.value.trim();
  const hasImage = !!pendingImageBase64;
  if(!content && !hasImage) return;

  const id = Date.now().toString();
  const preview = content ? content.slice(0,120) : '[immagine allegata]';
  pushLogEntry({ id, project:'…', preview, time:new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}), status:'pending' });

  saveBtn.disabled = true;
  setStatus('Sto smistando l\'appunto…');

  try{
    const result = await categorize(content, hasImage, settings);
    setStatus(`Salvo in "${result.project}"…`);
    await commitMarkdown(result.project, result.title, result.cleaned, settings);
    updateLogEntry(id, { project: result.project, preview: result.title, status:'ok' });
    setStatus(`Fatto — smistato in "${result.project}".`);
    noteText.value = '';
    pendingImageBase64 = null;
    imageInput.value = '';
    imagePreviewWrap.classList.add('hidden');
    refreshSaveButton();
  }catch(err){
    console.error(err);
    updateLogEntry(id, { status:'error', project:'errore' });
    setStatus('Errore: ' + err.message, true);
    saveBtn.disabled = false;
  }
});

// ---------- init ----------
document.getElementById('appVersion').textContent = APP_VERSION;
renderLog();
refreshSaveButton();

// ---------- service worker ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
