// Gera as imagens do loading a partir do motor 3D real.
//
//   node tools/render-boot-poster.mjs
//
// (Do pacote loading-geladeira, adaptado à plataforma: sobe o uvicorn, a página de captura usa
// os arquivos de app/static/storefront, e o bloco do loading é reescrito em app/templates/loja.html.)
//
// Para cada formato (celular e computador) renderiza a geladeira de frente, apagada, sem latas
// e com o vidro todo embaçado, exatamente no enquadramento da loja, e salva:
//   app/static/storefront/assets/loading/fridge-dark-<m|d>.webp   a geladeira apagada (com transparência)
//   app/static/storefront/assets/loading/fridge-glow-<m|d>.webp   só a luz do LED aceso (somada por cima da imagem;
//                                           cor na imagem, intensidade no alfa)
// e atualiza no loja.html o desenho da moldura (minhoca) e as medidas da imagem, e no
// boot.css as proporções. Requer o Playwright (o mesmo dos testes).

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { LOCAL_SERVER_ENV } from './local-server-env.mjs';

// o Playwright pode estar instalado no projeto ou globalmente
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5417;
const BASE = `http://localhost:${PORT}`;

const VARIANTS = [
  { id: 'm', viewport: { width: 390, height: 844 }, dpr: 4, quality: 0.8 },
  { id: 'd', viewport: { width: 1440, height: 900 }, dpr: 3, quality: 0.8 },
];
// folga em volta da geladeira, para caber o brilho do LED e a sombra no chão
const PAD = { x: 0.16, top: 0.07, bottom: 0.05 };
const LED_POINTS = 360; // contorno da moldura: pontos suficientes para as curvas ficarem lisas

const CAPTURE_PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${['fonts', 'base', 'header', 'controls', 'carousel', 'product', 'price-swap', 'liquid-glass', 'cart', 'toast', 'pdv', 'responsive'].map((n) => `<link rel="stylesheet" href="/static/storefront/assets/styles/${n}.css">`).join('')}
<style>
  html, body, .app { background: transparent !important; }
  .stage-bg, .brand, .fabs, .dock, .toast, .veil, .cart { visibility: hidden !important; }
  .cw canvas { transition: none !important; }
