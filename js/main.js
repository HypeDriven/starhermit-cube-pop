/* Cube Pop — bootstrap: capability detection, renderer creation, UI wiring.
 * Loads rules/UI first; the 3D studio is created lazily on first round.
 */
import { BoardRenderer } from './render.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function boot() {
  const CPUI = window.CPUI;
  CPUI.init({
    createRenderer: (container, opts) => {
      if (!webglAvailable()) throw new Error('WebGL unavailable');
      return new BoardRenderer(container, opts);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
