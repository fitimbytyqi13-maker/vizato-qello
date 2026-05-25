// ========== SOCKET & DOM SETUP ==========
const socket = io();

// Screens
const lobbyScreen = document.getElementById('lobby-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameScreen = document.getElementById('game-screen');
const gameoverOverlay = document.getElementById('gameover-overlay');

// Lobby elements
const nameCreateInput = document.getElementById('name-create');
const nameJoinInput = document.getElementById('name-join');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');

// Lobby settings toggle
const lobbySettingsToggle = document.getElementById('lobby-settings-toggle');
const lobbySettingsPanel = document.getElementById('lobby-settings-panel');
if (lobbySettingsToggle) {
  lobbySettingsToggle.addEventListener('click', () => {
    lobbySettingsPanel.style.display = lobbySettingsPanel.style.display === 'none' ? 'block' : 'none';
  });
}

// Waiting elements
const roomCodeDisplay = document.getElementById('room-code-display');
const waitingPlayers = document.getElementById('waiting-players');
const btnStart = document.getElementById('btn-start');
const waitingStatus = document.getElementById('waiting-status');

// Game elements
const gameRound = document.getElementById('game-round');
const gameTimer = document.getElementById('game-timer');
const gamePlayers = document.getElementById('game-players');
const wordDisplay = document.getElementById('word-display');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const drawTools = document.getElementById('draw-tools');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const btnClearCanvas = document.getElementById('btn-clear-canvas');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');

// Game Over elements
const rankingsList = document.getElementById('rankings-list');
const btnPlayAgain = document.getElementById('btn-play-again');

// ========== STATE ==========
let currentRoom = null;
let isDrawing = false;
let isMyTurn = false;
let isHost = false;
let currentWordLength = 0;
let hintRevealed = {};
let lastX = 0;
let lastY = 0;
let currentColor = '#111827';
let currentSize = 4;
let currentTool = 'pen'; // pen | eraser

const COLOR_PRESETS = [
  '#111827','#ffffff','#ef4444','#f97316',
  '#eab308','#22c55e','#3b82f6','#6366f1',
  '#a855f7','#ec4899','#6b7280','#92400e'
];

// ========== HELPER FUNCTIONS ==========

// Switch visible screen
function showScreen(screen) {
  lobbyScreen.classList.remove('active');
  waitingScreen.classList.remove('active');
  gameScreen.classList.remove('active');
  screen.classList.add('active');
}

// Add chat message to the chat box
function addChatMessage(type, text, name) {
  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;

  if (type === 'guess' && name) {
    div.innerHTML = `<span class="msg-name">${name}:</span> ${text}`;
  } else {
    div.textContent = text;
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Render player list in a container
function renderPlayers(container, players) {
  container.innerHTML = '';
  const isWaiting = container === waitingPlayers;
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = `player-item${p.isDrawing ? ' drawing' : ''}`;
    const isKickable = isWaiting && isHost && p.id !== socket.id;
    div.innerHTML = `
      <span class="player-name">${p.isDrawing ? '🎨 ' : ''}${p.name}</span>
      <span class="player-score">${p.score}</span>
      ${isKickable ? '<button class="kick-btn" title="Perjashto">&times;</button>' : ''}
    `;
    const kickBtn = div.querySelector('.kick-btn');
    if (kickBtn) {
      kickBtn.addEventListener('click', () => {
        socket.emit('kick-player', { playerId: p.id });
      });
    }
    container.appendChild(div);
  });
}

// Show word as blanks (underscores)
function showWordBlanks(length) {
  currentWordLength = length;
  hintRevealed = {};
  wordDisplay.textContent = '_ '.repeat(length).trim();
}

function updateWordDisplayWithHints() {
  let display = '';
  for (let i = 0; i < currentWordLength; i++) {
    display += (hintRevealed[i] !== undefined ? hintRevealed[i] : '_') + ' ';
  }
  wordDisplay.textContent = display.trim();
}

// Show actual word (for drawer)
function showWord(word) {
  wordDisplay.textContent = word;
  wordDisplay.style.color = 'var(--accent)';
}

// Reset word display
function resetWordDisplay() {
  wordDisplay.textContent = '';
  wordDisplay.style.color = 'var(--secondary)';
}

// ========== LOBBY EVENTS ==========

// Create Room
btnCreate.addEventListener('click', () => {
  const name = nameCreateInput.value.trim();
  if (!name) {
    alert('Shkruaj emrin tënd!');
    return;
  }
  socket.emit('create-room', {
    name,
    settings: {
      rounds: parseInt(document.getElementById('set-rounds').value) || 3,
      time: parseInt(document.getElementById('set-time').value) || 60,
      maxPlayers: parseInt(document.getElementById('set-maxplayers').value) || 8
    }
  });
});

// Join Room
btnJoin.addEventListener('click', () => {
  const name = nameJoinInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name) {
    alert('Shkruaj emrin tënd!');
    return;
  }
  if (!code) {
    alert('Shkruaj kodin e dhomës!');
    return;
  }
  socket.emit('join-room', { name, code });
});

