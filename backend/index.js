// Standalone Node + Express + Socket.io Server for CABO
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const port = process.env.PORT || 3001;
const corsOrigin = process.env.CORS_ORIGIN || '*';

const expressApp = express();

// Middlewares
expressApp.use(cors({ origin: corsOrigin }));
expressApp.use(express.json());

// Health check endpoint
expressApp.get('/health', (req, res) => {
  res.status(200).send('CABO Backend is healthy and running.');
});

const server = http.createServer(expressApp);

// Initialize Socket.io with CORS
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  }
});

// Import game logic
const gameEngine = require('./lib/game');

// Import DB helper
const db = require('./lib/db');

// In-memory active rooms store
// Map<roomCode, RoomState>
const rooms = new Map();

// Map<socket.id, { roomCode, playerId }> to quickly clean up on disconnect
const socketToPlayerMap = new Map();

// Helper to generate room codes
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Socket.io Game Events
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create Room
  socket.on('create_room', ({ playerName, playerId }) => {
    let code;
    let retries = 0;
    do {
      code = generateRoomCode();
      retries++;
    } while (rooms.has(code) && retries < 10);

    const lobbyState = {
      roomCode: code,
      status: 'lobby',
      players: [{
        id: socket.id,
        playerId,
        name: playerName,
        isHost: true,
        active: true,
        score: 0,
        roundScore: 0,
        wins: 0,
        peeked: false,
        cards: []
      }],
      deck: [],
      discardPile: [],
      turnIndex: 0,
      caboPlayerId: null,
      turnsLeft: null,
      activeDrawnCard: null,
      roundNumber: 0,
      lobbyTurnTimer: 45
    };

    rooms.set(code, lobbyState);
    socketToPlayerMap.set(socket.id, { roomCode: code, playerId });

    socket.join(code);
    socket.emit('room_joined', { roomCode: code, players: lobbyState.players, isHost: true, lobbyTurnTimer: 45 });
    console.log(`Room created: ${code} by player: ${playerName}`);
  });

  // Join Room
  socket.on('join_room', ({ roomCode, playerName, playerId }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) {
      socket.emit('error_message', 'Room not found.');
      return;
    }

    const room = rooms.get(code);

    // Check if player is already in this room (reconnection)
    const existingPlayerIdx = room.players.findIndex(p => p.playerId === playerId);

    if (existingPlayerIdx !== -1) {
      // Reconnect player
      const player = room.players[existingPlayerIdx];

      // Remove stale old socket entry to prevent socketToPlayerMap leak on reconnects
      if (player.id && player.id !== socket.id) {
        socketToPlayerMap.delete(player.id);
      }

      player.id = socket.id;
      player.active = true;

      socketToPlayerMap.set(socket.id, { roomCode: code, playerId });
      socket.join(code);

      socket.emit('room_joined', { 
        roomCode: code, 
        players: room.players, 
        isHost: player.isHost,
        gameState: room.status !== 'lobby' ? room : null,
        lobbyTurnTimer: room.lobbyTurnTimer || 45
      });

      // Broadcast updated room state to other players
      io.to(code).emit('room_updated', room.players);
      
      if (room.status !== 'lobby') {
        // Send full game state to the reconnected player
        socket.emit('game_state_updated', sanitizeGameState(room, socket.id));
        io.to(code).emit('log_message', `${player.name} reconnected.`);
      }
      console.log(`Player reconnected: ${player.name} in Room ${code}`);
      return;
    }

    // If game is already in progress, prevent new players from joining
    if (room.status !== 'lobby') {
      socket.emit('error_message', 'Game already in progress.');
      return;
    }

    // Check player limit
    if (room.players.length >= 6) {
      socket.emit('error_message', 'Room is full (max 6 players).');
      return;
    }

    // Add new player to lobby
    const newPlayer = {
      id: socket.id,
      playerId,
      name: playerName,
      isHost: false,
      active: true,
      score: 0,
      roundScore: 0,
      wins: 0,
      peeked: false,
      cards: []
    };

    room.players.push(newPlayer);
    socketToPlayerMap.set(socket.id, { roomCode: code, playerId });

    socket.join(code);
    socket.emit('room_joined', { roomCode: code, players: room.players, isHost: false, lobbyTurnTimer: room.lobbyTurnTimer || 45 });
    
    // Notify other players
    io.to(code).emit('room_updated', room.players);
    console.log(`Player ${playerName} joined Room ${code}`);
  });

  // Kick Player (Host only)
  socket.on('kick_player', ({ roomCode, targetPlayerId }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    // Verify requester is the host
    const requester = room.players.find(p => p.id === socket.id);
    if (!requester || !requester.isHost) {
      socket.emit('error_message', 'Only the host can kick players.');
      return;
    }

    // Find the player to kick
    const playerIndex = room.players.findIndex(p => p.id === targetPlayerId);
    if (playerIndex === -1) return;

    const kickedPlayer = room.players[playerIndex];
    const isLobby = !room.status || room.status === 'lobby';

    if (isLobby) {
      // Remove player from room list
      room.players.splice(playerIndex, 1);
    } else {
      // Game in progress, call engine handler to adjust turns/state
      gameEngine.removePlayerMidGame(room, targetPlayerId);
    }

    // Clean up mapping
    socketToPlayerMap.delete(targetPlayerId);

    // Notify the kicked player's socket directly
    io.to(targetPlayerId).emit('kicked');

    // Make the kicked player's socket leave the channel
    const targetSocket = io.sockets.sockets.get(targetPlayerId);
    if (targetSocket) {
      targetSocket.leave(code);
    }

    if (isLobby) {
      // Broadcast updated player list to everyone in lobby
      io.to(code).emit('room_updated', room.players);
    } else {
      // Broadcast updated game state to everyone
      sendGameStateToAll(code, room);
    }
    console.log(`Player ${kickedPlayer.name} was kicked from Room ${code} by the host.`);
  });

  // Update Lobby Turn Timer (Host only)
  socket.on('update_lobby_timer', ({ roomCode, lobbyTurnTimer }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    // Verify requester is the host
    const requester = room.players.find(p => p.id === socket.id);
    if (!requester || !requester.isHost) {
      socket.emit('error_message', 'Only the host can update the turn timer.');
      return;
    }

    // Limit cooldown time range to safe values (e.g. min 15s)
    const timerValue = Math.max(15, lobbyTurnTimer);
    room.lobbyTurnTimer = timerValue;

    // Broadcast updated timer value to everyone in the room
    io.to(code).emit('lobby_timer_updated', timerValue);
    console.log(`Room ${code} turn timer updated to ${timerValue}s`);
  });

  // Start Game
  socket.on('start_game', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    // Verify socket is the host
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      socket.emit('error_message', 'Only the host can start the game.');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('error_message', 'Need at least 2 players to start.');
      return;
    }

    // Keep reference to lobbyTurnTimer before initializing game state
    const selectedTimer = room.lobbyTurnTimer || 45;

    // Initialize game state using engine
    const initialGameState = gameEngine.initRoomState(code, room.players);
    initialGameState.lobbyTurnTimer = selectedTimer;
    initialGameState.turnTimerDuration = selectedTimer * 1000;

    rooms.set(code, initialGameState);

    // Broadcast game started to everyone in room
    sendGameStateToAll(code, initialGameState);
    console.log(`Game started in Room ${code}`);
  });

  // Draw from Deck
  socket.on('draw_deck', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    gameEngine.drawCardFromDeck(room, socket.id);
    sendGameStateToAll(code, room);
  });

  // Draw from Discard
  socket.on('draw_discard', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    gameEngine.drawCardFromDiscard(room, socket.id);
    sendGameStateToAll(code, room);
  });

  // Discard Drawn Card
  socket.on('discard_drawn', ({ roomCode, triggerAction }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    gameEngine.discardDrawnCard(room, socket.id, triggerAction);
    sendGameStateToAll(code, room);
  });

  // Replace hand cards (single or multi-match)
  socket.on('replace_card', ({ roomCode, handIndices }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    gameEngine.replaceHandCard(room, socket.id, handIndices);
    sendGameStateToAll(code, room);
  });

  // Overload Card out-of-turn
  socket.on('overload_card', ({ roomCode, targetPlayerId, cardIndex }, callback) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) {
      if (callback) callback({ success: false, error: 'Room not found' });
      return;
    }
    const room = rooms.get(code);

    const result = gameEngine.overloadCard(room, socket.id, targetPlayerId, cardIndex);
    
    // If mismatch or already matched (false overload), set temporary exposure timer
    if (!result.success && result.revealPlayerId !== undefined) {
      room.exposedCard = {
        playerId: result.revealPlayerId,
        cardIndex: result.revealIndex
      };

      // Cancel any existing timer before setting a new one
      if (room.exposedCardTimer) clearTimeout(room.exposedCardTimer);

      // Store timer ID on room so it can be cancelled if room is cleaned up
      room.exposedCardTimer = setTimeout(() => {
        const currentRoom = rooms.get(code);
        if (currentRoom && currentRoom.exposedCard &&
            currentRoom.exposedCard.playerId === result.revealPlayerId &&
            currentRoom.exposedCard.cardIndex === result.revealIndex) {
          currentRoom.exposedCard = null;
          currentRoom.exposedCardTimer = null;
          sendGameStateToAll(code, currentRoom);
        }
      }, 4000);
    }

    sendGameStateToAll(code, room);

    if (callback) {
      callback(result);
    }
  });

  // Transfer Card to complete overload
  socket.on('transfer_overload_card', ({ roomCode, cardIndex }, callback) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) {
      if (callback) callback({ success: false, error: 'Room not found' });
      return;
    }
    const room = rooms.get(code);

    const result = gameEngine.transferOverloadCard(room, socket.id, cardIndex);
    sendGameStateToAll(code, room);

    if (callback) {
      callback(result);
    }
  });

  // Initial Peek action (returns the card at the index)
  socket.on('initial_peek', ({ roomCode, cardIndex }, callback) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) {
      if (callback) callback({ success: false });
      return;
    }
    const room = rooms.get(code);
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.status !== 'initial_peeking') {
      if (callback) callback({ success: false });
      return;
    }

    // Check if indices are 2 or 3 (bottom two cards of 2x2 matrix)
    if (cardIndex !== 2 && cardIndex !== 3) {
      if (callback) callback({ success: false, error: 'Can only peek bottom two cards initially' });
      return;
    }

    const card = player.cards[cardIndex];
    if (callback) callback({ success: true, card });
  });

  // Done with initial peek phase
  socket.on('done_peeking', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    gameEngine.completeInitialPeek(room, socket.id);
    sendGameStateToAll(code, room);
  });

  // Execute Card Action (Peek power, Spy power, Swap power)
  socket.on('execute_action', ({ roomCode, actionData }, callback) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) {
      if (callback) callback({ success: false });
      return;
    }
    const room = rooms.get(code);

    const actionType = room.actionState.type;
    const sourcePlayer = room.players.find(p => p.id === socket.id);

    const result = gameEngine.executeCardAction(room, socket.id, actionData);
    
    // Send updated game state to all
    sendGameStateToAll(code, room);

    if (callback) {
      callback(result || { success: true });
    }

    if (result && result.success && actionType === 'spy') {
      const targetSocketId = actionData.targetPlayerId;
      const cardIndex = actionData.cardIndex;
      io.to(targetSocketId).emit('you_were_spied_on', {
        spiedBy: sourcePlayer ? sourcePlayer.name : 'An opponent',
        cardIndex: cardIndex
      });
    }

    // Check if game is over after actions or turns
    checkAndHandleGameOver(room);
  });

  // Call CABO
  socket.on('call_cabo', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    gameEngine.callCabo(room, socket.id);
    sendGameStateToAll(code, room);
  });

  // Start Next Round (called by host)
  socket.on('next_round', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    if (!rooms.has(code)) return;
    const room = rooms.get(code);

    // Verify socket is host
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;

    // Cancel cleanup timer if active
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    scheduledForCleanup.delete(code);

    const nextRoundState = gameEngine.initNextRound(room);
    rooms.set(code, nextRoundState);
    
    // Broadcast game started to everyone in room
    sendGameStateToAll(code, nextRoundState);
  });

  // Floating reaction emoji broadcast
  socket.on('send_emoji', ({ roomCode, emoji }) => {
    const code = roomCode.toUpperCase();
    io.to(code).emit('emoji_received', {
      playerId: socket.id,
      emoji
    });
  });

  // Chat message broadcast
  socket.on('send_chat', ({ roomCode, message }) => {
    const code = roomCode?.toUpperCase();
    if (!code) return;

    const room = rooms.get(code);
    const senderName = room ? (room.players.find(p => p.id === socket.id)?.name || 'Player') : 'Player';

    // Broadcast chat bubble
    io.to(code).emit('chat_received', {
      playerId: socket.id,
      senderName,
      message
    });

    // Add to game logs (capped at 100 to prevent unbounded growth)
    if (room) {
      room.logs.push(`💬 ${senderName}: ${message}`);
      if (room.logs.length > 100) room.logs = room.logs.slice(-100);
      sendGameStateToAll(code, room);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const mapping = socketToPlayerMap.get(socket.id);
    if (mapping) {
      const { roomCode, playerId } = mapping;
      if (rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        const player = room.players.find(p => p.playerId === playerId);
        if (player) {
          player.active = false;
          io.to(roomCode).emit('room_updated', room.players);
          io.to(roomCode).emit('log_message', `${player.name} disconnected. Waiting for reconnection...`);
          console.log(`Player marked inactive: ${player.name} in Room ${roomCode}`);
        }
      }
      socketToPlayerMap.delete(socket.id);
    }
  });
});

