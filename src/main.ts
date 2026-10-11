import './style.css';
import { App } from './ui/app';

new App(document.querySelector<HTMLElement>('#app')!);

// Installable app (PWA): cache the game so it opens offline. Not in dev, where it would
// serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
