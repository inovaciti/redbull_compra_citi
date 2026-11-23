# Refatoração total do frontend

Documento de trabalho da troca completa da interface (PDV e painel de estoque). A lógica de pagamento, a API de pedidos e o banco **não mudam**: a interface nova se encaixa no contrato descrito abaixo.

**Regra de ouro:** cada peça da interface nova que entra remove, na mesma entrega, o equivalente legado. Nada de código comentado, de adaptadores temporários nem de arquivo "para depois". Quando a refatoração terminar, este arquivo deve ser apagado (o contrato pode migrar para o `README.md`).

## 1. Fases

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Loja nova em `/` (geladeira 3D, carrossel, carrinho) com produtos, estoque e preços reais; público do preço pelo e-mail; responsivo | **Concluída em 2026-11-18** |
| 1b | Geladeira e latas 3D trocadas pelo Mini Cooler do `Kit_Mini_Cooler_3D.zip` (seção 10), com toda a interação da fase 1 | **Concluída em 2026-11-18** |
| 2a | Identificação do comprador na gaveta do carrinho (pacote `identificacao-carrinho.zip`, seção 13), com inicial maiúscula nos nomes, sugestão de correção do e-mail e comprador lembrado no aparelho | **Concluída em 2026-11-18** |
| 2b | Pix na mesma gaveta (QR, copiar, contagem, cancelar), telas finais (pago, expirado, falha, cancelado) e erros, ligados à API de pedidos (seção 14) | **Concluída em 2026-11-19** |
| 3 | Painel `/estoque` no design novo | A fazer |

**Antes do deploy:** a loja já fecha venda, mas o fluxo só foi exercitado com o provedor `mock` e a API simulada no teste de interface. Fazer uma compra de teste real com `PAYMENT_PROVIDER=mercadopago` (webhook cadastrado, Access Token e segredo da mesma conta) e conferir no celular de verdade (seção 14.6).

## 2. Rede de segurança

A pasta não tem git. Backup completo feito antes de qualquer remoção:

`~/Downloads/redbull_compra_citi-main_backup-pre-refatoracao-frontend_20261118-0014.tar.gz`

O pacote do design usado na fase 1 está em `~/Downloads/novo-frontend.zip`.

Antes do Pix (fase 2b), só código (sem `.venv`, `node_modules`, kit 3D, vendor e binários, que não mudaram): `~/Downloads/redbull_compra_citi-main_backup-pre-pagamento_20261119.tar.gz`.

Antes da troca da geladeira 3D (fase 1b): `~/Downloads/redbull_compra_citi-main_backup-pre-cooler3d_20261118.tar.gz`. O kit original (com os GLBs sem otimização) está em `~/Downloads/Kit_Mini_Cooler_3D.zip`.

## 3. Estrutura atual

| Caminho | Papel |
|---|---|
| `app/templates/loja.html` | Página da loja, servida em `/` por `store_page` (`app/main.py`) com CSP estrita (`STORE_PAGE_HEADERS`) |
| `app/static/storefront/src/pdv.js` | **Plataforma.** Busca `/api/products`, as faixas `MEMBER`/`NON_MEMBER` e o comprador lembrado, monta o catálogo e chama `mountStorefront` com o pagamento (`checkout-api.js`). Erro de carregamento mostra aviso com "Tentar novamente". |
| `app/static/storefront/src/checkout-api.js` | **Plataforma.** Pagamento ligado à API: cria, consulta e cancela o pedido, simula no modo mock, lê o estoque; converte o `Order` do servidor na `Charge` da loja e as falhas em `CheckoutError` (`stock`, `invalid`, `conflict`, `provider`, `network`). Corrige o relógio do aparelho pelo cabeçalho `Date` (seção 14). |
| `app/static/storefront/src/core/payment-watch.js` | **Plataforma.** Consulta a cobrança a cada 2,5 s até ela terminar; uma consulta por vez, resposta de cobrança antiga descartada, `now()` para consultar na hora. |
| `app/static/storefront/src/ui/payment-page.js` + `assets/styles/payment.css` | **Plataforma.** Etapa de pagamento da gaveta: QR, contagem, copia e cola, cancelar em dois toques, simular (mock), telas finais; e, no CSS, a linha de sabor esgotado e o aviso flutuante com texto variável. |
| `app/static/storefront/src/ui/payment-clock.js` | **Plataforma.** Relógio de ponteiros do prazo do Pix (marcação em `clockFace()`, `templates.js`): move os ponteiros e o setor do tempo que resta; o ponteiro dos segundos dá o tique com repique (seção 14.1). |
| `app/static/storefront/src/data/flavors.js` | **Plataforma.** ID do produto no banco → lata 3D do kit (`model`), foto, cores e ordem. Produto sem entrada aparece no fim com o visual padrão e sem lata 3D. |
| `app/static/storefront/cooler/` | **Kit Mini Cooler 3D** (seção 10): motor `geladeira/cooler-engine.js`, artes `geladeira/art/`, latas `latas/<id>/modelo.glb` e o HDR `latas/studio.hdr` |
| `app/static/storefront/src/scene/cooler-scene.js` | **Plataforma.** Geladeira da loja sobre o motor do kit: estoque visível, toque na lata exata, seleção, voo até o carrinho, reposição por gravidade, porta, foco do carrinho |
| `app/static/storefront/src/scene/cooler-stock.js` | **Plataforma.** Latas do kit: carrega cada GLB uma vez, instâncias por material, pose própria para animar, alvos de toque leves (derivado de `fonte/estoque.mjs` do kit) |
| `app/static/storefront/src/scene/glass-condensation.js` | **Pacote `vidro-condensacao.zip` + só a opção `veil` do pacote do loading** (SHA-256 `9d9508f8…e201a63`; antes do loading `a63257fd…754f354`; seção 12): vidro da porta embaçado embaixo, gotas que se formam e escorrem (seção 10.7) |
| `app/static/storefront/src/scene/cooler-cabinet.js` | **Kit, portado.** Carrega o motor e aplica artes/acabamentos do gabinete (lógica de `geladeira/cooler.mjs` do kit, sem mudança) |
| `app/static/storefront/src/pricing.js` | **Plataforma.** Preço pela faixa da quantidade total (espelha `store.reserve_order`; só exibição) |
| `app/static/storefront/src/core/membership.js` | **Pacote da identificação, adaptado** (seção 13): e-mail válido, membro/não membro, nomes (`capitalizeTyping` ao digitar, `tidyName` no pedido), `NAME_MAX` |
| `app/static/storefront/src/core/email-hint.js` | **Plataforma.** Sugestão de correção do e-mail (domínios conhecidos, finais trocados), sem rede |
| `app/buyer_memory.py` | **Plataforma.** `GET`/`PUT /api/comprador`: comprador lembrado no aparelho por cookie do servidor (seção 13.3) |
| `app/static/storefront/src/ui/price-swap.js` + `assets/styles/price-swap.css` | **Plataforma.** Transição da troca de preço por faixa: queda de preço risca o valor anterior (linha na cor do sabor, `--g`), que sobe e se dissolve enquanto o novo emerge e acende; aumento é só uma troca discreta. O texto antigo fica em `data-was` (pseudo-elemento `::before`), sem timers nem nós extras. Usado pelo preço do painel e pelo preço unitário da gaveta. |
| `app/static/storefront/assets/styles/pdv.css` | **Plataforma.** Esgotado, botões desabilitados, aviso de preço, tela de erro |
| `app/static/storefront/assets/styles/responsive.css` | **Plataforma.** Celular deitado e telas grandes (além dos dois layouts do design) |
| `app/static/storefront/src/storefront.js`, `src/ui/*`, `src/core/*` | Componentes do design (com os patches da seção 4) |
| `app/static/storefront/assets/`, `vendor/` | Estilos, fontes e fotos das latas do design; Three.js 0.160.0 (com os loaders de GLB/HDR) e GSAP usados pela cena |
| `tools/ui-smoke-test.mjs` + `package.json` | Teste de interface (`npm run test:ui`) |
| `docs/licencas-frontend.md` | Licenças de terceiros |
| `app/templates/estoque.html`, `app/static/estoque/*` | Painel legado (fase 3); fotos de lata já apontam para `storefront/assets/images/cans/` |
| `app/static/assets/logo-citi-transparent.png` | Usado só pelo painel legado; sai na fase 3 |

## 4. Patches locais sobre a exportação do design

Ao receber uma versão nova do design, copiar `src/`, `assets/` e `vendor/` por cima de `app/static/storefront/` **sem** trazer `index.html`, `tools/`, `docs/`, `src/main.js`, `src/data/catalog.js`, `src/scene/` e `vendor/three/addons/` (a geladeira 3D do design foi substituída pela do kit, seção 10), e reaplicar:

