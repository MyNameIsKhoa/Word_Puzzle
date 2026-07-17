export interface Question {
  id: string;
  round: number;
  keyword: string;
  displayWord: string;
  hint: string;
  reviewContent: string[];
}

export interface MagicQuestion {
  id: string;
  question: string;
  answers: string[]; // 4 options
  correctIndex: number;
}

export type SpellType = 'clean' | 'banana' | 'powerout' | 'earthquake';

export interface Player {
  socketId: string;
  teamName: string;
  score: number;
  currentRound: number; // 1 to 15
  immuneUntil: number; // Timestamp for 15s shield
  inventory: Record<SpellType, number>;
  activeDebuff: SpellType | null;
  debuffUntil: number; // Timestamp
  debuffsReceivedThisRound: number;
  roundScores: Record<number, number>; // round number -> score
  solvedKeywords: Record<string, string>; // question id -> word if solved, or empty
}

export interface Room {
  roomId: string;
  status: 'LOBBY' | 'PLAYING' | 'FINISHED';
  players: Record<string, Player>; // socketId -> Player
  hostSocketId: string | null;
  questionOrder: string[]; // List of question IDs for this room
  isPaused: boolean;
  globalTimeLeft: number;
}
