// Etapa de pagamento da gaveta: QR do Pix, contagem até o prazo da cobrança, código copia e
// cola e, quando a cobrança termina, a tela final (paga, expirada, com falha ou cancelada).
//
// Enquanto o Pix está em aberto, o botão principal (ou o do campo do código) copia o código e
// o botão do cabeçalho (no lugar do "voltar") cancela em dois toques, como o "esvaziar" do
// carrinho. A contagem usa o prazo que o servidor devolveu, mostrada em dígitos (que só trocam
// de número) e num relógio de ponteiros (ui/payment-clock.js) atualizado a cada quadro, para o
// ponteiro dos segundos dar o tique com repique; com "reduzir movimento" o relógio muda só a
// cada segundo. Ao chegar a zero, a loja consulta a cobrança na hora (quem expira o pedido é
// o servidor).

import { disposables, prefersReducedMotion, replayClass } from '../core/dom.js';
import { formatMoney, formatUnits } from '../core/format.js';
import { createPaymentClock } from './payment-clock.js';
import { paymentResult } from './templates.js';

const CANCEL_CONFIRM_MS = 3200; // o mesmo anel de contagem do "esvaziar"
const COPIED_MS = 2200;
const STEADY_TICK_MS = 250; // com "reduzir movimento": os ponteiros andam por segundo, sem animação

const pad = (n) => String(n).padStart(2, '0');

