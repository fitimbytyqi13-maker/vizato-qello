const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

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
const POINTS_CORRECT = 100;   // points for guessing correctly
const POINTS_DRAWER = 50;     // points for drawer when someone guesses

// ========== WORD LIST (Albanian) ==========
const words = [
  'shtepi', 'diell', 'lule', 'det', 'mal',
  'qen', 'mace', 'liber', 'shkolla', 'top',
  'makine', 'avion', 'anija', 'yll', 'hena',
  'shi', 'bore', 'zjarr', 'uje', 'dore',
  'sy', 'zemer', 'peshk', 'zog', 'rruga',
  'ura', 'kulla', 'kali', 'molla', 'dardha',
  'rrushi', 'buka', 'djathi', 'kafe', 'caj',
  'akullore', 'torta', 'pica', 'burek', 'flija',
  'prishtina', 'mitrovica', 'peja', 'gjakova', 'prizreni',
  'xhamia', 'kisha', 'pazari', 'stadiumi', 'autobusi',
  'telefoni', 'kompjuteri', 'tavolina', 'karrigia', 'dritarja',
  'dera', 'cati', 'ballkoni', 'oborri', 'kopshti',
  'mjalti', 'qumeshti', 'veza', 'mishi', 'patatja',
  'domatja', 'specat', 'sallata', 'supa', 'pasticja',
  'trapi', 'drini', 'sitnica', 'sharri', 'bjeshka'
];

// ========== ROOMS STORAGE ==========
const rooms = {};

// ========== HELPER FUNCTIONS ==========

// Pick a random word from the list
function getRandomWord() {
  return words[Math.floor(Math.random() * words.length)];
}

// Generate a short room code
function generateRoomCode() {
  return uuidv4().slice(0, 6).toUpperCase();
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
    isDrawing: room.players[room.drawerIndex]?.id === p.id
  }));
}

// Clear room timer
function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

// ========== GAME LOGIC ==========

// Start a new turn
function startTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.players.length < 2) return;

  clearRoomTimer(room);

  // Pick word and reset turn state
  room.currentWord = getRandomWord();
  room.guessedPlayers = [];
  room.timeLeft = room.settings ? room.settings.time : ROUND_TIME;

  const drawer = getCurrentDrawer(room);
  if (!drawer) return;

  // Tell the drawer the word
  io.to(drawer.id).emit('your-turn', {
    word: room.currentWord,
    round: room.currentRound,
    maxRounds: room.settings ? room.settings.rounds : MAX_ROUNDS
  });

  // Tell everyone else a turn started
  io.to(roomCode).emit('turn-started', {
    drawer: drawer.name,
    wordLength: room.currentWord.length,
    players: getPlayerList(room),
    round: room.currentRound,
    maxRounds: room.settings ? room.settings.rounds : MAX_ROUNDS
  });

  // Send system message
  io.to(roomCode).emit('chat-message', {
    type: 'system',
    text: `Radha e ${drawer.name} me vizatu.`
  });

  // Clear the canvas for everyone
  io.to(roomCode).emit('clear-canvas');

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
        score: 0
      }],
      gameStarted: false,
      currentWord: null,
      currentRound: 1,
      drawerIndex: 0,
      guessedPlayers: [],
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
    const code = data.code?.trim().toUpperCase();

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
      score: 0
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

  // --- START GAME ---
  socket.on('start-game', (data) => {
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

    // Apply settings from host if provided
    if (data && data.settings) {
      const s = data.settings;
      room.settings = {
        rounds:     Math.min(Math.max(parseInt(s.rounds) || MAX_ROUNDS, 1), 10),
        time:       Math.min(Math.max(parseInt(s.time) || ROUND_TIME, 15), 180),
        maxPlayers: Math.min(Math.max(parseInt(s.maxPlayers) || MAX_PLAYERS, 2), 16)
      };
    }

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
      text: 'Loja filloi! Raundi 1 — Koha: ' + (room.settings ? room.settings.time : ROUND_TIME) + 's'
    });

    startTurn(room.code);
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
      const timeBonus = Math.floor(room.timeLeft / (room.settings ? room.settings.time : ROUND_TIME) * POINTS_CORRECT);
      player.score += Math.max(timeBonus, 10);

      // Give drawer points too
      if (drawer) {
        drawer.score += POINTS_DRAWER;
      }

      io.to(room.code).emit('correct-guess', {
        name: player.name,
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
    } else {
      // Wrong guess — show as normal chat
      io.to(room.code).emit('chat-message', {
        type: 'guess',
        name: player.name,
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
