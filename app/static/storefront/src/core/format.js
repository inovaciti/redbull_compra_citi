const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 9.9 → "R$ 9,90" */
export const formatMoney = (value) => currency.format(value);

/** Quantidade com sufixo de unidade: 3 → "3 Un." */
export const formatUnits = (count) => `${count} Un.`;

const CONNECTORS = /^(E|DE|DA|DO|DAS|DOS)$/;

/**
 * Quebra o nome do sabor em até duas linhas equilibradas, em caixa alta.
 * Conectivos (e, de, da…) ficam presos à palavra seguinte.
 * "Morango e Pêssego" → ["MORANGO", "E PÊSSEGO"]
 */
export function splitNameLines(name) {
  if (/^sugar\s*free$/i.test(name.trim())) return ['SUGAR FREE'];

  const words = name.toUpperCase().split(/\s+/);
  const units = [];
  for (let i = 0; i < words.length; i++) {
    if (CONNECTORS.test(words[i]) && i < words.length - 1) words[i + 1] = `${words[i]} ${words[i + 1]}`;
    else units.push(words[i]);
  }
  if (units.length <= 1) return units;

  let best = null;
  for (let k = 1; k < units.length; k++) {
    const a = units.slice(0, k).join(' ');
    const b = units.slice(k).join(' ');
    const longest = Math.max(a.length, b.length);
    if (!best || longest < best.longest) best = { longest, lines: [a, b] };
  }
  return best.lines;
}

/**
 * Cor de brilho derivada da cor da lata: mesma matiz, clareada o bastante
 * para ter contraste sobre o fundo preto.
 */
export function glowColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }

  const lightness = Math.max(l, 0.66);
  const saturation = l < 0.66 ? Math.max(s, 0.32) : s;
  return `hsl(${Math.round(h)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
}