/** @param {{ refs: Record<string, HTMLElement>, store: any, catalog: any[], actions: any }} opts */
export function createPaymentPage({ refs, store, catalog, actions }) {
  const d = disposables();
  const {
    drawer, cancelPay, payPage, payLive, payQr, payStatus, payClock, payTime, payState, payCode,
    payRow, payCopy, payResult, payCount, payTotal, payAction, payLabel,
  } = refs;
  const qr = /** @type {HTMLImageElement} */ (payQr);
  const card = /** @type {HTMLElement} */ (qr.parentElement);
  let chargeId = '';
  const smooth = !prefersReducedMotion();
  const dial = createPaymentClock(payClock, { steady: !smooth });
  let askedAtZero = false;
  let loop = 0;
  let ending = false;
  let checking = false;
  let cancelTimer = 0;
  let copiedTimer = 0;

  // ── cancelar em dois toques: o primeiro arma (✓ com anel de contagem), o segundo cancela
  d.listen(cancelPay, 'click', () => {
    const { payment, confirmingCancel, cancelling } = store.get();
    if (payment?.status !== 'pending' || cancelling) return;
    clearTimeout(cancelTimer);
    if (!confirmingCancel) {
      actions.setConfirmingCancel(true);
      cancelTimer = setTimeout(() => actions.setConfirmingCancel(false), CANCEL_CONFIRM_MS);
      return;
    }
    actions.cancelPayment();
  });

  // ── botão principal: copia o código (Pix em aberto) ou sai da tela final
  d.listen(payAction, 'click', () => {
    const { payment } = store.get();
    if (!payment) return;
    if (payment.status === 'pending') copyCode(payment.code);
    else actions.finishPayment();
  });
  d.listen(payCopy, 'click', () => {
    const { payment } = store.get();
    if (payment?.status === 'pending') copyCode(payment.code);
  });


  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      payAction.classList.add('is-confirmed');
      payRow.classList.add('is-confirmed');
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => [payAction, payRow].forEach((el) => el.classList.remove('is-confirmed')), COPIED_MS);
    } catch {
      // sem acesso à área de transferência: o código fica selecionado para copiar à mão
      getSelection()?.selectAllChildren(payCode);
      replayClass(payCode, 'is-attention');
      actions.notify('Não Foi Possível Copiar. Toque e Segure o Código Para Copiar.');
    }
  }

  // ── QR: aparece com uma revelação quando a imagem termina de carregar
  d.listen(qr, 'load', () => card.classList.add('is-ready'));
  d.listen(qr, 'error', () => card.classList.add('is-broken'));

  /** Nova cobrança: QR, código e totais dela. */
  function showCharge(payment) {
    chargeId = payment.id;
    askedAtZero = false;
    card.classList.remove('is-ready', 'is-broken');
    qr.src = payment.qr;
    payCode.textContent = payment.code;
    payTotal.textContent = formatMoney(payment.total);
    [payAction, payRow].forEach((el) => el.classList.remove('is-confirmed'));
  }

  // ── contagem até o prazo da cobrança: dígitos e relógio no mesmo quadro
  /** @returns {boolean} a cobrança ainda está em aberto (o laço continua) */
  function renderClock() {
    const { payment, paymentTrouble, cancelling } = store.get();
    if (payment?.status !== 'pending') return false;
    const left = payment.expiresAt === null ? null : Math.max(0, payment.expiresAt - Date.now());
    if (left !== null) {
      const seconds = Math.ceil(left / 1000);
      dial.set(smooth ? left : seconds * 1000);
      const text = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
      if (payTime.textContent !== text) payTime.textContent = text;
      if (ending !== seconds <= 60) payStatus.classList.toggle('is-ending', (ending = seconds <= 60));
      if (left === 0 && !askedAtZero) {
        askedAtZero = true;
        actions.checkPayment();
      }
    } else if (payStatus.classList.contains('is-ending')) {
      payStatus.classList.remove('is-ending');
      ending = false;
    }
    payStatus.classList.toggle('is-timeless', left === null);
    const waiting = paymentTrouble || left === 0;
    if (checking !== waiting) payStatus.classList.toggle('is-checking', (checking = waiting));
    const state = cancelling ? 'Cancelando' : waiting ? 'Verificando Pagamento' : 'Aguardando Pagamento';
    if (payState.textContent !== state) payState.textContent = state;
    return true;
  }

  function frame() {
    loop = 0;
    if (renderClock()) startLoop();
  }

  function startLoop() {
    if (!loop) loop = smooth ? requestAnimationFrame(frame) : setTimeout(frame, STEADY_TICK_MS);
  }

  function stopLoop() {
    if (smooth) cancelAnimationFrame(loop);
    else clearTimeout(loop);
    loop = 0;
  }

  function render(state, prev) {
    const { payment } = state;
    // sem cobrança (a pessoa saiu da etapa): a página fica como estava enquanto a gaveta troca
    // de etapa ou desce; a próxima cobrança refaz tudo
    if (!payment) {
      stopLoop();
      return;
    }
    if (payment.id !== chargeId) showCharge(payment);

    const pending = payment.status === 'pending';
    const done = !pending;
    if (!prev || payment.status !== prev.payment?.status || payment.id !== prev.payment?.id) {
      payPage.classList.toggle('is-done', done);
      payLive.inert = done;
      drawer.classList.toggle('is-paid', payment.status === 'paid');
      if (done) {
        // o que pegar na geladeira, com o nome do sabor como aparece na loja
        const items = payment.items.map(({ id, quantity }) => ({ quantity, name: catalog.find((f) => f.id === id)?.name ?? id }));
        payResult.innerHTML = paymentResult(payment.status, payment.number, items);
      }
      payCount.textContent = `${payment.status === 'paid' ? 'Total Pago' : 'Total'} · ${formatUnits(payment.count)}`;
      payLabel.textContent = pending ? 'Copiar Código Pix' : payment.status === 'paid' ? 'Concluir' : 'Voltar ao Carrinho';
      if (done) {
        payAction.classList.remove('is-confirmed');
        // o cancelar sumiu: o foco vai para a saída da tela final (o resultado é anunciado pela
        // região aria-live da tela final)
        if (drawer.contains(document.activeElement)) payAction.focus({ preventScroll: true });
      }
    }

    payPage.classList.toggle('is-cancelling', state.cancelling);
    cancelPay.disabled = !pending || state.cancelling;
    cancelPay.classList.toggle('is-confirming', state.confirmingCancel);
    cancelPay.setAttribute('aria-label', state.confirmingCancel ? 'Confirmar: cancelar o Pix' : 'Cancelar o Pix');
    if (!state.confirmingCancel) clearTimeout(cancelTimer);

    if (pending) {
      renderClock();
      startLoop();
    } else {
      stopLoop();
    }
  }

  render(store.get());
  d.add(store.subscribe(render));

  return {
    destroy() {
      stopLoop();
      [cancelTimer, copiedTimer].forEach(clearTimeout);
      d.dispose();
    },
  };
}