// Enter key support
nameCreateInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnCreate.click();
});
nameJoinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') roomCodeInput.focus();
});
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

// ========== SOCKET: LOBBY RESPONSES ==========

// Room created successfully
socket.on('room-created', (data) => {
  currentRoom = data.code;
  isHost = true;
  roomCodeDisplay.textContent = data.code;
  renderPlayers(waitingPlayers, data.players);
  document.getElementById('custom-words-section').style.display = 'block';
  showScreen(waitingScreen);
});

// Room joined successfully
socket.on('room-joined', (data) => {
  currentRoom = data.code;
  isHost = false;
  roomCodeDisplay.textContent = data.code;
  renderPlayers(waitingPlayers, data.players);
  btnStart.style.display = 'none'; // only host sees start
  showScreen(waitingScreen);
});

// New player joined the room
socket.on('player-joined', (data) => {
  renderPlayers(waitingPlayers, data.players);
  if (gameScreen.classList.contains('active')) {
    renderPlayers(gamePlayers, data.players);
  }
});

// Start game button
btnStart.addEventListener('click', () => {
  socket.emit('start-game');
});

// Custom words toggle
const customWordsToggle = document.getElementById('custom-words-toggle');
const customWordsPanel = document.getElementById('custom-words-panel');
const customWordsInput = document.getElementById('custom-words-input');
const btnSaveCustomWords = document.getElementById('btn-save-custom-words');

if (customWordsToggle) {
  customWordsToggle.addEventListener('click', () => {
    customWordsPanel.style.display = customWordsPanel.style.display === 'none' ? 'block' : 'none';
  });
}
if (btnSaveCustomWords) {
  btnSaveCustomWords.addEventListener('click', () => {
    socket.emit('set-custom-words', { words: customWordsInput.value });
  });
}

// ========== SOCKET: GAME EVENTS ==========

// Game started
socket.on('game-started', (data) => {
  gameRound.textContent = 'Raundi: ' + data.round + ' / ' + (data.maxRounds || 3);
  renderPlayers(gamePlayers, data.players);
  resetWordDisplay();
  showScreen(gameScreen);
  SoundFX.playStart();
});

// Your turn to draw
socket.on('your-turn', (data) => {
  isMyTurn = true;
  hintRevealed = {};
  drawTools.style.display = 'flex';
  chatInput.disabled = true;
  chatInput.placeholder = 'Ti po vizaton...';
  showWord(data.word);
  gameRound.textContent = 'Raundi: ' + data.round + ' / ' + data.maxRounds;
});

// Someone else's turn started
socket.on('turn-started', (data) => {
  if (!isMyTurn) {
    drawTools.style.display = 'none';
    chatInput.disabled = false;
    chatInput.placeholder = 'Shkruaj përgjigjen...';
    showWordBlanks(data.wordLength);
  }
  gameRound.textContent = 'Raundi: ' + data.round + ' / ' + data.maxRounds;
  renderPlayers(gamePlayers, data.players);
});

