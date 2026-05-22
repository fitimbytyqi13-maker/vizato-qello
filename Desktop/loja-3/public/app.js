// ========== SOCKET & DOM SETUP ==========
const socket = io();

// Screens
const lobbyScreen = document.getElementById('lobby-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameScreen = document.getElementById('game-screen');
const gameoverOverlay = document.getElementById('gameover-overlay');

// Lobby elements
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');

// Waiting elements
const roomCodeDisplay = document.getElementById('room-code-display');
const waitingPlayers = document.getElementById('waiting-players');
const btnStart = document.getElementById('btn-start');
const waitingStatus = document.getElementById('waiting-status');

// Settings elements
const settingsPanel = document.getElementById('settings-panel');
const settingRounds = document.getElementById('setting-rounds');
const settingTime = document.getElementById('setting-time');
const settingPlayers = document.getElementById('setting-players');

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
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = `player-item${p.isDrawing ? ' drawing' : ''}`;
    div.innerHTML = `
      <span class="player-name">${p.isDrawing ? '🎨 ' : ''}${p.name}</span>
      <span class="player-score">${p.score}</span>
    `;
    container.appendChild(div);
  });
}

// Show word as blanks (underscores)
function showWordBlanks(length) {
  wordDisplay.textContent = '_ '.repeat(length).trim();
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
  const name = playerNameInput.value.trim();
  if (!name) {
    alert('Shkruaj emrin tënd!');
    return;
  }
  socket.emit('create-room', { name });
});

// Helper: read current settings from the panel
function getSettings() {
  return {
    rounds: parseInt(settingRounds.value) || 3,
    time: parseInt(settingTime.value) || 60,
    maxPlayers: parseInt(settingPlayers.value) || 8
  };
}

// Join Room
btnJoin.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
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
playerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnCreate.click();
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

// ========== SOCKET: LOBBY RESPONSES ==========

// Room created successfully
socket.on('room-created', (data) => {
  currentRoom = data.code;
  roomCodeDisplay.textContent = data.code;
  renderPlayers(waitingPlayers, data.players);
  btnStart.style.display = '';
  settingsPanel.style.display = '';
  showScreen(waitingScreen);
});

// Room joined successfully
socket.on('room-joined', (data) => {
  currentRoom = data.code;
  roomCodeDisplay.textContent = data.code;
  renderPlayers(waitingPlayers, data.players);
  btnStart.style.display = 'none';
  settingsPanel.style.display = 'none'; // only host sees settings
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
  socket.emit('start-game', { settings: getSettings() });
});

// ========== SOCKET: GAME EVENTS ==========

// Game started
socket.on('game-started', (data) => {
  gameRound.textContent = 'Raundi: ' + data.round + ' / ' + (data.maxRounds || 3);
  renderPlayers(gamePlayers, data.players);
  resetWordDisplay();
  showScreen(gameScreen);
});

// Your turn to draw
socket.on('your-turn', (data) => {
  isMyTurn = true;
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
});

// Chat message
socket.on('chat-message', (data) => {
  addChatMessage(data.type, data.text, data.name || '');
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

// Mouse down — start drawing
canvas.addEventListener('mousedown', (e) => {
  if (!isMyTurn) return;
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

// ========== GAME OVER ==========

socket.on('game-over', (data) => {
  gameoverOverlay.classList.remove('hidden');

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

// ========== INIT ==========

// Hide draw tools initially
drawTools.style.display = 'none';

// Fill canvas white initially
ctx.fillStyle = '#FFFFFF';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '';
