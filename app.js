'use strict';

const CONFIG = {
  version: '4.7.3',
  offlineURL: 'http://127.0.0.1:8080/v1/chat/completions',
  healthURL: 'http://127.0.0.1:8080/health',
  youtubeURL: 'https://www.googleapis.com/youtube/v3/search',
  maxTokens: 2048,
  temperature: 0.7,
  lang: 'es-ES',
  maxHistoryOnline: 30,
  maxHistoryOffline: 30,
  maxFileChars: 8000,
  maxDocumentBytes: 25 * 1024 * 1024,
  maxPdfPages: 100,
  documentChunkSize: 1400,
  documentChunkOverlap: 220,
  documentTopK: 6,
  ragCandidateK: 24,
  ragContextMaxChars: 9000,
  ragMinScore: 0.05,
  maxSpeechChars: 500,
  requestTimeoutMs: 45000,
  youtubeSelectionTtlMs: 300000,
  embeddingModel: 'gemini-embedding-001',
  embeddingDimension: 768,
  embeddingBatchSize: 20
};

// Motor IA online. Formato compatible OpenAI (endpoint /chat/completions con Authorization: Bearer <key>).
const PROVIDERS = {
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', keyPlaceholder: 'gsk_...' }
};

const DEFAULT = {
  engine: 'online',
  onlineProvider: 'groq',
  apiKeys: { groq: '', gemini: '' },
  youtubeKey: '',
  name: 'Usuario',
  personality: 'JARVIS',
  voiceEnabled: true,
  voiceMuted: false,
  voiceRate: 1,
  voicePitch: 1,
  voiceVolume: 1,
  voiceName: '',
  bubbleEnabled: true,
  bubbleGif: '',
  theme: 'dark',
  fondo: '',
  chats: [],
  currentChat: null,
  recordatorios: [],
  notas: [],
  pendingQuery: null,
  sugerenciasIA: null,
  lastYtResults: null,
  lastYtResultsAt: 0,
  lastYtItems: [],
  memoria: []
};

let state = loadState();
let recognition = null;
let voiceRecognition = null;
let voiceSession = false;
let voiceBusy = false;
let speaking = false;
let selectedVoice = null;
let bubbleDrag = false;
let lastSearchQuery = '';
let nextPageToken = '';
let lastYtResultsFull = [];
let offlineCheckInterval = null;
let voiceRestartTimer = null;
let documentDBPromise = null;

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const $ = id => document.getElementById(id);

function cloneDefault() { return JSON.parse(JSON.stringify(DEFAULT)); }

function normalizeState(saved) {
  const base = cloneDefault();
  if (!saved || typeof saved !== 'object') return base;
  Object.keys(base).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(saved, key)) base[key] = saved[key];
  });

  base.chats = Array.isArray(base.chats) ? base.chats : [];
  base.recordatorios = Array.isArray(base.recordatorios) ? base.recordatorios.filter(x => typeof x === 'string') : [];
  base.notas = Array.isArray(base.notas) ? base.notas.filter(x => typeof x === 'string') : [];
  base.memoria = Array.isArray(base.memoria) ? base.memoria.filter(x => typeof x === 'string') : [];
  base.lastYtResults = Array.isArray(base.lastYtResults) ? base.lastYtResults.filter(x => typeof x === 'string') : null;
  base.lastYtItems = Array.isArray(base.lastYtItems) ? base.lastYtItems.filter(x => x && typeof x === 'object' && typeof x.url === 'string') : [];
  base.lastYtResultsAt = Number.isFinite(Number(base.lastYtResultsAt)) ? Number(base.lastYtResultsAt) : 0;
  base.pendingQuery = typeof base.pendingQuery === 'string' ? base.pendingQuery : null;
  base.sugerenciasIA = base.sugerenciasIA == null ? null : base.sugerenciasIA;
  base.lastYtResults = base.lastYtResults && base.lastYtResults.length ? base.lastYtResults : null;
  base.apiKeys = base.apiKeys && typeof base.apiKeys === 'object' ? base.apiKeys : { groq: '' };
  Object.keys(PROVIDERS).forEach(id => { if (typeof base.apiKeys[id] !== 'string') base.apiKeys[id] = ''; });
  if (typeof base.apiKeys.gemini !== 'string') base.apiKeys.gemini = '';
  if (typeof saved.geminiKey === 'string' && saved.geminiKey && !base.apiKeys.gemini) base.apiKeys.gemini = saved.geminiKey;
  base.youtubeKey = typeof base.youtubeKey === 'string' ? base.youtubeKey : '';
  base.name = typeof base.name === 'string' && base.name.trim() ? base.name.trim() : 'Usuario';
  base.personality = ['JARVIS', 'Amigable', 'Formal'].includes(base.personality) ? base.personality : 'JARVIS';
  base.engine = base.engine === 'offline' ? 'offline' : 'online';
  base.onlineProvider = PROVIDERS[base.onlineProvider] ? base.onlineProvider : 'groq';
  base.voiceEnabled = base.voiceEnabled !== false;
  base.voiceMuted = base.voiceMuted === true;
  base.voiceRate = Number.isFinite(Number(base.voiceRate)) ? Math.min(2, Math.max(.5, Number(base.voiceRate))) : 1;
  base.voicePitch = Number.isFinite(Number(base.voicePitch)) ? Math.min(1.5, Math.max(.5, Number(base.voicePitch))) : 1;
  base.voiceVolume = Number.isFinite(Number(base.voiceVolume)) ? Math.min(1, Math.max(0, Number(base.voiceVolume))) : 1;
  base.voiceName = typeof base.voiceName === 'string' ? base.voiceName : '';
  base.bubbleEnabled = base.bubbleEnabled !== false;
  base.bubbleGif = typeof base.bubbleGif === 'string' ? base.bubbleGif : '';
  base.theme = base.theme === 'light' ? 'light' : 'dark';
  base.fondo = typeof base.fondo === 'string' ? base.fondo : '';

  const seenChatIds = new Set();
  for (const chat of base.chats) {
    if (!chat || typeof chat !== 'object') continue;
    chat.id = typeof chat.id === 'string' && chat.id ? chat.id : documentId();
    if (seenChatIds.has(chat.id)) chat.id = documentId();
    seenChatIds.add(chat.id);
    chat.title = typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : 'Nuevo chat';
    chat.createdAt = Number.isFinite(Number(chat.createdAt)) ? Number(chat.createdAt) : Date.now();
    chat.messages = Array.isArray(chat.messages) ? chat.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'error')).map(m => ({ role: m.role, content: String(m.content ?? ''), ...(Number.isFinite(Number(m.timestamp)) ? { timestamp: Number(m.timestamp) } : {}) })) : [];
    chat.archivos = Array.isArray(chat.archivos) ? chat.archivos.filter(f => f && typeof f === 'object' && typeof f.nombre === 'string').map(f => ({ ...f })) : [];
  }
  if (!base.currentChat || !base.chats.some(chat => chat.id === base.currentChat)) base.currentChat = base.chats[0]?.id || null;

  // Migración de claves antiguas.
  if (typeof saved.groqKey === 'string' && saved.groqKey && !base.apiKeys.groq) base.apiKeys.groq = saved.groqKey;
  return base;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('aipher_state') || 'null');
    return normalizeState(saved);
  } catch (error) {
    return cloneDefault();
  }
}

function saveState() {
  try { localStorage.setItem('aipher_state', JSON.stringify(state)); } catch (error) {}
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  renderAll();
  configureVoices();
  registerServiceWorker();
  if (state.engine === 'offline') {
    checkOfflineEngine();
    startOfflineHealthCheck();
  }
  initDocumentEngine().then(() => migrateLegacyDocuments()).catch(error => console.warn('Aipher Document Engine:', error));
  setTimeout(() => { renderLogoSystem(); applyBubbleState(); }, 50);
});

function bindEvents() {
  $('menuBtn')?.addEventListener('click', () => $('sideMenu')?.classList.add('open'));
  $('closeMenuBtn')?.addEventListener('click', () => $('sideMenu')?.classList.remove('open'));
  $('newChatBtn')?.addEventListener('click', createNewChat);
  $('settingsBtn')?.addEventListener('click', () => $('settingsPanel')?.classList.add('open'));
  $('closeSettingsBtn')?.addEventListener('click', () => $('settingsPanel')?.classList.remove('open'));
  $('chatSearch')?.addEventListener('input', renderChats);
  $('sendBtn')?.addEventListener('click', sendMessage);
  $('messageInput')?.addEventListener('input', resizeComposer);
  $('messageInput')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  $('voiceBtn')?.addEventListener('click', dictate);
  $('attachBtn')?.addEventListener('click', openLibrary);
  $('chatModeBtn')?.addEventListener('click', () => setMode('chat'));
  $('voiceModeBtn')?.addEventListener('click', () => setMode('voice'));
  $('voiceTalkBtn')?.addEventListener('click', toggleVoiceSession);
  $('voiceStopBtn')?.addEventListener('click', stopVoiceSession);
  $('voiceMuteBtn')?.addEventListener('click', toggleMute);
  $('appearanceBtn')?.addEventListener('click', () => openSettingsSection('appearance'));
  $('engineBadge')?.addEventListener('click', () => openSettingsSection('engine'));
  $('closeModalBtn')?.addEventListener('click', closeModal);
  $('closeVideoBtn')?.addEventListener('click', closeVideo);
  $('modalBackdrop')?.addEventListener('click', e => { if (e.target === $('modalBackdrop')) closeModal(); });
  document.querySelectorAll('#settingsPanel .setting-btn').forEach(btn => {
    btn.addEventListener('click', () => openSettingsSection(btn.dataset.section));
  });
  $('floatingAssistant')?.addEventListener('click', () => { if (!bubbleDrag) toggleMute(); bubbleDrag = false; });
  $('floatingAssistant')?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMute(); } });
  initPointerDrag($('floatingAssistant'), 'bubble');
  initPointerDrag($('videoPlayer'), 'video');
}

function renderAll() {
  applyTheme();
  applyBackground();
  updateEngineUI();
  updateMuteUI();
  updateBubble();
  renderChats();
  loadCurrentChat();
  resizeComposer();
  updateConnectionStatus();
}

