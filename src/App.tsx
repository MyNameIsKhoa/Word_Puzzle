import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield, Zap, Award, Users, Play, RefreshCw,
  AlertCircle, CheckCircle2, XCircle, Gamepad2,
  Timer, Lightbulb, Trophy, Sparkles, Target,
  Smile, Flame, Lock, Tv, ArrowLeft, Image as ImageIcon, HelpCircle
} from 'lucide-react';
import { Player, SpellType } from './types';

class SoundEffects {
  private static playTone(freq: number, type: OscillatorType, duration: number, delay = 0) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration - 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration);
    } catch (e) { }
  }
  static playCorrect() { this.playTone(523.25, 'sine', 0.1); this.playTone(659.25, 'sine', 0.15, 0.08); this.playTone(783.99, 'sine', 0.25, 0.16); }
  static playIncorrect() { this.playTone(180, 'sawtooth', 0.3); }
  static playPowerUp() { this.playTone(587.33, 'triangle', 0.1); this.playTone(880, 'triangle', 0.2, 0.08); }
  static playDebuff() { this.playTone(110, 'sawtooth', 0.6); }
  static playShield() { this.playTone(880, 'sine', 0.08); this.playTone(698.46, 'sine', 0.15, 0.05); }
}

let socket: Socket;

interface Bubble {
  id: string;
  char: string;
  used: boolean;
  colorClass: string;
  offsetX: number;
  offsetY: number;
  rotate: number;
  borderRadius: string;
}

interface AnswerSlot {
  char: string | null;
  sourceId: string | null;
}

const COLORS = [
  'bg-red-200 text-red-900 border-red-300',
  'bg-blue-200 text-blue-900 border-blue-300',
  'bg-emerald-200 text-emerald-900 border-emerald-300',
  'bg-amber-200 text-amber-900 border-amber-300',
  'bg-purple-200 text-purple-900 border-purple-300',
  'bg-pink-200 text-pink-900 border-pink-300',
  'bg-cyan-200 text-cyan-900 border-cyan-300',
  'bg-orange-200 text-orange-900 border-orange-300'
];

