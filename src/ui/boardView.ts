import {
  type Board,
  type Placement,
  type Touch,
  checkPlacement,
  outOfPlay,
} from '../engine/board';
import type { Card } from '../engine/cards';
import { type Pos, posKey, toWorld } from '../engine/geometry';
import { HEX_POINTS, SURFACE_POINTS, drawCard } from './cardArt';
import { svg } from './svg';

export interface BoardViewModel {
  board: Board;
  /** The card being placed, if any. */
  hand: Card | null;
  /** Legal placements for the hand card. */
  placements: Placement[];
  /** Rotation to preview for a Wild on the selected spot. */
  pending: Placement | null;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PADDING = 1.2;
const MIN_WIDTH = 6;
const DRAG_THRESHOLD = 5;
/** Initial view: this many world units across, looking just above the first card. */
const INITIAL_WIDTH = 22;
const INITIAL_LIFT = 4;

/** Screen transform for a card: world y points up, SVG y points down. */
function cardTransform(pos: Pos, rotation: number): string {
  const { x, y } = toWorld(pos);
  return `translate(${x} ${-y}) rotate(${-60 * rotation})`;
}

export class BoardView {
  readonly root: SVGSVGElement;
  private readonly layers: { table: SVGGElement; cards: SVGGElement; spots: SVGGElement; preview: SVGGElement };
  private view: ViewBox = { x: 0, y: 0, w: 1, h: 1 };
  private model: BoardViewModel | null = null;
  private hovered: Pos | null = null;
  private drag: { id: number; x: number; y: number; view: ViewBox; moved: boolean } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; view: ViewBox } | null = null;

  /** Called when a highlighted spot is clicked. */
  onSpotClick: (pos: Pos) => void = () => {};

  constructor() {
    this.layers = {
      table: svg('g', { class: 'table-layer' }),
      cards: svg('g', { class: 'cards-layer' }),
      spots: svg('g', { class: 'spots-layer' }),
      preview: svg('g', { class: 'preview-layer' }),
    };
    this.root = svg('svg', { class: 'board', role: 'application', 'aria-label': 'STACK table' }, [
      svg('defs', {}, [
        svg('pattern', { id: 'iso-grid', width: Math.sqrt(3), height: 1, patternUnits: 'userSpaceOnUse' }, [
          svg('path', {
            d: `M0 0 L${Math.sqrt(3)} 1 M0 1 L${Math.sqrt(3)} 0 M0 0 V1`,
            class: 'grid-line',
          }),
        ]),
        // Each card casts a soft shadow on the cards under it, so overlaps read as depth.
        svg('filter', { id: 'card-shadow', x: '-25%', y: '-25%', width: '150%', height: '150%' }, [
          svg('feDropShadow', { dx: 0, dy: 0, stdDeviation: 0.09, 'flood-color': '#0b1636', 'flood-opacity': 0.6 }),
        ]),
      ]),
      this.layers.table,
      this.layers.cards,
      this.layers.spots,
      this.layers.preview,
    ]);
    this.bindPointer();
    new ResizeObserver(() => this.applyView()).observe(this.root);
  }