1. **`src/storefront.js`**
   - `options.catalog` e `options.pricing` obrigatórios; sem catálogo de demonstração.
   - `cartSummary` usa `pricing.total(qtd total)`; `order()` usa o preço unitário da faixa.
   - Estoque: `MAX_PER_FLAVOR = 20` (limite do back-end por item); `remaining(id)` = mín(20, estoque) − carrinho − latas em voo. `dispense` nunca passa disso; `setQuantity` limita ao que resta.
   - `inFlight` no estado: latas que saíram da geladeira e ainda não chegaram; `land(index)` move de "em voo" para o carrinho (evento `landed` da cena).
   - Identificação (seção 13): `options.guestPricing` (tabela de não membro) e `options.customer` (comprador lembrado); `order()` usa a tabela do e-mail digitado e leva `customer`.
   - Pagamento (seção 14): `options.payment` obrigatório no lugar de `onCheckout`; etapa `pay` na gaveta; `payment`, `paymentTrouble`, `confirmingCancel`, `cancelling` e `note` no estado; ações `cancelPayment`, `simulatePayment`, `checkPayment`, `finishPayment`, `dismissUnavailable`, `notify`; `closeCart` não fecha com Pix em aberto.
   - Estoque é estado (`stock`, relido depois de cada cobrança) e não mais `flavor.stock`; `unavailable` guarda os sabores do carrinho que esgotaram; o "esgotado" do carrossel segue o estado.
   - `insets`: no desktop usa a largura real do painel; no celular deitado reserva a direita (painel ao lado).
   - `insetsFocus`: gaveta da altura toda não empurra a geladeira para fora.
   - Cena: `mountCoolerScene` (`src/scene/cooler-scene.js`) no lugar da cena do design; recebe `flavors: [{ model }]` e `stock: coolerStock()` (estoque − carrinho − em voo) e é atualizada por `setStock` a cada mudança de carrinho ou de latas em voo.
2. **`src/ui/product-panel.js`**: preço = unitário da faixa que o pedido alcança com a quantidade escolhida (exibido com `showPrice`); "Adicionar" mostra quanto o total sobe; "Esgotado" (pelo `state.stock`) e botões desabilitados conforme `remaining`.
3. **`src/ui/cart-drawer.js`**: preço unitário de cada linha recalculado a cada mudança (todas as latas têm o preço da faixa, exibido com `showPrice`); "+" desabilitado sem estoque. Mais a identificação do pacote com os acréscimos da seção 13.2, a terceira etapa (`is-pay`, `is-locked`), as linhas de sabor esgotado e o aviso flutuante (`note`) com texto variável.
4. **`assets/styles/base.css`**: `.cw canvas` começa transparente e aparece com `.is-ready` (a geladeira só surge completa).
5. **`assets/styles/reduced-motion.css`**: `.cw canvas`, `.px-now` e `.px::before` entram na lista sem animação.
6. **`src/ui/templates.js`**: identificação do pacote (seção 13) com o ícone `mail`, o aviso `hint` em `membershipNote` e `maxlength` dos nomes vindo de `NAME_MAX`; etapa de pagamento (`paymentPage`, `paymentResult`, ícones `pix` e `copy`, botão `cancelPay` no `cs-slot`), `unavailableLine` e o aviso `note` com texto variável.
7. **Fotos**: `acai.webp` do pacote do design entra (o Açaí é um dos 12 sabores do kit).

## 5. Contrato com o back-end

### 5.1 Usado pela fase 1

| Chamada | Uso |
|---|---|
| `GET /api/products` | `{id, name, stock, category}`; `stock` já desconta reservas. O prefixo "Energy " do nome não aparece na loja. |
| `GET /api/price-tiers?pricing_audience=MEMBER\|NON_MEMBER` | Faixas `{min_quantity, max_quantity\|null, unit_price}` |

**Preço:** o público é decidido no back-end pelo e-mail (`pricing_audience_for_email`): `@citi.org.br` exato → membro. O cliente não envia mais `pricing_audience` (se enviar, é ignorado). Membro: R$ 8,50 / 2–3 latas R$ 8,00 cada / 4+ R$ 7,50 cada. Não membro: R$ 12,00 por lata. **Tabela fixa em `app/pricing.py`**, travada também no banco (migration `d8a4f2c61e37`); não existe edição de preço (ver "Prices are fixed" no `CLAUDE.md`). O botão "Adicionar" mostra as latas escolhidas × o preço por lata da faixa que o pedido alcança (o mesmo da gaveta), nunca a diferença entre totais. Antes da identificação a loja mostra a tabela de membro; na identificação, o aviso abaixo do e-mail diz qual tabela vale e o total muda na hora.

**Risco registrado:** não há verificação de posse do e-mail; qualquer pessoa pode digitar um `@citi.org.br` para pagar o preço de membro.

### 5.2 Ligado na fase 2b (`src/checkout-api.js`)

| Chamada | Uso |
|---|---|
| `POST /api/orders` | Corpo `{buyer_name: \`${customer.firstName} ${customer.lastName}\`, payer_email: customer.email, items:[{product_id, quantity}]}` → `Order` (201); o `order.customer` da loja já vem arrumado e cabe nos 80 caracteres de `buyer_name`. `quantity` de 1 a 20 por item. `409` estoque insuficiente, `422` validação (`detail` em lista), `502` falha do provedor. |
| `GET /api/orders/{id}` | Polling do status |
| `POST /api/orders/{id}/cancel` | Cancela; `409` se um pagamento aprovado concorrer, `502` se o provedor falhar |
| `GET /api/orders/{id}/qr` | SVG do QR Pix (`no-store`); é o valor de `payment.qr_code` |
| `POST /api/mock/pay/{txid}` | Confirma pedido no modo mock; `404` fora dele |

O pedido do storefront (`{items:[{id, quantity, …}], total}`) vira `items:[{product_id: id, quantity}]`; o total vem da resposta (`Order.total`), nunca do navegador. Depois do pagamento aprovado o carrinho esvazia em "Concluir" (seção 14).

Estados: `Order.status` = `PENDING|PAID|CANCELLED`; `payment.status` = `CREATING|WAITING_PAYMENT|APPROVED|EXPIRED|FAILED|CANCELLED`.

### 5.3 Comportamentos da interface antiga reproduzidos na fase 2

A interface antiga foi removida; o código está no backup (`app/static/app.js`).

- [x] Identificação: nome com 2 a 80 caracteres; e-mail com até 254, formato válido, normalizado com `trim().toLowerCase()`; mostrar qual preço vale assim que o e-mail for digitado (seção 13).
- [x] Bloqueio de envio duplicado (`checkingOut`); em erro de rede os campos digitados são preservados e um aviso pede para tentar de novo.
- [x] Pagamento: QR, código copia-e-cola com botão de copiar (sem clipboard, o código fica selecionado e um aviso explica), valor, status.
- [x] Contagem regressiva `mm:ss` até `expires_at` (com anel), corrigida pelo relógio do servidor; ao zerar, consulta o status.
- [x] Polling a cada 2,5 s, ignorando respostas de sessão antiga ou de outro pedido; em falha mostra "Verificando Pagamento" e continua tentando. Também consulta na hora quando a pessoa volta do app do banco.
- [x] Estados: `PAID`/`APPROVED` → sucesso; `EXPIRED` → orientar a procurar o time de Gente & Gestão; `FAILED` → nada cobrado; `CANCELLED` → cobrança interrompida. Estados terminais trocam "copiar" pela saída e escondem "cancelar".
- [x] Cancelar: confirmação em dois toques, `/cancel`, recarrega o estoque liberado. **Mudou:** as latas voltam ao carrinho (conferidas com o estoque) em vez de o carrinho ser limpo, decisão do produto (seção 14.3).
- [x] Modo mock (`payment.simulated === true`): "Simular Pagamento" via `/api/mock/pay/{txid}`, nunca visível com o Mercado Pago.
- [x] Sucesso: "Pedido #" + 8 primeiros caracteres do UUID, itens (as latas a pegar), total e "Concluir" (esvazia o carrinho, fecha a gaveta e relê o estoque).
- [x] Privacidade: sem `localStorage`, sem e-mail fixo ou de fallback (invariante em `tests/test_frontend_email.py`). O comprador lembrado fica só num cookie `HttpOnly` do servidor, no aparelho dele (seção 13.3).

## 6. Painel `/estoque` (fase 3)

- CSP `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'`: sem inline, sem CDN, sem fontes externas. Se o design novo usar o vidro líquido, incluir `blob:` em `img-src` como na loja.
- O HTML fica fora de `/static`; `/static/estoque/index.html` deve continuar dando 404 (testado).
- Cookie `rb_estoque_session` (HttpOnly, SameSite=Strict); `fetch` com `credentials: 'same-origin'`; toda requisição que altera estado envia `X-Requested-With: estoque-panel`.
- Endpoints `/api/estoque`: `POST /login`, `POST /logout` (204), `GET /me`, `GET /produtos`, `GET /resumo`, `GET /precos` (só leitura, tabela fixa), `GET /movimentos` (`product_id`, `direction=in|out`, `limit` 1–200, `before_id`), `POST /movimentos`. `401` leva ao login.
- Reaproveitar `src/data/flavors.js` para as fotos (hoje o `estoque.js` tem um mapa próprio que aponta para as mesmas fotos).
- Ajustar em `tests/test_stock_panel.py` a asserção de texto `"Controle de"` e o 200 de `/static/estoque/estoque.js`.

