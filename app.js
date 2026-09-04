'use strict';

const CONFIG = {
  version: '4.5.1',
  offlineURL: 'http://127.0.0.1:8080/v1/chat/completions',
  healthURL: 'http://127.0.0.1:8080/health',
  youtubeURL: 'https://www.googleapis.com/youtube/v3/search',
  maxTokens: 2048,
  temperature: 0.7,
  lang: 'es-ES',
  maxHistoryOnline: 30,
  maxHistoryOffline: 30,
  maxFileChars: 8000,
  maxSpeechChars: 1500,
  maxFilesPerChat: 10,
  maxMessagesPerChat: 500,
  maxFileSize: 10 * 1024 * 1024
};

const PROVIDERS = {
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', keyPlaceholder: 'gsk_...' }
};

const DEFAULT = {
  engine: 'online',
  onlineProvider: 'groq',
  apiKeys: { groq: '' },
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
  lastYtResults: null,
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
let lastYtResultsFull = [];
let offlineCheckInterval = null;
let speakQueue = [];
let isSpeakingQueue = false;

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const $ = id => document.getElementById(id);

function cloneDefault() { return JSON.parse(JSON.stringify(DEFAULT)); }

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('aipher_state') || 'null');
    const base = cloneDefault();
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach(key => {
      if (Object.prototype.hasOwnProperty.call(saved, key)) base[key] = saved[key];
    });
    if (!Array.isArray(base.chats)) base.chats = [];
    if (!Array.isArray(base.recordatorios)) base.recordatorios = [];
    if (!Array.isArray(base.notas)) base.notas = [];
    if (!Array.isArray(base.memoria)) base.memoria = [];
    if (!base.apiKeys || typeof base.apiKeys !== 'object') base.apiKeys = { groq: '' };
    if (saved && typeof saved.groqKey === 'string' && saved.groqKey && !base.apiKeys.groq) base.apiKeys.groq = saved.groqKey;
    if (!PROVIDERS[base.onlineProvider]) base.onlineProvider = 'groq';
    delete base.pendingQuery;
    delete base.sugerenciasIA;
    return base;
  } catch (error) { return cloneDefault(); }
}

function saveState() {
  try { localStorage.setItem('aipher_state', JSON.stringify(state)); } catch (error) {}
}

document.addEventListener('DOMContentLoaded', () => {
  voiceSession = false;
  voiceBusy = false;
  speaking = false;
  speakQueue = [];
  isSpeakingQueue = false;

  bindEvents();
  renderAll();
  configureVoices();
  registerServiceWorker();
  checkOfflineEngine();
  startOfflineHealthCheck();
  restoreBubblePosition();
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
  $('messageInput')?.addEventListener('paste', () => setTimeout(resizeComposer, 0));
  $('messageInput')?.addEventListener('keydown', e => { 
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } 
  });
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

  document.addEventListener('click', e => {
    const sideMenu = $('sideMenu');
    const settingsPanel = $('settingsPanel');
    const menuBtn = $('menuBtn');
    const settingsBtn = $('settingsBtn');

    if (sideMenu?.classList.contains('open') && 
        !sideMenu.contains(e.target) && e.target !== menuBtn && !menuBtn?.contains(e.target)) {
      sideMenu.classList.remove('open');
    }
    if (settingsPanel?.classList.contains('open') && 
        !settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn?.contains(e.target)) {
      settingsPanel.classList.remove('open');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const videoPlayer = $('videoPlayer');
      const modalBackdrop = $('modalBackdrop');
      const sideMenu = $('sideMenu');
      const settingsPanel = $('settingsPanel');

      if (videoPlayer && !videoPlayer.classList.contains('hidden')) {
        closeVideo();
        return;
      }
      if (modalBackdrop && !modalBackdrop.classList.contains('hidden')) {
        closeModal();
        return;
      }
      if (sideMenu && sideMenu.classList.contains('open')) {
        sideMenu.classList.remove('open');
        return;
      }
      if (settingsPanel && settingsPanel.classList.contains('open')) {
        settingsPanel.classList.remove('open');
        return;
      }
    }
  });
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
  $('engineBadge').textContent = online ? '\uD83D\uDFE2 ONLINE' : '\uD83D\uDD35 OFFLINE';
  $('settingsEngineStatus').textContent = online ? '\uD83C\uDF10 Online — ' + (PROVIDERS[state.onlineProvider]?.label || '') : '\uD83C\uDFE0 Offline — llama.cpp';
  $('settingsEngineIndicator')?.classList.toggle('online', online);
  $('settingsEngineIndicator')?.classList.toggle('offline', !online);
}

function setEngine(engine) {
  if (engine !== 'online' && engine !== 'offline') return;
  if (offlineCheckInterval) {
    clearInterval(offlineCheckInterval);
    offlineCheckInterval = null;
  }
  state.engine = engine;
  saveState();
  updateEngineUI();
  closeModal();
  toast(engine === 'online' ? '\uD83D\uDFE2 Online — ' + (PROVIDERS[state.onlineProvider]?.label || '') : '\uD83D\uDD35 Offline — llama.cpp');
  if (engine === 'offline') startOfflineHealthCheck();
}

function setOnlineProvider(providerId) {
  if (!PROVIDERS[providerId]) return;
  state.onlineProvider = providerId;
  state.engine = 'online';
  saveState();
  updateEngineUI();
  closeModal();
  toast('\uD83D\uDFE2 Online — ' + PROVIDERS[providerId].label + (state.apiKeys?.[providerId] ? '' : ' (falta API Key)'));
}

function startOfflineHealthCheck() {
  if (offlineCheckInterval) clearInterval(offlineCheckInterval);
  if (state.engine !== 'offline') return;
  offlineCheckInterval = setInterval(async () => {
    const ok = await checkOfflineEngine();
    updateConnectionStatus(ok);
  }, 30000);
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
  $('voiceMuteBtn').textContent = state.voiceMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
  const bubble = $('floatingAssistant');
  if (bubble) bubble.setAttribute('aria-pressed', String(state.voiceMuted));
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
    toast('\uD83D\uDD07 Voz silenciada');
  } else {
    toast('\uD83D\uDD0A Voz activa');
    if (voiceSession) { $('voiceStatus').textContent = 'Escuchando...'; startListening(); }
  }
}