  render(model: BoardViewModel): void {
    const previous = this.model?.board.bounds;
    this.model = model;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(model.board.bounds)) this.drawTable();
    if (!previous) this.resetView();
    this.drawCards();
    this.drawSpots();
    this.drawPreview();
  }

  /** Look at the first card, with room above it for the STACK to grow. */
  resetView(): void {
    const first = this.model?.board.placed[0];
    if (!first) return this.fit();
    const { x, y } = toWorld(first.pos);
    const aspect = this.root.clientWidth > 0 ? this.root.clientHeight / this.root.clientWidth : 0.65;
    const w = INITIAL_WIDTH;
    const h = w * aspect;
    this.view = { x: x - w / 2, y: -(y + INITIAL_LIFT) - h / 2, w, h };
    this.applyView();
  }

  fit(): void {
    if (!this.model) return;
    const { minX, maxX, minY, maxY } = this.model.board.bounds;
    this.view = {
      x: minX - PADDING,
      y: -maxY - PADDING,
      w: maxX - minX + 2 * PADDING,
      h: maxY - minY + 2 * PADDING,
    };
    this.applyView();
  }

  zoom(factor: number, center?: { x: number; y: number }): void {
    const v = this.view;
    const c = center ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    const maxW = this.maxWidth();
    const w = Math.min(maxW, Math.max(MIN_WIDTH, v.w * factor));
    const k = w / v.w;
    this.view = { x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k, w, h: v.h * k };
    this.applyView();
  }

  private maxWidth(): number {
    if (!this.model) return 100;
    const { minX, maxX, minY, maxY } = this.model.board.bounds;
    return Math.max(maxX - minX, maxY - minY) * 3;
  }

  private applyView(): void {
    const { x, y, w, h } = this.view;
    this.root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  private drawTable(): void {
    const { minX, maxX, minY, maxY } = this.model!.board.bounds;
    const rect = { x: minX, y: -maxY, width: maxX - minX, height: maxY - minY };
    this.layers.table.replaceChildren(
      svg('rect', { ...rect, class: 'table', rx: 0.3 }),
      svg('rect', { ...rect, fill: 'url(#iso-grid)', class: 'table-grid', rx: 0.3 }),
    );
  }

  private drawCards(): void {
    const { board } = this.model!;
    const touched = this.hoverTouches();
    this.layers.cards.replaceChildren(
      ...board.placed.map((p, index) => {
        const art = drawCard(p.card, { calledSuit: p.calledSuit });
        const g = svg('g', { transform: cardTransform(p.pos, p.rotation), class: 'placed' }, [art]);
        if (outOfPlay(board, index)) g.append(svg('polygon', { points: HEX_POINTS, class: 'out-of-play' }));
        if (board.blockedTops?.includes(index)) {
          g.append(
            svg('polygon', { points: SURFACE_POINTS.top, class: 'blocked-top' }),
            svg('text', { x: 0, y: -0.5, class: 'blocked-mark', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, ['⊘']),
          );
        }
        for (const t of touched.filter((t) => t.index === index)) {
          g.append(svg('polygon', { points: SURFACE_POINTS[t.surface], class: 'touch-highlight' }));
        }
        return g;
      }),
    );
  }

  /** Surfaces the hovered spot would cover, to highlight what is being matched. */
  private hoverTouches(): Touch[] {
    const target = this.previewPlacement();
    const { board, hand } = this.model!;
    if (!target || !hand) return [];
    const check = checkPlacement(board, hand, target);
    return check.ok ? check.touches : [];
  }

  private spotPositions(): Pos[] {
    const unique = new Map<string, Pos>();
    for (const p of this.model!.placements) unique.set(posKey(p.pos), p.pos);
    return [...unique.values()];
  }

  private drawSpots(): void {
    const pending = this.model!.pending;
    this.layers.spots.replaceChildren(
      ...this.spotPositions().map((pos) => {
        const selected = pending !== null && posKey(pending.pos) === posKey(pos);
        const spot = svg('polygon', {
          points: HEX_POINTS,
          transform: cardTransform(pos, 0),
          class: selected ? 'spot spot-selected' : 'spot',
          'data-pos': posKey(pos),
        });
        spot.addEventListener('pointerenter', () => this.setHover(pos));
        spot.addEventListener('pointerleave', () => this.setHover(null));
        spot.addEventListener('click', () => {
          if (!this.drag?.moved) this.onSpotClick(pos);
        });
        return spot;
      }),
    );
  }

  private previewPlacement(): Placement | null {
    const { pending, placements } = this.model!;
    if (pending) return pending;
    if (!this.hovered) return null;
    const key = posKey(this.hovered);
    return placements.find((p) => posKey(p.pos) === key) ?? null;
  }

  private drawPreview(): void {
    const target = this.previewPlacement();
    const hand = this.model!.hand;
    if (!target || !hand) {
      this.layers.preview.replaceChildren();
      return;
    }
    this.layers.preview.replaceChildren(
      svg('g', { transform: cardTransform(target.pos, target.rotation), class: 'preview' }, [drawCard(hand)]),
    );
  }

  private setHover(pos: Pos | null): void {
    if (this.hovered === pos) return;
    this.hovered = pos;
    if (!this.model) return;
    this.drawCards();
    this.drawPreview();
  }

  /** Converts a client point to SVG user space. */
  private toUser(clientX: number, clientY: number): { x: number; y: number } {
    const ctm = this.root.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  private bindPointer(): void {
    const root = this.root;

    root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.0015), this.toUser(e.clientX, e.clientY));
      },
      { passive: false },
    );

    root.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, view: { ...this.view }, moved: false };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), view: { ...this.view } };
        if (this.drag) this.drag.moved = true;
      }
    });

    root.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        this.view = { ...this.pinch.view };
        const mid = this.toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.zoom(this.pinch.dist / Math.max(dist, 1), mid);
        return;
      }

      const drag = this.drag;
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        root.setPointerCapture(e.pointerId);
        root.classList.add('panning');
      }
      const scale = drag.view.w / root.clientWidth;
      const ratio = Math.max(scale, drag.view.h / root.clientHeight);
      this.view = { ...this.view, x: drag.view.x - dx * ratio, y: drag.view.y - dy * ratio };
      this.applyView();
    });

    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) {
        root.classList.remove('panning');
        // Let the click handler see `moved` before clearing the drag.
        setTimeout(() => (this.drag = null));
      }
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }
}
