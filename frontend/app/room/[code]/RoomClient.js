'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';

const EMOJIS = ['😮', '😂', '😭', '👑', '🕵️', '🃏'];

export default function RoomClient({ code }) {
  const router = useRouter();
  const socketRef = useRef(null);
  
  // Game states
  const [roomCode, setRoomCode] = useState(code);
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState(null);
  
  // Local interaction states
  const [selectedHandIndices, setSelectedHandIndices] = useState([]);
  const [peekedIndices, setPeekedIndices] = useState([]);
  const [actionRevealCard, setActionRevealCard] = useState(null);
  const [actionRevealTitle, setActionRevealTitle] = useState('');
  const [spiedOnNotification, setSpiedOnNotification] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [kickConfirmPlayer, setKickConfirmPlayer] = useState(null);
  
  // Swap action local selections
  const [swapMyCardIndex, setSwapMyCardIndex] = useState(null);
  const [swapTarget, setSwapTarget] = useState(null);
  const [lookSwapReveal, setLookSwapReveal] = useState(null);
  const [transferCardIndex, setTransferCardIndex] = useState(null);
  const [overloadSelect, setOverloadSelect] = useState(null); // { playerId, cardIndex }
  
  // Floating emoji state
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const floatingEmojisSetterRef = useRef(setFloatingEmojis);
  floatingEmojisSetterRef.current = setFloatingEmojis;
  const playerBoxRefs = useRef({}); // map: playerId -> DOM element
  const emojiTimersRef = useRef([]); // track all active emoji/chat timeouts for cleanup
  const [chatInput, setChatInput] = useState('');
  
  // Connection states
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('cabo_player_name');
    const playerId = localStorage.getItem('cabo_player_id');

    if (!name || !playerId) {
      router.push('/');
      return;
    }

    // Connect to the backend socket server
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    console.log('> Connecting to socket backend:', socketUrl);
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setSocketId(socket.id);
      if (code === 'new') {
        socket.emit('create_room', { playerName: name, playerId });
      } else {
        socket.emit('join_room', { roomCode: code, playerName: name, playerId });
      }
    });

    socket.on('room_joined', ({ roomCode: joinedCode, players: initialPlayers, isHost: hostStatus, gameState: activeGame }) => {
      setRoomCode(joinedCode);
      setPlayers(initialPlayers);
      setIsHost(hostStatus);
      if (activeGame) {
        setGameState(activeGame);
      }
      
      if (code === 'new') {
        window.history.replaceState(null, '', `/room/${joinedCode}`);
      }
    });

    socket.on('room_updated', (updatedPlayers) => {
      setPlayers(updatedPlayers);
      // Remove stale playerBoxRefs for players no longer in the room
      const activeIds = new Set(updatedPlayers.map(p => p.id));
      Object.keys(playerBoxRefs.current).forEach(id => {
        if (!activeIds.has(id)) delete playerBoxRefs.current[id];
      });
    });

    socket.on('game_started', (state) => {
      setGameState(state);
      setSelectedHandIndices([]);
      setPeekedIndices([]);
      setInitialRevealedCards({});
      setSwapMyCardIndex(null);
      setSwapTarget(null);
    });

    socket.on('game_state_updated', (state) => {
      setGameState(state);
    });

    socket.on('emoji_received', ({ playerId: senderId, emoji }) => {
      console.log('CLIENT: emoji_received', { senderId, emoji });
      const id = `${Date.now()}${Math.random()}`;
      const left = Math.random() * 40 - 20;
      floatingEmojisSetterRef.current(prev => [...prev, { id, playerId: senderId, emoji, left, isChat: false }]);
      const t = setTimeout(() => floatingEmojisSetterRef.current(prev => prev.filter(e => e.id !== id)), 2500);
      emojiTimersRef.current.push(t);
    });

    socket.on('chat_received', ({ playerId: senderId, message }) => {
      console.log('CLIENT: chat_received', { senderId, message });
      const id = `${Date.now()}${Math.random()}`;
      const left = Math.random() * 40 - 20;
      floatingEmojisSetterRef.current(prev => [...prev, { id, playerId: senderId, emoji: message, left, isChat: true }]);
      const t = setTimeout(() => floatingEmojisSetterRef.current(prev => prev.filter(e => e.id !== id)), 3500);
      emojiTimersRef.current.push(t);
    });

    socket.on('you_were_spied_on', ({ spiedBy, cardIndex }) => {
      console.log('CLIENT: you_were_spied_on', { spiedBy, cardIndex });
      setSpiedOnNotification({ spiedBy, cardIndex });
    });

    socket.on('kicked', () => {
      console.log('CLIENT: kicked from room');
      alert('You have been kicked from the room by the host.');
      router.push('/');
    });

    socket.on('error_message', (msg) => {
      setErrorMsg(msg);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setSocketId(null);
    });

    return () => {
      // Cancel all pending emoji/chat timers before unmounting
      emojiTimersRef.current.forEach(t => clearTimeout(t));
      emojiTimersRef.current = [];
      socket.disconnect();
    };
  }, [code, router]);


  const handleSendEmoji = (emoji) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('send_emoji', { roomCode, emoji });
    }
  };

  const handleSendChat = (e) => {
    e?.preventDefault();
    if (!chatInput.trim()) return;
    if (socketRef.current && connected) {
      socketRef.current.emit('send_chat', { roomCode, message: chatInput.trim() });
      setChatInput('');
    }
  };

  const handleStartGame = () => {
    if (socketRef.current) {
      socketRef.current.emit('start_game', { roomCode });
    }
  };

  const handleDrawDeck = () => {
    if (socketRef.current && isMyTurn()) {
      socketRef.current.emit('draw_deck', { roomCode });
    }
  };

  const handleDrawDiscard = () => {
    if (socketRef.current && isMyTurn() && !gameState.activeDrawnCard) {
      socketRef.current.emit('draw_discard', { roomCode });
    }
  };

  const handleDiscardDrawn = (triggerAction = false) => {
    if (socketRef.current && isMyTurn() && gameState.activeDrawnCard) {
      socketRef.current.emit('discard_drawn', { roomCode, triggerAction });
      setSelectedHandIndices([]);
    }
  };

  const handleConfirmReplacement = () => {
    if (socketRef.current && isMyTurn() && gameState.activeDrawnCard && selectedHandIndices.length > 0) {
      socketRef.current.emit('replace_card', { roomCode, handIndices: selectedHandIndices });
      setSelectedHandIndices([]);
    }
  };

  const handleDonePeeking = () => {
    if (socketRef.current) {
      socketRef.current.emit('done_peeking', { roomCode });
    }
  };

  const handleCallCabo = () => {
    if (socketRef.current && isMyTurn() && gameState?.caboPlayerId === null) {
      socketRef.current.emit('call_cabo', { roomCode });
    }
  };

  const handleNextRound = () => {
    if (socketRef.current && isHost) {
      socketRef.current.emit('next_round', { roomCode });
    }
  };

  const handleBackToLobby = () => {
    router.push('/');
  };

  const handleKickPlayer = (targetPlayerId) => {
    const p = players.find(player => player.id === targetPlayerId);
    if (p) {
      setKickConfirmPlayer({ id: targetPlayerId, name: p.name });
    }
  };

  const handleHandCardClick = (idx) => {
    if (!gameState) return;

    const selfPlayer = getSelfPlayer();
    if (!selfPlayer || !selfPlayer.cards[idx]) return;

    if (gameState.status === 'initial_peeking') {
      return;
    }

    // 2. Transfer State active (selecting own card to give away)
    if (gameState.overloadTransferState) {
      if (gameState.overloadTransferState.sourcePlayerId === socketId) {
        setTransferCardIndex(idx);
      }
      return;
    }

    // 3. Turn action checks
    if (isMyTurn()) {
      if (gameState.actionState.type === 'peek' && gameState.actionState.sourcePlayerId === socketId) {
        if (socketRef.current) {
          socketRef.current.emit('execute_action', { roomCode, actionData: { cardIndex: idx } }, (response) => {
            if (response.success) {
              setActionRevealTitle('Peek Card Power');
              setActionRevealCard(response.card);
            }
          });
        }
        return;
      }

      if ((gameState.actionState.type === 'swap' || gameState.actionState.type === 'look_and_swap') && gameState.actionState.sourcePlayerId === socketId) {
        setSwapMyCardIndex(idx);
        return;
      }

      if (gameState.activeDrawnCard) {
        setSelectedHandIndices(prev => {
          if (prev.includes(idx)) {
            return prev.filter(i => i !== idx);
          } else {
            return [...prev, idx];
          }
        });
        return;
      }
    }

    // 4. Otherwise: Select for Overload! (Slapping card out-of-turn or during turn when not matching replace)
    setOverloadSelect({ playerId: socketId, cardIndex: idx });
  };

  const handleOpponentCardClick = (targetPlayerId, cardIndex) => {
    if (!gameState) return;

    if (gameState.actionState.type !== 'none' && gameState.actionState.sourcePlayerId === socketId) {
      if (gameState.actionState.type === 'spy') {
        if (socketRef.current) {
          socketRef.current.emit('execute_action', { 
            roomCode, 
            actionData: { targetPlayerId, cardIndex } 
          }, (response) => {
            if (response.success) {
              const targetName = gameState.players.find(p => p.id === targetPlayerId)?.name || 'Opponent';
              setActionRevealTitle(`Spying on ${targetName}'s Card (Card ${cardIndex + 1})`);
              setActionRevealCard(response.card);
            }
          });
        }
        return;
      }

      if ((gameState.actionState.type === 'swap' || gameState.actionState.type === 'look_and_swap')) {
        setSwapTarget({ playerId: targetPlayerId, cardIndex });
        return;
      }
    }

    // Otherwise: Select for Overload!
    setOverloadSelect({ playerId: targetPlayerId, cardIndex });
  };

  const handleConfirmSwap = () => {
    if (socketRef.current && isMyTurn() && swapMyCardIndex !== null && swapTarget !== null) {
      const currentActionType = gameState.actionState.type;
      socketRef.current.emit('execute_action', {
        roomCode,
        actionData: {
          myCardIndex: swapMyCardIndex,
          targetPlayerId: swapTarget.playerId,
          targetCardIndex: swapTarget.cardIndex
        }
      }, (response) => {
        if (response.success) {
          if (currentActionType === 'look_and_swap') {
            const targetName = gameState.players.find(p => p.id === swapTarget.playerId)?.name || 'Opponent';
            setLookSwapReveal({
              myCard: response.myCard,
              targetCard: response.targetCard,
              targetName
            });
          }
          setSwapMyCardIndex(null);
          setSwapTarget(null);
        }
      });
    }
  };

  const handleOverloadAttempt = (targetPlayerId, cardIndex) => {
    setOverloadSelect(null);
    if (socketRef.current && gameState && gameState.status === 'playing') {
      if (gameState.overloadTransferState) return;

      socketRef.current.emit('overload_card', { 
        roomCode, 
        targetPlayerId, 
        cardIndex 
      }, (response) => {
        if (!response.success && response.revealCard) {
          const targetName = gameState.players.find(p => p.id === response.revealPlayerId)?.name || 'Player';
          setActionRevealTitle(`Overload Fail - Exposed ${targetName}'s Card`);
          setActionRevealCard(response.revealCard);
        }
      });
    }
  };

  const handleConfirmTransfer = () => {
    if (socketRef.current && transferCardIndex !== null && gameState.overloadTransferState) {
      socketRef.current.emit('transfer_overload_card', { 
        roomCode, 
        cardIndex: transferCardIndex 
      }, (response) => {
        if (response.success) {
          setTransferCardIndex(null);
        }
      });
    }
  };

  const getSelfPlayer = () => {
    return gameState?.players.find(p => p.id === socketId) || 
           players.find(p => p.id === socketId);
  };

  const getOpponents = () => {
    if (!gameState) return players.filter(p => p.id !== socketId);
    return gameState.players.filter(p => p.id !== socketId);
  };

  const isMyTurn = () => {
    if (!gameState || gameState.status !== 'playing') return false;
    const activePlayer = gameState.players[gameState.turnIndex];
    return activePlayer && activePlayer.id === socketId;
  };

  const getActivePlayerName = () => {
    if (!gameState) return '';
    return gameState.players[gameState.turnIndex]?.name || '';
  };

  const getSuitSymbol = (suit) => {
    if (suit === 'hearts') return '♥';
    if (suit === 'diamonds') return '♦';
    if (suit === 'spades') return '♠';
    if (suit === 'clubs') return '♣';
    return '';
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderCard = (card, onClick, isSelectable = false, isSelected = false, index = null) => {
    if (!card) {
      return (
        <div className="card-container" style={{ cursor: 'default' }}>
          <div className="card-inner" style={{ border: '1.5px dashed rgba(255, 255, 255, 0.1)', background: 'transparent', height: '100%', borderRadius: '12px' }}>
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'rgba(255, 255, 255, 0.15)', fontSize: '0.75rem', fontWeight: 600 }}>
              EMPTY
            </div>
          </div>
        </div>
      );
    }

    const isFlipped = !card.hidden;
    
    const self = getSelfPlayer();
    const isExposed = gameState?.exposedCard && 
                      gameState.exposedCard.playerId === self?.id && 
                      gameState.exposedCard.cardIndex === index;
    
    let powerClass = '';
    let badgeText = '';
    if (isFlipped) {
      if (isExposed) {
        powerClass = 'power-exposed';
        badgeText = 'exposed';
      } else if (card.action === 'peek') {
        powerClass = 'power-peek';
        badgeText = 'peek';
      } else if (card.action === 'spy') {
        powerClass = 'power-spy';
        badgeText = 'spy';
      } else if (card.action === 'swap') {
        powerClass = 'power-swap';
        badgeText = 'swap';
      }
      
      if (!isExposed && card.value === 'K') {
        if (card.points === 0) {
          powerClass = 'power-zero';
          badgeText = '0 pts';
        } else {
          powerClass = 'power-king';
          badgeText = '13 pts';
        }
      }
    }

    const showPeekOverlay = gameState?.status === 'initial_peeking' && !isFlipped && (index === 2 || index === 3);

    return (
      <div 
        onClick={onClick}
        className={`card-container ${isFlipped ? 'flipped' : ''} ${isSelectable ? 'interactive' : ''} ${isSelected ? 'selected' : ''}`}
      >
        <div className="card-inner">
          <div className="card-face card-back">
            <div className="card-back-pattern">
              {showPeekOverlay ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '1.4rem' }}>👁️</span>
                  <span style={{ fontSize: '0.6rem', letterSpacing: '0.05em', opacity: 0.8 }}>PEEK</span>
                </div>
              ) : '♠'}
            </div>
          </div>

          {isFlipped && (
            <div className={`card-face card-front ${powerClass} ${card.suit}`}>
              <div className="card-corner top">
                <span className="card-value">{card.value}</span>
                <span className="card-suit">{getSuitSymbol(card.suit)}</span>
              </div>
              
              {badgeText ? (
                <div className="card-badge">{badgeText}</div>
              ) : (
                <div className="card-center-icon">{getSuitSymbol(card.suit)}</div>
              )}

              <div className="card-corner bottom">
                <span className="card-value">{card.value}</span>
                <span className="card-suit">{getSuitSymbol(card.suit)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (errorMsg) {
    return (
      <main className="flex items-center justify-center min-h-screen p-6">
        <div className="glass glass-card max-w-[400px] w-full text-center p-6 rounded-2xl">
          <h2 className="text-rose-500 font-extrabold text-2xl mb-4">Error</h2>
          <p className="text-gray-400 mb-6">{errorMsg}</p>
          <button onClick={handleBackToLobby} className="button-glow w-full">Back to Home</button>
        </div>
      </main>
    );
  }

  // --- LOBBY SCREEN ---
  if (!gameState || gameState.status === 'lobby') {
    return (
      <main className="flex items-center justify-center min-h-screen p-6">
        <div className="glass glass-card max-w-[540px] w-full rounded-3xl p-6 md:p-8">
          
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-2xl font-extrabold">Game Lobby</h2>
              <p className="text-gray-400 text-sm mt-1">
                {connected ? 'Waiting for players...' : 'Connecting to server...'}
              </p>
            </div>
            
            <div onClick={copyRoomCode} className="cursor-pointer text-right">
              <span className="text-xs uppercase text-gray-400 font-semibold tracking-wider">Room Code</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-3xl font-extrabold text-cyan-500 tracking-wider">{roomCode}</span>
                <span className="text-lg">{copied ? '✅' : '📋'}</span>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-xs uppercase text-gray-400 tracking-widest mb-3 font-bold">
              Joined Players ({players.length}/6)
            </h3>
            
            <div className="flex flex-col gap-2.5">
              {players.map((p) => (
                <div 
                  key={p.playerId} 
                  className="glass p-3 px-4 rounded-xl flex justify-between items-center"
                  style={{ borderLeft: p.isHost ? '3px solid var(--color-gold)' : '1px solid var(--border-glass)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="status-dot online"></div>
                    <span className="font-semibold">{p.name} {p.id === socketId && '(You)'}</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {p.isHost && (
                      <span className="text-xs bg-amber-500/15 text-amber-500 px-2 py-0.5 rounded-full font-bold">
                        HOST
                      </span>
                    )}
                    {isHost && !p.isHost && (
                      <button 
                        onClick={() => handleKickPlayer(p.id)}
                        className="text-xs bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white px-2.5 py-1 rounded-lg font-bold border border-rose-500/30 transition-all cursor-pointer"
                      >
                        Kick
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {isHost ? (
              <button 
                onClick={handleStartGame} 
                className="button-glow w-full py-3.5"
                disabled={players.length < 2 || !connected}
              >
                {players.length < 2 ? 'Need at least 2 players' : 'Start CABO Game'}
              </button>
            ) : (
              <div className="banner bg-cyan-500/10 text-cyan-400 text-sm p-4 rounded-xl text-center">
                Waiting for the host to start the game...
              </div>
            )}
            
            <button onClick={() => setShowRulesModal(true)} className="button-outline w-full py-3">
              📖 Rules & How to Play
            </button>
            
            <button onClick={handleBackToLobby} className="button-outline w-full">
              Leave Room
            </button>
          </div>

        </div>
      </main>
    );
  }

  // --- GAME BOARD SCREEN ---
  const selfPlayer = getSelfPlayer();
  const opponents = getOpponents();
  const activePlayer = gameState.players[gameState.turnIndex];
  const isMyTurnActive = isMyTurn();
  const canDraw = isMyTurnActive && gameState.status === 'playing' && !gameState.activeDrawnCard;

  console.log('=== CLIENT RENDER DEBUG ===', {
    socketId: socketId,
    selfPlayerId: selfPlayer?.id,
    selfPlayerPersistentId: selfPlayer?.playerId,
    opponents: opponents.map(o => ({ id: o.id, name: o.name, playerId: o.playerId })),
    floatingEmojis
  });

  // Helper: get fixed-position coords for a player's box
  // Returns both a 'top' anchor (for emojis) and a 'nameY' anchor (for chat bubbles near the name)
  const getBubblePosition = (playerId) => {
    const el = playerBoxRefs.current[playerId];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,    // horizontal center of box
      emojiY: rect.top + 10,             // near top of box — emoji floats up from here
      chatY: rect.top + rect.height * 0.38, // ~name/avatar area — speech bubble anchors here
      boxRight: rect.right,              // right edge for offset
      boxWidth: rect.width,
    };
  };

  return (
    <div className="game-table">
      
      {/* Fixed floating bubble layer — outside all overflow/backdrop-filter containers */}
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9999 }}>
        {floatingEmojis.map(e => {
          const pos = getBubblePosition(e.playerId);
          if (!pos) return null;
          // Chat bubble: anchors beside the player name (right-of-center), gentle hover
          // Emoji: floats up from the top of the player box
          const left = e.isChat
            ? pos.x + pos.boxWidth * 0.28 + e.left   // right side of box
            : pos.x + e.left;                          // center for emojis
          const top = e.isChat ? pos.chatY : pos.emojiY;
          return (
            <span
              key={e.id}
              className={e.isChat ? 'floating-chat-bubble' : 'floating-emoji'}
              style={{
                position: 'fixed',
                left: `${left}px`,
                top: `${top}px`,
              }}
            >
              {e.emoji}
            </span>
          );
        })}
      </div>

      {/* 1. Opponent Ring */}
      <div className="opponents-container">
        {opponents.map((opponent) => {
          const isActive = activePlayer && activePlayer.playerId === opponent.playerId;
          const isCaboCaller = gameState.caboPlayerId === opponent.id;
          
          return (
            <div
              key={opponent.id || opponent.playerId}
              ref={el => { playerBoxRefs.current[opponent.id] = el; }}
              className={`glass opponent-box ${isActive ? 'active' : ''}`}
              style={{ position: 'relative' }}
            >
              
              <div className="player-avatar">
                {opponent.name.charAt(0).toUpperCase()}
                {!opponent.active && (
                  <span style={{ position: 'absolute', bottom: 0, right: 0, width: '12px', height: '12px', background: 'var(--color-rose)', borderRadius: '50%', border: '2px solid var(--bg-deep)' }}></span>
                )}
              </div>
              
              <div style={{ textAlign: 'center' }}>
                <div className="flex items-center justify-center gap-1">
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{opponent.name}</span>
                  {isHost && (
                    <button 
                      onClick={() => handleKickPlayer(opponent.id)}
                      className="text-[0.6rem] bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white px-1.5 py-0.5 rounded font-bold border border-rose-500/30 transition-all cursor-pointer"
                      title="Kick Player"
                    >
                      Kick
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginTop: '2px' }}>
                  Score: <strong style={{ color: 'white' }}>{opponent.score}</strong>
                </div>
              </div>

              {isCaboCaller && (
                <div style={{ 
                  position: 'absolute', 
                  top: '-8px', 
                  right: '-8px', 
                  background: 'var(--color-rose)', 
                  color: 'white', 
                  fontSize: '0.65rem', 
                  padding: '2px 6px', 
                  borderRadius: '6px', 
                  fontWeight: 800,
                  boxShadow: '0 0 8px var(--color-rose)'
                }}>
                  CABO CALLER
                </div>
              )}

              <div className="opponent-cards">
                {opponent.cards.map((c, cIdx) => {
                  if (!c) return <div key={cIdx} style={{ width: '20px', height: '30px', border: '1px dashed rgba(255, 255, 255, 0.1)', borderRadius: '4px' }}></div>;
                  
                  const isFlipped = !c.hidden;
                  const isTargetable = isMyTurnActive && (
                    gameState.actionState.type === 'spy' || 
                    ((gameState.actionState.type === 'swap' || gameState.actionState.type === 'look_and_swap') && swapMyCardIndex !== null)
                  );
                  
                  const isOpponentClickable = gameState.status === 'playing';
                  const isSelectedSwap = swapTarget && swapTarget.playerId === opponent.id && swapTarget.cardIndex === cIdx;
                  const isSelectedOverload = overloadSelect && overloadSelect.playerId === opponent.id && overloadSelect.cardIndex === cIdx;
                  const isOpponentExposed = gameState?.exposedCard && 
                                            gameState.exposedCard.playerId === opponent.id && 
                                            gameState.exposedCard.cardIndex === cIdx;

                  return (
                    <div 
                      key={c.id || cIdx} 
                      onClick={() => isOpponentClickable && handleOpponentCardClick(opponent.id, cIdx)}
                      className={`opponent-card-back ${isFlipped ? 'flipped' : ''}`}
                      style={{ 
                        position: 'relative',
                        cursor: isOpponentClickable ? 'pointer' : 'default',
                        border: isOpponentExposed ? '2.5px solid var(--color-rose)' : isSelectedSwap ? '2px solid var(--color-cyan)' : isTargetable ? '1.5px solid var(--color-violet)' : '1px solid rgba(255, 255, 255, 0.1)',
                        transform: isSelectedSwap ? 'scale(1.15) translateY(-2px)' : 'none',
                        boxShadow: isOpponentExposed ? '0 0 14px var(--color-rose)' : isSelectedSwap ? '0 0 10px var(--color-cyan)' : isTargetable ? '0 0 8px rgba(139, 92, 246, 0.4)' : 'none',
                        transition: 'all 0.2s ease',
                        background: isFlipped ? '#1f2937' : 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isFlipped ? (c.suit === 'hearts' || c.suit === 'diamonds' ? 'var(--color-rose)' : 'white') : 'transparent',
                        fontSize: '0.65rem',
                        fontWeight: 800
                      }}
                    >
                      {isFlipped && c.value}
                      {isSelectedOverload && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOverloadAttempt(opponent.id, cIdx);
                          }}
                          className="button-glow"
                          style={{ 
                            position: 'absolute', 
                            top: '50%', 
                            left: '50%', 
                            transform: 'translate(-50%, -50%)', 
                            zIndex: 10, 
                            padding: '4px 8px', 
                            fontSize: '0.6rem',
                            background: 'linear-gradient(135deg, var(--color-rose) 0%, var(--color-orange) 100%)',
                            border: 'none',
                            boxShadow: '0 0 10px var(--color-rose)'
                          }}
                        >
                          Overload
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          );
        })}
      </div>

      {/* 2. Middle Row (Side Panels + Roundtable) */}
      <div className="w-full flex items-center justify-center gap-6 max-w-[1100px] mx-auto my-2">
        
        {/* Left Panel: Quick Reactions */}
        <div className="glass p-3.5 rounded-2xl w-[190px] flex flex-col gap-2 shrink-0 border border-white/5 shadow-lg">
          <span className="text-[0.75rem] uppercase text-gray-400 font-bold block mb-1 text-center tracking-wider border-b border-white/5 pb-1.5">
            Quick Reactions
          </span>
          <div className="grid grid-cols-3 gap-2.5 justify-items-center py-1">
            {EMOJIS.map(e => (
              <button 
                key={e} 
                onClick={() => handleSendEmoji(e)} 
                className="glass flex items-center justify-center w-10 h-10 rounded-full border border-white/20 bg-white/5 cursor-pointer text-xl transition-all duration-150 ease-in-out hover:scale-110 hover:bg-white/10"
              >
                {e}
              </button>
            ))}
          </div>
          <form onSubmit={handleSendChat} className="flex gap-1.5 mt-1">
            <input 
              type="text" 
              placeholder="Type message..." 
              className="glass-input flex-1 px-2 py-1 text-xs" 
              style={{ borderRadius: '8px' }}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              maxLength={40}
            />
            <button type="submit" className="button-glow px-2.5 py-1 text-xs rounded-lg">
              Send
            </button>
          </form>
        </div>

        {/* Center: Play Area */}
        <div className="center-board">
          
          {/* Draw Pile */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs uppercase text-gray-400 tracking-wider font-semibold">Draw Pile ({gameState.deckCount})</span>
            <div 
              onClick={handleDrawDeck}
              className={`card-container ${canDraw ? 'interactive' : ''}`}
              style={{ 
                pointerEvents: canDraw ? 'auto' : 'none',
                filter: canDraw ? 'none' : 'brightness(0.7)'
              }}
            >
              <div className="card-inner">
                <div className="card-face card-back" style={{ border: canDraw ? '2.5px solid var(--color-cyan)' : '1.5px solid var(--border-glass)' }}>
                  <div className="card-back-pattern">♠</div>
                </div>
              </div>
            </div>
          </div>

          {/* Drawn Card */}
          {gameState.activeDrawnCard && (
            <div className="flex flex-col items-center gap-3">
              <span className="text-[0.75rem] font-extrabold text-cyan-500 uppercase tracking-widest">
                Drawn Card
              </span>
              <div className="animate-draw">
                {renderCard(gameState.activeDrawnCard, null, false, false)}
              </div>
              
              {isMyTurnActive && (
                <div className="flex gap-2 mt-1">
                  {gameState.drawnCardSource === 'deck' && (
                    <>
                      <button 
                        onClick={() => handleDiscardDrawn(false)} 
                        className="button-outline px-3 py-1.5 text-[0.8rem] rounded-lg"
                      >
                        Discard
                      </button>
                      {gameState.activeDrawnCard.action !== 'none' && (
                        <button 
                          onClick={() => handleDiscardDrawn(true)} 
                          className="button-glow px-3 py-1.5 text-[0.8rem] rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-none"
                        >
                          Discard & Act
                        </button>
                      )}
                    </>
                  )}
                  {gameState.drawnCardSource === 'discard' && (
                    <span className="text-[0.8rem] text-gray-400 font-semibold">Replace hand card</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Discard Pile */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs uppercase text-gray-400 tracking-wider font-semibold">Discard Pile</span>
            {gameState.topDiscard ? (
              <div className="animate-deal" key={gameState.topDiscard.id}>
                {renderCard(
                  gameState.topDiscard, 
                  handleDrawDiscard, 
                  canDraw, 
                  false
                )}
              </div>
            ) : (
              <div className="card-container border-2 border-dashed border-white/10 rounded-xl h-[120px]"></div>
            )}
          </div>

        </div>

        {/* Right Panel: Rules Button to align and pop up Rules dialog */}
        <div className="w-[260px] shrink-0 hidden md:flex items-center justify-center">
          <button 
            onClick={() => setShowRulesModal(true)} 
            className="button-outline max-w-[190px] w-full py-2.5 text-xs flex items-center justify-center gap-1.5"
          >
            📖 Rules
          </button>
        </div>

      </div>

      {/* 3. Bottom Row (Actions & Info Panel + Dashboard + Game Log) */}
      <div className="w-full flex items-center justify-center gap-6 max-w-[1100px] mx-auto mt-2">
        
        {/* Left Panel: Actions & Info */}
        <div className="glass p-3 rounded-2xl w-[190px] h-[195px] flex flex-col gap-1.5 shrink-0 border border-white/5 shadow-lg">
          <div className="flex justify-between items-center border-b border-white/5 pb-1 select-none">
            <span className="text-[0.7rem] uppercase text-gray-400 font-bold tracking-wider">
              Actions & Info
            </span>
            <button 
              onClick={() => setShowRulesModal(true)} 
              className="text-[0.65rem] text-cyan-400 hover:text-cyan-300 font-bold bg-transparent border-none cursor-pointer p-0"
            >
              Rules 📖
            </button>
          </div>

          {/* User Stats block */}
          <div className="flex items-center justify-center gap-1.5 border-b border-white/5 pb-1 text-center select-none shrink-0">
            <span className="status-dot online shrink-0"></span>
            <span className="text-[0.75rem] font-bold text-white truncate max-w-[75px]" title={`${selfPlayer?.name} (You)`}>
              {selfPlayer?.name}
            </span>
            <span className="text-[0.65rem] bg-white/8 px-1.5 py-0.5 rounded text-gray-300 shrink-0">
              {selfPlayer?.score} pts
            </span>
            <span className="text-[0.65rem] bg-amber-500/10 px-1.5 py-0.5 rounded text-amber-400 font-bold shrink-0">
              🏆{selfPlayer?.wins || 0}
            </span>
          </div>
          
          <div className="text-cyan-400 text-[0.7rem] font-semibold leading-relaxed flex-1 flex items-center justify-center text-center overflow-y-auto pr-1">
            {gameState.status === 'initial_peeking' && (
              <span>👁️ Initial Peek: Memorize bottom two cards (Card 3 & 4), then click &quot;Done Peeking&quot;.</span>
            )}
            {gameState.status === 'playing' && isMyTurnActive && !gameState.activeDrawnCard && (
              gameState.caboPlayerId === socketId ? (
                <span>👉 You called CABO! Draw a card to complete your turn.</span>
              ) : (
                <span>👉 Your Turn: Draw from Deck/Discard, or call CABO.</span>
              )
            )}
            {gameState.status === 'playing' && isMyTurnActive && gameState.activeDrawnCard && (
              <span>🃏 Select card(s) to replace. Match equal values to discard multiple!</span>
            )}
            {gameState.status === 'playing' && !isMyTurnActive && (
              <span className="text-gray-400">⏳ Waiting for {getActivePlayerName()}&apos;s turn...</span>
            )}
            
            {gameState.actionState.type === 'peek' && gameState.actionState.sourcePlayerId === socketId && (
              <span className="text-emerald-500">🔍 Action Peek: Click one of your cards to peek.</span>
            )}
            {gameState.actionState.type === 'spy' && gameState.actionState.sourcePlayerId === socketId && (
              <span className="text-cyan-500">🕵️ Action Spy: Click an opponent card to spy.</span>
            )}
            {(gameState.actionState.type === 'swap' || gameState.actionState.type === 'look_and_swap') && gameState.actionState.sourcePlayerId === socketId && (
              <span className="text-violet-500">
                {gameState.actionState.type === 'swap' ? '🔄 Swap: Select one of your cards and one opponent card.' : '👁️ Look & Swap: Select one of your cards and one opponent card.'}
              </span>
            )}
            {gameState.overloadTransferState && (
              <span className="text-amber-500">
                {gameState.overloadTransferState.sourcePlayerId === socketId ? (
                  `👉 Overload Success! Select one of your cards to transfer.`
                ) : (
                  `⏳ Transferring card...`
                )}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5 mt-auto">
            {gameState.status === 'initial_peeking' && !selfPlayer?.peeked && (
              <button onClick={handleDonePeeking} className="button-glow w-full py-1.5 text-[0.7rem]">
                Done Peeking
              </button>
            )}
            
            {(gameState.actionState.type === 'swap' || gameState.actionState.type === 'look_and_swap') && gameState.actionState.sourcePlayerId === socketId && (
              <button 
                onClick={handleConfirmSwap} 
                className="button-glow w-full py-1.5 text-[0.7rem] bg-gradient-to-br from-violet-500 to-cyan-500"
                disabled={swapMyCardIndex === null || swapTarget === null}
              >
                Confirm Swap
              </button>
            )}

            {gameState.overloadTransferState && gameState.overloadTransferState.sourcePlayerId === socketId && (
              <button 
                onClick={handleConfirmTransfer} 
                className="button-glow w-full py-1.5 text-[0.7rem] bg-gradient-to-br from-amber-500 to-orange-500"
                disabled={transferCardIndex === null}
              >
                Confirm Transfer
              </button>
            )}

            {isMyTurnActive && gameState.activeDrawnCard && selectedHandIndices.length > 0 && (
              <button 
                onClick={handleConfirmReplacement} 
                className="button-glow w-full py-1.5 text-[0.7rem]"
              >
                {selectedHandIndices.length > 1 ? 'Match & Replace' : 'Replace Card'}
              </button>
            )}

            {isMyTurnActive && !gameState.activeDrawnCard && gameState.caboPlayerId === null && (
              <button 
                onClick={handleCallCabo} 
                className="button-glow w-full py-1.5 text-[0.7rem] bg-gradient-to-br from-rose-500 to-violet-500"
              >
                Call CABO!
              </button>
            )}
          </div>
        </div>

        {/* Center: Player Dashboard */}
        <div
          ref={el => { if (selfPlayer) playerBoxRefs.current[selfPlayer.id] = el; }}
          className="glass flex-1 max-w-[620px] rounded-3xl p-3 px-6 flex flex-col items-center justify-center border-t border-white/25 relative"
        >

          {/* Hand Cards first */}
          <div className="grid gap-4 justify-items-center items-center min-h-[140px]" style={{ gridTemplateColumns: `repeat(${Math.ceil((selfPlayer?.cards.length || 4) / 2)}, minmax(0, 1fr))` }}>
            {selfPlayer?.cards.map((card, idx) => {
              const isSelectable = (isMyTurnActive && (
                                    gameState.activeDrawnCard || 
                                    gameState.actionState.type === 'peek' || 
                                    gameState.actionState.type === 'swap' ||
                                    gameState.actionState.type === 'look_and_swap'
                                  )) || (
                                    gameState.overloadTransferState && 
                                    gameState.overloadTransferState.sourcePlayerId === socketId
                                  );
                                  
              const isClickable = gameState.status === 'playing';
              const isSelected = selectedHandIndices.includes(idx) || (swapMyCardIndex === idx) || (transferCardIndex === idx);
              const isSelectedOverload = overloadSelect && overloadSelect.playerId === socketId && overloadSelect.cardIndex === idx;

              return (
                <div key={card?.id || idx} className="animate-deal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', position: 'relative' }}>
                  {renderCard(
                    card, 
                    () => isClickable && handleHandCardClick(idx), 
                    isClickable || isSelectable, 
                    isSelected,
                    idx
                  )}
                  {isSelectedOverload && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOverloadAttempt(socketId, idx);
                      }}
                      className="button-glow"
                      style={{ 
                        position: 'absolute', 
                        top: '38%', 
                        left: '50%', 
                        transform: 'translate(-50%, -50%)', 
                        zIndex: 10, 
                        padding: '6px 10px', 
                        fontSize: '0.7rem',
                        background: 'linear-gradient(135deg, var(--color-rose) 0%, var(--color-orange) 100%)',
                        border: 'none',
                        boxShadow: '0 0 12px var(--color-rose)'
                      }}
                    >
                      Overload
                    </button>
                  )}
                  <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', fontWeight: 700 }}>Card {idx + 1}</span>
                </div>
              );
            })}
          </div>

        </div>

      {/* Right Panel: Game Log (Bottom Right) */}
      <div className="glass p-3.5 rounded-2xl w-[260px] flex flex-col gap-2 shrink-0 border border-white/5 shadow-lg mb-0">
        <span className="text-[0.75rem] uppercase text-gray-400 font-bold block mb-1 text-center tracking-wider border-b border-white/5 pb-1.5">
          Game Log
        </span>
        <div className="glass log-panel w-full max-h-[110px] overflow-y-auto rounded-xl p-3 font-mono text-xs leading-relaxed text-gray-400">
          {gameState.logs.slice().reverse().map((log, idx) => {
            let logClass = 'system';
            if (log.includes('called CABO')) logClass = 'cabo';
            else if (log.includes("turn")) logClass = 'active-turn';
            
            return (
              <div key={idx} className={`log-entry ${logClass}`}>
                {log}
              </div>
            );
          })}
        </div>
      </div>

    </div>

      {/* --- ACTION POWER REVEAL DIALOG MODAL --- */}
      {actionRevealCard && (
        <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/85 z-[2000]">
          <div className="glass glass-card max-w-[320px] w-full flex flex-col items-center p-8 rounded-2xl">
            <h3 className="text-xl font-extrabold mb-5 text-cyan-500 text-center">
              {actionRevealTitle}
            </h3>
            
            {renderCard({ ...actionRevealCard, hidden: false }, null, false, false)}
            
            <button 
              onClick={() => {
                setActionRevealCard(null);
                setActionRevealTitle('');
              }} 
              className="button-glow w-full mt-6"
            >
              OK, End Turn
            </button>
          </div>
        </div>
      )}

      {/* --- SPIED ON NOTIFICATION MODAL --- */}
      {spiedOnNotification && (
        <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/80 z-[2000]">
          <div className="glass glass-heavy max-w-[340px] w-full flex flex-col items-center p-6 rounded-2xl border-rose-500/40 shadow-[0_0_20px_rgba(244,63,94,0.25)] text-center">
            <div className="text-3xl mb-3">👁️</div>
            <h3 className="text-lg font-extrabold mb-3 text-rose-400">
              You Were Spied On!
            </h3>
            <p className="text-sm text-gray-300 mb-6 leading-relaxed">
              <strong>{spiedOnNotification.spiedBy}</strong>{" just spied on your "}
              <br />
              <span className="text-cyan-400 font-extrabold text-base">Card {spiedOnNotification.cardIndex + 1}</span>.
            </p>
            <button 
              onClick={() => setSpiedOnNotification(null)} 
              className="button-glow w-full bg-gradient-to-br from-rose-500 to-violet-500 shadow-none text-xs"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}
      {/* --- LOOK & SWAP REVEAL DIALOG MODAL --- */}
      {lookSwapReveal && (
        <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/85 z-[2000]">
          <div className="glass glass-card max-w-[420px] w-[90%] flex flex-col items-center p-8 rounded-2xl">
            <h3 className="text-xl font-extrabold mb-5 text-cyan-500 text-center">
              Look & Swap Complete
            </h3>
            
            <p className="text-[0.9rem] text-gray-400 text-center mb-5">
              Here are the cards before they were swapped:
            </p>

            <div className="flex gap-5 justify-center mb-6">
              <div className="flex flex-col items-center gap-2">
                <span className="text-[0.75rem] font-bold">Your Card</span>
                {renderCard({ ...lookSwapReveal.myCard, hidden: false }, null, false, false)}
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[0.75rem] font-bold">{lookSwapReveal.targetName}&apos;s Card</span>
                {renderCard({ ...lookSwapReveal.targetCard, hidden: false }, null, false, false)}
              </div>
            </div>
            
            <button 
              onClick={() => setLookSwapReveal(null)} 
              className="button-glow w-full"
            >
              OK, End Turn
            </button>
          </div>
        </div>
      )}


      {/* --- ROUND END SCORE MODAL --- */}
      {gameState.status === 'round_end' && (
        <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/85 z-[1500]">
          <div className="glass glass-card max-w-[520px] w-[90%] rounded-3xl p-8">
            <h2 className="text-2xl font-extrabold text-center mb-6 bg-gradient-to-br from-cyan-500 to-violet-500 bg-clip-text text-transparent" style={{ textShadow: '0 4px 10px rgba(0,0,0,0.4)' }}>
              Round {gameState.roundNumber} Scoring
            </h2>

            <table className="w-full border-collapse mb-7">
              <thead>
                <tr className="border-b border-white/25 text-gray-400">
                  <th className="text-left p-2.5 text-[0.8rem] uppercase font-bold">Player</th>
                  <th className="text-center p-2.5 text-[0.8rem] uppercase font-bold">Round Score</th>
                  <th className="text-right p-2.5 text-[0.8rem] uppercase font-bold">Total Score</th>
                </tr>
              </thead>
              <tbody>
                {gameState.players.map((p) => {
                  const isCabo = p.id === gameState.caboPlayerId;
                  return (
                    <tr key={p.playerId} className="border-b border-white/10">
                      <td className="py-3 px-2.5 font-semibold">
                        {p.name} {p.id === socketId && '(You)'}
                        {isCabo && <span className="ml-2 text-xs bg-rose-500 text-white px-2 py-0.5 rounded font-extrabold">CABO</span>}
                      </td>
                      <td className="py-3 px-2.5 text-center font-bold text-cyan-500">
                        {p.roundScore}
                      </td>
                      <td className="py-3 px-2.5 text-right font-extrabold">
                        {p.score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {isHost ? (
              <button onClick={handleNextRound} className="button-glow w-full py-3.5">
                Start Next Round
              </button>
            ) : (
              <div className="banner bg-cyan-500/10 text-cyan-400 text-sm p-4 rounded-xl text-center">
                Waiting for the host to start the next round...
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- GAME OVER FINAL SCORE MODAL --- */}
      {gameState.status === 'game_over' && (() => {
        const minScore = Math.min(...gameState.players.map(p => p.score));
        const winners = gameState.players.filter(p => p.score === minScore);
        
        return (
          <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/90 z-[1800]">
            <div className="glass glass-card max-w-[500px] w-[95%] rounded-3xl p-6 md:p-8 text-center max-h-[90vh] overflow-y-auto">
              
              <div className="text-4xl mb-2">🏆</div>
              
              <h2 className="text-2xl font-extrabold mb-1 bg-gradient-to-br from-amber-500 to-orange-500 bg-clip-text text-transparent">
                Game Finished!
              </h2>
              
              <div className="my-3">
                <span className="text-[0.7rem] uppercase text-amber-500/80 font-bold tracking-widest block mb-1.5">Game Winner(s)</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {winners.map(w => (
                    <div 
                      key={w.playerId} 
                      className="glass px-3.5 py-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-sm font-extrabold flex items-center gap-1 shadow-[0_0_10px_rgba(245,158,11,0.15)] animate-pulse"
                    >
                      👑 {w.name}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex flex-col gap-5 mt-4">
                {/* 1. Standings */}
                <div className="text-left">
                  <span className="text-[0.7rem] uppercase text-cyan-400 font-bold tracking-wider block mb-2">
                    {"This Game's Standings"}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {gameState.players
                      .slice()
                      .sort((a, b) => a.score - b.score)
                      .map((p, index, sortedArr) => {
                        const rank = sortedArr.filter(other => other.score < p.score).length;
                        const isWinner = p.score === minScore;
                        
                        return (
                          <div 
                            key={p.playerId} 
                            className="glass p-2 px-3 rounded-xl flex justify-between items-center text-xs"
                            style={{ borderLeft: isWinner ? '3px solid var(--color-gold)' : '1px solid var(--border-glass)' }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>{isWinner ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}</span>
                              <span className="font-semibold">{p.name}</span>
                            </div>
                            <span className="font-extrabold text-gray-300">{p.score} pts</span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* 2. Series Leaderboard */}
                <div className="text-left border-t border-white/5 pt-4">
                  <span className="text-[0.7rem] uppercase text-amber-500 font-bold tracking-wider block mb-2">
                    🏆 Series Leaderboard (Total Wins)
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {gameState.players
                      .slice()
                      .sort((a, b) => (b.wins || 0) - (a.wins || 0))
                      .map((p) => {
                        const maxWins = Math.max(...gameState.players.map(pl => pl.wins || 0));
                        const isLeader = (p.wins || 0) > 0 && (p.wins || 0) === maxWins;
                        
                        return (
                          <div 
                            key={p.playerId} 
                            className="glass p-2 px-3 rounded-xl flex justify-between items-center text-xs"
                            style={{ borderLeft: isLeader ? '3px solid var(--color-gold)' : '1px solid var(--border-glass)' }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>{isLeader ? '👑' : '👤'}</span>
                              <span className="font-semibold">{p.name}</span>
                            </div>
                            <span className="font-extrabold text-amber-400">{(p.wins || 0)} {p.wins === 1 ? 'Win' : 'Wins'}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 mt-6 border-t border-white/5 pt-4">
                {isHost ? (
                  <button onClick={handleNextRound} className="button-glow w-full py-3">
                    Play Again
                  </button>
                ) : (
                  <div className="banner bg-amber-500/10 text-amber-500 text-xs p-2.5 rounded-xl text-center">
                    Waiting for host to restart game...
                  </div>
                )}
                <button onClick={handleBackToLobby} className="button-outline w-full py-3">
                  Exit to Lobby
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* --- KICK CONFIRMATION MODAL --- */}
      {kickConfirmPlayer && (
        <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/80 z-[2500]">
          <div className="glass glass-heavy max-w-[340px] w-full flex flex-col items-center p-6 rounded-2xl border-rose-500/40 shadow-[0_0_20px_rgba(244,63,94,0.25)] text-center animate-pulse">
            <div className="text-3xl mb-3">⚠️</div>
            <h3 className="text-lg font-extrabold mb-3 text-rose-400">
              Confirm Player Kick
            </h3>
            <p className="text-sm text-gray-300 mb-6 leading-relaxed">
              Are you sure you want to kick <strong>{kickConfirmPlayer.name}</strong> from the room?
            </p>
            <div className="flex gap-3 w-full">
              <button 
                onClick={() => {
                  if (socketRef.current) {
                    socketRef.current.emit('kick_player', { roomCode, targetPlayerId: kickConfirmPlayer.id });
                  }
                  setKickConfirmPlayer(null);
                }} 
                className="button-glow flex-1 bg-rose-600 hover:bg-rose-500 text-xs py-2"
              >
                Yes, Kick
              </button>
              <button 
                onClick={() => setKickConfirmPlayer(null)} 
                className="button-outline flex-1 text-xs py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- RULES MODAL DIALOG --- */}
      {showRulesModal && (
        <div className="flex items-center justify-center fixed top-0 left-0 w-screen h-screen bg-black/85 z-[2500]">
          <div className="glass-heavy glass-card max-w-[560px] w-[90%] rounded-2xl p-6 md:p-8 text-left max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-extrabold bg-gradient-to-br from-cyan-500 to-violet-500 bg-clip-text text-transparent">
                How to Play CABO
              </h2>
              <button 
                onClick={() => setShowRulesModal(false)} 
                className="bg-transparent border-none text-gray-400 text-2xl cursor-pointer hover:text-white transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto text-[0.85rem] md:text-sm leading-relaxed pr-2 text-gray-300">
              <div><strong>Objective:</strong> End the game with the lowest total card points. You start with 4 face-down cards and must swap/match to minimize their values.</div>
              <hr className="border-white/10" />
              <div><strong>1. Setup & Peeking:</strong> At the start of the round, you get 4 cards in a 2x2 matrix. You can peek at your <b>Bottom 2 Cards</b> (Card 3 and 4) to memorize their values.</div>
              <div><strong>2. On Your Turn:</strong> Draw a card. You can:
                <ul className="list-disc pl-5 mt-1">
                  <li>Draw from <b>Deck</b>: peek at the card, then either <b>Replace</b> one of your cards with it, or <b>Discard</b> it.</li>
                  <li>Draw from <b>Discard Pile</b>: you <b>Must</b> use it to replace one of your cards.</li>
                </ul>
              </div>
              <div><strong>3. Special Card Actions (activated when discarded from Deck):</strong>
                <ul className="list-disc pl-5 mt-1">
                  <li><strong className="text-emerald-400">7 or 8 (Know your Fate):</strong> Peek at one of your own cards.</li>
                  <li><strong className="text-cyan-400">9 or 10:</strong> Peek at one card of any of the opponents.</li>
                  <li><strong className="text-violet-400">Queen:</strong> Swap one of your cards with an opponent&apos;s card without looking.</li>
                  <li><strong className="text-amber-400">King:</strong> Swap one of your cards with an opponent&apos;s card after looking at both.</li>
                </ul>
              </div>
              <div><strong>4. Card Points:</strong>
                <ul className="list-disc pl-5 mt-1">
                  <li>Aces = 1 point | 2 to 10 = face value | Queen & King = 10 points</li>
                  <li><strong className="text-rose-400">Jack = -1 point! (Negative scoring card)</strong></li>
                </ul>
              </div>
              <div><strong>5. Card Matching (Reduce Hand Size):</strong> When replacing a card, you can select <b>Multiple Matching Cards</b> from your hand (e.g. two 5s). If they match, they are all discarded, and the new card takes the slot of the first one. Mismatching gives you a penalty card!</div>
              <div><strong>6. Calling CABO:</strong> When it is your turn, if you believe you have the lowest sum of card points, you can call <b>CABO</b>. You then complete your turn. Every other player gets one final turn. When it reaches your turn again, the round ends.
                <ul className="list-disc pl-5 mt-1">
                  <li>If the <b>CABO</b> caller has the lowest score: they <b>WIN</b> the round.</li>
                </ul>
              </div>
              <div><strong>7. Series Play:</strong> Each round played is a standalone game. The system tracks how many games each player has won over multiple rounds to decide the overall series champion!</div>
            </div>

            <button 
              onClick={() => setShowRulesModal(false)} 
              className="button-glow w-full mt-5 py-2.5 text-xs"
            >
              Got it
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
