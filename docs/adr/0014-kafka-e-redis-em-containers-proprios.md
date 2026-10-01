# ADR 0014: Kafka e Redis em containers próprios

- **Status:** Aceita
- **Data:** 2026-10-01
- **Substitui parcialmente:** [ADR 0012](0012-servicos-aws-por-organizacao.md), nas linhas do ElastiCache e do MSK e na regra 4 (BullMQ sobre o ElastiCache)

## Contexto

A ADR 0012 previa dois serviços do Floci para mensageria e cache:

- **ElastiCache:** Redis da empresa (BullMQ, idempotência, rate limit) e do gateway (rate limit, cache de autenticação);
- **MSK:** o Kafka interno da empresa.

O [spike 0001](../spikes/0001-floci.md) mostrou que esses dois serviços não servem para dados que precisam durar:

- **Não sobrevivem a um restart do Floci.** Os metadados voltam, mas os containers não. O MSK continua informando o endereço antigo do broker, que não existe mais.
- **O MSK não passa por proxy.** O broker se anuncia pelo nome do container, que tem um sufixo aleatório, então os clientes precisam descobrir o endereço pela API a cada inicialização.
- **O MSK usa `redpandadata/redpanda:latest`.** A versão muda sem controle, o que vai contra o determinismo da simulação.

O Kafka é o meio pelo qual a loja e as integrações entregam eventos ao conciliador. Perder os tópicos a cada restart quebraria o fluxo de conciliação. Perder as filas do BullMQ faria jobs despachados desaparecerem.

Alternativas consideradas:

- **Manter o MSK e o ElastiCache, tratando cada restart do Floci como um reset do ambiente:** obriga a recriar todo o estado a cada restart.
- **Manter os dois com mecanismos de recuperação** (o bootstrap recriando o cache e o agendador redespachando jobs): resolve o cache, mas não devolve as mensagens perdidas no Kafka.
- **Rodar Kafka e Redis em containers próprios, fora do Floci.**

## Decisão

### Kafka da empresa

O Kafka da empresa é um Redpanda em container próprio, o `company-kafka`:

- versão fixa, `redpandadata/redpanda:v26.2.3`;
- schema registry embutido, na porta 8081;
- volume durável;
- na rede `internal`, anunciado com o nome estável `company-kafka:9092`.

### Redis

Cada organização que precisa de Redis tem o seu, em container próprio:

| Container | Organização | Uso | Persistência |
| --- | --- | --- | --- |
| `company-redis` | Empresa | Filas do BullMQ, idempotência, rate limit | AOF ligado e volume durável |
| `gateway-redis` | Gateway | Rate limit e cache de autenticação | Nenhuma, porque os dados são descartáveis |

O executor de filas da empresa passa a ser o BullMQ sobre o `company-redis`.

### Floci

O ElastiCache e o MSK ficam desligados no Floci de cada organização (`FLOCI_SERVICES_ELASTICACHE_ENABLED=false` e `FLOCI_SERVICES_MSK_ENABLED=false`), para que ninguém os use por engano.

### Rede e acesso

- Os containers ficam na rede privada da organização, como o resto da infraestrutura dela ([ADR 0011](0011-topologia-de-rede.md)).
- Eles não fazem parte da conta AWS emulada.
- Os serviços os acessam por URL de conexão (`REDIS_URL`, `KAFKA_BROKERS`), sem descobrir endereços pela API da AWS.

## Consequências

### Positivas

- **Os dados sobrevivem a restarts.** Isso foi verificado no ambiente local: depois de reiniciar o Kafka e o Redis da empresa, a mensagem no tópico, o schema registrado e a chave no Redis continuaram lá.
- **Os endereços são estáveis**, conhecidos de antemão e iguais a cada inicialização.
- **As versões são fixas**, o que ajuda na reprodutibilidade da simulação.
- **O projeto depende menos das partes menos maduras do Floci.**

### Negativas

- O ElastiCache e o MSK saem do conjunto de serviços AWS estudados no projeto.
- Versão, persistência e recursos desses containers passam a ser responsabilidade do projeto, e não de um serviço gerenciado.
- O Redpanda roda em modo `dev-container`, com uma CPU e 1 GB de memória. É uma configuração de laboratório, não de produção.
- O rate limit e o cache de autenticação do gateway são zerados a cada restart do `gateway-redis`. Isso é aceitável, porque esses dados são descartáveis.
