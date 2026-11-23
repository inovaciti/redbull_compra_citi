// Identificação do comprador: validação do e-mail, situação de membro do CITi e arrumação dos
// nomes. Os preços não ficam aqui: vêm da tabela fixa do back-end (src/pricing.js), que também
// decide o público pelo e-mail ao criar o pedido.

/** Domínio de e-mail dos membros do CITi (o mesmo de `pricing_audience_for_email` no back-end). */
export const MEMBER_DOMAIN = 'citi.org.br';

/**
 * Tamanho máximo de cada parte do nome. O pedido guarda "Nome Sobrenome" em `buyer_name`, que
 * tem no máximo 80 caracteres no back-end: 40 + espaço + 39.
 */
export const NAME_MAX = Object.freeze({ firstName: 40, lastName: 39 });

// parte local e domínio no formato aceito pelos navegadores (sem pontos nas pontas ou repetidos)
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** E-mail bem formado: algo@dominio.tld (com TLD de pelo menos duas letras). */
export function isValidEmail(value) {
  const email = String(value ?? '').trim();
  if (email.length > 254) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at !== email.indexOf('@')) return false;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  return local.length <= 64
    && LOCAL.test(local)
    && labels.length >= 2
    && labels.every((label) => LABEL.test(label))
    && /^[A-Za-z]{2,}$/.test(labels[labels.length - 1]);
}

/**
 * Situação do e-mail digitado.
 * @returns {'empty' | 'invalid' | 'member' | 'guest'}
 */
export function emailStatus(value, domain = MEMBER_DOMAIN) {
  const email = String(value ?? '').trim();
  if (!email) return 'empty';
  if (!isValidEmail(email)) return 'invalid';
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase() === domain.toLowerCase() ? 'member' : 'guest';
}

const NAME_CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
// início de palavra: começo do texto, ou depois de espaço, hífen ou apóstrofo ("Ana-Maria", "D'Ávila")
const WORD_START = /(^|[\s'-])(\p{L})/gu;
const upperFirst = (text) => text.replace(WORD_START, (_, sep, letter) => sep + letter.toLocaleUpperCase('pt-BR'));

/**
 * Nome enquanto é digitado: cada palavra começa em maiúscula (a primeira letra do campo sempre)
 * e um conectivo já terminado (seguido de espaço), fora da primeira palavra, fica em minúscula.
 * Só troca letras por letras: o tamanho não muda e o cursor fica onde estava.
 */
export function capitalizeTyping(value) {
  const typed = upperFirst(String(value ?? ''));
  return typed.replace(/(\S+)(?=\s)/gu, (word, _, offset) =>
    (/\S/.test(typed.slice(0, offset)) && NAME_CONNECTORS.has(word.toLocaleLowerCase('pt-BR'))
      ? word.toLocaleLowerCase('pt-BR')
      : word));
}

/**
 * Nome como vai no pedido (e como fica no campo ao sair dele): espaços normalizados, iniciais
 * maiúsculas e conectivos (da, de…) em minúscula. A primeira palavra é sempre maiúscula, também
 * no sobrenome ("Da Silva").
 */
export function tidyName(value) {
  const words = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
    .split(' ');
  return words
    .map((word, i) => (i > 0 && i < words.length - 1 && NAME_CONNECTORS.has(word) ? word : upperFirst(word)))
    .join(' ');
}