// Timer update
socket.on('timer-update', (data) => {
  gameTimer.textContent = `${data.timeLeft}s`;

  // Flash red when low
  if (data.timeLeft <= 10) {
    gameTimer.style.animation = 'none';
    gameTimer.offsetHeight; // trigger reflow
    gameTimer.style.background = data.timeLeft % 2 === 0 ? 'var(--danger)' : '#FF3333';
    if (data.timeLeft > 0) SoundFX.playTick();
  } else {
    gameTimer.style.background = '';
  }
});

// Turn ended
socket.on('turn-ended', (data) => {
  isMyTurn = false;
  drawTools.style.display = 'none';
  chatInput.disabled = false;
  chatInput.placeholder = 'Shkruaj përgjigjen...';
  resetWordDisplay();
  wordDisplay.textContent = `Fjala: ${data.word}`;
  renderPlayers(gamePlayers, data.players);
});

// Someone guessed correctly
socket.on('correct-guess', (data) => {
  renderPlayers(gamePlayers, data.players);
  SoundFX.playCorrect();

  // Animate score change
  const items = document.querySelectorAll('#game-players .player-item');
  items.forEach(item => {
    const nameSpan = item.querySelector('.player-name');
    if (!nameSpan) return;
    const name = nameSpan.textContent.replace('🎨 ', '').trim();
    const scoreEl = item.querySelector('.player-score');
    if (!scoreEl) return;
    const gainSpan = document.createElement('span');
    gainSpan.className = 'score-gain';
    if (name === data.name) {
      gainSpan.textContent = `+${data.points}`;
    } else if (data.drawerName && name === data.drawerName) {
      gainSpan.textContent = `+${data.drawerPoints}`;
    } else {
      return;
    }
    item.classList.add('score-flash');
    scoreEl.appendChild(gainSpan);
    setTimeout(() => {
      item.classList.remove('score-flash');
      if (gainSpan.parentNode) gainSpan.remove();
    }, 1500);
  });
});

// Chat message
socket.on('chat-message', (data) => {
  addChatMessage(data.type, data.text, data.name || '');
});

// Hint revealed
socket.on('hint', (data) => {
  data.letters.forEach(l => { hintRevealed[l.position] = l.letter; });
  if (!isMyTurn) updateWordDisplayWithHints();
});

// Wrong guess (own guess was incorrect)
socket.on('wrong-guess', () => {
  SoundFX.playWrong();
});

// Kicked from room
socket.on('kicked', () => {
  alert('Je perjashtuar nga dhoma.');
  currentRoom = null;
  isHost = false;
  showScreen(lobbyScreen);
});

// Error message
socket.on('error-message', (msg) => {
  alert(msg);
});

// ========== CANVAS DRAWING ==========

// Get mouse position relative to canvas
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

// Draw a line segment
function drawLine(x1, y1, x2, y2, color, size) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// Flood fill (bucket tool)
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : { r:0,g:0,b:0 };
}
function floodFill(startX, startY, fillHex) {
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const si = (Math.floor(startY) * w + Math.floor(startX)) * 4;
  const tR = d[si], tG = d[si+1], tB = d[si+2];
  const fill = hexToRgb(fillHex);
  if (tR === fill.r && tG === fill.g && tB === fill.b) return;
  const TOL = 12;
  const visited = new Uint8Array(w * h);
  const stack = [{ x: Math.floor(startX), y: Math.floor(startY) }];
  while (stack.length) {
    const {x, y} = stack.pop();
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx]) continue;
    const pi = idx * 4;
    if (Math.abs(d[pi]-tR) > TOL || Math.abs(d[pi+1]-tG) > TOL || Math.abs(d[pi+2]-tB) > TOL) continue;
    visited[idx] = 1;
    d[pi] = fill.r; d[pi+1] = fill.g; d[pi+2] = fill.b; d[pi+3] = 255;
    stack.push({x: x+1, y}, {x: x-1, y}, {x, y: y+1}, {x, y: y-1});
  }
  ctx.putImageData(imgData, 0, 0);
}

// Mouse down — start drawing
canvas.addEventListener('mousedown', (e) => {
  if (!isMyTurn) return;
  if (currentTool === 'bucket') {
    const pos = getCanvasPos(e);
    saveSnapshot();
    floodFill(pos.x, pos.y, currentColor);
    socket.emit('fill', { x: pos.x, y: pos.y, color: currentColor });
    return;
  }
  isDrawing = true;
  const pos = getCanvasPos(e);
  lastX = pos.x;
  lastY = pos.y;
});

