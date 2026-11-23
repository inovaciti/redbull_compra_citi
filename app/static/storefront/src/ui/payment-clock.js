// Relógio do prazo do Pix: lê o tempo que resta como um relógio de verdade lê "mm:ss".
// O ponteiro dos minutos aponta os minutos que restam (numa volta de 60), o dos segundos aponta
// os segundos, e o setor claro vai do 12 até o ponteiro dos minutos: o tempo que sobra. Os dois
// ponteiros caminham para trás até se encontrarem no 12, no instante em que o prazo acaba.
//
// O ponteiro dos segundos anda como o de um relógio de quartzo: fica parado, salta um passo a
// cada segundo e dá um leve repique (mola subamortecida) antes de assentar. O dos minutos desliza
// sem parar, bem devagar. Sem animação ("reduzir movimento"), os ponteiros só trocam de lugar a
// cada segundo, sem o salto nem o repique.
//
// A marcação vem de `clockFace()` (ui/templates.js); aqui só se movem os ponteiros e o setor.

const CENTER = 24;
const WEDGE_RADIUS = 14.2;
const DEGREES_PER_STEP = 6; // um minuto no ponteiro dos minutos, um segundo no dos segundos

// O repique do tique: a posição anterior (+6°) cai para a nova passando um pouco do ponto
// (~38%, uns 2°) e assentando em ~0,3 s.
const TICK_DECAY_MS = 80;
const TICK_HZ = 6.5;

/** Setor do círculo do 12 até `degrees` (no sentido horário), como caminho SVG; '' se vazio. */
function wedgePath(degrees) {
  const r = WEDGE_RADIUS;
  if (degrees < 0.3) return '';
  if (degrees > 359.7) return `M${CENTER} ${CENTER - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}z`;
  const angle = (degrees * Math.PI) / 180;
  const x = (CENTER + r * Math.sin(angle)).toFixed(2);
  const y = (CENTER - r * Math.cos(angle)).toFixed(2);
  return `M${CENTER} ${CENTER}V${CENTER - r}A${r} ${r} 0 ${degrees > 180 ? 1 : 0} 1 ${x} ${y}z`;
}

/**
 * Ângulo do ponteiro dos segundos: parado no segundo que o contador mostra, mais o que ainda
 * falta do salto e do repique desde o último tique (`sinceTickMs`, de 0 a 999).
 */
function secondAngle(wholeSeconds, sinceTickMs, steady) {
  const rest = (wholeSeconds % 60) * DEGREES_PER_STEP;
  if (steady) return rest;
  const spring = Math.exp(-sinceTickMs / TICK_DECAY_MS) * Math.cos(2 * Math.PI * TICK_HZ * (sinceTickMs / 1000));
  return rest + DEGREES_PER_STEP * spring;
}

/**
 * @param {HTMLElement} root elemento que contém o SVG de `clockFace()`
 * @param {{ steady?: boolean }} [options] `steady`: sem salto nem repique (reduzir movimento)
 */
export function createPaymentClock(root, { steady = false } = {}) {
  const part = (role) => /** @type {SVGElement} */ (root.querySelector(`[data-role="${role}"]`));
  const minute = part('minute');
  const second = part('second');
  const wedge = part('wedge');
  let drawn = '';

  return {
    /** Põe os ponteiros no tempo que resta, em milissegundos. */
    set(leftMs) {
      const ms = Math.max(0, leftMs);
      const whole = Math.ceil(ms / 1000); // o segundo que o contador mostra
      const minuteAngle = Math.min(ms / 60000, 60) * DEGREES_PER_STEP;
      const secondsAngle = secondAngle(whole, whole * 1000 - ms, steady);
      const key = `${minuteAngle.toFixed(2)}|${secondsAngle.toFixed(2)}`;
      if (key === drawn) return;
      drawn = key;
      minute.setAttribute('transform', `rotate(${minuteAngle.toFixed(2)} ${CENTER} ${CENTER})`);
      second.setAttribute('transform', `rotate(${secondsAngle.toFixed(2)} ${CENTER} ${CENTER})`);
      wedge.setAttribute('d', wedgePath(minuteAngle));
    },
  };
}
