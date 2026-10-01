# Gateway de pagamento: requisitos

- **Status:** Em definição
- **Data:** 2026-10-01

Este é o documento **interno** do gateway. A empresa conhece apenas o contrato público, exportado para `contracts/third-party-apis/gateway.yaml` ([ADR 0009](../../../../docs/adr/0009-openapi-gerado-do-zod.md)). Regras internas, como a injeção de caos e a simulação do pagador, nunca aparecem nesse contrato.

A coluna **Fase** indica em que fase do roteiro (seção 11 do `project.md`) cada item passa a ser necessário. Nada além da fase atual é implementado antes de a fatia vertical conciliar de ponta a ponta.

## 1. Endpoints

### 1.1 API pública

A API fica exposta na rede `internet`. Todas as rotas `/v1` exigem `Authorization: Bearer sk_...`.

| Método | Rota | Função | Fase |
| --- | --- | --- | --- |
| POST | `/v1/charges` | Cria uma cobrança | 1 |
| GET | `/v1/charges/{id}` | Consulta uma cobrança | 1 |
| GET | `/v1/charges` | Lista com cursor; filtra por status, método, período e `metadata[order_id]` | 1 |
| POST | `/v1/charges/{id}/capture` | Captura uma autorização de cartão, total ou parcial | 1 |
| POST | `/v1/charges/{id}/cancel` | Cancela uma autorização não capturada ou um Pix/boleto pendente | 1 |
| POST | `/v1/webhook-endpoints` | Cadastra uma URL de webhook e devolve o segredo | 1 |
| GET | `/v1/webhook-endpoints` | Lista os endpoints de webhook | 1 |
| DELETE | `/v1/webhook-endpoints/{id}` | Remove um endpoint de webhook | 1 |
| POST | `/v1/reports/settlements` | Solicita o relatório de liquidação de um período | 2 |
| GET | `/v1/reports/{id}` | Mostra o status do relatório e, quando pronto, a URL pré-assinada do CSV | 2 |
| GET | `/v1/payouts` | Lista os repasses (opcional) | 2 |
| GET | `/v1/payouts/{id}` | Consulta um repasse (opcional) | 2 |
| POST | `/v1/charges/{id}/refunds` | Cria um estorno total ou parcial | 5 |
| GET | `/v1/charges/{id}/refunds` | Lista os estornos de uma cobrança | 5 |
| GET | `/v1/refunds/{id}` | Consulta um estorno | 5 |
| GET | `/v1/disputes` | Lista os chargebacks | 5 |
| GET | `/v1/disputes/{id}` | Consulta um chargeback | 5 |
| GET | `/v1/events` | Lista o log de eventos, para recuperar webhooks perdidos | 6 |
| GET | `/v1/events/{id}` | Consulta um evento | 6 |

### 1.2 Documentação e infraestrutura

Estas rotas não exigem autenticação.

| Método | Rota | Função | Fase |
| --- | --- | --- | --- |
| GET | `/openapi.json` | Especificação OpenAPI gerada dos schemas Zod | 1 |
| GET | `/docs` | Documentação navegável da API | 1 |
| GET | `/health/live` | O processo está de pé | 1 |
| GET | `/health/ready` | RDS, ElastiCache e os serviços AWS usados pelo papel estão acessíveis | 1 |

### 1.3 Webhooks emitidos

| Evento | Quando | Fase |
| --- | --- | --- |
| `charge.authorized` | Cartão autorizado, aguardando captura | 1 |
| `charge.paid` | Cobrança paga (captura do cartão, Pix pago, boleto compensado) | 1 |
| `charge.failed` | Cartão recusado | 1 |
| `charge.canceled` | Cobrança cancelada | 1 |
| `charge.expired` | Autorização, Pix ou boleto expirado | 1 |
| `refund.succeeded` | Estorno concluído | 5 |
| `refund.failed` | Estorno recusado | 5 |
| `dispute.created` | Chargeback aberto | 5 |
| `dispute.closed` | Chargeback encerrado, ganho ou perdido | 5 |
| `payout.paid` | Repasse transferido ao banco (opcional) | 2 |

O vocabulário é propositalmente diferente do da empresa (por exemplo, `charge.paid` aqui e `payments.charge-captured` lá). A tradução é responsabilidade da camada de integrações.

## 2. Requisitos funcionais

### Contas e acesso

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-01 | Existe uma conta de lojista com API keys, endpoints de webhook, tabela de taxas, agenda de liquidação e conta bancária de repasse. A conta é criada por seed, sem API pública de cadastro. | 1 |
| RF-02 | Toda requisição é autenticada por API key, e todo recurso pertence a uma conta. | 1 |