// Mouse move — draw
canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing || !isMyTurn) return;
  const pos = getCanvasPos(e);

  drawLine(lastX, lastY, pos.x, pos.y, currentColor, currentSize);

  socket.emit('draw', {
    x1: lastX,
    y1: lastY,
    x2: pos.x,
    y2: pos.y,
    color: currentColor,
    size: currentSize
  });

  lastX = pos.x;
  lastY = pos.y;
});

// Mouse up — stop drawing
canvas.addEventListener('mouseup', () => {
  isDrawing = false;
});

canvas.addEventListener('mouseleave', () => {
  isDrawing = false;
});

// ========== TOUCH SUPPORT (Mobile) ==========
canvas.addEventListener('touchstart', (e) => {
  if (!isMyTurn) return;
  e.preventDefault();
  if (currentTool === 'bucket') {
    const touch = e.touches[0];
    const pos = getCanvasPos(touch);
    saveSnapshot();
    floodFill(pos.x, pos.y, currentColor);
    socket.emit('fill', { x: pos.x, y: pos.y, color: currentColor });
    return;
  }
  isDrawing = true;
  const touch = e.touches[0];
  const pos = getCanvasPos(touch);
  lastX = pos.x;
  lastY = pos.y;
});

canvas.addEventListener('touchmove', (e) => {
  if (!isDrawing || !isMyTurn) return;
  e.preventDefault();
  const touch = e.touches[0];
  const pos = getCanvasPos(touch);

  drawLine(lastX, lastY, pos.x, pos.y, currentColor, currentSize);

  socket.emit('draw', {
    x1: lastX,
    y1: lastY,
    x2: pos.x,
    y2: pos.y,
    color: currentColor,
    size: currentSize
  });

  lastX = pos.x;
  lastY = pos.y;
});

canvas.addEventListener('touchend', () => {
  isDrawing = false;
});

// Receive drawing from other players
socket.on('draw', (data) => {
  drawLine(data.x1, data.y1, data.x2, data.y2, data.color, data.size);
});

// Receive fill from other players
socket.on('fill', (data) => {
  floodFill(data.x, data.y, data.color);
});

// Clear canvas
socket.on('clear-canvas', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ========== DRAWING TOOLS ==========

// ---- Helper: apply current tool style ----
function applyToolStyle() {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = currentSize;
  ctx.strokeStyle = (currentTool === 'eraser') ? '#ffffff' : currentColor;
}

// ---- Set active tool ----
function setActiveTool(tool) {
  currentTool = tool;
  applyToolStyle();
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tool="${tool}"]`);
  if (btn) btn.classList.add('active');
}

// ---- Build color palette dynamically ----
function buildColorPalette() {
  const palette = document.getElementById('color-palette');
  if (!palette) return;
  palette.innerHTML = '';
  COLOR_PRESETS.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch';
    btn.style.background = color;
    btn.dataset.color = color;
    if (color === currentColor) btn.classList.add('active');
    btn.addEventListener('click', () => {
      currentColor = color;
      currentTool = 'pen';
      applyToolStyle();
      if (colorPicker) colorPicker.value = color;
      document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setActiveTool('pen');
    });
    palette.appendChild(btn);
  });
}
buildColorPalette();

// Color picker (custom color)
if (colorPicker) {
  colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
    currentTool = 'pen';
    applyToolStyle();
    document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
    setActiveTool('pen');
  });
}

// Tool buttons (pen, eraser)
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveTool(btn.dataset.tool);
  });
});

// Brush size buttons
document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentSize = parseInt(btn.dataset.size);
    applyToolStyle();
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Legacy range input (if still present)
if (typeof brushSize !== 'undefined' && brushSize && brushSize.tagName === 'INPUT') {
  brushSize.addEventListener('input', (e) => {
    currentSize = parseInt(e.target.value);
    applyToolStyle();
  });
}

// Undo stack
let undoStack = [];
function saveSnapshot() {
  if (undoStack.length > 20) undoStack.shift();
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
canvas.addEventListener('mousedown', () => { if (isMyTurn) saveSnapshot(); }, true);

const btnUndo = document.getElementById('btn-undo');
if (btnUndo) {
  btnUndo.addEventListener('click', () => {
    if (!isMyTurn || undoStack.length === 0) return;
    const snap = undoStack.pop();
    ctx.putImageData(snap, 0, 0);
    socket.emit('clear-canvas');
  });
}

// Save drawing button
const btnSave = document.getElementById('btn-save');
if (btnSave) {
  btnSave.addEventListener('click', () => {
    if (!isMyTurn) return;
    const link = document.createElement('a');
    link.download = `vizatimi-${currentRoom}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

// Clear canvas button
btnClearCanvas.addEventListener('click', () => {
  if (!isMyTurn) return;
  undoStack = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear-canvas');
});

// ========== CHAT / GUESSING ==========

// Send guess
function sendGuess() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('send-guess', { text });
  chatInput.value = '';
}

