import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Trophy, RotateCcw, Play, Users, Cpu, Info, ChevronRight, 
  Hash, Share2, UserCheck, Lock, Target, Cpu as CpuIcon
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { GameMode, GameStatus, GameState, Player, PrivatePlayerData } from './types';
import { generateBoard, getRandomInt, decimalToBinary, checkBitCorrectness, binaryToDecimal } from './utils';

const BOARD_SIZE = 8;
const ROOM_ID = window.location.pathname === '/' ? 'global-battle' : window.location.pathname.replace('/', '');

// Animações variantes para Framer Motion
const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.6, -0.05, 0.01, 0.99] } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.4 } }
};

const cardVariants = {
  initial: { opacity: 0, scale: 0.9, filter: "blur(10px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.5 } },
  hover: { y: -8, scale: 1.02, transition: { duration: 0.2 } },
  tap: { scale: 0.98 }
};

const revealVariants = {
  initial: { clipPath: "inset(0 100% 0 0)", opacity: 0 },
  animate: { clipPath: "inset(0 0% 0 0)", opacity: 1, transition: { duration: 0.8, ease: [0.6, -0.05, 0.01, 0.99] } }
};

const bitPulseVariants = {
  initial: { scale: 0, rotate: -180 },
  animate: { scale: 1, rotate: 0, transition: { type: "spring", stiffness: 200, damping: 15 } },
  exit: { scale: 0, rotate: 180 }
};

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const isRemoteUpdate = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>({
    mode: GameMode.COMPETITIVE,
    status: GameStatus.SETUP,
    board: generateBoard(BOARD_SIZE),
    currentPlayerIndex: 0,
    drawnBit: null,
    players: [
      { id: 1, name: 'Jogador 1', score: 0 },
      { id: 2, name: 'Jogador 2', score: 0 },
    ],
    winner: null,
    winClaimTimerActive: false,
    winClaimTimeLeft: 0,
    lastDraw: undefined
  });

  const [shakeIndex, setShakeIndex] = useState<number | null>(null);
  const [revealedCards, setRevealedCards] = useState<number[]>([]);
  const [showWinClaimModal, setShowWinClaimModal] = useState(false);
  const [isWinClaimMinimized, setIsWinClaimMinimized] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  
  // Private and Slot State
  const [myPlayerId, setMyPlayerId] = useState<number | null>(null);
  const [myPrivateData, setMyPrivateData] = useState<PrivatePlayerData | null>(null);
  const [slotAssignments, setSlotAssignments] = useState<[number, string][]>([]);

  // Mouse move effect for volumetric lighting
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Socket initialization
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', ROOM_ID);
    });

    socket.on('game-state', (remoteState: GameState) => {
      isRemoteUpdate.current = true;
      setGameState(prev => {
        if (remoteState.mode === GameMode.COOPERATIVE && remoteState.currentPlayerIndex !== prev.currentPlayerIndex) {
          setMyPrivateData(null);
        }
        return remoteState;
      });
      setTimeout(() => { isRemoteUpdate.current = false; }, 50);
    });

    socket.on('slot-assignments', (assignments: [number, string][]) => {
      setSlotAssignments(assignments);
      const myAssignment = assignments.find(([_, sid]) => sid === socket.id);
      if (myAssignment) {
        setMyPlayerId(myAssignment[0]);
      } else {
        setMyPlayerId(null);
      }
    });

    socket.on('private-data', (data: PrivatePlayerData) => {
      setMyPrivateData(data);
    });

    socket.on('error', (msg: string) => {
      alert(msg);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Sync state to server
  useEffect(() => {
    if (isRemoteUpdate.current || !socketRef.current) return;
    socketRef.current.emit('update-game-state', { roomId: ROOM_ID, state: gameState });
  }, [gameState]);

  // Win Claim Timer Countdown
  useEffect(() => {
    if (!gameState.winClaimTimerActive || gameState.status === GameStatus.FINISHED) return;

    const timer = setInterval(() => {
      setGameState(prev => {
        if (!prev.winClaimTimerActive) return prev;
        
        if (prev.winClaimTimeLeft <= 0.1) {
          clearInterval(timer);
          return { ...prev, winClaimTimeLeft: 0 };
        }
        
        isRemoteUpdate.current = true;
        const next = { ...prev, winClaimTimeLeft: prev.winClaimTimeLeft - 0.1 };
        setTimeout(() => { isRemoteUpdate.current = false; }, 10);
        return next;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [gameState.winClaimTimerActive, gameState.status]);

  // Persistence
  useEffect(() => {
    const savedScores = localStorage.getItem('binary_battle_scores');
    if (savedScores) {
      const scores = JSON.parse(savedScores);
      setGameState(prev => ({
        ...prev,
        players: prev.players.map((p, i) => ({ ...p, score: scores[i] || 0 }))
      }));
    }
  }, []);

  useEffect(() => {
    if (gameState.status !== GameStatus.SETUP) {
      localStorage.setItem('binary_battle_scores', JSON.stringify(gameState.players.map(p => p.score)));
    }
  }, [gameState.players, gameState.status]);

  const startGame = (mode: GameMode) => {
    setGameState(prev => ({ ...prev, mode, status: GameStatus.SELECTING_PLAYERS }));
  };

  const selectPlayerCount = (count: number) => {
    if (socketRef.current) {
      socketRef.current.emit('start-game', { 
        roomId: ROOM_ID, 
        mode: gameState.mode, 
        numPlayers: count, 
        bits: BOARD_SIZE 
      });
    }
    setMyPrivateData(null);
  };

  const claimSlot = (playerId: number) => {
    if (socketRef.current) {
      socketRef.current.emit('claim-slot', { roomId: ROOM_ID, playerId });
    }
  };

  const finalizeDistribution = () => {
    setGameState(prev => ({ 
      ...prev, 
      status: GameStatus.PLAYING,
      winClaimTimerActive: false,
      winClaimTimeLeft: 0
    }));
  };

  const drawBit = () => {
    if (gameState.drawnBit !== null) return;
    if (gameState.mode === GameMode.COOPERATIVE && isBoardFull) return;
    setGameState(prev => ({ ...prev, drawnBit: Math.random() > 0.5 ? 1 : 0 }));
  };

  const drawDecimalCard = () => {
    if (socketRef.current && myPlayerId) {
      socketRef.current.emit('draw-decimal-card', { roomId: ROOM_ID, playerId: myPlayerId });
    }
  };

  const handleCellClick = (index: number) => {
    if (gameState.drawnBit === null || gameState.status !== GameStatus.PLAYING || !isMyTurn) return;

    if (gameState.mode === GameMode.COOPERATIVE && gameState.board[index].value !== null) {
      setShakeIndex(index);
      setTimeout(() => setShakeIndex(null), 400);
      return;
    }

    if (gameState.mode === GameMode.COMPETITIVE) {
      setGameState(prev => {
        const newBoard = [...prev.board];
        newBoard[index] = { value: prev.drawnBit, ownerId: prev.players[prev.currentPlayerIndex].id };
        
        return {
          ...prev,
          board: newBoard,
          status: GameStatus.PLAYING,
          drawnBit: null,
          winClaimTimerActive: true,
          winClaimTimeLeft: 10
        };
      });
    } else {
      setGameState(prev => {
        const newBoard = [...prev.board];
        newBoard[index] = { value: prev.drawnBit, ownerId: prev.players[prev.currentPlayerIndex].id };
        
        const isBoardFull = newBoard.every(cell => cell.value !== null);
        
        return {
          ...prev,
          board: newBoard,
          drawnBit: null,
          currentPlayerIndex: isBoardFull ? prev.currentPlayerIndex : (prev.currentPlayerIndex + 1) % prev.players.length,
          winClaimTimerActive: false,
          winClaimTimeLeft: 0
        };
      });
    }
  };

  const resetGame = () => {
    setGameState(prev => ({
      ...prev,
      status: GameStatus.SETUP,
      board: generateBoard(BOARD_SIZE),
      winner: null,
      drawnBit: null,
      winClaimTimerActive: false,
      winClaimTimeLeft: 0
    }));
  };

  const copyRoomLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    alert('Link da sala copiado! Compartilhe com seus amigos para jogarem no mesmo tabuleiro.');
  };

  const isBoardFull = gameState.board.every(cell => cell.value !== null);
  const boardDecimalValue = isBoardFull ? binaryToDecimal(gameState.board.map(c => c.value).join('')) : null;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const isMyTurn = myPlayerId === currentPlayer?.id;

  const handleWinClaim = () => {
    setShowWinClaimModal(true);
    setIsWinClaimMinimized(false);
    setGameState(prev => ({
      ...prev,
      winClaimTimerActive: false,
      winClaimTimeLeft: 0
    }));
  };

  const confirmVictory = () => {
    setShowWinClaimModal(false);
    setGameState(prev => {
      const player = prev.players[prev.currentPlayerIndex];
      const updatedPlayers = prev.players.map(p => p.id === player.id ? { ...p, score: p.score + 1 } : p);
      return {
        ...prev,
        status: GameStatus.FINISHED,
        winner: player,
        players: updatedPlayers,
        winClaimTimerActive: false,
        winClaimTimeLeft: 0,
        targetDecimalMode2: myPrivateData?.targetDecimal
      };
    });
    setMyPrivateData(null);
  };

  const closeWinClaimModal = () => {
    setShowWinClaimModal(false);
    if (socketRef.current) {
      socketRef.current.emit('skip-turn', { roomId: ROOM_ID });
    }
    if (gameState.mode === GameMode.COOPERATIVE) {
      setMyPrivateData(null);
    }
  };

  // Volumetric lighting effect style
  const volumetricLightStyle = {
    background: `radial-gradient(circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(212, 175, 55, 0.15), transparent 40%)`
  };

  // Glass panel classes reutilizáveis
  const glassPanelClasses = "bg-[#1A1A1A]/70 backdrop-blur-xl border border-[#A9A9A9]/15 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.08),inset_0_-1px_1px_rgba(0,0,0,0.3),0_20px_30px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden hover:before:left-full before:content-[''] before:absolute before:top-0 before:-left-full before:w-full before:h-full before:bg-gradient-to-r before:from-transparent before:via-[#D4AF37]/10 before:to-transparent before:transition-all before:duration-700 before:ease-in-out";

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-x-hidden bg-[#1A1A1A]"
    >
      {/* Volumetric Lighting Overlay */}
      <div 
        className="fixed inset-0 pointer-events-none transition-opacity duration-300 z-0"
        style={volumetricLightStyle}
      />
      
      {/* Circuit Pattern Background */}
      <div className="fixed inset-0 opacity-5 pointer-events-none z-0">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            radial-gradient(circle at 30px 30px, rgba(0, 255, 127, 0.1) 2px, transparent 2px),
            radial-gradient(circle at 70px 90px, rgba(212, 175, 55, 0.1) 2px, transparent 2px),
            radial-gradient(circle at 120px 50px, rgba(0, 71, 171, 0.1) 2px, transparent 2px),
            linear-gradient(rgba(169, 169, 169, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(169, 169, 169, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '150px 150px, 200px 200px, 180px 180px, 30px 30px, 30px 30px'
        }} />
      </div>

      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center space-y-2 relative z-10 mb-8"
      >
        <h1 className="font-['Helvetica_Now','Garamond_Premier',serif] text-5xl sm:text-7xl font-black tracking-[-0.03em] uppercase italic flex items-center justify-center gap-3 text-white">
          <Hash className="text-[#00FF7F]" size={48} />
          Binary Battle
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute -right-12 opacity-20"
          >
            <CpuIcon size={32} className="text-[#D4AF37]" />
          </motion.div>
        </h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.3 }}
          className="text-[#A9A9A9] font-mono text-xs sm:text-sm uppercase tracking-[0.2em]"
        >
          Conquiste o Tabuleiro Bit a Bit
        </motion.p>
        
        <motion.button 
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          onClick={copyRoomLink}
          className="absolute -right-4 sm:-right-12 top-0 p-2 text-[#A9A9A9] hover:text-[#00FF7F] transition-colors"
          title="Compartilhar Sala"
        >
          <Share2 size={20} />
        </motion.button>
      </motion.div>

      <AnimatePresence mode="wait">
        {gameState.status === GameStatus.SETUP ? (
          <motion.div 
            key="setup"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`${glassPanelClasses} p-6 sm:p-8 max-w-6xl w-full space-y-8 z-10`}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <motion.button 
                variants={cardVariants}
                whileHover="hover"
                whileTap="tap"
                onClick={() => startGame(GameMode.COMPETITIVE)}
                className="group relative p-6 bg-[#1A1A1A] border border-[#A9A9A9]/20 rounded-2xl text-left transition-all hover:border-[#0A7E3D] overflow-hidden"
              >
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-r from-[#0A7E3D]/0 to-[#0A7E3D]/10"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                />
                <div className="mb-4 p-3 bg-[#0A7E3D]/20 rounded-xl w-fit text-[#00FF7F]">
                  <Users size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2 text-white">Modo Competitivo</h3>
                <p className="text-sm text-[#A9A9A9]">Dispute cada bit. Sobrescreva o oponente para completar seu número secreto primeiro.</p>
                <ChevronRight className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity text-[#D4AF37]" />
              </motion.button>

              <motion.button 
                variants={cardVariants}
                whileHover="hover"
                whileTap="tap"
                onClick={() => startGame(GameMode.COOPERATIVE)}
                className="group relative p-6 bg-[#1A1A1A] border border-[#A9A9A9]/20 rounded-2xl text-left transition-all hover:border-[#0047AB] overflow-hidden"
              >
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-r from-[#0047AB]/0 to-[#0047AB]/10"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                />
                <div className="mb-4 p-3 bg-[#0047AB]/20 rounded-xl w-fit text-[#0047AB]">
                  <Cpu size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2 text-white">Sorte Coletiva</h3>
                <p className="text-sm text-[#A9A9A9]">Trabalhem juntos para preencher o tabuleiro e torçam para que o decimal sorteado coincida.</p>
                <ChevronRight className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity text-[#D4AF37]" />
              </motion.button>
            </div>

            <div className="pt-6 border-t border-[#A9A9A9]/10 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex gap-8">
                {gameState.players.map((p, i) => (
                  <motion.div 
                    key={p.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.1 }}
                    className="space-y-1"
                  >
                    <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">{p.name}</p>
                    <motion.p 
                      key={p.score}
                      initial={{ scale: 1.5, color: '#00FF7F' }}
                      animate={{ scale: 1, color: '#FFFFFF' }}
                      className="text-xl font-bold font-mono"
                    >
                      {p.score} <span className="text-xs font-normal text-[#A9A9A9]">VITÓRIAS</span>
                    </motion.p>
                  </motion.div>
                ))}
              </div>
              <div className="text-right">
                <Info size={16} className="text-[#A9A9A9] ml-auto mb-1" />
                <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Versão 1.0.4</p>
              </div>
            </div>
          </motion.div>
        ) : gameState.status === GameStatus.SELECTING_PLAYERS ? (
          <motion.div 
            key="selecting"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`${glassPanelClasses} p-8 sm:p-12 max-w-md w-full text-center space-y-8 z-10`}
          >
            <motion.div 
              variants={revealVariants}
              initial="initial"
              animate="animate"
              className="space-y-2"
            >
              <h2 className="text-3xl sm:text-4xl font-bold uppercase tracking-tighter italic text-white">
                Quantos Jogadores?
              </h2>
              <p className="text-[#A9A9A9] font-mono text-xs uppercase">Selecione o número de participantes para a batalha</p>
            </motion.div>
            
            <div className="grid grid-cols-3 gap-4">
              {[2, 3, 4].map((num, index) => (
                <motion.button
                  key={num}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ scale: 1.05, borderColor: '#00FF7F' }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => selectPlayerCount(num)}
                  className="relative py-8 text-2xl font-bold bg-[#1A1A1A] border-2 border-[#A9A9A9]/20 rounded-xl text-white hover:text-[#00FF7F] overflow-hidden group"
                >
                  <motion.div 
                    className="absolute inset-0 bg-gradient-to-r from-[#00FF7F]/0 to-[#00FF7F]/20"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                  {num}
                </motion.button>
              ))}
            </div>

            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={resetGame} 
              className="relative text-[#A9A9A9] hover:text-white text-xs uppercase font-mono tracking-widest group"
            >
              <span className="relative z-10">Voltar ao Menu</span>
              <motion.div 
                className="absolute bottom-0 left-0 right-0 h-px bg-[#D4AF37]"
                initial={{ scaleX: 0 }}
                whileHover={{ scaleX: 1 }}
                transition={{ duration: 0.3 }}
              />
            </motion.button>
          </motion.div>
        ) : (
          <motion.div 
            key="game"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            className="w-full max-w-6xl space-y-6 sm:space-y-8 z-10"
          >
            {/* Player Slot Selection */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap justify-center gap-3 sm:gap-4"
            >
              {gameState.players.map((p, index) => {
                const isOccupied = slotAssignments.some(([id]) => id === p.id);
                const isMe = myPlayerId === p.id;
                
                return (
                  <motion.button
                    key={p.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={!isOccupied || isMe ? { scale: 1.05, y: -2 } : {}}
                    whileTap={!isOccupied || isMe ? { scale: 0.95 } : {}}
                    disabled={isOccupied && !isMe}
                    onClick={() => claimSlot(p.id)}
                    className={`px-4 py-2 rounded-xl border-2 flex items-center gap-2 transition-all ${
                      isMe 
                        ? 'bg-[#00FF7F]/20 border-[#00FF7F] text-[#00FF7F]' 
                        : isOccupied 
                          ? 'bg-[#1A1A1A] border-[#A9A9A9]/10 text-[#A9A9A9]/20 cursor-not-allowed'
                          : 'bg-[#1A1A1A] border-[#A9A9A9]/20 text-[#A9A9A9] hover:border-[#D4AF37] hover:text-[#D4AF37]'
                    }`}
                  >
                    {isMe ? <UserCheck size={16} /> : isOccupied ? <Lock size={16} /> : <Users size={16} />}
                    <span className="font-mono text-xs uppercase font-bold">{p.name}</span>
                    {isMe && <span className="text-[10px] ml-1 opacity-60">(VOCÊ)</span>}
                  </motion.button>
                );
              })}
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 items-start">
              {/* Left Column: Player Info */}
              <div className="space-y-6">
                <motion.div 
                  variants={revealVariants}
                  initial="initial"
                  animate="animate"
                  className={`${glassPanelClasses} p-6 space-y-4`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase text-[#A9A9A9] tracking-widest">Sua Carta</h3>
                    <Info size={14} className="text-[#A9A9A9]" />
                  </div>
                  
                  {myPlayerId ? (
                    myPrivateData ? (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-4"
                      >
                        <motion.div 
                          whileHover={{ scale: 1.02, borderColor: '#D4AF37' }}
                          className="p-4 bg-[#1A1A1A] rounded-xl border-2 border-[#00FF7F]/30 relative overflow-hidden"
                        >
                          <motion.div 
                            className="absolute inset-0 bg-gradient-to-r from-[#00FF7F]/0 via-[#00FF7F]/10 to-[#00FF7F]/0"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                          />
                          <p className="text-[10px] uppercase font-mono text-[#A9A9A9] mb-1">Decimal Alvo</p>
                          <p className="text-4xl font-black italic text-[#00FF7F]">{myPrivateData.targetDecimal}</p>
                        </motion.div>
                        <motion.div 
                          whileHover={{ scale: 1.02 }}
                          className="p-4 bg-[#1A1A1A] rounded-xl border border-[#A9A9A9]/20"
                        >
                          <p className="text-[10px] uppercase font-mono text-[#A9A9A9] mb-1">Binário Alvo</p>
                          <p className="text-2xl font-mono font-bold tracking-widest text-[#D4AF37]">{myPrivateData.targetBinary}</p>
                        </motion.div>
                      </motion.div>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-8 text-center border-2 border-dashed border-[#A9A9A9]/20 rounded-xl"
                      >
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        >
                          <CpuIcon size={32} className="text-[#A9A9A9]/30 mx-auto mb-2" />
                        </motion.div>
                        <p className="text-xs text-[#A9A9A9] uppercase font-mono">Aguardando início do jogo...</p>
                      </motion.div>
                    )
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-8 text-center border-2 border-dashed border-[#D4AF37]/20 rounded-xl bg-[#D4AF37]/5"
                    >
                      <Target size={32} className="text-[#D4AF37]/50 mx-auto mb-2" />
                      <p className="text-xs text-[#D4AF37] uppercase font-mono font-bold">Selecione um jogador acima para ver sua carta!</p>
                    </motion.div>
                  )}
                </motion.div>

                <motion.div 
                  variants={revealVariants}
                  initial="initial"
                  animate="animate"
                  transition={{ delay: 0.2 }}
                  className={`${glassPanelClasses} p-6 space-y-4`}
                >
                  <h3 className="text-xs font-mono uppercase text-[#A9A9A9] tracking-widest">Placar</h3>
                  <div className="space-y-2">
                    {gameState.players.map((p, i) => (
                      <motion.div 
                        key={p.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        whileHover={{ x: 5 }}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          i === gameState.currentPlayerIndex 
                            ? 'bg-[#00FF7F]/10 border border-[#00FF7F]/30' 
                            : 'bg-[#1A1A1A] border border-[#A9A9A9]/10'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <motion.div 
                            animate={i === gameState.currentPlayerIndex ? { scale: [1, 1.2, 1] } : {}}
                            transition={{ duration: 1, repeat: Infinity }}
                            className={`w-2 h-2 rounded-full ${
                              i === 0 ? 'bg-[#00FF7F]' : 
                              i === 1 ? 'bg-[#0047AB]' : 
                              i === 2 ? 'bg-[#D4AF37]' : 
                              'bg-[#A9A9A9]'
                            }`} 
                          />
                          <span className={`text-sm font-bold ${i === gameState.currentPlayerIndex ? 'text-white' : 'text-[#A9A9A9]'}`}>
                            {p.name} {slotAssignments.find(([id]) => id === p.id)?.[1] === socketRef.current?.id && '(Você)'}
                          </span>
                        </div>
                        <motion.span 
                          key={p.score}
                          initial={{ scale: 1.5, color: '#00FF7F' }}
                          animate={{ scale: 1, color: '#FFFFFF' }}
                          className="font-mono font-bold text-white"
                        >
                          {p.score}
                        </motion.span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                <motion.button 
                  whileHover={{ scale: 1.02, borderColor: '#D4AF37' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetGame} 
                  className={`${glassPanelClasses} w-full py-3 flex items-center justify-center gap-2 text-xs uppercase font-mono text-[#A9A9A9] hover:text-white transition-colors border border-[#A9A9A9]/20`}
                >
                  <RotateCcw size={14} /> Sair da Partida
                </motion.button>
              </div>

              {/* Middle/Right Column: Board & Controls */}
              <div className="lg:col-span-2 space-y-6">
                {/* Game Info Bar */}
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`${glassPanelClasses} flex flex-col sm:flex-row items-center justify-between px-6 py-4 gap-4`}
                >
                  <div className="flex items-center gap-4">
                    <motion.div 
                      animate={gameState.currentPlayerIndex === 0 ? { scale: [1, 1.2, 1] } : {}}
                      transition={{ duration: 1, repeat: Infinity }}
                      className={`w-3 h-3 rounded-full ${
                        gameState.currentPlayerIndex === 0 ? 'bg-[#00FF7F]' : 
                        gameState.currentPlayerIndex === 1 ? 'bg-[#0047AB]' : 
                        gameState.currentPlayerIndex === 2 ? 'bg-[#D4AF37]' : 
                        'bg-[#A9A9A9]'
                      }`} 
                    />
                    <div>
                      <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Vez de</p>
                      <p className="font-bold uppercase tracking-tight text-white">
                        {currentPlayer?.name}
                        {isMyTurn && (
                          <motion.span 
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-xs normal-case font-normal ml-2 text-[#00FF7F]"
                          >
                            (Sua Vez!)
                          </motion.span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Bit Sorteado</p>
                    <AnimatePresence mode="wait">
                      <motion.div 
                        key={gameState.drawnBit}
                        variants={bitPulseVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={`text-4xl font-mono font-black ${
                          gameState.drawnBit === null ? 'text-[#A9A9A9]/10' : 'text-[#00FF7F]'
                        }`}
                      >
                        {gameState.drawnBit ?? (
                          <motion.span
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            ?
                          </motion.span>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>

                {/* Board */}
                <div className="space-y-4">
                  {gameState.mode === GameMode.COOPERATIVE && isBoardFull && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-center gap-4 p-4 bg-[#00FF7F]/10 border border-[#00FF7F]/30 rounded-2xl"
                    >
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Valor do Tabuleiro</p>
                        <p className="text-3xl font-black italic text-[#00FF7F]">{boardDecimalValue}</p>
                      </div>
                      <div className="h-8 w-px bg-[#A9A9A9]/20" />
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Binário</p>
                        <p className="text-xl font-mono font-bold text-[#D4AF37] tracking-widest">
                          {gameState.board.map(c => c.value).join('')}
                        </p>
                      </div>
                    </motion.div>
                  )}

                  <div 
                    ref={boardRef}
                    className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3"
                  >
                    {gameState.board.map((cell, i) => (
                      <motion.button
                        key={i}
                        whileHover={isMyTurn && gameState.drawnBit !== null ? { y: -5, scale: 1.02 } : {}}
                        whileTap={isMyTurn && gameState.drawnBit !== null ? { scale: 0.95 } : {}}
                        animate={shakeIndex === i ? { x: [-5, 5, -5, 5, 0] } : {}}
                        transition={{ duration: 0.4 }}
                        onClick={() => handleCellClick(i)}
                        disabled={!isMyTurn || gameState.drawnBit === null}
                        className={`aspect-square rounded-xl sm:rounded-2xl border-2 flex items-center justify-center text-xl sm:text-3xl font-mono font-black transition-all relative overflow-hidden group ${
                          cell.value !== null 
                            ? cell.ownerId === 1 
                              ? 'bg-[#00FF7F]/20 border-[#00FF7F] text-[#00FF7F]' 
                              : cell.ownerId === 2 
                                ? 'bg-[#0047AB]/20 border-[#0047AB] text-[#0047AB]' 
                                : cell.ownerId === 3 
                                  ? 'bg-[#D4AF37]/20 border-[#D4AF37] text-[#D4AF37]' 
                                  : cell.ownerId === 4 
                                    ? 'bg-[#A9A9A9]/10 border-[#A9A9A9] text-[#A9A9A9]'
                                    : 'bg-[#1A1A1A] border-[#A9A9A9]/20 text-[#A9A9A9]'
                            : 'bg-[#1A1A1A] border-[#A9A9A9]/20 text-[#A9A9A9]/50 hover:border-[#00FF7F] hover:text-white'
                        } ${!isMyTurn && 'cursor-not-allowed opacity-80'}`}
                      >
                        <span className="absolute top-1 left-1 sm:top-2 sm:left-2 text-[8px] sm:text-[10px] font-mono opacity-30 text-[#A9A9A9]">
                          {i}
                        </span>
                        {cell.value !== null && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 300 }}
                          >
                            {cell.value}
                          </motion.span>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Controls */}
                <div className="space-y-4">
                  {gameState.lastDraw && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={JSON.stringify(gameState.lastDraw)}
                      className={`p-3 rounded-xl border text-center font-mono text-xs uppercase ${
                        gameState.lastDraw.match 
                          ? 'bg-[#00FF7F]/20 border-[#00FF7F] text-[#00FF7F]' 
                          : 'bg-[#D4AF37]/10 border-[#D4AF37]/30 text-[#D4AF37]'
                      }`}
                    >
                      Último Sorteio: Jogador {gameState.lastDraw.playerId} tirou {gameState.lastDraw.value} 
                      {gameState.lastDraw.match ? ' (ACERTOU!)' : ' (ERROU)'}
                    </motion.div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    {gameState.mode === GameMode.COOPERATIVE ? (
                      isBoardFull ? (
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={!isMyTurn || gameState.status === GameStatus.FINISHED}
                          onClick={drawDecimalCard}
                          className="flex-1 py-4 sm:py-6 px-6 sm:px-12 text-base sm:text-lg bg-[#0047AB] text-white hover:bg-[#0047AB]/80 border-none rounded-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 relative overflow-hidden group"
                        >
                          <motion.div 
                            className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/0 via-[#D4AF37]/30 to-[#D4AF37]/0"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          />
                          <RotateCcw size={20} /> Tirar Decimal Aleatório
                        </motion.button>
                      ) : (
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={!isMyTurn || gameState.drawnBit !== null || gameState.status === GameStatus.FINISHED}
                          onClick={drawBit}
                          className="flex-1 py-4 sm:py-6 px-6 sm:px-12 text-base sm:text-lg bg-[#00FF7F] text-[#1A1A1A] hover:bg-[#00FF7F]/80 border-none rounded-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 relative overflow-hidden group"
                        >
                          <motion.div 
                            className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/0 via-[#D4AF37]/30 to-[#D4AF37]/0"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          />
                          <Play size={20} fill="currentColor" /> Sortear Bit
                        </motion.button>
                      )
                    ) : (
                      <>
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={!isMyTurn || gameState.drawnBit !== null || gameState.status === GameStatus.FINISHED || gameState.winClaimTimerActive}
                          onClick={drawBit}
                          className="flex-1 py-4 sm:py-6 px-6 sm:px-12 text-base sm:text-lg bg-[#00FF7F] text-[#1A1A1A] hover:bg-[#00FF7F]/80 border-none rounded-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 relative overflow-hidden group"
                        >
                          <motion.div 
                            className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/0 via-[#D4AF37]/30 to-[#D4AF37]/0"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          />
                          <Play size={20} fill="currentColor" /> Sortear Bit
                        </motion.button>

                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          animate={gameState.winClaimTimerActive ? { 
                            boxShadow: ["0 0 0 rgba(212,175,55,0)", "0 0 30px rgba(212,175,55,0.3)", "0 0 0 rgba(212,175,55,0)"]
                          } : {}}
                          transition={{ duration: 2, repeat: Infinity }}
                          disabled={!isMyTurn || !gameState.winClaimTimerActive || gameState.status === GameStatus.FINISHED}
                          onClick={handleWinClaim}
                          className="flex-1 py-4 sm:py-6 px-6 sm:px-12 text-base sm:text-lg bg-[#D4AF37] text-[#1A1A1A] hover:bg-[#D4AF37]/80 border-none rounded-xl font-bold flex items-center justify-center gap-3 disabled:bg-[#1A1A1A] disabled:text-[#A9A9A9] relative overflow-hidden"
                        >
                          <Trophy size={20} /> Ganhei
                          {gameState.winClaimTimerActive && (
                            <motion.div 
                              className="absolute bottom-0 left-0 h-1 bg-[#1A1A1A]"
                              initial={{ width: "100%" }}
                              animate={{ width: `${(gameState.winClaimTimeLeft / 10) * 100}%` }}
                              transition={{ duration: 0.1, ease: "linear" }}
                            />
                          )}
                        </motion.button>
                      </>
                    )}
                  </div>
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.5 }}
                    className="text-center text-[10px] font-mono text-[#A9A9A9] uppercase"
                  >
                    {!myPlayerId ? "Selecione um jogador acima para começar" :
                     !isMyTurn ? `Aguarde a vez de ${currentPlayer?.name}` :
                     gameState.mode === GameMode.COOPERATIVE 
                      ? (!isBoardFull 
                        ? "Sua vez! Sorteie um bit e escolha uma casa." 
                        : "Tabuleiro completo! Sorteie um decimal para tentar ganhar.")
                      : (gameState.winClaimTimerActive 
                        ? `Você tem ${gameState.winClaimTimeLeft.toFixed(1)}s para clicar em 'Ganhei'!`
                        : "Sua vez! Sorteie um bit e escolha uma casa.")}
                  </motion.p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finished Modal */}
      <AnimatePresence>
        {gameState.status === GameStatus.FINISHED && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1A1A]/90 backdrop-blur-md p-4">
            <motion.div 
              variants={cardVariants}
              initial="initial"
              animate="animate"
              exit={{ opacity: 0, scale: 0.9 }}
              className={`${glassPanelClasses} max-w-lg w-full p-8 sm:p-12 text-center space-y-8 border-[#00FF7F]/30`}
            >
              <motion.div 
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 0.5 }}
                className="flex justify-center"
              >
                <div className="p-6 bg-[#00FF7F]/20 rounded-full text-[#00FF7F]">
                  <Trophy size={64} />
                </div>
              </motion.div>
              
              <div className="space-y-2">
                <motion.h2 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-3xl sm:text-4xl font-black uppercase tracking-tighter italic text-white"
                >
                  {gameState.winner ? 'Vitória!' : 'Fim de Jogo'}
                </motion.h2>
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-[#A9A9A9] font-mono"
                >
                  {gameState.winner 
                    ? `${gameState.winner.name} dominou os bits!` 
                    : gameState.mode === GameMode.COOPERATIVE 
                      ? 'O decimal sorteado não coincidiu.' 
                      : 'Empate técnico!'}
                </motion.p>
              </div>

              {gameState.mode === GameMode.COOPERATIVE && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                  className="grid grid-cols-2 gap-4 p-4 bg-[#1A1A1A] rounded-xl border border-[#A9A9A9]/20"
                >
                  <div>
                    <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Formado</p>
                    <p className="text-2xl font-mono font-bold text-white">
                      {binaryToDecimal(gameState.board.map(c => c.value).join(''))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-mono text-[#A9A9A9]">Sorteado</p>
                    <p className="text-2xl font-mono font-bold text-[#00FF7F]">
                      {gameState.targetDecimalMode2}
                    </p>
                  </div>
                </motion.div>
              )}

              <div className="flex flex-col gap-3">
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => startGame(gameState.mode)} 
                  className="py-3 bg-[#00FF7F] text-[#1A1A1A] border-none rounded-xl font-bold hover:bg-[#00FF7F]/80"
                >
                  Jogar Novamente
                </motion.button>
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetGame} 
                  className={`${glassPanelClasses} py-3`}
                >
                  Menu Principal
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Win Claim Informative Modal */}
      <AnimatePresence>
        {showWinClaimModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-start p-4 sm:p-6 pointer-events-none">
            {isWinClaimMinimized ? (
              <motion.button
                initial={{ x: -50, opacity: 0, scale: 0.8 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={{ x: -50, opacity: 0, scale: 0.8 }}
                onClick={() => setIsWinClaimMinimized(false)}
                className={`${glassPanelClasses} p-4 text-[#D4AF37] pointer-events-auto hover:bg-[#1A1A1A] shadow-2xl flex items-center gap-3 border border-[#D4AF37]/30`}
              >
                <Trophy size={24} />
                <span className="text-[10px] font-mono uppercase font-bold tracking-widest">Reivindicação</span>
              </motion.button>
            ) : (
              <motion.div 
                variants={cardVariants}
                initial="initial"
                animate="animate"
                exit={{ y: 50, opacity: 0 }}
                className={`${glassPanelClasses} max-w-sm w-full p-6 sm:p-8 text-center space-y-6 border border-[#D4AF37]/30 pointer-events-auto shadow-2xl shadow-[#D4AF37]/10 relative`}
              >
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsWinClaimMinimized(true)}
                  className="absolute top-4 right-4 text-[#A9A9A9] hover:text-white transition-colors"
                  title="Minimizar"
                >
                  <ChevronRight size={18} className="rotate-90" />
                </motion.button>

                <motion.div 
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 0.5 }}
                  className="flex justify-center"
                >
                  <div className="p-3 bg-[#D4AF37]/20 rounded-full text-[#D4AF37]">
                    <Trophy size={32} />
                  </div>
                </motion.div>
                
                <div className="space-y-2">
                  <h2 className="text-xl font-black uppercase tracking-tighter italic text-white">Reivindicação de Vitória</h2>
                  <p className="text-xs text-[#A9A9A9] leading-relaxed">
                    Você acredita que venceu! Agora, você deve confirmar seu número binário com seus amigos para validar se realmente completou seu objetivo.
                  </p>
                </div>

                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-3 bg-[#1A1A1A] rounded-xl border border-[#A9A9A9]/20 text-left space-y-1"
                >
                  <p className="text-[9px] uppercase font-mono text-[#A9A9A9]">Seu Alvo</p>
                  <p className="text-lg font-mono font-bold text-[#00FF7F]">
                    {myPrivateData?.targetDecimal}
                    <span className="text-xs font-normal text-[#A9A9A9] ml-2">({myPrivateData?.targetBinary})</span>
                  </p>
                </motion.div>

                <div className="flex flex-col gap-2">
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={confirmVictory}
                    className="w-full py-3 bg-[#00FF7F] text-[#1A1A1A] border-none rounded-xl font-bold hover:bg-[#00FF7F]/80 text-sm"
                  >
                    Confirmar Vitória
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={closeWinClaimModal}
                    className="w-full py-2 text-[10px] uppercase font-mono text-[#A9A9A9] hover:text-white transition-colors"
                  >
                    Não venci ainda (Passar Vez)
                  </motion.button>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}