'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const rulesDialogRef = useRef(null);

  useEffect(() => {
    const savedName = localStorage.getItem('cabo_player_name');
    if (savedName) {
      setPlayerName(savedName);
    }
  }, []);

  const getOrCreatePlayerId = () => {
    let playerId = localStorage.getItem('cabo_player_id');
    if (!playerId) {
      playerId = 'cabo_player_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('cabo_player_id', playerId);
    }
    return playerId;
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!playerName.trim()) {
      setError('Please enter your name.');
      return;
    }
    
    localStorage.setItem('cabo_player_name', playerName.trim());
    getOrCreatePlayerId();
    setError('');

    router.push('/room/new');
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!playerName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!roomCode.trim() || roomCode.trim().length !== 4) {
      setError('Please enter a valid 4-character room code.');
      return;
    }

    localStorage.setItem('cabo_player_name', playerName.trim());
    getOrCreatePlayerId();
    setError('');

    router.push(`/room/${roomCode.trim().toUpperCase()}`);
  };

  const handleBackdropClick = (e) => {
    const dialog = rulesDialogRef.current;
    if (dialog && e.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      const isInside = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInside) {
        dialog.close();
      }
    }
  };

  return (
    <main className="flex items-center justify-center min-h-screen p-6">
      <div className="glass glass-card max-w-[480px] w-full rounded-3xl p-6 md:p-8">
        
        <div className="text-center mb-8">
          <h1 className="text-5xl font-extrabold bg-gradient-to-br from-cyan-500 to-violet-500 bg-clip-text text-transparent mb-2" style={{ textShadow: '0 4px 20px rgba(6, 182, 212, 0.15)' }}>
            CABO
          </h1>
          <p className="text-gray-400 font-medium">
            Play online with up to 6 friends
          </p>
        </div>

        {error && (
          <div className="banner bg-rose-500/15 border border-rose-500 text-rose-200 mb-5 text-sm p-3 rounded-lg text-center">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label className="block text-xs uppercase text-gray-400 tracking-wider mb-2 font-semibold">
            Your Display Name
          </label>
          <input 
            type="text" 
            className="glass-input w-full" 
            placeholder="e.g. SecretSpy007" 
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={15}
          />
        </div>

        <div className="flex flex-col gap-4">
          
          <button onClick={handleCreateRoom} className="button-glow w-full py-3.5">
            Create New Room
          </button>

          <div className="flex items-center justify-center text-gray-400 text-sm my-2">
            <hr className="flex-1 border-white/10" />
            <span className="px-3 font-semibold">OR</span>
            <hr className="flex-1 border-white/10" />
          </div>

          <form onSubmit={handleJoinRoom} className="flex gap-3">
            <input 
              type="text" 
              className="glass-input flex-1 uppercase text-center font-bold tracking-widest" 
              placeholder="ROOM CODE" 
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              maxLength={4}
            />
            <button type="submit" className="button-outline py-3.5 px-6">
              Join
            </button>
          </form>

          <button 
            onClick={() => rulesDialogRef.current?.showModal()} 
            className="button-outline border-none bg-transparent text-cyan-500 mt-4 font-bold"
          >
            📖 How to Play & Rules
          </button>

        </div>

      </div>

      <dialog 
        ref={rulesDialogRef} 
        onClick={handleBackdropClick}
        className="glass-heavy p-7 max-w-[560px] rounded-2xl"
      >
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-extrabold bg-gradient-to-br from-cyan-500 to-violet-500 bg-clip-text text-transparent">
            How to Play CABO
          </h2>
          <button 
            onClick={() => rulesDialogRef.current?.close()} 
            className="bg-transparent border-none text-gray-400 text-2xl cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto max-h-[60vh] text-[0.95rem] leading-relaxed pr-2">
          
          <div><strong>Objective:</strong> End the game with the lowest total card points. You start with 4 face-down cards and must swap/match to minimize their values.</div>
          
          <hr className="border-white/10" />
          
          <div><strong>1. Setup & Peeking:</strong> At the start of the round, you get 4 cards in a 2x2 matrix. You can peek at your **bottom two cards** (Card 3 and 4) to memorize their values.</div>
 
          <div><strong>2. On Your Turn:</strong> Draw a card. You can:
            <ul className="list-disc pl-5 mt-1">
              <li>Draw from **Deck**: peek at the card, then either **replace** one of your cards with it, or **discard** it.</li>
              <li>Draw from **Discard Pile**: you *must* use it to replace one of your cards.</li>
            </ul>
          </div>
 
          <div><strong>3. Special Card Actions (activated when discarded from Deck):</strong>
            <ul className="list-disc pl-5 mt-1">
              <li><strong className="text-emerald-500">7 or 8 (Know your Fate):</strong> Peek at one of your own cards.</li>
              <li><strong className="text-cyan-500">9 or 10:</strong> Peek at one card of any of the opponents.</li>
              <li><strong className="text-violet-500">Queen:</strong> Swap one of your cards with an opponent's card without looking.</li>
              <li><strong className="text-gold-500">King:</strong> Swap one of your cards with an opponent's card after looking at both.</li>
            </ul>
          </div>
 
          <div><strong>4. Card Points:</strong>
            <ul className="list-disc pl-5 mt-1">
              <li>Aces = 1 point | 2 to 10 = face value | Queen & King = 10 points</li>
              <li><strong className="text-rose-500">Jack = -1 point! (Negative scoring card)</strong></li>
            </ul>
          </div>
 
          <div><strong>5. Card Matching (Reduce Hand Size):</strong> When replacing a card, you can select **multiple matching cards** from your hand (e.g. two 5s). If they match, they are all discarded, and the new card takes the slot of the first one (reducing your hand size). If you mismatch, you keep your cards and get a penalty card face down from the deck!</div>
 
          <div><strong>6. Calling CABO:</strong> When it is your turn, if you believe you have the lowest sum of card points, you can call **CABO**. You do not draw. Every other player gets one final turn. Then, all cards are revealed.
            <ul className="list-disc pl-5 mt-1">
              <li>If the CABO caller has the lowest score: they get **0 points** for the round.</li>
              <li>If another player has a score equal to or lower: the CABO caller gets their sum **+ 10 penalty points**; other players get their normal sums.</li>
            </ul>
          </div>
 
          <div><strong>7. Game End:</strong> When a player reaches 100 cumulative points, the game ends. Lowest score wins. If you reach exactly 100 points, your score **resets to 50**!</div>
 
        </div>

        <button 
          onClick={() => rulesDialogRef.current?.close()} 
          className="button-glow w-full mt-6"
        >
          Got it, let's play!
        </button>
      </dialog>
    </main>
  );
}
