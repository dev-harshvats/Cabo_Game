// Core CABO Card Game Engine

const SUITS = ['hearts', 'diamonds', 'spades', 'clubs'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Helper to calculate point value of a card
function getCardPoints(value, suit) {
  if (value === 'A') return 1;
  if (['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(value)) {
    return parseInt(value);
  }
  if (value === 'J') return -1; // Jack is -1
  if (value === 'Q' || value === 'K') return 10; // Queen & King are 10
  return 0;
}

// Helper to determine special card action
function getCardAction(value) {
  if (value === '7' || value === '8') return 'peek'; // Peek one of your cards
  if (value === '9' || value === '10') return 'spy'; // Peek one opponent card
  if (value === 'Q') return 'swap'; // Swap cards without looking
  if (value === 'K') return 'look_and_swap'; // Swap cards after looking at both
  return 'none';
}

// Push a card to the discard pile and reset overload tracker
function pushToDiscardPile(room, card) {
  room.discardPile.push(card);
  room.hasOverloadedCurrentDiscard = false;
}

// Helper to deal penalty cards to a player, filling empty slots first before extending the hand
function dealPenaltyCards(room, player, count) {
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) {
      if (room.discardPile.length > 1) {
        const topCard = room.discardPile.pop();
        room.deck = room.discardPile;
        shuffleDeck(room.deck);
        room.discardPile = [topCard];
      }
    }
    if (room.deck.length > 0) {
      const penaltyCard = room.deck.pop();
      const emptyIdx = player.cards.indexOf(null);
      if (emptyIdx !== -1) {
        player.cards[emptyIdx] = penaltyCard;
      } else {
        player.cards.push(penaltyCard);
      }
    }
  }
}

// Create a standard deck of 52 cards
function createDeck() {
  const deck = [];
  let idCounter = 0;
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({
        id: `${suit}-${value}-${idCounter++}`,
        suit,
        value,
        points: getCardPoints(value, suit),
        action: getCardAction(value),
      });
    }
  }
  return deck;
}

// Shuffle deck in place (Fisher-Yates)
function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Initialize a new CABO game room state
function initRoomState(roomCode, playersList) {
  const deck = shuffleDeck(createDeck());
  
  // Format players with 4 cards each
  const players = playersList.map((p, idx) => {
    const cards = [];
    for (let i = 0; i < 4; i++) {
      cards.push(deck.pop());
    }
    return {
      id: p.id,
      playerId: p.playerId,
      name: p.name,
      cards,
      peeked: false, // Tracks if player completed their initial outer 2 cards peek
      score: 0,
      roundScore: 0,
      isHost: idx === 0,
      active: true
    };
  });

  const discardPile = [deck.pop()];

  return {
    roomCode,
    status: 'initial_peeking', // 'initial_peeking' -> 'playing' -> 'round_end' -> 'game_over'
    players,
    deck,
    discardPile,
    hasOverloadedCurrentDiscard: false,
    overloadTransferState: null,
    exposedCard: null,
    turnIndex: 0,
    caboPlayerId: null,
    turnsLeft: null,
    activeDrawnCard: null,
    drawnCardSource: null, // 'deck' | 'discard'
    actionState: {
      type: 'none', // 'peek' | 'spy' | 'swap' | 'none'
      sourcePlayerId: null,
      targetPlayerId: null,
      selectedCards: []
    },
    roundNumber: 1,
    logs: ['Game started! Bottom two cards automatically revealed. Click Done Peeking when ready.']
  };
}

// Reset room state for a new round
function initNextRound(room) {
  const deck = shuffleDeck(createDeck());
  
  room.players.forEach(p => {
    p.cards = [];
    for (let i = 0; i < 4; i++) {
      p.cards.push(deck.pop());
    }
    p.peeked = false;
    p.roundScore = 0;
    p.score = 0;
  });

  room.discardPile = [deck.pop()];
  room.hasOverloadedCurrentDiscard = false;
  room.overloadTransferState = null;
  room.exposedCard = null;
  room.deck = deck;
  room.status = 'initial_peeking';
  room.turnIndex = 0;
  room.caboPlayerId = null;
  room.turnsLeft = null;
  room.activeDrawnCard = null;
  room.drawnCardSource = null;
  room.actionState = {
    type: 'none',
    sourcePlayerId: null,
    targetPlayerId: null,
    selectedCards: []
  };
  room.roundNumber += 1;
  room.logs.push(`--- Round ${room.roundNumber} Started ---`);
  room.logs.push('Peeking phase started. Peek at your outer two cards.');
  return room;
}