</style>
<script type="module" src="/tools/boot-capture.js"></script>
</head><body><main id="storefront"></main></body></html>`;

function startServer() {
  const server = spawn('.venv/bin/uvicorn', ['app.main:app', '--port', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, ...LOCAL_SERVER_ENV },
  });
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = async () => {
      try {
        await fetch(BASE);
        resolve(server);
      } catch {
        if (Date.now() - started > 10000) reject(new Error('O servidor de desenvolvimento não subiu.'));
        else setTimeout(poll, 150);
      }
    };
    poll();
  });
}

const f = (n) => n.toFixed(5);

async function render(browser, variant) {
  const page = await browser.newPage({ viewport: variant.viewport, deviceScaleFactor: variant.dpr, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => console.error(`[${variant.id}]`, error.message));
  await page.route(`${BASE}/__boot-capture.html*`, (route) => route.fulfill({ contentType: 'text/html', body: CAPTURE_PAGE }));
  const captureScript = await readFile(new URL('./boot-capture.js', import.meta.url), 'utf8');
  await page.route(`${BASE}/tools/boot-capture.js`, (route) => route.fulfill({ contentType: 'text/javascript', body: captureScript }));
  await page.goto(`${BASE}/__boot-capture.html`);
  await page.waitForFunction(() => window.bootCapture, null, { timeout: 180000 });
  await page.evaluate(() => window.bootCapture);
  await page.waitForTimeout(1500);

  const fridge = await page.evaluate(async () => (await window.bootCapture).fridgeRect());
  const x = Math.floor(fridge.left - fridge.width * PAD.x);
  const y = Math.floor(fridge.top - fridge.height * PAD.top);
  const clip = { x, y, width: Math.ceil(fridge.left + fridge.width * (1 + PAD.x)) - x, height: Math.ceil(fridge.top + fridge.height * (1 + PAD.bottom)) - y };
  const outline = await page.evaluate(async (n) => (await window.bootCapture).ledOutline(n), LED_POINTS);

  const shot = () => page.screenshot({ clip, omitBackground: true }).then((b) => `data:image/png;base64,${b.toString('base64')}`);
  const dark = await shot();
  await page.evaluate(async () => (await window.bootCapture).setPower({ led: 1 }));
  await page.waitForTimeout(400);
  const lit = await shot();

  // a imagem apagada vai como está; a do LED é a diferença entre acesa e apagada sobre preto
  const files = await page.evaluate(async ({ dark, lit, quality }) => {
    const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
    const [a, b] = await Promise.all([load(dark), load(lit)]);
    const c = document.createElement('canvas');
    c.width = a.naturalWidth;
    c.height = a.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(a, 0, 0);
    const darkUrl = c.toDataURL('image/webp', quality);
    const pa = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(b, 0, 0);
    const lb = x.getImageData(0, 0, c.width, c.height);
    const pb = lb.data;
    // luz pura: cor somada guardada sem pré-multiplicar, com a intensidade no alfa
    for (let i = 0; i < pb.length; i += 4) {
      const add = [0, 1, 2].map((k) => Math.max(0, (pb[i + k] * pb[i + 3]) / 255 - (pa[i + k] * pa[i + 3]) / 255));
      const alpha = Math.max(...add);
      for (let k = 0; k < 3; k++) pb[i + k] = alpha ? Math.round((add[k] * 255) / alpha) : 0;
      pb[i + 3] = alpha;
    }
    x.putImageData(lb, 0, 0);
    // a luz é macia: meia resolução basta
    const half = document.createElement('canvas');
    half.width = Math.round(c.width / 2);
    half.height = Math.round(c.height / 2);
    const hx = half.getContext('2d');
    hx.imageSmoothingQuality = 'high';
    hx.drawImage(c, 0, 0, half.width, half.height);
    const glowUrl = half.toDataURL('image/webp', quality);
    return { darkUrl, glowUrl, width: c.width, height: c.height };
  }, { dark, lit, quality: variant.quality });
  await page.close();

  const toBuffer = (url) => Buffer.from(url.split(',')[1], 'base64');
  const darkFile = `app/static/storefront/assets/loading/fridge-dark-${variant.id}.webp`;
  const glowFile = `app/static/storefront/assets/loading/fridge-glow-${variant.id}.webp`;
  await writeFile(new URL(`../${darkFile}`, import.meta.url), toBuffer(files.darkUrl));
  await writeFile(new URL(`../${glowFile}`, import.meta.url), toBuffer(files.glowUrl));

  const r = (n) => Math.round(n * 10) / 10;
  const pts = outline.map(([px, py]) => [px - clip.x, py - clip.y]);
  const path = `M${pts.map(([px, py]) => `${r(px)} ${r(py)}`).join('L')}Z`;

  // cobrinha: um cometa (degradê cônico) girando atrás da máscara da moldura. Só `transform`
  // anima, e o navegador o faz fora da thread principal: não engasga enquanto o 3D carrega.
  // Os pontos do contorno têm passo constante; o ângulo de cada um vira um quadro-chave da
  // rotação, então a cabeça anda à mesma velocidade inclusive nos cantos.
  const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
  const cy = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
  let prev = 0;
  const angles = pts.map(([px, py], i) => {
    let a = (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;
    if (i) while (a < prev - 180) a += 360;
    prev = a;
    return a;
  });
  const reach = Math.max(...pts.map(([px, py]) => Math.hypot(px - cx, py - cy))) + 14; // + halo
  const STEP = 4; // um quadro-chave a cada 4 pontos (90 por volta)
  const frames = [];
  for (let i = 0; i < pts.length; i += STEP) frames.push(`${f((i / pts.length) * 100)}% { transform: rotate(${(angles[i] - angles[0]).toFixed(2)}deg); }`);
  frames.push(`100% { transform: rotate(360deg); }`);
  const comet = { left: ((cx - reach) / clip.width) * 100, top: ((cy - reach) / clip.height) * 100, width: ((2 * reach) / clip.width) * 100, height: ((2 * reach) / clip.height) * 100, frames };
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${clip.width} ${clip.height}" preserveAspectRatio="none"><filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="${path}" stroke-width="6" stroke-opacity=".34" filter="url(#g)"/><path d="${path}" stroke-width="2.8"/></g></svg>`;
  await writeFile(new URL(`../app/static/storefront/assets/loading/led-ring-${variant.id}.svg`, import.meta.url), mask);
  return {
    ...variant,
    clip,
    width: files.width,
    height: files.height,
    darkBytes: toBuffer(files.darkUrl).length,
    glowBytes: toBuffer(files.glowUrl).length,
    // posição da geladeira dentro da imagem (frações), usada para levá-la ao lugar final
    fridge: [(fridge.left - clip.x) / clip.width, (fridge.top - clip.y) / clip.height, fridge.width / clip.width, fridge.height / clip.height],
    comet,
  };
}