### Cobranças

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-03 | Criar cobranças de cartão à vista, com `metadata` livre. A aprovação é decidida na criação a partir de tokens de teste (`tok_approved`, `tok_insufficient_funds`, `tok_fraud`, `tok_will_dispute`). Com `capture: true`, que é o padrão, a cobrança é capturada direto; com `false`, só autorizada. | 1 |
| RF-04 | Criar cobranças de cartão parcelado, de 2 a 12x. | 2 |
| RF-05 | Criar cobranças Pix, com QR code, código copia-e-cola e expiração, e boleto, com linha digitável, código de barras e vencimento. | 2 |
| RF-06 | Capturar, total ou parcialmente, e cancelar cobranças. | 1 |
| RF-07 | Consultar e listar cobranças com paginação por cursor e filtros. O filtro `metadata[order_id]` permite achar a cobrança quando o cliente não recebeu a resposta da criação. | 1 |
| RF-08 | Expirar automaticamente autorizações não capturadas (fase 1), Pix não pagos e boletos vencidos (fase 2). | 1 e 2 |

### Estornos e disputas

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-09 | Criar estornos totais ou parciais, processados de forma assíncrona: `pending`, depois `succeeded` ou `failed`. | 5 |
| RF-10 | Registrar chargebacks de cartão, que podem chegar meses depois, e encerrá-los como ganhos ou perdidos. | 5 |

### Webhooks e eventos

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-11 | Gerar um evento para toda mudança de estado de cobrança, estorno, disputa e repasse. | 1 |
| RF-12 | Entregar os eventos aos endpoints cadastrados, assinados com HMAC-SHA256, com retentativa e backoff. | 1 |
| RF-13 | Expor o log de eventos pela API. Os eventos são guardados desde a fase 1; a API entra na fase 6. | 6 |

### Liquidação, repasses e relatórios

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-14 | Gerar a agenda de liquidação: uma linha por parcela de cartão, por Pix e por boleto, com valor bruto, taxa e líquido. | 2 |
| RF-15 | Fechar um repasse diário por conta e transferir o líquido para a conta bancária do lojista pela API interbancária do banco ([ADR 0010](../../../../docs/adr/0010-repasse-pela-api-do-banco.md)). | 2 |
| RF-16 | Gerar o relatório de liquidação em CSV de forma assíncrona, guardá-lo no S3 do Floci do gateway e disponibilizá-lo por URL pré-assinada, servida pelo proxy de borda como `gateway-s3` ([ADR 0005](../../../../docs/adr/0005-floci-por-organizacao.md) e [ADR 0011](../../../../docs/adr/0011-topologia-de-rede.md)). | 2 |

### Simulação e caos

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-17 | Injetar cada falha do catálogo (seção 7.1 do `project.md`) num ponto explícito do código, controlada por probabilidade e seed ([ADR 0006](../../../../docs/adr/0006-configuracao-e-decisoes-de-caos.md)): webhook perdido, duplicado ou fora de ordem; cobrança duplicada; timeout após sucesso; taxa diferente da contratada; relatório atrasado, incompleto ou republicado; linha de liquidação no lote errado; chargeback tardio; respostas 429 e 5xx. | 6 |
| RF-18 | Simular o pagador com um worker interno: pagar Pix e boletos (fase 2) e abrir chargebacks (fase 5). Os parâmetros vêm da seção `behavior` da configuração do gateway no AppConfig ([ADR 0013](../../../../docs/adr/0013-appconfig-para-configuracao-de-caos.md)), as decisões são determinísticas e as ações são agendadas na tabela de agendamentos ([ADR 0007](../../../../docs/adr/0007-agendamento-em-tempo-simulado.md)). | 2 e 5 |
| RF-19 | Emitir um evento de telemetria `chaos.injected` para cada falha injetada, com tipo, alvo, instante simulado e versão dos parâmetros. | 6 |

### Documentação

| ID | Requisito | Fase |
| --- | --- | --- |
| RF-20 | Publicar a especificação em `/openapi.json` e a documentação navegável em `/docs`, ambas geradas dos schemas Zod. | 1 |

## 3. Regras de negócio

Os valores numéricos são exemplos configuráveis por conta.

### Valores e limites