// Complete initial peek phase for a player
function completeInitialPeek(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (player) {
    player.peeked = true;
    room.logs.push(`${player.name} is ready.`);
  }

  // If all players are ready, start playing
  if (room.players.every(p => p.peeked)) {
    room.status = 'playing';
    const firstPlayer = room.players[room.turnIndex];
    room.logs.push(`All players ready! It is ${firstPlayer.name}'s turn.`);
  }
}

// Draw a card from the deck
function drawCardFromDeck(room, playerId) {
  if (room.status !== 'playing') return;
  const player = room.players[room.turnIndex];
  if (player.id !== playerId) return;
  if (room.activeDrawnCard) return; // Already drew a card

  if (room.deck.length === 0) {
    // If deck is empty, shuffle discard pile (except top card) back into deck
    if (room.discardPile.length <= 1) {
      room.logs.push('No cards left to shuffle! Round ends.');
      endRound(room);
      return;
    }
    const topDiscard = room.discardPile.pop();
    room.deck = shuffleDeck([...room.discardPile]);
    room.discardPile = [topDiscard];
    room.logs.push('Deck ran out. Discard pile shuffled back into deck.');
  }

  const drawnCard = room.deck.pop();
  room.activeDrawnCard = drawnCard;
  room.drawnCardSource = 'deck';
  room.logs.push(`${player.name} drew a card from the deck.`);
}

// Draw a card from the discard pile
function drawCardFromDiscard(room, playerId) {
  if (room.status !== 'playing') return;
  const player = room.players[room.turnIndex];
  if (player.id !== playerId) return;
  if (room.activeDrawnCard) return; // Already drew a card
  if (room.discardPile.length === 0) return;

  const drawnCard = room.discardPile.pop();
  room.activeDrawnCard = drawnCard;
  room.drawnCardSource = 'discard';
  room.logs.push(`${player.name} took the top card (${drawnCard.value} of ${drawnCard.suit}) from the discard pile.`);
}

// Discard the card drawn from the deck (only allowed if drawn from deck)
function discardDrawnCard(room, playerId, triggerAction = false) {
  if (room.status !== 'playing') return;
  const player = room.players[room.turnIndex];
  if (player.id !== playerId) return;
  if (!room.activeDrawnCard || room.drawnCardSource !== 'deck') return;

  const discardedCard = room.activeDrawnCard;
  pushToDiscardPile(room, discardedCard);
  room.activeDrawnCard = null;
  room.drawnCardSource = null;

  room.logs.push(`${player.name} discarded the drawn ${discardedCard.value} of ${discardedCard.suit}.`);

  if (triggerAction && discardedCard.action !== 'none') {
    room.actionState = {
      type: discardedCard.action,
      sourcePlayerId: playerId,
      targetPlayerId: null,
      selectedCards: []
    };
    room.logs.push(`Action activated: ${discardedCard.action.toUpperCase()}! Waiting for action completion.`);
  } else {
    advanceTurn(room);
  }
}

// Replace card(s) in hand with the active drawn card (includes matching logic)
function replaceHandCard(room, playerId, handIndices) {
  if (room.status !== 'playing') return;
  const player = room.players[room.turnIndex];
  if (player.id !== playerId) return;
  if (!room.activeDrawnCard) return;
  if (!Array.isArray(handIndices) || handIndices.length === 0) return;

  const drawnCard = room.activeDrawnCard;

  if (handIndices.length === 1) {
    // Standard replacement
    const targetIdx = handIndices[0];
    if (targetIdx < 0 || targetIdx >= player.cards.length) return;

    const oldCard = player.cards[targetIdx];
    player.cards[targetIdx] = drawnCard;
    
    if (oldCard) {
      pushToDiscardPile(room, oldCard);
      room.logs.push(`${player.name} replaced a card with the drawn card. Discarded: ${oldCard.value} of ${oldCard.suit}.`);
    } else {
      room.logs.push(`${player.name} placed the drawn card into an empty slot.`);
    }

    room.activeDrawnCard = null;
    room.drawnCardSource = null;
    advanceTurn(room);
  } else {
    // Matching attempt
    const cardsToMatch = handIndices.map(idx => player.cards[idx]).filter(Boolean);
    
    if (cardsToMatch.length !== handIndices.length) {
      room.logs.push(`${player.name} tried to match empty slots! Action cancelled.`);
      return;
    }

    const firstValue = cardsToMatch[0].value;
    const isMatch = cardsToMatch.every(c => c.value === firstValue);

    if (isMatch) {
      // Successful match!
      handIndices.forEach(idx => {
        pushToDiscardPile(room, player.cards[idx]);
        player.cards[idx] = null; // empty slot
      });

      const primaryIdx = handIndices[0];
      player.cards[primaryIdx] = drawnCard;

      room.logs.push(`Match Success! ${player.name} matched ${handIndices.length} cards of value ${firstValue} and replaced them with the drawn card.`);
    } else {
      // Mismatch penalty!
      pushToDiscardPile(room, drawnCard);
      dealPenaltyCards(room, player, 1);
      room.logs.push(`Match Mismatch! ${player.name} failed to match cards. Dealt 1 penalty card face-down.`);
    }

    room.activeDrawnCard = null;
    room.drawnCardSource = null;
    advanceTurn(room);
  }
}

