# ADR 0013: AppConfig para a configuração de caos

- **Status:** Aceita
- **Data:** 2026-10-01
- **Substitui parcialmente:** [ADR 0006](0006-configuracao-e-decisoes-de-caos.md) (onde a configuração é guardada e como é lida)

## Contexto

A ADR 0006 guardava a configuração de caos como parâmetros separados no SSM, cada um com a própria versão. A configuração de um cenário costuma mudar vários parâmetros de uma vez: a seed e várias probabilidades. Com o SSM, essas mudanças não são atômicas. Durante alguns instantes, um serviço pode ler parte dos parâmetros novos e parte dos antigos, o que quebra o determinismo.

O AppConfig foi feito para esse problema:

- a configuração é um documento inteiro, com versões imutáveis;
- uma nova versão é aplicada por um deployment;
- os serviços leem pela API de dados (`StartConfigurationSession` e `GetLatestConfiguration`).

O Floci suporta essas operações, mas não menciona a validação por JSON Schema.

## Decisão

### Estrutura

No Floci de cada organização:

- uma aplicação `sim`;
- um ambiente `scenario`;
- um perfil de configuração por serviço, com o nome do serviço.

Cada perfil guarda um único documento JSON:

```json
{
  "scenario": "webhooks-duplicados-e-taxa-errada",
  "seed": 42,
  "chaos": { "webhook_duplicate_rate": 0.05, "fee_mismatch_rate": 0.01 },
  "behavior": { "pix_paid_rate": 0.92 }
}
```

### Aplicação de um cenário

1. O orquestrador valida o documento de cada serviço contra um schema e cria uma versão hospedada de cada perfil.
2. Em seguida, inicia um deployment com a estratégia `AllAtOnce`.
3. Cada serviço lê a configuração com `GetLatestConfiguration`, num intervalo definido em tempo real. Ele valida o documento com Zod e, se o documento for inválido, mantém a versão anterior e emite um erro de telemetria.
4. Ao aplicar uma versão, o serviço publica o número dela no Redis do relógio, em `sim:config-version:<serviço>`.
5. O orquestrador só inicia o cenário quando todos os serviços publicam a versão esperada.

### O que continua da ADR 0006

- A função determinística `decide(seed, chave, decisão)`.
- O evento `chaos.injected`, agora com a versão do documento.
- A biblioteca `libs/chaos`, que passa a ler do AppConfig.

### Acesso e parâmetros de negócio

- No Floci da empresa, uma política IAM nega ao conciliador as ações `appconfig:*` e `appconfigdata:*` sobre a aplicação `sim`.
- Os parâmetros de negócio da empresa, como as taxas contratadas e as janelas esperadas, continuam no SSM, em `/business/`.

## Consequências

### Positivas

- A configuração de um cenário é aplicada de forma atômica, com uma única versão por serviço.
- As versões são imutáveis e ficam registradas no histórico de deployments.
- O orquestrador sabe exatamente quando todos os serviços estão com a configuração do cenário.

### Negativas

- Há mais recursos para criar no bootstrap de cada organização: aplicação, ambiente, perfis e estratégia de deployment.
- Como o Floci não documenta validadores, a validação do schema fica a cargo do orquestrador e de cada serviço.
- A configuração leva até um intervalo de polling para chegar aos serviços. A confirmação de versão evita que um cenário comece antes disso.
