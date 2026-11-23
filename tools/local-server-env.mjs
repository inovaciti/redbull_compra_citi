// Ambiente do servidor local que as ferramentas sobem (teste de interface e gerador do pôster).
// A página delas não fala com o Mercado Pago: as credenciais são fictícias (o app exige as duas
// para subir) e a rotina de expiração fica praticamente parada.
export const LOCAL_SERVER_ENV = {
  MERCADOPAGO_ACCESS_TOKEN: 'ferramenta-local-sem-uso',
  MERCADOPAGO_WEBHOOK_SECRET: 'ferramenta-local-sem-uso',
  PAYMENT_EXPIRATION_CHECK_INTERVAL: '86400',
};