// Helper to check and write game over to DB
// Tracks which rooms have already been scheduled for cleanup to avoid duplicate timers
const scheduledForCleanup = new Set();

function checkAndHandleGameOver(room) {
  if (room.status === 'game_over' && !scheduledForCleanup.has(room.roomCode)) {
    scheduledForCleanup.add(room.roomCode);

    const minScore = Math.min(...room.players.map(p => p.score));
    const winnerNames = room.players.filter(p => p.score === minScore).map(p => p.name).join(' & ');

    db.saveGameHistory({
      roomCode: room.roomCode,
      roundNumber: room.roundNumber,
      players: room.players.map(p => ({
        name: p.name,
        playerId: p.playerId,
        score: p.score
      })),
      winnerName: winnerNames
    }).then(() => {
      console.log(`Saved game result to database for room ${room.roomCode}`);
    });

    // Delete room from memory after 60s so players can see final scores
    room.cleanupTimer = setTimeout(() => {
      const r = rooms.get(room.roomCode);
      if (r) {
        if (r.exposedCardTimer) clearTimeout(r.exposedCardTimer);
        if (r.turnTimer) clearTimeout(r.turnTimer);
        rooms.delete(room.roomCode);
      }
      scheduledForCleanup.delete(room.roomCode);
      console.log(`Room ${room.roomCode} cleaned up from memory.`);
    }, 60000);
  }
}