## 7. Protocolo de remoção (a cada peça nova integrada)

1. Listar o equivalente legado: blocos de HTML, funções de JS, regras de CSS, assets, testes e menções em docs.
2. Integrar a peça nova e conferir o comportamento pelas checklists acima.
3. Apagar o legado na mesma entrega, sem código comentado nem compatibilidade provisória.
4. Provar que está morto: buscar IDs, classes, funções e nomes de arquivo em `app/`, `tests/`, `docs/`, `README.md` e `CLAUDE.md` (ignorar `.venv/`, `node_modules/`, `entrega_estoque/`, `Claude outputs/`).
5. Rodar `pytest` e `npm run test:ui`.
6. Registrar na seção 9.

## 8. Pendências

- Textos do aviso de preço e do estado de erro, a refinar no design.
- `entrega_estoque/` e `Claude outputs/` (no `.gitignore`) têm cópias antigas do painel; decidir se serão apagados.
- Banco institucional: aplicar a migration `d8a4f2c61e37` (preços fixos; remove `price_tiers` e `orders.price_tier_id`) exige autorização explícita, backup e o roteiro de migrations do `CLAUDE.md`.
- Geladeira 3D: cada lata do kit tem ~116 mil triângulos e ~6 MB; com os 12 sabores à mostra a loja baixa ~75 MB na primeira visita. Avaliar simplificação/compressão dos GLBs antes do deploy (seção 10.5).
- Banco institucional: aplicar a mesma lista de sabores (sair `nectarina`, entrar `acai`) exige autorização explícita; produto com pedidos ou movimentações não pode ser apagado, só retirado de venda.

## 9. Registro de remoções

| Data | Legado removido | Substituído por | Verificação |
|---|---|---|---|
| 2026-11-18 | `app/static/index.html`, `app/static/app.js`, `app/static/styles.css` (PDV antigo) | `app/templates/loja.html` + `app/static/storefront/` | busca sem referências; `pytest` 134 ok; `npm run test:ui` ok |
| 2026-11-18 | 12 fotos de lata em `app/static/assets/` (incluindo as 2 com nome em NFD) | `app/static/storefront/assets/images/cans/` (nomes ASCII); painel repontado | busca sem referências |
| 2026-11-18 | Rota `/` servindo `static/index.html` sem CSP | `store_page` com `STORE_PAGE_HEADERS` | `test_store_page_is_served_with_strict_csp` |
| 2026-11-18 | 3 testes de marcação do PDV antigo em `tests/test_frontend_email.py` | invariante do e-mail do pagador mantido, apontando para `storefront/src` | `pytest` |
| 2026-11-18 | `pricing_audience` enviado pelo cliente e o parâmetro `?pricing=` | `pricing_audience_for_email` no back-end | testes de domínio e de cliente ignorado |
| 2026-11-18 | `src/main.js`, `src/data/catalog.js` e `acai.webp` do pacote do design (demonstração) | `src/pdv.js`, `src/data/flavors.js` | busca sem referências |
| 2026-11-18 | Geladeira 3D do design: `src/scene/fridge-scene.js`, `fridge-model.js`, `can-model.js`, `dimensions.js`, `frost.js`, `textures.js` (incluindo névoa, condensação, brilhos e luz da lata) | Mini Cooler do kit: `cooler/` + `src/scene/cooler-scene.js`, `cooler-stock.js`, `cooler-cabinet.js` | busca sem referências; `pytest` 134 ok; `npm run test:ui` ok (com GPU); cenários de estoque e falha de GLB conferidos no Chrome |
| 2026-11-18 | `vendor/three/addons/OrbitControls.js`, `RectAreaLightUniformsLib.js`, `RoundedBoxGeometry.js` | órbita do próprio motor do kit; `GLTFLoader.js`, `RGBELoader.js`, `BufferGeometryUtils.js` (Three.js 0.160.0) | busca sem referências |
| 2026-11-18 | Sabor `nectarina` (regular, fora do kit): entrada em `flavors.js`, foto `cans/nectarina.png`, mapa do painel, linha do `sql/seed_sabores.sql`, fixture do teste e o produto no banco local (sem pedidos nem movimentações) | só os 12 sabores do kit; `acai` incluído (foto do design, GLB do kit, seed) | busca sem referências; `pytest`; `npm run test:ui` |
| 2026-11-18 | Preço editável: tabela `price_tiers`, `orders.price_tier_id`, `app/price_service.py`, `PUT /api/estoque/precos`, `PriceTableUpdate`, formulário e simulação de preço do painel, testes de edição de preço | tabela fixa em `app/pricing.py` + trava no banco (`d8a4f2c61e37`); painel só exibe | busca sem referências; `pytest` 168 ok; `npm run test:ui` ok |
| 2026-11-18 | Campo `can.ink` em `flavors.js` (cor do texto das latas 3D antigas) | rótulos reais dos GLBs | busca sem referências |
| 2026-11-19 | **Modo simulado inteiro (produção):** `MockPaymentProvider`, `PAYMENT_PROVIDER`/`SUPPORTED_PAYMENT_PROVIDERS`, rotas `/api/mock/pay` e `/api/mock/qr`, `store.confirm_payment` (cópia paralela da confirmação, só do mock), `PaymentData.simulated`, botão "Simular Pagamento" (`paySimulate`, `.pq-sim`, `simulatePayment`, `simulate` do `checkout-api.js`, `txid` da `Charge`), teste mock-only de expiração; modelos nunca usados `MercadoPagoWebhookData`, `MercadoPagoWebhookPayload`, `ManualReview` e `list_manual_reviews`; `refractOK` exposto sem uso; artes do kit e logo em PNG | Mercado Pago como único provedor (credenciais obrigatórias); `tests/fakes.py` (`FakePixProvider`, `pay_via_webhook`) injetado no `app.state`; artes e logo em WebP sem perda | busca sem referências; testes sem banco ok; `npm run test:ui` |
| 2026-11-19 | Ícone de QR do cabeçalho do Pix (`icon.pix`, `.qrg`, `.cs-qb`, `.qf`/`.qm`/`.qd`), elemento `<i class="pq-scan">` do QR; efeito de leitura do QR (`.pq-scan`, `pqScan`), bolinha da situação (`.pq-dot`, `pqPulse`, `pqPulseWarm`), anel azul do prazo (`.pq-arc`, `.pq-trk`, `--left`), tons azul e âmbar da etapa de pagamento, `<output>` do código | ícone de cédulas (`icon.cash`, `.cs-pm`), relógio de ponteiros (`payment-clock.js`), brilho branco no texto da situação, campo do código no molde da identificação, vidro neutro no botão | busca sem referências; `npm run test:ui` |
| 2026-11-19 | Aviso provisório "Pagamento Ainda Não Conectado Nesta Versão." (`payNote`, `payNoteVisible`, `PAY_NOTE_MS`), opção `onCheckout` de `mountStorefront`, ouvinte `storefront:checkout` em `pdv.js` (a lembrança do comprador passou para depois do pedido aceito), checagem do aviso no `ui-smoke-test`; leitura de `flavor.stock` em `remaining`/`coolerStock`/painel e a classe `is-sold-out` gerada na marcação do carrossel | etapa de pagamento (seção 14); aviso flutuante `note` com texto variável; estoque no estado (`stock`) | busca sem referências; `npm run test:ui` ok |
| 2026-11-18 | Aviso provisório de preço antes da identificação: opção `otherAudienceNote`, parágrafo `.cs-aud` (template e `pdv.css`), `MEMBER_DOMAIN` e `formatMoney` em `pdv.js`, checagem no `ui-smoke-test`; `checkoutPending` em `storefront.js` | identificação na gaveta (cartões de membro/não membro, total do e-mail digitado), `checkingOut` no estado | busca sem referências; `pytest`; `npm run test:ui` |

## 10. Geladeira 3D: Mini Cooler do kit

Origem: `~/Downloads/Kit_Mini_Cooler_3D.zip` (motor, artes, 12 GLBs, HDR, `cooler.mjs`, `fonte/estoque.mjs`, catálogo e documentação de integração).

### 10.1 O que entrou e de onde