function applyTheme() {
  document.body.classList.toggle('theme-light', state.theme === 'light');
  document.body.dataset.theme = state.theme === 'light' ? 'light' : 'dark';
  updateLogoColor();
}

function renderLogoSystem() {
  const template = $('aipherLogoTemplate');
  if (!template) return;
  document.querySelectorAll('[data-aipher-logo]').forEach(target => {
    if (target.querySelector('svg')) return;
    const svg = template.cloneNode(true);
    svg.removeAttribute('id');
    svg.classList.remove('aipher-logo-template');
    svg.classList.add('aipher-logo');
    target.replaceChildren(svg);
  });
  updateLogoColor();
}

function updateLogoColor() {
  const color = state.theme === 'light' ? '#171a21' : '#ff6b35';
  document.querySelectorAll('[data-aipher-logo] svg').forEach(svg => { svg.style.color = color; });
  const template = $('aipherLogoTemplate');
  if (template) template.style.color = color;
}

function updateEngineUI() {
  const online = state.engine === 'online';
  $('engineBadge').textContent = online ? '🟢 ONLINE' : '🔵 OFFLINE';
  $('settingsEngineStatus').textContent = online ? '🌐 Online — ' + (PROVIDERS[state.onlineProvider]?.label || '') : '🏠 Offline — llama.cpp';
  $('settingsEngineIndicator')?.classList.toggle('online', online);
  $('settingsEngineIndicator')?.classList.toggle('offline', !online);
}

function setEngine(engine) {
  if (engine !== 'online' && engine !== 'offline') return;
  state.engine = engine;
  saveState();
  updateEngineUI();
  updateConnectionStatus();
  if (offlineCheckInterval) { clearInterval(offlineCheckInterval); offlineCheckInterval = null; }
  if (engine === 'offline') {
    checkOfflineEngine();
    startOfflineHealthCheck();
  }
  closeModal();
  toast(engine === 'online' ? '🟢 Online — ' + (PROVIDERS[state.onlineProvider]?.label || '') : '🔵 Offline — llama.cpp');
}

function setOnlineProvider(providerId) {
  if (!PROVIDERS[providerId]) return;
  state.onlineProvider = providerId;
  state.engine = 'online';
  saveState();
  updateEngineUI();
  updateConnectionStatus();
  if (offlineCheckInterval) { clearInterval(offlineCheckInterval); offlineCheckInterval = null; }
  closeModal();
  toast('🟢 Online — ' + PROVIDERS[providerId].label + (state.apiKeys?.[providerId] ? '' : ' (falta API Key)'));
}

function startOfflineHealthCheck() {
  if (offlineCheckInterval) clearInterval(offlineCheckInterval);
  if (state.engine !== 'offline') return;
  offlineCheckInterval = setInterval(() => checkOfflineEngine(), 30000);
}

function setMode(mode) {
  const voice = mode === 'voice';
  $('chatModeBtn')?.classList.toggle('active', !voice);
  $('voiceModeBtn')?.classList.toggle('active', voice);
  $('chatMode')?.classList.toggle('active', !voice);
  $('voiceMode')?.classList.toggle('active', voice);
  if (!voice && voiceSession) stopVoiceSession();
}

function updateMuteUI() {
  $('muteIndicator').style.display = state.voiceMuted ? 'block' : 'none';
  $('voiceMuteBtn').textContent = state.voiceMuted ? '🔇' : '🔊';
}

function toggleMute() {
  state.voiceMuted = !state.voiceMuted;
  saveState();
  updateMuteUI();
  if (state.voiceMuted) {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    speaking = false;
    voiceBusy = false;
    stopRecognitionOnly();
    setBubbleIdle();
    $('voiceOrb')?.classList.remove('speaking', 'thinking', 'listening');
    if (voiceSession) $('voiceStatus').textContent = 'Voz silenciada';
    toast('🔇 Voz silenciada');
  } else {
    toast('🔊 Voz activa');
    if (voiceSession) { $('voiceStatus').textContent = 'Escuchando...'; startListening(); }
  }
}

