import type { SoloOptions } from '../engine/solo';
import { MAX_PLAYERS, MIN_PLAYERS, type SeatSetup, type UhOhOptions, isParty } from '../engine/uhoh';
import { button, el, loadJson, randomSeed, saveJson } from './dom';

export type GameConfig =
  | { mode: 'solo'; options: SoloOptions }
  | { mode: 'uhoh'; options: UhOhOptions };

interface SetupPrefs {
  mode: 'solo' | 'uhoh';
  noWilds: boolean;
  secondChances: boolean;
  seats: SeatSetup[];
}

const PREFS_KEY = 'staccs.setup.v1';

const defaultSeat = (i: number): SeatSetup =>
  i === 0 ? { name: 'You', kind: 'human' } : { name: `Bot ${i}`, kind: 'bot' };

const DEFAULT_PREFS: SetupPrefs = {
  mode: 'uhoh',
  noWilds: false,
  secondChances: false,
  seats: [0, 1, 2, 3].map(defaultSeat),
};

/** New game with fresh shuffles but the same settings. */
export function reseed(config: GameConfig): GameConfig {
  return { ...config, options: { ...config.options, seed: randomSeed() } } as GameConfig;
}

/** The "New game" form: pick a mode, players and variations. */
export function setupForm(onStart: (config: GameConfig) => void, open: boolean): HTMLElement {
  const prefs: SetupPrefs = { ...DEFAULT_PREFS, ...loadJson<SetupPrefs>(PREFS_KEY) };
  const root = el('details', { className: 'new-game', open });
  const body = el('div', { className: 'setup-body' });
  root.append(el('summary', { textContent: 'New game' }), body);

  const draw = () => {
    const modeRow = el('div', { className: 'segmented', role: 'radiogroup' }, [
      modeButton('solo', 'Solo Stack · 1'),
      modeButton('uhoh', 'UH OH! · 2–10'),
    ]);
    const fields = prefs.mode === 'solo' ? soloFields() : uhohFields();
    const start = button('Shuffle & deal', () => {
      saveJson(PREFS_KEY, prefs);
      onStart(
        prefs.mode === 'solo'
          ? { mode: 'solo', options: { seed: randomSeed(), noWilds: prefs.noWilds, secondChances: prefs.secondChances } }
          : { mode: 'uhoh', options: { seed: randomSeed(), seats: prefs.seats.map((s) => ({ ...s })) } },
      );
      root.open = false;
    }, { className: 'btn btn-primary' });
    body.replaceChildren(modeRow, fields, start);
  };

  const modeButton = (mode: SetupPrefs['mode'], label: string) => {
    const b = button(label, () => {
      prefs.mode = mode;
      draw();
    }, { className: `seg ${prefs.mode === mode ? 'seg-on' : ''}` });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(prefs.mode === mode));
    return b;
  };

  const checkbox = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
    const input = el('input', { type: 'checkbox', checked });
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { className: 'check' }, [input, ` ${label}`]);
  };

  const soloFields = () =>
    el('div', { className: 'setup-fields' }, [
      checkbox('No Wilds', prefs.noWilds, (v) => (prefs.noWilds = v)),
      checkbox('Second Chances', prefs.secondChances, (v) => (prefs.secondChances = v)),
    ]);

  const uhohFields = () => {
    const count = prefs.seats.length;
    const select = el(
      'select',
      { className: 'player-count' },
      Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => {
        const n = i + MIN_PLAYERS;
        return el('option', { value: String(n), textContent: `${n} players`, selected: n === count });
      }),
    );
    select.addEventListener('change', () => {
      const n = Number(select.value);
      prefs.seats = Array.from({ length: n }, (_, i) => prefs.seats[i] ?? defaultSeat(i));
      draw();
    });

    const seatRows = prefs.seats.map((seat, i) => {
      const name = el('input', { type: 'text', value: seat.name, maxLength: 16, ariaLabel: `Player ${i + 1} name` });
      name.addEventListener('input', () => (seat.name = name.value.trim() || `Player ${i + 1}`));
      const kind = button(seat.kind === 'human' ? '🙂 Human' : '🤖 Bot', () => {
        seat.kind = seat.kind === 'human' ? 'bot' : 'human';
        if (seat.kind === 'human' && seat.name.startsWith('Bot')) seat.name = `Player ${i + 1}`;
        if (seat.kind === 'bot' && !seat.name.startsWith('Bot')) seat.name = `Bot ${i}`;
        draw();
      }, { className: 'btn btn-small', title: 'Toggle human / bot' });
      return el('li', { className: 'seat' }, [name, kind]);
    });

    const humans = prefs.seats.filter((s) => s.kind === 'human').length;
    const note = isParty(count)
      ? 'UH OH! PARTY: two DECKs shuffled together, bigger table.'
      : humans > 1
        ? 'Pass and play: hands stay hidden between turns.'
        : '';
    return el('div', { className: 'setup-fields' }, [
      select,
      el('ol', { className: 'seats' }, seatRows),
      note ? el('p', { className: 'setup-note', textContent: note }) : '',
    ]);
  };

  draw();
  return root;
}
