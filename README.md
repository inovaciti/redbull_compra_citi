# Red Bull PDV

Autoatendimento mobile para venda de Red Bull com reserva de estoque e pagamento Pix. As cobranças são feitas pelo Mercado Pago (o único provedor; localmente, com as credenciais de teste da integração).

## Fluxo de compra

O comprador seleciona os produtos, informa nome e e-mail, confirma a identificação e então recebe o QR Code Pix. O e-mail é validado no navegador e no backend, normalizado e persistido em `orders.payer_email`; registros antigos podem continuar com `NULL`. A criação da Order usa exclusivamente o e-mail persistido no pedido em `payer.email`.

O preço depende do e-mail do pagador, decidido no backend (`pricing_audience_for_email` em `app/models.py`): e-mail `@citi.org.br` paga a tabela de membro (1 lata R$ 8,50; 2 ou 3 latas R$ 8,00 cada; 4 ou mais R$ 7,50 cada, pela quantidade total do pedido) e os demais pagam um preço único por lata. A tabela é fixa no código (`app/pricing.py`) e travada no banco; o painel `/estoque` só a exibe. O cliente não escolhe a tabela; links antigos com `?pricing=` continuam abrindo a loja e o parâmetro é ignorado.

O e-mail do pagador não é uma variável de ambiente. Não configure `MERCADO_PAYER_EMAIL` nem `MERCADOPAGO_PAYER_EMAIL`: cada comprador informa o próprio e-mail no checkout.

Após o pagamento, o webhook assinado consulta `GET /v1/orders/{provider_order_id}`. A confirmação altera pedido, pagamento, reserva e estoque na mesma transação, com locks de linha e verificações de estado para impedir desconto duplicado. Uma reconciliação periódica consulta pagamentos pendentes antes da expiração, cobrindo webhooks perdidos ou consultas precoces.

Nunca corrija somente `orders.status` nem desconte estoque diretamente por SQL. Use o comando de reconciliação, que reutiliza a transação central. Entradas, saídas manuais e ajustes de estoque são feitos pelo painel `/estoque`.

## Configuração

Produção usa variáveis de ambiente, sem valores no Git:

```env
DATABASE_URL=
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_SECRET=
CHARGE_EXPIRES_IN=1800
PAYMENT_CHECKOUT_EXPIRES_IN=600
PAYMENT_EXPIRATION_CHECK_INTERVAL=5
STOCK_SESSION_COOKIE_SECURE=true
```

O webhook deve ser cadastrado como `POST /api/webhooks/mercadopago`. A aplicação, o segredo do webhook e o Access Token precisam pertencer à mesma integração/conta do Mercado Pago. Não registre tokens, assinaturas, QR Code, código copia e cola ou e-mail completo em logs.

Não existe modo simulado: localmente o app usa as credenciais de **teste** da integração do Mercado Pago (o app recusa subir sem `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET`). Os testes automáticos usam um provedor falso que só existe em `tests/fakes.py`.

## Deploy no Railway

`railway.json` define o início e a verificação de saúde:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips '*' --no-server-header
```

- `--proxy-headers`/`--forwarded-allow-ips`: o Railway termina o HTTPS no proxy dele; com isso o app vê `https` (o cookie do comprador lembrado sai com `Secure`) e o IP real de quem tenta entrar no painel (o bloqueio por tentativas é por IP).
- **Um único processo** (o padrão): a rotina que expira cobranças e reconcilia pagamentos roda dentro dele; vários workers multiplicariam as consultas ao Mercado Pago.
- Variáveis: as da seção acima, no serviço do app. Use o Postgres do próprio Railway ou o institucional (`DATABASE_URL` com o driver `postgresql+asyncpg://`). `LOG_LEVEL` é opcional; `API_DOCS` fica **desligada**.
- Migrations são um passo manual e explícito (`alembic upgrade head`), nunca no início automático; contra o banco institucional, só com autorização e o roteiro do `CLAUDE.md`.
- Webhook: cadastrar `https://<domínio>/api/webhooks/mercadopago` na integração do Mercado Pago (eventos de Order), com o mesmo segredo de `MERCADOPAGO_WEBHOOK_SECRET`.
- `/api/health` responde `{"status": "ok"}` (não toca o banco).

Antes de abrir ao público: uma compra real de valor baixo (QR lido por app de banco e também copia e cola), conferir o pedido pago e a saída no `/estoque`, e um cancelamento. Testar num celular de verdade, de preferência um antigo.

## Execução local

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
docker compose up -d postgres
alembic upgrade head
uvicorn app.main:app --reload
```

A aplicação fica em `http://127.0.0.1:8000`; a documentação da API em `/docs` só com `API_DOCS=1`.

## Interface da loja

