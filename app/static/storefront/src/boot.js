// Loading da loja.
//
// A geladeira apagada (marcação no index.html, estilos em assets/styles/boot.css) aparece antes
// de qualquer script, com a luz azul correndo pela moldura do LED. Daqui ela se revela em dois atos:
//   1. interface pronta: o LED acende, a geladeira desliza e encolhe até o lugar dela e a
//      interface entra em volta. Não espera o 3D.
//   2. geladeira 3D pronta, já com as latas: o 3D acende por baixo da imagem, o vidro é limpo
//      de cima para baixo e a câmera vai para a vista normal.
// Fluidez (adaptação da plataforma): tudo o que anima aqui é transform/opacity, que o navegador
// roda fora da thread principal; a geladeira 3D fica parada (sem redesenhar) durante a limpeza.
// O segundo ato nunca começa antes de o primeiro terminar, e as luzes só acendem com as latas
// no lugar: a geladeira nunca aparece vazia.

const EASE = 'cubic-bezier(.22,1,.36,1)';
const MOBILE = matchMedia('(max-width: 1023px)');
const SECTIONS = ['.brand', '.fabs', '.dock']; // entram nessa ordem, 60 ms uma depois da outra
const INTERFACE_TIMEOUT = 8000; // garantia: a loja aparece mesmo se uma fonte nunca carregar

const wait = (animation) => animation.finished.then(() => {}, () => {});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Liga o loading à loja. Sem a marcação do loading na página, não faz nada (devolve null).
 * Use: `const boot = createBoot(); const shop = mountStorefront(root, boot?.storefrontOptions);
 * boot?.run(shop);`
 */
