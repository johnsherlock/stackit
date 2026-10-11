export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  { title, className = 'btn', disabled = false }: { title?: string; className?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el('button', { className, type: 'button', textContent: label, title: title ?? '', disabled });
  b.addEventListener('click', onClick);
  return b;
}

export const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: everything still works, it just won't survive a reload.
  }
}
