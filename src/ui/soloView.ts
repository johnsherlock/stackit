import { type Placement, isDeadEndWild, legalPlacements } from '../engine/board';
import { cardLabel, isWild } from '../engine/cards';
import { type Pos, samePos } from '../engine/geometry';
import {
  type SoloAction,
  type SoloState,
  applySoloAction,
  canRecycle,
  canTakeDiscard,
  discardTop,
} from '../engine/solo';
import { cardIcon, drawCard, drawCardBack } from './cardArt';
import { button, el } from './dom';
import type { GameView, ViewHost } from './view';

export class SoloView implements GameView {
  readonly title = 'Solo Stack';
  private placements: Placement[] = [];
  /** Wild placement being set up: chosen spot and rotation, not yet confirmed. */
  private pending: Placement | null = null;

  constructor(
    private state: SoloState,
    private readonly host: ViewHost,
  ) {
    host.board.onSpotClick = (pos) => this.onSpotClick(pos);
  }

  dispose(): void {}

  private dispatch(action: SoloAction): void {
    this.state = applySoloAction(this.state, action);
    this.pending = null;
    this.host.save(this.state);
    this.render();
  }

  render(): void {
    const { hand, board } = this.state;
    this.placements = hand ? legalPlacements(board, hand) : [];
    this.host.board.render({ board, hand, placements: this.placements, pending: this.pending });
    this.renderPanel();
  }

  private onSpotClick(pos: Pos): void {
    const hand = this.state.hand;
    if (!hand) return;
    const options = this.placements.filter((p) => samePos(p.pos, pos));
    if (options.length === 0) return;

    if (!isWild(hand)) {
      this.dispatch({ type: 'place', placement: options[0] });
      return;
    }
    // Wilds: first click picks the spot, further clicks rotate.
    if (this.pending && samePos(this.pending.pos, pos)) this.rotatePending(1);
    else {
      this.pending = options.find((p) => !isDeadEndWild(this.state.board, hand, p)) ?? options[0];
      this.render();
    }
  }

  private rotatePending(step: number): void {
    if (!this.pending) return;
    const pos = this.pending.pos;
    const options = this.placements.filter((p) => samePos(p.pos, pos));
    const i = options.findIndex((p) => p.rotation === this.pending!.rotation);
    this.pending = options[(i + step + options.length) % options.length];
    this.render();
  }

  private confirmPending(): void {
    if (this.pending) this.dispatch({ type: 'place', placement: this.pending });
  }

  private cancelPending(): void {
    this.pending = null;
    this.render();
  }

  onKey(e: KeyboardEvent): boolean {
    const s = this.state;
    if (s.status !== 'playing') return false;
    switch (e.key.toLowerCase()) {
      case 'd':
      case ' ':
        if (!s.hand && s.drawPile.length > 0) this.dispatch({ type: 'draw' });
        else if (!s.hand && canRecycle(s)) this.dispatch({ type: 'recycle' });
        return true;
      case 't':
        if (canTakeDiscard(s)) this.dispatch({ type: 'take-discard' });
        return true;
      case 'x':
        if (s.hand) this.dispatch({ type: 'discard' });
        return true;
      case 'r':
        this.rotatePending(e.shiftKey ? -1 : 1);
        return true;
      case 'enter':
        this.confirmPending();
        return true;
      case 'escape':
        this.cancelPending();
        return true;
    }
    return false;
  }

  private pile(content: SVGGElement | null, label: string, caption: string, onClick?: () => void): HTMLElement {
    const icon = cardIcon(content, label);
    const wrap = onClick
      ? el('button', { className: 'pile pile-active', type: 'button', title: label }, [icon])
      : el('div', { className: 'pile' }, [icon]);
    if (onClick) wrap.addEventListener('click', onClick);
    return el('figure', { className: 'pile-figure' }, [wrap, el('figcaption', { textContent: caption })]);
  }

