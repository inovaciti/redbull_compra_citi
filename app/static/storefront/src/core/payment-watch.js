// Acompanhamento de uma cobrança Pix: consulta a situação em intervalos até ela terminar
// (paga, expirada, falha ou cancelada). Uma consulta por vez; resposta que chega depois de
// `stop()` é descartada, então uma cobrança antiga nunca mexe na tela de uma nova.

const TERMINAL = new Set(['paid', 'expired', 'failed', 'cancelled']);

export const isTerminal = (status) => TERMINAL.has(status);

/**
 * @param {{
 *   check: () => Promise<{ status: string }>,
 *   onUpdate: (charge: any) => void,
 *   onTrouble: (failing: boolean) => void,
 *   interval?: number,
 * }} opts
 *   `onUpdate`: a cada resposta · `onTrouble(true)`: a consulta falhou (segue tentando);
 *   `onTrouble(false)`: voltou a responder
 */
export function watchPayment({ check, onUpdate, onTrouble, interval = 2500 }) {
  let stopped = false;
  let busy = false;
  let again = false; // pedido de consulta imediata durante uma consulta em andamento
  let failing = false;
  let timer = 0;

  async function poll() {
    clearTimeout(timer);
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    let done = false;
    try {
      const charge = await check();
      if (stopped) return;
      if (failing) onTrouble((failing = false));
      onUpdate(charge);
      done = isTerminal(charge.status);
    } catch {
      if (stopped) return;
      if (!failing) onTrouble((failing = true));
    } finally {
      busy = false;
    }
    if (done) {
      stopped = true;
      return;
    }
    if (again) {
      again = false;
      poll();
    } else {
      timer = setTimeout(poll, interval);
    }
  }

  timer = setTimeout(poll, interval);

  return {
    /** Consulta agora (ex.: a pessoa voltou do app do banco ou a contagem chegou a zero). */
    now: poll,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
