// Sugestão de correção do e-mail, na hora, sem enviar nada a lugar nenhum: compara o domínio
// digitado com os provedores mais usados (e com o do CITi) e aponta erros de digitação comuns
// ("gmial.com", "hotmail.con", "citi.org", "joao@gmail"). Só sugere; quem decide é a pessoa.

import { MEMBER_DOMAIN, isValidEmail } from './membership.js';

// Domínios conhecidos. Ficam de fora os curtos (me.com, msn.com, live.com…): a um erro de
// distância deles há domínios reais demais, e a sugestão viraria palpite.
const KNOWN_DOMAINS = [
  MEMBER_DOMAIN,
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
  'yahoo.com', 'yahoo.com.br', 'icloud.com', 'uol.com.br', 'bol.com.br', 'terra.com.br',
  'ig.com.br', 'globo.com', 'globomail.com', 'protonmail.com', 'proton.me',
];
const KNOWN = new Set(KNOWN_DOMAINS);

// Finais trocados por engano em qualquer domínio (".con" no lugar de ".com"…)
const TLD_FIXES = [
  [/\.(con|cpm|cmo|ocm|vom|xom|comm|coom|ccom|cim|cok)$/, '.com'],
  [/\.(con|cpm|cmo|ocm|vom|xom|comm|cim)\.br$/, '.com.br'],
  [/\.combr$/, '.com.br'],
  [/\.(og|ogr|rog|orgg)\.br$/, '.org.br'],
  [/\.orgbr$/, '.org.br'],
  [/\.com\.(bt|vr|brr)$/, '.com.br'],
];

/** Distância de edição com transposição (Damerau–Levenshtein restrita), parando acima de `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prev2[j - 2] + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/** Domínio conhecido mais parecido com `domain` (erro de digitação), ou null. */
function closestKnown(domain) {
  // sem o final: "joao@gmail", "joao@citi"
  if (!domain.includes('.')) {
    const match = KNOWN_DOMAINS.find((known) => distance(domain, known.split('.')[0], domain.length > 4 ? 1 : 0) <= (domain.length > 4 ? 1 : 0));
    return match ?? null;
  }
  // faltou o ".br": "citi.org", "uol.com"
  if (KNOWN.has(`${domain}.br`)) return `${domain}.br`;
  // um erro (dois nos domínios maiores): "gmial.com", "hotmial.com", "citi.ogr.br"
  const max = domain.length >= 10 ? 2 : 1;
  let best = null;
  let bestDistance = max + 1;
  for (const known of KNOWN_DOMAINS) {
    const d = distance(domain, known, max);
    if (d < bestDistance) [best, bestDistance] = [known, d];
  }
  return best;
}

/**
 * E-mail provavelmente pretendido, quando o digitado parece ter erro de digitação no domínio;
 * null quando está certo, quando não há palpite seguro ou quando a parte antes do @ é inválida.
 */
export function suggestEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at !== email.indexOf('@')) return null;
  const local = email.slice(0, at);
  let domain = email.slice(at + 1).replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.').replace(/,/g, '.');
  if (!domain || KNOWN.has(domain)) return null;
  for (const [pattern, fix] of TLD_FIXES) domain = domain.replace(pattern, fix);
  const fixed = KNOWN.has(domain) ? domain : closestKnown(domain) ?? domain;
  const suggestion = `${local}@${fixed}`;
  return suggestion !== email && isValidEmail(suggestion) ? suggestion : null;
}
