import {
  type Board,
  type Placement,
  checkPlacement,
  createBoard,
  legalPlacements,
  placeCard,
  startBoard,
} from './board';
import {
  type Card,
  type LetterRank,
  type NumberRank,
  type Suit,
  createDeck,
  createRng,
  isNumber,
  isWild,
  shuffle,
} from './cards';
import { type Bounds, type Pos, DEFAULT_BOUNDS, coveringPos, samePos, scaleBounds, startPos } from './geometry';

/**
 * UH OH! (2–5 players) and UH OH! PARTY (6–10 players, two DECKs).
 * Be the first to STACK all the cards in your hand.
 *
 * On your turn, STACK a matching card or draw 1 card (which ends your turn).
 *   ZERO   next player can't STACK on its TOP; with 3+ players, reverses direction
 *   JACK   next player draws 1        QUEEN  you give the next player 1 card
 *   KING   next player draws 2        ACE    take another turn
 *   WILD   any open TOP, rotated, call a suit; can't be your last card
 * J/Q/K can be countered by playing the same letter; the effect adds up and passes on.
 * You may play several cards of the same NUMBER in one turn.
 */

export interface SeatSetup {
  name: string;
  kind: 'human' | 'bot';
}

export interface UhOhOptions {
  seed: number;
  seats: SeatSetup[];
}

export interface Player extends SeatSetup {
  hand: Card[];
}

export type AttackRank = Extract<LetterRank, 'J' | 'Q' | 'K'>;

export interface Attack {
  rank: AttackRank;
  /** Cards to draw (J, K) or to be given (Q). Grows each time it is countered. */
  amount: number;
  /** Who played the latest attack card — the giver for a QUEEN. */
  from: number;
}

export type Phase =
  /** `current` is taking a turn. With an attack pending they must counter or accept it first. */
  | { kind: 'turn'; attack: Attack | null; chainRank: NumberRank | null }
  /** A QUEEN was accepted: `giver` picks cards to hand to `receiver`. */
  | { kind: 'give'; giver: number; receiver: number; amount: number }
  | { kind: 'over'; winners: number[]; reason: 'empty-hand' | 'draw-pile-empty' };

export type LogEvent =
  | { type: 'start'; card: Card }
  | { type: 'place'; player: number; card: Card; calledSuit?: Suit; counter?: boolean }
  | { type: 'draw'; player: number; count: number; penalty?: AttackRank }
  | { type: 'give'; player: number; to: number; count: number }
  | { type: 'end-chain'; player: number }
  /** The turn ended because more of a number were held, but none fit beside the last one. */
  | { type: 'chain-blocked'; player: number; rank: NumberRank }
  | { type: 'reverse' }
  | { type: 'win'; players: number[]; reason: 'empty-hand' | 'draw-pile-empty' };

export interface UhOhState {
  mode: 'uhoh';
  options: UhOhOptions;
  board: Board;
  /** Last element is the top of the pile. */
  drawPile: Card[];
  players: Player[];
  current: number;
  /** +1 is clockwise (seat order). */
  direction: 1 | -1;
  phase: Phase;
  /** Tops blocked by ZEROs played this turn; they apply on the next player's turn. */
  pendingBlocks: number[];
  log: LogEvent[];
}

export type UhOhAction =
  | { type: 'place'; player: number; cardId: string; placement: Placement; calledSuit?: Suit }
  | { type: 'draw'; player: number }
  | { type: 'end-turn'; player: number }
  | { type: 'accept'; player: number }
  | { type: 'give'; player: number; cardIds: string[] };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
const PARTY_FROM = 6;

const ATTACK_AMOUNT: Record<AttackRank, number> = { J: 1, Q: 1, K: 2 };
const isAttackRank = (rank: Card['rank']): rank is AttackRank => rank === 'J' || rank === 'Q' || rank === 'K';

export const isParty = (playerCount: number): boolean => playerCount >= PARTY_FROM;

/** 7 cards each, or 5 at a full table (5 players, or 10 for a party). */
export const handSize = (playerCount: number): number => (playerCount === 5 || playerCount === 10 ? 5 : 7);

export function tableBounds(playerCount: number): Bounds {
  // A party STACK is "twice as long, twice as wide".
  return isParty(playerCount) ? scaleBounds(DEFAULT_BOUNDS, 2) : DEFAULT_BOUNDS;
}

export class IllegalActionError extends Error {}

function fail(message: string): never {
  throw new IllegalActionError(message);
}

const isStartCard = (card: Card): boolean => isNumber(card) && card.rank !== 0;

