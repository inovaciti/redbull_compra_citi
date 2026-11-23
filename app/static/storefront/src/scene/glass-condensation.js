// Condensação no vidro da porta: embaçado e gotas de água na face externa, como numa
// geladeira de verdade, e vivas.
//
// - O ar frio desce: o vidro embaça mais embaixo e junto às bordas e cantos; o centro fica
//   quase limpo, para as latas continuarem visíveis.
// - De tempos em tempos uma gota cresce até ficar pesada e escorre aos trancos (para,
//   desliza, para), desviando um pouco, engolindo as gotinhas do caminho, deixando contas
//   para trás e um rastro limpo no embaçado, que volta a embaçar devagar.
//
// Três camadas presas ao vidro (abrem e fecham com a porta):
//   névoa     canvas em meia resolução = névoa original × máscara (onde o vidro foi limpo)
//   gotas     canvas em resolução cheia, atualizado só onde algo muda
//   filme     a película de água que a gota deixa no caminho; seca aos poucos
//   cabeças   planos pequenos com a gota que está escorrendo (movimento suave, sem reenviar textura)

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '../../vendor/three/three.module.min.js';

const PX_PER_M = 3200; // resolução das gotas (~1030 × 1430 px para o vidro do Mini Cooler)
const FOG_SCALE = 0.5; // a névoa é macia: meia resolução basta
const FOG = [232, 240, 246]; // branco levemente frio
const FOG_MAX = 0.82; // opacidade máxima do embaçado (cantos de baixo)
const VEIL_FOG = [178, 186, 196]; // véu do loading: embaçado sem luz dentro, mais acinzentado
const SURFACE_OFFSET = 0.0012; // à frente do vidro externo
const UPLOAD_INTERVAL = 1 / 12; // s entre envios das texturas à GPU durante uma escorrida
const REFOG_STEP_MS = 500; // a névoa volta a cobrir os rastros aos poucos…
const REFOG_ALPHA = 0.016; // …nessa proporção por passo (~45 s para fechar)
const REFOG_FOR_MS = 70000;
const MAX_RUNNING = 3;

function random(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const canvas2d = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
};

/**
 * Onde o vidro embaça (0 a 1): só na parte de baixo, onde o ar frio se acumula. A névoa vai
 * sumindo aos poucos para cima, e o limite não é reto: de um lado termina mais cedo, do outro
 * sobe um pouco mais, sem passar da metade do vidro. As manchas (`noise`) quebram a uniformidade.
 */
function fogDensity(u, v, noise) {
  const top = 0.63 + 0.09 * Math.sin(u * 2.1 + 1.3) + 0.04 * Math.sin(u * 5.3 + 0.4); // de 0,50 a 0,76
  const bottom = smoothstep(top, top + 0.3, v) ** 1.2;
  const side = Math.min(u, 1 - u);
  const border = (1 - smoothstep(0.015, 0.1, side)) * smoothstep(top - 0.02, top + 0.25, v); // bordas, só embaixo
  const corner = (1 - smoothstep(0, 0.3, Math.hypot(side, 1 - v))) * 0.9;
  return Math.min(1, Math.max(bottom * 0.95, border * 0.7, corner) * (0.5 + 0.7 * noise));
}

/** Ruído suave de baixa frequência (manchas), feito com borrões aleatórios. */
function blotches(w, h, rand) {
  const [, x] = canvas2d(w, h);
  x.fillStyle = '#000';
  x.fillRect(0, 0, w, h);
  x.filter = `blur(${Math.round(w * 0.025)}px)`;
  for (let i = 0; i < 160; i++) {
    x.fillStyle = `rgba(255,255,255,${0.08 + rand() * 0.18})`;
    x.beginPath();
    x.arc(rand() * w, rand() * h, w * (0.03 + rand() * 0.12), 0, Math.PI * 2);
    x.fill();
  }
  const data = x.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, (out[i] = data[i * 4] / 255));
  for (let i = 0; i < out.length; i++) out[i] /= max || 1;
  return out;
}

