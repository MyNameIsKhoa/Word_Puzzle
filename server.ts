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

// Helper: Scramble keyboard letters and add distractor letters
function generateKeyboard(keyword: string): string[] {
  const letters = keyword.toUpperCase().replace(/\s/g, '').split('');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  
  // Fill with random letters until we have 12 unique buttons, or at least 12 buttons
  while (letters.length < 12) {
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
        questionOrder: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']
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

    // Max 8 players (teams)
    const activePlayers = Object.values(room.players);
    if (activePlayers.length >= 8) {
      return callback({ success: false, error: 'Phòng đã đầy (Tối đa 8 đội chơi)!' });
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
      isImmuneThisRound: false,
      activeDebuff: null,
      debuffUntil: 0,
      roundScores: {},
      solvedKeywords: {}
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
    
    // Set all players' rounds to 1
    Object.values(room.players).forEach(p => {
      p.currentRound = 1;
      p.score = 0;
      p.roundScores = {};
      p.solvedKeywords = {};
      p.activeDebuff = null;
      p.isImmuneThisRound = false;
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
    player.isImmuneThisRound = false;
    player.activeDebuff = null;
    player.debuffUntil = 0;

    // Record individual question start time
    (player as any).startTime = Date.now();

    if (roundNum <= 7) {
      const questionId = room.questionOrder[roundNum - 1];
      const question = QUESTIONS.find(q => q.id === questionId);
      if (!question) {
        return callback({ success: false, error: 'Không tìm thấy câu hỏi!' });
      }

      const keyboard = generateKeyboard(question.keyword);
      callback({
        success: true,
        round: roundNum,
        hint: question.hint,
        wordLength: question.keyword.length,
        keyboard,
        isMasterRound: false,
        reviewContent: question.reviewContent
      });
    } else if (roundNum === 8) {
      // Master Round!
      // Send the list of solved words to help with the deduction
      callback({
        success: true,
        round: 8,
        hint: MASTER_QUESTION.hint,
        wordLength: MASTER_QUESTION.keyword.length,
        keyboard: generateKeyboard(MASTER_QUESTION.keyword),
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

    if (roundNum <= 7) {
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
    } else if (roundNum === 8) {
      // Master Round
      const isCorrect = submitted === MASTER_QUESTION.keyword;

      if (isCorrect) {
        // Flat 500 points
        const scoreEarned = 500;
        player.score += scoreEarned;
        player.roundScores[8] = scoreEarned;
        player.solvedKeywords['q8'] = MASTER_QUESTION.displayWord;
        player.currentRound += 1; // Mark as finished

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
    const { room, player } = getPlayerAndRoom();
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
      (player as any).availableSpell = awarded;

      callback({
        success: true,
        correct: true,
        spell: awarded
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
  socket.on('player:cast_spell', (data: { targetSocketId: string }, callback: (response: { success: boolean; error?: string }) => void) => {
    const { room, player, roomId } = getPlayerAndRoom();
    if (!room || !player) return callback({ success: false, error: 'Xác thực không hợp lệ!' });

    const spell = (player as any).availableSpell;
    if (!spell) {
      return callback({ success: false, error: 'Bạn không sở hữu phép thuật nào!' });
    }

    if (spell === 'clean') {
      (player as any).availableSpell = null;
      const roundNum = player.currentRound;
      let question;
      if (roundNum <= 7) {
         const questionId = room.questionOrder[roundNum - 1];
         question = QUESTIONS.find(q => q.id === questionId);
      } else {
         question = MASTER_QUESTION;
      }
      const answerChars = question ? question.keyword.split('') : [];
      return callback({ success: true, cleanedKeyboard: answerChars });
    }

    const target = room.players[data.targetSocketId];
    if (!target) {
      return callback({ success: false, error: 'Đối thủ không tồn tại hoặc đã rời phòng!' });
    }

    if (target.socketId === socket.id) {
      return callback({ success: false, error: 'Bạn không thể ném debuff lên chính mình!' });
    }

    // Debuff cast verification: check shield
    if (target.isImmuneThisRound) {
      return callback({ success: false, error: `${target.teamName} đang có Khiên bảo vệ!` });
    }

    // Apply debuff
    target.activeDebuff = spell;
    target.isImmuneThisRound = true; // Gets shield now
    target.debuffUntil = Date.now() + 5000; // 5 seconds duration

    // Clear caster spell
    (player as any).availableSpell = null;

    // Send direct event to target socket to activate visual effect immediately
    io.to(target.socketId).emit('debuff:applied', {
      type: spell,
      duration: 5,
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
      Object.values(room.players).forEach(p => {
        p.score = 0;
        p.currentRound = 1;
        p.roundScores = {};
        p.solvedKeywords = {};
        p.activeDebuff = null;
        p.isImmuneThisRound = false;
        (p as any).availableSpell = null;
      });

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
