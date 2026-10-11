import { realign } from '../engine/board';
import { newSoloGame } from '../engine/solo';
import { newUhOhGame } from '../engine/uhoh';
import { BoardView } from './boardView';
import { button, el, loadJson, saveJson } from './dom';
import { type GameConfig, reseed, setupForm } from './setup';
import { SoloView } from './soloView';
import { UhOhView } from './uhohView';
import type { GameView, SavedGame, ViewHost } from './view';

const SAVE_KEY = 'staccs.game.v2';

interface Saved {
  config: GameConfig;
  state: SavedGame;
}

const RULES: Record<GameConfig['mode'], string[]> = {
  solo: [
    'Use the whole DECK to build one STACK. Draw a card and STACK it, or discard it face up.',
    'You can play the top discard instead of drawing.',
  ],
  uhoh: [
    'Be the first to STACK every card in your hand. No match? Draw 1 and your turn ends.',
    'ZERO: the next player can’t use its TOP; with 3+ players it reverses play.',
    'JACK: next player draws 1 · KING: draws 2 · QUEEN: you give them a card · ACE: go again.',
    'Counter a J, Q or K with the same letter: it adds up and passes on.',
    'Play several of the same number in one turn. A Wild can’t be your last card.',
  ],
};

const STACKING = [
  'TOP: match the suit.',
  'SIDE (right): match the number, 0–10.',
  'FACE (left): match the letter — J, Q, K, A.',
  'Every surface a card covers fully must match — except dead surfaces (like a number’s FACE) on a card that’s already out of play (dimmed). It can overhang half of a lower card’s surface, which blocks it, but can’t be tucked in under a card.',
  'Wilds go on any open TOP and turn the STACK a new way (not straight back). Later cards follow the new direction.',
];

export class App {
  private readonly board = new BoardView();
  private readonly brandMode = el('p', { className: 'mode' });
  private readonly slot = el('div', { className: 'game-slot' });
  private readonly extras = el('div', { className: 'extras' });
  private view: GameView | null = null;
  private config: GameConfig;

  constructor(root: HTMLElement) {
    const zoomControls = el('div', { className: 'zoom-controls' }, [
      button('+', () => this.board.zoom(0.8), { title: 'Zoom in' }),
      button('−', () => this.board.zoom(1.25), { title: 'Zoom out' }),
      button('⌖', () => this.board.resetView(), { title: 'Back to the start' }),
      button('⤢', () => this.board.fit(), { title: 'Whole table' }),
    ]);
    const panel = el('aside', { className: 'panel' }, [
      el('header', { className: 'brand' }, [el('h1', { textContent: 'STACK IT' }), this.brandMode]),
      this.slot,
      this.extras,
    ]);
    root.replaceChildren(el('main', { className: 'stage' }, [this.board.root, zoomControls]), panel);

    const saved = loadJson<Saved>(SAVE_KEY);
    const valid = saved?.config && saved.state && saved.state.mode === saved.config.mode;
    if (valid) saved.state.board = realign(saved.state.board);
    this.config = valid ? saved.config : { mode: 'uhoh', options: { seed: 0, seats: [] } };
    if (valid) this.show(saved.state, false);
    else this.renderExtras(true);

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.view?.onKey(e)) e.preventDefault();
    });
  }

  private start(config: GameConfig): void {
    this.config = config;
    const state = config.mode === 'solo' ? newSoloGame(config.options) : newUhOhGame(config.options);
    this.save(state);
    this.show(state, true);
  }

  private save(state: SavedGame): void {
    saveJson(SAVE_KEY, { config: this.config, state } satisfies Saved);
  }

  private show(state: SavedGame, fresh: boolean): void {
    this.view?.dispose();
    const host: ViewHost = {
      board: this.board,
      slot: this.slot,
      save: (s) => this.save(s),
      playAgain: () => this.start(reseed(this.config)),
    };
    this.view = state.mode === 'solo' ? new SoloView(state, host) : new UhOhView(state, host);
    this.brandMode.textContent = this.view.title;
    this.view.render();
    if (fresh) this.board.resetView();
    this.renderExtras(false);
  }

  private renderExtras(openSetup: boolean): void {
    const mode = this.view ? this.config.mode : 'uhoh';
    if (!this.view) this.slot.replaceChildren(el('p', { className: 'prompt', textContent: 'Set up a game to start STACKING.' }));
    this.extras.replaceChildren(
      setupForm((config) => this.start(config), openSetup),
      el('details', { className: 'rules' }, [
        el('summary', { textContent: 'How to play' }),
        el('h3', { textContent: 'STACKING' }),
        el('ul', {}, STACKING.map((t) => el('li', { textContent: t }))),
        el('h3', { textContent: mode === 'solo' ? 'Solo Stack' : 'UH OH!' }),
        el('ul', {}, RULES[mode].map((t) => el('li', { textContent: t }))),
        el('p', {
          className: 'keys',
          textContent:
            mode === 'solo'
              ? 'Keys: D draw · T take discard · X discard · R rotate · Enter place · Esc cancel'
              : 'Keys: D draw · A accept attack · E end turn · R rotate · Enter place · Esc cancel',
        }),
      ]),
    );
  }
}