btnSend.addEventListener('click', sendGuess);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendGuess();
});

// ========== ROUND SUMMARY ==========
const roundSummaryOverlay = document.getElementById('round-summary-overlay');
const roundSummaryContent = document.getElementById('round-summary-content');

socket.on('round-summary', (data) => {
  let guesserHtml = '';
  if (data.guessers.length > 0) {
    guesserHtml = `<p>E qelluan: <strong>${data.guessers.join(', ')}</strong></p>
                   <p>Vizatuesi fitoi: +${data.drawerGain} pike</p>`;
  } else {
    guesserHtml = `<p>Askush nuk e qelloi fjalen.</p>`;
  }
  roundSummaryContent.innerHTML = `
    <h3>Raundi Perfundoi!</h3>
    <p>Fjala: <strong>${data.word}</strong></p>
    <p>Vizatoi: ${data.drawer}</p>
    ${guesserHtml}
  `;
  roundSummaryOverlay.classList.remove('hidden');
  setTimeout(() => { roundSummaryOverlay.classList.add('hidden'); }, 3000);
});

// ========== GAME OVER ==========

socket.on('game-over', (data) => {
  gameoverOverlay.classList.remove('hidden');
  SoundFX.playGameOver();

  rankingsList.innerHTML = '';
  data.rankings.forEach(r => {
    const div = document.createElement('div');
    div.className = 'rank-item';
    div.innerHTML = `
      <span class="rank-position">#${r.rank}</span>
      <span class="rank-name">${r.name}</span>
      <span class="rank-score">${r.score} pikë</span>
    `;
    rankingsList.appendChild(div);
  });
});

// Play again
btnPlayAgain.addEventListener('click', () => {
  gameoverOverlay.classList.add('hidden');
  showScreen(waitingScreen);
});

// ========== SOUND EFFECTS ==========
const SoundFX = {
  ctx: null,
  getCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, type, duration, volume, startDelay) {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = type;
      const t = ctx.currentTime + (startDelay || 0);
      gain.gain.setValueAtTime(volume || 0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + duration);
      osc.start(t); osc.stop(t + duration);
    } catch(e) { /* ignore audio errors */ }
  },
  playTick()    { this.tone(800, 'sine', 0.08, 0.15); },
  playCorrect() {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 'sine', 0.35, 0.25, i * 0.12));
  },
  playWrong()   { this.tone(200, 'sawtooth', 0.25, 0.15); },
  playStart() {
    [261.63, 329.63, 392.0, 523.25].forEach((f, i) => this.tone(f, 'sine', 0.4, 0.25, i * 0.15));
  },
  playGameOver() {
    [523.25, 466.16, 392.0, 349.23].forEach((f, i) => this.tone(f, 'triangle', 0.5, 0.25, i * 0.2));
  }
};

function initAudio() { SoundFX.getCtx(); }
btnCreate.addEventListener('click', initAudio, { once: true });
btnJoin.addEventListener('click', initAudio, { once: true });

// ========== INIT ==========

// Hide draw tools initially
drawTools.style.display = 'none';

// Fill canvas white initially
ctx.fillStyle = '#FFFFFF';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '';