export function newUhOhGame(options: UhOhOptions): UhOhState {
  const count = options.seats.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) fail(`UH OH! needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);

  const rng = createRng(options.seed);
  let drawPile = shuffle(createDeck({ decks: isParty(count) ? 2 : 1 }), rng);

  const players: Player[] = options.seats.map((seat) => ({ ...seat, hand: [] }));
  for (let round = 0; round < handSize(count); round++) {
    for (const p of players) p.hand.push(drawPile.pop()!);
  }

  // The first card must be a number 2–10. Skipped cards go back and the pile is reshuffled.
  const skipped: Card[] = [];
  let first = drawPile.pop()!;
  while (!isStartCard(first)) {
    skipped.push(first);
    first = drawPile.pop()!;
  }
  if (skipped.length) drawPile = shuffle([...drawPile, ...skipped], rng);

  return {
    mode: 'uhoh',
    options,
    board: startBoard(createBoard(tableBounds(count)), first, startPos(tableBounds(count))),
    drawPile,
    players,
    // The dealer is the last seat, so the first seat goes first.
    current: 0,
    direction: 1,
    phase: { kind: 'turn', attack: null, chainRank: null },
    pendingBlocks: [],
    log: [{ type: 'start', card: first }],
  };
}

/** The player who must act next, or null when the game is over. */
export function actingPlayer(state: UhOhState): number | null {
  switch (state.phase.kind) {
    case 'turn':
      return state.current;
    case 'give':
      return state.phase.giver;
    case 'over':
      return null;
  }
}

export function nextSeat(state: UhOhState, from = state.current): number {
  const n = state.players.length;
  return (from + state.direction + n) % n;
}

/**
 * Which cards in the current player's hand may be played right now, ignoring placement.
 * Countering an attack needs the same letter; mid-chain needs the same number; a Wild
 * can't be your last card.
 */
export function cardIsAllowed(state: UhOhState, card: Card): boolean {
  if (state.phase.kind !== 'turn') return false;
  const { attack, chainRank } = state.phase;
  const hand = state.players[state.current].hand;
  if (attack) return card.rank === attack.rank;
  if (chainRank !== null) return card.rank === chainRank;
  if (isWild(card)) return hand.length > 1;
  return true;
}

/**
 * Mid-chain, the next number must go on the SIDE of the one just played, so a pair or
 * trio goes down side by side. Returns that spot, or null outside a chain.
 */
function chainSpot(state: UhOhState): Pos | null {
  if (state.phase.kind !== 'turn' || state.phase.chainRank === null) return null;
  const last = state.board.placed[state.board.placed.length - 1];
  return coveringPos(last.pos, 'side', last.rotation);
}

/** Legal placements for a card in the current player's hand. */
export function placementsFor(state: UhOhState, card: Card): Placement[] {
  if (!cardIsAllowed(state, card)) return [];
  const all = legalPlacements(state.board, card);
  const spot = chainSpot(state);
  return spot ? all.filter((p) => samePos(p.pos, spot)) : all;
}

/** Cards in the current player's hand that can be played somewhere right now. */
export function playableCards(state: UhOhState): Card[] {
  if (state.phase.kind !== 'turn') return [];
  return state.players[state.current].hand.filter((c) => placementsFor(state, c).length > 0);
}

export function applyUhOhAction(state: UhOhState, action: UhOhAction): UhOhState {
  const actor = actingPlayer(state);
  if (actor === null) fail('The game is over');
  if (action.player !== actor) fail('It is not your turn');

  const s = structuredClone(state);
  switch (action.type) {
    case 'place':
      place(s, action.cardId, action.placement, action.calledSuit);
      break;
    case 'draw':
      drawForTurn(s);
      break;
    case 'end-turn':
      endChain(s);
      break;
    case 'accept':
      accept(s);
      break;
    case 'give':
      give(s, action.cardIds);
      break;
  }
  return s;
}

function turnPhase(s: UhOhState) {
  if (s.phase.kind !== 'turn') fail('Not in a turn');
  return s.phase;
}

function place(s: UhOhState, cardId: string, placement: Placement, calledSuit?: Suit): void {
  const phase = turnPhase(s);
  const player = s.players[s.current];
  const card = player.hand.find((c) => c.id === cardId) ?? fail('That card is not in your hand');

  if (!cardIsAllowed(s, card)) {
    if (phase.attack) fail(`Counter with a ${phase.attack.rank} or accept the penalty`);
    if (phase.chainRank !== null) fail(`Only more ${phase.chainRank}s can be played this turn`);
    fail("A Wild can't be your last card");
  }
  if (isWild(card) && !calledSuit) fail('Call a suit for the Wild');
  const check = checkPlacement(s.board, card, placement);
  if (!check.ok) fail(`Illegal placement: ${check.reason}`);
  const spot = chainSpot(s);
  if (spot && !samePos(placement.pos, spot)) fail(`The next ${phase.chainRank} goes beside the last one`);

  s.board = placeCard(s.board, card, placement, isWild(card) ? calledSuit : undefined);
  player.hand = player.hand.filter((c) => c.id !== cardId);
  s.log.push({
    type: 'place',
    player: s.current,
    card,
    calledSuit: isWild(card) ? calledSuit : undefined,
    counter: phase.attack ? true : undefined,
  });

  if (player.hand.length === 0) {
    finish(s, [s.current], 'empty-hand');
    return;
  }

  if (isNumber(card)) {
    if (card.rank === 0) {
      s.pendingBlocks.push(s.board.placed.length - 1);
      if (s.players.length >= 3) {
        s.direction = s.direction === 1 ? -1 : 1;
        s.log.push({ type: 'reverse' });
      }
    }
    // Keep the turn open while more of the same number can be played.
    const rank = card.rank;
    s.phase = { kind: 'turn', attack: null, chainRank: rank };
    if (playableCards(s).length === 0) {
      if (player.hand.some((c) => c.rank === rank)) s.log.push({ type: 'chain-blocked', player: s.current, rank });
      endTurn(s, null);
    }
    return;
  }

  if (isAttackRank(card.rank)) {
    const amount = (phase.attack?.amount ?? 0) + ATTACK_AMOUNT[card.rank];
    endTurn(s, { rank: card.rank, amount, from: s.current });
    return;
  }

  if (card.rank === 'A') {
    // Another turn, straight away.
    s.phase = { kind: 'turn', attack: null, chainRank: null };
    return;
  }

  endTurn(s, null); // Wild
}

function drawForTurn(s: UhOhState): void {
  const phase = turnPhase(s);
  if (phase.attack) fail('Counter or accept the attack first');
  if (phase.chainRank !== null) fail('End your turn instead');
  if (!drawCards(s, s.current, 1)) return;
  endTurn(s, null);
}

function endChain(s: UhOhState): void {
  const phase = turnPhase(s);
  if (phase.chainRank === null) fail('Nothing to end — play a card or draw');
  s.log.push({ type: 'end-chain', player: s.current });
  endTurn(s, null);
}

function accept(s: UhOhState): void {
  const { attack } = turnPhase(s);
  if (!attack) fail('There is nothing to accept');

  if (attack.rank === 'Q') {
    const giver = s.players[attack.from];
    s.phase = {
      kind: 'give',
      giver: attack.from,
      receiver: s.current,
      amount: Math.min(attack.amount, giver.hand.length),
    };
    return;
  }

  if (!drawCards(s, s.current, attack.amount, attack.rank)) return;
  // Taking the hit doesn't cost you your turn.
  s.phase = { kind: 'turn', attack: null, chainRank: null };
}

function give(s: UhOhState, cardIds: string[]): void {
  if (s.phase.kind !== 'give') fail('Nothing to give');
  const { giver, receiver, amount } = s.phase;
  const hand = s.players[giver].hand;
  const unique = new Set(cardIds);
  if (unique.size !== amount) fail(`Choose ${amount} card${amount === 1 ? '' : 's'} to give`);
  const given = hand.filter((c) => unique.has(c.id));
  if (given.length !== amount) fail('Those cards are not in your hand');

  s.players[giver].hand = hand.filter((c) => !unique.has(c.id));
  s.players[receiver].hand.push(...given);
  s.log.push({ type: 'give', player: giver, to: receiver, count: amount });

  // The QUEEN SWEEP: giving away your last card wins.
  if (s.players[giver].hand.length === 0) {
    finish(s, [giver], 'empty-hand');
    return;
  }
  s.phase = { kind: 'turn', attack: null, chainRank: null };
}

/** Draws for a player. Returns false (and ends the game) if the draw pile ran out. */
function drawCards(s: UhOhState, player: number, count: number, penalty?: AttackRank): boolean {
  const drawn = s.drawPile.splice(Math.max(0, s.drawPile.length - count)).reverse();
  s.players[player].hand.push(...drawn);
  s.log.push({ type: 'draw', player, count: drawn.length, penalty });
  if (drawn.length < count) {
    // Out of cards and nobody has won: the fewest cards left wins.
    const fewest = Math.min(...s.players.map((p) => p.hand.length));
    const winners = s.players.flatMap((p, i) => (p.hand.length === fewest ? [i] : []));
    finish(s, winners, 'draw-pile-empty');
    return false;
  }
  return true;
}

function endTurn(s: UhOhState, attack: Attack | null): void {
  // ZERO blocks apply for exactly the next player's turn.
  s.board = { ...s.board, blockedTops: s.pendingBlocks };
  s.pendingBlocks = [];
  s.current = nextSeat(s);
  s.phase = { kind: 'turn', attack, chainRank: null };
}

function finish(s: UhOhState, winners: number[], reason: 'empty-hand' | 'draw-pile-empty'): void {
  s.phase = { kind: 'over', winners, reason };
  s.log.push({ type: 'win', players: winners, reason });
}