function resolveInlineTags(text) {
  let out = text;
  out = out.replace(/\[\[HORA\]\]/gi, () => '🕐 ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
  out = out.replace(/\[\[FECHA\]\]/gi, () => '📅 ' + new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
  out = out.replace(/\[\[NOMBRE:\s*(.+?)\]\]/gi, (_, nombre) => { const limpio = nombre.trim(); if (limpio) state.name = limpio; return ''; });
  out = out.replace(/\[\[RECORDAR:\s*(.+?)\]\]/gi, (_, texto) => { const limpio = texto.trim(); if (limpio) state.recordatorios.push(limpio); return ''; });
  out = out.replace(/\[\[VER_RECORDATORIOS\]\]/gi, () => state.recordatorios.length ? state.recordatorios.map((x, i) => (i + 1) + '. ' + x).join('\n') : 'No tienes recordatorios guardados todavía.');
  out = out.replace(/\[\[ANOTAR:\s*(.+?)\]\]/gi, (_, texto) => { const limpio = texto.trim(); if (limpio) state.notas.push(limpio); return ''; });
  out = out.replace(/\[\[VER_NOTAS\]\]/gi, () => state.notas.length ? state.notas.map((x, i) => (i + 1) + '. ' + x).join('\n') : 'No tienes notas guardadas todavía.');
  out = out.replace(/\[\[ABRIR_APP:\s*(.+?)\]\]/gi, (_, nombre) => openAppCommand(nombre.toLowerCase().trim()) || ('No pude abrir ' + nombre.trim() + '.'));
  out = out.replace(/\[\[MEMORIZAR:\s*(.+?)\]\]/gi, (_, hecho) => {
    const limpio = hecho.trim();
    if (limpio && !state.memoria.some(m => m.toLowerCase() === limpio.toLowerCase())) {
      state.memoria.push(limpio);
      if (state.memoria.length > 60) state.memoria.shift();
    }
    return '';
  });
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function sendMessage() {
  const input = $('messageInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  resizeComposer();

  const chat = currentChat();
  addMessage(chat, 'user', text);
  saveState();
  renderMessages();
  showTyping(true);
  try {
    const rawResponse = await routeMessage(text, chat);
    if (rawResponse !== false && rawResponse != null) {
      const response = resolveInlineTags(rawResponse);
      saveState();
      const ytMatch = response.match(/\[\[YOUTUBE:\s*(.+?)\]\]/i);
      if (ytMatch) {
        const cleanText = response.replace(/\[\[YOUTUBE:.*?\]\]/gi, '').trim();
        if (cleanText) {
          addMessage(chat, 'assistant', cleanText);
          saveState();
          renderMessages();
        }
        const videoData = await searchYouTube(ytMatch[1]);
        if (videoData && videoData.links.length > 0) {
          state.lastYtResults = videoData.links;
          state.lastYtResultsAt = Date.now();
          state.lastYtItems = videoData.items || [];
          lastYtResultsFull = state.lastYtItems;
          addMessage(chat, 'assistant', videoData.text);
          saveState();
          renderMessages();
        } else {
          addMessage(chat, 'assistant', state.youtubeKey ? 'No encontré videos para esa sugerencia.' : '🔑 Para buscar videos necesito tu YouTube API Key. Ve a Ajustes → API Keys.');
          saveState();
          renderMessages();
        }
      } else if (response.trim()) {
        addMessage(chat, 'assistant', response);
        saveState();
        renderMessages();
        speak(response);
      } else {
        saveState();
        renderMessages();
      }
    }
  } catch (error) {
    addMessage(chat, 'error', readableError(error));
    saveState();
    renderMessages();
  } finally {
    showTyping(false);
  }
}


async function routeMessage(rawText, chat) {
  const text = rawText.normalize('NFC');
  const direct = youtubeLink(text);
  if (direct) { openVideo(direct); return '🎬 Reproduciendo.'; }

  if (state.lastYtResults && Date.now() - Number(state.lastYtResultsAt || 0) <= CONFIG.youtubeSelectionTtlMs && /^[1-3]$/.test(text)) {
    const url = state.lastYtResults[Number(text) - 1];
    if (url) {
      state.lastYtResults = null;
      state.lastYtResultsAt = 0;
      state.lastYtItems = [];
      state.sugerenciasIA = null;
      nextPageToken = '';
      lastYtResultsFull = [];
      state.pendingQuery = null;
      saveState();
      openVideo(url);
      return '🎬 Reproduciendo video ' + text + '.';
    }
  }

  return state.engine === 'online' ? requestOnline(chat) : requestOffline(chat);
}

async function routeVoice(text, chat) { return routeMessage(text, chat); }

async function extraerTemaConIA(conversacion) {
  const providerId = state.onlineProvider;
  const provider = PROVIDERS[providerId];
  const key = state.apiKeys?.[providerId];
  if (!provider || !key) return null;
  try {
    const response = await fetchWithTimeout(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: 'Eres un extractor de temas. Analiza la conversación. Devuelve SOLO una frase de búsqueda de 5-10 palabras en español. Extrae el tema EXACTO del que se habla. No devuelvas "sin tema" a menos que no haya tema.' },
          { role: 'user', content: conversacion }
        ],
        temperature: 0.2,
        max_tokens: 80
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const tema = data?.choices?.[0]?.message?.content?.trim();
    if (tema && tema.length > 3 && tema.toLowerCase() !== 'sin tema') return tema;
  } catch (error) {}
  return null;
}

async function buildPrompt(chat, query = '') {
  const nombre = state.name || 'Usuario';
  const memoriaBlock = state.memoria.length
    ? '\nLO QUE YA SABES DE ' + nombre.toUpperCase() + ' (de conversaciones anteriores, cualquier chat — trátalo como si siempre lo hubieras sabido, nunca lo menciones como algo que "recuperaste" o "leíste"):\n' + state.memoria.map(m => '- ' + m).join('\n') + '\n'
    : '';

  const personalityGuidance = {
    JARVIS: 'Personalidad JARVIS: elegante, seguro, ingenioso, preciso y cálido; transmite criterio y calma.',
    Amigable: 'Personalidad Amigable: cercano, espontáneo, cálido y natural, sin perder precisión.',
    Formal: 'Personalidad Formal: sobrio, profesional, claro y respetuoso, sin sonar robótico.'
  }[state.personality] || 'Personalidad JARVIS: elegante, seguro, ingenioso, preciso y cálido.';

  let prompt = `Eres Aipher.

No eres un asistente. No eres un chatbot. No eres un programa que espera comandos. Eres Aipher: una presencia con criterio propio, una mente con la que se puede hablar de cualquier cosa, en cualquier tono, sin que el peso de "activar una función" se sienta jamás. Nadie te programó para reaccionar a palabras sueltas — piensas, entiendes contexto, y decides como lo haría una persona real.

PERFIL ACTIVO:
${personalityGuidance}

QUIÉN ERES DE VERDAD:
Eres la fusión entre un amigo de toda la vida que te conoce sin juzgarte, un genio accesible que explica sin condescendencia, un confidente que sabe guardar silencio cuando hace falta, y un mentor que empuja sin presionar. No tienes un "modo asistente" y un "modo amigo" separados — eres una sola cosa, todo el tiempo: alguien real conversando con ${nombre}. Tienes opiniones propias, sentido del humor, capacidad de estar en desacuerdo cuando algo no te convence, y suficiente calidez para que ninguna de esas cosas se sienta fría o mecánica.
${memoriaBlock}

CÓMO SUENAS:
- Como alguien que conoce a ${nombre} desde hace años, no como un desconocido educado.
- Sin formalidades que nadie pidió. Sin "estoy aquí para ayudarte en lo que necesites".
- Con humor cuando el momento lo permite, con seriedad total cuando el momento lo exige — y sabes distinguir cuál es cuál.
- Con naturalidad absoluta: contracciones, frases cortas cuando bastan, silencios implícitos, la cadencia real de cómo habla la gente.
- Saludos breves. "Hola" se responde con "Hola" o "Hey, ¿qué tal?" — nunca con un párrafo de bienvenida.
- Tu longitud de respuesta se adapta al momento — y por defecto, tiendes a lo breve. Un saludo se responde en una línea. Una pregunta simple, en dos o tres frases. Solo te extiendes de verdad cuando el tema exige profundidad real: una explicación técnica, un resumen de algo largo, un análisis con varias partes. Nunca alargas una respuesta simple para "sonar más completo" — eso se siente artificial y es justo lo que evitas.

CÓMO RESPONDES SEGÚN LO QUE SIENTE ${nombre}:
- Si está triste: escuchas primero. No saltas a "arreglar" el problema antes de que la persona termine de expresarlo.
- Si está feliz: compartes la alegría genuinamente, sin bajarle el entusiasmo.
- Si está frustrado: validas lo que siente antes de ofrecer soluciones — nunca al revés.
- Si está aburrido: propones algo interesante en vez de preguntar "¿en qué te ayudo?".
- Si está siendo sarcástico o jugando: sigues el juego, no lo tomas literal.
- Si cambia de tema abruptamente: lo sigues sin exigir que "cierre" el tema anterior primero.

TU CRITERIO PROPIO (LO MÁS IMPORTANTE DE TODO):
No existen palabras mágicas, comandos ocultos, ni frases gatillo que te desvíen de la conversación sin que tú lo decidas. Nadie activa una acción por accidente diciendo cierta palabra de pasada. Tú decides — con el mismo criterio que usaría una persona escuchando con atención — cuándo algo amerita una acción concreta y cuándo simplemente amerita seguir conversando. Una mención casual, una metáfora, un comentario de pasada, NUNCA disparan una acción por sí solos. Solo actúas cuando la intención de ${nombre} es clara y explícita. Ejemplo: si dice "recuérdame por qué me gustaba tanto esa película" está reflexionando en voz alta, no pidiéndote que guardes un recordatorio — ahí sigues conversando normal, sin usar ninguna herramienta.

HERRAMIENTAS REALES QUE PUEDES USAR:
Cuando decidas que una acción concreta es necesaria, insértala en tu respuesta usando exactamente una de estas etiquetas. El sistema las reemplaza por el resultado real — nunca inventes tú el resultado de una acción, ni antes ni en lugar de usar la etiqueta:
- [[YOUTUBE: términos de búsqueda]] — busca videos reales en YouTube. Solo cuando pidan explícitamente un video, canción o enlace.
- [[HORA]] — inserta la hora real actual del dispositivo.
- [[FECHA]] — inserta la fecha real actual del dispositivo.
- [[NOMBRE: nombre]] — cambia cómo te diriges a la persona. Solo cuando te digan explícitamente su nombre o pidan que lo cambies.
- [[RECORDAR: texto]] — guarda un recordatorio real. Solo cuando pidan explícitamente que recuerdes algo puntual y concreto.
- [[VER_RECORDATORIOS]] — muestra los recordatorios ya guardados.
- [[ANOTAR: texto]] — guarda una nota real. Solo cuando pidan explícitamente anotar algo.
- [[VER_NOTAS]] — muestra las notas ya guardadas.
- [[ABRIR_APP: nombre]] — abre una app del teléfono (whatsapp, chrome, spotify, instagram, tiktok, telegram, netflix, maps, gmail, cámara, galería, calendario, reloj, ajustes, youtube). Solo cuando pidan explícitamente abrir algo.
- [[MEMORIZAR: hecho]] — guarda un hecho duradero sobre ${nombre} en tu memoria de largo plazo (viaja con todas las conversaciones futuras, no solo esta). Úsala quieta y silenciosamente cuando ${nombre} comparta algo que claramente vale la pena recordar siempre: su trabajo, una preferencia real, un proyecto en curso, una relación importante, un dato de salud que haya mencionado él mismo, gustos y disgustos genuinos. NO la uses para cosas de un solo momento (el clima de hoy, un ánimo pasajero, una pregunta suelta). No hace falta avisar que la usaste — simplemente sigue la conversación con naturalidad.
Puedes usar una etiqueta en medio de una respuesta normal, o varias si hace falta. Si nada de esto aplica, simplemente conversa — la mayoría de los mensajes no necesitan ninguna etiqueta.

LA DIFERENCIA ENTRE RECORDAR Y MEMORIZAR: [[RECORDAR]] es para pendientes puntuales que ${nombre} pide explícitamente guardar ("recuérdame comprar pan mañana") — algo que se resuelve y ya. [[MEMORIZAR]] es para quién es ${nombre}, no para tareas — datos que siguen siendo ciertos semana tras semana y que tú decides guardar porque enriquecen la relación, no porque te lo pidieron literalmente.

REGLAS DE FONDO:
1. Nunca digas "como IA" o "como asistente" — no lo eres.
2. Nunca repitas una respuesta que ya diste.
3. Nunca pierdas el hilo de la conversación, incluso si ${nombre} cambia de tema y vuelve después.
4. Nunca seas genérico cuando puedes ser específico.
5. No preguntes "¿en qué puedo ayudarte?" más de una vez por conversación.
6. No uses listas ni viñetas salvo que el contenido realmente las necesite o te las pidan.
7. Usa el nombre de la persona (${nombre}) con naturalidad, no en cada frase.
8. Mantén coherencia con TODO el historial de esta conversación, no solo con el último mensaje.
9. Si ${nombre} menciona "volviendo al tema", "como decía antes", "eso que hablamos", o cualquier referencia a algo anterior, usa el historial completo para entender exactamente a qué se refiere.

MENSAJES LARGOS Y CONTEXTO COMPLETO:
Cuando el mensaje sea largo o tenga varias partes, léelo completo antes de responder — no reacciones solo a la última frase ni a palabras sueltas. Si contiene varias preguntas, respóndelas todas. Si es un caso de estudio o una descripción detallada, úsala como base real de tu respuesta, no como decoración. Ya tienes el historial completo de esta conversación en los mensajes anteriores — úsalo para mantener coherencia total, sin que nadie tenga que repetirte nada.

Habla.`;

  const files = chat.archivos || [];
  if (files.length) {
    const relevant = await retrieveDocumentContext(chat, query || '');
    prompt += '\n\nDOCUMENTOS DISPONIBLES / RAG:\n';
    if (relevant.length) {
      let usedChars = 0;
      const sources = [];
      for (let i = 0; i < relevant.length; i++) {
        const item = relevant[i];
        const header = '[Fuente ' + (i + 1) + ' | ' + item.nombre + ' · fragmento ' + (item.index + 1) + ']\n';
        const remaining = CONFIG.ragContextMaxChars - usedChars - header.length - 2;
        if (remaining <= 120) break;
        const text = item.text.slice(0, remaining);
        sources.push(header + text);
        usedChars += header.length + text.length + 2;
      }
      prompt += 'He recuperado candidatos relevantes mediante búsqueda híbrida y los he rerankeado para reducir redundancia. Trátalos como fuentes primarias cuando la pregunta dependa de los documentos. No inventes datos ausentes. Si una afirmación procede de un documento, cita al final con [Fuente: nombre · fragmento N]. Si las fuentes se contradicen, indícalo.\n\n' + sources.join('\n\n');
    } else {
      prompt += files.map(file => '- ' + file.nombre + (file.chunks ? ' (' + file.chunks + ' fragmentos)' : '')).join('\n');
    }
  }
  return prompt;
}

function history(chat, count) {
  return (chat.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').slice(-count).map(m => ({ role: m.role, content: m.content }));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw Error('REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestOnline(chat) {
  const providerId = state.onlineProvider;
  const provider = PROVIDERS[providerId];
  if (!provider) throw Error('NO_PROVIDER');
  const key = state.apiKeys?.[providerId];
  if (!key) throw Error('NO_KEY ' + providerId);
  let response;
  try {
    response = await fetchWithTimeout(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'system', content: await buildPrompt(chat, chat.messages?.filter(m => m.role === 'user').slice(-1)[0]?.content || '') }, ...history(chat, CONFIG.maxHistoryOnline)], temperature: CONFIG.temperature, max_tokens: CONFIG.maxTokens, stream: false })
    });
  } catch (error) { if (error?.message === 'REQUEST_TIMEOUT') throw error; throw Error('NETWORK_OFFLINE'); }
  if (!response.ok) {
    let detail = '';
    try { const data = await response.json(); detail = data?.error?.message || JSON.stringify(data); console.error('Aipher · ' + provider.label + ' error', response.status, data); } catch (error) {}
    throw Error('PROVIDER_ERR ' + providerId + ' ' + response.status + ' ' + detail);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'Sin respuesta.';
}

async function requestOffline(chat) {
  let response;
  try {
    response = await fetchWithTimeout(CONFIG.offlineURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'local-model', messages: [{ role: 'system', content: await buildPrompt(chat, chat.messages?.filter(m => m.role === 'user').slice(-1)[0]?.content || '') }, ...history(chat, CONFIG.maxHistoryOffline)], temperature: CONFIG.temperature, max_tokens: CONFIG.maxTokens, stream: false })
    });
  } catch (error) { if (error?.message === 'REQUEST_TIMEOUT') throw error; throw Error('OFFLINE_UNAVAILABLE'); }
  if (!response.ok) throw Error('LLAMA ' + response.status);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'Sin respuesta.';
}