| Plataforma | Kit |
|---|---|
| `cooler/geladeira/cooler-engine.js`, `cooler/geladeira/art/*.png`, `cooler/latas/studio.hdr` | iguais aos do kit |
| `cooler/latas/<id>/modelo.glb` (12) | `original`, `sugar-free` e `zero` iguais; os outros 9 com texturas reduzidas (10.5) |
| `src/scene/cooler-cabinet.js` | classe `CoolerViewer` de `geladeira/cooler.mjs` (artes, lateral polida, LED do logotipo, primeiro quadro) |
| `src/scene/cooler-stock.js` | `fonte/estoque.mjs` (GLB por sabor, agrupamento por material, instâncias, reflexo do HDR) + lugares estáveis, pose própria para animar e alvos de toque |
| `src/scene/cooler-scene.js` | adaptador da plataforma (o `montarCooler` do kit não cobre seleção, toque na lata exata, voo ao carrinho nem foco) |
| `vendor/three/addons/GLTFLoader.js`, `RGBELoader.js`, `BufferGeometryUtils.js` | Three.js 0.160.0 (mesma versão já vendorizada), import ajustado |

Não entram (sem uso na plataforma): `cooler.mjs`, `estoque.mjs` compilado, `configuracao/` (o mapa de sabores é `src/data/flavors.js`, campo `model`), `exemplo/`, `fonte/` e `integracao/`.

### 10.2 Sabores (ID do banco → lata do kit)

`original`→`original`, `zero_tradicional`→`zero`, `tradicional_sugarfree`→`sugar-free`, `melancia`→`summer-melancia`, `tropical`→`tropical`, `morango_e_pessego`→`pessego`, `melao_e_maracuja`→`melao`, `maca_sugarfree`→`maca-sugar-free`, `nectarina_sugarfree`→`nectarina-sugar-free`, `pomelo_sugarfree`→`pomelo-sugar-free`, `amora_sugarfree`→`amora-sugar-free`, `acai`→`acai`. Os pares de nome diferente foram conferidos pelo rótulo do GLB ("The Pêssego Edition — Morango & Pêssego", "The Melão Edition — Maracujá & Melão", "The Summer Edition — Sabor Melancia").

### 10.3 Comportamento

- **Estoque visível** (contrato do kit): a geladeira mostra o disponível de cada sabor (estoque − carrinho − latas em voo), até 25 latas (5 fileiras × 5), repartidas em rodízio na ordem do catálogo, frente primeiro e do centro para as bordas. O estoque de negócio continua só na loja/back-end.
- **Reposição:** quando uma lata sai, as de trás da mesma coluna deslizam para a frente e o lugar livre é reposto pelo fundo, se ainda houver disponível; uma lata devolvida pelo carrinho volta pelo fundo. Só os GLBs dos sabores à mostra são baixados.
- **Interação mantida:** porta (botão e toque), giro/zoom, recentralizar, lata exata ao tocar (a de trás passa por cima das da frente), seleção pelo carrossel (a lata da frente do sabor sobe e flutua), destaque ao passar o mouse, voo de cada unidade até o ícone do carrinho (evento `landed`), foco com o carrinho aberto, condensação no vidro da porta (10.7). Sem a névoa que saía da porta, os brilhos e a luz da lata (eram da geladeira antiga).
- **Falha** (sem WebGL ou erro ao baixar motor/GLB/HDR): a loja segue sem a geladeira; as latas entram direto no carrinho.

### 10.4 Ajustes necessários para o motor do kit na loja

- **Piso:** o invólucro de render do motor troca o piso de sombra por um piso claro semitransparente, pensado para página clara (o exemplo do kit usa fundo `#f1f1ef`); no palco escuro ele virava uma faixa cinza. `cooler-scene.js` põe de volta um `ShadowMaterial`.
- **Varredura de malhas do motor (`ImportedCans`):** o pipeline de render do motor só reescaneia as malhas quando muda o objeto chamado `ImportedCans` ou o número de filhos dele; malha fora da varredura é desenhada de novo, com o próprio material, nas passadas diretas (por cima da composição). No brilho (bloom) a malha fora da varredura também mantém o material real, e a lata acordada (escolhida, sob o ponteiro, voando) vira uma mancha oval branca e desfocada sobre o vidro. `cooler-stock.js` troca o marcador `ImportedCans` por um `Object3D` novo e vazio (filho do grupo das latas) a cada lata que entra ou sai: a identidade sempre muda. Não volte a revezar o nome entre dois objetos: quando uma lata entra e outra sai antes do mesmo quadro (pouso + reposição, ou a sincronização do estoque), o revezamento volta ao estado anterior, a contagem não muda e o motor não reescaneia — era a "mancha branca ao tocar na geladeira" (corrigida em 2026-11-18; cenas paradas idênticas, 0 px). Cada lata mantém a pose oculta enquanto parada.
- **CSP:** `connect-src 'self' blob:`, porque o carregador lê as texturas embutidas nos GLBs por URLs blob criadas na página. Tipos `model/gltf-binary` (`.glb`) e `image/vnd.radiance` (`.hdr`) registrados em `app/main.py`.
- **Atributos intercalados:** os 3 GLBs já otimizados do kit vêm intercalados; `cooler-stock.js` desintercala antes de unir por material.
- **Enquadramento:** o motor recalcula a câmera ao redimensionar e volta à vista padrão; `cooler-scene.js` guarda a vista antes (observador criado antes do motor) e a restaura depois, e calcula o enquadramento do modo foco, respeitando os limites de distância da órbita do motor.

### 10.5 Otimização dos GLBs e limitações conhecidas

- O kit diz que só 3 latas vieram otimizadas. Nas outras 9, as texturas foram reduzidas com `gltf-transform resize` ao padrão das otimizadas: cor 4096→2048, metal/rugosidade 4096→1024, faixa "sugar free" 4096→2048 de largura. Geometria e materiais intactos; validação glTF sem erros. Memória de textura por sabor: ~190 MB → ~34 MB.
- Cada lata segue com ~116 mil triângulos. Desde 2026-11-19 (seção 15.4) as 12 vêm com texturas em WebP **sem perda** (mesmos pixels) e malha em inteiros de 16 bits (`KHR_mesh_quantization`; erro de ~2 µm numa lata de 13 cm): 76,7 → 46 MB, comprimidas 49 → 32 MB. O `GLTFLoader` lê as duas extensões sem decodificador (a CSP não muda) e `cooler-stock.js` volta a malha para float ao montar. Simplificar a malha ou Draco/meshopt reduziria mais, mas muda a geometria ou exige WebAssembly (`'wasm-unsafe-eval'` na CSP).
- O motor do kit traz duas cópias internas do Three.js; com a cópia da plataforma (loaders), o console mostra o aviso "Multiple instances of Three.js". É inofensivo e só some recompilando o motor.
- Lata de trás tocada passa por cima das da frente; na prateleira de cima não há altura para passar inteira e as latas se sobrepõem por um instante.

### 10.6 Atualizar o kit

Copiar por cima `geladeira/cooler-engine.js`, `geladeira/art/` (convertendo para WebP sem perda: `cwebp -lossless -z 9 -exact arte.png -o arte.webp`) e `latas/` (reduzindo as texturas como em 10.5 e, em cada `modelo.glb`: `npx gltf-transform webp modelo.glb tmp.glb --lossless && npx gltf-transform quantize tmp.glb modelo.glb --quantize-position 16 --quantize-normal 16 --quantize-texcoord 16 --quantize-generic 16`; o `@gltf-transform/cli` está nas dependências de desenvolvimento). Se `geladeira/cooler.mjs` ou `fonte/estoque.mjs` mudarem, portar a diferença para `cooler-cabinet.js` / `cooler-stock.js`. Sabor novo: GLB em `cooler/latas/<id>/modelo.glb` e `model: '<id>'` na entrada do produto em `src/data/flavors.js`.

### 10.7 Condensação no vidro da porta

Origem: `~/Downloads/vidro-condensacao.zip` + `~/Downloads/PROMPT.md`. O módulo `src/scene/glass-condensation.js` é cópia exata do pacote (SHA-256 `a63257fde6d02e835b27c8a9bbe4af12c4063b3b3a682a25b9b2fb178754f354`; o caminho do import já coincide com o do projeto) (depois, o pacote do loading acrescentou só a opção `veil`, usada pelo gerador da imagem: seção 12). **Não editar:** qualquer número muda o visual combinado com as referências do pacote.

Ligação em `cooler-scene.js`, como na seção 5 do prompt:
- criado com `debug.cooler` logo antes do primeiro quadro (o pipeline do motor varre as malhas nesse momento; criado depois, apareceria duplicado e mais claro), opacidade de repouso `CONDENSATION_REST = 0.86`;
- laço `wake`/`tick` sob demanda: `step(dt)` com `dt` em segundos (máx. 0,05) e quadros contínuos só enquanto uma gota escorre; o resto pede quadros avulsos;
- ao fechar a porta, a névoa sobe a 1 em 1,2 s e volta a 0,86 em 6 s;
- `dispose()` na desmontagem (e na falha de carregamento).

Conferido no Chrome com GPU: embaçado só embaixo com gotas e rastros antigos, escorrida nos primeiros segundos, rastros reembaçando depois de 20 s, nada se mexe com "reduzir movimento", sem erros nem violações de CSP.

## 11. Desempenho (2026-11-18)