- **RN-01:** Valores são sempre centavos inteiros. A única moeda aceita é BRL; qualquer outra resulta em 422.
- **RN-02:** Limites por método:
  - cartão: de R$ 1,00 a R$ 50.000,00;
  - cartão parcelado: de 2 a 12x, com parcela mínima de R$ 5,00;
  - boleto: a partir de R$ 5,00.
- **RN-03:** O boleto exige nome e CPF/CNPJ válido do pagador, com checagem dos dígitos verificadores. O vencimento padrão é D+3 e o máximo, D+30.
- **RN-04:** O Pix expira em 30 minutos por padrão, configurável até 24 horas.
- **RN-05:** O `metadata` aceita até 20 chaves, cada chave com até 40 caracteres e cada valor com até 500. Ele só aparece no objeto da cobrança e nos eventos `charge.*`. Eventos de estorno e de disputa trazem apenas o `charge_id` (seção 6.2 do `project.md`).

### Estados da cobrança

- **RN-06:** Ciclo de vida:
  - **Cartão:** `pending` vai para `authorized` ou `failed`; `authorized` vai para `paid`, `canceled` ou `expired`. Com `capture: true`, a cobrança vai de `pending` direto para `paid`.
  - **Pix e boleto:** `pending` vai para `paid`, `canceled` ou `expired`.

  Estados finais nunca mudam. Estornos e disputas são recursos próprios, ligados à cobrança, e não estados dela.
- **RN-07:** Uma autorização não capturada expira em 7 dias.
- **RN-08:** A captura parcial aceita qualquer valor até o autorizado, e o restante é liberado. Cada cobrança só pode ser capturada uma vez.
- **RN-09:** Um boleto pago no dia P só vira `paid` na compensação, em P+1 dia útil.

### Taxas e parcelamento

- **RN-10:** Cada conta tem uma tabela de taxas com data de vigência (`effective_from`), e vale a tabela vigente na data da captura.

  | Método | Taxa |
  | --- | --- |
  | Cartão à vista | 3,49% |
  | Cartão de 2 a 6x | 3,99% |
  | Cartão de 7 a 12x | 4,49% |
  | Pix | 0,99% |
  | Boleto | R$ 3,49 fixo |
  | Chargeback | R$ 15,00 |

- **RN-11:** O valor de cada parcela é o total dividido por n. Os centavos que sobram vão para a primeira parcela.
- **RN-12:** A taxa é calculada por parcela e arredondada ao centavo, com meio centavo arredondado para cima. A soma das taxas das parcelas pode diferir em centavos da taxa sobre o total. Isso é intencional e alimenta a categoria de divergência `rounding`.
- **RN-13:** A taxa não é devolvida em estornos.

### Liquidação e repasses

- **RN-14:** Dia útil é de segunda a sexta, exceto feriados nacionais, incluindo os móveis (Carnaval, Sexta-feira Santa e Corpus Christi). Um prazo que cai em dia não útil passa para o próximo dia útil.
- **RN-15:** Prazos de liquidação:
  - cartão: a parcela i liquida em D+30·i a partir da captura;
  - Pix: D+0 ou D+1, conforme a configuração da conta;
  - boleto: D+1 útil depois da compensação.
- **RN-16:** O repasse é diário, por conta, num horário de corte (por exemplo, 06:00 em `America/Sao_Paulo`), e inclui todas as linhas vencidas até o dia. Cada repasse gera uma transferência para o banco, com `REPASSE <batch_id>` na descrição.
- **RN-17:** Estornos, chargebacks e tarifas entram como linhas negativas no próximo repasse. Se o líquido for zero ou negativo, não há repasse, e o saldo negativo passa para o dia seguinte.
- **RN-18:** O relatório tem uma linha por evento financeiro: parcela, estorno, chargeback, reversão de chargeback, tarifa ou ajuste. Cada linha traz `line_id` estável, `charge_id`, `batch_id`, bruto, taxa, líquido e as datas do evento. **Não** traz `order_id` nem `metadata` (seção 6.2 do `project.md`).
- **RN-19:** Quando o relatório é republicado com correções, as linhas corrigidas mantêm o `line_id`, e o relatório ganha uma nova versão.
- **RN-20:** A URL pré-assinada do CSV é gerada com o host `gateway-s3` e expira em 1 hora de **tempo real**, porque o Floci valida a expiração com o relógio do sistema. Um novo `GET /v1/reports/{id}` gera outra URL.
- **RN-30:** A transferência de um repasse é idempotente, com o id do repasse como chave. O repasse vai de `pending` para `paid` ou `failed`. Se falhar, o valor volta ao saldo e entra no repasse seguinte.

### Estornos e chargebacks