const replaceBetween = (text, name, content) => {
  const start = `<!--${name}-->`;
  const end = `<!--/${name}-->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`Marcador ${name} não encontrado.`);
  return text.slice(0, a + start.length) + content + text.slice(b);
};
const replaceCss = (text, content) => {
  const a = text.indexOf('/* boot:size */');
  const b = text.indexOf('/* /boot:size */');
  if (a < 0 || b < a) throw new Error('Marcador boot:size não encontrado no boot.css.');
  return text.slice(0, a + '/* boot:size */'.length) + content + text.slice(b);
};

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = [];
  for (const variant of VARIANTS) results.push(await render(browser, variant));
  const [m, d] = results;

  const art = `<div class="boot__wipe"><div class="boot__wipe-in">
      <picture>
        <source media="(max-width: 1023px)" srcset="/static/storefront/assets/loading/fridge-dark-m.webp" width="${m.width}" height="${m.height}">
        <img class="boot__img boot__dark" src="/static/storefront/assets/loading/fridge-dark-d.webp" width="${d.width}" height="${d.height}" alt="" decoding="async" fetchpriority="high">
      </picture>
      <picture>
        <source media="(max-width: 1023px)" srcset="/static/storefront/assets/loading/fridge-glow-m.webp" width="${m.width}" height="${m.height}">
        <img class="boot__img boot__glow" src="/static/storefront/assets/loading/fridge-glow-d.webp" width="${d.width}" height="${d.height}" alt="" decoding="async" fetchpriority="low">
      </picture>
${results.map((v) => `      <div class="boot__led boot__led--${v.id}" aria-hidden="true"><div class="boot__worm"><i class="boot__comet"></i></div></div>`).join('\n')}
    </div></div>`;
  const indexUrl = new URL('../app/templates/loja.html', import.meta.url);
  let html = await readFile(indexUrl, 'utf8');
  html = replaceBetween(html, 'boot-art', art);
  html = html.replace(/data-fridge-m="[^"]*"/, `data-fridge-m="${m.fridge.map(f).join(' ')}"`).replace(/data-fridge-d="[^"]*"/, `data-fridge-d="${d.fridge.map(f).join(' ')}"`);
  await writeFile(indexUrl, html);

  const cssUrl = new URL('../app/static/storefront/assets/styles/boot.css', import.meta.url);
  const css = replaceCss(await readFile(cssUrl, 'utf8'), `
.boot__stage { --ar: ${f(d.clip.width / d.clip.height)}; --fw: ${f(d.fridge[2])}; --fh: ${f(d.fridge[3])}; }
@media (max-width: 1023px) { .boot__stage { --ar: ${f(m.clip.width / m.clip.height)}; --fw: ${f(m.fridge[2])}; --fh: ${f(m.fridge[3])}; } }
${results.map((v) => `.boot__led--${v.id} .boot__comet { left: ${f(v.comet.left)}%; top: ${f(v.comet.top)}%; width: ${f(v.comet.width)}%; height: ${f(v.comet.height)}%; animation-name: boot-orbit-${v.id}; }
@keyframes boot-orbit-${v.id} {
${v.comet.frames.map((k) => `  ${k}`).join('\n')}
}`).join('\n')}
`);
  await writeFile(cssUrl, css);

  for (const v of results) {
    console.log(`${v.id}: ${v.width}×${v.height}px  apagada ${(v.darkBytes / 1024).toFixed(1)} KB  LED ${(v.glowBytes / 1024).toFixed(1)} KB  geladeira ${v.fridge.map(f).join(' ')}`);
  }
} finally {
  await browser?.close();
  server.kill();
}
