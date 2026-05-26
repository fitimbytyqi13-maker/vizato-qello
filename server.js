const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ========== APP SETUP ==========
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// ========== GAME CONFIG ==========
const ROUND_TIME = 60;        // seconds per turn
const MAX_ROUNDS = 3;         // rounds per game
const MAX_PLAYERS = 8;        // max players per room
const POINTS_CORRECT = 100;   // points for guessing correctly (max, time-scaled)
const POINTS_DRAWER = 50;     // base points for drawer when someone guesses (more with time bonus)
const POINTS_DRAWER_BASE = 25; // base points for drawer just for completing their turn
const HINT_DELAY = 10;        // seconds before first hint

// ========== WORD LIST (Albanian) ==========
const words = [
  // Kosovar / Gheg everyday words
  'shpi', 'diell', 'lule', 'det', 'mal',
  'qen', 'mace', 'liber', 'shkoll', 'top',
  'makine', 'aeroplan', 'anije', 'yll', 'hane',
  'shi', 'bore', 'zjarr', 'uje', 'dore',
  'sy', 'zemer', 'peshk', 'zog', 'rruge',
  'ure', 'kulle', 'kal', 'molle', 'dardhe',
  'rrush', 'buke', 'djath', 'kafe', 'caj',
  'akullore', 'torte', 'pice', 'burek', 'fli',
  // Kosovar cities & landmarks
  'prishtine', 'mitrovice', 'peje', 'gjakove', 'prizren',
  'ferizaj', 'gjilan', 'vushtrri', 'therande', 'rahovec',
  'xhami', 'kishe', 'pazar', 'stadium', 'autobus',
  // Modern objects
  'telefon', 'kompjuter', 'tavoline', 'karrige', 'dritare',
  'der', 'cati', 'ballkon', 'oborr', 'kopsht',
  // Food (Kosovar cuisine)
  'mjalt', 'qumsht', 've', 'mish', 'patate',
  'domate', 'speca', 'sallate', 'supe', 'pastic',
  'qebap', 'plleskavice', 'suxhuk', 'petlla', 'leqenik',
  'pite', 'bakllave', 'halla', 'qaj', 'kos',
  // Nature & geography
  'bjeshke', 'fushe', 'lum', 'gur', 'dru',
  'lis', 'pylle', 'bar', 'kodre', 'liqe',
  'shpell', 'bredh', 'ujvar', 'gazivode', 'brezovice',
  // Body parts
  'krye', 'kamb', 'gisht', 'vesh', 'hun',
  'flok', 'dhemb', 'gju', 'boll', 'qafe',
  // Actions
  'vrap', 'kercim', 'valle', 'kembe', 'loje',
  'pushim', 'gjum', 'kange', 'muzike', 'film',
  // Gheg-specific words
  'nuse', 'dhenderr', 'cun', 'vajze', 'plak',
  'tavhan', 'shkall', 'oxhak', 'bunar', 'mahall',
  'carshije', 'hamam', 'kulle', 'bajrak', 'kulle',
  'dasem', 'flamur', 'shqipe', 'dashni', 'vllau',
  // More everyday items
  'filxhan', 'ibrik', 'tepsi', 'tenxhere', 'lug',
  'pirun', 'thike', 'pjat', 'got', 'sahan',
  'cante', 'or', 'unaze', 'gjerdan', 'shall',
  'tirq', 'plis', 'qeleshe', 'xhybe', 'opal'
];

// ========== ROOMS STORAGE ==========
const rooms = {};

// ========== HELPER FUNCTIONS ==========

// Pick a random word from the list
function getRandomWord() {
  return words[Math.floor(Math.random() * words.length)];
}

// Generate a short room code
// Generate a simple 4-digit room code
function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Get a room by player socket ID
function getRoomByPlayer(socketId) {
  for (const code in rooms) {
    const room = rooms[code];
    if (room.players.some(p => p.id === socketId)) {
      return room;
    }
  }
  return null;
}

// Get player object by socket ID
function getPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId);
}