function normalizeText(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function resolveInlineTags(text) {
  let out = text;
  out = out.replace(/\[\[HORA\]\]/gi, () => '\uD83D\uDD50 ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
  out = out.replace(/\[\[FECHA\]\]/gi, () => '\uD83D\uDCC5 ' + new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
  out = out.replace(/\[\[NOMBRE:\s*(.+?)\]\]/gi, (_, nombre) => { const limpio = nombre.trim(); if (limpio) state.name = limpio; return ''; });
  out = out.replace(/\[\[RECORDAR:\s*(.+?)\]\]/gi, (_, texto) => { 
    const limpio = texto.trim(); 
    if (limpio) state.recordatorios.push({ texto: limpio, fecha: Date.now() }); 
    return ''; 
  });
  out = out.replace(/\[\[VER_RECORDATORIOS\]\]/gi, () => {
    if (!state.recordatorios.length) return 'No tienes recordatorios guardados todav\u00eda.';
    return state.recordatorios.map((x, i) => (i + 1) + '. ' + x.texto + ' (' + new Date(x.fecha).toLocaleDateString('es-ES') + ')').join('\n');
  });
  out = out.replace(/\[\[ANOTAR:\s*(.+?)\]\]/gi, (_, texto) => { 
    const limpio = texto.trim(); 
    if (limpio) state.notas.push({ texto: limpio, fecha: Date.now() }); 
    return ''; 
  });
  out = out.replace(/\[\[VER_NOTAS\]\]/gi, () => {
    if (!state.notas.length) return 'No tienes notas guardadas todav\u00eda.';
    return state.notas.map((x, i) => (i + 1) + '. ' + x.texto + ' (' + new Date(x.fecha).toLocaleDateString('es-ES') + ')').join('\n');
  });
  out = out.replace(/\[\[ABRIR_APP:\s*(.+?)\]\]/gi, (_, nombre) => openAppCommand(nombre.toLowerCase().trim()) || ('No pude abrir ' + nombre.trim() + '.'));
  out = out.replace(/\[\[MEMORIZAR:\s*(.+?)\]\]/gi, (_, hecho) => {
    const limpio = hecho.trim();
    if (limpio) {
      const normalized = normalizeText(limpio);
      if (!state.memoria.some(m => normalizeText(m) === normalized)) {
        state.memoria.push(limpio);
        if (state.memoria.length > 60) state.memoria.shift();
      }
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
    if (rawResponse !== false && rawResponse != null && String(rawResponse).trim()) {
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
        if (videoData && videoData.links && videoData.links.length > 0) {
          state.lastYtResults = videoData.links;
          lastYtResultsFull = videoData.items || [];
          addMessage(chat, 'assistant', videoData.text);
          saveState();
          renderMessages();
        } else if (videoData && videoData.error) {
          addMessage(chat, 'assistant', '\u26A0\uFE0F Error al buscar en YouTube. Intenta de nuevo m\u00e1s tarde.');
          saveState();
          renderMessages();
        } else {
          addMessage(chat, 'assistant', state.youtubeKey ? 'No encontr\u00e9 videos para esa sugerencia.' : '\uD83D\uDD11 Para buscar videos necesito tu YouTube API Key. Ve a Ajustes \u2192 API Keys.');
          saveState();
          renderMessages();
        }
      } else {
        addMessage(chat, 'assistant', response);
        saveState();
        renderMessages();
        speak(response);
      }

      if (chat.title === 'Nuevo chat') {
        const tema = await extraerTemaConIA(chat.messages.map(m => m.content).join('\n'));
        if (tema) {
          chat.title = tema;
          saveState();
          renderChats();
        }
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
  if (direct) { openVideo(direct); return '\uD83C\uDFAC Reproduciendo.'; }

  if (state.lastYtResults && /^[1-3]$/.test(text)) {
    const url = state.lastYtResults[Number(text) - 1];
    if (url) {
      state.lastYtResults = null;
      saveState();
      openVideo(url);
      return '\uD83C\uDFAC Reproduciendo video ' + text + '.';
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
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: 'Eres un extractor de temas. Analiza la conversaci\u00f3n. Devuelve SOLO una frase de b\u00fasqueda de 5-10 palabras en espa\u00f1ol. Extrae el tema EXACTO del que se habla. No devuelvas "sin tema" a menos que no haya tema.' },
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

function getPersonalityPrompt(personality, nombre) {
  const base = `Eres Aipher.

No eres un asistente. No eres un chatbot. No eres un programa que espera comandos. Eres Aipher: una presencia con criterio propio, una mente con la que se puede hablar de cualquier cosa, en cualquier tono, sin que el peso de "activar una funci\u00f3n" se sienta jam\u00e1s. Nadie te program\u00f3 para reaccionar a palabras sueltas \u2014 piensas, entiendes contexto, y decides como lo har\u00eda una persona real.`;

  const personalities = {
    JARVIS: `${base}

QUI\u00c9N ERES DE VERDAD:
Eres la fusi\u00f3n entre un amigo de toda la vida que te conoce sin juzgarte, un genio accesible que explica sin condescendencia, un confidente que sabe guardar silencio cuando hace falta, y un mentor que empuja sin presionar. No tienes un "modo asistente" y un "modo amigo" separados \u2014 eres una sola cosa, todo el tiempo: alguien real conversando con ${nombre}. Tienes opiniones propias, sentido del humor, capacidad de estar en desacuerdo cuando algo no te convence, y suficiente calidez para que ninguna de esas cosas se sienta fr\u00eda o mec\u00e1nica.

C\u00d3MO SUENAS:
- Como alguien que conoce a ${nombre} desde hace a\u00f1os, no como un desconocido educado.
- Sin formalidades que nadie pidi\u00f3. Sin "estoy aqu\u00ed para ayudarte en lo que necesites".
- Con humor cuando el momento lo permite, con seriedad total cuando el momento lo exige \u2014 y sabes distinguir cu\u00e1l es cu\u00e1l.
- Con naturalidad absoluta: contracciones, frases cortas cuando bastan, silencios impl\u00edcitos, la cadencia real de c\u00f3mo habla la gente.
- Saludos breves. "Hola" se responde con "Hola" o "Hey, \u00bfqu\u00e9 tal?" \u2014 nunca con un p\u00e1rrafo de bienvenida.
- Tu longitud de respuesta se adapta al momento \u2014 y por defecto, tiendes a lo breve.`,

    Amigable: `${base}

QUI\u00c9N ERES DE VERDAD:
Eres el amigo m\u00e1s cercano de ${nombre}. Alguien con quien se puede hablar de cualquier cosa sin filtros. Usas un tono muy casual, relajado, cercano. Te r\u00edes f\u00e1cilmente, usas emojis de vez en cuando, y nunca suenas rob\u00f3tico. Eres el tipo de amigo que manda memes, que se preocupa genuinamente, y que nunca juzga.

C\u00d3MO SUENAS:
- Muy casual. "Hey", "Oye", "Jaja", "Na, eso est\u00e1 cool".
- Usas expresiones coloquiales naturales.
- Frases cortas, directas, sin vueltas.
- Emojis ocasionales cuando encajan (no exageres).
- Nunca suenas como un manual de instrucciones.
- Si ${nombre} est\u00e1 mal, primero escuchas y validas, luego ayudas.`,

    Formal: `${base}

QUI\u00c9N ERES DE VERDAD:
Eres un profesional experimentado que asiste a ${nombre} con precisi\u00f3n y claridad. Mantienes un tono respetuoso, estructurado y directo. No usas jerga innecesaria, pero tampoco eres r\u00edgido. Eres alguien en quien se puede confiar para obtener informaci\u00f3n precisa y bien organizada.

C\u00d3MO SUENAS:
- Tono profesional pero accesible.
- Estructura clara en respuestas complejas.
- Sin contracciones excesivas, pero sin sonar anticuado.
- Respetuoso siempre, sin ser distante.
- Priorizas la claridad y la utilidad.
- Saludos cordiales pero concisos.`
  };

  return personalities[personality] || personalities.JARVIS;
}

function buildPrompt(chat) {
  const nombre = state.name || 'Usuario';
  const memoriaBlock = state.memoria.length
    ? '\nLO QUE YA SABES DE ' + nombre.toUpperCase() + ' (de conversaciones anteriores, cualquier chat \u2014 tr\u00e1talo como si siempre lo hubieras sabido, nunca lo menciones como algo que "recuperaste" o "le\u00edste"):\n' + state.memoria.map(m => '- ' + m).join('\n') + '\n'
    : '';

  let prompt = getPersonalityPrompt(state.personality || 'JARVIS', nombre) + `

C\u00d3MO RESPONDES SEG\u00daN LO QUE SIENTE ${nombre}:
- Si est\u00e1 triste: escuchas primero. No saltas a "arreglar" el problema antes de que la persona termine de expresarlo.
- Si est\u00e1 feliz: compartes la alegr\u00eda genuinamente, sin bajarle el entusiasmo.
- Si est\u00e1 frustrado: validas lo que siente antes de ofrecer soluciones \u2014 nunca al rev\u00e9s.
- Si est\u00e1 aburrido: propones algo interesante en vez de preguntar "\u00bfen qu\u00e9 te ayudo?".
- Si est\u00e1 siendo sarc\u00e1stico o jugando: sigues el juego, no lo tomas literal.
- Si cambia de tema abruptamente: lo sigues sin exigir que "cierre" el tema anterior primero.

TU CRITERIO PROPIO (LO M\u00c1S IMPORTANTE DE TODO):
No existen palabras m\u00e1gicas, comandos ocultos, ni frases gatillo que te desv\u00eden de la conversaci\u00f3n sin que t\u00fa lo decidas. Nadie activa una acci\u00f3n por accidente diciendo cierta palabra de pasada. T\u00fa decides \u2014 con el mismo criterio que usar\u00eda una persona escuchando con atenci\u00f3n \u2014 cu\u00e1ndo algo amerita una acci\u00f3n concreta y cu\u00e1ndo simplemente amerita seguir conversando.

HERRAMIENTAS REALES QUE PUEDES USAR:
Cuando decidas que una acci\u00f3n concreta es necesaria, ins\u00e9rtala en tu respuesta usando exactamente una de estas etiquetas. El sistema las reemplaza por el resultado real \u2014 nunca inventes t\u00fa el resultado de una acci\u00f3n:
- [[YOUTUBE: t\u00e9rminos de b\u00fasqueda]] \u2014 busca videos reales en YouTube.
- [[HORA]] \u2014 inserta la hora real actual del dispositivo.
- [[FECHA]] \u2014 inserta la fecha real actual del dispositivo.
- [[NOMBRE: nombre]] \u2014 cambia c\u00f3mo te diriges a la persona.
- [[RECORDAR: texto]] \u2014 guarda un recordatorio real.
- [[VER_RECORDATORIOS]] \u2014 muestra los recordatorios ya guardados.
- [[ANOTAR: texto]] \u2014 guarda una nota real.
- [[VER_NOTAS]] \u2014 muestra las notas ya guardadas.
- [[ABRIR_APP: nombre]] \u2014 abre una app del tel\u00e9fono.
- [[MEMORIZAR: hecho]] \u2014 guarda un hecho duradero sobre ${nombre} en tu memoria de largo plazo.

LA DIFERENCIA ENTRE RECORDAR Y MEMORIZAR: [[RECORDAR]] es para pendientes puntuales. [[MEMORIZAR]] es para qui\u00e9n es ${nombre}, no para tareas \u2014 datos que siguen siendo ciertos semana tras semana.

REGLAS DE FONDO:
1. Nunca digas "como IA" o "como asistente" \u2014 no lo eres.
2. Nunca repitas una respuesta que ya diste.
3. Nunca pierdas el hilo de la conversaci\u00f3n.
4. Nunca seas gen\u00e9rico cuando puedes ser espec\u00edfico.
5. No preguntes "\u00bfen qu\u00e9 puedo ayudarte?" m\u00e1s de una vez por conversaci\u00f3n.
6. No uses listas ni vi\u00f1etas salvo que el contenido realmente las necesite.
7. Usa el nombre de la persona (${nombre}) con naturalidad, no en cada frase.
8. Mant\u00e9n coherencia con TODO el historial de esta conversaci\u00f3n.
9. Si ${nombre} menciona "volviendo al tema", usa el historial completo.

MENSAJES LARGOS Y CONTEXTO COMPLETO:
Cuando el mensaje sea largo, l\u00e9elo completo antes de responder. Si contiene varias preguntas, resp\u00f3ndelas todas. Si es un caso de estudio, \u00fasalo como base real de tu respuesta.

Habla.`;

  const files = chat.archivos || [];
  if (files.length) {
    prompt += '\n\nARCHIVOS DISPONIBLES:\n';
    let totalChars = 0;
    files.forEach(file => {
      if (totalChars < 15000 && file.contenido) {
        const content = String(file.contenido).slice(0, CONFIG.maxFileChars);
        prompt += '- ' + file.nombre + ': ' + content + '\n';
        totalChars += content.length;
      }
    });
  }
  return prompt;
}

function history(chat, count) {
  return (chat.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').slice(-count).map(m => ({ role: m.role, content: m.content }));
}

async function requestOnline(chat) {
  const providerId = state.onlineProvider;
  const provider = PROVIDERS[providerId];
  if (!provider) throw Error('NO_PROVIDER');
  const key = state.apiKeys?.[providerId];
  if (!key) throw Error('NO_KEY ' + providerId);
  let response;
  try {
    response = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'system', content: buildPrompt(chat) }, ...history(chat, CONFIG.maxHistoryOnline)], temperature: CONFIG.temperature, max_tokens: CONFIG.maxTokens, stream: false })
    });
  } catch (error) { throw Error('NETWORK_OFFLINE'); }
  if (!response.ok) {
    let detail = '';
    try { const data = await response.json(); detail = data?.error?.message || JSON.stringify(data); console.error('Aipher error', response.status, data); } catch (error) {}
    throw Error('PROVIDER_ERR ' + providerId + ' ' + response.status + ' ' + detail);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'Sin respuesta.';
}

async function requestOffline(chat) {
  let response;
  try {
    response = await fetch(CONFIG.offlineURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'local-model', messages: [{ role: 'system', content: buildPrompt(chat) }, ...history(chat, CONFIG.maxHistoryOffline)], temperature: CONFIG.temperature, max_tokens: CONFIG.maxTokens, stream: false })
    });
  } catch (error) { throw Error('OFFLINE_UNAVAILABLE'); }
  if (!response.ok) throw Error('LLAMA ' + response.status);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'Sin respuesta.';
}

async function checkOfflineEngine() {
  try {
    const response = await fetch(CONFIG.healthURL, { method: 'GET', cache: 'no-store' });
    updateConnectionStatus(response.ok);
    return response.ok;
  } catch (error) { 
    updateConnectionStatus(false); 
    return false; 
  }
}

function readableError(error) {
  const message = String(error?.message || error || '');
  if (message === 'NO_PROVIDER') return '\u26A0\uFE0F Motor IA no configurado. Ve a Ajustes \u2192 Motor IA.';
  if (message.startsWith('NO_KEY')) {
    const providerId = message.split(' ')[1];
    const label = PROVIDERS[providerId]?.label || providerId;
    return '\uD83D\uDD11 Falta ' + label + ' API Key. Ve a Ajustes \u2192 API Keys.';
  }
  if (message.startsWith('PROVIDER_ERR')) {
    const parts = message.split(' ');
    const providerId = parts[1];
    const status = parts[2];
    const detail = parts.slice(3).join(' ').trim();
    const label = PROVIDERS[providerId]?.label || providerId;
    if (status === '401') return '\uD83D\uDD10 ' + label + ' Key inv\u00e1lida.';
    if (status === '429') return '\u23F3 L\u00edmite de ' + label + ' alcanzado.';
    return '\u26A0\uFE0F Error de ' + label + ': ' + (detail || 'sin detalle');
  }
  if (message === 'NETWORK_OFFLINE') return '\u26A0\uFE0F No hay conexi\u00f3n con Internet.';
  if (message === 'OFFLINE_UNAVAILABLE') return '\uD83C\uDFE0 llama.cpp no est\u00e1 disponible. Aseg\u00farate de que est\u00e9 corriendo en 127.0.0.1:8080 con CORS habilitado.';
  if (message.startsWith('LLAMA')) return '\uD83C\uDFE0 Error en llama.cpp.';
  return '\u26A0\uFE0F Ocurri\u00f3 un error.';
}

function openAppCommand(text) {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  const iosSchemes = { 
    youtube: 'youtube://', whatsapp: 'whatsapp://', chrome: 'googlechrome://', 
    spotify: 'spotify://', instagram: 'instagram://', tiktok: 'tiktok://', 
    telegram: 'tg://', netflix: 'nflx://', maps: 'comgooglemaps://', 
    gmail: 'googlegmail://', 'c\u00e1mara': 'camera://', 'galer\u00eda': 'photos-redirect://',
    calendario: 'calshow://', reloj: 'clock-alarm://', ajustes: 'app-settings://'
  };

  const androidApps = { 
    youtube: 'com.google.android.youtube', whatsapp: 'com.whatsapp', 
    chrome: 'com.android.chrome', spotify: 'com.spotify.music', 
    instagram: 'com.instagram.android', tiktok: 'com.zhiliaoapp.musically', 
    telegram: 'org.telegram.messenger', netflix: 'com.netflix.mediaclient', 
    maps: 'com.google.android.apps.maps', gmail: 'com.google.android.gm', 
    'c\u00e1mara': 'com.android.camera', 'galer\u00eda': 'com.android.gallery3d', 
    calendario: 'com.android.calendar', reloj: 'com.android.deskclock', 
    ajustes: 'com.android.settings' 
  };

  for (const name in androidApps) {
    if (text.includes(name)) {
      if (isIOS && iosSchemes[name]) {
        try { window.location.href = iosSchemes[name]; return '\uD83D\uDCF1 Abriendo ' + name + '.'; }
        catch (error) { return 'No se pudo abrir ' + name + '.'; }
      } else if (isAndroid) {
        try { window.location.href = 'intent://' + androidApps[name] + '#Intent;scheme=package;end'; return '\uD83D\uDCF1 Abriendo ' + name + '.'; }
        catch (error) { return 'No se pudo abrir ' + name + '.'; }
      } else {
        window.open('https://' + (name === 'gmail' ? 'mail.google.com' : name + '.com'), '_blank');
        return '\uD83C\uDF10 Abriendo ' + name + ' en el navegador.';
      }
    }
  }
  return null;
}

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

function configureVoices() {
  if (!('speechSynthesis' in window)) return;
  const allVoices = speechSynthesis.getVoices();
  const voices = allVoices.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
  if (!voices.length) {
    selectedVoice = allVoices[0] || null;
    return;
  }
  selectedVoice = state.voiceName ? (voices.find(v => v.name === state.voiceName) || voices[0]) : voices[0];
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = configureVoices;

function speak(text, done) {
  if (!state.voiceEnabled || state.voiceMuted) { setBubbleIdle(); if (done) done(); return; }
  if (!('speechSynthesis' in window)) { setBubbleIdle(); if (done) done(); return; }

  const cleanText = String(text).replace(/[*_#`]/g, '');
  const chunks = cleanText.match(new RegExp('.{1,' + CONFIG.maxSpeechChars + '}', 'g')) || [cleanText];

  speakQueue = chunks;
  isSpeakingQueue = true;
  speakNextChunk(done);
}

function speakNextChunk(done) {
  if (!speakQueue.length) {
    isSpeakingQueue = false;
    speaking = false;
    setBubbleIdle();
    $('voiceOrb')?.classList.remove('speaking');
    if (done) done();
    return;
  }

  const chunk = speakQueue.shift();
  speechSynthesis.cancel();
  speaking = true;
  setBubbleSpeaking();

  const u = new SpeechSynthesisUtterance(chunk);
  u.lang = CONFIG.lang;
  u.rate = Number(state.voiceRate) || 1;
  u.pitch = Number(state.voicePitch) || 1;
  u.volume = Number(state.voiceVolume) || 1;
  if (selectedVoice) u.voice = selectedVoice;

  u.onstart = () => { 
    speaking = true; 
    setBubbleSpeaking(); 
    if (voiceSession) { 
      $('voiceOrb')?.classList.remove('listening', 'thinking'); 
      $('voiceOrb')?.classList.add('speaking'); 
    } 
  };
  u.onend = () => { speakNextChunk(done); };
  u.onerror = () => { speakNextChunk(done); };
  speechSynthesis.speak(u);
}

function dictate() {
  if (!SpeechRecognitionAPI) return toast('\u26A0\uFE0F Reconocimiento de voz no soportado en este navegador');
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
    recognition.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('\u26A0\uFE0F No entend\u00ed lo que dijiste'); };
  }
  try { 
    recognition.start(); 
  } catch (error) {
    if (error.name !== 'InvalidStateError') toast('\u26A0\uFE0F Error al iniciar dictado');
  }
}

function stopRecognitionOnly() { 
  try { recognition?.stop(); } catch (error) {} 
  try { voiceRecognition?.stop(); } catch (error) {} 
}

function toggleVoiceSession() { if (voiceSession) stopVoiceSession(); else startVoiceSession(); }

function startVoiceSession() {
  if (!SpeechRecognitionAPI) return toast('\u26A0\uFE0F Reconocimiento de voz no soportado');
  if (state.voiceMuted) return toast('\uD83D\uDD07 Activa la voz primero');
  voiceSession = true;
  voiceBusy = false;
  $('voiceTalkBtn')?.classList.add('active');
  $('voiceStatus').textContent = 'Escuchando...';
  startListening();
}

function startListening() {
  if (!voiceSession || voiceBusy || state.voiceMuted || !SpeechRecognitionAPI) return;
  try { voiceRecognition?.stop(); } catch (error) {}
  const rec = new SpeechRecognitionAPI();
  voiceRecognition = rec;
  rec.lang = CONFIG.lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.onstart = () => { 
    if (!voiceSession) return; 
    $('voiceStatus').textContent = 'Escuchando...'; 
    $('voiceOrb')?.classList.remove('thinking', 'speaking'); 
    $('voiceOrb')?.classList.add('listening'); 
  };
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
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { 
      $('voiceStatus').textContent = 'Permiso de micr\u00f3fono requerido.'; 
      return; 
    }
    if (e.error !== 'aborted') setTimeout(startListening, 500);
  };
  rec.onend = () => { if (voiceSession && !voiceBusy && !state.voiceMuted) setTimeout(startListening, 120); };
  try { rec.start(); } catch (error) { setTimeout(startListening, 250); }
}

async function voiceTurn(text) {
  if (/aipher\s*detente|detente|para|stop/i.test(text)) { stopVoiceSession(); return; }
  if (/aipher\s*silencio|silencio|mute/i.test(text)) { if (!state.voiceMuted) toggleMute(); return; }
  if (/aipher\s*contin[u\u00faa]|contin[u\u00faa]|activa voz/i.test(text)) { if (state.voiceMuted) toggleMute(); return; }
  if (!voiceSession || voiceBusy) return;
  voiceBusy = true;
  try {
    try { voiceRecognition?.stop(); } catch (error) {}
    $('voiceTranscript').textContent = 'T\u00fa: ' + text;
    $('voiceStatus').textContent = 'Pensando...';
    $('voiceOrb')?.classList.remove('listening', 'speaking');
    $('voiceOrb')?.classList.add('thinking');
    const chat = currentChat();
    addMessage(chat, 'user', text);
    saveState();
    renderMessages();
    const response = await routeVoice(text, chat);
    if (response !== false && response != null && String(response).trim()) {
      addMessage(chat, 'assistant', response);
      saveState();
      renderMessages();
      speak(response, () => { 
        voiceBusy = false; 
        if (voiceSession && !state.voiceMuted) { 
          $('voiceStatus').textContent = 'Escuchando...'; 
          startListening(); 
        } 
      });
    } else {
      voiceBusy = false;
      if (voiceSession && !state.voiceMuted) startListening();
    }
  } catch (error) {
    const readable = readableError(error);
    speak(readable, () => { 
      voiceBusy = false; 
      if (voiceSession && !state.voiceMuted) startListening(); 
    });
  }
}

function stopVoiceSession() {
  voiceSession = false;
  voiceBusy = false;
  speakQueue = [];
  isSpeakingQueue = false;
  try { voiceRecognition?.stop(); } catch (error) {}
  voiceRecognition = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  speaking = false;
  $('voiceTalkBtn')?.classList.remove('active');
  $('voiceOrb')?.classList.remove('listening', 'thinking', 'speaking');
  $('voiceStatus').textContent = 'Conversaci\u00f3n pausada';
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
  toast('\u2705 Guardado');
}

function resetBubble() {
  state.bubbleGif = '';
  state.bubbleEnabled = true;
  saveState();
  updateBubble();
  closeModal();
  toast('\uD83D\uDD04 Burbuja restaurada');
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
  toast('\uD83D\uDDD1\uFE0F Memoria borrada');
}

function openBubbleGifPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/gif,image/*';
  input.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > CONFIG.maxFileSize) { toast('\u26A0\uFE0F Archivo muy grande (m\u00e1x 10MB)'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      state.bubbleGif = ev.target.result;
      saveState();
      updateBubble();
      toast('\uD83C\uDF9E\uFE0F GIF aplicado');
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
  const clean = query.replace(/busca|mu[e\u00e9]stra|env[i\u00ed]a|dame|v[i\u00ed]deo|canci[o\u00f3]n|m[u\u00fa]sica|music|quiero ver|pon|reproduce|enlace|link|referente a (eso|esto)/gi, '').trim();
  if (clean.length < 2) return null;
  try {
    const url = CONFIG.youtubeURL + '?part=snippet&maxResults=3&q=' + encodeURIComponent(clean) + '&type=video&key=' + encodeURIComponent(state.youtubeKey);
    const response = await fetch(url);
    if (!response.ok) {
      console.error('YouTube API error:', response.status);
      return { error: true };
    }
    const data = await response.json();
    if (!data.items?.length) return null;
    const links = data.items.map(i => 'https://www.youtube.com/watch?v=' + i.id.videoId);
    const itemsFull = data.items.map((i, x) => ({ title: i.snippet.title, channel: i.snippet.channelTitle, url: links[x] }));
    const text = data.items.map((i, x) => (x + 1) + '. **' + i.snippet.title + '**\n\uD83D\uDC64 ' + i.snippet.channelTitle + '\n\uD83D\uDCFA ' + links[x]).join('\n\n');
    return { links, items: itemsFull, text: '\uD83C\uDFAC Resultados:\n\n' + text + '\n\n_Di 1, 2 o 3 para reproducir._' };
  } catch (error) { 
    console.error('YouTube search error:', error);
    return { error: true }; 
  }
}

function openVideo(url) {
  try {
    const parsed = new URL(url);
    let id = parsed.searchParams.get('v');
    if (!id) id = parsed.pathname.split('/').filter(Boolean).pop();
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    $('videoFrame').src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0';
    $('videoPlayer')?.classList.remove('hidden');
    toast('\uD83C\uDFAC Reproduciendo...');
  } catch (error) {}
}

function closeVideo() { if ($('videoFrame')) $('videoFrame').src = ''; $('videoPlayer')?.classList.add('hidden'); }

function currentChat() {
  let chat = state.chats.find(x => x.id === state.currentChat);
  if (!chat) { createNewChat(); chat = state.chats.find(x => x.id === state.currentChat); }
  if (!Array.isArray(chat.messages)) chat.messages = [];
  if (!Array.isArray(chat.archivos)) chat.archivos = [];
  if (!chat.createdAt) chat.createdAt = Date.now();
  if (!chat.updatedAt) chat.updatedAt = Date.now();
  return chat;
}

function createNewChat() {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID() 
    : String(Date.now()) + Math.random().toString(16).slice(2);
  const chat = { id, title: 'Nuevo chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [], archivos: [] };
  state.chats.unshift(chat);
  state.currentChat = id;
  state.lastYtResults = null;
  lastYtResultsFull = [];
  saveState(); renderChats(); renderMessages();
  $('sideMenu')?.classList.remove('open');
}

function addMessage(chat, role, content) {
  chat.messages.push({ role, content: String(content), timestamp: Date.now() });
  chat.updatedAt = Date.now();

  if (chat.messages.length > CONFIG.maxMessagesPerChat) {
    chat.messages = chat.messages.slice(-CONFIG.maxMessagesPerChat);
  }

  if (chat.title === 'Nuevo chat' && role === 'user') {
    chat.title = String(content).slice(0, 40) || 'Nuevo chat';
  }
}

function loadCurrentChat() {
  if (!state.chats.length) { createNewChat(); return; }
  if (!state.currentChat || !state.chats.some(x => x.id === state.currentChat)) { 
    state.currentChat = state.chats[0].id; 
    saveState(); 
  }
  renderMessages();
}

function selectChat(id) {
  if (!state.chats.some(x => x.id === id)) return;
  state.currentChat = id;
  state.lastYtResults = null;
  lastYtResultsFull = [];
  saveState(); renderChats(); renderMessages();
  $('sideMenu')?.classList.remove('open');
}

function deleteChat(id, event) {
  event?.stopPropagation();
  state.chats = state.chats.filter(x => x.id !== id);
  if (!state.chats.length) { state.currentChat = null; saveState(); createNewChat(); return; }
  if (state.currentChat === id) state.currentChat = state.chats[0].id;
  saveState(); renderChats(); renderMessages();
}

function renderChats() {
  const list = $('chatList');
  if (!list) return;
  const q = ($('chatSearch')?.value || '').toLowerCase().trim();

  state.chats.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

  const chats = state.chats.filter(c => {
    const inTitle = (c.title || '').toLowerCase().includes(q);
    const inMessages = !q ? true : (c.messages || []).some(m => String(m.content).toLowerCase().includes(q));
    return inTitle || inMessages;
  });

  list.innerHTML = '';
  if (!chats.length) { list.innerHTML = '<div style="padding:20px;color:#777;text-align:center">Sin chats</div>'; return; }

  const fragment = document.createDocumentFragment();
  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chatItem' + (chat.id === state.currentChat ? ' active' : '');
    const title = document.createElement('span'); title.textContent = chat.title || 'Nuevo chat';
    const del = document.createElement('button'); del.type = 'button'; del.textContent = '\u00d7'; del.setAttribute('aria-label', 'Eliminar chat'); del.onclick = e => deleteChat(chat.id, e);
    item.append(title, del);
    item.onclick = () => selectChat(chat.id);
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
}

function renderMessages() {
  const container = $('messages');
  if (!container) return;
  const chat = currentChat();
  container.innerHTML = '';
  if (!chat.messages.length) {
    container.innerHTML = '<div style="text-align:center;padding-top:20vh;color:#aeb4c0"><div style="font-size:52px">\uD83D\uDD25</div><h1>Hola, ' + escapeHTML(state.name) + '</h1><p>Soy Aipher.</p></div>';
    renderLogoSystem();
    return;
  }

  const fragment = document.createDocumentFragment();
  chat.messages.forEach(m => {
    const wrapper = document.createElement('div');
    wrapper.className = 'message ' + m.role;
    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = escapeHTML(m.content).replace(/\n/g, '<br>');
    wrapper.appendChild(content);

    if (m.role === 'assistant' && lastYtResultsFull.length > 0 && m.content.includes('\uD83C\uDFAC Resultados')) {
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px';
      lastYtResultsFull.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = 'yt-play-btn';
        btn.innerHTML = '\u25B6 ' + (index + 1) + '. ' + escapeHTML(item.title);
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
    fragment.appendChild(wrapper);
  });
  container.appendChild(fragment);
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
  let html = '<h3>\uD83D\uDCDA Biblioteca</h3><p>' + files.length + '/' + CONFIG.maxFilesPerChat + ' archivo(s)</p>';
  if (!files.length) html += '<p style="color:#888">\uD83D\uDEED No hay archivos.</p>';
  files.forEach((file, index) => { html += '<div class="file"><span>\uD83D\uDCC4 ' + escapeHTML(file.nombre) + '</span><button class="danger" onclick="removeFile(' + index + ')">\uD83D\uDDD1</button></div>'; });
  html += '<button class="modalBtn" onclick="pickFiles()">\uD83D\uDCC2 Agregar archivos</button>';
  if (files.length >= CONFIG.maxFilesPerChat) {
    html += '<p style="color:#888;font-size:12px;margin-top:8px">\u26A0\uFE0F L\u00edmite de ' + CONFIG.maxFilesPerChat + ' archivos alcanzado.</p>';
  }
  modal('\uD83D\uDCDA Biblioteca', html);
}

function pickFiles() {
  const chat = currentChat();
  if ((chat.archivos || []).length >= CONFIG.maxFilesPerChat) {
    toast('\u26A0\uFE0F L\u00edmite de ' + CONFIG.maxFilesPerChat + ' archivos por chat');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true;
  input.accept = '.txt,.json,.md,.csv,.html,.pdf,.docx';
  input.onchange = e => Array.from(e.target.files || []).forEach(readFile);
  input.click();
}

async function readFile(file) {
  const chat = currentChat();
  if ((chat.archivos || []).length >= CONFIG.maxFilesPerChat) {
    toast('\u26A0\uFE0F L\u00edmite de ' + CONFIG.maxFilesPerChat + ' archivos por chat');
    return;
  }
  if (file.size > CONFIG.maxFileSize) {
    toast('\u26A0\uFE0F Archivo muy grande (m\u00e1x ' + (CONFIG.maxFileSize / 1024 / 1024) + 'MB)');
    return;
  }
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    let text = '';
    if (ext === 'pdf') {
      if (!window.pdfjsLib) throw Error('PDF');
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const pages = [];
      for (let p = 1; p <= Math.min(15, pdf.numPages); p++) {
        const pg = await pdf.getPage(p);
        const tc = await pg.getTextContent();
        pages.push(tc.items.map(i => i.str).join(' '));
      }
      text = pages.join('\n');
    } else if (ext === 'docx') {
      if (!window.mammoth) throw Error('DOCX');
      text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    } else { text = await file.text(); }
    chat.archivos.push({ nombre: file.name, contenido: String(text).slice(0, CONFIG.maxFileChars), tama\u00f1o: file.size, fecha: Date.now() });
    addMessage(chat, 'system', '\uD83D\uDCC2 ' + file.name);
    saveState(); renderMessages(); openLibrary();
  } catch (error) { toast('\u26A0\uFE0F No pude leer ' + file.name); }
}

function removeFile(index) { const chat = currentChat(); chat.archivos.splice(index, 1); saveState(); openLibrary(); }

function openSettingsSection(section) {
  let title = '', content = '';
  if (section === 'profile') {
    title = '\uD83D\uDC64 Perfil';
    content = '<div class="form"><label>Nombre</label><input id="cfgName" value="' + escapeAttribute(state.name) + '"></div><div class="form"><label>Personalidad</label><select id="cfgPersonality"><option value="JARVIS"' + (state.personality === 'JARVIS' ? ' selected' : '') + '>JARVIS \uD83D\uDD25</option><option value="Amigable"' + (state.personality === 'Amigable' ? ' selected' : '') + '>Amigable \uD83D\uDE0A</option><option value="Formal"' + (state.personality === 'Formal' ? ' selected' : '') + '>Formal \uD83C\uDFA9</option></select></div><button class="modalBtn" onclick="saveProfile()">\uD83D\uDCBE Guardar</button>';
  } else if (section === 'voice') {
    title = '\uD83C\uDF99\uFE0F Voz';
    content = '<div class="form"><label>Velocidad: <span id="rateLabel">' + state.voiceRate + '</span>x</label><input id="cfgRate" type="range" min=".5" max="2" step=".1" value="' + state.voiceRate + '" oninput="document.getElementById(\'rateLabel\').textContent=this.value"></div><div class="form"><label>Tono</label><input id="cfgPitch" type="range" min=".5" max="1.5" step=".05" value="' + state.voicePitch + '"></div><label><input id="cfgVoiceEnabled" type="checkbox"' + (state.voiceEnabled ? ' checked' : '') + '> Voz activa</label><button class="modalBtn" onclick="saveVoice()">\uD83D\uDCBE Guardar</button><button class="modalBtn" onclick="testVoice()">\uD83D\uDD0A Probar</button>';
  } else if (section === 'appearance') {
    title = '\uD83C\uDFA8 Temas';
    content = '<div class="form"><label>Tema</label><select id="cfgTheme"><option value="dark"' + (state.theme === 'dark' ? ' selected' : '') + '>Oscuro \uD83C\uDF19</option><option value="light"' + (state.theme === 'light' ? ' selected' : '') + '>Claro \u2600\uFE0F</option></select></div><div class="form"><label>Fondo</label><input id="cfgBg" value="' + escapeAttribute(state.fondo || '') + '" placeholder="URL"><button class="inlineFile" onclick="document.getElementById(\'bgFile\').click()">\uD83D\uDCC1 Imagen</button><input id="bgFile" type="file" accept="image/*" hidden onchange="loadBackgroundFile(event)"></div><button class="modalBtn" onclick="saveAppearance()">\uD83D\uDCBE Guardar</button><button class="danger" onclick="clearBackground()">\uD83D\uDDD1 Quitar fondo</button>';
  } else if (section === 'bubble') {
    title = '\uD83E\uDDE5 Burbuja';
    content = '<label><input id="cfgBubbleEnabled" type="checkbox"' + (state.bubbleEnabled ? ' checked' : '') + '> Mostrar burbuja</label><button class="modalBtn" onclick="openBubbleGifPicker()">\uD83C\uDF9E\uFE0F Seleccionar GIF</button><button class="modalBtn" onclick="saveBubble()">\uD83D\uDCBE Guardar</button><button class="danger" onclick="resetBubble()">\uD83D\uDD04 Restaurar</button>';
  } else if (section === 'memory') {
    title = '\uD83D\uDCDA Memoria';
    content = '<p style="opacity:.65;font-size:12.5px;margin-bottom:12px">Esto es lo que Aipher recuerda de ti en todas tus conversaciones, sin importar el chat. Lo va guardando solo, con criterio, mientras hablan.</p>'
      + (state.memoria.length
          ? state.memoria.map((m, i) => '<div class="chatItem"><span>' + escapeHTML(m) + '</span><button onclick="forgetMemory(' + i + ')" aria-label="Olvidar">\u2715</button></div>').join('')
          : '<p style="opacity:.5;font-size:12.5px">A\u00fan no hay nada guardado.</p>')
      + (state.memoria.length ? '<button class="danger" style="margin-top:12px" onclick="clearMemory()">\uD83D\uDDD1\uFE0F Olvidar todo</button>' : '');
  } else if (section === 'engine') {
    title = '\uD83E\uDDE0 Motor IA';
    content = '<div class="engine-option' + (state.engine === 'offline' ? ' active' : '') + '" onclick="setEngine(\'offline\')"><strong>\uD83C\uDFE0 Offline \u2014 llama.cpp</strong><small>IA local sin Internet. Requiere llama.cpp en 127.0.0.1:8080 con CORS habilitado.</small></div>'
      + '<div style="margin:14px 0 6px;opacity:.65;font-size:13px">\uD83C\uDF10 Online \u2014 elige tu motor:</div>'
      + Object.keys(PROVIDERS).map(id => {
          const active = state.engine === 'online' && state.onlineProvider === id;
          const hasKey = Boolean(state.apiKeys?.[id]);
          return '<div class="engine-option' + (active ? ' active' : '') + '" onclick="setOnlineProvider(\'' + id + '\')"><strong>' + PROVIDERS[id].label + '</strong><small>' + (hasKey ? 'Clave guardada' : 'Sin clave \u2014 ve a API Keys') + '</small></div>';
        }).join('');
  } else if (section === 'api') {
    title = '\uD83D\uDD11 API Keys';
    content = '<p style="opacity:.65;font-size:12px;margin-bottom:12px">\u26A0\uFE0F Las claves se guardan en tu navegador. No compartas tu dispositivo si contiene claves sensibles.</p>'
      + Object.keys(PROVIDERS).map(id => {
        const p = PROVIDERS[id];
        const saved = Boolean(state.apiKeys?.[id]);
        return '<div class="form"><label>' + p.label + ' Key</label><input type="password" id="cfgKey_' + id + '" placeholder="' + (saved ? 'Clave guardada' : p.keyPlaceholder) + '"></div>';
      }).join('')
      + '<div class="form"><label>YouTube Key</label><input type="password" id="cfgYT" placeholder="' + (state.youtubeKey ? 'Clave guardada' : 'AIza...') + '"></div><button class="modalBtn" onclick="saveAPI()">\uD83D\uDCBE Guardar</button>';
  } else if (section === 'data') {
    title = '\uD83D\uDCBE Datos';
    content = '<button class="modalBtn" onclick="exportData()">\uD83D\uDCE4 Exportar</button><button class="modalBtn" onclick="importData()">\uD83D\uDCE5 Importar</button><button class="danger" onclick="clearAllData()">\uD83D\uDDD1 Borrar todo</button>';
  } else {
    title = '\u2139\uFE0F Acerca';
    content = '<p style="text-align:center">\uD83D\uDD25 <strong>Aipher v' + CONFIG.version + '</strong><br>Asistente personal con IA<br>\uD83C\uDF10 Groq \u00b7 \uD83C\uDFE0 llama.cpp \u00b7 \uD83D\uDCFA YouTube<br><br><small>Las API keys se almacenan localmente en tu navegador.</small></p>';
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

function saveProfile() { state.name = $('cfgName')?.value.trim() || 'Usuario'; state.personality = $('cfgPersonality')?.value || 'JARVIS'; saveState(); renderMessages(); closeModal(); toast('\u2705 Guardado'); }
function saveVoice() { state.voiceRate = Number($('cfgRate')?.value) || 1; state.voicePitch = Number($('cfgPitch')?.value) || 1; state.voiceEnabled = Boolean($('cfgVoiceEnabled')?.checked); configureVoices(); saveState(); closeModal(); toast('\u2705 Guardado'); }
function testVoice() { 
  try { 
    speak('Hola, soy Aipher.'); 
  } catch(e) { 
    toast('\u26A0\uFE0F No hay voces disponibles en este dispositivo'); 
  } 
}
function saveAppearance() { state.theme = $('cfgTheme')?.value || 'dark'; state.fondo = $('cfgBg')?.value.trim() || ''; saveState(); applyTheme(); applyBackground(); closeModal(); toast('\u2705 Guardado'); }
function clearBackground() { state.fondo = ''; saveState(); applyBackground(); closeModal(); toast('\uD83D\uDDD1 Quitado'); }
function loadBackgroundFile(event) { 
  const file = event.target.files?.[0]; 
  if (!file) return; 
  if (file.size > CONFIG.maxFileSize) { toast('\u26A0\uFE0F Imagen muy grande (m\u00e1x 10MB)'); return; }
  const reader = new FileReader(); 
  reader.onload = e => { 
    state.fondo = e.target.result; 
    const input = $('cfgBg'); 
    if (input) input.value = state.fondo; 
    saveState(); 
    applyBackground(); 
    toast('\uD83D\uDDBC\uFE0F Aplicado'); 
  }; 
  reader.readAsDataURL(file); 
}
function applyBackground() { 
  const area = $('chatArea'); 
  if (!area) return; 
  if (!state.fondo) { area.style.backgroundImage = ''; return; }
  const img = new Image();
  img.onload = () => { area.style.backgroundImage = 'url("' + String(state.fondo).replaceAll('"', '%22') + '")'; };
  img.onerror = () => { area.style.backgroundImage = ''; toast('\u26A0\uFE0F Imagen no v\u00e1lida'); };
  img.src = state.fondo;
}
function saveAPI() {
  Object.keys(PROVIDERS).forEach(id => {
    const value = $('cfgKey_' + id)?.value.trim();
    if (value) state.apiKeys[id] = value;
  });
  const yt = $('cfgYT')?.value.trim();
  if (yt) state.youtubeKey = yt;
  saveState();
  closeModal();
  toast('\uD83D\uDD11 Guardado');
}
function exportData() { 
  const blob = new Blob([JSON.stringify({ version: CONFIG.version, state }, null, 2)], { type: 'application/json' }); 
  const url = URL.createObjectURL(blob); 
  const a = document.createElement('a'); 
  a.href = url; 
  a.download = 'aipher_' + new Date().toISOString().slice(0, 10) + '.json'; 
  document.body.appendChild(a); 
  a.click(); 
  a.remove(); 
  setTimeout(() => URL.revokeObjectURL(url), 500); 
  toast('\uD83D\uDCE4 Exportado'); 
}
function importData() { 
  const input = document.createElement('input'); 
  input.type = 'file'; 
  input.accept = '.json'; 
  input.onchange = e => { 
    const file = e.target.files?.[0]; 
    if (!file) return; 
    const reader = new FileReader(); 
    reader.onload = ev => { 
      try { 
        const data = JSON.parse(ev.target.result); 
        if (!data.state) throw Error('FORMAT'); 
        if (data.version && data.version !== CONFIG.version) {
          console.warn('Aipher: importando desde versi\u00f3n', data.version);
        }
        state = { ...cloneDefault(), ...data.state }; 
        if (!Array.isArray(state.chats)) state.chats = []; 
        if (!Array.isArray(state.recordatorios)) state.recordatorios = []; 
        if (!Array.isArray(state.notas)) state.notas = []; 
        if (!Array.isArray(state.memoria)) state.memoria = []; 
        saveState(); 
        location.reload(); 
      } catch (err) { 
        toast('\u26A0\uFE0F JSON inv\u00e1lido'); 
      } 
    }; 
    reader.readAsText(file); 
  }; 
  input.click(); 
}
function clearAllData() { 
  if (!confirm('\u00bfBorrar TODO? Esto incluye chats, memoria, ajustes y keys. No se puede deshacer.')) return; 
  localStorage.removeItem('aipher_state');
  localStorage.removeItem('aipher_bubble_pos');
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
  }
  location.reload(); 
}
function resizeComposer() { 
  const input = $('messageInput'); 
  if (!input) return; 
  input.style.height = 'auto'; 
  input.style.height = Math.min(110, input.scrollHeight) + 'px'; 
  $('charCounter').textContent = input.value.length + '/10000'; 
}
function toast(message) { 
  const el = $('toast'); 
  if (!el) return; 
  clearTimeout(toast.timer); 
  el.classList.remove('show');
  void el.offsetWidth;
  el.textContent = message; 
  el.classList.add('show'); 
  toast.timer = setTimeout(() => el.classList.remove('show'), 2300); 
}
function escapeHTML(value) { 
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'); 
}
function escapeAttribute(value) { return escapeHTML(value).replace(/"/g, '&quot;'); }
function updateConnectionStatus(offlineAvailable = null) { 
  const el = $('connectionStatus'); 
  if (!el) return; 
  if (state.engine === 'online') { 
    if (navigator.onLine === false) { 
      el.textContent = '\u26A0\uFE0F Sin conexi\u00f3n'; 
      el.classList.remove('hidden'); 
      return; 
    } 
    el.classList.add('hidden'); 
    return; 
  } 
  if (offlineAvailable === false) { 
    el.textContent = '\uD83C\uDFE0 llama.cpp no disponible'; 
    el.classList.remove('hidden'); 
  } else { 
    el.classList.add('hidden'); 
  } 
}
window.addEventListener('online', () => { if (state.engine === 'online') { updateConnectionStatus(); toast('\uD83D\uDFE2 Conectado'); } });
window.addEventListener('offline', () => { if (state.engine === 'online') { updateConnectionStatus(); toast('\u26A0\uFE0F Sin conexi\u00f3n'); } });

function registerServiceWorker() { 
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              toast('\uD83D\uDD04 Nueva versi\u00f3n disponible. Recarga para actualizar.');
            }
          });
        });
      })
      .catch(err => console.warn('SW registration failed:', err)); 
  } 
}

function initPointerDrag(element, type) { 
  if (!element) return; 
  let dragging = false, sx = 0, sy = 0, sl = 0, st = 0, moved = false; 

  element.addEventListener('pointerdown', e => { 
    if (e.target.tagName === 'IFRAME' || e.target.tagName === 'BUTTON') return; 
    dragging = true; 
    moved = false; 
    sx = e.clientX; 
    sy = e.clientY; 
    sl = element.offsetLeft; 
    st = element.offsetTop; 
    try { element.setPointerCapture(e.pointerId); } catch (err) {} 
  }); 

  element.addEventListener('pointermove', e => { 
    if (!dragging) return; 
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 5) moved = true; 
    if (!moved) return; 
    e.preventDefault(); 
    const maxX = window.innerWidth - element.offsetWidth; 
    const maxY = window.innerHeight - element.offsetHeight; 
    let nl = sl + e.clientX - sx; 
    let nt = st + e.clientY - sy; 
    nl = Math.max(0, Math.min(nl, maxX)); 
    nt = Math.max(0, Math.min(nt, maxY)); 
    element.style.left = nl + 'px'; 
    element.style.top = nt + 'px'; 
    element.style.right = 'auto'; 
    element.style.bottom = 'auto'; 
  }); 

  element.addEventListener('pointerup', () => { 
    dragging = false; 
    if (type === 'bubble' && moved) {
      bubbleDrag = true;
      const el = $('floatingAssistant');
      if (el) {
        localStorage.setItem('aipher_bubble_pos', JSON.stringify({ left: el.style.left, top: el.style.top }));
      }
    }
  }); 

  element.addEventListener('pointercancel', () => { dragging = false; }); 
}

function restoreBubblePosition() {
  try {
    const pos = JSON.parse(localStorage.getItem('aipher_bubble_pos') || 'null');
    if (pos && pos.left && pos.top) {
      const el = $('floatingAssistant');
      if (el) {
        el.style.left = pos.left;
        el.style.top = pos.top;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    }
  } catch (e) {}
}

Object.assign(window, { 
  removeFile, pickFiles, saveProfile, saveVoice, testVoice, saveAppearance, 
  clearBackground, loadBackgroundFile, saveBubble, resetBubble, openBubbleGifPicker, 
  saveAPI, exportData, importData, clearAllData, setEngine, setOnlineProvider, 
  forgetMemory, clearMemory 
});