// Helper to send game state to all room players (sanitizing secret card info)
function sendGameStateToAll(roomCode, room) {
  // Manage Turn Timer
  manageTurnTimer(roomCode, room);

  checkAndHandleGameOver(room);
  
  // We send customized state to each socket depending on who they are
  const sockets = io.sockets.adapter.rooms.get(roomCode);
  if (!sockets) return;

  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('game_state_updated', sanitizeGameState(room, socketId));
    }
  }
}

function manageTurnTimer(roomCode, room) {
  // Only manage timer if room status is 'playing'
  if (room.status !== 'playing') {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    delete room.turnTimerStartedAt;
    delete room.turnTimerDuration;
    delete room.lastTurnIndex;
    delete room.lastRoundNumber;
    return;
  }

  // If the turn index or round number has changed, restart the timer!
  if (room.lastTurnIndex !== room.turnIndex || room.lastRoundNumber !== room.roundNumber) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
    }
    
    room.lastTurnIndex = room.turnIndex;
    room.lastRoundNumber = room.roundNumber;
    
    room.turnTimerStartedAt = Date.now();
    room.turnTimerDuration = (room.lobbyTurnTimer || 45) * 1000;
    
    room.turnTimer = setTimeout(() => {
      console.log(`Room ${roomCode}: Player index ${room.turnIndex} timed out.`);
      gameEngine.handleTurnTimeout(room);
      
      // Reset timer tracking so the next turn starts a new timer
      delete room.lastTurnIndex; 
      
      // Send state update
      sendGameStateToAll(roomCode, room);
    }, room.turnTimerDuration);
  }
}