- **RN-21:** Só cobranças `paid` podem ser estornadas, e a soma dos estornos nunca passa do valor pago, mesmo com requisições concorrentes.
- **RN-22:** Prazos de estorno:
  - cartão: até 180 dias;
  - Pix: até 90 dias;
  - boleto: não suportado na v1, e a API responde 422 `refund_not_supported`. Na prática esse estorno exige dados bancários do pagador, e a recusa gera divergências `refund_not_reflected` para o conciliador.
- **RN-23:** Chargebacks valem só para cartão, até 120 dias depois da captura, e o valor é no máximo o pago menos o já estornado. O valor e a tarifa saem do próximo repasse. Se a disputa for ganha, o valor volta, sem a tarifa, numa linha `chargeback_reversal`.

### Idempotência, webhooks e limites

- **RN-24:** A `Idempotency-Key` é obrigatória em todo POST. A chave vale por conta e fica guardada por 24 horas.
- **RN-25:** Comportamento da chave:
  - mesma chave e mesmo corpo: devolve a mesma resposta, com o header `Idempotent-Replayed: true`;
  - mesma chave e corpo diferente: 422 `idempotency_key_reused`;
  - requisição com a mesma chave ainda em andamento: 409 `idempotency_key_in_use`.
- **RN-26:** Assinatura dos webhooks:
  - header `Gateway-Signature: t=<unix>,v1=<hmac>`;
  - HMAC-SHA256 calculado sobre `t.<corpo cru>` com o segredo `whsec_...` do endpoint;
  - entrega pelo menos uma vez, sem garantia de ordem, e cada evento tem um id `evt_...` único.
- **RN-27:** Quando a resposta não é 2xx ou passa de 10 segundos, o gateway tenta de novo com backoff exponencial e jitter por até 3 dias de tempo simulado, em cerca de 8 tentativas. Depois disso, a entrega é marcada como falha definitiva, mas o evento continua no log.
- **RN-28:** O rate limit é por API key: 25 req/s sustentado, com rajada de 100, e no máximo 10 solicitações de relatório por minuto. Quem passa do limite recebe 429 com `Retry-After`.
- **RN-29:** Os IDs têm prefixo por tipo (`ch_`, `re_`, `dp_`, `po_`, `evt_`, `rpt_`, `whe_`, `acct_`) e sufixo ordenável por tempo. O sufixo é derivado de dados determinísticos (o instante simulado e um hash da seed com a chave de origem), nunca de aleatoriedade, para que as decisões de caos baseadas nele sejam reproduzíveis.

## 4. Requisitos não funcionais

- **RNF-01, contrato gerado do código:** os schemas Zod das rotas geram o OpenAPI, exportado para `contracts/third-party-apis/gateway.yaml`. O `make lint` falha se o arquivo versionado estiver diferente do gerado. Os webhooks entram na seção `webhooks` do OpenAPI 3.1, e o formato do CSV é documentado ao lado ([ADR 0009](../../../../docs/adr/0009-openapi-gerado-do-zod.md)).
- **RNF-02, convenções da API:**
  - JSON em snake_case;
  - erros no formato `{ "error": { "type", "code", "message", "param" } }`;
  - um `Request-Id` em toda resposta;
  - códigos 400, 401, 404, 409, 422, 429 e 5xx com significado fixo;
  - dentro da v1, só mudanças aditivas.
- **RNF-03, isolamento** ([ADR 0011](../../../../docs/adr/0011-topologia-de-rede.md)):
  - o Floci do gateway e tudo o que ele cria (RDS, ElastiCache) ficam apenas na rede `third-party-gateway`;
  - a API e os downloads dos relatórios chegam à rede `internet` só pelo proxy de borda, como `gateway-api` e `gateway-s3`;
  - só o papel `worker` entra na rede `internet`, para chamar os webhooks da empresa e a API interbancária do banco;
  - o relógio, o orquestrador e o collector do modo deus alcançam o gateway pela rede `third-party-gateway`.
- **RNF-04, relógio simulado:** todo horário de negócio vem do `sim-clock`. O código de domínio nunca usa `Date.now()` nem `Temporal.Now`.
- **RNF-05, dois domínios de tempo:**
  - tempo simulado para prazos, expirações, agenda de liquidação, cortes, retentativas de webhook e comportamento do pagador;
  - tempo real para timeouts HTTP, rate limit, retentativas técnicas e expiração de URLs pré-assinadas.