export default function App() {
  const [role, setRole] = useState<'SELECT' | 'HOST' | 'PLAYER'>('SELECT');
  const [roomId, setRoomId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [gameState, setGameState] = useState<'LOBBY' | 'PLAYING' | 'FINISHED'>('LOBBY');
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('');

  const [playerRound, setPlayerRound] = useState<number>(1);
  const [activeQuestion, setActiveQuestion] = useState<any>(null);
  const [typedAnswer, setTypedAnswer] = useState<AnswerSlot[]>([]);
  const [pool, setPool] = useState<Bubble[]>([]);
  const [timeRemaining, setTimeRemaining] = useState<number>(45);
  const [isSubmitCooldown, setIsSubmitCooldown] = useState<boolean>(false);

  const [resultPopup, setResultPopup] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const [knowledgePopup, setKnowledgePopup] = useState<any>(null);
  const [nextButtonCooldown, setNextButtonCooldown] = useState<number>(0);
  const [debuffToast, setDebuffToast] = useState<{ spell: SpellType; caster: string } | null>(null);

  const [magicCooldown, setMagicCooldown] = useState<number>(0);
  const [magicActive, setMagicActive] = useState<boolean>(false);
  const [magicQuestion, setMagicQuestion] = useState<any>(null);
  const [magicResultText, setMagicResultText] = useState<{ text: string, isError: boolean } | null>(null);
  const [magicTimeLeft, setMagicTimeLeft] = useState<number>(10);
  const [selectedMagicOption, setSelectedMagicOption] = useState<number | null>(null);
  const [inventory, setInventory] = useState<Record<SpellType, number>>({ clean: 0, banana: 0, powerout: 0, earthquake: 0 });
  const [targetModal, setTargetModal] = useState<SpellType | null>(null);

  const [activeDebuff, setActiveDebuff] = useState<SpellType | null>(null);
  const [debuffCaster, setDebuffCaster] = useState<string>('');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showTutorial, setShowTutorial] = useState<boolean>(false);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [globalTimer, setGlobalTimer] = useState<number>(735);

  const roleRef = useRef(role);
  const soundEnabledRef = useRef(soundEnabled);
  const activeQuestionRef = useRef<any>(null);
  const isTimeoutFired = useRef(false);

  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { activeQuestionRef.current = activeQuestion; }, [activeQuestion]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (knowledgePopup) {
      setNextButtonCooldown(3);
      interval = setInterval(() => {
        setNextButtonCooldown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setNextButtonCooldown(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [knowledgePopup]);

  useEffect(() => {
    let qTimer: NodeJS.Timeout;
    if (role === 'PLAYER' && gameState === 'PLAYING' && !knowledgePopup && resultPopup?.type !== 'success') {
      qTimer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            if (!isTimeoutFired.current) {
              isTimeoutFired.current = true;
              handleRoundTimeout();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(qTimer);
  }, [role, gameState, resultPopup, knowledgePopup]);

  useEffect(() => {
    let mTimer: NodeJS.Timeout;
    if (magicActive && magicTimeLeft > 0 && selectedMagicOption === null && !magicResultText) {
      mTimer = setInterval(() => {
        setMagicTimeLeft((prev) => {
          if (prev <= 1) {
            setMagicResultText({ text: 'Hết thời gian!', isError: true });
            SoundEffects.playIncorrect();
            setTimeout(() => {
              setMagicActive(false);
              setMagicCooldown(20);
              setMagicResultText(null);
            }, 1500);
            return 10;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(mTimer);
  }, [magicActive, magicTimeLeft, selectedMagicOption, magicResultText]);

  useEffect(() => {
    let cTimer: NodeJS.Timeout;
    if (magicCooldown > 0) {
      cTimer = setInterval(() => setMagicCooldown(prev => prev - 1), 1000);
    }
    return () => clearInterval(cTimer);
  }, [magicCooldown]);

  // Hệu ứng Động Đất: Xáo trộn vị trí các từ liên tục
  useEffect(() => {
    let eqTimer: NodeJS.Timeout;
    if (activeDebuff === 'earthquake') {
      eqTimer = setInterval(() => {
        setPool(prev => {
          const newPool = [...prev];
          // Trộn mảng
          for (let i = newPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newPool[i], newPool[j]] = [newPool[j], newPool[i]];
          }
          // Đổi offset
          return newPool.map(b => ({
            ...b,
            offsetX: Math.floor(Math.random() * 80 - 40),
            offsetY: Math.floor(Math.random() * 80 - 40),
            rotate: Math.floor(Math.random() * 60 - 30)
          }));
        });
      }, 700);
    }
    return () => clearInterval(eqTimer);
  }, [activeDebuff]);

  useEffect(() => {
    socket = io(import.meta.env.VITE_BACKEND_URL || undefined);

    socket.on('room:updated', (data: any) => {
      setGameState(data.status);
      setPlayers(data.players);
      setCurrentRoom(data.roomId);
      const me = data.players.find((p: any) => p.socketId === socket.id);
      if (me) {
        setPlayerRound(me.currentRound);
        if (me.inventory) setInventory(me.inventory);
        if (me.currentRound > 15) setGameState('FINISHED');
      }
    });

    socket.on('game:started', () => {
      setGameState('PLAYING');
      setResultPopup(null);
      setKnowledgePopup(null);
      if (roleRef.current === 'PLAYER') loadQuestion();
    });

    socket.on('game:reset', () => {
      setGameState('LOBBY');
      setPlayers([]);
      setResultPopup(null);
      setKnowledgePopup(null);
      setActiveQuestion(null);
      setTypedAnswer([]);
      setPool([]);
      setInventory({ clean: 0, banana: 0, powerout: 0, earthquake: 0 });
      setTargetModal(null);
      setDebuffToast(null);
    });

    socket.on('host:left', () => {
      setErrorMsg('Màn hình Host đã đóng kết nối!');
      setRole('SELECT');
    });

    socket.on('game:pause_state_changed', (paused: boolean) => {
      setIsPaused(paused);
    });

    socket.on('game:time_up_force_end', () => {
      setGameState('FINISHED');
    });

    socket.on('host:timer_update', (timeLeft: number) => {
      setGlobalTimer(timeLeft);
    });

    socket.on('debuff:applied', (data: any) => {
      if (soundEnabledRef.current) SoundEffects.playDebuff();
      setActiveDebuff(data.type);
      setDebuffCaster(data.casterName);
      setDebuffToast({ spell: data.type, caster: data.casterName });
      setTimeout(() => setActiveDebuff(null), data.duration * 1000);
      setTimeout(() => setDebuffToast(null), 5000);
    });

    return () => { socket.disconnect(); };
  }, []);

  const generateBubbleStyle = (idx: number) => ({
    colorClass: COLORS[idx % COLORS.length],
    offsetX: Math.floor(Math.random() * 30 - 15),
    offsetY: Math.floor(Math.random() * 30 - 15),
    rotate: Math.floor(Math.random() * 20 - 10),
    borderRadius: `${Math.floor(Math.random() * 15 + 20)}% ${Math.floor(Math.random() * 15 + 20)}% ${Math.floor(Math.random() * 15 + 20)}% ${Math.floor(Math.random() * 15 + 20)}%`
  });

  const loadQuestion = () => {
    isTimeoutFired.current = false;
    socket.emit('player:ready_for_question', (res: any) => {
      if (res.success) {
        setActiveQuestion(res);
        setTypedAnswer(Array(res.wordLength).fill({ char: null, sourceId: null }));

        const newPool = res.keyboard.map((char: string, idx: number) => {
          const style = generateBubbleStyle(idx);
          return {
            id: `bubble-${idx}-${Date.now()}`,
            char,
            used: false,
            ...style
          };
        });

        // Shuffle pool
        for (let i = newPool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [newPool[i], newPool[j]] = [newPool[j], newPool[i]];
        }

        setPool(newPool);

        setTimeRemaining(res.isMasterRound ? 60 : 45);
        setResultPopup(null);
        setKnowledgePopup(null);
      } else {
        setErrorMsg(res.error || 'Lỗi tải câu hỏi!');
      }
    });
  };

  const handleRoundTimeout = () => {
    socket.emit('player:timeout', (res: any) => {
      if (res.success) {
        if (soundEnabledRef.current) SoundEffects.playIncorrect();
        setKnowledgePopup({ ...activeQuestionRef.current, isTimeout: true });
      }
    });
  };

  const handleHostCreate = () => {
    socket.emit('host:create', (res: any) => {
      if (res.success) { setCurrentRoom(res.roomId); setRole('HOST'); }
      else { setErrorMsg(res.error || 'Không thể khởi tạo phòng!'); }
    });
  };

  const handlePlayerJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId || !teamName) return setErrorMsg('Vui lòng điền đầy đủ Mã phòng và Tên đội!');
    socket.emit('player:join', { roomId, teamName }, (res: any) => {
      if (res.success) { setCurrentRoom(roomId); setRole('PLAYER'); setErrorMsg(''); }
      else { setErrorMsg(res.error || 'Không thể tham gia phòng!'); }
    });
  };

  const handleHostStart = () => socket.emit('host:start', { roomId: currentRoom }, () => { });
  const handleHostReset = () => socket.emit('host:reset', { roomId: currentRoom }, () => { });

  const handleBubbleClick = (bubble: Bubble) => {
    const nextIdx = typedAnswer.findIndex(slot => slot.char === null);
    if (nextIdx !== -1) {
      const updatedAns = [...typedAnswer];
      updatedAns[nextIdx] = { char: bubble.char, sourceId: bubble.id };
      setTypedAnswer(updatedAns);

      setPool(prevPool => prevPool.map(p => p.id === bubble.id ? { ...p, used: true } : p));
    }
  };

  const handleUndo = (idx: number) => {
    const slot = typedAnswer[idx];
    if (slot && slot.sourceId) {
      const updatedAns = [...typedAnswer];
      updatedAns[idx] = { char: null, sourceId: null };
      setTypedAnswer(updatedAns);

      setPool(prevPool => prevPool.map(p => p.id === slot.sourceId ? { ...p, used: false } : p));
    }
  };

  const handleAnswerSubmit = () => {
    if (isSubmitCooldown) return;
    const ansStr = typedAnswer.map(s => s.char).join('');
    if (ansStr.length < (activeQuestion?.wordLength || 0)) {
      setResultPopup({ type: 'error', msg: 'Vui lòng hoàn thành tất cả ô chữ trước khi gửi!' });
      if (soundEnabled) SoundEffects.playIncorrect();
      return;
    }
    setIsSubmitCooldown(true);
    socket.emit('player:submit_answer', { answer: ansStr }, (res: any) => {
      setIsSubmitCooldown(false);
      if (res.success) {
        if (res.correct) {
          setResultPopup({ type: 'success', msg: `Chính xác! Bạn nhận được ${res.scoreEarned} điểm.` });
          if (soundEnabled) SoundEffects.playCorrect();
          setTimeout(() => {
            setResultPopup(null);
            setKnowledgePopup({ ...activeQuestionRef.current, isTimeout: false });
          }, 1500);
        } else {
          setResultPopup({ type: 'error', msg: 'Đáp án sai! Hãy suy luận lại.' });
          if (soundEnabled) SoundEffects.playIncorrect();
        }
      }
    });
  };

  const handleRequestMagic = () => {
    if (magicCooldown > 0) return;
    socket.emit('player:request_spell', (res: any) => {
      if (res.success) {
        setMagicQuestion(res);
        setMagicActive(true);
        setMagicTimeLeft(10);
        setSelectedMagicOption(null);
      }
    });
  };

  const handleSubmitMagic = (optIndex: number) => {
    setSelectedMagicOption(optIndex);
    socket.emit('player:submit_spell', { selectedIndex: optIndex }, (res: any) => {
      if (res.success && res.correct) {
        setMagicResultText({ text: 'Chính xác! Đang nhận vật phẩm...', isError: false });
        if (soundEnabledRef.current) SoundEffects.playPowerUp();
      } else {
        setMagicResultText({ text: 'Sai rồi! Hẹn lần sau.', isError: true });
        if (soundEnabledRef.current) SoundEffects.playIncorrect();
      }
      setTimeout(() => {
        setMagicActive(false);
        setMagicCooldown(15);
        setMagicResultText(null);
      }, 1500);
    });
  };

  const handleCastSpell = (targetSocketId: string, spellType: SpellType) => {
    socket.emit('player:cast_spell', { targetSocketId, spellType }, (res: any) => {
      if (res.success) {
        if (spellType === 'clean' && res.cleanedKeyboard) {
          setTypedAnswer(Array(activeQuestion.wordLength).fill({ char: null, sourceId: null }));
          setPool(prevPool => {
            let toKeep = [...res.cleanedKeyboard];
            return prevPool.map(b => {
              const idx = toKeep.indexOf(b.char);
              if (idx !== -1) {
                toKeep.splice(idx, 1);
                return { ...b, used: false };
              }
              return { ...b, used: true };
            });
          });
          if (soundEnabledRef.current) SoundEffects.playShield();
        } else {
          if (soundEnabledRef.current) SoundEffects.playPowerUp();
        }
        setTargetModal(null);
      } else {
        setResultPopup({ type: 'error', msg: res.error || 'Lỗi dùng vật phẩm!' });
      }
    });
  };

  const handleSpellActionClick = (spellId: SpellType) => {
    if (inventory[spellId] <= 0) return;
    if (spellId === 'clean') {
      handleCastSpell(socket.id, spellId);
    } else {
      setTargetModal(spellId);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col justify-between selection:bg-emerald-200 selection:text-slate-900 overflow-x-hidden relative min-w-[1200px]">

      {/* Debuff Toast */}
      <AnimatePresence>
        {debuffToast && (
          <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, scale: 0.9 }}
            className="fixed top-8 right-8 z-[400] bg-orange-600 text-white px-6 py-4 rounded-2xl shadow-2xl border-4 border-orange-400 flex items-center gap-4"
          >
            <AlertCircle size={32} className="animate-bounce text-yellow-300" />
            <div>
              <p className="font-black text-lg">🚨 BÁO ĐỘNG!</p>
              <p className="font-medium text-orange-100">🚨 <strong>{debuffToast.caster}</strong> vừa 'úp sọt' bạn bằng <strong className="uppercase text-yellow-300">{
                debuffToast.spell === 'banana' ? 'Vỏ Chuối' :
                  debuffToast.spell === 'powerout' ? 'Cúp Điện' :
                    debuffToast.spell === 'earthquake' ? 'Động Đất' : 'Vật Phẩm'
              }</strong>!</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {role === 'PLAYER' && activeDebuff === 'powerout' && (
        <div className="fixed inset-0 z-[100] pointer-events-none transition-all duration-75"
          style={{ background: `radial-gradient(circle 120px at ${mousePos.x}px ${mousePos.y}px, transparent 100%, rgba(15, 23, 42, 0.98) 100%)` }} />
      )}

      {role === 'PLAYER' && activeDebuff === 'banana' && (
        <div className="fixed z-[100] pointer-events-none select-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
          style={{ left: mousePos.x, top: mousePos.y }}>
          <span className="text-[800px] animate-bounce leading-none drop-shadow-2xl">🍌</span>
        </div>
      )}

      {/* Target Selection Modal */}
      <AnimatePresence>
        {targetModal && (
          <div className="fixed inset-0 z-[250] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-4xl w-[90vw] shadow-2xl border-2 border-purple-200"
            >
              <h3 className="text-2xl font-black text-slate-800 text-center mb-6">Chọn Mục Tiêu</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto pr-2 pb-2">
                {players
                  .filter(p => p.socketId !== socket.id)
                  .sort((a, b) => a.teamName.localeCompare(b.teamName))
                  .map(p => (
                    <button
                      key={p.socketId}
                      onClick={() => handleCastSpell(p.socketId, targetModal as SpellType)}
                      disabled={p.immuneUntil > Date.now()}
                      className="w-full flex justify-between items-center p-3 bg-slate-50 border-2 border-slate-200 hover:border-purple-500 hover:bg-purple-100 hover:-translate-y-1 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-sm"
                    >
                      <span className="font-bold text-slate-700 truncate text-base" title={p.teamName}>{p.teamName}</span>
                      {p.immuneUntil > Date.now() && (
                        <span className="text-emerald-500 flex-shrink-0" title="Đang có khiên"><Shield size={18} className="fill-emerald-100" /></span>
                      )}
                    </button>
                  ))}
                {players.filter(p => p.socketId !== socket.id).length === 0 && (
                  <div className="col-span-full text-center text-slate-400 font-bold py-8">Chưa có đối thủ nào trong phòng!</div>
                )}
              </div>
              <button onClick={() => setTargetModal(null)} className="mt-6 w-full py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold transition shadow-sm">Hủy Bỏ</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Knowledge Popup */}
      <AnimatePresence>
        {knowledgePopup && (
          <div className="fixed inset-0 z-[300] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border-4 border-emerald-500 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className={`p-6 text-white text-center ${knowledgePopup.isTimeout ? 'bg-gradient-to-r from-red-500 to-rose-600' : 'bg-gradient-to-r from-emerald-500 to-teal-600'}`}>
                <Lightbulb size={48} className={`mx-auto mb-3 animate-pulse ${knowledgePopup.isTimeout ? 'text-red-200' : 'text-yellow-300'}`} />
                <h3 className="text-3xl font-black">{knowledgePopup.isTimeout ? 'ĐÃ HẾT GIỜ!' : 'NỘI DUNG KIẾN THỨC'}</h3>
                <p className="mt-2 font-bold text-lg text-white/80">Đáp án: <span className="text-white text-2xl ml-2 tracking-widest uppercase">{knowledgePopup.displayWord}</span></p>
              </div>
              <div className="p-8 overflow-y-auto space-y-4">
                {knowledgePopup.reviewContent?.map((txt: string, i: number) => (
                  <div key={i} className="flex gap-4 items-start bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <span className="text-emerald-500 mt-1"><CheckCircle2 size={24} /></span>
                    <p className="text-slate-700 text-lg font-medium leading-relaxed">{txt}</p>
                  </div>
                ))}
              </div>
              <div className="p-6 bg-slate-50 border-t border-slate-200 text-center">
                <button
                  onClick={() => { setKnowledgePopup(null); loadQuestion(); }}
                  disabled={nextButtonCooldown > 0}
                  className={`text-white font-black text-xl py-4 px-12 rounded-2xl shadow-xl transition-all ${nextButtonCooldown > 0 ? 'bg-slate-400 cursor-not-allowed opacity-80' : `hover:scale-105 cursor-pointer ${knowledgePopup.isTimeout ? 'bg-red-500 hover:bg-red-400' : 'bg-emerald-500 hover:bg-emerald-400'}`}`}
                >
                  {nextButtonCooldown > 0 ? `TIẾP TỤC (${nextButtonCooldown}s)` : 'TIẾP TỤC'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Result Popup */}
      <AnimatePresence>
        {resultPopup && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] w-full max-w-md bg-white rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] border-2 overflow-hidden"
            style={{ borderColor: resultPopup.type === 'success' ? '#10b981' : resultPopup.type === 'error' ? '#ef4444' : '#3b82f6' }}
          >
            <div className={`p-6 text-center ${resultPopup.type === 'success' ? 'bg-emerald-50' : resultPopup.type === 'error' ? 'bg-red-50' : 'bg-blue-50'}`}>
              <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4 ${resultPopup.type === 'success' ? 'bg-emerald-100 text-emerald-600' :
                resultPopup.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                }`}>
                {resultPopup.type === 'success' ? <CheckCircle2 size={32} /> : resultPopup.type === 'error' ? <XCircle size={32} /> : <AlertCircle size={32} />}
              </div>
              <h3 className="text-xl font-black text-slate-800">{resultPopup.msg}</h3>
              {resultPopup.type === 'error' && (
                <button onClick={() => setResultPopup(null)} className="mt-4 bg-white border-2 border-slate-200 hover:border-slate-300 px-6 py-2 rounded-xl font-bold text-slate-600 transition">Đóng</button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTutorial && (
          <div className="fixed inset-0 z-[400] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-6 bg-slate-800 text-white flex justify-between items-center">
                <h3 className="text-2xl font-black flex items-center gap-2"><HelpCircle size={28} className="text-emerald-400" /> HƯỚNG DẪN LUẬT CHƠI</h3>
                <button onClick={() => setShowTutorial(false)} className="p-2 hover:bg-slate-700 rounded-xl transition text-slate-300 hover:text-white"><XCircle size={28} /></button>
              </div>
              <div className="p-8 overflow-y-auto space-y-6">
                <div>
                  <h4 className="text-xl font-bold text-slate-800 mb-2 border-b-2 border-emerald-500 inline-block">1. Luật tính điểm</h4>
                  <ul className="list-disc pl-5 mt-3 text-slate-600 font-medium space-y-2">
                    <li>Mỗi vòng có 45 giây. Trả lời đúng trong 15s đầu: <b>100 điểm</b>.</li>
                    <li>Từ 15s - 45s: Điểm giảm dần từ 100 xuống 70 điểm.</li>
                    <li>Vòng Master (60s): Trả lời đúng nhận <b>500 điểm</b> lật kèo.</li>
                    <li>Hết giờ: Vòng chơi kết thúc, bạn sẽ được xem Nội dung ôn tập.</li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-xl font-bold text-slate-800 mb-2 border-b-2 border-emerald-500 inline-block">2. Vật phẩm cản trở</h4>
                  <p className="text-slate-600 mb-3 font-medium">Bấm vào nút <b>Nhận vật phẩm</b> ở góc phải dưới màn hình. Trả lời đúng 1 câu hỏi phụ để nhận ngẫu nhiên một trong các vật phẩm sau:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-2 mb-2"><Sparkles className="text-yellow-500" /> <span className="font-bold">Thanh Tẩy</span></div>
                      <p className="text-sm text-slate-600">Loại bỏ toàn bộ chữ cái gây nhiễu, chỉ giữ lại đúng các chữ cái của đáp án.</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-2 mb-2"><Flame className="text-orange-500" /> <span className="font-bold">Vỏ Chuối</span></div>
                      <p className="text-sm text-slate-600">Ném vào đối thủ khiến màn hình của họ bị che khuất và choáng trong 8 giây.</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-2 mb-2"><Zap className="text-blue-500" /> <span className="font-bold">Mù Tạm Thời</span></div>
                      <p className="text-sm text-slate-600">Gây mù lòa (tối đen màn hình) đối thủ trong 5 giây.</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-2 mb-2"><Target className="text-red-500" /> <span className="font-bold">Động Đất</span></div>
                      <p className="text-sm text-slate-600">Xáo trộn và rung lắc liên tục toàn bộ chữ cái của đối thủ trong 5 giây.</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm italic text-slate-500 bg-blue-50 p-3 rounded-lg">Lưu ý: Khi dùng <b>vật phẩm cản trở</b> lên một đối thủ, họ sẽ nhận được <b>Khiên bảo vệ</b> trong thời gian 15 giây để chống bị tấn công liên tục.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between shadow-sm relative z-40">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg flex items-center justify-center text-white font-black text-xl">M</div>
          <div>
            <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent tracking-tight">WORD PUZZLE</h1>
            <p className="text-sm text-slate-500 font-medium">Chủ đề 5.3: Thể chế kinh tế thị trường định hướng XHCN</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setShowTutorial(true)} className="p-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition" title="Hướng dẫn chơi">
            <HelpCircle size={24} />
          </button>
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="p-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition" title="Âm thanh">
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          {currentRoom && (
            <div className="px-5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-sm font-bold text-slate-600">PHÒNG: <strong className="text-slate-900 text-lg ml-1">{currentRoom}</strong></span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 w-full p-4 relative z-10 flex flex-col">
        {role === 'SELECT' && (
          <div className="max-w-lg w-full mx-auto bg-white border border-slate-200 rounded-3xl p-10 shadow-2xl my-auto">
            <div className="text-center mb-10">
              <span className="text-xs font-black tracking-widest uppercase text-emerald-600 bg-emerald-50 px-4 py-1.5 rounded-full">Bắt Đầu Chơi</span>
              <h2 className="text-3xl font-black mt-6 text-slate-800">CHỌN VAI TRÒ</h2>
            </div>
            <div className="space-y-4">
              <button onClick={handleHostCreate} className="w-full group p-6 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition text-left flex items-center gap-5 cursor-pointer">
                <div className="p-4 bg-emerald-100 rounded-xl text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white transition"><Tv size={28} /></div>
                <div>
                  <h3 className="font-black text-lg text-slate-800">Host (Máy Chiếu)</h3>
                  <p className="text-sm text-slate-500 mt-1 font-medium">Tạo phòng và trình chiếu Bảng xếp hạng</p>
                </div>
              </button>
              <div className="relative flex py-4 items-center">
                <div className="flex-grow border-t-2 border-slate-100"></div>
                <span className="mx-4 text-slate-400 font-bold text-sm">HOẶC THAM GIA</span>
                <div className="flex-grow border-t-2 border-slate-100"></div>
              </div>
              <form onSubmit={handlePlayerJoin} className="space-y-5 bg-slate-50 p-6 rounded-2xl border border-slate-200">
                <div>
                  <input type="text" placeholder="Mã Phòng (4 số)" value={roomId} onChange={(e) => setRoomId(e.target.value.replace(/\D/g, '').slice(0, 4))} className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 font-black text-center text-lg placeholder-slate-400 focus:border-emerald-500 focus:outline-none transition" />
                </div>
                <div>
                  <input type="text" placeholder="Tên Đội (Ví dụ: Nhóm 1)" value={teamName} onChange={(e) => setTeamName(e.target.value)} className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 font-bold text-center text-lg placeholder-slate-400 focus:border-emerald-500 focus:outline-none transition" />
                </div>
                {errorMsg && <p className="text-red-500 font-bold text-center text-sm">{errorMsg}</p>}
                <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 rounded-xl shadow-lg shadow-emerald-500/30 transition text-lg cursor-pointer">VÀO PHÒNG</button>
              </form>
            </div>
          </div>
        )}

        {role === 'HOST' && (
          <div className="w-full h-full flex flex-col bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-800 p-8 text-white flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-emerald-400">ĐẤU TRƯỜNG THƯƠNG TRƯỜNG</h2>
                <div className="flex items-center gap-4 mt-2">
                  <p className="text-slate-400 font-medium">Bảng Xếp Hạng Tổng Hợp</p>
                  {gameState === 'PLAYING' && (
                    <div className="bg-slate-900/50 px-4 py-1.5 rounded-lg border border-slate-700 flex items-center gap-2">
                      <span className="text-slate-400 font-bold text-sm">Thời gian:</span>
                      <span className={`font-mono text-xl font-black tracking-widest ${globalTimer <= 60 ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                        {Math.floor(globalTimer / 60).toString().padStart(2, '0')}:{(globalTimer % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => window.location.reload()} className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer">
                  Về Trang Chủ
                </button>
                {gameState === 'LOBBY' && (
                  <button onClick={handleHostStart} disabled={players.length === 0} className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-600 disabled:text-slate-400 text-slate-900 font-black py-4 px-10 rounded-2xl shadow-xl transition-all text-xl cursor-pointer">BẮT ĐẦU CHƠI</button>
                )}
                {gameState === 'PLAYING' && (
                  <button onClick={() => socket?.emit('host:toggle_pause', { roomId: currentRoom }, () => {})} className={`font-bold py-3 px-6 rounded-xl transition cursor-pointer ${isPaused ? 'bg-amber-500 hover:bg-amber-400 text-slate-900' : 'bg-slate-600 hover:bg-slate-500 text-white'}`}>
                    {isPaused ? 'Tiếp tục Game' : 'Tạm dừng'}
                  </button>
                )}
                {gameState !== 'LOBBY' && (
                  <button onClick={handleHostReset} className="bg-red-500 hover:bg-red-400 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer">Làm lại</button>
                )}
              </div>
            </div>
            <div className="flex-1 p-8 bg-slate-50">
              {players.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <Users size={64} className="mb-4 opacity-50" />
                  <p className="text-2xl font-black">Chưa có đội nào tham gia</p>
                  <p className="text-lg mt-2">Nhập mã phòng <strong className="text-slate-800 text-3xl ml-2">{currentRoom}</strong> để vào</p>
                </div>
              ) : (
                <div className="space-y-4 max-w-4xl mx-auto">
                  {players.sort((a, b) => b.score - a.score).map((p, idx) => (
                    <motion.div layout key={p.socketId} className="bg-white border-2 border-slate-200 rounded-2xl p-5 flex items-center shadow-sm">
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center font-black text-2xl mr-6 ${idx === 0 ? 'bg-amber-400 text-amber-900' : idx === 1 ? 'bg-slate-300 text-slate-800' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{idx + 1}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl font-black text-slate-800">{p.teamName}</span>
                          {p.immuneUntil > Date.now() && <span className="bg-emerald-100 text-emerald-600 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200 flex items-center gap-1"><Shield size={14} /> Khiên</span>}
                        </div>
                        <div className="w-full bg-slate-100 h-4 rounded-full mt-3 overflow-hidden border border-slate-200">
                          <motion.div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (p.score / 1200) * 100)}%` }} transition={{ duration: 0.8 }} />
                        </div>
                      </div>
                      <div className="ml-8 text-right">
                        <div className="text-4xl font-black text-emerald-500 font-mono">{p.score}</div>
                        <div className="text-sm font-bold text-slate-400 mt-1">{p.currentRound <= 15 ? `VÒNG ${p.currentRound}` : 'HOÀN THÀNH'}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {role === 'PLAYER' && gameState === 'LOBBY' && (
          <div className="m-auto bg-white border-2 border-slate-200 rounded-3xl p-16 text-center shadow-2xl max-w-2xl w-full flex flex-col items-center">
            <Users size={80} className="text-emerald-500 mx-auto mb-8 animate-pulse" />
            <h2 className="text-4xl font-black text-slate-800">XIN CHÀO: <span className="text-emerald-600">{teamName.toUpperCase()}</span></h2>
            <p className="text-xl text-slate-500 font-medium mt-4">Vui lòng chờ Host bắt đầu trận đấu...</p>
            <button onClick={() => window.location.reload()} className="mt-8 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 px-8 rounded-xl transition cursor-pointer border border-slate-300">
              Quay lại màn hình chính
            </button>
          </div>
        )}

        {/* UNIFIED FINISHED SCREEN FOR PLAYER */}
        {role === 'PLAYER' && gameState === 'FINISHED' && (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white border-2 border-emerald-300 rounded-3xl shadow-2xl overflow-hidden relative">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-8 text-center text-white">
                <Trophy size={80} className="mx-auto mb-4 text-yellow-300 animate-bounce" />
                <h2 className="text-4xl font-black">KẾT THÚC TRÒ CHƠI!</h2>
                <p className="text-lg font-medium mt-2 text-emerald-100">Bảng Xếp Hạng Tổng Kết</p>
              </div>
              <div className="p-8 bg-slate-50 h-[500px] overflow-y-auto space-y-4">
                {players.sort((a, b) => b.score - a.score).map((p, idx) => {
                  const isMe = p.socketId === socket.id;
                  return (
                    <div key={p.socketId} className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${isMe ? 'bg-emerald-100 border-emerald-400 shadow-lg scale-[1.02]' : 'bg-white border-slate-200'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-2xl ${idx === 0 ? 'bg-amber-400 text-amber-900' : idx === 1 ? 'bg-slate-300 text-slate-800' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {idx + 1}
                        </div>
                        <div>
                          <span className={`text-xl font-black ${isMe ? 'text-emerald-900' : 'text-slate-700'}`}>{p.teamName} {isMe && ' (BẠN)'}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-3xl font-black font-mono ${isMe ? 'text-emerald-700' : 'text-emerald-500'}`}>{p.score}</span>
                        <p className="text-xs font-bold text-slate-500">ĐIỂM</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-slate-100 p-6 flex justify-center border-t border-slate-200">
                <button onClick={() => window.location.reload()} className="px-8 py-3 bg-white border-2 border-slate-300 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors shadow-sm">
                  Quay lại màn hình chính
                </button>
              </div>
            </div>
          </div>
        )}

        {role === 'PLAYER' && gameState === 'PLAYING' && activeQuestion && (
          <div className="grid grid-cols-12 gap-4 h-full">

            {/* COLUMN 1: LEFT SIDEBAR (Col-span-1 - Kho Đồ Thu Nhỏ) */}
            <div className="col-span-1 flex flex-col gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl py-4 px-2 shadow-sm flex flex-col items-center h-full">
                <h3 className="font-black text-slate-400 text-[10px] tracking-widest uppercase mb-4 text-center">Kho</h3>
                <div className="space-y-4 flex flex-col items-center w-full">
                  {[
                    { id: 'clean', icon: <Sparkles size={20} />, color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200', tooltip: 'Thanh Tẩy: Xóa chữ nhiễu' },
                    { id: 'banana', icon: <span className="text-xl">🍌</span>, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-300', tooltip: 'Vỏ Chuối: Mù 5s' },
                    { id: 'powerout', icon: <Zap size={20} />, color: 'text-slate-800', bg: 'bg-slate-100', border: 'border-slate-300', tooltip: 'Cúp Điện: Tối đen 5s' },
                    { id: 'earthquake', icon: <span className="text-xl">🌋</span>, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', tooltip: 'Động Đất: Rung lắc' }
                  ].map(spell => {
                    const count = inventory[spell.id as SpellType] || 0;
                    const isActive = count > 0;
                    return (
                      <div key={spell.id} className="group relative w-full flex justify-center">
                        <div onClick={() => isActive ? handleSpellActionClick(spell.id as SpellType) : undefined} className={`relative w-14 h-14 rounded-xl border-2 flex items-center justify-center transition-all ${isActive ? `${spell.bg} ${spell.border} shadow-md hover:scale-110 cursor-pointer` : 'bg-slate-50 border-slate-200 opacity-50 grayscale cursor-not-allowed'}`}>
                          <div className={isActive ? spell.color : 'text-slate-400'}>{spell.icon}</div>
                          <span className={`absolute -bottom-2 -right-2 px-1.5 py-0.5 text-[10px] font-black rounded border shadow-sm ${isActive ? 'bg-red-500 text-white border-red-600' : 'bg-slate-200 text-slate-500 border-slate-300'}`}>
                            x{count}
                          </span>
                        </div>
                        {/* Tooltip */}
                        <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-800 text-white text-[10px] font-bold rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                          {spell.tooltip}
                          <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 bg-slate-800 rotate-45"></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* COLUMN 2: CENTER (Col-span-8) */}
            <div className="col-span-8 flex flex-col gap-6">

              {/* Question Card */}
              <div className="bg-white border-2 border-emerald-100 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col min-h-[140px]">
                <div className="absolute top-0 left-0 bg-slate-800 text-white font-bold px-4 py-1.5 rounded-br-2xl shadow text-sm flex items-center gap-2">
                  👤 {teamName}
                </div>
                <div className="absolute top-0 right-0 bg-emerald-500 text-white font-black px-6 py-2 rounded-bl-2xl shadow">
                  {activeQuestion.isMasterRound ? 'VÒNG MASTER' : `VÒNG ${activeQuestion.round}`}
                </div>
                <div className="flex-1 flex flex-col justify-center items-center text-center mt-2">
                  <h3 className="text-2xl font-bold text-slate-700 leading-snug max-w-2xl">
                    {activeQuestion.hint}
                  </h3>
                </div>
              </div>

              {/* Puzzle Area - BIGGER */}
              <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-inner flex flex-col gap-10 flex-1 relative min-h-[400px]">

                {/* Answer Row (with Undo interaction) - BIGGER */}
                <div className="flex justify-center flex-wrap gap-4 z-20">
                  {typedAnswer.map((slot, idx) => (
                    <div key={idx} onClick={() => handleUndo(idx)} className="w-20 h-24 border-[3px] border-slate-300 rounded-2xl bg-white shadow-sm flex items-center justify-center cursor-pointer hover:border-red-300 transition-colors relative">
                      {slot.char && (
                        <motion.div layoutId={slot.sourceId!} className="absolute inset-0 m-auto w-16 h-20 bg-emerald-500 flex items-center justify-center font-black text-4xl text-white shadow-md z-30" style={{ borderRadius: '16px' }}>
                          {slot.char}
                        </motion.div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Floating Bubbles Pool - BIGGER & SCATTERED NO OVERLAP */}
                <div className={`relative flex-1 bg-white border-2 border-dashed border-slate-300 rounded-2xl p-6 flex flex-wrap justify-center items-center gap-6 ${activeDebuff === 'earthquake' ? 'animate-shake' : ''}`}>
                  <AnimatePresence>
                    {pool.map((b) => (
                      <div key={b.id} className="relative w-24 h-24 flex items-center justify-center" style={{ visibility: b.used ? 'hidden' : 'visible' }}>
                        {!b.used && (
                          <motion.div
                            layoutId={b.id}
                            onClick={() => handleBubbleClick(b)}
                            animate={{ x: b.offsetX, y: b.offsetY, rotate: b.rotate }}
                            whileHover={{ scale: 1.1 }}
                            transition={{ type: "spring", stiffness: 100, damping: 15 }}
                            className={`${activeQuestion?.isMasterRound ? 'w-20 h-20 text-3xl' : 'w-24 h-24 text-4xl'} border-[3px] shadow-lg flex items-center justify-center font-black cursor-pointer z-10 ${b.colorClass}`}
                            style={{ borderRadius: b.borderRadius }}
                          >
                            {b.char}
                          </motion.div>
                        )}
                      </div>
                    ))}
                  </AnimatePresence>
                </div>

                <button onClick={handleAnswerSubmit} disabled={isSubmitCooldown} className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black text-2xl py-5 rounded-2xl shadow-xl transition cursor-pointer">
                  CHỐT ĐÁP ÁN
                </button>
              </div>
            </div>

            {/* COLUMN 3: RIGHT SIDEBAR (Col-span-3) */}
            <div className="col-span-3 flex flex-col gap-6">

              {/* Stats Block */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Thời Gian</span>
                  <span className={`text-4xl font-black font-mono ${timeRemaining <= 10 ? 'text-red-500 animate-pulse' : 'text-slate-800'}`}>{timeRemaining}s</span>
                </div>
                <div className="w-full h-px bg-slate-100"></div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Điểm Của Bạn</span>
                  <span className="text-4xl font-black font-mono text-emerald-500">{players.find(p => p.socketId === socket.id)?.score || 0}</span>
                </div>
              </div>

              {/* Leaderboard Top 10 */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col max-h-[220px]">
                <h3 className="font-black text-slate-800 text-sm tracking-widest uppercase mb-3 border-b border-slate-100 pb-2 flex items-center gap-2 shrink-0">
                  <Award size={18} className="text-amber-500" /> Top Xếp Hạng
                </h3>
                <div className="space-y-2 overflow-y-auto pr-2 flex-1 min-h-0">
                  {players.sort((a, b) => b.score - a.score).slice(0, 10).map((p, idx) => (
                    <div key={p.socketId} className="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-700">
                        <span className={`w-5 h-5 flex items-center justify-center rounded-md text-white ${idx === 0 ? 'bg-amber-400' : idx === 1 ? 'bg-slate-400' : idx === 2 ? 'bg-amber-600' : 'bg-slate-300'}`}>{idx + 1}</span>
                        <span className="truncate max-w-[90px]">{p.teamName}</span>
                      </div>
                      <span className="font-black font-mono text-emerald-600 text-sm">{p.score}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Magic Buff Area */}
              <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-4 shadow-sm min-h-[200px] flex flex-col justify-center">
                {!magicActive ? (
                  <button onClick={handleRequestMagic} disabled={magicCooldown > 0} className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-slate-300 disabled:text-slate-500 text-white font-black py-3 px-2 rounded-xl shadow transition text-xs leading-relaxed cursor-pointer flex flex-col items-center justify-center gap-1 text-center">
                    <Sparkles size={16} className="shrink-0" />
                    {magicCooldown > 0 ? `Đang chuẩn bị câu hỏi... (${magicCooldown}s)` : 'TRẢ LỜI CÂU HỎI NHẬN VẬT PHẨM'}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-purple-700 font-black text-xs">
                      <span>CÂU HỎI PHỤ</span>
                      <span className="text-red-500 text-sm animate-pulse">{magicTimeLeft}s</span>
                    </div>
                    <p className="text-slate-800 font-bold text-xs leading-snug bg-white p-2 rounded-lg border border-purple-100">{magicQuestion.question}</p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {magicQuestion.answers.map((opt: string, idx: number) => (
                        <button key={idx} onClick={() => handleSubmitMagic(idx)} disabled={selectedMagicOption !== null} className={`w-full p-2 text-left rounded-lg border-2 text-[11px] font-bold transition ${selectedMagicOption === idx ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-purple-200 text-slate-700 hover:border-purple-400 hover:bg-purple-50'}`}>
                          <span className="inline-block w-4 h-4 text-center bg-purple-100 text-purple-700 rounded mr-1 leading-4">{String.fromCharCode(65 + idx)}</span>
                          {opt}
                        </button>
                      ))}
                    </div>
                    {magicResultText && (
                      <div className={`text-center font-black text-xs p-2 rounded-lg ${magicResultText.isError ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        {magicResultText.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {isPaused && role !== 'HOST' && (
          <div className="fixed inset-0 z-[9999] bg-slate-900/80 flex flex-col items-center justify-center p-4 backdrop-blur-md pointer-events-auto">
            <div className="bg-red-500 text-white rounded-3xl p-10 max-w-2xl text-center shadow-[0_0_100px_rgba(239,68,68,0.5)] animate-pulse">
              <h2 className="text-4xl md:text-5xl font-black mb-4">🛑 TRÒ CHƠI ĐANG TẠM DỪNG</h2>
              <p className="text-xl md:text-2xl font-bold opacity-90">Vui lòng chú ý lên bảng!</p>
            </div>
          </div>
        )}

      </main>
      <footer className="bg-white border-t border-slate-200 px-8 py-4 flex justify-between text-xs font-bold text-slate-400 relative z-40">
        <span>© 2026 Word Puzzle</span>
        <span>Chủ đề 5.3: Thể chế kinh tế thị trường định hướng XHCN</span>
      </footer>
    </div>
  );
}
