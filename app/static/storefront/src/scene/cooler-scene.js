// Geladeira 3D da loja: o Mini Cooler do kit (motor em cooler/geladeira/) com a
// interação da plataforma por cima.
//
// - A geladeira mostra o estoque real informado pela loja (até 25 latas, 5 por
//   fileira), repartido entre os sabores em rodízio; a loja continua dona do estoque.
// - Tocar numa lata com a porta aberta escolhe exatamente essa lata; o carrossel
//   escolhe a lata da frente do sabor. A escolhida sobe e fica flutuando.
// - Cada lata comprada sai da geladeira e voa até o ícone do carrinho; as de trás
//   da mesma coluna deslizam para a frente e o espaço é reposto pelo fundo.
// - Carrinho aberto: a câmera vai para a vista frontal, centrada acima da gaveta.
// - Vidro da porta com condensação viva (glass-condensation.js, do pacote vidro-condensacao).

import * as THREE from '../../vendor/three/three.module.min.js';
import { gsap } from '../../vendor/gsap/index.js';
import { finishCabinet, loadEngine, waitForFrame } from './cooler-cabinet.js';
import { CAN_HEIGHT, createCanLibrary, prefetchCans, prefetchEnvironment } from './cooler-stock.js';
import { COOLER_BOX, MOBILE_MAX_WIDTH, TARGET_Y, VIEWS, engineFitDistance, fitDistance, frameGeometry } from './cooler-frame.js';
import { createCondensation } from './glass-condensation.js';
import { supportsWebGL } from '../device-tier.js';

const COLUMNS = 5;
const CAN_SPACING = 0.06;
const COLUMN_ORDER = [2, 1, 3, 0, 4]; // preenche cada fileira do centro para as bordas
const CAN_YAW = -0.2; // giro de repouso das latas do kit (rótulo levemente de lado)
const OPEN_ANGLE = 1.8;
const LIFT = 0.022;
const PULL = 0.012;
const ORDER_VIEW = { az: -0.5, el: 0.13 };
// opacidade de repouso da névoa do vidro (valor do pacote vidro-condensacao; não alterar)
const CONDENSATION_REST = 0.86;
const BOX = new THREE.Box3(new THREE.Vector3(...COOLER_BOX.min), new THREE.Vector3(...COOLER_BOX.max));
const corner = new THREE.Vector3();
/** Retângulo, em coordenadas da janela, ocupado por uma caixa vista pela câmera. */
function projectBox(camera, box, rect) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    x0 = Math.min(x0, corner.x);
    x1 = Math.max(x1, corner.x);
    y0 = Math.min(y0, corner.y);
    y1 = Math.max(y1, corner.y);
  }
  const left = rect.left + ((x0 + 1) / 2) * rect.width;
  const top = rect.top + ((1 - y1) / 2) * rect.height;
  return { left, top, width: ((x1 - x0) / 2) * rect.width, height: ((y1 - y0) / 2) * rect.height };
}
/** Devolve a vez ao navegador entre etapas pesadas da montagem (toques e animações não esperam). */
const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));
const shortest = (from, to) => { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return from + d; };

/**
 * Quantas latas de cada sabor aparecem: rodízio na ordem do catálogo até encher a
 * geladeira, sem passar do disponível de cada sabor. Sabor sem modelo 3D não aparece.
 */
function allocate(available, hasModel, capacity) {
  const target = available.map(() => 0);
  let left = capacity;
  for (let round = 0; left > 0; round++) {
    let placed = false;
    for (let f = 0; f < available.length && left > 0; f++) {
      if (!hasModel[f] || available[f] <= round) continue;
      target[f]++;
      left--;
      placed = true;
    }
    if (!placed) break;
  }
  return target;
}

/**
 * Começa só os downloads da geladeira (motor do kit, HDR e as latas que vão aparecer), sem
 * trabalho pesado de CPU: a loja chama logo no início e monta a cena quando o loading pousa.
 * @param {{ flavors: { model: string | null }[], stock: number[] }} opts
 */
export function prefetchCoolerScene(opts) {
  if (!supportsWebGL()) return; // sem WebGL nada disso seria usado: não baixa dezenas de MB à toa
  prefetchEnvironment();
  const models0 = opts.flavors.map((f) => f.model);
  const first = allocate(opts.stock, models0.map(Boolean), COLUMNS * 5);
  prefetchCans(first.flatMap((n, fi) => (n ? [models0[fi]] : [])));
  loadEngine().catch(() => {}); // a falha aparece de novo (e é tratada) na montagem
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   flavors: { model: string | null }[],
 *   stock: number[],
 *   ledColor?: string,
 *   insets?: (w: number, h: number) => { l: number, r: number, t: number, b: number },
 *   insetsFocus?: (w: number, h: number) => { l: number, r: number, t: number, b: number },
 *   cartPoint?: () => { x: number, y: number },
 *   power?: number | { led?: number, interior?: number },
 *   startView?: 'home' | 'front',
 *   condensationVeil?: number,
 *   hold?: boolean,
 *   quality?: 'low',
 * }} opts
 *
 * `power`: energia inicial do LED e das luzes internas (0 = apagada, 1 = acesa, o padrão).
 * `startView`: 'front' começa de frente em qualquer tela (o loading usa; depois de acender,
 * `recenter()` leva à vista normal). `condensationVeil`: só para o gerador da imagem do loading.
 * `quality`: 'low' força o nível mais leve do motor (resolução 1x, sem sombras); sem ela, o motor
 * escolhe pelo aparelho.
 */