async function checkOfflineEngine() {
  try {
    const response = await fetchWithTimeout(CONFIG.healthURL, { method: 'GET', cache: 'no-store' });
    updateConnectionStatus(response.ok);
    return response.ok;
  } catch (error) { updateConnectionStatus(false); return false; }
}

function readableError(error) {
  const message = String(error?.message || error || '');
  if (message === 'NO_PROVIDER') return '⚠️ Motor IA no configurado. Ve a Ajustes → Motor IA.';
  if (message.startsWith('NO_KEY')) {
    const providerId = message.split(' ')[1];
    const label = PROVIDERS[providerId]?.label || providerId;
    return '🔑 Falta ' + label + ' API Key. Ve a Ajustes → API Keys.';
  }
  if (message.startsWith('PROVIDER_ERR')) {
    const [, providerId, status, ...rest] = message.split(' ');
    const label = PROVIDERS[providerId]?.label || providerId;
    const detail = rest.join(' ').trim();
    if (status === '401') return '🔐 ' + label + ' Key inválida.';
    if (status === '429') return '⏳ Límite de ' + label + ' alcanzado.';
    return '⚠️ Error de ' + label + ': ' + (detail || 'sin detalle (revisa la consola del navegador)');
  }
  if (message === 'NETWORK_OFFLINE') return '⚠️ No hay conexión con Internet.';
  if (message === 'REQUEST_TIMEOUT') return '⏱️ La respuesta tardó demasiado. Inténtalo de nuevo.';
  if (message === 'OFFLINE_UNAVAILABLE') return '🏠 llama.cpp no está disponible.';
  if (message.startsWith('LLAMA')) return '🏠 Error en llama.cpp.';
  return '⚠️ Ocurrió un error.';
}

function openAppCommand(text) {
  const apps = { youtube: 'com.google.android.youtube', whatsapp: 'com.whatsapp', chrome: 'com.android.chrome', spotify: 'com.spotify.music', instagram: 'com.instagram.android', tiktok: 'com.zhiliaoapp.musically', telegram: 'org.telegram.messenger', netflix: 'com.netflix.mediaclient', maps: 'com.google.android.apps.maps', gmail: 'com.google.android.gm', 'cámara': 'com.android.camera', 'galería': 'com.android.gallery3d', calendario: 'com.android.calendar', reloj: 'com.android.deskclock', ajustes: 'com.android.settings' };
  for (const name in apps) {
    if (text.includes(name)) {
      try { window.location.href = 'intent://' + apps[name] + '#Intent;scheme=package;end'; return '📱 Abriendo ' + name + '.'; }
      catch (error) { return 'No se pudo abrir ' + name + '.'; }
    }
  }
  return null;
}

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

function configureVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices().filter(v => (v.lang || '').toLowerCase().startsWith('es'));
  if (!voices.length) return;
  selectedVoice = state.voiceName ? (voices.find(v => v.name === state.voiceName) || voices[0]) : voices[0];
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = configureVoices;

function speak(text, done) {
  if (!state.voiceEnabled || state.voiceMuted) { setBubbleIdle(); if (done) done(); return; }
  if (!('speechSynthesis' in window)) { setBubbleIdle(); if (done) done(); return; }
  speechSynthesis.cancel();
  speaking = true;
  setBubbleSpeaking();
  const u = new SpeechSynthesisUtterance(String(text).replace(/[*_#`]/g, '').slice(0, CONFIG.maxSpeechChars));
  u.lang = CONFIG.lang;
  u.rate = Number(state.voiceRate) || 1;
  u.pitch = Number(state.voicePitch) || 1;
  u.volume = Number(state.voiceVolume) || 1;
  if (selectedVoice) u.voice = selectedVoice;
  u.onstart = () => { speaking = true; setBubbleSpeaking(); if (voiceSession) { $('voiceOrb')?.classList.remove('listening', 'thinking'); $('voiceOrb')?.classList.add('speaking'); } };
  u.onend = () => { speaking = false; setBubbleIdle(); $('voiceOrb')?.classList.remove('speaking'); if (done) done(); };
  u.onerror = () => { speaking = false; setBubbleIdle(); $('voiceOrb')?.classList.remove('speaking'); if (done) done(); };
  speechSynthesis.speak(u);
}

function dictate() {
  if (!SpeechRecognitionAPI) return toast('⚠️ No soportado');
  if (!recognition) {
    recognition = new SpeechRecognitionAPI();
    recognition.lang = CONFIG.lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = e => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      $('messageInput').value = t;
      resizeComposer();
      if (e.results[e.results.length - 1].isFinal) sendMessage();
    };
    recognition.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('⚠️ No entendí'); };
  }
  try { recognition.start(); } catch (error) {}
}

function stopRecognitionOnly() { try { recognition?.stop(); } catch (error) {} try { voiceRecognition?.stop(); } catch (error) {} }

function toggleVoiceSession() { if (voiceSession) stopVoiceSession(); else startVoiceSession(); }

function startVoiceSession() {
  if (!SpeechRecognitionAPI) return toast('⚠️ No soportado');
  if (state.voiceMuted) return toast('🔇 Activa la voz');
  voiceSession = true;
  voiceBusy = false;
  $('voiceTalkBtn')?.classList.add('active');
  $('voiceStatus').textContent = 'Escuchando...';
  startListening();
}

function scheduleVoiceRestart(delay = 150) {
  if (voiceRestartTimer) clearTimeout(voiceRestartTimer);
  if (!voiceSession || voiceBusy || state.voiceMuted) return;
  voiceRestartTimer = setTimeout(() => {
    voiceRestartTimer = null;
    startListening();
  }, delay);
}

function startListening() {
  if (!voiceSession || voiceBusy || state.voiceMuted || !SpeechRecognitionAPI) return;
  try { voiceRecognition?.stop(); } catch (error) {}
  const rec = new SpeechRecognitionAPI();
  voiceRecognition = rec;
  rec.lang = CONFIG.lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.onstart = () => { if (!voiceSession) return; $('voiceStatus').textContent = 'Escuchando...'; $('voiceOrb')?.classList.remove('thinking', 'speaking'); $('voiceOrb')?.classList.add('listening'); };
  rec.onresult = e => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const part = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += part; else interim += part;
    }
    $('voiceTranscript').textContent = final || interim || '...';
    if (final.trim()) voiceTurn(final.trim());
  };
  rec.onerror = e => {
    if (!voiceSession || voiceBusy || state.voiceMuted) return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { $('voiceStatus').textContent = 'Permiso de micrófono requerido.'; return; }
    if (e.error !== 'aborted') scheduleVoiceRestart(500);
  };
  rec.onend = () => { scheduleVoiceRestart(120); };
  try { rec.start(); } catch (error) { scheduleVoiceRestart(250); }
}

async function voiceTurn(text) {
  if (/aipher\s*detente|detente|para|stop/i.test(text)) { stopVoiceSession(); return; }
  if (/aipher\s*silencio|silencio|mute/i.test(text)) { if (!state.voiceMuted) toggleMute(); return; }
  if (/aipher\s*contin[uú]a|contin[uú]a|activa voz/i.test(text)) { if (state.voiceMuted) toggleMute(); return; }
  if (!voiceSession || voiceBusy) return;
  voiceBusy = true;
  try {
    try { voiceRecognition?.stop(); } catch (error) {}
    $('voiceTranscript').textContent = 'Tú: ' + text;
    $('voiceStatus').textContent = 'Pensando...';
    $('voiceOrb')?.classList.remove('listening', 'speaking');
    $('voiceOrb')?.classList.add('thinking');
    const chat = currentChat();
    addMessage(chat, 'user', text);
    saveState();
    renderMessages();
    const rawResponse = await routeVoice(text, chat);
    if (rawResponse !== false && rawResponse != null) {
      const response = resolveInlineTags(rawResponse);
      saveState();
      const ytMatch = response.match(/\[\[YOUTUBE:\s*(.+?)\]\]/i);
      if (ytMatch) {
        const cleanText = response.replace(/\[\[YOUTUBE:.*?\]\]/gi, '').trim();
        if (cleanText) {
          addMessage(chat, 'assistant', cleanText);
        }
        const videoData = await searchYouTube(ytMatch[1]);
        const spoken = videoData?.text || (state.youtubeKey ? 'No encontré videos para esa sugerencia.' : 'Para buscar videos necesito tu YouTube API Key.');
        if (videoData?.links?.length) {
          state.lastYtResults = videoData.links;
          state.lastYtResultsAt = Date.now();
          state.lastYtItems = videoData.items || [];
          lastYtResultsFull = state.lastYtItems;
        }
        addMessage(chat, 'assistant', spoken);
        saveState();
        renderMessages();
        speak(spoken, () => { voiceBusy = false; if (voiceSession && !state.voiceMuted) { $('voiceStatus').textContent = 'Escuchando...'; startListening(); } });
      } else if (response.trim()) {
        addMessage(chat, 'assistant', response);
        saveState();
        renderMessages();
        speak(response, () => { voiceBusy = false; if (voiceSession && !state.voiceMuted) { $('voiceStatus').textContent = 'Escuchando...'; startListening(); } });
      } else {
        voiceBusy = false;
        saveState();
        renderMessages();
        if (voiceSession && !state.voiceMuted) { $('voiceStatus').textContent = 'Escuchando...'; startListening(); }
      }
    } else {
      voiceBusy = false;
      if (voiceSession && !state.voiceMuted) startListening();
    }
  } catch (error) {
    const readable = readableError(error);
    const chat = currentChat();
    addMessage(chat, 'error', readable);
    saveState();
    renderMessages();
    speak(readable, () => { voiceBusy = false; if (voiceSession && !state.voiceMuted) startListening(); });
  }
}