/**
 * Uma gota vista de frente funciona como uma lentinha: borda mais escura, reflexo forte
 * no alto, luz refratada concentrada embaixo.
 */
function drawDrop(x, cx, cy, r, stretch = 1) {
  if (r < 1.6) {
    // microgota: um ponto de luz com uma sombra mínima embaixo
    x.fillStyle = 'rgba(40,52,62,0.12)';
    x.beginPath();
    x.arc(cx, cy + r * 0.35, r, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.beginPath();
    x.arc(cx - r * 0.2, cy - r * 0.2, r * 0.7, 0, Math.PI * 2);
    x.fill();
    return;
  }
  x.save();
  x.translate(cx, cy);
  x.scale(1, stretch);
  const body = x.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.1, 0, 0, r);
  body.addColorStop(0, 'rgba(255,255,255,0.06)');
  body.addColorStop(0.7, 'rgba(210,225,235,0.10)');
  body.addColorStop(0.92, 'rgba(40,52,62,0.22)');
  body.addColorStop(1, 'rgba(40,52,62,0)');
  x.fillStyle = body;
  x.beginPath();
  x.arc(0, 0, r, 0, Math.PI * 2);
  x.fill();
  const caustic = x.createRadialGradient(0, r * 0.45, 0, 0, r * 0.45, r * 0.7);
  caustic.addColorStop(0, 'rgba(255,255,255,0.32)');
  caustic.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = caustic;
  x.beginPath();
  x.arc(0, 0, r * 0.86, 0.15 * Math.PI, 0.85 * Math.PI);
  x.fill();
  x.fillStyle = 'rgba(255,255,255,0.9)';
  x.beginPath();
  x.ellipse(-r * 0.33, -r * 0.4, r * 0.22, r * 0.15, -0.6, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/** Pinta o estado inicial: névoa original, máscara (rastros antigos) e gotas. */
function paintInitial(w, h, rand) {
  const fw = Math.round(w * FOG_SCALE);
  const fh = Math.round(h * FOG_SCALE);

  // névoa original, calculada numa grade menor e ampliada com suavização
  const lw = Math.round(w / 4);
  const lh = Math.round(h / 4);
  const noise = blotches(lw, lh, rand);
  const density = new Float32Array(lw * lh);
  const [low, lx] = canvas2d(lw, lh);
  const fogData = lx.createImageData(lw, lh);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const k = j * lw + i;
      density[k] = fogDensity(i / (lw - 1), j / (lh - 1), noise[k]);
      fogData.data.set([FOG[0], FOG[1], FOG[2], density[k] * FOG_MAX * 255], k * 4);
    }
  }
  lx.putImageData(fogData, 0, 0);
  const [fogOriginal, fox] = canvas2d(fw, fh);
  fox.imageSmoothingQuality = 'high';
  fox.drawImage(low, 0, 0, fw, fh);
  const densityAt = (px, py) => density[Math.min(lh - 1, Math.floor((py / h) * lh)) * lw + Math.min(lw - 1, Math.floor((px / w) * lw))];

  // máscara da névoa (opaca = embaçado, transparente = limpo) com os rastros de escorridas antigas, meio reembaçados
  const [mask, mx] = canvas2d(fw, fh);
  mx.fillStyle = '#fff';
  mx.fillRect(0, 0, fw, fh);
  const [drops, dx] = canvas2d(w, h);
  const oldRuns = [];
  for (let i = 0; i < 5; i++) {
    const points = [];
    let px = w * (0.1 + rand() * 0.8);
    for (let py = h * (0.48 + rand() * 0.25); py < h * 0.985; py += h * 0.01) {
      px += (rand() - 0.5) * w * 0.006;
      points.push([px, py]);
    }
    oldRuns.push({ points, r: w * (0.008 + rand() * 0.004) });
  }
  mx.globalCompositeOperation = 'destination-out'; // a máscara está no alfa: tirar alfa = limpar o vidro
  mx.lineCap = 'round';
  mx.lineJoin = 'round';
  for (const run of oldRuns) {
    mx.lineWidth = run.r * 1.7 * FOG_SCALE;
    mx.strokeStyle = `rgba(0,0,0,${0.7 + rand() * 0.25})`;
    mx.filter = `blur(${Math.max(1, run.r * 0.15)}px)`;
    mx.beginPath();
    run.points.forEach(([px, py], n) => (n ? mx.lineTo(px * FOG_SCALE, py * FOG_SCALE) : mx.moveTo(px * FOG_SCALE, py * FOG_SCALE)));
    mx.stroke();
  }
  mx.filter = 'none';

  // gotas paradas: cada uma limpa a névoa à sua volta
  const placed = [];
  const place = (count, rMin, rMax, inFog) => {
    for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
      const px = rand() * w;
      const py = rand() * h;
      const d = densityAt(px, py);
      if (rand() > (inFog ? d * 1.15 : 0.08 + d * 0.9)) continue;
      placed.push({ px, py, r: rMin + rand() ** 2 * (rMax - rMin) * (0.6 + d * 0.6), stretch: 1 + rand() * 0.12 });
      n++;
    }
  };
  place(2600, 0.6, 1.6, true); // microgotas: a névoa vista de perto
  place(420, 2, 6.5, false); // gotas médias, algumas no vidro limpo
  place(60, 7, 15, true); // gotas grandes, nas áreas mais úmidas
  for (const d of placed) {
    if (d.r < 2) continue;
    const s = FOG_SCALE;
    const halo = mx.createRadialGradient(d.px * s, d.py * s, d.r * s, d.px * s, d.py * s, d.r * 2.4 * s);
    halo.addColorStop(0, 'rgba(0,0,0,0.95)');
    halo.addColorStop(0.45, 'rgba(0,0,0,0.6)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = halo;
    mx.beginPath();
    mx.arc(d.px * s, d.py * s, d.r * 2.4 * s, 0, Math.PI * 2);
    mx.fill();
  }
  for (const d of placed) drawDrop(dx, d.px, d.py, d.r, d.stretch);
  for (const run of oldRuns) {
    run.points.forEach(([px, py], n) => {
      if (n % 3 === 0 && rand() < 0.5) drawDrop(dx, px + (rand() - 0.5) * run.r, py, run.r * (0.25 + rand() * 0.25));
    });
    const [ex, ey] = run.points[run.points.length - 1];
    drawDrop(dx, ex, ey, run.r * 1.25, 1.35);
  }
  return { fogOriginal, mask, drops, densityAt };
}