Origem: `~/Downloads/PROMPT-DESEMPENHO.md` (regra: nenhuma mudança visual ou de comportamento). Medido no Chrome com GPU real (Apple M2): desktop 1440×900 sem limitação e celular 390×844 com Slow 4G (1,6 Mbps, 150 ms) e CPU 4× mais lenta, banco local com 3 sabores em estoque (25 latas à mostra).

### 11.1 O que foi feito

| Mudança | Onde | Ganho medido |
|---|---|---|
| Arquivos da loja em `/static/v/<versão>/storefront/…` com `Cache-Control: immutable`; a versão é um hash de caminho, tamanho e data de todos os arquivos (muda sozinha quando qualquer arquivo muda; sem etapa de build) | `app/storefront_assets.py`, `store_page` | 2ª visita: 7 KB pela rede (72 de 94 respostas do cache); geladeira em 2,9 s em vez de 83 s |
| gzip pré-calculado (nível 9, em `<tmp>/redbull-pdv-gzip/`, aquecido em segundo plano ao subir) para `.js`, `.css`, `.glb`, `.hdr`, `.json`, `.svg`, `.txt`; imagens e fontes vão como estão | `app/storefront_assets.py` | 26,0 → 16,7 MB até a geladeira; JS 3,1 → 0,8 MB |
| `modulepreload` gerado do disco para todo o grafo da interface | `render_store_html` | módulos baixam em paralelo, sem cascata |
| Cena 3D importada sob demanda (`import()` em `storefront.js`) | `storefront.js` | interface não espera Three.js/GSAP (~1 MB) |
| Preload da API (`/api/products` e as duas faixas), das 7 fontes do primeiro quadro e da foto da Original (maior elemento da primeira tela) | `loja.html` | celular: API sai em 185 ms em vez de 1,2 s; LCP 10,3 → 2,1 s |
| Latas (GLB) e HDR começam a baixar antes do motor ficar pronto | `prefetchCans`/`prefetchEnvironment` em `cooler-stock.js` | download em paralelo com o motor |
| Quadro de aquecimento invisível com as poses das latas e as gotas visíveis (compila os shaders no carregamento) | `cooler-scene.js` | 0 shaders compilados no 1º "Adicionar" (eram 16) |
| Mapas do vidro líquido em cache por tamanho e em canvas na CPU (`willReadFrequently`) | `liquid-glass.js` | `toDataURL` no 1º "Adicionar": 159 → 0,3 ms |
| Quadro pedido quando o navegador devolve o contexto WebGL | `cooler-scene.js` | geladeira não fica em branco após perda de contexto |
| Ponto da curva do voo sem alocar objeto por quadro | `cooler-scene.js` | menos coleta de lixo durante o voo |

**Correção de defeito (muda pixels só em quadros com lata se movendo):** latas criadas depois da última varredura do motor (reposição durante o voo) eram desenhadas também nas passadas diretas do motor, por cima da composição e com outro mapeamento de tom. Com a varredura forçada (10.4), elas passam a ser desenhadas como todas as outras.

### 11.2 Antes × depois

| Métrica | Desktop antes | Desktop depois | Celular antes | Celular depois |
|---|---|---|---|---|
| Interface utilizável | 163 ms | 127 ms | 7.831 ms | 2.038 ms |
| FCP / LCP | 268 / 272 ms | 224 / 224 ms | 7.912 / 10.268 ms | 2.120 / 2.120 ms |
| Geladeira pronta (1ª visita) | 1.883 ms | 1.821 ms | 127.897 ms | 82.660 ms |
| Bytes até a interface | 1,72 MB | 0,48 MB | 1,31 MB | 0,23 MB |
| Bytes até a geladeira | 26,0 MB | 16,7 MB | 26,0 MB | 16,7 MB |
| Maior travada no 1º "Adicionar" | 279 ms | 0 | 272 ms | 53 ms |
| Maior travada ao arrastar o carrossel | 183 ms | 50 ms | 149 ms | 51 ms |
| CLS | 0,007 | 0,005 | 0,005 | 0,005 |
| Quadro durante animações (p95) | ~67 ms | ~67 ms | ~50 ms | ~50 ms |

### 11.3 Verificação

- 42 capturas determinísticas (relógio falso, `Math.random` com semente, "reduzir movimento" no 3D, animações CSS congeladas): todas as capturas da interface e as do celular parado idênticas (0 px) às de antes. Diferenças restantes: (a) giro sorteado da lata em voo e desfoque da gaveta sobre o 3D (Δ ≤ 2), que já variam entre duas rodadas do código antigo; (b) desktop parado com Δ ≤ 11 no SSAO: o motor sorteia o kernel do SSAO a cada carregamento (duas rodadas do mesmo código sem semente diferem no mesmo padrão), e a pré-busca do HDR só desloca o sorteio dentro do verificador.
- Conteúdo entregue comprimido idêntico byte a byte ao do disco (teste `test_store_assets_are_versioned_cached_and_compressed`).
- `pytest` 135 ok; `npm run test:ui` ok nos 11 tamanhos, com e sem WebGL.

### 11.4 Não aplicado (exigiria perda de qualidade ou mudança visual)

O gargalo restante é a GPU (ver 11.5 para o que a segunda rodada resolveu). A conclusão original desta seção, "o custo é de pintar pixels, não de geometria", estava errada: a maior parte era geometria de instâncias vazias (11.5). O custo restante vem do visual do kit: latas com material físico (verniz, relevo, reflexo, 3 luzes de área), passada de refração do vidro/acrílico, SSAO e pós-processamento, renderizados todo quadro porque a lata escolhida flutua sem parar. Opções, todas com alguma mudança visual e por isso dependentes de aprovação:

1. Parar a flutuação da lata escolhida quando nada mais se move (cena ociosa = 0 quadros; hoje ~20 quadros/s parado).
2. Limitar a densidade de pixels da geladeira em telas Retina (ex.: 1,5 em vez de 2).
3. Simplificar as latas (~116 mil → ~20 mil triângulos) ou o material delas.
4. Comprimir os GLBs com Draco/meshopt (~6 → ~1–2 MB cada; exige `'wasm-unsafe-eval'` na CSP).

Também não aplicado: Brotli (exige dependência nova; gzip já reduz o principal), Service Worker (o cache imutável já entrega a 2ª visita sem rede), mover o desenho inicial da condensação para um Worker (o módulo do pacote não pode ser editado), unificar as cópias do Three.js (exige recompilar o motor do kit), `texSubImage2D` parcial nas gotas (exige editar o módulo da condensação).

### 11.5 Segunda rodada: só as latas que existem vão para a GPU

Cada sabor carregado tinha as 5 peças da lata instanciadas com capacidade 25 e `count` 25 o tempo todo; latas paradas fora dali (escolhida, em voo, vendidas, de outro sabor) eram "escondidas" com matriz de escala zero. Instância vazia não gera pixel, mas a geometria (~116 mil triângulos por lata) passa pelos vértices em cada uma das ~6 passadas do motor (bloom, cena, refração do vidro, normais do SSAO, oclusão das artes, sombra), em cada quadro. Agora `cooler-stock.js` mantém só as latas paradas nas instâncias, contíguas em `[0, count)` (`place`/`unplace`; ao sair, a última ocupa o lugar).

Medido (contagem exata das chamadas de desenho WebGL; quadros/s no Chrome com GPU, M2, Mac sob pressão de memória — os valores absolutos oscilam entre rodadas, as razões não):

| Cenário | Triângulos por quadro antes → depois | Quadros/s com a lata flutuando | Porta abrindo | Girando |
|---|---|---|---|---|
| Produção (12 sabores com estoque), desktop 1440×900 | 143,0 mi → 11,9 mi | 7 → 28,5 | 6 → 25 | 27 → 66 |
| Produção, celular 390×844 (DPR 2) | — | 5,5 → 21,8 | 5,3 → 22 | 27 → 65 |
| Produção, desktop Retina (DPR 2) | — | 6,3 → 11,3 | 5,3 → 10,7 | 27 → 31 |
| Banco local (3 sabores), desktop 1440×900 | 35,5 mi → 11,7 mi | 9,5 → 12,8 | 10 → 14,7 | 32 → 39 |

Verificação: capturas determinísticas do 3D (celular e desktop) idênticas às de antes, 0 px, nas cenas paradas (carregada, porta aberta, depois do "Adicionar"); lata em voo e gaveta variam entre duas rodadas do mesmo código (ruído do sorteio do giro e do desfoque). `npm run test:ui` ok.

Testado e **descartado**: desenhar as latas da frente primeiro (ordenar instâncias pela distância da câmera, para o teste de profundidade descartar pixels das de trás). Mudava 6 px em 1 nível (0–255) na borda desfocada de um botão de vidro — onde duas latas se tocam a ordem decide o empate de profundidade — e o ganho não era mensurável com a máquina sob pressão. Fidelidade vence.

