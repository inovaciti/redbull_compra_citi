// Botões da geladeira: abrir/fechar porta e recentralizar a câmera.

import { disposables, replayClass } from '../core/dom.js';

/**
 * @param {{ refs: Record<string, HTMLElement>, store: any, actions: any }} opts
 */
export function createFridgeControls({ refs, store, actions }) {
  const d = disposables();
  const { door, doorTip, recenter } = refs;

  d.listen(door, 'click', () => actions.toggleDoor());
  d.listen(recenter, 'click', () => {
    actions.recenter();
    replayClass(recenter, 'is-spinning');
  });

  function render(state) {
    const label = state.doorOpen ? 'Fechar Porta' : 'Abrir Porta';
    door.classList.toggle('is-open', state.doorOpen);
    // "is-closed" só depois da primeira abertura, para a onda de fechamento não tocar no carregamento
    door.classList.toggle('is-closed', !state.doorOpen && state.doorWasOpened);
    door.setAttribute('aria-pressed', String(state.doorOpen));
    door.setAttribute('aria-label', label);
    doorTip.textContent = label;
  }

  render(store.get());
  d.add(store.subscribe(render));

  return { destroy: () => d.dispose() };
}
