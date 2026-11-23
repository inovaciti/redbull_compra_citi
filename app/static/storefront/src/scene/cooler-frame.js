// Enquadramento da geladeira, sem Three.js. A cena 3D (cooler-scene.js) usa estas contas para
// a câmera; o loading (src/boot.js, via storefront.js) usa as mesmas para saber, antes de o 3D
// carregar, onde a geladeira vai aparecer de frente. Uma fonte só: os dois nunca divergem.
//
// As contas seguem as do motor do kit ao redimensionar (área livre → quadro estendido com
// deslocamento → distância que enquadra um raio de 0,45 m).

const ENGINE_FOV = 24; // campo de visão vertical da câmera do motor, em graus
const ENGINE_NEAR = 0.05; // plano próximo da câmera do motor
const FIT_RADIUS = 0.45; // raio que o motor usa para enquadrar a geladeira
export const TARGET_Y = 0.3; // altura do ponto para onde a câmera olha (a mesma do motor)
export const MOBILE_MAX_WIDTH = 700; // abaixo disso a geladeira fica mais perto e de frente
const MOBILE_ZOOM = 0.82;
export const VIEWS = { front: { az: 0, el: 0.05 }, three4: { az: -0.66, el: 0.2 } }; // vistas do motor do kit
// caixa da geladeira com a porta fechada, em metros (medida no modelo do motor)
export const COOLER_BOX = { min: [-0.24, -0.0016, -0.24285], max: [0.24, 0.594, 0.2362] };

const DEG2RAD = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Projeção para a área livre: quadro estendido (`FW` × `FH`), deslocamento da janela dentro
 * dele e a tangente que enquadra a geladeira.
 * @param {{ l: number, r: number, t: number, b: number }} ins
 */
export function frameGeometry(ins, vw, vh, fov = ENGINE_FOV) {
  const freeW = Math.max(120, vw - ins.l - ins.r), freeH = Math.max(120, vh - ins.t - ins.b);
  const dx = ins.l + freeW / 2 - vw / 2, dy = ins.t + freeH / 2 - vh / 2;
  const FW = vw + 2 * Math.abs(dx), FH = vh + 2 * Math.abs(dy);
  const tv = Math.tan((fov / 2) * DEG2RAD);
  const tanFit = Math.min((tv * freeH) / FH, (tv * freeW) / FH);
  return { FW, FH, offX: dx > 0 ? 0 : 2 * Math.abs(dx), offY: dy > 0 ? 0 : 2 * Math.abs(dy), tanFit };
}

/** Distância de enquadramento calculada pelo motor (os limites da órbita saem dela). */
export function engineFitDistance(ins, vw, vh, fov = ENGINE_FOV) {
  const freeW = vw - ins.l - ins.r, freeH = vh - ins.t - ins.b;
  const FH = vh + 2 * Math.abs(ins.t + freeH / 2 - vh / 2);
  const tv = Math.tan((fov / 2) * DEG2RAD);
  return FIT_RADIUS / Math.sin(Math.atan(Math.min((tv * freeH) / FH, (tv * freeW) / FH)));
}

/**
 * Distância da câmera: no celular a geladeira fica mais perto; no modo foco (`focusK` → 1), um
 * pouco mais longe. Sempre dentro do que a órbita do motor aceita (0,63–1,69 × enquadramento).
 */
export function fitDistance(tanFit, engineFit, vw, focusK = 0) {
  const d = (FIT_RADIUS * (vw < MOBILE_MAX_WIDTH ? MOBILE_ZOOM : 1 - 0.18 * focusK)) / Math.sin(Math.atan(tanFit));
  return clamp(d, engineFit * 0.63, engineFit * 1.69);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Onde a geladeira aparece de frente, sem o motor 3D carregado: a mesma câmera da cena
 * (perspectiva com deslocamento, olhando para o alvo), projetando a caixa da geladeira.
 * @param {{ left: number, top: number, width: number, height: number }} rect área do canvas na janela
 * @param {{ l: number, r: number, t: number, b: number }} insets a mesma área livre passada à cena
 */
export function fridgeLayoutRect(rect, insets) {
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const g = frameGeometry(insets, w, h);
  const dist = fitDistance(g.tanFit, engineFitDistance(insets, w, h), w);
  const { az, el } = VIEWS.front;
  const c = Math.cos(el);
  const eye = [dist * Math.sin(az) * c, TARGET_Y + dist * Math.sin(el), dist * Math.cos(az) * c];
  // base da câmera como em lookAt: z sai do alvo para o olho, x à direita, y para cima
  const zAxis = unit(sub(eye, [0, TARGET_Y, 0]));
  const xAxis = unit(cross([0, 1, 0], zAxis));
  const yAxis = cross(zAxis, xAxis);
  // janela da perspectiva com deslocamento (como PerspectiveCamera.setViewOffset)
  let top = ENGINE_NEAR * Math.tan((ENGINE_FOV / 2) * DEG2RAD);
  let height = 2 * top;
  let width = (g.FW / g.FH) * height;
  let left = -0.5 * width;
  left += (g.offX * width) / g.FW;
  top -= (g.offY * height) / g.FH;
  width *= w / g.FW;
  height *= h / g.FH;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = sub([COOLER_BOX[i & 1 ? 'max' : 'min'][0], COOLER_BOX[i & 2 ? 'max' : 'min'][1], COOLER_BOX[i & 4 ? 'max' : 'min'][2]], eye);
    const xc = dot(p, xAxis), yc = dot(p, yAxis), zc = dot(p, zAxis);
    const nx = ((2 * ENGINE_NEAR) / width * xc + ((2 * left + width) / width) * zc) / -zc;
    const ny = ((2 * ENGINE_NEAR) / height * yc + ((2 * top - height) / height) * zc) / -zc;
    x0 = Math.min(x0, nx); x1 = Math.max(x1, nx);
    y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
  }
  return {
    left: rect.left + ((x0 + 1) / 2) * rect.width,
    top: rect.top + ((1 - y1) / 2) * rect.height,
    width: ((x1 - x0) / 2) * rect.width,
    height: ((y1 - y0) / 2) * rect.height,
  };
}
