// Vidro líquido: refração real via filtro SVG dentro de backdrop-filter (Chromium),
// com aro de luz calculado por campo de distância e física de toque por molas.
// Fora do Chromium o vidro cai para blur + saturação, mantendo aro e brilho.
//
// Uso:
//   const glass = liquidGlass();
//   const off = glass.surface(el, root); // el precisa dos filhos .lg-lens e .lg-rim (e opcionalmente .lg-fb)
//   const offTouch = glass.interact(el); // inclinação/brilho seguindo o ponteiro
// Parâmetros por elemento via data-attributes: data-refr, data-bz, data-disp, data-lift.

let engine = null;

/** Retorna a instância única do motor (filtros SVG são compartilhados entre superfícies iguais). */
export function liquidGlass() {
  if (!engine) engine = createEngine();
  return engine;
}

function createEngine() {
  const NS = 'http://www.w3.org/2000/svg';
  const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const ua = navigator.userAgent || '';
  // só o Chromium aplica filtros SVG dentro de backdrop-filter; nos outros o vidro cai para blur + saturação, mantendo aro e brilho
  // modo leve (html.is-lite, aparelho fraco): sem a refração SVG, a parte mais cara do vidro
  const refractOK = /(Chrome|Chromium|Edg|SamsungBrowser)\/\d+/.test(ua) && !/Firefox\//.test(ua)
    && !document.documentElement.classList.contains('is-lite');
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const calm = () => !!(mq && mq.matches);
  const dpr = () => Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const COS_SPREAD = Math.cos(1.08), COS_DIFFUSE = Math.cos(1.08 * 0.65), COS_SIDE = Math.cos(0.98);

  // distância assinada + normal externa de um retângulo arredondado (cápsula ou círculo), coordenadas centradas
  const sdf = (px, py, hw, hh, r) => {
    const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1e-6; return [l - r, (qx / l) * (px < 0 ? -1 : 1), (qy / l) * (py < 0 ? -1 : 1)]; }
    if (qx > qy) return [qx - r, px < 0 ? -1 : 1, 0];
    return [qy - r, 0, py < 0 ? -1 : 1];
  };

  // os mapas só dependem do tamanho, do raio, da borda e da densidade da tela: superfícies iguais
  // e tamanhos que voltam (ex.: "Adicionar" → "Adicionado" → "Adicionar") reaproveitam o resultado
  const planesCache = new Map();
  const PLANES_CACHE_MAX = 48;
  const planes = (w, h, r, bz) => {
    const key = [w, h, r, bz, dpr()].join('|');
    let P = planesCache.get(key);
    if (P) { planesCache.delete(key); planesCache.set(key, P); return P; }
    P = drawPlanes(w, h, r, bz);
    planesCache.set(key, P);
    if (planesCache.size > PLANES_CACHE_MAX) planesCache.delete(planesCache.keys().next().value);
    return P;
  };

  // mapa de deslocamento (a lente dobra a luz só na borda) + plano de luz de aro (brilho em cima/embaixo, sombra nas laterais)
  const drawPlanes = (w, h, r, bz) => {
    const k = dpr(), pad = 2;
    // canvas na CPU (willReadFrequently): virar PNG não espera a GPU, ocupada com a geladeira 3D
    const mk = (cw, ch) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k)); const x = c.getContext('2d', { willReadFrequently: true }); return [c, x, x.createImageData(c.width, c.height)]; };
    const [fc, fx, fi] = mk(w, h), [oc, ox, oi] = mk(w + pad * 2, h + pad * 2);
    const hw = w / 2, hh = h / 2, bw = w + pad * 2, bh = h + pad * 2;
    for (let j = 0; j < fc.height; j++) for (let i = 0; i < fc.width; i++) {
      const o = (j * fc.width + i) * 4, [d, nx, ny] = sdf((i + 0.5) / k - hw, (j + 0.5) / k - hh, hw, hh, r);
      if (d < -(bz + 4)) { fi.data[o] = fi.data[o + 1] = fi.data[o + 2] = 128; fi.data[o + 3] = 255; continue; }
      const depth = sat(-d / bz), edge = 1 - sat(Math.sqrt((2 - depth) * depth));
      fi.data[o] = Math.round(255 * (0.5 - nx * edge * 0.5)); fi.data[o + 1] = Math.round(255 * (0.5 - ny * edge * 0.5)); fi.data[o + 2] = 128; fi.data[o + 3] = Math.round(255 * sat(0.5 - d));
    }
    fx.putImageData(fi, 0, 0);
    for (let j = 0; j < oc.height; j++) for (let i = 0; i < oc.width; i++) {
      const o = (j * oc.width + i) * 4, [d, nx, ny] = sdf((i + 0.5) / k - bw / 2, (j + 0.5) / k - bh / 2, hw, hh, r);
      if (d > pad + 6 || d < -6) continue;
      const coverage = sat(0.5 - d);
      const directional = Math.pow(sat((Math.abs(ny) - COS_SPREAD) / (1 - COS_SPREAD)), 1.25);
      const diffuseDir = Math.pow(sat((Math.abs(ny) - COS_DIFFUSE) / (1 - COS_DIFFUSE)), 1.25);
      const stroke = sat(d + 1.4) * sat(0.5 - d);
      let spec = directional * stroke; spec = spec / (1 + 0.5 * (1 - spec));
      const diffuse = diffuseDir * 0.18 * Math.pow(1 - sat(-d / 4.5), 2) * coverage;
      const hl = sat(spec * 0.82 + diffuse * 0.4);
      const adj = d - 0.5, fall = 1 - sat(-adj / 0.5), ramp = (fall > 0 ? 1 : 0) * 0.25 + fall * 0.75;
      const band = ramp * sat(adj + 1) * sat(0.5 - adj);
      const wx = sat((nx - COS_SIDE) / (1 - COS_SIDE)) * band, wy = sat((-nx - COS_SIDE) / (1 - COS_SIDE)) * band;
      const shade = (wx / (1 + 0.4 * (1 - wx)) + wy / (1 + 0.4 * (1 - wy))) * 0.6;
      const alpha = hl + shade * (1 - hl);
      if (alpha <= 0.002) continue;
      oi.data[o] = oi.data[o + 1] = oi.data[o + 2] = Math.round(255 * Math.min(1, (0.82 * hl) / Math.max(alpha, 1e-5))); oi.data[o + 3] = Math.round(255 * alpha);
    }
    ox.putImageData(oi, 0, 0);
    return { field: fc.toDataURL('image/png'), overlay: oc.toDataURL('image/png') };
  };

  // curva de tom do vidro escuro: levanta um pouco os pretos e comprime os brancos (lift ajusta a força)
  const toneCache = {};
  const tone = (lift) => toneCache[lift] || (toneCache[lift] = (() => { const v = []; for (let n = 0; n <= 32; n++) { const t = n / 32, tn = t + 0.15 * lift * Math.pow(1 - t, 3) - 0.2 * Math.pow(t, 3), tinted = 0.38 * t + 0.2; v.push(Math.max(0, Math.min(1, 0.86 * tn + 0.14 * tinted)).toFixed(5)); } return v.join(' '); })());

  // filtros compartilhados: mesma geometria = um único <filter>
  let host = null; const fl = new Map();
  const getHost = (root) => {
    if (host && host.isConnected) return host;
    host = document.createElementNS(NS, 'svg'); host.setAttribute('aria-hidden', 'true'); host.setAttribute('width', '0'); host.setAttribute('height', '0');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'; document.body.appendChild(host); return host;
  };
  const grab = (root, id, mk) => {
    const e = fl.get(id); if (e) { e.n++; return; }
    const f = document.createElementNS(NS, 'filter'); f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB'); f.innerHTML = mk();
    getHost(root).appendChild(f); fl.set(id, { f, n: 1 });
  };
  const drop = (id) => { const e = fl.get(id); if (e && --e.n <= 0) { e.f.remove(); fl.delete(id); } };

  // uma superfície de vidro: lente (refração) + aro de luz
  const surface = (el, root) => {
    const lens = el.querySelector(':scope > .lg-lens'), rim = el.querySelector(':scope > .lg-rim'), fb = el.querySelector(':scope > .lg-fb');
    if (!lens || !rim) return () => {};
    const refr = +(el.dataset.refr || 14), bzo = +(el.dataset.bz || 0), lift = +(el.dataset.lift || 1), disp = +(el.dataset.disp || 0);
    let held = '', key = '', raf = 0, dead = false;
    const build = () => {
      raf = 0; if (dead) return;
      const w = Math.round(lens.offsetWidth), h = Math.round(lens.offsetHeight); if (w < 4 || h < 4) return;
      const rs = getComputedStyle(lens).borderTopLeftRadius || '', rn = parseFloat(rs);
      const r = Math.max(1, Math.min(isNaN(rn) ? h / 2 : (rs.indexOf('%') > 0 ? (rn / 100) * Math.min(w, h) : rn), w / 2, h / 2));
      const bz = Math.max(2, Math.round(bzo || Math.min(32, Math.min(w, h) / 2)));
      const k = [w, h, Math.round(r), bz, refr, lift, disp, dpr()].join('|'); if (k === key) return; key = k;
      const P = planes(w, h, r, bz);
      rim.style.backgroundImage = 'url(' + P.overlay + ')'; if (fb) fb.style.display = 'none';
      if (!refractOK) return;
      const id = 'lgf' + [w, h, Math.round(r), bz, refr, lift, disp].join('-').replace(/\./g, 'p'), TB = tone(lift), s2 = refr * 2;
      const dm = (sc, res) => '<feDisplacementMap in="SourceGraphic" in2="field" scale="' + sc + '" xChannelSelector="R" yChannelSelector="G" result="' + res + '"/>';
      const ch = (src, vals, res) => '<feColorMatrix in="' + src + '" type="matrix" values="' + vals + '" result="' + res + '"/>';
      // com dispersão a luz se separa em R, G e B na borda (franja prismática); sem ela, uma dobra só
      const bend = disp > 0
        ? dm(s2 * (1 + disp), 'dr') + dm(s2, 'dg') + dm(s2 * (1 - disp), 'db')
          + ch('dr', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'r') + ch('dg', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'g') + ch('db', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'b')
          + '<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen" result="refracted"/>'
        : dm(s2, 'refracted');
      grab(root, id, () => '<feImage href="' + P.field + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="field"/>' + bend
        + '<feComponentTransfer in="refracted" result="tone"><feFuncR type="table" tableValues="' + TB + '"/><feFuncG type="table" tableValues="' + TB + '"/><feFuncB type="table" tableValues="' + TB + '"/></feComponentTransfer>'
        + '<feComposite in="tone" in2="field" operator="in"/>');
      if (held && held !== id) drop(held); held = id;
      const v = 'url(#' + id + ')'; lens.style.backdropFilter = v; lens.style.webkitBackdropFilter = v;
    };
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(build); });
    ro.observe(lens); build();
    return () => { dead = true; ro.disconnect(); cancelAnimationFrame(raf); if (held) drop(held); };
  };

  // molas do vidro: aperta, cresce, devolve com ressalto; o brilho acompanha o dedo
  const SPR = { press: { duration: 0.24, bounce: 0.2 }, release: { duration: 0.5, bounce: 0.42 }, glow: { duration: 0.42, bounce: 0 }, track: { duration: 0.18, bounce: 0 } };
  class Sp {
    constructor(v, o) { this.value = v; this.target = v; this.velocity = 0; this.cfg(o); }
    cfg({ duration, bounce }) { const om = (2 * Math.PI) / duration; this.k = om * om; this.c = bounce >= 0 ? (4 * Math.PI * (1 - bounce)) / duration : (4 * Math.PI) / (duration * (1 + bounce)); return this; }
    get settled() { return this.value === this.target && this.velocity === 0; }
    step(dt) {
      if (this.settled || !(dt > 0)) return this;
      const om = Math.sqrt(this.k), z = this.c / (2 * om), x0 = this.value - this.target, v0 = this.velocity; let x, v;
      if (z < 1) { const wd = om * Math.sqrt(1 - z * z), dc = Math.exp(-z * om * dt), b = (v0 + z * om * x0) / wd, cs = Math.cos(wd * dt), sn = Math.sin(wd * dt); x = dc * (x0 * cs + b * sn); v = dc * ((b * wd - z * om * x0) * cs - (x0 * wd + z * om * b) * sn); }
      else if (z === 1) { const dc = Math.exp(-om * dt), b = v0 + om * x0; x = dc * (x0 + b * dt); v = dc * (b - om * (x0 + b * dt)); }
      else { const rt = om * Math.sqrt(z * z - 1), r1 = -z * om + rt, r2 = -z * om - rt, c2 = (v0 - r1 * x0) / (r2 - r1), c1 = x0 - c2, e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt); x = c1 * e1 + c2 * e2; v = c1 * r1 * e1 + c2 * r2 * e2; }
      const sc = Math.max(1, Math.abs(this.target), Math.abs(x0));
      if (Math.abs(x) < 1e-4 * sc && Math.abs(v) < 1e-3 * sc) { this.value = this.target; this.velocity = 0; } else { this.value = this.target + x; this.velocity = v; }
      return this;
    }
  }
  const band = (o, lim, c = 0.55) => (lim <= 0 ? 0 : Math.sign(o) * lim * (1 - 1 / ((Math.abs(o) * c) / lim + 1)));

  const interact = (el) => {
    const tx = new Sp(0, SPR.track), ty = new Sp(0, SPR.track), pr = new Sp(0, SPR.press), gl = new Sp(0, SPR.glow);
    let ptr = null, kb = false, hov = false, prev = 0, wrote = false, gx = 0, gy = 0, raf = 0, awake = false;
    const put = (n, v) => { if (el.style.getPropertyValue(n) !== v) el.style.setProperty(n, v); };
    const dims = () => ({ w: el.offsetWidth || 1, h: el.offsetHeight || 1 });
    const lay = () => { const r = el.getBoundingClientRect(), d = dims(); return { cx: r.left + r.width / 2 - tx.value, cy: r.top + r.height / 2 - ty.value, w: d.w, h: d.h, r }; };
    const light = (x, y) => { const { r, w, h } = lay(); gx = ((x - r.left) * w) / (r.width || 1); gy = ((y - r.top) * h) / (r.height || 1); };
    const aim = (s, t, o) => { s.cfg(o).target = t; };
    const mv = (e) => { if (ptr && e.pointerId === ptr.id) { ptr.X = e.clientX; ptr.Y = e.clientY; } };
    const up = (e) => {
      if (e && (!ptr || e.pointerId !== ptr.id)) return; ptr = null;
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      aim(pr, 0, SPR.release); aim(tx, 0, SPR.release); aim(ty, 0, SPR.release); aim(gl, hov ? 0.35 : 0, SPR.glow); wake();
    };
    const down = (e) => {
      if (e.button !== 0 || el.disabled) return;
      const { cx, cy, w, h } = lay(); ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, X: e.clientX, Y: e.clientY, cx, cy };
      light(e.clientX, e.clientY); aim(pr, 1, SPR.press); aim(gl, 1, SPR.press);
      const f = { duration: SPR.track.duration + 0.0005 * Math.max(w, h), bounce: 0 }; aim(tx, 0, f); aim(ty, 0, f);
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); wake();
    };
    const hover = (e) => {
      if (e.pointerType === 'touch' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      hov = e.type !== 'pointerleave'; if (hov) light(e.clientX, e.clientY);
      if (!ptr && !kb) aim(gl, hov ? 0.35 : 0, SPR.glow); wake();
    };
    const key = (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (e.type === 'keydown') { if (e.repeat || el.disabled || ptr) return; kb = true; const d = dims(); gx = d.w / 2; gy = d.h / 2; aim(pr, 1, SPR.press); aim(gl, 1, SPR.press); wake(); }
      else if (kb) { kb = false; aim(pr, 0, SPR.release); aim(gl, hov ? 0.35 : 0, SPR.glow); wake(); }
    };
    const blur = () => { if (kb) { kb = false; aim(pr, 0, SPR.release); aim(gl, 0, SPR.glow); wake(); } };
    const frame = (now) => {
      const dt = prev ? Math.max(0, Math.min(0.05, (now - prev) / 1000)) : 1 / 60; prev = now;
      const { w, h } = dims(), big = Math.max(w, h);
      if (ptr) {
        const { cx, cy } = lay(), small = big <= 72;
        const ox = small ? ptr.X - ptr.x - (cx - ptr.cx) : ptr.X - Math.max(cx - w / 2, Math.min(cx + w / 2, ptr.X));
        const oy = small ? ptr.Y - ptr.y - (cy - ptr.cy) : ptr.Y - Math.max(cy - h / 2, Math.min(cy + h / 2, ptr.Y));
        const lim = small ? 4 + 0.15 * big : Math.min(10, 3 + 0.04 * big);
        tx.target = band(ox, lim); ty.target = band(oy, lim); light(ptr.X, ptr.Y);
      }
      for (const s of [tx, ty, pr, gl]) s.step(dt);
      const el0 = !calm();
      const grow = el0 ? Math.min(0.16, 8 / big) * pr.value : 0, cap = big <= 72 ? 0.2 : 0.12;
      const ex = el0 ? Math.min(cap, (0.5 * Math.abs(tx.value)) / w + 0.00007 * Math.abs(tx.velocity)) : 0;
      const ey = el0 ? Math.min(cap, (0.5 * Math.abs(ty.value)) / h + 0.00007 * Math.abs(ty.velocity)) : 0;
      const sx = ((1 + grow) * (1 + ex)) / Math.sqrt(1 + ey), sy = ((1 + grow) * (1 + ey)) / Math.sqrt(1 + ex);
      const moved = el0 && (Math.abs(tx.value) > 0.01 || Math.abs(ty.value) > 0.01), scaled = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4, lit = gl.value > 0.001;
      if (moved || scaled || lit || ptr || kb || Math.abs(pr.value) > 0.001) {
        wrote = true;
        put('translate', moved ? tx.value.toFixed(3) + 'px ' + ty.value.toFixed(3) + 'px' : 'none'); put('scale', scaled ? sx.toFixed(5) + ' ' + sy.toFixed(5) : 'none');
        put('--gl', lit ? gl.value.toFixed(4) : '0'); put('--gl-x', gx.toFixed(2) + 'px'); put('--gl-y', gy.toFixed(2) + 'px');
        put('--gl-s', Math.max(36, Math.min(180, big * 0.9)).toFixed(1) + 'px'); put('--pr', pr.value.toFixed(4));
      } else if (wrote) {
        wrote = false; el.style.removeProperty('translate'); el.style.removeProperty('scale');
        for (const n of ['--gl', '--gl-x', '--gl-y', '--gl-s', '--pr']) el.style.removeProperty(n);
      }
      const live = !!ptr || [tx, ty, pr, gl].some((s) => !s.settled); if (!live) prev = 0; return live;
    };
    const loop = (now) => { if (frame(now)) raf = requestAnimationFrame(loop); else awake = false; };
    const wake = () => { if (!awake) { awake = true; raf = requestAnimationFrame(loop); } };
    const on = [['pointerdown', down], ['pointerenter', hover], ['pointermove', hover], ['pointerleave', hover], ['keydown', key], ['keyup', key], ['focusout', blur]];
    on.forEach(([n, f]) => el.addEventListener(n, f));
    return () => {
      up(); cancelAnimationFrame(raf); awake = false; on.forEach(([n, f]) => el.removeEventListener(n, f));
      el.style.removeProperty('translate'); el.style.removeProperty('scale');
    };
  };

  return { surface, interact };
}
