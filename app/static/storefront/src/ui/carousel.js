// Carrossel infinito de latas + indicador de posição.
//
// A posição é contínua e sem limites (a lista dá a volta); o sabor escolhido
// é a posição arredondada módulo o total. O CSS posiciona cada lata a partir
// das variáveis --p (posição atual) e --i (índice da lata).

import { disposables, prefersReducedMotion, replayClass, setVars } from '../core/dom.js';

const SPRING_STIFFNESS = 190;
const SPRING_DAMPING = 24; // levemente sub-amortecida: chega com um respiro, sem quicar demais
const DRAG_THRESHOLD_PX = 6;
const MAX_FLING_STEPS = 2.2;
const WHEEL_THRESHOLD = 36;
const WHEEL_COOLDOWN_MS = 280;

/**
 * @param {{ el: HTMLElement, dots: HTMLElement, count: number, initial?: number, onSelect: (index: number) => void }} opts
 */
export function createCarousel({ el, dots, count, initial = 0, onSelect }) {
  const d = disposables();
  const items = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('.cv-it')]);
  const dotItems = /** @type {HTMLElement[]} */ ([...dots.querySelectorAll('[data-index]')]);

  let position = initial;
  let selected = initial;
  let velocity = 0;
  let lastFrameAt = 0;
  let raf = 0;
  let velocityReset = 0;

  const wrap = (i) => ((i % count) + count) % count;
  // posição do indicador: a mesma da lista, mas mantida dentro da faixa de pontos (de -0,5 a count - 0,5)
  const dotPosition = (p) => p - count * Math.round((p - (count - 1) / 2) / count);

  items.forEach((item, i) => setVars(item, { '--i': i }));
  dotItems.forEach((dot, i) => setVars(dot, { '--i': i }));
  setVars(el, { '--cvn': count, '--p': position });
  setVars(dots, { '--cvn': count, '--p': dotPosition(position) });

  function setPosition(p) {
    const now = performance.now();
    const dt = Math.max(8, now - (lastFrameAt || now - 16));
    const speed = Math.abs(p - position) / dt * 1000; // índices por segundo
    lastFrameAt = now;
    position = p;
    velocity = velocity * 0.65 + speed * 0.35;

    setVars(el, { '--p': p.toFixed(4) });
    setVars(dots,{ '--p': dotPosition(p).toFixed(4), '--v': Math.min(1, velocity / 9).toFixed(3) });

    clearTimeout(velocityReset);
    velocityReset = setTimeout(() => {
      velocity = 0;
      setVars(dots, { '--v': 0 });
    }, 90);
  }

  function stopSpring() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function settle(target) {
    setPosition(target);
    position = wrap(Math.round(target));
    lastFrameAt = 0;
    setVars(el, { '--p': position });
  }

  function springTo(target, initialVelocity = 0) {
    stopSpring();
    if (prefersReducedMotion()) {
      settle(target);
      return;
    }
    let x = position;
    let v = initialVelocity;
    let last = performance.now();
    const tick = (t) => {
      const dt = Math.min(0.032, (t - last) / 1000);
      last = t;
      v += (-SPRING_STIFFNESS * (x - target) - SPRING_DAMPING * v) * dt;
      x += v * dt;
      if (Math.abs(x - target) < 0.0006 && Math.abs(v) < 0.006) {
        raf = 0;
        settle(target);
        return;
      }
      setPosition(x);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function choose(index) {
    if (index === selected) return;
    selected = index;
    onSelect(index);
  }

  function goToPosition(target, v = 0) {
    choose(wrap(target));
    springTo(target, v);
  }

  const goBy = (delta, v) => goToPosition(Math.round(position) + delta, v);

  /** Vai ao sabor de índice i pelo caminho mais curto. */
  function goTo(index, v) {
    const from = Math.round(position);
    let delta = wrap(index) - wrap(from);
    if (delta > count / 2) delta -= count;
    else if (delta < -count / 2) delta += count;
    goToPosition(from + delta, v);
  }

  // ── arrastar / tocar
  let drag = null;
  const stepPx = () => (el.clientWidth || 340) * 0.36;

  d.listen(el, 'pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('.cv-arr')) return;
    stopSpring();
    drag = { x: e.clientX, y: e.clientY, p0: position, id: e.pointerId, moved: false, history: [[performance.now(), position]] };
  });

  d.listen(el, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        drag = null; // gesto vertical: deixa a página rolar
        return;
      }
      drag.moved = true;
      el.classList.add('is-dragging');
      el.setPointerCapture?.(drag.id);
    }
    const p = drag.p0 - dx / stepPx();
    setPosition(p);
    drag.history.push([performance.now(), p]);
    if (drag.history.length > 6) drag.history.shift();
    choose(wrap(Math.round(p)));
    if (e.cancelable) e.preventDefault();
  });

  d.listen(el, 'pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const g = drag;
    drag = null;
    el.classList.remove('is-dragging');
    if (!g.moved) {
      const item = e.target.closest('[data-index]');
      if (item) goTo(Number(item.dataset.index));
      else springTo(Math.round(position));
      return;
    }
    const [t0, p0] = g.history[0];
    const [t1, p1] = g.history[g.history.length - 1];
    const v = ((p1 - p0) / Math.max(16, t1 - t0)) * 1000;
    const fling = Math.max(-MAX_FLING_STEPS, Math.min(MAX_FLING_STEPS, v * 0.16));
    goToPosition(Math.round(position + fling), v);
  });

  d.listen(el, 'pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.classList.remove('is-dragging');
    goToPosition(Math.round(position));
  });

  // ── setas (desktop), teclado e roda horizontal
  d.listen(el, 'click', (e) => {
    const arrow = e.target.closest('.cv-arr');
    if (arrow) goBy(Number(arrow.dataset.step));
  });

  d.listen(el, 'keydown', (e) => {
    if (e.key === 'ArrowRight') goBy(1);
    else if (e.key === 'ArrowLeft') goBy(-1);
    else return;
    e.preventDefault();
  });

  let wheelAccum = 0;
  let wheelAt = 0;
  d.listen(el, 'wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    wheelAccum += e.deltaX;
    const now = performance.now();
    if (Math.abs(wheelAccum) > WHEEL_THRESHOLD && now - wheelAt > WHEEL_COOLDOWN_MS) {
      goBy(Math.sign(wheelAccum));
      wheelAccum = 0;
      wheelAt = now;
    }
  }, { passive: false });

  d.listen(dots, 'click', (e) => {
    const dot = e.target.closest('[data-index]');
    if (dot) goTo(Number(dot.dataset.index));
  });

  /** Reflete o sabor escolhido (classes, acessibilidade e animação de entrada). */
  function render(index) {
    items.forEach((item, i) => {
      const on = i === index;
      item.classList.toggle('is-selected', on);
      item.setAttribute('aria-selected', String(on));
    });
    replayClass(items[index], 'is-entering');
  }

  render(selected);

  return {
    goTo,
    /** Atualiza a seleção sem animar a posição (o estado mudou por outra via). */
    markSelected(index) {
      selected = index;
      render(index);
    },
    destroy() {
      stopSpring();
      clearTimeout(velocityReset);
      d.dispose();
    },
  };
}
