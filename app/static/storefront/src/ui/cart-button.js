// Ícone do carrinho (topo e cabeçalho da gaveta): contador e animação de chegada da lata.

import { disposables, replayClass, setVars } from '../core/dom.js';

const PULSE_MS = 1500;

// Partículas da chegada: [ângulo em graus, distância em px, atraso em s, traço longo]
const SPARKS = [
  [-90, 42, 0.02], [-62, 34, 0.03], [-34, 47, 0.04, true], [-6, 36, 0.06],
  [22, 45, 0.07, true], [50, 34, 0.02], [78, 43, 0.03], [106, 36, 0.04, true],
  [134, 46, 0.06], [162, 34, 0.07], [190, 44, 0.02, true], [218, 37, 0.03],
  [246, 46, 0.04], [274, 35, 0.06, true], [302, 43, 0.07], [330, 36, 0.02],
];

function addSparks(button, before) {
  const frag = document.createDocumentFragment();
  for (const [angle, distance, delay, streak] of SPARKS) {
    const spark = document.createElement('i');
    spark.className = streak ? 'pt st' : 'pt';
    setVars(spark, { '--a': `${angle}deg`, '--d': `${distance}px`, '--dl': `${delay}s` });
    frag.append(spark);
  }
  button.insertBefore(frag, before);
}

/**
 * @param {{ icons: { el: HTMLElement, badge: HTMLElement }[], button: HTMLButtonElement, store: any, onOpen: () => void }} opts
 */
export function createCartButton({ icons, button, store, onOpen }) {
  const d = disposables();
  let pulseTimer = 0;

  addSparks(button, icons[0].badge);
  d.listen(button, 'click', onOpen);

  function render(state, prev) {
    const count = state.cartCount;
    for (const { el, badge } of icons) {
      el.classList.toggle('has-items', count > 0);
      badge.hidden = count === 0;
      badge.firstElementChild.textContent = String(count);
    }
    button.setAttribute('aria-label', `Abrir carrinho, ${count === 1 ? '1 lata' : `${count} latas`}`);

    if (prev && state.cartPulse !== prev.cartPulse) {
      icons.forEach(({ el }) => replayClass(el, 'is-hit'));
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => icons.forEach(({ el }) => el.classList.remove('is-hit')), PULSE_MS);
    }
  }

  render(store.get());
  d.add(store.subscribe(render));

  return {
    destroy() {
      clearTimeout(pulseTimer);
      d.dispose();
    },
  };
}