// Sanitizes room state so clients don't see each other's card values
function sanitizeGameState(room, socketId = null) {
  const sanitizedPlayers = room.players.map(p => {
    const isSelf = p.id === socketId;
    return {
      id: p.id,
      playerId: p.playerId,
      name: p.name,
      isHost: p.isHost,
      active: p.active,
      score: p.score,
      roundScore: p.roundScore,
      wins: p.wins || 0,
      peeked: p.peeked,
      cards: p.cards.map((c, idx) => {
        if (!c) return null; // Discarded slot
        if (room.status === 'round_end' || room.status === 'game_over') {
          return c;
        }
        // Auto-reveal bottom two cards to self during initial peeking
        if (isSelf && room.status === 'initial_peeking' && (idx === 2 || idx === 3)) {
          return c;
        }
        // Exposed card due to false overload (visible to all)
        if (room.exposedCard && room.exposedCard.playerId === p.id && room.exposedCard.cardIndex === idx) {
          return c;
        }
        return { id: c.id, hidden: true };
      })
    };
  });

  const activePlayer = room.players[room.turnIndex];
  const isSelfDrawn = activePlayer && activePlayer.id === socketId;
  let sanitizedDrawnCard = null;
  if (room.activeDrawnCard) {
    if (isSelfDrawn || room.status === 'round_end' || room.status === 'game_over') {
      sanitizedDrawnCard = room.activeDrawnCard;
    } else {
      sanitizedDrawnCard = { id: room.activeDrawnCard.id, hidden: true };
    }
  }

  return {
    roomCode: room.roomCode,
    status: room.status,
    players: sanitizedPlayers,
    deckCount: room.deck.length,
    discardPile: room.discardPile,
    topDiscard: room.discardPile[room.discardPile.length - 1] || null,
    turnIndex: room.turnIndex,
    caboPlayerId: room.caboPlayerId,
    turnsLeft: room.turnsLeft,
    activeDrawnCard: sanitizedDrawnCard,
    drawnCardSource: room.drawnCardSource,
    actionState: room.actionState,
    roundNumber: room.roundNumber,
    logs: room.logs,
    overloadTransferState: room.overloadTransferState,
    hasOverloadedCurrentDiscard: room.hasOverloadedCurrentDiscard,
    exposedCard: room.exposedCard,
    turnTimerStartedAt: room.turnTimerStartedAt,
    turnTimerDuration: room.turnTimerDuration
  };
}

// DB connection initialization
db.connectDB().then(() => {
  console.log('> Database status initialized.');
});

// Start Express Server
server.listen(port, () => {
  console.log(`> Standalone CABO Backend running on http://localhost:${port}`);
  console.log(`> CORS configured to allow requests from origin: ${corsOrigin}`);
});
