import express from 'express';
import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import { Server, Socket } from 'socket.io';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { QUESTIONS, MASTER_QUESTION, MAGIC_QUESTIONS } from './backend_data.js';
import { Room, Player, SpellType } from './src/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// In-Memory Database
const rooms: Record<string, Room> = {};
const roomTimers: Record<string, NodeJS.Timeout> = {};

// Helper: Scramble keyboard letters and add distractor letters
function generateKeyboard(keyword: string, isMasterRound: boolean = false): string[] {
  const letters = keyword.toUpperCase().replace(/\s/g, '').split('');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  
  let targetLength = Math.max(12, letters.length);
  if (isMasterRound) {
    // Add 5-7 dummy letters for Master Round
    targetLength = letters.length + 5 + Math.floor(Math.random() * 3);
  }
  
  // Fill with random letters until targetLength
  while (letters.length < targetLength) {
    const randomChar = alphabet[Math.floor(Math.random() * alphabet.length)];
    letters.push(randomChar);
  }
  
  // Shuffle letters
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  
  return letters;
}

// Helper: Get shuffled order for regular questions (1-14)
function getShuffledQuestionOrder(): string[] {
  const ids = QUESTIONS.map(q => q.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

// Socket.io Handlers
io.on('connection', (socket: Socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // 1. Host: Create Room
  socket.on('host:create', (callback: (response: { success: boolean; roomId?: string; error?: string }) => void) => {
    try {
      const roomId = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit numeric room ID
      rooms[roomId] = {
        roomId,
        status: 'LOBBY',
        players: {},
        hostSocketId: socket.id,
        questionOrder: getShuffledQuestionOrder(),
        isPaused: false,
        globalTimeLeft: 735
      };
      socket.join(roomId);
      console.log(`Room created: ${roomId} by Host ${socket.id}`);
      callback({ success: true, roomId });
    } catch (err: any) {
      callback({ success: false, error: err.message });
    }
  });

  // 2. Player: Join Room
  socket.on('player:join', (data: { roomId: string; teamName: string }, callback: (response: { success: boolean; error?: string }) => void) => {
    const { roomId, teamName } = data;
    const room = rooms[roomId];

    if (!room) {
      return callback({ success: false, error: 'Phòng không tồn tại!' });
    }

    if (room.status !== 'LOBBY') {
      return callback({ success: false, error: 'Trò chơi đã bắt đầu hoặc kết thúc!' });
    }

    // Max 40 players (teams)
    const activePlayers = Object.values(room.players);
    if (activePlayers.length >= 40) {
      return callback({ success: false, error: 'Phòng đã đầy (Tối đa 40 đội chơi)!' });
    }

    // Check if team name is taken
    const nameTaken = activePlayers.some(p => p.teamName.toLowerCase() === teamName.trim().toLowerCase());
    if (nameTaken) {
      return callback({ success: false, error: 'Tên đội này đã được sử dụng!' });
    }

    // Register player
    const newPlayer: Player = {
      socketId: socket.id,
      teamName: teamName.trim(),
      score: 0,
      currentRound: 1,
      immuneUntil: 0,
      inventory: { clean: 0, banana: 0, powerout: 0, earthquake: 0 },
      activeDebuff: null,
      debuffUntil: 0,
      roundScores: {},
      solvedKeywords: {},
      debuffsReceivedThisRound: 0
    };

    room.players[socket.id] = newPlayer;
    socket.join(roomId);

    console.log(`Player ${teamName} joined Room ${roomId}`);
    callback({ success: true });

    // Notify everyone in the room (including host) about the updated player roster
    io.to(roomId).emit('room:updated', {
      roomId,
      status: room.status,
      players: Object.values(room.players)
    });
  });

  // 3. Host: Start Game
  socket.on('host:start', (data: { roomId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
    const { roomId } = data;
    const room = rooms[roomId];

    if (!room) {
      return callback({ success: false, error: 'Phòng không tồn tại!' });
    }

    if (room.hostSocketId !== socket.id) {
      return callback({ success: false, error: 'Chỉ có Host mới có quyền bắt đầu!' });
    }

    room.status = 'PLAYING';
    room.isPaused = false;
    room.globalTimeLeft = 735;
    
    if (roomTimers[roomId]) {
      clearInterval(roomTimers[roomId]);
    }

    roomTimers[roomId] = setInterval(() => {
      if (room.status !== 'PLAYING') {
        clearInterval(roomTimers[roomId]);
        return;
      }
      if (!room.isPaused) {
        room.globalTimeLeft--;
        if (room.hostSocketId) {
          io.to(room.hostSocketId).emit('host:timer_update', room.globalTimeLeft);
        }
        if (room.globalTimeLeft <= 0) {
          clearInterval(roomTimers[roomId]);
          room.status = 'FINISHED';
          io.to(roomId).emit('game:time_up_force_end');
          io.to(roomId).emit('room:updated', {
            roomId,
            status: room.status,
            players: Object.values(room.players)
          });
        }
      }
    }, 1000);

    // Set all players' rounds to 1
    Object.values(room.players).forEach(p => {
      p.currentRound = 1;
      p.score = 0;
      p.roundScores = {};
      p.solvedKeywords = {};
      p.activeDebuff = null;
      p.immuneUntil = 0;
      p.inventory = { clean: 0, banana: 0, powerout: 0, earthquake: 0 };
      p.debuffsReceivedThisRound = 0;
    });

    io.to(roomId).emit('game:started', { roomId });
    callback({ success: true });

    // Broadcast room update
    io.to(roomId).emit('room:updated', {
      roomId,
      status: room.status,
      players: Object.values(room.players)
    });
  });

  // Player helper: get active room and player
  const getPlayerAndRoom = (): { room?: Room; player?: Player; roomId?: string } => {
    for (const rId in rooms) {
      const room = rooms[rId];
      if (room.players[socket.id]) {
        return { room, player: room.players[socket.id], roomId: rId };
      }
    }
    return {};
  };

  // Host: Toggle Pause
  socket.on('host:toggle_pause', (data: { roomId: string }, callback: (response: { success: boolean; isPaused?: boolean; error?: string }) => void) => {
    const { roomId } = data;
    const room = rooms[roomId];

    if (!room) {
      return callback({ success: false, error: 'Phòng không tồn tại!' });
    }

    if (room.hostSocketId !== socket.id) {
      return callback({ success: false, error: 'Chỉ có Host mới có quyền tạm dừng!' });
    }

    room.isPaused = !room.isPaused;
    io.to(roomId).emit('game:pause_state_changed', room.isPaused);
    callback({ success: true, isPaused: room.isPaused });
  });

  // 4. Player: Fetch Current Question details
  socket.on('player:ready_for_question', (callback: (response: { 
    success: boolean; 
    error?: string; 
    round?: number; 
    hint?: string; 
    wordLength?: number; 
    keyboard?: string[];
    isMasterRound?: boolean;
    solvedWords?: Record<number, string>;
  }) => void) => {
    const { room, player, roomId } = getPlayerAndRoom();

    if (!room || !player) {
      return callback({ success: false, error: 'Không tìm thấy thông tin phòng hoặc người chơi!' });
    }

    const roundNum = player.currentRound;

    // Reset round-specific states
    player.activeDebuff = null;
    player.debuffUntil = 0;

    // Record individual question start time
    (player as any).startTime = Date.now();

    if (roundNum <= QUESTIONS.length) {
      const questionId = room.questionOrder[roundNum - 1];
      const question = QUESTIONS.find(q => q.id === questionId);
      if (!question) {
        return callback({ success: false, error: 'Không tìm thấy câu hỏi!' });
      }

      const keyboard = generateKeyboard(question.keyword, false);
      callback({
        success: true,
        round: roundNum,
        hint: question.hint,
        wordLength: question.keyword.length,
        keyboard,
        isMasterRound: false,
        reviewContent: question.reviewContent
      });
    } else if (roundNum === QUESTIONS.length + 1) {
      // Master Round!
      // Send the list of solved words to help with the deduction
      callback({
        success: true,
        round: roundNum,
        hint: MASTER_QUESTION.hint,
        wordLength: MASTER_QUESTION.keyword.length,
        keyboard: generateKeyboard(MASTER_QUESTION.keyword, true),
        isMasterRound: true,
        reviewContent: MASTER_QUESTION.reviewContent,
        solvedWords: player.solvedKeywords
      });
    } else {
      callback({ success: false, error: 'Đã hoàn thành tất cả các vòng!' });
    }

    // Broadcast update to sync Host visual dashboard
    io.to(roomId!).emit('room:updated', {
      roomId,
      status: room.status,
      players: Object.values(room.players)
    });
  });

  // 5. Player: Submit Answer
  socket.on('player:submit_answer', (data: { answer: string }, callback: (response: { 
    success: boolean; 
    correct?: boolean; 
    scoreEarned?: number; 
    nextIn?: number;
    error?: string;
  }) => void) => {
    const { room, player, roomId } = getPlayerAndRoom();

    if (!room || !player) {
      return callback({ success: false, error: 'Lỗi xác thực người chơi!' });
    }

    const roundNum = player.currentRound;
    const submitted = data.answer.toUpperCase().replace(/\s/g, '');

    if (roundNum <= QUESTIONS.length) {
      const questionId = room.questionOrder[roundNum - 1];
      const question = QUESTIONS.find(q => q.id === questionId);
      if (!question) return callback({ success: false, error: 'Không tìm thấy câu hỏi!' });

      const isCorrect = submitted === question.keyword;

      if (isCorrect) {
        const startTime = (player as any).startTime || Date.now();
        const elapsed = Date.now() - startTime;
        let scoreEarned = 0;

        if (elapsed <= 15000) {
          // Rapid bonus: under 15s gets full 100 points
          scoreEarned = 100;
        } else if (elapsed > 48000) {
          // Timeout
          scoreEarned = 0;
        } else {
          // Linear decay from 100 to 70 points
          const clampedElapsed = Math.min(elapsed, 45000);
          const percentage = (clampedElapsed - 15000) / 30000;
          scoreEarned = Math.round(100 - percentage * 30);
        }

        player.score += scoreEarned;
        player.roundScores[roundNum] = scoreEarned;
        player.solvedKeywords[questionId] = question.displayWord; // Keep diacritics solved word for round 8
        player.currentRound += 1;
        player.debuffsReceivedThisRound = 0;
        player.immuneUntil = 0;

        callback({ success: true, correct: true, scoreEarned, nextIn: 5 });

        // Update Host Leaderboard
        io.to(roomId!).emit('room:updated', {
          roomId,
          status: room.status,
          players: Object.values(room.players)
        });
      } else {
        callback({ success: true, correct: false, scoreEarned: 0 });
      }
    } else if (roundNum === QUESTIONS.length + 1) {
      // Master Round
      const isCorrect = submitted === MASTER_QUESTION.keyword;

      if (isCorrect) {
        // Flat 500 points
        const scoreEarned = 500;
        player.score += scoreEarned;
        player.roundScores[roundNum] = scoreEarned;
        player.solvedKeywords[`q${roundNum}`] = MASTER_QUESTION.displayWord;
        player.currentRound += 1; // Mark as finished
        player.debuffsReceivedThisRound = 0;
        player.immuneUntil = 0;

        if (roomTimers[roomId!]) {
          clearInterval(roomTimers[roomId!]);
        }

        callback({ success: true, correct: true, scoreEarned, nextIn: 5 });

        // Update Host Leaderboard
        io.to(roomId!).emit('room:updated', {
          roomId,
          status: room.status,
          players: Object.values(room.players)
        });
      } else {
        callback({ success: true, correct: false, scoreEarned: 0 });
      }
    }
  });

  // 6. Player: Timeout/Skip
  socket.on('player:timeout', (callback: (response: { success: boolean }) => void) => {
    const { room, player, roomId } = getPlayerAndRoom();
    if (!room || !player) return callback({ success: false });

    const roundNum = player.currentRound;
    player.roundScores[roundNum] = 0;
    player.currentRound += 1;
    player.debuffsReceivedThisRound = 0;
    player.immuneUntil = 0;

    callback({ success: true });

    io.to(roomId!).emit('room:updated', {
      roomId,
      status: room.status,
      players: Object.values(room.players)
    });
  });

  // 7. Player: Fetch Magic Spell Question
  socket.on('player:request_spell', (callback: (response: { 
    success: boolean; 
    error?: string; 
    question?: string; 
    answers?: string[]; 
  }) => void) => {
    const { room, player } = getPlayerAndRoom();
    if (!room || !player) return callback({ success: false, error: 'Xác thực không hợp lệ!' });

    // Select a random magic question
    const randomIndex = Math.floor(Math.random() * MAGIC_QUESTIONS.length);
    const q = MAGIC_QUESTIONS[randomIndex];

    // Save active magic question on player state
    (player as any).activeMagicQuestionId = q.id;
    (player as any).activeMagicStartTime = Date.now();

    callback({
      success: true,
      question: q.question,
      answers: q.answers
    });
  });

  // 8. Player: Submit Magic Spell Answer
  socket.on('player:submit_spell', (data: { selectedIndex: number }, callback: (response: { 
    success: boolean; 
    correct?: boolean; 
    spell?: SpellType;
    error?: string; 
  }) => void) => {
    const { room, player, roomId } = getPlayerAndRoom();
    if (!room || !player) return callback({ success: false, error: 'Xác thực không hợp lệ!' });

    const qId = (player as any).activeMagicQuestionId;
    const startTime = (player as any).activeMagicStartTime;
    
    if (!qId || !startTime) {
      return callback({ success: false, error: 'Không tìm thấy câu hỏi phép thuật đang hoạt động!' });
    }

    // Check 10s limit
    if (Date.now() - startTime > 10500) { // 10.5s margin
      return callback({ success: true, correct: false, error: 'Quá thời gian 10 giây!' });
    }

    const q = MAGIC_QUESTIONS.find(item => item.id === qId);
    if (!q) return callback({ success: false, error: 'Hệ thống lỗi!' });

    const isCorrect = data.selectedIndex === q.correctIndex;

    // Clean active magic question
    (player as any).activeMagicQuestionId = null;
    (player as any).activeMagicStartTime = null;

    if (isCorrect) {
      // Award random power
      const spells: SpellType[] = ['clean', 'banana', 'powerout', 'earthquake'];
      const awarded = spells[Math.floor(Math.random() * spells.length)];
      if (!player.inventory) {
        player.inventory = { clean: 0, banana: 0, powerout: 0, earthquake: 0 };
      }
      player.inventory[awarded]++;

      callback({
        success: true,
        correct: true,
        spell: awarded
      });

      io.to(roomId!).emit('room:updated', {
        roomId,
        status: room.status,
        players: Object.values(room.players)
      });
    } else {
      callback({
        success: true,
        correct: false,
        error: 'Đáp án sai rồi!'
      });
    }
  });

  // 9. Player: Cast Debuff on Target Team
  socket.on('player:cast_spell', (data: { targetSocketId: string; spellType: SpellType }, callback: (response: { success: boolean; error?: string; cleanedKeyboard?: string[] }) => void) => {
    const { room, player, roomId } = getPlayerAndRoom();
    if (!room || !player) return callback({ success: false, error: 'Xác thực không hợp lệ!' });

    if (!player.inventory) {
      player.inventory = { clean: 0, banana: 0, powerout: 0, earthquake: 0 };
    }

    const spell = data.spellType;
    if (!spell || !player.inventory || player.inventory[spell] <= 0) {
      return callback({ success: false, error: 'Bạn không sở hữu phép thuật này!' });
    }

    if (spell === 'clean') {
      player.inventory[spell]--;
      const roundNum = player.currentRound;
      let question;
      if (roundNum <= QUESTIONS.length) {
         const questionId = room.questionOrder[roundNum - 1];
         question = QUESTIONS.find(q => q.id === questionId);
      } else {
         question = MASTER_QUESTION;
      }
      const answerChars = question ? question.keyword.split('') : [];

      io.to(roomId!).emit('room:updated', {
        roomId,
        status: room.status,
        players: Object.values(room.players)
      });
      return callback({ success: true, cleanedKeyboard: answerChars });
    }

    // Default target for 'clean' might be itself, but clean was already processed above
    const target = room.players[data.targetSocketId];
    if (!target) {
      return callback({ success: false, error: 'Đối thủ không tồn tại hoặc đã rời phòng!' });
    }

    if (target.socketId === socket.id) {
      return callback({ success: false, error: 'Bạn không thể ném debuff lên chính mình!' });
    }

    // Debuff cast verification: check shield
    if (target.immuneUntil > Date.now()) {
      return callback({ success: false, error: `${target.teamName} đang có Khiên bảo vệ!` });
    }

    // Apply debuff
    const durationSec = spell === 'banana' ? 8 : 5;
    target.activeDebuff = spell;
    
    target.debuffsReceivedThisRound = (target.debuffsReceivedThisRound || 0) + 1;
    if (target.debuffsReceivedThisRound >= 2) {
      target.immuneUntil = Date.now() + 999999999; // Infinite shield until round ends
    } else {
      target.immuneUntil = Date.now() + 15000; // Temporary 15s shield
    }
    
    target.debuffUntil = Date.now() + durationSec * 1000;

    // Clear caster spell
    player.inventory[spell]--;

    // Send direct event to target socket to activate visual effect immediately
    io.to(target.socketId).emit('debuff:applied', {
      type: spell,
      duration: durationSec,
      casterName: player.teamName
    });

    callback({ success: true });

    // Notify Host and others
    io.to(roomId!).emit('room:updated', {
      roomId,
      status: room.status,
      players: Object.values(room.players)
    });
  });

  // 10. Host: Reset Game
  socket.on('host:reset', (data: { roomId: string }, callback: (response: { success: boolean }) => void) => {
    const { roomId } = data;
    const room = rooms[roomId];

    if (room && room.hostSocketId === socket.id) {
      room.status = 'LOBBY';
      room.questionOrder = getShuffledQuestionOrder(); // Reshuffle on reset
      Object.values(room.players).forEach(p => {
        p.score = 0;
        p.currentRound = 1;
        p.roundScores = {};
        p.solvedKeywords = {};
        p.immuneUntil = 0;
        p.inventory = { clean: 0, banana: 0, powerout: 0, earthquake: 0 };
        p.debuffsReceivedThisRound = 0;
      });

      if (roomTimers[roomId]) {
        clearInterval(roomTimers[roomId]);
      }

      io.to(roomId).emit('game:reset');
      callback({ success: true });

      io.to(roomId).emit('room:updated', {
        roomId,
        status: room.status,
        players: Object.values(room.players)
      });
    } else {
      callback({ success: false });
    }
  });

  // 11. Disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Check if player disconnected
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        const p = room.players[socket.id];
        console.log(`Player ${p.teamName} left Room ${roomId}`);
        delete room.players[socket.id];
        
        // Notify room
        io.to(roomId).emit('room:updated', {
          roomId,
          status: room.status,
          players: Object.values(room.players)
        });
        break;
      }

      // Check if Host disconnected
      if (room.hostSocketId === socket.id) {
        console.log(`Host disconnected from Room ${roomId}. Clearing room.`);
        if (roomTimers[roomId]) {
          clearInterval(roomTimers[roomId]);
        }
        io.to(roomId).emit('host:left');
        delete rooms[roomId];
        break;
      }
    }
  });
});

// Serve Frontend build & static assets
if (process.env.NODE_ENV !== 'production') {
  createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  }).then((vite) => {
    app.use(vite.middlewares);
  });
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