Em Retina o limite agora é a quantidade de pixels (2880×1800 com MSAA, SSAO, bloom e refração em resolução cheia); as opções de 11.4 continuam valendo e dependem de aprovação.

### 11.6 Manutenção

- Fontes pré-carregadas em `loja.html`: as usadas no primeiro quadro. Se o design trocar pesos de fonte, ajuste a lista (preload sem uso gera aviso no console).
- A foto pré-carregada é a do primeiro sabor de `flavors.js` (Original).
- Os testes do backend conferem versão, cache, gzip e bloqueio de caminhos fora da loja.

## 12. Loading da geladeira (pacote `loading-geladeira`, 2026-11-18)

Origem: `~/Downloads/loading-geladeira.zip` (PROMPT + código). O pacote foi escrito sobre a página de demonstração do design (`fridge-scene.js`, `cabinet-finish.js`, `can-stock.js`); na plataforma a integração do kit é `cooler-scene.js`/`cooler-stock.js`/`cooler-cabinet.js`, então as mudanças da seção 5 do PROMPT foram aplicadas à mão nos equivalentes.

### 12.1 Arquivos

| Arquivo | O que é |
|---|---|
| `app/templates/loja.html` | `<html class="is-booting">`; no `<head>`, antes de qualquer CSS, o preload da imagem e o `boot.css`; o bloco `#boot` é o primeiro filho do `<body>`; depois dele os estilos da loja, o `<main>` e o script. Entre `<!--boot-art-->` e `<!--/boot-art-->` o conteúdo é gerado. |
| `src/boot.js` | Controlador (atos 1 e 2). Criado em `pdv.js` antes de buscar a API; `cancelBoot()` em `pdv.js` tira o loading se a API falhar. |
| `assets/styles/boot.css`, `boot-noscript.css` | Estilos; o trecho `/* boot:size */` é gerado. |
| `assets/loading/fridge-{dark,glow}-{m,d}.webp`, `led-ring-{m,d}.svg` | Geladeira apagada, luz do LED e máscara da moldura — gerados. |
| `src/scene/cooler-frame.js` | Enquadramento sem Three.js: a câmera da cena e `fridgeLayoutRect` usam as mesmas contas (medido: retângulo calculado = retângulo do 3D, diferença ≤ 0,03 px). |
| `src/scene/cooler-scene.js` | Opções `power`, `startView`, `condensationVeil`, `hold`; API `setPower`, `power`, `fridgeScreenRect`, `ledOutline`, `release`; `prefetchCoolerScene` (só downloads). |
| `src/scene/glass-condensation.js` | Patch do pacote aplicado (opção `veil`, só usada pelo gerador); SHA-256 = o "depois" do pacote (`9d9508f8…`). Com `veil` 0 nada muda. |
| `src/storefront.js` | `insets` extraído; `interfaceReady`, `fridgeLayoutRect()`, `scene`; opções `fridge.*` repassadas; downloads do 3D já no início e montagem depois de `fridge.after`. |
| `tools/render-boot-poster.mjs`, `tools/boot-capture.js` | Gerador (adaptado: sobe o uvicorn na porta 5417, usa `app/static/storefront`, reescreve `loja.html`). |

### 12.2 Desvios do pacote (e por quê)

1. **Imagens e números regenerados** (seção 7 do PROMPT): a vista de frente da plataforma tem elevação 0,05 (a da demonstração, 0,06) e enquadramento próprio; com as imagens do pacote a geladeira "pularia" no Ato 2.
2. **`.is-entering` restrito a `.brand`, `.fabs`, `.dock`** no `boot.css`: a loja usa `.is-entering` no nome do sabor e na lata do carrossel; a regra global faria os dois piscarem e descerem 12 px a cada troca de sabor, depois do loading.
3. **`interfaceReady` espera as transições de layout do painel** (altura do nome): sem isso, no celular a geladeira pousava 6–7 px acima do 3D.
4. **Cobrinha refeita** (pedido do usuário: estava serrilhada e travando): cometa em degradê cônico atrás de uma máscara da moldura (`led-ring-*.svg`, contorno + halo desfocado), girando só com `transform`, com quadros-chave gerados do contorno para a velocidade ser constante, inclusive nos cantos. Mesmas cores, sentido e 2,4 s por volta.
5. **Fluidez** (pedido do usuário): o 3D só é montado depois do pouso e fica `hold` (sem redesenhar nem flutuar) até o fim da limpeza; no Ato 2 o LED e as luzes acendem num quadro só por baixo da imagem (em vez de subirem em 1,1 s redesenhando o 3D a cada quadro); a limpeza é uma camada com a máscara que desce enquanto o conteúdo sobe (só `transform`, em vez de `mask-position`); a loja é pintada por baixo do fundo preto durante o loading (`inert`) em vez de `visibility: hidden`.
6. **Luz da lata escolhida**: o canal `interior` do pacote inclui uma luz pontual na lata escolhida; na plataforma ela foi removida a pedido do usuário, então não existe.

### 12.3 Shaders sem travar

Com `KHR_parallel_shader_compile`, `cooler-scene.js` compila em paralelo, antes do quadro de aquecimento, as variantes que o motor usa (buffer intermediário linear, tela com ACES e o material das passadas de brilho/oclusão, com a classe do próprio motor), sobe as texturas uma por quadro (`initTexture`) e devolve a vez ao navegador entre etapas. Compilação bloqueante medida: 4,4 s → 0,9 s. Sem a extensão, nada disso roda (compilar antes só somaria trabalho síncrono). Testado e **descartado** (mudava pixels): pintar os canvases da condensação na CPU (6–18 mil px no vidro) e ler a arte do LED de um canvas na CPU.

### 12.4 Medições (Chrome com GPU, M2 sob pressão de memória)

- Primeira pintura com Fast 4G + CPU 4×: celular 1.840 → 364 ms; computador 1.688 → 336 ms (LCP = a geladeira do loading, antes de qualquer módulo JS rodar; a imagem é a 1ª requisição depois do HTML).
- Quadros apresentados (compositor): cobrinha ~55 qps; Ato 1 59–60 qps; Ato 2 57–60 qps (eram 5–9); espera do 3D 47–57 qps. Restam travadas pontuais: a pintura inicial da condensação (~1 s de GPU, uma vez, com o 3D ainda coberto; não muda sem mudar o vidro) e, nesta máquina, o cache de disco do Chrome com o disco cheio.
- Loja depois do loading × sem loading: idêntica fora da animação contínua do vidro (gotas em outro instante) e de 2 px com Δ 1 na borda do logo.

## 13. Identificação do comprador (pacote `identificacao-carrinho`, 2026-11-18)

Pacote: `~/Downloads/identificacao-carrinho.zip` (PROMPT, arquivos, patches e referências). Backup antes: `~/Downloads/redbull_compra_citi-main_backup-pre-identificacao_20261118.tar.gz`.

A identificação antiga (formulário de nome/e-mail do PDV antigo, `app/static/index.html` + `app.js`) já tinha saído na fase 1; o que restava dela na loja nova era o aviso provisório de preço (`.cs-aud`), removido agora (seção 9). O fluxo é só: gaveta do carrinho → "Finalizar Compra" → identificação na mesma gaveta → "Confirmar Pedido" → cobrança Pix na mesma gaveta (seção 14), com `order.customer = { firstName, lastName, email, member }`.

### 13.1 Como entrou

- `assets/styles/cart.css` e `liquid-glass.css`: o "antes" batia com o SHA-256 do pacote; entraram **idênticos** ao pacote (`f9435802…`, `9118de1b…`).
- `src/ui/templates.js`, `src/ui/cart-drawer.js`, `src/storefront.js`: a plataforma já tinha mexido neles (preço por faixa, estoque, loading). Caminho C do PROMPT: as mudanças do pacote aplicadas à mão, linha a linha.
- `src/core/membership.js`: do pacote, sem `NON_MEMBER_PRICE`/`unitPriceFor` (o preço vem da tabela fixa do back-end, `src/pricing.js`).

### 13.2 Desvios do pacote (e por quê)