// Player color palette
const PLAYER_COLORS = [
  '#EF4444','#F97316','#EAB308','#22C55E','#3B82F6',
  '#6366F1','#A855F7','#EC4899','#14B8A6','#F43F5E',
  '#8B5CF6','#06B6D4','#84CC16','#F59E0B','#0EA5E9','#D946EF'
];
let colorIndex = 0;

function assignPlayerColor() {
  const c = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  colorIndex++;
  return c;
}

// Check if guess is close to the word
function isCloseGuess(guess, word) {
  if (guess.length < 2 || word.length < 2) return false;
  // Shared prefix of 3+ chars
  const minLen = Math.min(guess.length, word.length);
  let matchCount = 0;
  for (let i = 0; i < minLen; i++) {
    if (guess[i] === word[i]) matchCount++;
    else break;
  }
  if (matchCount >= 3 && guess.length >= word.length - 2) return true;
  // One is substring of the other
  if (word.includes(guess) && guess.length >= 3) return true;
  if (guess.includes(word) && word.length >= 3) return true;
  // Edit distance check (simple cheap approach: diff in length + char mismatch)
  const lenDiff = Math.abs(guess.length - word.length);
  let mismatches = 0;
  for (let i = 0; i < minLen; i++) {
    if (guess[i] !== word[i]) mismatches++;
  }
  if (lenDiff <= 1 && mismatches <= 1) return true;
  if (lenDiff <= 2 && mismatches <= 2 && guess.length >= 3) return true;
  return false;
}

// Get current drawer
function getCurrentDrawer(room) {
  return room.players[room.drawerIndex] || null;
}

// Build safe player list (no sensitive data)
function getPlayerList(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    color: p.color,
    isDrawing: room.players[room.drawerIndex]?.id === p.id
  }));
}

// Clear room timer
function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
  if (room.hintTimer) {
    clearTimeout(room.hintTimer);
    clearInterval(room.hintTimer);
    room.hintTimer = null;
  }
}

// ========== GAME LOGIC ==========

// Helper: pick N unique random words from the pool
function pickRandomWords(room, count) {
  let wordPool = [...words];
  if (room.customWords && room.customWords.length > 0) {
    wordPool = wordPool.concat(room.customWords);
  }
  const picked = [];
  const used = new Set();
  for (let i = 0; i < count && used.size < wordPool.length; i++) {
    let w;
    do { w = wordPool[Math.floor(Math.random() * wordPool.length)]; }
    while (used.has(w));
    used.add(w);
    picked.push(w);
  }
  return picked;
}

// Start a new turn — Phase 1: let drawer pick a word
function startTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.players.length < 2) return;

  clearRoomTimer(room);

  // Pick 3 random words for the drawer to choose from
  const wordOptions = pickRandomWords(room, 3);
  room._wordOptions = wordOptions;
  room.currentWord = null;
  room.guessedPlayers = [];
  room.hintRevealed = [];
  room._drawerEarnedThisTurn = 0;

  const drawer = getCurrentDrawer(room);
  if (!drawer) return;

  // Tell the drawer to pick a word
  io.to(drawer.id).emit('your-turn', {
    words: wordOptions,
    round: room.currentRound,
    maxRounds: room.settings ? room.settings.rounds : MAX_ROUNDS
  });

  // Tell everyone else the drawer is choosing
  io.to(roomCode).emit('turn-started', {
    drawer: drawer.name,
    wordLength: 0, // 0 means "choosing"
    players: getPlayerList(room),
    round: room.currentRound,
    maxRounds: room.settings ? room.settings.rounds : MAX_ROUNDS
  });

  io.to(roomCode).emit('chat-message', {
    type: 'system',
    text: `${drawer.name} po zgjedh nje fjale...`
  });

  io.to(roomCode).emit('clear-canvas');
}