// Complete the card power action (Peek, Spy, Swap)
function executeCardAction(room, playerId, actionData) {
  if (room.status !== 'playing') return;
  const player = room.players[room.turnIndex];
  if (player.id !== playerId) return;
  if (room.actionState.type === 'none') return;

  const { type, sourcePlayerId } = room.actionState;
  if (sourcePlayerId !== playerId) return;

  if (type === 'peek') {
    const { cardIndex } = actionData;
    if (cardIndex < 0 || cardIndex >= player.cards.length) return;
    
    const peekedCard = player.cards[cardIndex];
    room.logs.push(`${player.name} peeked at one of their cards.`);
    
    room.actionState = { type: 'none', sourcePlayerId: null, targetPlayerId: null, selectedCards: [] };
    advanceTurn(room);
    
    return { success: true, card: peekedCard };
  } 
  
  if (type === 'spy') {
    const { targetPlayerId, cardIndex } = actionData;
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || targetPlayerId === playerId) return;
    if (cardIndex < 0 || cardIndex >= targetPlayer.cards.length) return;

    const spiedCard = targetPlayer.cards[cardIndex];
    room.logs.push(`${player.name} spied on a card of ${targetPlayer.name}.`);

    room.actionState = { type: 'none', sourcePlayerId: null, targetPlayerId: null, selectedCards: [] };
    advanceTurn(room);

    return { success: true, card: spiedCard };
  }

  if (type === 'swap') {
    const { myCardIndex, targetPlayerId, targetCardIndex } = actionData;
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || targetPlayerId === playerId) return;
    if (myCardIndex < 0 || myCardIndex >= player.cards.length) return;
    if (targetCardIndex < 0 || targetCardIndex >= targetPlayer.cards.length) return;

    const myCard = player.cards[myCardIndex];
    const targetCard = targetPlayer.cards[targetCardIndex];

    player.cards[myCardIndex] = targetCard;
    targetPlayer.cards[targetCardIndex] = myCard;

    room.logs.push(`${player.name} swapped a card with ${targetPlayer.name} without looking.`);

    room.actionState = { type: 'none', sourcePlayerId: null, targetPlayerId: null, selectedCards: [] };
    advanceTurn(room);

    return { success: true };
  }

  if (type === 'look_and_swap') {
    const { myCardIndex, targetPlayerId, targetCardIndex } = actionData;
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || targetPlayerId === playerId) return;
    if (myCardIndex < 0 || myCardIndex >= player.cards.length) return;
    if (targetCardIndex < 0 || targetCardIndex >= targetPlayer.cards.length) return;

    const myCard = player.cards[myCardIndex];
    const targetCard = targetPlayer.cards[targetCardIndex];

    // Swap them
    player.cards[myCardIndex] = targetCard;
    targetPlayer.cards[targetCardIndex] = myCard;

    room.logs.push(`${player.name} swapped a card with ${targetPlayer.name} after seeing both cards.`);

    room.actionState = { type: 'none', sourcePlayerId: null, targetPlayerId: null, selectedCards: [] };
    advanceTurn(room);

    // Return both card details to the client so the player can see them
    return { success: true, myCard, targetCard };
  }
}

