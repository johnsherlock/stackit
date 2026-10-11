export const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
export type Suit = (typeof SUITS)[number];

export const NUMBERS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type NumberRank = (typeof NUMBERS)[number];

export const LETTERS = ['J', 'Q', 'K', 'A'] as const;
export type LetterRank = (typeof LETTERS)[number];

export type Rank = NumberRank | LetterRank | 'W';

export interface Card {
  /** Unique within a game, even when several DECKs are combined. */
  id: string;
  suit: Suit;
  rank: Rank;
}

export const isWild = (card: Card): boolean => card.rank === 'W';

export const isNumber = (card: Card): card is Card & { rank: NumberRank } =>
  typeof card.rank === 'number';

export const isLetter = (card: Card): card is Card & { rank: LetterRank } =>
  (LETTERS as readonly Rank[]).includes(card.rank);

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
};

export const isRedSuit = (suit: Suit): boolean => suit === 'hearts' || suit === 'diamonds';

export function cardLabel(card: Card): string {
  if (isWild(card)) return 'Wild';
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export interface DeckOptions {
  /** Number of DECKs shuffled together (UH OH! PARTY uses 2). */
  decks?: number;
  includeWilds?: boolean;
}

/** One DECK is 15 cards × 4 suits: 0, 2–10, J, Q, K, A and a Wild. */
export function createDeck({ decks = 1, includeWilds = true }: DeckOptions = {}): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      const ranks: Rank[] = [...NUMBERS, ...LETTERS];
      if (includeWilds) ranks.push('W');
      for (const rank of ranks) cards.push({ id: `${d}-${suit}-${rank}`, suit, rank });
    }
  }
  return cards;
}

/** Small seeded PRNG (mulberry32) so games are reproducible and serializable. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