// Phase 2: drawer picked a word — start the actual turn
function beginTurnWithWord(roomCode, chosenWord) {
  const room = rooms[roomCode];
  if (!room || room.players.length < 2) return;

  room.currentWord = chosenWord;
  room.timeLeft = room.settings ? room.settings.time : ROUND_TIME;

  // Schedule progressive hint reveals
  clearTimeout(room.hintTimer);
  clearInterval(room.hintTimer);

  const wordLen = room.currentWord.length;
  const lettersToReveal = Math.floor(wordLen / 2) + 1;
  const hintInterval = 4;

  room.hintTimer = setTimeout(() => {
    if (!rooms[roomCode] || !rooms[roomCode].gameStarted) return;

    let revealed = 0;
    room.hintTimer = setInterval(() => {
      const r = rooms[roomCode];
      if (!r || !r.gameStarted) {
        clearInterval(room.hintTimer);
        room.hintTimer = null;
        return;
      }

      const word = r.currentWord;
      const available = word.split('').map((_, i) => i)
        .filter(i => !r.hintRevealed.includes(i));

      if (available.length === 0 || revealed >= lettersToReveal) {
        clearInterval(r.hintTimer);
        r.hintTimer = null;
        return;
      }

      const idx = available[Math.floor(Math.random() * available.length)];
      r.hintRevealed.push(idx);
      revealed++;

      io.to(roomCode).emit('hint', {
        letters: [{ position: idx, letter: word[idx] }]
      });
      io.to(roomCode).emit('chat-message', {
        type: 'system',
        text: `Hint: shkronja "${word[idx]}" u zbulua! (${r.hintRevealed.length}/${wordLen})`
      });
    }, hintInterval * 1000);
  }, HINT_DELAY * 1000);

  const drawer = getCurrentDrawer(room);
  if (!drawer) return;

  // Confirm the word to the drawer
  io.to(drawer.id).emit('word-confirmed', {
    word: room.currentWord
  });

  // Tell everyone else the turn has started
  io.to(roomCode).emit('turn-started', {
    drawer: drawer.name,
    wordLength: room.currentWord.length,
    players: getPlayerList(room),
    round: room.currentRound,
    maxRounds: room.settings ? room.settings.rounds : MAX_ROUNDS
  });

  io.to(roomCode).emit('chat-message', {
    type: 'system',
    text: `${drawer.name} zgjodhi fjalen! Fillo te vizatosh!`
  });

  // Start countdown timer
  room.timer = setInterval(() => {
    room.timeLeft--;

    io.to(roomCode).emit('timer-update', {
      timeLeft: room.timeLeft
    });

    if (room.timeLeft <= 0) {
      endTurn(roomCode, false);
    }
  }, 1000);
}

// End current turn
function endTurn(roomCode, allGuessed) {
  const room = rooms[roomCode];
  if (!room) return;

  clearRoomTimer(room);

  // Reveal the word
  const reason = allGuessed
    ? 'Të gjithë e qëlluan!'
    : `Koha u kry! Fjala ka qenë: ${room.currentWord}`;

  io.to(roomCode).emit('turn-ended', {
    word: room.currentWord,
    message: reason,
    players: getPlayerList(room)
  });

  io.to(roomCode).emit('chat-message', {
    type: 'system',
    text: reason
  });

  // Send round summary
  const endDrawer = getCurrentDrawer(room);
  const endDrawerName = endDrawer ? endDrawer.name : '';
  const guessedNames = room.guessedPlayers.map(id => {
    const p = getPlayer(room, id);
    return p ? p.name : '';
  }).filter(Boolean);
  let drawerGain = room._drawerEarnedThisTurn || 0;

  // Award base points to drawer for completing their turn, even if nobody guessed
  if (drawerGain === 0 && endDrawer) {
    endDrawer.score += POINTS_DRAWER_BASE;
    drawerGain = POINTS_DRAWER_BASE;
  }

  io.to(roomCode).emit('round-summary', {
    word: room.currentWord,
    drawer: endDrawerName,
    drawerGain: drawerGain,
    guessers: guessedNames
  });

  // Move to next drawer
  room.drawerIndex++;

  // Check if round is over (everyone drew)
  if (room.drawerIndex >= room.players.length) {
    room.drawerIndex = 0;
    room.currentRound++;

    // Check if game is over
    if (room.currentRound > (room.settings ? room.settings.rounds : MAX_ROUNDS)) {
      endGame(roomCode);
      return;
    }

    io.to(roomCode).emit('chat-message', {
      type: 'system',
      text: `Raundi ${room.currentRound} filloi!`
    });
  }

  // Start next turn after a short delay
  setTimeout(() => {
    startTurn(roomCode);
  }, 3000);
}