// Call CABO
function callCabo(room, playerId) {
  if (room.status !== 'playing') return;
  const player = room.players[room.turnIndex];
  if (player.id !== playerId) return;
  if (room.caboPlayerId !== null) return;

  room.caboPlayerId = playerId;
  room.turnsLeft = room.players.length - 1;
  room.logs.push(`${player.name} called CABO! They get to complete their turn.`);
}

// Advance to the next player's turn
function advanceTurn(room) {
  if (room.caboPlayerId !== null) {
    if (room.turnsLeft <= 0) {
      endRound(room);
      return;
    }
    room.turnsLeft--;
  }

  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  const nextPlayer = room.players[room.turnIndex];
  room.logs.push(`It is now ${nextPlayer.name}'s turn.`);
}

// End the round and calculate scores
function endRound(room) {
  room.logs.push('--- Round Ended! Revealing Hands ---');

  room.players.forEach(p => {
    p.roundScore = p.cards
      .filter(Boolean)
      .reduce((sum, card) => sum + card.points, 0);
  });

  const caboPlayer = room.players.find(p => p.id === room.caboPlayerId);
  const caboSum = caboPlayer ? caboPlayer.roundScore : 999;

  let isStrictlyLowest = true;
  room.players.forEach(p => {
    if (p.id !== room.caboPlayerId && p.roundScore <= caboSum) {
      isStrictlyLowest = false;
    }
  });

  room.players.forEach(p => {
    if (p.id === room.caboPlayerId) {
      if (isStrictlyLowest) {
        p.roundScore = 0;
        room.logs.push(`${p.name} successfully called CABO with the lowest score! Earned 0 points.`);
      } else {
        p.roundScore = caboSum + 10;
        room.logs.push(`${p.name} called CABO but did not have the lowest score. Penalty applied (+10). Score: ${p.roundScore}`);
      }
    } else {
      room.logs.push(`${p.name} cards sum: ${p.roundScore}`);
    }

    p.score = p.roundScore;
  });

  // Calculate winner(s) of this game (lowest score)
  const minScore = Math.min(...room.players.map(p => p.score));
  const winners = room.players.filter(p => p.score === minScore);

  winners.forEach(w => {
    w.wins = (w.wins || 0) + 1;
    room.logs.push(`🏆 ${w.name} wins this game!`);
  });

  room.status = 'game_over';
}

function overloadCard(room, playerId, targetPlayerId, cardIndex) {
  if (room.status !== 'playing') return { success: false, error: 'Game not active' };
  if (room.overloadTransferState) return { success: false, error: 'Card transfer in progress' };

  const player = room.players.find(p => p.id === playerId);
  const targetPlayer = room.players.find(p => p.id === targetPlayerId);
  if (!player || !targetPlayer) return { success: false, error: 'Player not found' };

  const targetCard = targetPlayer.cards[cardIndex];
  if (!targetCard) return { success: false, error: 'Empty slot selected' };

  const topDiscard = room.discardPile[room.discardPile.length - 1];
  if (!topDiscard) return { success: false, error: 'Discard pile is empty' };

  const isOwn = targetPlayerId === playerId;

  // 1. Race condition check (already overloaded)
  if (room.hasOverloadedCurrentDiscard) {
    const penaltyCount = isOwn ? 1 : 3;
    dealPenaltyCards(room, player, penaltyCount);
    room.logs.push(`Fail Overload! ${player.name} tried to match too late. Exposed card: ${targetCard.value} of ${targetCard.suit} (Card ${cardIndex + 1}) and got ${penaltyCount} penalty cards.`);
    return { success: false, error: 'Already matched', revealCard: targetCard, revealPlayerId: targetPlayerId, revealIndex: cardIndex };
  }

  // 2. Value matching check
  if (targetCard.value === topDiscard.value) {
    // SUCCESS!
    room.hasOverloadedCurrentDiscard = true;

    // Discard the card directly
    room.discardPile.push(targetCard);
    targetPlayer.cards[cardIndex] = null; // Mark empty

    room.logs.push(`SUCCESS OVERLOAD! ${player.name} matched ${targetPlayer.name}'s card (${targetCard.value} of ${targetCard.suit}) on top of the discard pile!`);

    // If opponent card, initiate card transfer
    if (!isOwn) {
      room.overloadTransferState = {
        sourcePlayerId: playerId,
        targetPlayerId: targetPlayerId,
        targetCardIndex: cardIndex
      };
      room.logs.push(`Overload Transfer: ${player.name} must choose one of their own cards to transfer to ${targetPlayer.name}.`);
    }

    return { success: true };
  } else {
    // MISMATCH PENALTY!
    const penaltyCount = isOwn ? 1 : 3;
    dealPenaltyCards(room, player, penaltyCount);
    room.logs.push(`Fail Overload! ${player.name} mismatched ${targetPlayer.name}'s card. (Tried matching ${targetCard.value} with ${topDiscard.value}). Exposed card and got ${penaltyCount} penalty cards.`);
    return { success: false, error: 'Mismatch', revealCard: targetCard, revealPlayerId: targetPlayerId, revealIndex: cardIndex };
  }
}