- **RNF-06, agendamento em tempo simulado:** as tarefas futuras ficam na tabela `scheduled_jobs`, e o "agora" de cada job é o seu `run_at`. Os jobs rodam em ordem, com barreira por instante, e o serviço publica sua marca d'água ([ADR 0007](../../../../docs/adr/0007-agendamento-em-tempo-simulado.md)).
- **RNF-07, determinismo:** decisões aleatórias, de caos ou do pagador, vêm de `decide(seed, chave, decisão)` e nunca de `Math.random()`.
- **RNF-08, configuração de caos:** a configuração é um documento JSON no AppConfig do Floci do gateway, com `seed`, `chaos` e `behavior` ([ADR 0013](../../../../docs/adr/0013-appconfig-para-configuracao-de-caos.md)). O gateway:
  - consulta o documento periodicamente e o valida com Zod;
  - aplica cada versão nova de forma atômica;
  - publica a versão aplicada em `sim:config-version:gateway`;
  - registra em cada decisão a versão que usou.
- **RNF-09, consistência:** toda mudança de estado financeiro acontece numa transação do Postgres. Os eventos são gravados na mesma transação, num outbox interno, então nenhum evento se perde por falha do processo. As únicas perdas são as injetadas pelo caos.
- **RNF-10, concorrência:** operações sobre a mesma cobrança são serializadas com lock de linha, o que cobre estornos simultâneos e captura e cancelamento ao mesmo tempo.
- **RNF-11, desempenho e resiliência:**
  - p95 abaixo de 200 ms nos endpoints síncronos, sem caos;
  - avanços longos do relógio sem perda de jobs;
  - graceful shutdown;
  - entregas de webhook e jobs que sobrevivem a reinícios.
- **RNF-12, segurança:**
  - API keys guardadas como hash e comparadas em tempo constante;
  - um segredo por endpoint de webhook;
  - downloads apenas por URL pré-assinada;
  - PCI fora de escopo: o gateway só recebe tokens de teste, nunca números de cartão.
- **RNF-13, observabilidade:**
  - OpenTelemetry com traces, métricas e logs estruturados com `request_id`, enviados ao collector do modo deus, com `org=gateway`;
  - o gateway ignora qualquer `traceparent` recebido e não envia contexto de trace nos webhooks;
  - métricas de negócio próprias: cobranças por status, taxa de sucesso dos webhooks, valor repassado ([ADR 0008](../../../../docs/adr/0008-observabilidade-empresa-e-modo-deus.md)).
- **RNF-14, testabilidade:**
  - testes de propriedade para parcelas, taxas e agenda, garantindo que as somas sempre fecham;
  - testes de integração com Postgres 18 real e com um Floci efêmero para os adaptadores AWS;
  - testes de contrato das respostas contra o OpenAPI exportado.

## 5. Decisões internas

- **DI-01, simulação do pagador por worker interno:** o comportamento de quem paga (Pix, boleto) e de quem contesta (chargeback) é simulado dentro do gateway, porque faz parte do mundo que ele enxerga. O worker não expõe nenhuma rota. Ele é configurado pela seção `behavior` da configuração no AppConfig, recebe os eventos pela fila SQS `simulation` e agenda suas ações na tabela `scheduled_jobs`.
- **DI-02, vocabulário próprio:** estados e eventos usam a linguagem do gateway (`paid`, `charge.paid`), diferente da empresa, para que a camada anticorrupção tenha uma tradução de verdade a fazer.

## 6. Verificações pendentes

- **URLs pré-assinadas com IAM ligado:** confirmar que funcionam com a imposição de IAM ligada no Floci ([floci-io/floci#4367](https://github.com/floci-io/floci/issues/4367)) e passando pelo proxy de borda com o host `gateway-s3`.
- **Read replica do RDS:** confirmar se ela continua acompanhando o primário. Enquanto isso não for confirmado, a URL da réplica aponta para o primário.
- **EventBridge para SQS:** confirmar o roteamento por `detail-type` e o envio para a DLQ depois de esgotadas as tentativas.
- **Temporal na imagem Docker:** confirmar que a imagem usada pelo gateway foi compilada com Temporal (`node -p "typeof Temporal"` deve imprimir `object`).

Essas verificações fazem parte do spike da fase 0 ([ADR 0012](../../../../docs/adr/0012-servicos-aws-por-organizacao.md)).

## 7. Fora de escopo

- Antecipação de recebíveis.
- Split de pagamentos entre vários recebedores.
- Autenticação 3-D Secure e qualquer requisito de PCI.
- Moedas além do real.
- Estorno de boleto na v1.
- API pública de cadastro de contas.
