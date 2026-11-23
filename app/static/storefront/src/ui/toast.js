// Aviso "Adicionado ao Carrinho" exibido quando uma lata chega ao carrinho.

import { disposables, setVars } from '../core/dom.js';

const VISIBLE_MS = 2000;

/**
 * @param {{ refs: Record<string, HTMLElement>, store: any, catalog: any[] }} opts
 */
export function createToast({ refs, store, catalog }) {
  const d = disposables();
  const { toast, toastImage, toastName } = refs;
  let hideTimer = 0;

  function render(state, prev) {
    if (!prev || state.cartPulse === prev.cartPulse || state.lastAdded == null) return;
    const flavor = catalog[state.lastAdded];
    toastName.textContent = flavor.name;
    toastImage.src = flavor.image;
    setVars(toast, flavor.vars);
    toast.classList.add('is-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.remove('is-visible'), VISIBLE_MS);
  }

  d.add(store.subscribe(render));

  return {
    destroy() {
      clearTimeout(hideTimer);
      d.dispose();
    },
  };
}