function transferOverloadCard(room, playerId, sourceCardIndex) {
  if (!room.overloadTransferState) return { success: false, error: 'No active transfer' };

  const { sourcePlayerId, targetPlayerId, targetCardIndex } = room.overloadTransferState;
  if (sourcePlayerId !== playerId) return { success: false, error: 'Not your transfer' };

  const player = room.players.find(p => p.id === sourcePlayerId);
  const targetPlayer = room.players.find(p => p.id === targetPlayerId);
  if (!player || !targetPlayer) return { success: false, error: 'Player not found' };

  const cardToTransfer = player.cards[sourceCardIndex];
  if (!cardToTransfer) return { success: false, error: 'Select a valid card to transfer' };

  // Transfer card
  player.cards[sourceCardIndex] = null;
  targetPlayer.cards[targetCardIndex] = cardToTransfer;

  room.logs.push(`${player.name} transferred a card to ${targetPlayer.name} to complete the overload.`);

  room.overloadTransferState = null;
  return { success: true };
}

function removePlayerMidGame(room, targetPlayerId) {
  const playerIndex = room.players.findIndex(p => p.id === targetPlayerId);
  if (playerIndex === -1) return;

  const kickedPlayer = room.players[playerIndex];

  // 1. If the kicked player called CABO, clear it
  if (room.caboPlayerId === targetPlayerId) {
    room.caboPlayerId = null;
    room.logs.push(`cabo: CABO caller ${kickedPlayer.name} was removed. CABO call cancelled.`);
  }

  // 2. If the kicked player had a drawn card, clear it
  if (room.activeDrawnCard && room.turnIndex === playerIndex) {
    room.activeDrawnCard = null;
    room.drawnCardSource = null;
  }

  // 3. Remove player from players array
  room.players.splice(playerIndex, 1);
  room.logs.push(`${kickedPlayer.name} was kicked from the game.`);

  // 4. If less than 2 players left, reset back to lobby
  if (room.players.length < 2) {
    room.status = 'lobby';
    room.logs.push(`Not enough players to continue. Room status reset to lobby.`);
    return;
  }

  // 5. Adjust turnIndex
  if (playerIndex < room.turnIndex) {
    // Kicked player was before the active player, so active player shifted left by 1
    room.turnIndex--;
  } else if (playerIndex === room.turnIndex) {
    // Kicked player WAS the active player
    // Keep turnIndex the same (it now points to the next player), but ensure it wraps correctly
    room.turnIndex = room.turnIndex % room.players.length;
    // Log the new player's turn
    const activePlayer = room.players[room.turnIndex];
    room.logs.push(`It is now ${activePlayer.name}'s turn.`);
  }
}

function handleTurnTimeout(room) {
  if (room.status !== 'playing') return;

  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer) return;

  room.logs.push(`⏰ Timeout! ${activePlayer.name}'s turn timed out. Dealt 1 penalty card.`);

  // 1. If player had an active drawn card, push it to discard pile
  if (room.activeDrawnCard) {
    pushToDiscardPile(room, room.activeDrawnCard);
    room.activeDrawnCard = null;
    room.drawnCardSource = null;
  }

  // 2. Clear any active actions
  room.actionState = { type: 'none', sourcePlayerId: null, targetPlayerId: null, selectedCards: [] };

  // 3. Deal penalty card
  dealPenaltyCards(room, activePlayer, 1);

  // 4. Advance turn
  advanceTurn(room);
}

module.exports = {
  initRoomState,
  initNextRound,
  completeInitialPeek,
  drawCardFromDeck,
  drawCardFromDiscard,
  discardDrawnCard,
  replaceHandCard,
  executeCardAction,
  callCabo,
  overloadCard,
  transferOverloadCard,
  removePlayerMidGame,
  handleTurnTimeout
};