export async function mountCoolerScene(canvas, opts) {
  const listeners = {};
  const emit = (ev, ...a) => (listeners[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } });
  const api = { on(ev, f) { (listeners[ev] ||= []).push(f); return () => { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); }; } };
  if (!supportsWebGL()) { api.failed = true; return api; }

  // ── enquadramento: área livre (insets) misturada com a do modo foco
  let focusK = 0;
  const insetsNow = (w, h) => {
    const a = opts.insets ? opts.insets(w, h) : { l: 0, r: 0, t: 0, b: 0 };
    if (focusK < 0.0005 || !opts.insetsFocus) return a;
    const b = opts.insetsFocus(w, h), k = focusK, mix = (x, y) => x + (y - x) * k;
    return { l: mix(a.l, b.l), r: mix(a.r, b.r), t: mix(a.t, b.t), b: mix(a.b, b.b) };
  };

  // o motor reposiciona a câmera quando o contêiner muda de tamanho; este observador
  // (criado antes do motor, roda antes dele) guarda a vista para ser restaurada depois
  let booted = false, savedRig = null, disposed = false;
  const preResize = new ResizeObserver(() => { if (booted) savedRig = rigState(); });
  preResize.observe(canvas.parentElement);

  canvas.classList.remove('is-ready');
  // latas e HDR começam a baixar já, em paralelo com o motor (5 fileiras × 5 lugares)
  prefetchCoolerScene(opts);
  let engine, cabinet, library;
  try {
    const CoolerEngine = await loadEngine();
    engine = await CoolerEngine.mount(canvas, { ledColor: opts.ledColor || '#1f5bff', deferRender: true, insets: insetsNow, quality: opts.quality });
    await yieldToMain();
    if (!engine.debug) { preResize.disconnect(); api.failed = true; return api; } // WebGL recusado pelo motor
  } catch (error) {
    preResize.disconnect();
    throw error;
  }
  const { debug } = engine;
  const { camera, renderer, cooler, scene } = debug;
  const { hingePivot } = cooler;

  // ── animações: registradas para o dispose encerrar só o que a cena criou
  const owned = new Set();
  const own = (a) => {
    owned.add(a);
    if (owned.size > 256) owned.forEach((x) => { if (!x.isActive() && x.progress() === 1) owned.delete(x); });
    return a;
  };
  const tween = (target, vars) => own(gsap.to(target, vars));
  const timeline = (vars) => own(gsap.timeline(vars));
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  let motion = rm.matches ? 0.45 : 1;
  const onRM = () => { motion = rm.matches ? 0.45 : 1; };
  rm.addEventListener?.('change', onRM);

  // piso: o motor troca o piso de sombra por um piso claro, pensado para página clara;
  // no palco escuro da loja o piso volta a só receber sombra
  const floor = scene.children.find((n) => n.isMesh && n.geometry?.parameters?.width === 8 && n.material?.isMeshPhysicalMaterial);
  const floorShadow = new THREE.ShadowMaterial({ opacity: 0.5, depthWrite: false });
  if (floor) floor.material = floorShadow;

  // `hold`: enquanto o loading cobre a geladeira, a cena atualiza o estado (poses, gotas) mas
  // não redesenha nem faz a escolhida flutuar: a GPU fica livre para a animação do loading.
  // Desenha quando o loading acende a geladeira (setPower) e volta ao normal no release().
  let held = !!opts.hold, heldShadows = false;
  // o motor desenha sob demanda e só refaz sombras quando pedido
  const draw = (shadows = true) => {
    if (held) { heldShadows ||= shadows; return; }
    if (shadows) renderer.shadowMap.needsUpdate = true;
    debug.render();
  };
  const drawHeld = () => {
    if (heldShadows) renderer.shadowMap.needsUpdate = true;
    heldShadows = false;
    debug.render();
  };

  // ── energia: o LED da moldura e as luzes de dentro podem acender e apagar (o loading começa
  // com tudo apagado). Guarda-se o valor original de cada luz; a energia só o multiplica.
  const power = { led: 1, interior: 1 };
  if (typeof opts.power === 'number') Object.assign(power, { led: opts.power, interior: opts.power });
  else if (opts.power) Object.assign(power, opts.power);
  const powered = [];
  const seen = new Set();
  function addPowered(channel, target, key) {
    if (!target || seen.has(target)) return;
    seen.add(target);
    const value = target[key];
    powered.push({ channel, target, key, base: value?.isColor ? value.clone() : value });
  }
  function collectPowered() {
    powered.length = 0;
    seen.clear();
    cooler.root.getObjectByName('BlueLEDFrame')?.traverse((o) => { if (o.isMesh) addPowered('led', o.material, 'color'); });
    cooler.root.getObjectByName('InteriorLights')?.traverse((o) => {
      if (o.isMesh) addPowered('interior', o.material, 'color');
      else if (o.isLight) addPowered('interior', o, 'intensity');
    });
    cooler.root.getObjectByName('RearPanel')?.traverse((o) => {
      if (o.isMesh) [].concat(o.material).forEach((m) => { if (m.emissive) addPowered('interior', m, 'emissiveIntensity'); });
    });
    for (const name of ['FrontArtworkLEDHalo', 'FrontArtworkLEDCore']) addPowered('interior', cooler.root.getObjectByName(name)?.material, 'color');
  }
  function applyPower() {
    for (const { channel, target, key, base } of powered) {
      const k = power[channel];
      if (base?.isColor) target[key].copy(base).multiplyScalar(k);
      else target[key] = base * k;
    }
  }

  // ── condensação do vidro: quadros contínuos só enquanto uma gota escorre
  let condensation = null, raf = 0, last = 0;
  function wake() {
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; // dt em segundos, limitado a 50 ms
    last = now;
    const dripping = condensation?.step(dt) ?? false;
    paintCondensation(now);
    if (dripping) wake();
    else last = 0;
  }
  // Com a gaveta aberta (identificação e Pix, até 10 min) a geladeira fica atrás do véu
  // desfocado: as gotas continuam iguais (a simulação anda a cada quadro), mas a cena é
  // redesenhada no máximo ~15 vezes por segundo, e o último estado sempre chega à tela.
  const FOCUSED_FRAME_MS = 66;
  let behindDrawer = false, lastPaint = 0, trailingPaint = 0;
  function paintCondensation(now = performance.now()) {
    if (held) return;
    if (behindDrawer && now - lastPaint < FOCUSED_FRAME_MS) {
      trailingPaint ||= setTimeout(() => { trailingPaint = 0; paintCondensation(); }, FOCUSED_FRAME_MS - (now - lastPaint));
      return;
    }
    clearTimeout(trailingPaint);
    trailingPaint = 0;
    lastPaint = now;
    debug.render();
  }

  // ── lugares: 5 fileiras do kit × 5 colunas; cada coluna de um nível vai da frente para o fundo
  const levelYs = [...new Set(cooler.canRows.map((r) => r.y))].sort((a, b) => a - b);
  const innerTop = new THREE.Box3().setFromObject(cooler.interior.getObjectByName('InnerWalls')).max.y;
  const ceilings = levelYs.map((y, i) => (i < levelYs.length - 1 ? levelYs[i + 1] - 0.012 : innerTop));
  const slots = cooler.canRows.flatMap((row) => {
    const level = levelYs.indexOf(row.y);
    const depth = cooler.canRows.filter((r) => r.y === row.y && r.z > row.z).length;
    return COLUMN_ORDER.map((column) => ({ level, depth, column, x: (column - (COLUMNS - 1) / 2) * CAN_SPACING, y: row.y, z: row.z, can: null }));
  });
  const capacity = slots.length;
  const columnOf = (slot) => slots.filter((s) => s.level === slot.level && s.column === slot.column).sort((a, b) => a.depth - b.depth);
  const frontZ = Math.max(...cooler.canRows.map((r) => r.z));
  const backZ = (slot) => Math.min(...columnOf(slot).map((s) => s.z));
  // quanto uma lata sobe para passar por cima das da frente (limitado pelo teto do nível)
  const overLift = (slot) => Math.min(CAN_HEIGHT + 0.006, ceilings[slot.level] - slot.y - CAN_HEIGHT - 0.006);
  const restPose = (slot) => ({ x: slot.x, y: slot.y, z: slot.z });
  const liftPose = (slot) => ({ x: slot.x, y: slot.y + LIFT, z: slot.z + PULL });

  // ── estoque visível
  const models = opts.flavors.map((f) => f.model);
  const hasModel = models.map(Boolean);
  let available = [...opts.stock];
  const queued = new Map(); // sabor → latas já pedidas que ainda não saíram da geladeira
  const visible = (fi) => slots.filter((s) => s.can && s.can.flavor === fi).length - (queued.get(fi) || 0);

  try {
    const needed = allocate(available, hasModel, capacity);
    const [cabinetResult, libraryResult] = await Promise.allSettled([
      finishCabinet(engine),
      createCanLibrary(debug, capacity).then(async (lib) => {
        try {
          await Promise.all(needed.flatMap((n, fi) => (n ? [lib.model(models[fi])] : [])));
          return lib;
        } catch (error) {
          lib.dispose();
          throw error;
        }
      }),
    ]);
    await yieldToMain();
    if (cabinetResult.status === 'fulfilled') cabinet = cabinetResult.value;
    if (libraryResult.status === 'fulfilled') library = libraryResult.value;
    const failure = [cabinetResult, libraryResult].find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;

    // disposição inicial: rodízio entre os sabores, na ordem de preenchimento dos lugares
    const order = [];
    for (let round = 0; order.length < needed.reduce((a, b) => a + b, 0); round++) {
      needed.forEach((n, fi) => { if (n > round) order.push(fi); });
    }
    for (const [i, fi] of order.entries()) {
      const slot = slots[i];
      const model = await library.model(models[fi]);
      slot.can = library.add(model, fi, { ...restPose(slot), yaw: CAN_YAW });
      slot.can.slot = slot;
    }
    cooler.interior.add(library.group);
    await yieldToMain();
    // vidro da porta embaçado, com gotas; ao fechar a porta, o ar quente que entrou embaça um
    // pouco mais e o vidro volta aos poucos ao normal. Criado antes do primeiro quadro: o
    // pipeline do motor varre as malhas da cena nesse momento.
    condensation = createCondensation(cooler, { wake: () => wake(), requestFrame: () => paintCondensation(), veil: opts.condensationVeil });
    if (condensation) condensation.material.opacity = CONDENSATION_REST;
    collectPowered();
    applyPower();
    await yieldToMain();
    // texturas sobem para a GPU uma por quadro: todas juntas no primeiro quadro seguravam a GPU
    // (e com ela as animações da página) por ~0,7 s. O conteúdo enviado é o mesmo.
    const textures = new Set();
    scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v?.isTexture && !v.isRenderTargetTexture) textures.add(v);
    });
    for (const texture of textures) {
      renderer.initTexture(texture);
      await new Promise(requestAnimationFrame);
    }
    // quadro de aquecimento (com a geladeira ainda invisível): desenha também as poses das
    // latas e as gotas que escorrem, para os shaders delas compilarem agora e não travarem
    // a primeira seleção, o primeiro "Adicionar" ou a primeira gota
    let warm = [];
    library.group.traverse((o) => { if (o.parent === library.group && !o.visible && o !== library.targets) warm.push(o); });
    cooler.root.traverse((o) => { if (o.name === 'GlassRunningDrop' && !o.visible) warm.push(o); });
    warm.forEach((o) => { o.visible = true; });
    // Com KHR_parallel_shader_compile, os shaders compilam em paralelo na GPU, sem travar a
    // página (o loading continua animando); o quadro de aquecimento só liga o que já está pronto.
    // A cena principal do motor vai para um buffer intermediário (cor linear, sem mapeamento de
    // tom) e as artes e LEDs vão por cima, direto na tela, com ACES: compilam-se as duas
    // variantes (nada é desenhado aqui). Sem a extensão, compilar antes só somaria trabalho
    // síncrono: o quadro de aquecimento compila tudo, como sempre.
    let precompiled = null; // material das passadas internas: descartado só depois do aquecimento
    if (renderer.extensions.has('KHR_parallel_shader_compile')) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const compileWith = (toTarget, toneMapping, material = null) => {
        // `material`: troca, só durante a chamada síncrona, o material de todas as malhas pelo
        // das passadas internas do motor (o compile cria os programas; nada é desenhado)
        const saved = [];
        if (material) scene.traverse((o) => { if (o.isMesh) { saved.push([o, o.material]); o.material = material; } });
        const tone = renderer.toneMapping;
        renderer.setRenderTarget(toTarget ? target : null);
        renderer.toneMapping = toneMapping;
        const compiling = renderer.compileAsync(scene, camera);
        renderer.toneMapping = tone;
        renderer.setRenderTarget(null);
        saved.forEach(([o, m]) => { o.material = m; });
        return compiling;
      };
      const pending = [
        compileWith(true, renderer.toneMapping),
        compileWith(false, THREE.ACESFilmicToneMapping),
      ];
      // passadas internas: brilho (bloom, num buffer) e oclusão das artes (na tela, sem tom e com
      // ACES) usam um MeshBasicMaterial preto ou sem cor; com a classe do próprio motor, os
      // programas criados aqui são exatamente os que ele vai usar
      let Basic = null;
      scene.traverse((o) => { const m = o.material; if (!Basic && m?.type === 'MeshBasicMaterial' && m.constructor !== THREE.MeshBasicMaterial) Basic = m.constructor; });
      if (Basic) {
        precompiled = new Basic({ color: 0 });
        pending.push(compileWith(true, renderer.toneMapping, precompiled), compileWith(false, renderer.toneMapping, precompiled), compileWith(false, THREE.ACESFilmicToneMapping, precompiled));
      }
      // as poses e gotas do aquecimento só ficam visíveis nos trechos síncronos: durante a espera
      // a condensação pode criar uma gota e precisa encontrar uma cabeça de gota livre
      warm.forEach((o) => { o.visible = false; });
      await Promise.all(pending);
      target.dispose();
      await yieldToMain();
      warm = warm.filter((o) => !o.visible); // uma gota que começou a escorrer na espera segue visível
      warm.forEach((o) => { o.visible = true; });
    }
    debug.prepareFrame();
    warm.forEach((o) => { o.visible = false; });
    await yieldToMain();
    debug.prepareFrame();
    precompiled?.dispose(); // os programas já estão com os materiais do motor
    await waitForFrame(renderer);
    debug.presentFrame();
  } catch (error) {
    disposed = true;
    condensation?.dispose();
    preResize.disconnect();
    library?.dispose();
    cabinet?.dispose();
    engine.dispose();
    floorShadow.dispose();
    throw error;
  }

  // ── câmera: mesmo enquadramento do motor, recalculado aqui para o modo foco (cooler-frame.js)
  let vw = 1, vh = 1, tanFit = 0.2, engineFit = 1;
  function frame() {
    const r = canvas.parentElement.getBoundingClientRect();
    vw = Math.max(1, r.width); vh = Math.max(1, r.height);
    const g = frameGeometry(insetsNow(vw, vh), vw, vh, camera.fov);
    camera.aspect = g.FW / g.FH;
    camera.setViewOffset(g.FW, g.FH, g.offX, g.offY, vw, vh);
    tanFit = g.tanFit;
    camera.updateProjectionMatrix();
  }
  // distância que a órbita do motor aceita (0,62–1,7 × enquadramento calculado por ele)
  function measureEngineFit() {
    engineFit = engineFitDistance(insetsNow(vw, vh), vw, vh, camera.fov);
  }
  const fitDist = () => fitDistance(tanFit, engineFit, vw, focusK);
  const homeView = () => (vw < MOBILE_MAX_WIDTH ? VIEWS.front : VIEWS.three4);
  const rigFor = (view) => ({ az: view.az, el: view.el, dist: fitDist(), tx: 0, ty: TARGET_Y, tz: 0 });
  function rigState() {
    const r = debug.getRig();
    return { az: r.az, el: r.el, ratio: r.dist / fitDist(), tx: r.tx, ty: r.ty, tz: r.tz };
  }
  let rigTween = null;
  // measured: o motor acabou de reenquadrar (mudou o tamanho do contêiner) e recalculou os limites da órbita
  function relayout(prev = rigState(), measured = false) {
    frame();
    if (measured) measureEngineFit();
    if (!rigTween) debug.setRig({ az: prev.az, el: prev.el, tx: prev.tx, ty: prev.ty, tz: prev.tz, dist: fitDist() * prev.ratio });
    draw(false);
  }
  function moveRig(to, dur) {
    rigTween?.kill();
    const from = debug.getRig();
    const p = { ...from };
    to = { ...to, az: shortest(from.az, to.az) };
    return new Promise((res) => {
      rigTween = tween(p, { ...to, duration: dur * motion, ease: 'power3.inOut', onUpdate: () => debug.setRig(p), onComplete: () => { rigTween = null; res(); } });
    });
  }
  // foco: porta fecha, vista frontal, geladeira no centro do espaço livre; ao sair, volta para onde estava
  let focusOn = false, focusSaved = null;
  function focusTo(on) {
    on = !!on;
    if (on === focusOn) return Promise.resolve();
    focusOn = on;
    behindDrawer = on;
    // com a gaveta aberta a lata escolhida para de flutuar: o balanço redesenharia a cena inteira a
    // cada quadro, por trás do véu desfocado, durante toda a identificação e o Pix
    if (on) sel.bob?.pause();
    else sel.bob?.resume();
    const from = debug.getRig();
    if (on) {
      if (focusK < 0.02) focusSaved = { az: from.az, el: from.el, ratio: from.dist / fitDist() };
      clearTimeout(closeTimer); manualOpen = false;
      if (doorOpen) { if (!running) closeDoor(); else scheduleClose(); }
    }
    const goal = on ? { ...VIEWS.front, ratio: 1 } : (focusSaved || { ...homeView(), ratio: 1 });
    const goalAz = shortest(from.az, goal.az), ratio0 = from.dist / fitDist();
    const k0 = focusK, k1 = on ? 1 : 0, p = { u: 0 };
    rigTween?.kill();
    return new Promise((res) => {
      rigTween = tween(p, {
        u: 1, duration: 0.95 * motion, ease: 'power3.inOut',
        onUpdate: () => {
          const u = p.u;
          focusK = k0 + (k1 - k0) * u;
          frame();
          debug.setRig({ az: from.az + (goalAz - from.az) * u, el: from.el + (goal.el - from.el) * u, dist: fitDist() * (ratio0 + (goal.ratio - ratio0) * u), tx: from.tx * (1 - u), ty: from.ty + (TARGET_Y - from.ty) * u, tz: from.tz * (1 - u) });
        },
        onComplete: () => { focusK = k1; rigTween = null; relayout(); res(); },
      });
    });
  }
  // durante um movimento de câmera da cena, o arraste do usuário espera terminar
  const holdDrag = (e) => { if (rigTween) e.stopPropagation(); };
  canvas.parentElement.addEventListener('pointerdown', holdDrag, true);
  const postResize = new ResizeObserver(() => { if (booted) relayout(savedRig || rigState(), true); });

  // ── porta
  let doorTl = null, doorOpen = false, manualOpen = false, closeTimer = null;
  const door = { a: hingePivot.rotation.y };
  const setDoor = () => debug.setDoor(door.a);
  function openDoor(fast = false) {
    if (doorOpen && !doorTl) return Promise.resolve();
    doorOpen = true; emit('door', true);
    doorTl?.kill();
    door.a = hingePivot.rotation.y;
    const from = door.a;
    return new Promise((res) => {
      doorTl = timeline({ onUpdate: setDoor, onComplete: () => { doorTl = null; res(); } });
      if (fast) {
        if (from < 0.03) doorTl.to(door, { a: 0.035, duration: 0.16 * motion, ease: 'power1.in' });
        doorTl.to(door, { a: OPEN_ANGLE, duration: 0.75 * motion, ease: 'power3.out' });
        return;
      }
      if (from < 0.03) doorTl.to(door, { a: 0.035, duration: 0.2 * motion, ease: 'power1.in' });
      doorTl.to(door, { a: OPEN_ANGLE + 0.045, duration: 1.1 * motion * (1 - (from / OPEN_ANGLE) * 0.8), ease: 'power2.inOut' })
        .to(door, { a: OPEN_ANGLE, duration: 0.38 * motion, ease: 'sine.inOut' });
    });
  }
  function closeDoor() {
    if (condensation) {
      gsap.killTweensOf(condensation.material);
      timeline()
        .to(condensation.material, { opacity: 1, duration: 1.2 * motion, ease: 'sine.out', onUpdate: wake })
        .to(condensation.material, { opacity: CONDENSATION_REST, duration: 6, ease: 'sine.inOut', onUpdate: wake });
    }
    doorOpen = false; emit('door', false); hoverCan(null);
    doorTl?.kill();
    door.a = hingePivot.rotation.y;
    return new Promise((res) => {
      doorTl = tween(door, { a: 0, duration: 1.2 * motion, ease: 'power3.inOut', onUpdate: setDoor, onComplete: () => { doorTl = null; res(); } });
    });
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    if (manualOpen) return;
    closeTimer = setTimeout(() => { if (!queue.length && !running && !manualOpen) closeDoor(); }, 2600);
  }
  function toggleDoor() {
    clearTimeout(closeTimer);
    if (doorOpen) { manualOpen = false; if (!running) closeDoor(); else scheduleClose(); }
    else { manualOpen = true; openDoor(); }
    return doorOpen;
  }

  // ── movimento das latas: a lata sai da instância enquanto anda e volta a ela ao parar
  const sel = { can: null, bob: null };
  let hovered = null;
  const kill = (can) => { gsap.killTweensOf(can.pose.position); gsap.killTweensOf(can.pose.rotation); gsap.killTweensOf(can.pose.scale); };
  const step = (can) => () => { library.track(can); draw(); };
  // terminou de andar: fica acordada só se estiver escolhida ou sob o ponteiro
  const settle = (can) => { if (can !== sel.can && can !== hovered && can.slot) library.rest(can); };
  function moveTo(can, pose, { duration, delay = 0, ease = 'power3.out', yaw } = {}) {
    library.wake(can); kill(can);
    if (yaw !== undefined) tween(can.pose.rotation, { y: yaw, duration: duration * motion, delay: delay * motion, ease });
    return tween(can.pose.position, { ...pose, duration: duration * motion, delay: delay * motion, ease, onUpdate: step(can), onComplete: () => settle(can) });
  }
  function stopBob() { sel.bob?.kill(); sel.bob = null; }
  function startBob(can) {
    stopBob();
    if (held) return;
    sel.bob = tween(can.pose.position, { y: '+=0.004', duration: 1.7, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.9 * motion, onUpdate: () => { library.track(can); draw(false); } });
    if (focusOn) sel.bob.pause(); // gaveta aberta: ver focusTo
  }
  // a escolhida anterior volta ao seu lugar
  function release(can) {
    if (!can?.slot) return;
    moveTo(can, restPose(can.slot), { duration: 0.6, yaw: CAN_YAW });
  }
  // lata do sabor mais à frente (e mais ao centro)
  const frontmost = (fi) => slots.find((s) => s.depth === 0 && s.can?.flavor === fi)?.can
    || [...slots].sort((a, b) => a.depth - b.depth).find((s) => s.can?.flavor === fi)?.can || null;

  // sabor escolhido no carrossel: a lata da frente do sabor sobe e vira o rótulo para frente
  function select(fi, force = false) {
    if (!force && sel.can?.flavor === fi && sel.can.slot) return;
    const prev = sel.can;
    stopBob();
    sel.can = frontmost(fi);
    sel.fi = fi;
    if (prev && prev !== sel.can) release(prev);
    if (!sel.can) return;
    const can = sel.can;
    library.wake(can); kill(can);
    tween(can.pose.position, { ...liftPose(can.slot), duration: 0.9 * motion, ease: 'elastic.out(1, 0.55)', onUpdate: step(can), onComplete: () => startBob(can) });
    tween(can.pose.rotation, { y: 0, duration: 0.9 * motion, ease: 'power3.out' });
  }

  // tocar numa lata: exatamente essa é puxada para fora, dá uma volta mostrando o rótulo e
  // fica escolhida. Se estava atrás, passa por cima das da frente, que recuam uma posição.
  function pick(can) {
    const column = columnOf(can.slot);
    const row = column.indexOf(can.slot);
    const prev = sel.can;
    stopBob();
    if (row > 0 && column.slice(0, row).some((s) => s.can)) {
      const ahead = column.slice(0, row).map((s) => s.can).filter(Boolean);
      const order = [can, ...ahead];
      column.slice(0, order.length).forEach((s, i) => { s.can = order[i]; order[i].slot = s; });
      column.slice(order.length, row + 1).forEach((s) => { s.can = null; });
      ahead.forEach((c) => { if (c !== prev) moveTo(c, restPose(c.slot), { duration: 0.45, delay: 0.16, ease: 'power3.inOut', yaw: CAN_YAW }); });
    }
    if (prev && prev !== can) release(prev);
    sel.can = can; sel.fi = can.flavor;
    if (hovered === can) hovered = null;
    emit('pick', can.flavor);
    const slot = can.slot;
    const pose = library.wake(can);
    kill(can);
    const up = slot.level === levelYs.length - 1 ? 0.032 : 0.07;
    const tl = timeline({ onUpdate: step(can), onComplete: () => startBob(can) });
    if (row > 0) {
      tl.to(pose.position, { y: slot.y + overLift(slot), duration: 0.2 * motion, ease: 'power2.out' })
        .to(pose.position, { x: slot.x, z: slot.z + 0.03, duration: 0.4 * motion, ease: 'power2.inOut' });
    } else {
      tl.to(pose.position, { y: slot.y + 0.03, z: slot.z + 0.03, duration: 0.22 * motion, ease: 'power2.out' });
    }
    tl.to(pose.position, { y: slot.y + up, z: slot.z + 0.12, duration: 0.42 * motion, ease: 'power3.out' })
      .to(pose.rotation, { y: Math.PI * 2, x: -0.12, duration: 0.85 * motion, ease: 'power3.inOut' }, 0.15 * motion)
      .to(pose.rotation, { x: 0, duration: 0.3 * motion, ease: 'power2.out' })
      .set(pose.rotation, { y: 0 })
      .to(pose.position, { ...liftPose(slot), duration: 0.75 * motion, ease: 'power3.inOut' }, '-=0.1');
  }

  // gravidade: depois que uma lata sai, as de trás da coluna deslizam para a frente
  function gravity(slot) {
    const column = columnOf(slot);
    const cans = column.map((s) => s.can).filter(Boolean);
    column.forEach((s, i) => {
      const can = cans[i] || null;
      if (s.can === can) return;
      s.can = can;
      if (!can) return;
      can.slot = s;
      const lifted = can === sel.can;
      moveTo(can, lifted ? liftPose(s) : restPose(s), { duration: 0.6, delay: 0.3 + i * 0.07, ease: 'back.out(1.3)', yaw: lifted ? 0 : undefined });
      if (lifted) own(gsap.delayedCall((0.9 + i * 0.07) * motion, () => { if (sel.can === can) startBob(can); }));
    });
  }

  // reposição: confere o estoque visível com o disponível e tira/põe latas
  let syncing = false, syncAgain = false;
  async function sync() {
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      do {
        syncAgain = false;
        const target = allocate(available, hasModel, capacity);
        await Promise.all(target.flatMap((n, fi) => (n > visible(fi) ? [library.model(models[fi])] : [])));
        if (disposed) return;
        // sobrando: sai a lata mais ao fundo do sabor (encolhe no lugar)
        target.forEach((n, fi) => {
          for (let extra = visible(fi) - n; extra > 0; extra--) {
            const slot = [...slots].sort((a, b) => b.depth - a.depth).find((s) => s.can?.flavor === fi && s.can !== sel.can)
              || slots.find((s) => s.can?.flavor === fi);
            if (!slot) break;
            const can = slot.can;
            if (can === sel.can) { stopBob(); sel.can = null; }
            slot.can = null; can.slot = null;
            library.untarget(can);
            library.wake(can); kill(can);
            tween(can.pose.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35 * motion, ease: 'power2.in', onUpdate: step(can), onComplete: () => library.remove(can) });
            gravity(slot);
          }
        });
        // faltando: entra pelo fundo da coluna e desliza até o primeiro lugar livre
        const missing = target.map((n, fi) => Math.max(0, n - visible(fi)));
        for (let round = 0; missing.some((m) => m > round); round++) {
          for (const [fi, m] of missing.entries()) {
            if (m <= round) continue;
            const slot = slots.find((s) => !s.can);
            if (!slot) break;
            const can = library.add(await library.model(models[fi]), fi, { ...restPose(slot), z: backZ(slot) - 0.09, yaw: CAN_YAW });
            slot.can = can; can.slot = slot;
            moveTo(can, restPose(slot), { duration: 0.75, delay: 0.5, ease: 'power3.out' });
          }
        }
        if (sel.fi !== undefined && !sel.can && frontmost(sel.fi)) select(sel.fi, true);
      } while (syncAgain && !disposed);
    } catch (error) {
      console.error('[geladeira] falha ao repor latas:', error);
    } finally {
      syncing = false;
    }
  }

  // ── compra: cada unidade sai da geladeira, passa por cima da borda, gira no ar e mergulha no carrinho
  const cartWorld = (dist = 0.42) => {
    const p = opts.cartPoint ? opts.cartPoint() : null;
    const r = canvas.getBoundingClientRect();
    const nx = p ? ((p.x - r.left) / r.width) * 2 - 1 : 0.8, ny = p ? -(((p.y - r.top) / r.height) * 2 - 1) : 0.85;
    const dir = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    return camera.position.clone().add(dir.multiplyScalar(dist));
  };
  function take(fi) {
    queued.set(fi, Math.max(0, (queued.get(fi) || 0) - 1));
    const can = sel.can?.flavor === fi && sel.can.slot ? sel.can : frontmost(fi);
    if (!can) return null;
    const slot = can.slot;
    const blocked = columnOf(slot).some((s) => s.depth < slot.depth && s.can);
    if (can === sel.can) { stopBob(); sel.can = null; }
    if (hovered === can) hovered = null;
    slot.can = null; can.slot = null;
    library.untarget(can);
    gravity(slot);
    sync();
    return { can, slot, blocked };
  }
  function flyCan(fi) {
    const taken = take(fi);
    if (!taken) return Promise.resolve().then(() => emit('landed', fi));
    const { can, slot, blocked } = taken;
    const pose = library.wake(can);
    kill(can);
    scene.attach(pose);
    const p0 = pose.position.clone();
    const front = cooler.interior.localToWorld(new THREE.Vector3(slot.x, slot.y, frontZ + 0.134));
    const p1 = new THREE.Vector3(p0.x * 0.85, p0.y + 0.05, front.z);
    const rise = blocked ? overLift(slot) : 0.034;
    const P = { t: 0 };
    const rot0 = pose.rotation.clone();
    const spinY = Math.PI * 2 * (1.2 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1);
    let curve = null;
    return new Promise((res) => {
      const tl = timeline({ onUpdate: () => draw() });
      // 1) puxada: ergue por cima da borda (ou das latas da frente) e desliza para fora
      tl.to(pose.position, { y: p0.y + rise, duration: 0.2 * motion, ease: 'power2.out' })
        .to(pose.rotation, { x: -0.16, duration: 0.2 * motion, ease: 'power2.out' }, 0)
        .to(pose.position, { x: p1.x, z: p1.z, duration: 0.46 * motion, ease: 'power3.in' }, 0.08 * motion)
        .to(pose.position, { y: Math.max(p1.y, p0.y + rise), duration: 0.46 * motion, ease: 'sine.inOut' }, 0.08 * motion)
        // 2) voo até o carrinho: arco, giro e encolhida no fim
        .add(() => {
          const end = cartWorld(0.78);
          const start = pose.position.clone();
          curve = new THREE.CubicBezierCurve3(start, start.clone().add(new THREE.Vector3(0, 0.13, 0.08)), end.clone().add(new THREE.Vector3(-0.05, -0.07, -0.1)), end);
        })
        .to(P, {
          t: 1, duration: 1.05 * motion, ease: 'power2.inOut',
          onUpdate: () => {
            if (!curve) return;
            const t = P.t;
            curve.getPoint(t, pose.position);
            pose.rotation.set(rot0.x - 0.16 + Math.sin(t * Math.PI) * 0.5, rot0.y + spinY * t, Math.sin(t * Math.PI) * -0.42);
            const sc = t < 0.22 ? 1 + 0.04 * (t / 0.22) : 1.04 - 0.92 * Math.pow((t - 0.22) / 0.78, 1.15);
            pose.scale.setScalar(Math.max(0.05, sc));
          },
        })
        .to(pose.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.12 * motion, ease: 'power2.in' })
        .add(() => { library.remove(can); draw(); emit('landed', fi); res(); });
    });
  }

  const queue = []; let running = false;
  async function run() {
    if (running) return;
    running = true; clearTimeout(closeTimer);
    try {
      const r0 = debug.getRig();
      if (Math.abs(shortest(r0.az, ORDER_VIEW.az) - r0.az) > 0.6 || r0.el > 0.5) await moveRig({ ...rigFor(ORDER_VIEW) }, 0.9);
      if (!doorOpen || hingePivot.rotation.y < OPEN_ANGLE - 0.05) await openDoor(true);
      const flights = []; let lastColumn = null;
      while (queue.length) {
        const job = queue.shift();
        const column = (sel.can?.flavor === job.flavor ? sel.can : frontmost(job.flavor))?.slot?.column ?? null;
        flights.push(flyCan(job.flavor));
        const many = queue.length + flights.length > 6;
        await new Promise((r) => setTimeout(r, (column !== null && column === lastColumn ? (many ? 300 : 420) : (many ? 200 : 320)) * motion));
        lastColumn = column;
      }
      await Promise.all(flights);
    } catch (e) { console.error(e); }
    running = false;
    if (queue.length) return run();
    if (!manualOpen) { await new Promise((r) => setTimeout(r, 650 * motion)); if (!running && !queue.length && !manualOpen) closeDoor(); }
  }
  function dispense(flavor, n = 1) {
    const animated = Math.min(n, 24);
    for (let i = 0; i < animated; i++) queue.push({ flavor });
    queued.set(flavor, (queued.get(flavor) || 0) + animated);
    run();
    return n - animated;
  }

  // ── toque e ponteiro
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const doorMeshes = []; cooler.door.traverse((o) => { if (o.isMesh) doorMeshes.push(o); });
  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const hitDoor = (e) => { aim(e); return ray.intersectObjects(doorMeshes, false).length > 0; };
  // com a porta aberta, a lata mais próxima vence a porta
  const hitCan = (e) => {
    if (!doorOpen || hingePivot.rotation.y < 1.2) return null;
    aim(e);
    const hc = library.hit(ray);
    if (!hc) return null;
    const hd = ray.intersectObjects(doorMeshes, false)[0];
    return hd && hd.distance < hc.distance ? null : hc.can;
  };
  // a lata sob o ponteiro se destaca um pouco (a escolhida já está destacada)
  function hoverCan(can) {
    if (can === hovered) return;
    const prev = hovered; hovered = can;
    if (prev && prev !== sel.can && prev.slot && !running) moveTo(prev, restPose(prev.slot), { duration: 0.35, ease: 'power2.out' });
    if (can && can !== sel.can && !running) moveTo(can, { x: can.slot.x, y: can.slot.y + 0.008, z: can.slot.z + 0.006 }, { duration: 0.35, ease: 'power2.out' });
  }
  let down = null, hoverT = 0;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!down) return;
    const mv = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (mv > 6 || dt > 450 || running) return;
    const can = hitCan(e);
    if (can) { pick(can); return; }
    if (hitDoor(e)) toggleDoor();
  };
  const onMove = (e) => {
    if (e.buttons || e.pointerType === 'touch') return;
    const now = performance.now(); if (now - hoverT < 60) return; hoverT = now;
    const can = hitCan(e); hoverCan(can);
    canvas.style.cursor = can || hitDoor(e) ? 'pointer' : 'grab';
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointermove', onMove);
  // contexto WebGL devolvido pelo navegador (celular com pouca memória): o motor desenha sob
  // demanda, então pede-se um quadro para a geladeira reaparecer sem esperar interação
  const onContextRestored = () => draw();
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // ── início: enquadra, mostra e libera a órbita
  frame(); measureEngineFit();
  debug.setRig(rigFor(opts.startView === 'front' ? VIEWS.front : homeView()));
  postResize.observe(canvas.parentElement);
  canvas.classList.add('is-ready');
  engine.setExplore(true);
  debug.resume();
  booted = true;

  Object.assign(api, {
    dispense, toggleDoor, select,
    recenter() { return moveRig(rigFor(homeView()), 0.95); },
    focus: focusTo,
    relayout() { relayout(); },
    /** Disponível por sabor (estoque − carrinho − latas em voo), na ordem do catálogo. */
    setStock(next) { available = [...next]; sync(); },
    /**
     * Acende ou apaga o LED e as luzes de dentro (0 a 1). Resolve ao terminar.
     * @param {{ led?: number, interior?: number }} levels
     * @param {{ duration?: number }} [options] segundos
     */
    setPower(levels, { duration = 0 } = {}) {
      gsap.killTweensOf(power);
      if (duration <= 0) {
        Object.assign(power, levels);
        applyPower();
        drawHeld();
        return waitForFrame(renderer).catch(() => {}); // resolve com o quadro pronto na GPU
      }
      return new Promise((resolve) => {
        tween(power, { ...levels, duration, ease: 'sine.inOut', onUpdate: () => { applyPower(); drawHeld(); }, onComplete: resolve, onInterrupt: resolve });
      });
    },
    get power() {
      return { ...power };
    },
    /** Libera a cena montada com `hold`: a lata escolhida volta a flutuar. */
    release() {
      if (!held) return;
      held = false;
      draw(heldShadows);
      if (sel.can) startBob(sel.can);
    },
    /** Retângulo da geladeira na janela, como está agora na tela. */
    fridgeScreenRect() {
      camera.updateMatrixWorld();
      return projectBox(camera, BOX, canvas.getBoundingClientRect());
    },
    /**
     * Linha central da moldura de LED projetada na janela: `count` pontos, a partir do meio do
     * topo, no sentido horário. Usada pelo gerador da imagem do loading.
     */
    ledOutline(count = 240) {
      const core = cooler.root.getObjectByName('BlueLEDFrame')?.children.find((m) => m.isMesh && !m.material.map);
      if (!core) return [];
      const shape = [].concat(core.geometry.parameters.shapes)[0];
      const outer = new THREE.Box2().setFromPoints(shape.getPoints());
      const inner = new THREE.Box2().setFromPoints(shape.holes[0].getPoints());
      const top = shape.getPoints().filter((p) => Math.abs(p.y - outer.max.y) < 1e-6);
      const rOuter = Math.min(...top.map((p) => p.x)) - outer.min.x;
      const band = (outer.max.x - inner.max.x) / 2;
      const hw = outer.max.x - band;
      const hh = outer.max.y - band;
      const r = rOuter - band;
      const depth = core.geometry.parameters.options?.depth ?? 0;
      const straightW = 2 * (hw - r);
      const straightH = 2 * (hh - r);
      const arc = (Math.PI / 2) * r;
      const total = 2 * straightW + 2 * straightH + 4 * arc;
      // percurso a partir do meio do topo, sentido horário visto de frente
      const segments = [
        ['line', straightW / 2, [0, hh], [1, 0]],
        ['arc', arc, [hw - r, hh - r], Math.PI / 2],
        ['line', straightH, [hw, hh - r], [0, -1]],
        ['arc', arc, [hw - r, -hh + r], 0],
        ['line', straightW, [hw - r, -hh], [-1, 0]],
        ['arc', arc, [-hw + r, -hh + r], -Math.PI / 2],
        ['line', straightH, [-hw, -hh + r], [0, 1]],
        ['arc', arc, [-hw + r, hh - r], Math.PI],
        ['line', straightW / 2, [-hw + r, hh], [1, 0]],
      ];
      const rect = canvas.getBoundingClientRect();
      camera.updateMatrixWorld();
      core.updateMatrixWorld();
      const out = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        let s = (i / count) * total;
        let seg = segments[0];
        for (seg of segments) {
          if (s <= seg[1]) break;
          s -= seg[1];
        }
        const [kind, length, a, b] = seg;
        if (kind === 'line') v.set(a[0] + b[0] * s, a[1] + b[1] * s, depth);
        else {
          const angle = b - (s / length) * (Math.PI / 2);
          v.set(a[0] + r * Math.cos(angle), a[1] + r * Math.sin(angle), depth);
        }
        core.localToWorld(v).project(camera);
        out.push([rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]);
      }
      return out;
    },
    dispose() {
      disposed = true; booted = false;
      clearTimeout(closeTimer);
      clearTimeout(trailingPaint);
      cancelAnimationFrame(raf);
      condensation?.dispose();
      owned.forEach((a) => a.kill()); owned.clear();
      preResize.disconnect(); postResize.disconnect();
      rm.removeEventListener?.('change', onRM);
      canvas.parentElement?.removeEventListener('pointerdown', holdDrag, true);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.classList.remove('is-ready');
      library.dispose();
      cabinet.dispose();
      engine.dispose();
      floorShadow.dispose();
    },
  });
  return api;
}