A loja (`/`) é HTML/CSS/JS puro em módulos ES, sem etapa de build, em `app/static/storefront/` (geladeira 3D do Kit Mini Cooler em `cooler/`, com Three.js e GSAP servidos localmente). A página `app/templates/loja.html` é servida com CSP estrita. Bibliotecas e fontes de terceiros: `docs/licencas-frontend.md`.

Teste de interface (Chromium real, 11 tamanhos de tela, com e sem WebGL):

```bash
npm install
npx playwright install chromium
npm run test:ui
```

## Controle de estoque (`/estoque`)

Painel com login para operadores registrarem entradas e saídas de Red Bull. Ele lista todos os sabores cadastrados em `products` (os mesmos do marketplace), mostra estoque físico, reservas PIX abertas e o que está disponível no PDV, e tem os botões **− Saída** (venda manual ou perda) e **+ Entrada** (reposição). Administradores também podem lançar um **ajuste de inventário** (contagem física).

Toda alteração de `products.stock` fica registrada em `stock_movements` pelo trigger `trg_products_stock_ledger`, inclusive as vendas pagas no marketplace: quem comprou (nome e e-mail), quantas latas saíram, horário, pedido, preço unitário e operador. Alterações feitas direto por SQL também são registradas, como `UNTRACKED`. Use o painel para repor ou corrigir estoque; não faça `UPDATE products SET stock` manual.

Primeiro acesso:

```bash
alembic upgrade head                      # cria staff_users, staff_sessions, stock_movements, trigger e views
psql "$URL_DO_BANCO" -f sql/seed_sabores.sql   # opcional: cadastra os 12 sabores com estoque 0
python -m scripts.create_staff_user --username seu.usuario --name "Seu Nome" --role ADMIN
```

Depois acesse `http://127.0.0.1:8000/estoque`. Em desenvolvimento sem HTTPS, defina `STOCK_SESSION_COOKIE_SECURE=false`.

- Modelo de dados em SQL puro: `sql/estoque_schema.sql` (idêntico à revisão `c3f8a1d27b54`).
- Relatórios prontos (saídas do dia, quem comprou, ranking de sabores, integridade): `sql/consultas_estoque.sql`.
- Plano de ação e fluxo completo: `docs/plano-acao-estoque.md`.

## Alembic e banco institucional

Na auditoria de 2026-08-11, o banco institucional estava em `e91a7c4d2f30`; o histórico local anterior tinha `a6c42f1d9b73` como head. O banco também contém `users` e `stock_adjustments`, tabelas externas ao ORM/histórico deste serviço, que devem ser preservadas. As colunas históricas `products.description`, `products.color` e `products.price`, presentes em instalações criadas do zero mas ausentes no banco institucional, também são preservadas. Esses objetos estão marcados como não gerenciados no autogenerate para impedir propostas destrutivas.

A revisão `4c7b91e2a6d0` parte do estado remoto `e91a7c4d2f30`, adiciona `orders.payer_email` como anulável e só cria `products.category` quando ausente. A revisão `7e03d1bf5a42` une essa linha à revisão de preço `a6c42f1d9b73`. Nenhuma migration foi aplicada em produção durante esta implementação.

Ordem segura de implantação:

1. confirmar `alembic current`, `alembic heads` e o schema real;
2. confirmar backup/ponto de restauração;
3. testar upgrade e downgrade em cópia ou banco de teste;
4. revisar que `users` e `stock_adjustments` não serão alteradas;
5. aplicar a migration aprovada;
6. implantar backend e frontend;
7. executar uma compra controlada e validar pagamento/reserva/estoque.

Não use `alembic stamp head` e não aplique a migration no banco institucional sem autorização explícita.

## Reparo controlado

Simulação por ID interno:

```bash
python -m scripts.reconcile_payment --order-id UUID_DO_PEDIDO --dry-run
```

Simulação por ID do Mercado Pago:

```bash
python -m scripts.reconcile_payment --provider-order-id ID_DA_ORDER --dry-run
```

Depois de revisar o status e a compatibilidade do valor, remova `--dry-run` para executar. O evento usa uma chave idempotente derivada de `manual-reconciliation:{provider_order_id}` e a mesma função transacional do webhook.

As consultas de leitura para pagamentos pendentes e consistência das reservas estão em [`docs/payment_diagnostics.sql`](docs/payment_diagnostics.sql).

O inventário dos arquivos adicionados, as decisões de implementação e os procedimentos operacionais estão em [`docs/alteracoes-recentes.md`](docs/alteracoes-recentes.md).

## Testes

Os testes usam exclusivamente `TEST_DATABASE_URL`. O nome do banco precisa começar com `test` ou terminar com `_test`, e a URL não pode ser igual a `DATABASE_URL`.

```bash
docker compose up -d postgres_test
pytest
```