| Desvio | Motivo |
|---|---|
| Preço do não membro e de membro pelas tabelas da API (`pricing` + `guestPricing`), não `flavor.price`/`nonMemberPrice` | Preço é por faixa da quantidade total e travado no back-end (`app/pricing.py`); uma fonte só. O cartão de não membro mostra `guestPricing.unitPrice(1)` (R$ 12,00). |
| Opções `memberDomain`/`nonMemberPrice` não existem | Domínio fixo `MEMBER_DOMAIN` (o mesmo de `pricing_audience_for_email`); preço vem da API. |
| Nome e sobrenome: inicial maiúscula **enquanto digita** (`capitalizeTyping`: cada palavra; conectivo já terminado fora da primeira palavra em minúscula; só troca letras, o cursor não se move) e arrumados ao sair do campo (`tidyName`) | Pedido do produto. O que aparece no campo é o que vai no pedido. |
| `tidyName` sem a opção `surname`: o sobrenome também começa em maiúscula ("Da Silva", não "da Silva") | Pedido do produto: a primeira letra do campo é sempre maiúscula. |
| `maxlength` 40 (nome) e 39 (sobrenome) em vez de 60/80 (`NAME_MAX`) | `buyer_name` tem 80 caracteres no back-end/banco; "Nome Sobrenome" sempre cabe. |
| Sugestão de correção do e-mail (`src/core/email-hint.js`): aviso azul "Você Quis Dizer … [Corrigir]" no mesmo lugar dos outros avisos, com a mesma espera de 1,1 s (ou ao sair do campo). Confirmar com a sugestão à vista mantém o e-mail como está (e então vale o aviso de não membro, se for o caso). | Pedido do produto: checar o e-mail na hora, sem código nem rede. Cobre erros nos provedores mais usados ("gmial.com", "hotmail.con", "outlok.com"), finais trocados em qualquer domínio (".con", ".combr", ".og.br") e o domínio do CITi ("citi.org", "citi.og.br", "siti.org.br", "joao@citi") — este evita que um membro pague R$ 12,00 por engano. Domínios curtos (me.com, live.com…) ficam fora para não haver palpite em domínio real. |
| Campos começam com o comprador lembrado; com tudo preenchido, no computador o foco vai para "Confirmar Pedido" | Pedido do produto (13.3). |
| Linhas da gaveta: preço da faixa com `showPrice` e "+" travado pelo estoque (patch 3 da seção 4) | Mantidos da plataforma. |

### 13.3 Comprador lembrado

- Quando o servidor aceita o pedido (`onCreated` de `checkout-api.js`), `pdv.js` faz `PUT /api/comprador` com nome, sobrenome e e-mail (pedido recusado não lembra ninguém); o servidor responde com um cookie `rb_comprador` (`HttpOnly`, `SameSite=Strict`, `Path=/api/comprador`, `Secure` em HTTPS, 400 dias). Nada vai para o banco.
- Ao abrir a loja, `pdv.js` lê `GET /api/comprador` (pré-carregado no `loja.html`, em paralelo com produtos e preços) e a identificação já vem preenchida, com o aviso de membro/não membro à vista. Cada leitura renova o prazo; quem confirmar com outros dados passa a ser o lembrado.
- Por que cookie do servidor e não `localStorage`: o Safari (iPhone) apaga em 7 dias sem visita tudo o que a página grava por script (`localStorage`, IndexedDB, `document.cookie`), mas não cookie definido pelo servidor. 400 dias é o máximo que Chrome e Safari aceitam.
- Cookie corrompido ou inválido é apagado e a identificação começa vazia. Falha de rede ao ler ou gravar nunca atrapalha a compra.
- O cookie não acompanha as outras requisições (`Path`), não é legível por script (`HttpOnly`) e não aparece em log. Navegação anônima ou limpar os dados do site esquecem o comprador (esperado).

### 13.4 Correção no loading encontrada aqui

Depois de pousar, a imagem da geladeira continuava na camada do loading (`z-index: 9999`), por cima da gaveta e do véu: sem WebGL para sempre, e com WebGL se o carrinho fosse aberto antes de o 3D assumir. Agora `boot.js` marca `.boot.is-landed` ao fim do ato 1 e ela desce para a camada do canvas (`z-index: 1`): acima do fundo, abaixo de painel (4), cabeçalho (5–6), aviso (7), véu (8) e gaveta (9). A animação do LED não reinicia (o nó não muda de lugar).

### 13.5 Verificação

- `tests/test_buyer_memory.py`: cookie restrito, renovação, troca de comprador, recusa de dado inválido, limite de 80 caracteres e cookie corrompido.
- `npm run test:ui` (11 tamanhos): entrada na identificação com o carrinho inerte, campos e botão dentro da tela, erro de campos vazios, maiúsculas ao digitar, sugestão "joao@gmial.com" → "joao@gmail.com" e "Corrigir", total de não membro (4 × R$ 12,00 com R$ 30,00 riscado), e-mail mal formado, membro (R$ 30,00), `customer` do pedido arrumado, voltar mantendo os dados; e o comprador lembrado chegando preenchido e sendo gravado de novo quando o pedido é aceito.

## 14. Pagamento Pix (fase 2b, 2026-11-19)

Feito na plataforma, sem pacote de design: segue o molde das duas primeiras etapas da gaveta. Não havia tela de pagamento na loja nova para apagar; o que existia era o aviso provisório "Pagamento Ainda Não Conectado" (removido, seção 9). A tela de Pix do PDV antigo já tinha saído na fase 1 (está só no backup). O back-end não mudou.

### 14.1 Fluxo

Carrinho → identificação → "Confirmar Pedido" → `POST /api/orders` (o botão gira enquanto isso) → **Pix na mesma gaveta**:

- cabeçalho: a pessoa dá lugar a uma **pilha de cédulas** que se desenha (a de trás, a da frente e a moeda em sequência, depois os pontos do canto; sem título, como nas outras etapas; fica verde quando o pagamento é aprovado). O ícone de QR foi trocado para não repetir o QR do corpo; o "voltar" vira **cancelar** (vermelho, dois toques com o anel de contagem, como o "esvaziar"); o **X some**, porque com o Pix em aberto a gaveta não fecha (Esc, véu e arrasto também não);
- corpo, tudo em branco e cinza neutro (sem azul nem a cor do sabor): QR num cartão branco dentro de moldura de vidro com luz branca, revelado do centro para as bordas uma vez, **sem efeito de leitura**; as peças entram em sequência (QR, situação, código); situação num cápsula com o **relógio de ponteiros**, o `mm:ss` (dígitos sem efeito, só trocam de número) e "Aguardando Pagamento" com um brilho branco correndo pelas letras (sem bolinha; "Verificando Pagamento" quando a consulta falha ou o prazo zera, com o brilho mais rápido); código num campo no molde dos da identificação (rótulo "Pix Copia e Cola", código que se apaga na ponta, botão de copiar que vira ✓; tocar e segurar no código seleciona tudo); "Simular Pagamento" (tracejado e neutro) só com `payment.simulated`;
- relógio (`payment-clock.js`): mostrador de vidro com marcas, **dois ponteiros brancos que leem o mesmo `mm:ss`** (o dos minutos aponta os minutos que restam numa volta de 60, o dos segundos aponta os segundos) e o setor claro do 12 até o ponteiro dos minutos; caminham para trás e se encontram no 12 quando o prazo acaba. O dos segundos anda como o de quartzo: parado, salta 6° por segundo e dá um repique (mola subamortecida: passa ~2° do ponto e assenta em ~0,3 s); o dos minutos desliza devagar. Atualizado a cada quadro (`requestAnimationFrame`) a partir do prazo do servidor, sem deriva; com "reduzir movimento" os ponteiros só trocam de lugar a cada segundo. No último minuto só o aro do relógio respira;
- rodapé: total e quantidade **do pedido criado** (valores do servidor) e "Copiar Código Pix" → "Código Copiado ✓" (a troca do "Adicionar" → "Adicionado"), em vidro neutro: nesta etapa o botão não leva o tom do sabor nem o azul do aro, e o foco do teclado é branco.

Telas finais, no mesmo lugar do QR (orbe de vidro no tom do resultado, ícone que se desenha), com o X de volta:

| Situação | Tela | Botão |
|---|---|---|
| paga | "Pagamento Aprovado", "Pode Pegar Suas Latas na Geladeira.", as latas (`2× Original`), "Pedido #ABCD1234"; o ícone do cabeçalho fica verde | "Concluir": esvazia o carrinho, fecha a gaveta, relê o estoque |
| expirada | "Tempo Esgotado", orienta a procurar o time de Gente & Gestão se já pagou | "Voltar ao Carrinho" |
| falha | "Pagamento Não Concluído", nada foi cobrado | "Voltar ao Carrinho" |
| cancelada fora da loja | "Cobrança Cancelada" | "Voltar ao Carrinho" |

Fechar a gaveta numa tela final vale o mesmo que o botão (paga: esvazia; as outras: devolvem as latas).

### 14.2 Situação e prazo

- O prazo é o do servidor (`PAYMENT_CHECKOUT_EXPIRES_IN`, hoje 10 min; decisão do produto: não mudar). Quem expira é o servidor; a contagem só mostra e, ao zerar, consulta na hora.
- O relógio do aparelho é corrigido pelo cabeçalho `Date` das respostas: celular com hora errada não mostra prazo errado.
- `payment-watch.js` consulta a cada 2,5 s, uma consulta por vez, e descarta resposta de cobrança antiga. Quando a página volta a ficar visível (a pessoa volta do app do banco), consulta na hora.
- Mapa da situação (`checkout-api.js`): `PAID`/`APPROVED` → paga; `EXPIRED` → expirada; `FAILED` → falha; `CANCELLED` (pedido ou pagamento) → cancelada; o resto → em aberto.

### 14.3 Latas de volta ao carrinho e estoque que mudou