/**
 * Véu de embaçado que cobre o vidro inteiro (só para a imagem do loading, que esconde a
 * geladeira vazia). Usa um gerador aleatório próprio: o embaçado normal sai idêntico.
 */
function paintVeil(w, h, densityAt, strength) {
  const rand = random(7041977);
  const [veil, vx] = canvas2d(w, h);
  const lw = Math.round(w / 8);
  const lh = Math.round(h / 8);
  const noise = blotches(lw, lh, rand);
  const [low, lx] = canvas2d(lw, lh);
  const data = lx.createImageData(lw, lh);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const k = j * lw + i;
      const base = densityAt(((i + 0.5) / lw) * w, ((j + 0.5) / lh) * h);
      const alpha = strength * (0.86 + 0.14 * noise[k]) * (1 - 0.75 * base);
      data.data.set([VEIL_FOG[0], VEIL_FOG[1], VEIL_FOG[2], alpha * 255], k * 4);
    }
  }
  lx.putImageData(data, 0, 0);
  vx.imageSmoothingQuality = 'high';
  vx.drawImage(low, 0, 0, w, h);

  // escorridas antigas: a água abriu caminhos no embaçado, meio reembaçados
  vx.globalCompositeOperation = 'destination-out';
  vx.lineCap = 'round';
  vx.lineJoin = 'round';
  const trails = [];
  for (let i = 0; i < 3; i++) {
    const points = [];
    let px = w * (0.15 + rand() * 0.7);
    for (let py = h * (0.04 + rand() * 0.2); py < h * (0.5 + rand() * 0.3); py += h * 0.01) {
      px += (rand() - 0.5) * w * 0.006;
      points.push([px, py]);
    }
    const r = w * (0.007 + rand() * 0.004);
    trails.push({ points, r });
    vx.lineWidth = r * 1.7;
    vx.strokeStyle = `rgba(0,0,0,${0.45 + rand() * 0.2})`;
    vx.filter = `blur(${Math.max(1, r * 0.3)}px)`;
    vx.beginPath();
    points.forEach(([x, y], n) => (n ? vx.lineTo(x, y) : vx.moveTo(x, y)));
    vx.stroke();
  }
  vx.filter = 'none';

  // gotas sobre o véu, cada uma limpando um pouco à sua volta
  const drops = [];
  for (let n = 0; n < 3400; n++) drops.push({ px: rand() * w, py: rand() * h * 0.62, r: 0.6 + rand() ** 2 * 1.1, stretch: 1 });
  for (let n = 0; n < 260; n++) drops.push({ px: rand() * w, py: rand() * h * 0.6, r: 2 + rand() ** 2 * 4.5, stretch: 1 + rand() * 0.1 });
  for (const d of drops) {
    if (d.r < 2) continue;
    const halo = vx.createRadialGradient(d.px, d.py, d.r, d.px, d.py, d.r * 2.2);
    halo.addColorStop(0, 'rgba(0,0,0,0.85)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    vx.fillStyle = halo;
    vx.beginPath();
    vx.arc(d.px, d.py, d.r * 2.2, 0, Math.PI * 2);
    vx.fill();
  }
  vx.globalCompositeOperation = 'source-over';
  for (const d of drops) drawDrop(vx, d.px, d.py, d.r, d.stretch);
  for (const { points, r } of trails) {
    points.forEach(([px, py], n) => {
      if (n % 3 === 0 && rand() < 0.5) drawDrop(vx, px + (rand() - 0.5) * r, py, r * (0.25 + rand() * 0.25));
    });
    const [ex, ey] = points[points.length - 1];
    drawDrop(vx, ex, ey, r * 1.25, 1.35);
  }
  return veil;
}

