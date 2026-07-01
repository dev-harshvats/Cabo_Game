// Backend test script for CABO game logic
const game = require('../lib/game');

function assert(condition, message) {
  if (!condition) {
    throw new Error('ASSERT FAILED: ' + message);
  }
}

console.log('Running Backend CABO Game Logic tests...');

const playersList = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' }
];

const room = game.initRoomState('TEST', playersList);

assert(room.roomCode === 'TEST', 'Room code must be TEST');
assert(room.players.length === 3, 'Must have 3 players');
assert(room.status === 'initial_peeking', 'Initial status must be initial_peeking');
assert(room.discardPile.length === 1, 'Discard pile should start with 1 card');
assert(room.deck.length === 52 - 12 - 1, 'Deck size matches');

console.log('✓ Initial setup validated');

// Peek
game.completeInitialPeek(room, 'p1');
game.completeInitialPeek(room, 'p2');
game.completeInitialPeek(room, 'p3');
assert(room.status === 'playing', 'Status must be playing');

console.log('✓ Peeking phase completed');

// Play
game.drawCardFromDeck(room, 'p1');
const oldCard = room.players[0].cards[0];
game.replaceHandCard(room, 'p1', [0]);
assert(room.players[0].cards[0] !== oldCard, 'Alice card replaced');

console.log('✓ Turn play and replacement validated');

// Match check success
room.players[2].cards = [
  { value: '5', suit: 'hearts', points: 5, action: 'none' },
  { value: '5', suit: 'spades', points: 5, action: 'none' },
  { value: '2', suit: 'clubs', points: 2, action: 'none' },
  { value: 'A', suit: 'diamonds', points: 1, action: 'none' }
];
room.turnIndex = 2; // Charlie
game.drawCardFromDeck(room, 'p3');
const drawn = room.activeDrawnCard;
game.replaceHandCard(room, 'p3', [0, 1]);
assert(room.players[2].cards[0] === drawn, 'Matched card slot 0 replaced');
assert(room.players[2].cards[1] === null, 'Matched card slot 1 cleared');

console.log('✓ Multi-card Match success validated');

// Cabo round scoring check
room.turnIndex = 0;
game.callCabo(room, 'p1');
assert(room.caboPlayerId === 'p1', 'Alice called CABO');

// Alice completes her turn
game.drawCardFromDeck(room, 'p1');
game.discardDrawnCard(room, 'p1', false);

// Bob turn
game.drawCardFromDeck(room, 'p2');
game.discardDrawnCard(room, 'p2', false);

// Setup scores
room.players[0].cards = [{ value: 'A', suit: 'hearts', points: 1 }, null, null, null]; // sum = 1
room.players[1].cards = [{ value: '4', suit: 'hearts', points: 4 }, null, null, null]; // sum = 4
room.players[2].cards = [{ value: '5', suit: 'hearts', points: 5 }, null, null, null]; // sum = 5

// Charlie turn ends round
game.drawCardFromDeck(room, 'p3');
game.discardDrawnCard(room, 'p3', false);

assert(room.status === 'game_over', 'Game ended');
assert(room.players[0].score === 0, 'Alice got 0 (cabo caller lowest)');
assert(room.players[1].score === 4, 'Bob got 4');
assert(room.players[2].score === 5, 'Charlie got 5');
assert(room.players[0].wins === 1, 'Alice got 1 win');

console.log('✓ CABO final turn cycle and score sums validated');

// Overloading tests
console.log('Running Overloading tests...');
// Top of discard is Ace of diamonds (points: 1)
room.discardPile = [{ id: 'diamonds-A-3', suit: 'diamonds', value: 'A', points: 1 }];
room.hasOverloadedCurrentDiscard = false;
room.status = 'playing';

// Mismatch overload own card (Bob attempts to overload with card 0 which is value '4')
room.players[1].cards = [{ id: 'hearts-4-1', suit: 'hearts', value: '4', points: 4 }, null, null, null];
const oResultMismatch = game.overloadCard(room, 'p2', 'p2', 0);
assert(oResultMismatch.success === false, 'Should fail mismatch');
assert(oResultMismatch.error === 'Mismatch', 'Error is Mismatch');
assert(room.players[1].cards.filter(Boolean).length === 2, 'Bob got 1 penalty card'); // was 1, now 2 cards!

// Reset
room.discardPile = [{ id: 'diamonds-A-3', suit: 'diamonds', value: 'A', points: 1 }];
room.hasOverloadedCurrentDiscard = false;

// Success overload own card (Bob overloads with card 1 which is Ace)
room.players[1].cards = [null, { id: 'hearts-A-1', suit: 'hearts', value: 'A', points: 1 }, null, null];
const oResultSuccess = game.overloadCard(room, 'p2', 'p2', 1);
assert(oResultSuccess.success === true, 'Overload success');
assert(room.players[1].cards[1] === null, 'Overloaded card removed');
assert(room.hasOverloadedCurrentDiscard === true, 'Discard is marked as overloaded');

// Success overload opponent card (Alice overloads Charlie's card)
room.discardPile = [{ id: 'hearts-A-1', suit: 'hearts', value: 'A', points: 1 }];
room.hasOverloadedCurrentDiscard = false;
room.players[0].cards = [{ id: 'clubs-5-0', suit: 'clubs', value: '5', points: 5 }, null, null, null];
room.players[2].cards = [{ id: 'spades-A-2', suit: 'spades', value: 'A', points: 1 }, null, null, null];

const oResultOpponent = game.overloadCard(room, 'p1', 'p3', 0);
assert(oResultOpponent.success === true, 'Alice overloaded Charlie card');
assert(room.players[2].cards[0] === null, 'Charlie card removed');
assert(room.overloadTransferState !== null, 'Transfer state active');
assert(room.overloadTransferState.sourcePlayerId === 'p1', 'Alice is source');
assert(room.overloadTransferState.targetPlayerId === 'p3', 'Charlie is target');

// Perform transfer (Alice transfers card index 0)
const transResult = game.transferOverloadCard(room, 'p1', 0);
assert(transResult.success === true, 'Transfer success');
assert(room.players[0].cards[0] === null, 'Alice card transferred (now null)');
assert(room.players[2].cards[0].value === '5', 'Charlie received Alice 5');
assert(room.overloadTransferState === null, 'Transfer state cleared');

console.log('✓ Overloading tests passed!');
console.log('ALL BACKEND GAME ENGINE TESTS PASSED!');