  private prompt(): string {
    const s = this.state;
    if (s.status === 'won') return 'PERFECT WIN! Every card is in the STACK.';
    if (s.status === 'finished') return 'No more matches — the game is over.';
    const hand = s.hand;
    if (hand) {
      if (this.placements.length === 0) return `No spot fits the ${cardLabel(hand)}. Discard it.`;
      if (isWild(hand)) {
        if (!this.pending) return 'Wilds go on any open TOP. Pick a spot.';
        return isDeadEndWild(s.board, hand, this.pending)
          ? '⚠ Nothing could ever go on this Wild’s TOP — try another rotation.'
          : 'Rotate the Wild to point the STACK in a new direction, then place it.';
      }
      return `STACK the ${cardLabel(hand)} on a highlighted spot, or discard it.`;
    }
    if (canTakeDiscard(s) && s.drawPile.length === 0) return 'Draw pile is empty — take the top discard.';
    if (s.drawPile.length === 0 && canRecycle(s)) return 'Draw pile is empty — flip the discard pile to go again.';
    return canTakeDiscard(s) ? 'Draw a card, or take the top discard.' : 'Draw a card.';
  }

  private renderPanel(): void {
    const s = this.state;
    const playing = s.status === 'playing';
    const top = discardTop(s);
    const canDraw = playing && !s.hand && s.drawPile.length > 0;

    const piles = el('div', { className: 'piles' }, [
      this.pile(
        s.drawPile.length > 0 ? drawCardBack() : null,
        'Draw pile',
        `Draw · ${s.drawPile.length}`,
        canDraw ? () => this.dispatch({ type: 'draw' }) : undefined,
      ),
      this.pile(
        top ? drawCard(top) : null,
        top ? `Top discard: ${cardLabel(top)}` : 'Discard pile',
        `Discard · ${s.discardPile.length}`,
        canTakeDiscard(s) ? () => this.dispatch({ type: 'take-discard' }) : undefined,
      ),
    ]);

    const hand = el('section', { className: 'hand' }, [
      el('h2', { textContent: 'In hand' }),
      cardIcon(s.hand ? drawCard(s.hand) : null, s.hand ? cardLabel(s.hand) : 'Empty hand'),
    ]);

    const actions = el('div', { className: 'actions' });
    if (playing && this.pending) {
      actions.append(
        button('↻ Rotate', () => this.rotatePending(1), { title: 'Rotate (R)' }),
        button('Place', () => this.confirmPending(), { title: 'Place (Enter)', className: 'btn btn-primary' }),
        button('Cancel', () => this.cancelPending(), { title: 'Cancel (Esc)' }),
      );
    } else if (playing && s.hand) {
      actions.append(button('Discard', () => this.dispatch({ type: 'discard' }), { title: 'Discard (X)' }));
    } else if (canDraw) {
      actions.append(button('Draw', () => this.dispatch({ type: 'draw' }), { title: 'Draw (D)', className: 'btn btn-primary' }));
    } else if (canRecycle(s)) {
      actions.append(
        button('Flip discard pile', () => this.dispatch({ type: 'recycle' }), {
          title: 'Second chances',
          className: 'btn btn-primary',
        }),
      );
    }

    const placed = s.board.placed.length;
    const fill = el('div', { className: 'progress-fill' });
    fill.style.width = `${(100 * placed) / s.totalCards}%`;
    const progress = el('div', { className: 'progress' }, [
      el('div', { className: 'progress-label', textContent: `STACKED ${placed} / ${s.totalCards}` }),
      el('div', { className: 'progress-bar' }, [fill]),
    ]);

    const children: Node[] = [
      progress,
      el('p', { className: `prompt ${playing ? '' : 'prompt-over'}`, textContent: this.prompt(), role: 'status' }),
      el('div', { className: 'play-area' }, [hand, piles]),
      actions,
    ];
    if (!playing) {
      children.push(
        el('section', { className: `game-over ${s.status === 'won' ? 'game-over-won' : ''}` }, [
          el('h2', { textContent: s.status === 'won' ? 'Perfect win!' : 'Game over' }),
          el('p', { textContent: `You STACKED ${placed} of ${s.totalCards} cards.` }),
          button('Play again', () => this.host.playAgain(), { className: 'btn btn-primary' }),
        ]),
      );
    }
    this.host.slot.replaceChildren(...children);
  }
}