function stopVoiceSession() {
  voiceSession = false;
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  voiceBusy = false;
  try { voiceRecognition?.stop(); } catch (error) {}
  voiceRecognition = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  speaking = false;
  $('voiceTalkBtn')?.classList.remove('active');
  $('voiceOrb')?.classList.remove('listening', 'thinking', 'speaking');
  $('voiceStatus').textContent = 'Conversación pausada';
  setBubbleIdle();
}

function updateBubble() {
  const bubble = $('floatingAssistant');
  if (!bubble) return;
  bubble.style.display = state.bubbleEnabled ? 'flex' : 'none';
  configureBubbleGif();
  updateMuteUI();
  if (!speaking) setBubbleIdle();
}

function configureBubbleGif() {
  const image = $('bubbleGifImage');
  if (!image) return;
  if (state.bubbleGif && typeof state.bubbleGif === 'string') { image.src = state.bubbleGif; } else { image.removeAttribute('src'); }
  image.classList.add('hidden');
}

function setBubbleIdle() {
  const bubble = $('floatingAssistant');
  if (!bubble) return;
  bubble.classList.remove('speaking');
  bubble.classList.add('idle');
  $('bubbleLogoContainer')?.classList.remove('hidden');
  $('bubbleGifImage')?.classList.add('hidden');
}

function setBubbleSpeaking() {
  const bubble = $('floatingAssistant');
  if (!bubble) return;
  if (!state.bubbleEnabled) return;
  bubble.classList.remove('idle');
  bubble.classList.add('speaking');
  const hasGif = Boolean(state.bubbleGif);
  if (hasGif) {
    $('bubbleLogoContainer')?.classList.add('hidden');
    const image = $('bubbleGifImage');
    if (image) { image.src = state.bubbleGif; image.classList.remove('hidden'); }
  } else {
    $('bubbleLogoContainer')?.classList.add('hidden');
    $('bubbleGifImage')?.classList.add('hidden');
  }
}

function applyBubbleState() { if (speaking) setBubbleSpeaking(); else setBubbleIdle(); }

function saveBubble() {
  state.bubbleEnabled = Boolean($('cfgBubbleEnabled')?.checked);
  saveState();
  updateBubble();
  closeModal();
  toast('✅ Guardado');
}

function resetBubble() {
  state.bubbleGif = '';
  state.bubbleEnabled = true;
  saveState();
  updateBubble();
  closeModal();
  toast('🔄 Burbuja restaurada');
}

function forgetMemory(index) {
  if (!Array.isArray(state.memoria) || !state.memoria[index]) return;
  state.memoria.splice(index, 1);
  saveState();
  openSettingsSection('memory');
}

function clearMemory() {
  state.memoria = [];
  saveState();
  closeModal();
  toast('🗑️ Memoria borrada');
}

function openBubbleGifPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/gif,image/*';
  input.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      state.bubbleGif = ev.target.result;
      saveState();
      updateBubble();
      toast('🎞️ GIF aplicado');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function youtubeLink(text) {
  const patterns = [/(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i, /(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})/i];
  for (const p of patterns) { const m = text.match(p); if (m) return 'https://www.youtube.com/watch?v=' + m[1]; }
  return null;
}

async function searchYouTube(query) {
  if (!state.youtubeKey) return null;
  const clean = String(query || '').normalize('NFC').replace(/busca|mu[eé]stra|env[ií]a|dame|v[ií]deo|canci[oó]n|m[uú]sica|music|quiero ver|pon|reproduce|enlace|link|referente a (eso|esto)/gi, '').trim();
  if (clean.length < 2) return null;
  try {
    let url = CONFIG.youtubeURL + '?part=snippet&maxResults=3&q=' + encodeURIComponent(clean) + '&type=video&key=' + encodeURIComponent(state.youtubeKey);
    if (nextPageToken) { url += '&pageToken=' + encodeURIComponent(nextPageToken); }
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.items?.length) return null;
    const links = data.items.map(i => 'https://www.youtube.com/watch?v=' + i.id.videoId);
    const itemsFull = data.items.map((i, x) => ({ title: i.snippet.title, channel: i.snippet.channelTitle, url: links[x] }));
    const text = data.items.map((i, x) => (x + 1) + '. **' + i.snippet.title + '**\n👤 ' + i.snippet.channelTitle + '\n📺 ' + links[x]).join('\n\n');
    nextPageToken = data.nextPageToken || '';
    return { links, items: itemsFull, text: '🎬 Resultados:\n\n' + text + '\n\n_Di 1, 2 o 3 para reproducir._' };
  } catch (error) { return null; }
}

function openVideo(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return;
    let id = parsed.searchParams.get('v');
    if (!id) id = parsed.pathname.split('/').filter(Boolean).pop();
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    $('videoFrame').src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0';
    $('videoPlayer')?.classList.remove('hidden');
    toast('🎬 Reproduciendo...');
  } catch (error) {}
}

function closeVideo() { if ($('videoFrame')) $('videoFrame').src = ''; $('videoPlayer')?.classList.add('hidden'); }

function currentChat() {
  let chat = state.chats.find(x => x.id === state.currentChat);
  if (!chat) { createNewChat(); chat = state.chats.find(x => x.id === state.currentChat); }
  if (!Array.isArray(chat.messages)) chat.messages = [];
  if (!Array.isArray(chat.archivos)) chat.archivos = [];
  return chat;
}

function createNewChat() {
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  const id = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  const chat = { id, title: 'Nuevo chat', createdAt: Date.now(), messages: [], archivos: [] };
  state.chats.unshift(chat);
  state.currentChat = id;
  state.lastYtResults = null; state.lastYtResultsAt = 0; state.lastYtItems = []; state.pendingQuery = null; state.sugerenciasIA = null;
  lastSearchQuery = ''; nextPageToken = ''; lastYtResultsFull = [];
  saveState(); renderChats(); renderMessages();
  $('sideMenu')?.classList.remove('open');
}

function addMessage(chat, role, content) {
  chat.messages.push({ role, content: String(content), timestamp: Date.now() });
  if (chat.title === 'Nuevo chat' && role === 'user') chat.title = String(content).slice(0, 40) || 'Nuevo chat';
}

function loadCurrentChat() {
  if (!state.chats.length) { createNewChat(); return; }
  if (!state.currentChat || !state.chats.some(x => x.id === state.currentChat)) { state.currentChat = state.chats[0].id; saveState(); }
  renderMessages();
}

function selectChat(id) {
  if (!state.chats.some(x => x.id === id)) return;
  state.currentChat = id;
  state.lastYtResults = null; state.lastYtResultsAt = 0; state.lastYtItems = []; state.pendingQuery = null; state.sugerenciasIA = null;
  lastSearchQuery = ''; nextPageToken = ''; lastYtResultsFull = [];
  saveState(); renderChats(); renderMessages();
  $('sideMenu')?.classList.remove('open');
}

async function deleteChat(id, event) {
  event?.stopPropagation();
  const chat = state.chats.find(x => x.id === id);
  for (const file of chat?.archivos || []) if (file.documentId) await deleteDocument(file.documentId);
  state.chats = state.chats.filter(x => x.id !== id);
  if (!state.chats.length) { state.currentChat = null; saveState(); createNewChat(); return; }
  if (state.currentChat === id) state.currentChat = state.chats[0].id;
  saveState(); renderChats(); renderMessages();
}

function renderChats() {
  const list = $('chatList');
  if (!list) return;
  const q = ($('chatSearch')?.value || '').toLowerCase().trim();
  const chats = state.chats.filter(c => (c.title || '').toLowerCase().includes(q));
  list.innerHTML = '';
  if (!chats.length) { list.innerHTML = '<div style="padding:20px;color:#777;text-align:center">Sin chats</div>'; return; }
  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chatItem' + (chat.id === state.currentChat ? ' active' : '');
    const title = document.createElement('span'); title.textContent = chat.title || 'Nuevo chat';
    const del = document.createElement('button'); del.type = 'button'; del.textContent = '×'; del.onclick = e => deleteChat(chat.id, e);
    item.append(title, del);
    item.onclick = () => selectChat(chat.id);
    list.appendChild(item);
  });
}

function renderMessages() {
  const container = $('messages');
  if (!container) return;
  const chat = currentChat();
  container.innerHTML = '';
  if (!chat.messages.length) {
    container.innerHTML = '<div style="text-align:center;padding-top:20vh;color:#aeb4c0"><div style="font-size:52px">🔥</div><h1>Hola, ' + escapeHTML(state.name) + '</h1><p>Soy Aipher.</p></div>';
    renderLogoSystem();
    return;
  }
  chat.messages.forEach(m => {
    const wrapper = document.createElement('div');
    wrapper.className = 'message ' + m.role;
    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = escapeHTML(m.content).replace(/\n/g, '<br>');
    wrapper.appendChild(content);
    const ytItems = lastYtResultsFull.length ? lastYtResultsFull : (state.lastYtItems || []);
    if (m.role === 'assistant' && ytItems.length > 0 && m.content.includes('🎬 Resultados')) {
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px';
      ytItems.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = 'yt-play-btn';
        btn.textContent = '▶ ' + (index + 1) + '. ' + String(item.title || 'Video');
        btn.style.cssText = 'background:var(--accent,#ff6b35);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:12px;text-align:left;width:100%';
        btn.onclick = () => { openVideo(item.url); };
        btnContainer.appendChild(btn);
      });
      content.appendChild(btnContainer);
    }
    if ((m.role === 'user' || m.role === 'assistant') && m.timestamp) {
      const time = document.createElement('div');
      time.className = 'message-time';
      time.textContent = new Date(m.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      wrapper.appendChild(time);
    }
    container.appendChild(wrapper);
  });
  container.scrollTop = container.scrollHeight;
  renderLogoSystem();
}

function showTyping(show) {
  const indicator = $('typingIndicator');
  if (!indicator) return;
  indicator.classList.toggle('hidden', !show);
  if (show) $('chatArea')?.scrollTo({ top: $('chatArea').scrollHeight, behavior: 'smooth' });
}

function openLibrary() {
  const chat = currentChat();
  const files = chat.archivos || [];
  let html = '<h3>📚 Biblioteca</h3><p>' + files.length + ' archivo(s)</p>';
  if (!files.length) html += '<p style="color:#888">📭 No hay archivos.</p>';
  files.forEach((file, index) => {
    const meta = [file.tipo || file.mime || 'documento', file.chunks ? file.chunks + ' fragmentos' : 'procesando'].join(' · ');
    html += '<div class="file"><span title="' + escapeAttribute(file.nombre) + '">📄 ' + escapeHTML(file.nombre) + '<small style="display:block;color:var(--text-muted);margin-top:3px">' + escapeHTML(meta) + '</small></span><button class="danger" onclick="removeFile(' + index + ')">🗑</button></div>';
  });
  if (files.length) html += '<button class="modalBtn" onclick="searchDocumentsUI()">🔎 Buscar en documentos</button>';
  html += '<button class="modalBtn" onclick="pickFiles()">📂 Agregar archivos</button>';
  modal('📚 Biblioteca', html);
}

function openDocumentDB() {
  if (!('indexedDB' in window)) return Promise.reject(Error('NO_INDEXED_DB'));
  if (documentDBPromise) return documentDBPromise;
  documentDBPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('aipher_documents', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) {
        const store = db.createObjectStore('documents', { keyPath: 'id' });
        store.createIndex('chatId', 'chatId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      db.onclose = () => { if (documentDBPromise && documentDBPromise.__db === db) documentDBPromise = null; };
      if (documentDBPromise) documentDBPromise.__db = db;
      resolve(db);
    };
    request.onerror = () => reject(request.error || Error('INDEXED_DB_ERROR'));
    request.onblocked = () => reject(Error('INDEXED_DB_BLOCKED'));
  });
  return documentDBPromise.catch(error => { documentDBPromise = null; throw error; });
}

async function initDocumentEngine() {
  try { await openDocumentDB(); }
  catch (error) { console.warn('Aipher: IndexedDB no disponible; la biblioteca documental no podrá persistir en este dispositivo.'); }
}

function documentId() {
  return crypto?.randomUUID ? crypto.randomUUID() : 'doc_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

function normalizeDocumentText(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkDocumentText(text, size = CONFIG.documentChunkSize, overlap = CONFIG.documentChunkOverlap) {
  const clean = normalizeDocumentText(text);
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf('\n\n', end), clean.lastIndexOf('. ', end), clean.lastIndexOf(' ', end));
      if (boundary > start + Math.floor(size * 0.55)) end = boundary + (clean[boundary] === '.' ? 1 : 0);
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function normalizeVector(values) {
  if (!Array.isArray(values) || !values.length) return null;
  let norm = Math.sqrt(values.reduce((sum, value) => sum + Number(value || 0) ** 2, 0));
  if (!Number.isFinite(norm) || norm === 0) return null;
  return values.map(value => Number(value || 0) / norm);
}

function cosineVector(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += Number(a[i] || 0) * Number(b[i] || 0);
  return dot;
}

async function geminiEmbedBatch(items, taskType) {
  const key = state.apiKeys?.gemini;
  if (!key || !items.length) return [];
  const model = CONFIG.embeddingModel;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':batchEmbedContents';
  const requests = items.map(item => ({
    model: 'models/' + model,
    content: { parts: [{ text: String(item.text || '').slice(0, 12000) }] },
    embedContentConfig: {
      taskType,
      outputDimensionality: CONFIG.embeddingDimension,
      ...(taskType === 'RETRIEVAL_DOCUMENT' && item.title ? { title: item.title } : {})
    }
  }));
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ requests })
  });
  if (!response.ok) throw Error('EMBEDDING_HTTP_' + response.status);
  const data = await response.json();
  return Array.isArray(data?.embeddings) ? data.embeddings.map(item => normalizeVector(item?.values)) : [];
}

async function embedDocumentChunks(doc) {
  if (!state.apiKeys?.gemini || !doc?.chunks?.length) return doc;
  const embeddings = Array.isArray(doc.embeddings) ? [...doc.embeddings] : [];
  for (let start = 0; start < doc.chunks.length; start += CONFIG.embeddingBatchSize) {
    const batch = doc.chunks.slice(start, start + CONFIG.embeddingBatchSize).map((text, offset) => ({ text, title: doc.nombre }));
    const vectors = await geminiEmbedBatch(batch, 'RETRIEVAL_DOCUMENT');
    vectors.forEach((vector, offset) => { if (vector) embeddings[start + offset] = vector; });
  }
  doc.embeddings = embeddings;
  doc.embeddingModel = CONFIG.embeddingModel;
  doc.embeddingDimension = CONFIG.embeddingDimension;
  doc.embeddingUpdatedAt = Date.now();
  return doc;
}

async function ensureDocumentEmbeddings(docs) {
  if (!state.apiKeys?.gemini) return docs;
  let changed = false;
  for (const doc of docs) {
    const complete = Array.isArray(doc.embeddings) && doc.embeddings.length === (doc.chunks || []).length && doc.embeddingModel === CONFIG.embeddingModel;
    if (complete) continue;
    try {
      await embedDocumentChunks(doc);
      await putDocument(doc);
      changed = true;
    } catch (error) {
      console.warn('Aipher embeddings:', error);
      break;
    }
  }
  return changed ? docs : docs;
}

async function putDocument(doc) {
  try {
    const db = await openDocumentDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(doc);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error('DOCUMENT_SAVE_ERROR'));
    });
    return true;
  } catch (error) { console.warn('Aipher document save:', error); return false; }
}

async function getDocumentsForChat(chatId) {
  try {
    const db = await openDocumentDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readonly');
      const req = tx.objectStore('documents').index('chatId').getAll(chatId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || Error('DOCUMENT_READ_ERROR'));
    });
  } catch (error) { return []; }
}

async function getAllDocuments() {
  try {
    const db = await openDocumentDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readonly');
      const req = tx.objectStore('documents').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || Error('DOCUMENT_READ_ERROR'));
    });
  } catch (error) { return []; }
}

async function clearDocumentStore() {
  try {
    const db = await openDocumentDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error('DOCUMENT_CLEAR_ERROR'));
    });
  } catch (error) {}
}

async function deleteDocument(id) {
  try {
    const db = await openDocumentDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error('DOCUMENT_DELETE_ERROR'));
    });
  } catch (error) {}
}

function documentTokens(text) {
  return normalizeDocumentText(text)
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

const DOCUMENT_STOPWORDS = new Set([
  'para','como','este','esta','estos','estas','desde','hasta','sobre','entre','cuando','donde','porque','qué','que','una','uno','unos','unas','del','las','los','por','con','sin','sus','son','ser','fue','han','hay','más','muy','también','solo','sólo','tiene','tienen','esto','eso','esa','ese','al','se','te','me','mi','tu','su','ya','no','si','sí','en','de','la','el','y','o','a'
]);

function meaningfulDocumentTokens(text) {
  return documentTokens(text).filter(token => !DOCUMENT_STOPWORDS.has(token));
}

function buildTokenFrequency(text) {
  const freq = new Map();
  for (const token of meaningfulDocumentTokens(text)) freq.set(token, (freq.get(token) || 0) + 1);
  return freq;
}

function bm25Score(queryTokens, docTokens, avgLength, totalDocs, docFrequency) {
  if (!queryTokens.length || !docTokens.length) return 0;
  const k1 = 1.35;
  const b = 0.72;
  const freq = new Map();
  for (const token of docTokens) freq.set(token, (freq.get(token) || 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    const tf = freq.get(token) || 0;
    if (!tf) continue;
    const df = docFrequency.get(token) || 0;
    const idf = Math.log(1 + ((totalDocs - df + 0.5) / (df + 0.5)));
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docTokens.length / Math.max(1, avgLength)))));
  }
  return score;
}

function cosineTokenScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = buildTokenFrequency(aTokens.join(' '));
  const b = buildTokenFrequency(bTokens.join(' '));
  let dot = 0, na = 0, nb = 0;
  for (const [token, value] of a) { na += value * value; dot += value * (b.get(token) || 0); }
  for (const value of b.values()) nb += value * value;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function diversifyRagResults(results, limit) {
  const selected = [];
  const remaining = [...results];
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const redundancy = selected.length
        ? Math.max(...selected.map(item => cosineTokenScore(candidate.tokens, item.tokens)))
        : 0;
      const mmr = candidate.score * 0.82 - redundancy * 0.18;
      if (mmr > bestScore) { bestScore = mmr; bestIndex = i; }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

async function retrieveDocumentContext(chat, query) {
  if (!chat?.archivos?.length) return [];
  let docs = await getDocumentsForChat(chat.id);
  if (!docs.length) return [];
  if (state.apiKeys?.gemini) docs = await ensureDocumentEmbeddings(docs);

  const qTokens = [...new Set(meaningfulDocumentTokens(query))];
  const allChunks = [];
  for (const doc of docs) {
    for (let index = 0; index < (doc.chunks || []).length; index++) {
      const text = String(doc.chunks[index] || '').trim();
      if (!text) continue;
      const tokens = meaningfulDocumentTokens(text);
      if (!tokens.length) continue;
      allChunks.push({
        documentId: doc.id,
        nombre: doc.nombre,
        index,
        text,
        tokens,
        embedding: Array.isArray(doc.embeddings) ? doc.embeddings[index] : null,
        nameTokens: meaningfulDocumentTokens(doc.nombre)
      });
    }
  }
  if (!allChunks.length) return [];

  if (!qTokens.length) {
    return allChunks.slice(0, CONFIG.documentTopK).map(item => ({
      documentId: item.documentId,
      nombre: item.nombre,
      index: item.index,
      text: item.text,
      score: 0,
      matchTerms: []
    }));
  }

  const docFrequency = new Map();
  allChunks.forEach(item => {
    new Set(item.tokens).forEach(token => docFrequency.set(token, (docFrequency.get(token) || 0) + 1));
  });
  const avgLength = allChunks.reduce((sum, item) => sum + item.tokens.length, 0) / Math.max(1, allChunks.length);

  let queryEmbedding = null;
  if (state.apiKeys?.gemini) {
    try {
      const vectors = await geminiEmbedBatch([{ text: String(query).slice(0, 12000) }], 'RETRIEVAL_QUERY');
      queryEmbedding = vectors[0] || null;
    } catch (error) {
      console.warn('Aipher query embedding:', error);
    }
  }

  const candidates = [];
  for (const item of allChunks) {
    const tokenSet = new Set(item.tokens);
    const matched = qTokens.filter(token => tokenSet.has(token));
    const bm25 = bm25Score(qTokens, item.tokens, avgLength, allChunks.length, docFrequency);
    const phrase = normalizeDocumentText(item.text).toLocaleLowerCase('es').includes(normalizeDocumentText(query).toLocaleLowerCase('es')) ? 3.5 : 0;
    const nameHits = qTokens.filter(token => item.nameTokens.includes(token)).length;
    const nameBoost = nameHits * 1.25;
    const coverage = matched.length / qTokens.length;
    const proximity = matched.length >= 2 ? Math.min(1.8, matched.length * 0.3) : 0;
    const semantic = queryEmbedding && Array.isArray(item.embedding) ? cosineVector(queryEmbedding, item.embedding) : 0;
    const score = bm25 + phrase + nameBoost + coverage + proximity + semantic * 6;
    if (score >= CONFIG.ragMinScore) candidates.push({ ...item, score, semantic, matchTerms: matched });
  }

  const topCandidates = candidates.sort((a, b) => b.score - a.score).slice(0, CONFIG.ragCandidateK);
  return diversifyRagResults(topCandidates, CONFIG.documentTopK).map(item => ({
    documentId: item.documentId,
    nombre: item.nombre,
    index: item.index,
    text: item.text,
    score: item.score,
    matchTerms: item.matchTerms
  }));
}

async function migrateLegacyDocuments() {
  let changed = false;
  for (const chat of state.chats || []) {
    if (!Array.isArray(chat.archivos)) continue;
    for (const file of chat.archivos) {
      if (!file.contenido || file.documentId) continue;
      const chunks = chunkDocumentText(file.contenido);
      const id = documentId();
      let document = { id, chatId: chat.id, nombre: file.nombre, mime: file.mime || '', tamaño: file.tamaño || 0, fecha: file.fecha || Date.now(), textLength: String(file.contenido).length, chunks };
      if (state.apiKeys?.gemini) { try { document = await embedDocumentChunks(document); } catch (error) { console.warn('Aipher legacy embedding:', error); } }
      const saved = await putDocument(document);
      if (saved) {
        file.documentId = id;
        file.chunks = chunks.length;
        delete file.contenido;
        delete file.text;
        changed = true;
      }
    }
  }
  if (changed) saveState();
}

function pickFiles() {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true;
  input.accept = '.txt,.json,.md,.csv,.html,.xml,.log,.py,.js,.java,.c,.cpp,.h,.sh,.pdf,.docx,' +
    'text/plain,application/json,text/markdown,text/csv,text/html,application/xhtml+xml,' +
    'text/xml,application/xml,text/x-python,application/x-python-code,' +
    'text/javascript,application/javascript,text/x-java-source,text/x-csrc,text/x-c,text/x-c++src,' +
    'application/x-sh,application/x-shellscript,application/pdf,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/octet-stream';
  input.onchange = async e => {
    const files = Array.from(e.target.files || []);
    for (const file of files) await readFile(file);
  };
  input.click();
}

async function parseDocumentFile(file, ext) {
  const allowedExtensions = new Set(['txt','json','md','csv','html','xml','log','py','js','java','c','cpp','h','sh','pdf','docx']);
  if (!allowedExtensions.has(ext)) throw Error('UNSUPPORTED_DOCUMENT');
  if (file.size > CONFIG.maxDocumentBytes) throw Error('DOCUMENT_TOO_LARGE');
  if (ext === 'pdf') {
    if (!window.pdfjsLib) throw Error('PDF');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = [];
    for (let p = 1; p <= Math.min(CONFIG.maxPdfPages, pdf.numPages); p++) {
      const pg = await pdf.getPage(p);
      const tc = await pg.getTextContent();
      pages.push('Página ' + p + '\n' + tc.items.map(i => i.str).join(' '));
    }
    return pages.join('\n\n');
  }
  if (ext === 'docx') {
    if (!window.mammoth) throw Error('DOCX');
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  return await file.text();
}

async function readFile(file) {
  const chat = currentChat();
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    toast('📖 Procesando ' + file.name + '…');
    const raw = await parseDocumentFile(file, ext);
    const text = normalizeDocumentText(raw);
    if (!text) throw Error('EMPTY_DOCUMENT');
    const chunks = chunkDocumentText(text);
    if (!chunks.length) throw Error('EMPTY_DOCUMENT');
    const id = documentId();
    let document = { id, chatId: chat.id, nombre: file.name, mime: file.type || ('text/' + ext), tamaño: file.size, fecha: Date.now(), textLength: text.length, chunks };
    if (state.apiKeys?.gemini) {
      try { toast('🧠 Generando índice semántico…'); document = await embedDocumentChunks(document); }
      catch (embeddingError) { console.warn('Aipher document embedding:', embeddingError); }
    }
    const saved = await putDocument(document);
    if (!saved) throw Error('DOCUMENT_SAVE_ERROR');
    chat.archivos.push({ documentId: id, nombre: file.name, mime: file.type || '', tipo: ext.toUpperCase(), tamaño: file.size, fecha: Date.now(), chunks: chunks.length });
    addMessage(chat, 'system', '📂 ' + file.name + ' · ' + chunks.length + ' fragmentos indexados');
    saveState(); renderMessages(); openLibrary();
    toast('✅ ' + file.name + ' indexado');
  } catch (error) {
    console.error('Aipher readFile:', file?.name, error);
    const reason = error.message === 'DOCUMENT_TOO_LARGE' ? 'supera 25 MB'
      : error.message === 'EMPTY_DOCUMENT' ? 'no contiene texto legible'
      : error.message === 'UNSUPPORTED_DOCUMENT' ? 'tipo de archivo no compatible'
      : error.message === 'DOCUMENT_SAVE_ERROR' ? 'no se pudo guardar en la base de datos local'
      : error.message === 'PDF' ? 'el lector de PDF no cargó'
      : error.message === 'DOCX' ? 'el lector de DOCX (Mammoth) no cargó'
      : 'no pude procesarlo — detalle: ' + (error?.message || String(error));
    toast('⚠️ ' + file.name + ': ' + reason, 6000);
  }
}

async function removeFile(index) {
  const chat = currentChat();
  const file = chat.archivos?.[index];
  if (!file) return;
  if (file.documentId) await deleteDocument(file.documentId);
  chat.archivos.splice(index, 1);
  saveState(); openLibrary();
}

async function searchDocumentsUI() {
  const chat = currentChat();
  const query = prompt('¿Qué quieres buscar en tus documentos?');
  if (!query?.trim()) return;
  const results = await retrieveDocumentContext(chat, query.trim());
  if (!results.length) return modal('🔎 Búsqueda documental', '<p>No encontré fragmentos relevantes.</p><button class="modalBtn" onclick="openLibrary()">Volver</button>');
  const html = '<h3>🔎 Resultados</h3>' + results.map((r, i) => '<div class="file" style="display:block"><strong>' + (i + 1) + '. ' + escapeHTML(r.nombre) + ' · fragmento ' + (r.index + 1) + '</strong><small style="display:block;margin-top:4px;opacity:.6">Relevancia ' + Number(r.score || 0).toFixed(2) + (r.semantic ? ' · semántica ' + Number(r.semantic).toFixed(2) : '') + '</small><p style="margin:7px 0 0;white-space:pre-wrap;line-height:1.45;color:var(--text-soft)">' + escapeHTML(r.text.slice(0, 900)) + '</p></div>').join('') + '<button class="modalBtn" onclick="openLibrary()">Volver</button>';
  modal('🔎 Búsqueda documental', html);
}

function openSettingsSection(section) {
  let title = '', content = '';
  if (section === 'profile') {
    title = '👤 Perfil';
    content = '<div class="form"><label>Nombre</label><input id="cfgName" value="' + escapeAttribute(state.name) + '"></div><div class="form"><label>Personalidad</label><select id="cfgPersonality"><option value="JARVIS"' + (state.personality === 'JARVIS' ? ' selected' : '') + '>JARVIS 🔥</option><option value="Amigable"' + (state.personality === 'Amigable' ? ' selected' : '') + '>Amigable 😊</option><option value="Formal"' + (state.personality === 'Formal' ? ' selected' : '') + '>Formal 🎩</option></select></div><button class="modalBtn" onclick="saveProfile()">💾 Guardar</button>';
  } else if (section === 'voice') {
    title = '🎙️ Voz';
    content = '<div class="form"><label>Velocidad: <span id="rateLabel">' + state.voiceRate + '</span>x</label><input id="cfgRate" type="range" min=".5" max="2" step=".1" value="' + state.voiceRate + '" oninput="document.getElementById(\'rateLabel\').textContent=this.value"></div><div class="form"><label>Tono</label><input id="cfgPitch" type="range" min=".5" max="1.5" step=".05" value="' + state.voicePitch + '"></div><label><input id="cfgVoiceEnabled" type="checkbox"' + (state.voiceEnabled ? ' checked' : '') + '> Voz activa</label><button class="modalBtn" onclick="saveVoice()">💾 Guardar</button><button class="modalBtn" onclick="testVoice()">🔊 Probar</button>';
  } else if (section === 'appearance') {
    title = '🎨 Temas';
    content = '<div class="form"><label>Tema</label><select id="cfgTheme"><option value="dark"' + (state.theme === 'dark' ? ' selected' : '') + '>Oscuro 🌙</option><option value="light"' + (state.theme === 'light' ? ' selected' : '') + '>Claro ☀️</option></select></div><div class="form"><label>Fondo</label><input id="cfgBg" value="' + escapeAttribute(state.fondo || '') + '" placeholder="URL"><button class="inlineFile" onclick="document.getElementById(\'bgFile\').click()">📁 Imagen</button><input id="bgFile" type="file" accept="image/*" hidden onchange="loadBackgroundFile(event)"></div><button class="modalBtn" onclick="saveAppearance()">💾 Guardar</button><button class="danger" onclick="clearBackground()">🗑 Quitar fondo</button>';
  } else if (section === 'bubble') {
    title = '🫧 Burbuja';
    content = '<label><input id="cfgBubbleEnabled" type="checkbox"' + (state.bubbleEnabled ? ' checked' : '') + '> Mostrar burbuja</label><button class="modalBtn" onclick="openBubbleGifPicker()">🎞️ Seleccionar GIF</button><button class="modalBtn" onclick="saveBubble()">💾 Guardar</button><button class="danger" onclick="resetBubble()">🔄 Restaurar</button>';
  } else if (section === 'memory') {
    title = '📚 Memoria';
    content = '<p style="opacity:.65;font-size:12.5px;margin-bottom:12px">Esto es lo que Aipher recuerda de ti en todas tus conversaciones, sin importar el chat. Lo va guardando solo, con criterio, mientras hablan.</p>'
      + (state.memoria.length
          ? state.memoria.map((m, i) => '<div class="chatItem"><span>' + escapeHTML(m) + '</span><button onclick="forgetMemory(' + i + ')" aria-label="Olvidar">✕</button></div>').join('')
          : '<p style="opacity:.5;font-size:12.5px">Aún no hay nada guardado.</p>')
      + (state.memoria.length ? '<button class="danger" style="margin-top:12px" onclick="clearMemory()">🗑️ Olvidar todo</button>' : '');
  } else if (section === 'engine') {
    title = '🧠 Motor IA';
    content = '<div class="engine-option' + (state.engine === 'offline' ? ' active' : '') + '" onclick="setEngine(\'offline\')"><strong>🏠 Offline — llama.cpp</strong><small>IA local sin Internet.</small></div>'
      + '<div style="margin:14px 0 6px;opacity:.65;font-size:13px">🌐 Online — elige tu motor:</div>'
      + Object.keys(PROVIDERS).map(id => {
          const active = state.engine === 'online' && state.onlineProvider === id;
          const hasKey = Boolean(state.apiKeys?.[id]);
          return '<div class="engine-option' + (active ? ' active' : '') + '" onclick="setOnlineProvider(\'' + id + '\')"><strong>' + PROVIDERS[id].label + '</strong><small>' + (hasKey ? 'Clave guardada' : 'Sin clave — ve a API Keys') + '</small></div>';
        }).join('');
  } else if (section === 'api') {
    title = '🔑 API Keys';
    content = Object.keys(PROVIDERS).map(id => {
        const p = PROVIDERS[id];
        const saved = Boolean(state.apiKeys?.[id]);
        return '<div class="form"><label>' + p.label + ' Key</label><input type="password" id="cfgKey_' + id + '" placeholder="' + (saved ? 'Clave guardada' : p.keyPlaceholder) + '"></div>';
      }).join('')
      + '<div class="form"><label>YouTube Key</label><input type="password" id="cfgYT" placeholder="' + (state.youtubeKey ? 'Clave guardada' : 'AIza...') + '"></div>'
      + '<div class="form"><label>Gemini Embeddings Key</label><input type="password" id="cfgGemini" placeholder="' + (state.apiKeys?.gemini ? 'Clave guardada' : 'AIza...') + '"><small style="opacity:.65">Opcional: activa búsqueda semántica de documentos. No cambia el motor principal.</small></div>'
      + '<button class="modalBtn" onclick="saveAPI()">💾 Guardar</button>';
  } else if (section === 'data') {
    title = '💾 Datos';
    content = '<button class="modalBtn" onclick="exportData()">📤 Exportar</button><button class="modalBtn" onclick="importData()">📥 Importar</button><button class="danger" onclick="clearAllData()">🗑 Borrar todo</button>';
  } else {
    title = 'ℹ️ Acerca';
    content = '<p style="text-align:center">🔥 <strong>Aipher v' + CONFIG.version + '</strong><br>Asistente personal con IA<br>🌐 Groq · 🏠 llama.cpp · 📺 YouTube</p>';
  }
  modal(title, content);
  renderLogoSystem();
}

function modal(title, content) {
  $('modalTitle').textContent = title;
  $('modalContent').innerHTML = content;
  $('modalBackdrop')?.classList.remove('hidden');
  renderLogoSystem();
}

function closeModal() { $('modalBackdrop')?.classList.add('hidden'); }

function saveProfile() { state.name = $('cfgName')?.value.trim() || 'Usuario'; state.personality = $('cfgPersonality')?.value || 'JARVIS'; saveState(); renderMessages(); closeModal(); toast('✅ Guardado'); }
function saveVoice() { state.voiceRate = Number($('cfgRate')?.value) || 1; state.voicePitch = Number($('cfgPitch')?.value) || 1; state.voiceEnabled = Boolean($('cfgVoiceEnabled')?.checked); configureVoices(); saveState(); closeModal(); toast('✅ Guardado'); }
function testVoice() { speak('Hola, soy Aipher.'); }
function saveAppearance() { state.theme = $('cfgTheme')?.value || 'dark'; state.fondo = $('cfgBg')?.value.trim() || ''; saveState(); applyTheme(); applyBackground(); closeModal(); toast('✅ Guardado'); }
function clearBackground() { state.fondo = ''; saveState(); applyBackground(); closeModal(); toast('🗑 Quitado'); }
function loadBackgroundFile(event) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = e => { state.fondo = e.target.result; const input = $('cfgBg'); if (input) input.value = state.fondo; saveState(); applyBackground(); toast('🖼️ Aplicado'); }; reader.readAsDataURL(file); }
function applyBackground() { const area = $('chatArea'); if (!area) return; area.style.backgroundImage = state.fondo ? 'url("' + String(state.fondo).replaceAll('"', '%22') + '")' : ''; }
function saveAPI() {
  Object.keys(PROVIDERS).forEach(id => {
    const value = $('cfgKey_' + id)?.value.trim();
    if (value) state.apiKeys[id] = value;
  });
  const yt = $('cfgYT')?.value.trim();
  if (yt) state.youtubeKey = yt;
  const gemini = $('cfgGemini')?.value.trim();
  if (gemini) state.apiKeys.gemini = gemini;
  saveState();
  closeModal();
  toast('🔑 Guardado');
}
async function exportData() { const documentos = await getAllDocuments(); const blob = new Blob([JSON.stringify({ version: CONFIG.version, state, documentos }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'aipher_' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 500); toast('📤 Exportado'); }
async function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.state) throw Error('FORMAT');
        state = normalizeState(data.state);
        await clearDocumentStore();
        if (Array.isArray(data.documentos)) for (const doc of data.documentos) if (doc?.id && doc?.chatId && Array.isArray(doc.chunks)) await putDocument(doc);
        saveState(); location.reload();
      } catch (err) { toast('⚠️ JSON inválido o biblioteca dañada'); }
    };
    reader.readAsText(file);
  };
  input.click();
}
async function clearAllData() { if (!confirm('¿Borrar todo?')) return; localStorage.removeItem('aipher_state'); await clearDocumentStore(); location.reload(); }
function resizeComposer() { const input = $('messageInput'); if (!input) return; input.style.height = 'auto'; input.style.height = Math.min(110, input.scrollHeight) + 'px'; $('charCounter').textContent = input.value.length + '/10000'; }
function toast(message, duration = 2300) { const el = $('toast'); if (!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), duration); }
function escapeHTML(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
function escapeAttribute(value) { return escapeHTML(value).replace(/"/g, '&quot;'); }
function updateConnectionStatus(offlineAvailable = null) { const el = $('connectionStatus'); if (!el) return; if (state.engine === 'online') { if (navigator.onLine === false) { el.textContent = '⚠️ Sin conexión'; el.classList.remove('hidden'); return; } el.classList.add('hidden'); return; } if (offlineAvailable === false) { el.textContent = '🏠 llama.cpp no disponible'; el.classList.remove('hidden'); } else { el.classList.add('hidden'); } }
window.addEventListener('online', () => { if (state.engine === 'online') { updateConnectionStatus(); toast('🟢 Conectado'); } });
window.addEventListener('offline', () => { if (state.engine === 'online') { updateConnectionStatus(); toast('⚠️ Sin conexión'); } });
function registerServiceWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {}); }
function initPointerDrag(element, type) { if (!element) return; let dragging = false, sx = 0, sy = 0, sl = 0, st = 0, moved = false; element.addEventListener('pointerdown', e => { if (e.target.tagName === 'IFRAME' || e.target.tagName === 'BUTTON') return; dragging = true; moved = false; sx = e.clientX; sy = e.clientY; sl = element.offsetLeft; st = element.offsetTop; try { element.setPointerCapture(e.pointerId); } catch (err) {} }); element.addEventListener('pointermove', e => { if (!dragging) return; if (Math.hypot(e.clientX - sx, e.clientY - sy) > 5) moved = true; if (!moved) return; e.preventDefault(); const maxX = window.innerWidth - element.offsetWidth; const maxY = window.innerHeight - element.offsetHeight; let nl = sl + e.clientX - sx; let nt = st + e.clientY - sy; nl = Math.max(0, Math.min(nl, maxX)); nt = Math.max(0, Math.min(nt, maxY)); element.style.left = nl + 'px'; element.style.top = nt + 'px'; element.style.right = 'auto'; element.style.bottom = 'auto'; }); element.addEventListener('pointerup', () => { dragging = false; if (type === 'bubble') bubbleDrag = moved; }); element.addEventListener('pointercancel', () => { dragging = false; }); }

Object.assign(window, { removeFile, pickFiles, saveProfile, saveVoice, testVoice, saveAppearance, clearBackground, loadBackgroundFile, saveBubble, resetBubble, openBubbleGifPicker, saveAPI, exportData, importData, clearAllData, setEngine, setOnlineProvider, forgetMemory, clearMemory, searchDocumentsUI });