export function createBoot() {
  const root = document.getElementById('boot');
  const html = document.documentElement;
  if (!root) {
    html.classList.remove('is-booting');
    return null;
  }
  const stage = /** @type {HTMLElement} */ (root.querySelector('.boot__stage'));
  const art = /** @type {HTMLElement} */ (root.querySelector('.boot__art'));
  const bg = /** @type {HTMLElement} */ (root.querySelector('.boot__bg'));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a geladeira 3D só é montada depois do pouso (montar disputa a thread principal com a animação)
  let landed = () => {};
  const afterLanding = new Promise((resolve) => { landed = resolve; });

  /** Onde fica a geladeira dentro da imagem (frações), conforme o formato em uso. */
  const fridgeIn = () => (stage.dataset[MOBILE.matches ? 'fridgeM' : 'fridgeD'] || '0 0 1 1').split(' ').map(Number);
  /** Retângulo da imagem inteira para que a geladeira caia exatamente em `fridge`. */
  function posterFor(fridge) {
    const [fx, fy, fw] = fridgeIn();
    const width = fridge.width / fw;
    const height = width / (stage.offsetWidth / stage.offsetHeight);
    return { left: fridge.left - fx * width, top: fridge.top - fy * height, width };
  }
  /** Retângulo da imagem sem transformação (o tamanho inicial, centralizado). */
  function homeRect() {
    const current = stage.style.transform;
    stage.style.transform = 'none';
    const rect = stage.getBoundingClientRect();
    stage.style.transform = current;
    return rect;
  }
  const transformTo = (from, to) =>
    `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`;

  let finalRect = () => homeRect();
  const keepInPlace = () => {
    stage.style.transform = transformTo(homeRect(), posterFor(finalRect()));
  };

  // ── ato 1: interface pronta
  async function revealInterface(sections, layoutRect) {
    finalRect = layoutRect;
    const from = homeRect();
    html.classList.add('is-revealing'); // a loja passa a existir na tela (ainda coberta)
    const end = transformTo(from, posterFor(layoutRect())); // medido antes de qualquer animação
    root.classList.add('is-lit');

    sections.forEach((el, i) => {
      el.style.animationDelay = `${(reduce ? 0 : 150) + i * 60}ms`;
      el.classList.add('is-entering');
      el.addEventListener('animationend', () => {
        el.classList.remove('is-entering');
        el.style.animationDelay = '';
      }, { once: true });
    });
    const fade = wait(bg.animate({ opacity: [1, 0] }, { duration: reduce ? 200 : 500, delay: reduce ? 0 : 100, fill: 'forwards' }));

    if (reduce) {
      await wait(stage.animate({ opacity: [1, 0] }, { duration: 100, fill: 'forwards' }));
      stage.style.transform = end;
      await wait(stage.animate({ opacity: [0, 1] }, { duration: 100, fill: 'forwards' }));
    } else {
      await wait(stage.animate({ transform: ['none', end] }, { duration: 750, delay: 150, easing: EASE, fill: 'forwards' }));
      stage.style.transform = end;
    }
    await fade;
    stage.getAnimations().forEach((a) => a.cancel());
    bg.remove();
    stage.style.willChange = 'auto';
    // a imagem fica como geladeira até o 3D assumir; o resto da tela já é da loja
    root.style.pointerEvents = 'none';
    stage.style.pointerEvents = 'auto';
    root.classList.add('is-landed'); // desce para a camada da geladeira 3D, abaixo da interface
    root.setAttribute('aria-busy', 'false');
    html.classList.remove('is-booting', 'is-revealing');
    addEventListener('resize', keepInPlace);
  }

  // ── ato 2: geladeira 3D pronta
  async function wakeFridge(scene, canvas) {
    // o 3D precisa estar inteiro na tela por baixo da imagem antes de ela sair
    await Promise.all(canvas.getAnimations().map(wait));
    // realinha a imagem ao 3D real (ajuste de fração de pixel; ou o modo foco, se o carrinho abriu)
    const target = transformTo(homeRect(), posterFor(scene.fridgeScreenRect()));
    if (target !== stage.style.transform) {
      const before = stage.style.transform;
      stage.style.transform = target;
      await wait(stage.animate({ transform: [before, target] }, { duration: reduce ? 0 : 250, easing: 'ease-out' }));
    }
    removeEventListener('resize', keepInPlace);

    // a moldura já está acesa na imagem: o LED e as luzes de dentro acendem juntos, por baixo
    // dela, num quadro só (a GPU fica livre para a limpeza)
    await scene.setPower({ led: 1, interior: 1 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    art.classList.add('is-wiping');
    if (reduce) await wait(art.animate({ opacity: [1, 0] }, { duration: 200, fill: 'forwards' }));
    else {
      // a máscara (borda macia) desce e o conteúdo sobe na mesma medida: a imagem fica parada e só
      // a borda percorre a geladeira, de cima para baixo; só transform, fora da thread principal
      const timing = { duration: 900, easing: 'ease-in-out', fill: 'forwards' };
      await Promise.all([
        wait(art.querySelector('.boot__wipe').animate({ transform: ['none', 'translateY(66.66667%)'] }, timing)),
        wait(art.querySelector('.boot__wipe-in').animate({ transform: ['none', 'translateY(-200%)'] }, timing)),
      ]);
    }
    root.remove();
    scene.release?.(); // a lata escolhida volta a flutuar
    scene.recenter(); // no computador, a geladeira gira até a vista de três quartos de sempre
  }

  /** 3D indisponível: a imagem fica como a geladeira, com a moldura acesa. */
  function keepPoster() {
    root.querySelectorAll('.boot__led').forEach((el) => el.remove());
  }

  return {
    /** Opções para mountStorefront: a geladeira 3D nasce apagada e de frente, como a imagem. */
    storefrontOptions: { fridge: { power: 0, startView: 'front', hold: true, after: afterLanding } },
    /** @param {ReturnType<typeof import('./storefront.js').mountStorefront>} shop */
    async run(shop) {
      const app = /** @type {HTMLElement | null} */ (document.querySelector('.app'));
      if (app) app.inert = true; // pintada por baixo do fundo preto, mas sem foco nem toque
      const sections = SECTIONS.map((selector) => app?.querySelector(selector)).filter(Boolean);
      const scene = shop.ready.catch(() => null);
      await Promise.race([shop.interfaceReady, delay(INTERFACE_TIMEOUT)]);
      await revealInterface(sections, () => shop.fridgeLayoutRect());
      if (app) app.inert = false;
      landed();
      const fridge = await scene;
      if (!fridge) {
        keepPoster();
        return;
      }
      await wakeFridge(fridge, /** @type {HTMLCanvasElement} */ (document.querySelector('.cw canvas')));
    },
  };
}
