import { type Placement, isDeadEndWild } from '../engine/board';
import { chooseBotAction } from '../engine/bot';
import { type Card, SUITS, SUIT_SYMBOL, type Suit, cardLabel, isNumber, isRedSuit, isWild } from '../engine/cards';
import { type Pos, samePos } from '../engine/geometry';
import {
  type LogEvent,
  type UhOhAction,
  type UhOhState,
  actingPlayer,
  applyUhOhAction,
  isParty,
  placementsFor,
  playableCards,
} from '../engine/uhoh';
import { cardIcon, drawCard } from './cardArt';
import { button, el } from './dom';
import type { GameView, ViewHost } from './view';

const BOT_DELAY_MS = 900;
const LOG_LINES = 8;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class UhOhView implements GameView {
  readonly title: string;
  private selectedId: string | null = null;
  private pending: Placement | null = null;
  private calledSuit: Suit | null = null;
  private giveIds = new Set<string>();
  /** Pass-and-play: the human who has confirmed they're holding the device. */
  private revealedTo: number | null = null;
  private botTimer: number | undefined;

  constructor(
    private state: UhOhState,
    private readonly host: ViewHost,
  ) {
    this.title = isParty(state.players.length) ? 'UH OH! Party' : 'UH OH!';
    host.board.onSpotClick = (pos) => this.onSpotClick(pos);
  }

  dispose(): void {
    window.clearTimeout(this.botTimer);
  }

  // ---------- Whose eyes are on the screen ----------

  private get humans(): number[] {
    return this.state.players.flatMap((p, i) => (p.kind === 'human' ? [i] : []));
  }

  private isHuman(i: number | null): i is number {
    return i !== null && this.state.players[i].kind === 'human';
  }

  /** With several humans sharing a screen, hands stay hidden until the right person confirms. */
  private get needsHandoff(): boolean {
    const actor = actingPlayer(this.state);
    return this.humans.length > 1 && this.isHuman(actor) && this.revealedTo !== actor;
  }

  /** Whose hand is shown, or null for nobody's. */
  private get viewer(): number | null {
    const actor = actingPlayer(this.state);
    if (this.isHuman(actor)) return this.needsHandoff ? null : actor;
    return this.humans.length === 1 ? this.humans[0] : null;
  }

  /** The viewer may act right now. */
  private get myMove(): boolean {
    const actor = actingPlayer(this.state);
    return actor !== null && actor === this.viewer;
  }

  private name(i: number): string {
    return this.humans.length === 1 && i === this.humans[0] ? 'You' : this.state.players[i].name;
  }

  // ---------- Actions ----------

  private dispatch(action: UhOhAction): void {
    this.state = applyUhOhAction(this.state, action);
    if (actingPlayer(this.state) !== this.revealedTo) this.revealedTo = null;
    this.selectedId = null;
    this.pending = null;
    this.calledSuit = null;
    this.giveIds.clear();
    this.selectChainCard();
    this.host.save(this.state);
    this.render();
  }

  /** Mid-way through playing several of a number, pick up the next one straight away. */
  private selectChainCard(): void {
    const phase = this.state.phase;
    if (!this.myMove || phase.kind !== 'turn' || phase.chainRank === null) return;
    const next = playableCards(this.state).find((c) => c.rank === phase.chainRank);
    this.selectedId = next?.id ?? null;
  }

  private scheduleBot(): void {
    window.clearTimeout(this.botTimer);
    const actor = actingPlayer(this.state);
    if (actor === null || this.isHuman(actor)) return;
    this.botTimer = window.setTimeout(() => this.dispatch(chooseBotAction(this.state)), BOT_DELAY_MS);
  }

  private get selected(): Card | null {
    if (!this.myMove || this.state.phase.kind !== 'turn') return null;
    return this.state.players[this.state.current].hand.find((c) => c.id === this.selectedId) ?? null;
  }

  private selectCard(card: Card): void {
    if (this.state.phase.kind === 'give') {
      const amount = this.state.phase.amount;
      if (this.giveIds.has(card.id)) this.giveIds.delete(card.id);
      else if (this.giveIds.size < amount) this.giveIds.add(card.id);
      this.render();
      return;
    }
    this.selectedId = this.selectedId === card.id ? null : card.id;
    this.pending = null;
    this.render();
  }

  private onSpotClick(pos: Pos): void {
    const card = this.selected;
    if (!card) return;
    const options = placementsFor(this.state, card).filter((p) => samePos(p.pos, pos));
    if (options.length === 0) return;
    if (!isWild(card)) {
      this.place(card, options[0]);
      return;
    }
    if (this.pending && samePos(this.pending.pos, pos)) this.rotatePending(1);
    else {
      this.pending = options.find((p) => !isDeadEndWild(this.state.board, card, p)) ?? options[0];
      this.render();
    }
  }

  private place(card: Card, placement: Placement, calledSuit?: Suit): void {
    this.dispatch({ type: 'place', player: this.state.current, cardId: card.id, placement, calledSuit });
  }

  private rotatePending(step: number): void {
    const card = this.selected;
    if (!card || !this.pending) return;
    const pos = this.pending.pos;
    const options = placementsFor(this.state, card).filter((p) => samePos(p.pos, pos));
    const i = options.findIndex((p) => p.rotation === this.pending!.rotation);
    this.pending = options[(i + step + options.length) % options.length];
    this.render();
  }

  private confirmWild(): void {
    const card = this.selected;
    if (card && this.pending && this.calledSuit) this.place(card, this.pending, this.calledSuit);
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.myMove) return false;
    const s = this.state;
    const phase = s.phase;
    const me = s.current;
    switch (e.key.toLowerCase()) {
      case 'd':
        if (phase.kind === 'turn' && !phase.attack && phase.chainRank === null) this.dispatch({ type: 'draw', player: me });
        return true;
      case 'a':
        if (phase.kind === 'turn' && phase.attack) this.dispatch({ type: 'accept', player: me });
        return true;
      case 'e':
        if (phase.kind === 'turn' && phase.chainRank !== null) this.dispatch({ type: 'end-turn', player: me });
        return true;
      case 'r':
        this.rotatePending(e.shiftKey ? -1 : 1);
        return true;
      case 'enter':
        this.confirmWild();
        return true;
      case 'escape':
        this.selectedId = null;
        this.pending = null;
        this.render();
        return true;
    }
    return false;
  }

  // ---------- Rendering ----------

  render(): void {
    const card = this.selected;
    this.host.board.render({
      board: this.state.board,
      hand: card,
      placements: card ? placementsFor(this.state, card) : [],
      pending: this.pending,
    });
    this.renderPanel();
    this.scheduleBot();
  }

  private prompt(): string {
    const s = this.state;
    const phase = s.phase;
    if (phase.kind === 'over') {
      const names = phase.winners.map((i) => this.name(i)).join(' & ');
      const verb = phase.winners.length === 1 && names !== 'You' ? 'wins' : 'win';
      return phase.reason === 'empty-hand'
        ? `${names} ${verb}! 🎉`
        : `The draw pile ran out — ${names} ${verb} with the fewest cards.`;
    }
    const actor = actingPlayer(s)!;
    if (this.needsHandoff) return `Pass the device to ${this.name(actor)}.`;
    if (!this.myMove) {
      return phase.kind === 'give'
        ? `${this.name(actor)} is choosing a card to give ${this.name(phase.receiver)}…`
        : `${this.name(actor)} is thinking…`;
    }

    if (phase.kind === 'give') {
      return `Choose ${plural(phase.amount, 'card')} to give ${this.name(phase.receiver)}.`;
    }
    const { attack, chainRank } = phase;
    const card = this.selected;
    if (card && isWild(card) && this.pending) {
      if (isDeadEndWild(s.board, card, this.pending)) {
        return '⚠ Nothing could ever go on this Wild’s TOP — try another rotation.';
      }
      return this.calledSuit ? 'Turn the Wild a new way, then place it.' : 'Turn the Wild a new way and call a suit.';
    }
    if (attack) {
      const from = this.name(attack.from);
      const hit =
        attack.rank === 'Q'
          ? `${from} gives you ${plural(attack.amount, 'card')}`
          : `draw ${attack.amount}`;
      return `${from} played ${attack.rank === 'K' ? 'a KING' : attack.rank === 'J' ? 'a JACK' : 'a QUEEN'}! Counter with a ${attack.rank}, or accept: ${hit}.`;
    }
    if (chainRank !== null) {
      return card
        ? `STACK your ${cardLabel(card)} too, or end your turn.`
        : `Play more ${chainRank}s, or end your turn.`;
    }
    if (card) {
      const others = isNumber(card)
        ? s.players[s.current].hand.filter((c) => c.id !== card.id && c.rank === card.rank).length
        : 0;
      const more = others === 0 ? '' : ` If there's room beside it, you can STACK your other ${card.rank}${others > 1 ? 's' : ''} too.`;
      return `STACK the ${cardLabel(card)} on a highlighted spot.${more}`;
    }
    const playable = s.players[s.current].hand.some((c) => placementsFor(s, c).length > 0);
    const last = s.log[s.log.length - 1];
    const ace = last?.type === 'place' && last.player === s.current && last.card.rank === 'A';
    if (ace) return playable ? 'ACE! Take another turn — pick a card to STACK, or draw.' : 'ACE! Take another turn — no matches, so draw a card.';
    return playable ? 'Your turn — pick a card to STACK, or draw.' : 'No matches. Draw a card.';
  }

  private renderPlayers(): HTMLElement {
    const s = this.state;
    const actor = actingPlayer(s);
    const winners = s.phase.kind === 'over' ? s.phase.winners : [];
    const rows = s.players.map((p, i) => {
      const badges: Node[] = [];
      if (p.hand.length === 1 && s.phase.kind !== 'over') badges.push(el('span', { className: 'badge badge-uhoh', textContent: 'UH OH!' }));
      if (winners.includes(i)) badges.push(el('span', { className: 'badge badge-win', textContent: '👑' }));
      return el('li', { className: `player ${i === actor ? 'player-active' : ''}` }, [
        el('span', { className: 'player-name', textContent: `${p.kind === 'bot' ? '🤖 ' : ''}${this.name(i)}` }),
        ...badges,
        el('span', { className: 'player-count', textContent: plural(p.hand.length, 'card') }),
      ]);
    });
    return el('section', { className: 'players' }, [
      el('div', { className: 'players-head' }, [
        el('h2', { textContent: 'Players' }),
        el('span', {
          className: 'direction',
          textContent: s.direction === 1 ? 'order ↓' : 'order ↑ (reversed)',
        }),
        el('span', { className: 'pile-count', textContent: `Draw pile · ${s.drawPile.length}` }),
      ]),
      el('ol', { className: 'player-list' }, rows),
    ]);
  }

  private renderHand(): HTMLElement {
    const s = this.state;
    const viewer = this.viewer;
    const actor = actingPlayer(s);

    if (this.needsHandoff && actor !== null) {
      return el('section', { className: 'handoff' }, [
        el('p', { textContent: `It's ${this.name(actor)}'s turn. Everyone else, look away!` }),
        button(`I'm ${this.name(actor)} — show my hand`, () => {
          this.revealedTo = actor;
          this.render();
        }, { className: 'btn btn-primary' }),
      ]);
    }
    if (viewer === null || s.players[viewer].hand.length === 0) return el('section', { className: 'hand-hidden' });

    const giving = s.phase.kind === 'give' && this.myMove;
    const cards = s.players[viewer].hand.map((card) => {
      const playable = this.myMove && s.phase.kind === 'turn' && placementsFor(s, card).length > 0;
      const chosen = giving ? this.giveIds.has(card.id) : this.selectedId === card.id;
      const enabled = playable || giving;
      const b = el('button', {
        className: `hand-card ${playable ? 'hand-card-playable' : ''} ${chosen ? 'hand-card-selected' : ''}`,
        type: 'button',
        disabled: !enabled,
        title: cardLabel(card),
      }, [cardIcon(drawCard(card), cardLabel(card))]);
      b.addEventListener('click', () => this.selectCard(card));
      return b;
    });
    return el('section', { className: 'hand-section' }, [
      el('h2', { textContent: viewer === actor || this.name(viewer) === 'You' ? 'Your hand' : `${this.name(viewer)}'s hand` }),
      el('div', { className: 'hand-row' }, cards),
    ]);
  }

  private renderActions(): HTMLElement {
    const actions = el('div', { className: 'actions' });
    if (!this.myMove) return actions;
    const s = this.state;
    const phase = s.phase;
    const me = s.current;

    if (phase.kind === 'give') {
      actions.append(
        button(`Give ${plural(phase.amount, 'card')}`, () => this.dispatch({ type: 'give', player: phase.giver, cardIds: [...this.giveIds] }), {
          className: 'btn btn-primary',
          disabled: this.giveIds.size !== phase.amount,
        }),
      );
      return actions;
    }
    if (phase.kind !== 'turn') return actions;

    const card = this.selected;
    if (card && isWild(card) && this.pending) {
      const suits = el('div', { className: 'suit-picker', role: 'group', ariaLabel: 'Call a suit' },
        SUITS.map((suit) => {
          const b = button(SUIT_SYMBOL[suit], () => {
            this.calledSuit = suit;
            this.render();
          }, { title: suit, className: `btn suit-btn ${isRedSuit(suit) ? 'suit-red' : ''} ${this.calledSuit === suit ? 'suit-chosen' : ''}` });
          return b;
        }),
      );
      actions.append(
        suits,
        button('↻ Rotate', () => this.rotatePending(1), { title: 'Rotate (R)' }),
        button('Place', () => this.confirmWild(), { title: 'Place (Enter)', className: 'btn btn-primary', disabled: !this.calledSuit }),
      );
      return actions;
    }

    if (phase.attack) {
      const label = phase.attack.rank === 'Q' ? `Accept (take ${phase.attack.amount})` : `Accept (draw ${phase.attack.amount})`;
      actions.append(button(label, () => this.dispatch({ type: 'accept', player: me }), { title: 'Accept (A)', className: 'btn btn-primary' }));
    } else if (phase.chainRank !== null) {
      actions.append(button('End turn', () => this.dispatch({ type: 'end-turn', player: me }), { title: 'End turn (E)', className: 'btn btn-primary' }));
    } else {
      const stuck = s.players[me].hand.every((c) => placementsFor(s, c).length === 0);
      actions.append(button('Draw & end turn', () => this.dispatch({ type: 'draw', player: me }), {
        title: 'Draw (D)',
        className: stuck ? 'btn btn-primary' : 'btn',
      }));
    }
    return actions;
  }

  private describe(e: LogEvent): string | null {
    const card = (c: Card) => cardLabel(c);
    switch (e.type) {
      case 'start':
        return `First card: ${card(e.card)}`;
      case 'place': {
        const suit = e.calledSuit ? ` and called ${SUIT_SYMBOL[e.calledSuit]}` : '';
        return `${this.name(e.player)} ${e.counter ? 'countered with' : 'STACKED'} ${card(e.card)}${suit}`;
      }
      case 'draw':
        return e.penalty
          ? `${this.name(e.player)} took the hit and drew ${e.count}`
          : `${this.name(e.player)} drew a card`;
      case 'give':
        return `${this.name(e.player)} gave ${this.name(e.to)} ${plural(e.count, 'card')}`;
      case 'reverse':
        return 'Play reversed!';
      case 'chain-blocked': {
        const whose = this.name(e.player) === 'You' ? 'Your' : `${this.name(e.player)}'s`;
        return `${whose} other ${e.rank}s can't go beside it — turn over`;
      }
      case 'win':
      case 'end-chain':
        return null;
    }
  }

  private renderLog(): HTMLElement {
    const lines = this.state.log
      .map((e) => this.describe(e))
      .filter((t): t is string => t !== null)
      .slice(-LOG_LINES)
      .reverse();
    return el('section', { className: 'log' }, [
      el('h2', { textContent: 'What happened' }),
      el('ul', {}, lines.map((t) => el('li', { textContent: t }))),
    ]);
  }

  private renderPanel(): void {
    const over = this.state.phase.kind === 'over';
    const children: Node[] = [
      this.renderPlayers(),
      el('p', { className: `prompt ${over ? 'prompt-over' : ''}`, textContent: this.prompt(), role: 'status' }),
      this.renderHand(),
      this.renderActions(),
    ];
    if (over) {
      children.push(
        el('section', { className: 'game-over game-over-won' }, [
          el('h2', { textContent: 'Game over' }),
          button('Play again', () => this.host.playAgain(), { className: 'btn btn-primary' }),
        ]),
      );
    }
    children.push(this.renderLog());
    this.host.slot.replaceChildren(...children);
  }
}