/**
 * Cria a condensação para o vidro da porta do Mini Cooler.
 * @param {any} cooler `debug.cooler` do motor
 * @param {{ wake: () => void, requestFrame: () => void, veil?: number }} host
 *   wake: pede quadros contínuos (há gota escorrendo); requestFrame: pede um quadro só;
 *   veil: embaçado sobre o vidro todo (0 a 1), só para gerar a imagem do loading
 */
export function createCondensation(cooler, { wake, requestFrame, veil = 0 }) {
  const panel = cooler.root.getObjectByName('GlassPanel');
  const pane = panel?.children
    .filter((mesh) => mesh.geometry?.type === 'PlaneGeometry' && mesh.material?.transparent)
    .sort((a, b) => b.position.z - a.position.z)[0]; // vidro externo
  if (!pane) return null;
  const { width, height } = pane.geometry.parameters;
  const w = Math.round(width * PX_PER_M);
  const h = Math.round(height * PX_PER_M);
  const rand = random(20251118);
  const live = random(Date.now() % 2147483646 || 1); // o que acontece depois varia a cada visita
  const { fogOriginal, mask, drops, densityAt } = paintInitial(w, h, rand);
  const mx = mask.getContext('2d');
  const dx = drops.getContext('2d');
  const [fog, fx] = canvas2d(fogOriginal.width, fogOriginal.height);
  const composeFog = () => {
    fx.globalCompositeOperation = 'copy';
    fx.drawImage(fogOriginal, 0, 0);
    fx.globalCompositeOperation = 'destination-in';
    fx.drawImage(mask, 0, 0);
  };
  composeFog();

  const resources = [];
  const track = (resource) => {
    resources.push(resource);
    return resource;
  };
  const texture = (canvas) => {
    const t = track(new CanvasTexture(canvas));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const [film, flx] = canvas2d(fog.width, fog.height);
  const fogTexture = texture(fog);
  const dropsTexture = texture(drops);
  const filmTexture = texture(film);
  const plane = track(new PlaneGeometry(1, 1));
  const layer = (map, offset, name) => {
    const material = track(new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
    const mesh = new Mesh(plane, material);
    mesh.name = name;
    mesh.scale.set(width, height, 1);
    mesh.position.set(pane.position.x, pane.position.y, pane.position.z + offset);
    mesh.renderOrder = pane.renderOrder + 1;
    panel.add(mesh);
    return mesh;
  };
  const fogMesh = layer(fogTexture, SURFACE_OFFSET, 'GlassFog');
  const filmMesh = layer(filmTexture, SURFACE_OFFSET + 0.00005, 'GlassFilm');
  const dropsMesh = layer(dropsTexture, SURFACE_OFFSET + 0.0001, 'GlassDrops');
  const veilMesh = veil > 0 ? layer(texture(paintVeil(w, h, densityAt, veil)), SURFACE_OFFSET + 0.00007, 'GlassVeil') : null;

  // cabeças das gotas que escorrem: planos com uma gota desenhada em alta resolução
  const [headCanvas, hx] = canvas2d(128, 160);
  drawDrop(hx, 64, 72, 54, 1.12);
  const headTexture = texture(headCanvas);
  const heads = Array.from({ length: MAX_RUNNING }, () => {
    const mesh = layer(headTexture, SURFACE_OFFSET + 0.0002, 'GlassRunningDrop');
    mesh.visible = false;
    return mesh;
  });
  const toLocal = (px, py) => [pane.position.x + (px / w - 0.5) * width, pane.position.y + (0.5 - py / h) * height];
  const pxToM = width / w;

  // ── reembaçamento: a máscara volta ao branco aos poucos, com um quadro a cada passo
  let lastClear = 0;
  let refogTimer = 0;
  function refog() {
    mx.globalCompositeOperation = 'source-over';
    mx.fillStyle = `rgba(255,255,255,${REFOG_ALPHA})`;
    mx.fillRect(0, 0, mask.width, mask.height);
    flx.globalCompositeOperation = 'destination-out';
    flx.fillStyle = `rgba(0,0,0,${REFOG_ALPHA * 1.4})`; // a película seca um pouco antes de a névoa voltar
    flx.fillRect(0, 0, film.width, film.height);
    composeFog();
    fogTexture.needsUpdate = true;
    filmTexture.needsUpdate = true;
    requestFrame();
    refogTimer = performance.now() - lastClear < REFOG_FOR_MS ? setTimeout(refog, REFOG_STEP_MS) : 0;
  }
  const startRefog = () => {
    lastClear = performance.now();
    if (!refogTimer) refogTimer = setTimeout(refog, REFOG_STEP_MS);
  };

  /** Limpa a névoa ao redor de uma gota (a água "puxa" a condensação vizinha). */
  function clearHalo(px, py, radius, strength = 0.9) {
    const s = FOG_SCALE;
    mx.globalCompositeOperation = 'destination-out';
    const g = mx.createRadialGradient(px * s, py * s, 0, px * s, py * s, radius * s);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.7})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = g;
    mx.beginPath();
    mx.arc(px * s, py * s, radius * s, 0, Math.PI * 2);
    mx.fill();
  }
  const upload = () => {
    composeFog();
    fogTexture.needsUpdate = true;
    dropsTexture.needsUpdate = true;
    filmTexture.needsUpdate = true;
    startRefog();
    requestFrame();
  };

  // ── gotas que se formam: a condensação se junta numa gota, que cresce e limpa a névoa em volta
  let condensed = 0;
  function condense() {
    if (document.hidden || condensed >= 160) return; // o vidro não fica coberto com o tempo
    condensed += 1;
    let px = 0;
    let py = 0;
    for (let tries = 0; tries < 30; tries++) {
      px = w * (0.04 + live() * 0.92);
      py = h * (0.04 + live() * 0.92);
      if (densityAt(px, py) > 0.35) break;
    }
    const r = w * (0.004 + live() ** 2 * 0.008);
    let stage = 0;
    const grow = () => {
      stage += 1;
      const rr = r * (0.35 + 0.65 * (stage / 4));
      clearHalo(px, py, rr * 2.6, 0.55 + stage * 0.1);
      dx.save();
      dx.globalCompositeOperation = 'destination-out';
      dx.beginPath();
      dx.arc(px, py, rr * 1.05, 0, Math.PI * 2);
      dx.fill();
      dx.restore();
      drawDrop(dx, px, py, rr, 1 + stage * 0.02);
      upload();
      if (stage < 4) {
        const id = setTimeout(() => {
          condenseTimers.delete(id);
          grow();
        }, 450);
        condenseTimers.add(id);
      }
    };
    grow();
  }
  const condenseTimers = new Set();

  // ── gotas que escorrem
  const running = [];
  function spawn() {
    if (running.length >= MAX_RUNNING || document.hidden) return;
    let px = 0;
    let py = 0;
    for (let tries = 0; tries < 40; tries++) {
      px = w * (0.08 + live() * 0.84);
      py = h * (0.45 + live() * 0.37);
      if (densityAt(px, py) > 0.3 || live() < 0.1) break; // nascem quase sempre onde o vidro está embaçado
    }
    const mesh = heads.find((m) => !m.visible);
    const r0 = w * (0.016 + live() * 0.008);
    running.push({ mesh, x: px, y: py, r0, r: r0 * 0.3, phase: 'grow', t: 0, dur: 1 + live() * 1.4, v: 0, wob: live() * 6, lastBead: py });
    mesh.visible = true;
    wake();
  }

  /** Passo da gota sobre o vidro: limpa o rastro, engole gotinhas e deixa contas. */
  function slide(d, from, to) {
    const s = FOG_SCALE;
    mx.globalCompositeOperation = 'destination-out';
    mx.lineCap = 'round';
    // rastro com borda macia: a água arrasta a névoa e deixa as margens irregulares
    for (const [alpha, widthRatio] of [[0.6, 1.6], [1, 1.05]]) {
      mx.strokeStyle = `rgba(0,0,0,${alpha})`;
      mx.lineWidth = d.r * widthRatio * s * (0.85 + live() * 0.3);
      mx.beginPath();
      mx.moveTo(from[0] * s, from[1] * s);
      mx.lineTo(to[0] * s, to[1] * s);
      mx.stroke();
    }
    // película de água: miolo claro, uma margem que pega luz e outra em sombra; nas bordas,
    // a condensação empurrada pela gota se junta num filete mais branco
    flx.globalCompositeOperation = 'source-over';
    flx.lineCap = 'round';
    // (só onde havia névoa para empurrar)
    flx.strokeStyle = `rgba(${FOG[0]},${FOG[1]},${FOG[2]},${(0.3 * densityAt(to[0], to[1])).toFixed(3)})`;
    for (const side of [-1, 1]) {
      flx.lineWidth = Math.max(1, d.r * 0.32 * s);
      flx.beginPath();
      flx.moveTo((from[0] + side * d.r * 0.92) * s, from[1] * s);
      flx.lineTo((to[0] + side * d.r * 0.92) * s, to[1] * s);
      flx.stroke();
    }
    const shine = 0.3 + live() * 0.25; // o brilho da margem varia ao longo do caminho
    const edges = [[0, 0.9, 'rgba(255,255,255,0.1)'], [-0.42, 0.14, `rgba(255,255,255,${shine})`], [0.42, 0.14, 'rgba(25,35,45,0.38)']];
    for (const [offset, widthRatio, color] of edges) {
      flx.strokeStyle = color;
      flx.lineWidth = Math.max(1, d.r * widthRatio * s);
      flx.beginPath();
      flx.moveTo((from[0] + offset * d.r) * s, from[1] * s);
      flx.lineTo((to[0] + offset * d.r) * s, to[1] * s);
      flx.stroke();
    }
    dx.save();
    dx.globalCompositeOperation = 'destination-out';
    dx.fillStyle = '#000';
    dx.beginPath();
    dx.arc(to[0], to[1], d.r * 1.15, 0, Math.PI * 2);
    dx.fill();
    dx.restore();
    if (to[1] - d.lastBead > d.r * (1.8 + live() * 2.5)) {
      d.lastBead = to[1];
      const bead = d.r * (0.18 + live() * 0.28);
      const bx = to[0] + (live() - 0.5) * d.r * 0.6;
      const by = to[1] - d.r * 1.2;
      clearHalo(bx, by, bead * 2.2);
      drawDrop(dx, bx, by, bead);
      d.r = Math.sqrt(Math.max(0, d.r * d.r - bead * bead * 0.6)); // perde a água que deixou
    }
  }

  let uploadAcc = 0;
  let dirty = false;
  /** Avança as gotas; devolve se ainda há alguma em movimento. */
  function step(dt) {
    if (!running.length) return false;
    for (let i = running.length - 1; i >= 0; i--) {
      const d = running[i];
      d.t += dt;
      if (d.phase === 'grow') {
        // acumula água parada até ficar pesada
        d.r = d.r0 * (0.3 + 0.7 * smoothstep(0, 1, d.t / d.dur));
        if (d.t >= d.dur) Object.assign(d, { phase: 'slide', t: 0, dur: 0.25 + live() * 0.6, v: h * (0.05 + live() * 0.11) });
      } else if (d.phase === 'stick') {
        if (d.t >= d.dur) Object.assign(d, { phase: 'slide', t: 0, dur: 0.2 + live() * 0.7, v: h * (0.04 + live() * 0.12) });
      } else {
        const from = [d.x, d.y];
        const ease = Math.min(1, d.t / 0.12); // arranca e logo pega velocidade
        d.y += d.v * ease * dt;
        d.wob += dt * 3.1;
        d.x += (Math.sin(d.wob) * 0.25 + (live() - 0.5)) * d.r * 0.9 * dt * 4;
        slide(d, from, [d.x, d.y]);
        dirty = true;
        if (d.t >= d.dur) Object.assign(d, { phase: 'stick', t: 0, dur: 0.06 + live() ** 2 * 0.6 });
      }
      const [lx, ly] = toLocal(d.x, d.y);
      const stretch = d.phase === 'slide' ? 1.3 : 1;
      d.mesh.position.x = lx;
      d.mesh.position.y = ly;
      d.mesh.scale.set(d.r * 2.4 * pxToM, d.r * 3 * pxToM * stretch, 1);
      // fim: chegou embaixo ou perdeu água demais — vira uma gota parada no vidro
      if (d.y > h * 0.975 || (d.phase !== 'grow' && d.r < d.r0 * 0.42)) {
        drawDrop(dx, d.x, d.y, d.r, 1.3);
        d.mesh.visible = false;
        running.splice(i, 1);
        dirty = true;
      }
    }
    uploadAcc += dt;
    if (dirty && (uploadAcc >= UPLOAD_INTERVAL || !running.length)) {
      uploadAcc = 0;
      dirty = false;
      upload();
    }
    return running.length > 0;
  }

  // uma escorrida a cada 2,5–7 s (desligado com "reduzir movimento")
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  let spawnTimer = 0;
  const schedule = () => {
    spawnTimer = setTimeout(() => {
      if (!rm.matches) spawn();
      schedule();
    }, 2500 + live() * 4500);
  };
  schedule();
  let condenseTimer = 0;
  const scheduleCondense = () => {
    condenseTimer = setTimeout(() => {
      if (!rm.matches) condense();
      scheduleCondense();
    }, 900 + live() * 1800);
  };
  scheduleCondense();
  const firstTimer = setTimeout(() => { if (!rm.matches) spawn(); }, 1800); // a primeira logo depois de aparecer

  return {
    /** Material da névoa (a loja aumenta a opacidade quando a porta fecha). */
    material: fogMesh.material,
    step,
    dispose() {
      [spawnTimer, firstTimer, refogTimer, condenseTimer, ...condenseTimers].forEach(clearTimeout);
      [fogMesh, filmMesh, dropsMesh, veilMesh, ...heads].forEach((mesh) => mesh?.removeFromParent());
      resources.forEach((resource) => resource.dispose());
    },
  };
}