// End the game
function endGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  clearRoomTimer(room);
  room.gameStarted = false;

  // Sort players by score
  const rankings = room.players
    .slice()
    .sort((a, b) => b.score - a.score);

  io.to(roomCode).emit('game-over', {
    rankings: rankings.map((p, i) => ({
      rank: i + 1,
      name: p.name,
      score: p.score
    }))
  });

  // Reset scores
  room.players.forEach(p => { p.score = 0; });
  room.currentRound = 1;
  room.drawerIndex = 0;
}

// ========== SOCKET EVENTS ==========

io.on('connection', (socket) => {
  console.log(`Lidhje e re: ${socket.id}`);

  // --- CREATE ROOM ---
  socket.on('create-room', (data) => {
    const name = data.name?.trim();
    if (!name) {
      socket.emit('error-message', 'Shkruaj emrin tënd.');
      return;
    }

    const cfg = (data.settings && typeof data.settings === 'object') ? data.settings : {};
    const roomRounds     = parseInt(cfg.rounds)     || MAX_ROUNDS;
    const roomTime       = parseInt(cfg.time)       || ROUND_TIME;
    const roomMaxPlayers = parseInt(cfg.maxPlayers) || MAX_PLAYERS;

    const code = generateRoomCode();

    rooms[code] = {
      code: code,
      host: socket.id,
      settings: { rounds: roomRounds, time: roomTime, maxPlayers: roomMaxPlayers },
      players: [{
        id: socket.id,
        name: name,
        score: 0,
        color: assignPlayerColor()
      }],
      gameStarted: false,
      customWords: [],
      currentWord: null,
      currentRound: 1,
      drawerIndex: 0,
      guessedPlayers: [],
      hintRevealed: [],
      hintTimer: null,
      timeLeft: roomTime,
      timer: null
    };

    socket.join(code);

    socket.emit('room-created', {
      code: code,
      players: getPlayerList(rooms[code])
    });

    console.log(`Dhoma ${code} u krijua nga ${name}`);
  });

  // --- JOIN ROOM ---
  socket.on('join-room', (data) => {
    const name = data.name?.trim();
    const code = data.code?.trim();

    if (!name) {
      socket.emit('error-message', 'Shkruaj emrin tënd.');
      return;
    }
    if (!code || !rooms[code]) {
      socket.emit('error-message', 'Dhoma nuk ekziston.');
      return;
    }

    const room = rooms[code];

    if (room.players.length >= (room.settings ? room.settings.maxPlayers : MAX_PLAYERS)) {
      socket.emit('error-message', 'Dhoma është plot.');
      return;
    }
    if (room.gameStarted) {
      socket.emit('error-message', 'Loja ka filluar tashmë.');
      return;
    }

    room.players.push({
      id: socket.id,
      name: name,
      score: 0,
      color: assignPlayerColor()
    });

    socket.join(code);

    socket.emit('room-joined', {
      code: code,
      players: getPlayerList(room)
    });

    io.to(code).emit('player-joined', {
      name: name,
      players: getPlayerList(room)
    });

    io.to(code).emit('chat-message', {
      type: 'system',
      text: `${name} u kyç në dhomë.`
    });

    console.log(`${name} u kyç në dhomën ${code}`);
  });

  // --- SET CUSTOM WORDS (host only, before game) ---
  socket.on('set-custom-words', (data) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    if (room.host !== socket.id) {
      socket.emit('error-message', 'Vetem hosti mund te vendose fjale te personalizuara.');
      return;
    }
    if (room.gameStarted) return;

    const list = (data.words || '')
      .split(',')
      .map(w => w.trim().toLowerCase().replace(/[^a-zëç]/g, ''))
      .filter(w => w.length >= 2 && w.length <= 20);

    room.customWords = list;

    io.to(room.code).emit('chat-message', {
      type: 'system',
      text: list.length > 0
        ? `${list.length} fjale te personalizuara u shtuan.`
        : 'Fjalet e personalizuara u hoqen.'
    });
  });

  // --- KICK PLAYER (host only) ---
  socket.on('kick-player', (data) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    if (room.host !== socket.id) {
      socket.emit('error-message', 'Vetem hosti mund te perjashtoje lojtare.');
      return;
    }
    const targetId = data.playerId;
    if (targetId === socket.id) {
      socket.emit('error-message', 'Nuk mund ta perjashtosh veten.');
      return;
    }
    const target = getPlayer(room, targetId);
    if (!target) return;
    const targetName = target.name;

    room.players = room.players.filter(p => p.id !== targetId);

    if (room.gameStarted) {
      if (room.drawerIndex >= room.players.length) room.drawerIndex = 0;
      if (room.players.length < 2) {
        clearRoomTimer(room);
        room.gameStarted = false;
        io.to(room.code).emit('game-over', {
          rankings: room.players.map((p, i) => ({
            rank: i + 1,
            name: p.name,
            score: p.score
          }))
        });
        room.players.forEach(p => { p.score = 0; });
        room.currentRound = 1;
        room.drawerIndex = 0;
      }
    }

    io.to(targetId).emit('kicked');
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.leave(room.code);

    io.to(room.code).emit('chat-message', {
      type: 'system',
      text: `${targetName} u perjashtua nga dhoma.`
    });
    io.to(room.code).emit('player-joined', {
      name: '',
      players: getPlayerList(room)
    });
  });

  // --- PLAY AGAIN (host sends everyone back to lobby) ---
  socket.on('play-again', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    if (room.host !== socket.id) return;
    io.to(room.code).emit('back-to-lobby');
    io.to(room.code).emit('chat-message', {
      type: 'system',
      text: 'Host-i e nisi nje loje te re. Duke pritur lojtare...'
    });
  });

  // --- END GAME (host only) ---
  socket.on('end-game', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.gameStarted) return;
    if (room.host !== socket.id) {
      socket.emit('error-message', 'Vetem hosti mund ta perfundoje lojen.');
      return;
    }
    io.to(room.code).emit('chat-message', {
      type: 'system',
      text: 'Host-i e perfundoi lojen.'
    });
    endGame(room.code);
  });

  // --- START GAME ---
  socket.on('start-game', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;

    if (room.host !== socket.id) {
      socket.emit('error-message', 'Vetëm hosti mund ta fillojë lojën.');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('error-message', 'Duhen së paku 2 lojtarë.');
      return;
    }
    if (room.gameStarted) return;

    room.gameStarted = true;
    room.currentRound = 1;
    room.drawerIndex = 0;

    io.to(room.code).emit('game-started', {
      round: room.currentRound,
      maxRounds: room.settings ? room.settings.rounds : MAX_ROUNDS,
      players: getPlayerList(room)
    });

    io.to(room.code).emit('chat-message', {
      type: 'system',
      text: 'Loja filloi! Raundi 1'
    });

    startTurn(room.code);
  });

  // --- PICK WORD (drawer chooses from 3 options) ---
  socket.on('pick-word', (data) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.gameStarted) return;

    const drawer = getCurrentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;

    const chosen = data.word;
    if (!chosen || !room._wordOptions || !room._wordOptions.includes(chosen)) return;

    room._wordOptions = null;
    beginTurnWithWord(room.code, chosen);
  });

  // --- DRAWING ---
  socket.on('draw', (data) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.gameStarted) return;

    const drawer = getCurrentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;

    // Broadcast drawing data to everyone except drawer
    socket.to(room.code).emit('draw', data);
  });

  // --- FILL (bucket tool by drawer) ---
  socket.on('fill', (data) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.gameStarted) return;
    const drawer = getCurrentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(room.code).emit('fill', { x: data.x, y: data.y, color: data.color });
  });

  // --- CLEAR CANVAS (by drawer) ---
  socket.on('clear-canvas', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.gameStarted) return;

    const drawer = getCurrentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;

    socket.to(room.code).emit('clear-canvas');
  });

  // --- GUESS (chat message) ---
  socket.on('send-guess', (data) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.gameStarted) return;

    const player = getPlayer(room, socket.id);
    if (!player) return;

    const drawer = getCurrentDrawer(room);
    if (drawer && drawer.id === socket.id) return; // drawer can't guess

    // Already guessed this turn
    if (room.guessedPlayers.includes(socket.id)) return;

    const guess = data.text?.trim().toLowerCase();
    if (!guess) return;

    // Check if guess is correct
    if (guess === room.currentWord.toLowerCase()) {
      // Correct guess!
      room.guessedPlayers.push(socket.id);

      // Calculate points based on time left
      const totalTime = room.settings ? room.settings.time : ROUND_TIME;
      const timeFraction = room.timeLeft / totalTime;
      const guesserPoints = Math.max(Math.floor(timeFraction * POINTS_CORRECT), 10);
      player.score += guesserPoints;

      // Give drawer points (time-based bonus too)
      const drawerTimeBonus = Math.floor(timeFraction * POINTS_DRAWER);
      const drawerEarned = POINTS_DRAWER + drawerTimeBonus;
      if (drawer) {
        drawer.score += drawerEarned;
        room._drawerEarnedThisTurn = (room._drawerEarnedThisTurn || 0) + drawerEarned;
      }

      io.to(room.code).emit('correct-guess', {
        name: player.name,
        points: guesserPoints,
        drawerName: drawer ? drawer.name : '',
        drawerPoints: drawerEarned,
        players: getPlayerList(room)
      });

      io.to(room.code).emit('chat-message', {
        type: 'correct',
        text: `${player.name} e qëlloi fjalën!`
      });

      // Check if everyone guessed
      const guessers = room.players.filter(p => p.id !== drawer?.id);
      if (room.guessedPlayers.length >= guessers.length) {
        endTurn(room.code, true);
      }
    } else if (isCloseGuess(guess, room.currentWord.toLowerCase())) {
      // Close guess — give a hint
      socket.emit('close-guess');
      io.to(room.code).emit('chat-message', {
        type: 'close',
        name: player.name,
        color: player.color,
        text: guess
      });
    } else {
      // Wrong guess — show as normal chat
      socket.emit('wrong-guess');
      io.to(room.code).emit('chat-message', {
        type: 'guess',
        name: player.name,
        color: player.color,
        text: guess
      });
    }
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    console.log(`Shkëputje: ${socket.id}`);

    const room = getRoomByPlayer(socket.id);
    if (!room) return;

    const leaving = getPlayer(room, socket.id);
    const leavingName = leaving ? leaving.name : 'Dikush';

    // Remove player from room
    room.players = room.players.filter(p => p.id !== socket.id);

    io.to(room.code).emit('chat-message', {
      type: 'system',
      text: `${leavingName} doli prej dhomës.`
    });

    // If room is empty, delete it
    if (room.players.length === 0) {
      clearRoomTimer(room);
      delete rooms[room.code];
      console.log(`Dhoma ${room.code} u fshi.`);
      return;
    }

    // Transfer host if host left
    if (room.host === socket.id) {
      room.host = room.players[0].id;
      io.to(room.host).emit('chat-message', {
        type: 'system',
        text: 'Ti je hosti i ri!'
      });
    }

    // If game is running and drawer left, skip turn
    if (room.gameStarted) {
      const drawer = getCurrentDrawer(room);

      if (!drawer || room.players.length < 2) {
        // Not enough players, end game
        clearRoomTimer(room);
        room.gameStarted = false;

        io.to(room.code).emit('chat-message', {
          type: 'system',
          text: 'Nuk ka mjaft lojtarë. Loja përfundoi.'
        });

        io.to(room.code).emit('game-over', {
          rankings: room.players.map((p, i) => ({
            rank: i + 1,
            name: p.name,
            score: p.score
          }))
        });

        room.players.forEach(p => { p.score = 0; });
        room.currentRound = 1;
        room.drawerIndex = 0;
        return;
      }

      // Fix drawer index if it's out of bounds
      if (room.drawerIndex >= room.players.length) {
        room.drawerIndex = 0;
      }
    }

    // Update player list for everyone
    io.to(room.code).emit('player-joined', {
      name: '',
      players: getPlayerList(room)
    });
  });

}); // end io.on('connection')

// ========== START SERVER ==========
server.listen(PORT, () => {
  console.log(`Serveri po punon në portin ${PORT}`);
});