Decisão do produto: cancelar, expirar ou falhar **devolve as latas ao carrinho** (a reserva já foi liberada pelo servidor). Antes, o estoque é relido (`GET /api/products`) e o carrinho passa a caber nele:

- sabor com menos latas: a quantidade cai e o aviso diz "Só Restam 2 Latas de Tropical.";
- sabor esgotado: sai do total e fica **em preto e branco** no carrinho, com "Esgotado" e só o botão de tirar ("Original Esgotou.");
- mais de uma mudança: "O Estoque Mudou. Seu Carrinho Foi Ajustado.".

A mesma conferência roda quando `POST /api/orders` responde `409` (alguém levou as latas antes): a gaveta volta ao carrinho ajustado. O carrossel, o painel e a geladeira 3D seguem o estoque novo. O carrinho continua só em memória (sem `localStorage`): quem fecha a página perde o carrinho, e o servidor expira a cobrança no prazo.

### 14.4 Erros

| Caso | O que acontece |
|---|---|
| `POST` 502 / sem rede | Fica na identificação, campos preservados, aviso "Não Foi Possível Gerar o Pix. Tente De Novo." |
| `POST` 422 | Aviso "Confira Nome e E-Mail e Tente De Novo." |
| `POST` 409 | Volta ao carrinho ajustado ao estoque (14.3) |
| Cancelar com falha do provedor | Continua no Pix, aviso "Não Foi Possível Cancelar. Tente De Novo." |
| Cancelar em conflito (`409`: pago ou expirado antes) | Consulta na hora e mostra a tela final certa |
| Consulta falhando | "Verificando Pagamento" (ponto âmbar) e segue tentando |
| QR não carregou | O cartão diz "Use o Pix Copia e Cola"; o código continua ali |

### 14.5 Lembrança do comprador

Passou a ser gravada quando o servidor **aceita** o pedido (antes: no clique em "Confirmar Pedido"). Pedido recusado não lembra ninguém.

### 14.6 Verificação

- `npm run test:ui` (11 tamanhos, mais 4 cenários dedicados): Pix com QR carregado, contagem ~10:00, total e código certos, relógio com o ponteiro dos minutos em ~60°, setor do tempo restante e o ponteiro dos segundos saltando e parando entre os tiques, andando para trás, sem efeito de leitura nem bolinha nem anel, tudo dentro da tela, QR com pelo menos 118 px, X escondido e Esc sem efeito; corpo do `POST /api/orders` só com nome, e-mail, sabores e quantidades; cancelar em dois toques devolvendo as 4 latas com aviso; falha 502 sem lembrar o comprador; 409 com o sabor esgotado em preto e branco, sem "Finalizar Compra" e com o carrossel atualizado; pago pelo modo de testes (tela, latas, número do pedido, "Concluir" esvaziando); expirado com estoque mudando no meio (consulta ao voltar à página, quantidade reduzida, sabor esgotado e aviso).
- Capturas conferidas em 320×568, 360×640, 390×844, 844×390 (celular deitado) e 1440×900.
- **Não testado:** Mercado Pago real (QR do provedor lido por app de banco, webhook) e celular de verdade (área de transferência, volta do app do banco, Safari). Fazer antes do deploy.

## 15. Pronto para produção e celulares fracos (2026-11-19)

Backup antes: `~/Downloads/redbull_compra_citi-main_backup-pre-producao_20261119.tar.gz` (só código).

### 15.1 Sem modo simulado
- O app só fala com o Mercado Pago: `create_payment_provider` sempre monta o `MercadoPagoProvider` e valida as credenciais (sem `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET` o app não sobe). Não existe `/api/mock/*` nem "Simular Pagamento".
- `PaymentProvider.MOCK` continua só como valor histórico: a migration `b7f2e6c9a104` gravou pagamentos antigos com ele e o tipo do banco o contém (tirar quebraria a leitura desses pedidos). Nenhum pagamento novo usa MOCK; os ramos "só Mercado Pago" do `payment_service.py` continuam protegendo essas linhas antigas.
- Testes: `tests/fakes.py` tem o `FakePixProvider` (se apresenta como `mercadopago`) e `pay_via_webhook` (o provedor passa a dizer "aprovado" e o webhook assinado chega ao app: o caminho real). O `lifespan` respeita um provedor já posto em `app.state` (é assim que o `conftest.py` injeta o falso) e a rotina de expiração lê o provedor de lá.
- Ferramentas (`tools/local-server-env.mjs`): o servidor local do teste de interface e do gerador do pôster sobe com credenciais fictícias e a rotina de expiração parada; a API que a página usa é toda respondida pelo teste.

### 15.2 Railway
`railway.json` (início com `--proxy-headers --forwarded-allow-ips '*'`, verificação em `/api/health`, um processo só); `requirements.txt` só de produção e `requirements-dev.txt` com pytest; logs configurados (`LOG_LEVEL`, sem o registro por requisição do httpx); `/docs` e `/openapi.json` só com `API_DOCS=1`. Roteiro de deploy e da compra de teste real no `README.md`.

### 15.3 Modo do aparelho (`src/device-tier.js`)
Decidido em `pdv.js` antes de qualquer download da geladeira:

| Modo | Quando | O que acontece |
|---|---|---|
| `full` | o resto | geladeira 3D como sempre (o motor escolhe a qualidade pela tela) |
| `low` | `deviceMemory` ≤ 2 GB ou ≤ 2 núcleos | geladeira 3D no nível leve do motor (`quality: 'low'`: resolução 1x, sem sombras) |
| `none` | sem WebGL 2 (ou lento demais segundo o navegador, `failIfMajorPerformanceCaveat`), GPU por software ou muito antiga (Mali-400/T6xx/T7xx, Adreno 2xx–5xx antigas, PowerVR SGX…), textura máxima < 4096, `deviceMemory` < 2 GB, economia de dados, rede 2G ou `prefers-reduced-data` | **nada da cena é baixado** (antes, até sem WebGL, ~55 MB); fica a imagem da geladeira com o vidro embaçado do loading; `html.is-lite` troca o vidro desfocado por camadas translúcidas (`assets/styles/lite.css`) e desliga a refração SVG; a compra funciona igual |

O Safari não informa memória nem núcleos reais: iPhone fica em `full`. `?3d=0`, `?3d=low`, `?3d=1` forçam um modo. Sem cena (modo `none` ou WebGL recusado na montagem), `.app.no-3d` esconde porta e recentralizar, que antes ficavam visíveis sem efeito. `prefetchCoolerScene` também não baixa nada sem WebGL.

### 15.4 Outros ganhos
- Lata escolhida para de flutuar com a gaveta aberta (identificação e Pix): o balanço redesenhava a cena inteira a cada quadro por trás do véu.
- Artes do gabinete e logo em WebP sem perda (mesmos pixels): 2,0 MB → 1,28 MB e 55 → 26 KB.
- Latas 3D: texturas WebP sem perda + malha em 16 bits (seção 10.5): 49 → 32 MB comprimidas no modo completo. Conferido com captura da geladeira 3D: a diferença para o original (média 0,012 por canal) é menor que a variação entre duas capturas do próprio original (0,023, as gotas da condensação mudam a cada vez).
- Fotos do carrossel: só a primeira com prioridade alta; as outras 11 não disputam banda com a API e a interface.
- Condensação com a gaveta aberta: as gotas e o embaçado seguem iguais (a simulação anda a cada quadro), mas a cena é redesenhada no máximo ~15 vezes por segundo enquanto a geladeira está atrás do véu desfocado, e o último estado sempre é desenhado. Medido (celular 390×844, DPR 2, GPU): script com a gaveta parada 423 → 273 ms a cada 5 s.
- Rosto do carrinho vazio animava sem parar com a gaveta fechada: no `cart.css` do design o `animation` de cada parte desfazia a pausa. Agora só anima com a gaveta aberta (`pdv.css`). O brilho de espera do QR só corre com o Pix na tela. Medido no modo leve com a loja parada: trabalho 324 → 98 ms a cada 5 s, layout 70 → 0 ms.
- Montagem do 3D: a volta da malha das latas para float é um laço direto no array (não leitura valor a valor) e o teste de WebGL é feito uma vez só por página (`supportsWebGL` em `src/device-tier.js`, usado também pela cena). Medido no carregamento: ~115 ms + ~52 ms a menos de CPU.
- `.app` com `overflow: clip`: foco num campo ou `scrollIntoView` não conseguem mais rolar a loja e deslocar a gaveta para cima (aparecia no celular deitado).

### 15.5 Não feito (e por quê)
- **Latas com texturas WebP com perda (q95):** levaria as latas a ~22 MB comprimidas, mas é compressão com perda; ficou de fora pela regra de não perder qualidade.
- **`pytest` completo:** o banco de testes roda no Docker, que não sobe com o disco cheio. Rodados: os testes que não usam banco (`test_payments`, `test_buyer_memory`, `test_frontend_email`).

