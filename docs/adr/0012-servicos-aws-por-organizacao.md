# ADR 0012: Serviços AWS por organização

- **Status:** Aceita
- **Data:** 2026-10-01
- **Substitui parcialmente:** [ADR 0005](0005-floci-por-organizacao.md) (uso de cada instância do Floci)
- **Complementa:** [ADR 0007](0007-agendamento-em-tempo-simulado.md) (executor de filas por serviço)

## Contexto

Um dos objetivos do projeto é estudar infraestrutura, e cada organização já tem a própria conta AWS emulada pelo Floci ([ADR 0005](0005-floci-por-organizacao.md)). O Floci emula mais de 150 serviços. Alguns deles sobem containers de verdade:

- RDS: PostgreSQL das versões 13 a 18;
- ElastiCache: Redis ou Valkey;
- MSK: Redpanda;
- Amazon MQ: RabbitMQ;
- Lambda e ECS: containers Docker.

Os demais são emulados dentro do próprio Floci, como SQS, EventBridge, DynamoDB, Step Functions, AppConfig e KMS.

Verificamos na documentação do Floci limitações que afetam o desenho:

- **Read replica do RDS:** é inicializada a partir de um dump da instância de origem, e não há confirmação de que continue acompanhando o primário.
- **RDS Proxy:** encaminha conexões TCP, mas não faz pooling.
- **Runtimes gerenciados da Lambda:** vão até `nodejs24.x`. Funções em imagem de container são suportadas.
- **Throttling do API Gateway:** é aceito na configuração, mas não é aplicado.
- **Lifecycle do S3:** é guardado, mas não executado.
- **Estados `Wait` do Step Functions:** são limitados a 30 segundos.
- **Timers em geral:** atraso de mensagens do SQS, EventBridge Scheduler, TTL do DynamoDB e expiração de URLs pré-assinadas correm em tempo real.

## Decisão

### Uso por organização

| Serviço AWS | Empresa | Gateway | Banco | Emissor de notas |
| --- | --- | --- | --- | --- |
| RDS PostgreSQL 18 | Uma instância por serviço (loja, integrações, conciliador) | Banco de dados principal | Banco de dados principal | Banco de dados principal |
| ElastiCache | BullMQ, idempotência e rate limit | Rate limit e cache de autenticação | | |
| MSK | Kafka interno | | | |
| S3 | `landing`, com Object Lock, e `reports` | Relatórios de liquidação | | XML das notas |
| SQS, com DLQ | Etapas de ingestão | Filas dos workers | | |
| EventBridge | | Eventos de domínio | | |
| DynamoDB | Deduplicação dos webhooks recebidos | Log público de eventos | | |
| API Gateway e Lambda | Recepção dos webhooks | | | |
| Step Functions | Ingestão do relatório de liquidação | | | |
| Amazon MQ | | | | Fila da "prefeitura" |
| AppConfig | Caos | Caos e comportamento do pagador | Caos | Caos |
| SSM Parameter Store | Parâmetros de negócio (`/business/`) | | | |
| Secrets Manager | API keys dos terceiros e segredos de webhook | Credenciais do banco de dados e da API interbancária | Credenciais | Credenciais |
| KMS | | Cifragem dos segredos de webhook | | |
| IAM | Imposição ligada; política que restringe o conciliador | Imposição ligada | Imposição ligada | Imposição ligada |

O relógio simulado não faz parte de nenhuma organização. Por isso o Redis dele continua sendo um container comum do plano de controle, e não um ElastiCache.

### Regras

1. **Timers da AWS nunca controlam o tempo de negócio.** Prazos, expirações, agendas e cortes passam sempre pela tabela `scheduled_jobs` ([ADR 0007](0007-agendamento-em-tempo-simulado.md)). Os timers da AWS servem apenas para assuntos técnicos, como intervalo de polling, retenção e retentativas técnicas.
2. **O que precisa ser atômico com o Postgres fica no Postgres.** O outbox, a tabela `scheduled_jobs` e as chaves de idempotência das operações de escrita não vão para o DynamoDB nem para filas.
3. **Lambdas em Node usam imagem de container,** construída com Node 26 e o runtime interface client da AWS, porque os runtimes gerenciados não têm Node 26 nem garantem o Temporal ([ADR 0003](0003-node-26.md)).
4. **O executor de filas varia por serviço:**

   | Serviço | Executor |
   | --- | --- |
   | Empresa | BullMQ sobre o ElastiCache |
   | Gateway | SQS |
   | Emissor de notas | RabbitMQ do Amazon MQ |
   | Banco | Executa os jobs direto do Postgres |

   Em todos os casos, o executor só executa. Quem decide quando cada tarefa acontece é o agendador da ADR 0007.
5. **Read replica:** o código mantém pools separados para o primário e a réplica. No laboratório, a URL da réplica aponta para o primário até que se comprove que a read replica do Floci acompanha o primário.
6. **Pooling de conexões:** o PgBouncer continua na frente do RDS, porque o RDS Proxy do Floci não faz pooling.
7. **Endpoints públicos:** os endpoints que vivem dentro do Floci (S3 do gateway e API Gateway da empresa) são expostos apenas pelo proxy de borda da organização ([ADR 0011](0011-topologia-de-rede.md)).

### Fora de uso

| Serviço | Motivo |
| --- | --- |
| Throttling do API Gateway | Não é aplicado pelo Floci. O rate limit é implementado pelos próprios serviços |
| Lifecycle do S3 | Não é executado pelo Floci |
| EventBridge Scheduler | Corre em tempo real (regra 1) |
| EKS | Sobe um cluster k3s por cluster, pesado demais para o ganho |
| EC2 | Suporte parcial |
| FIS | O caos do projeto é de negócio, e o FIS no Floci emula só a API |
| Athena e Glue | Emulam só a API |
| CloudWatch como destino principal de telemetria | O destino principal continua sendo o OpenTelemetry ([ADR 0008](0008-observabilidade-empresa-e-modo-deus.md)) |

### Deploy em ECS

ECS e ECR entram numa fase posterior ao roteiro principal. Nessa fase, as imagens são publicadas no ECR de cada organização e os papéis passam a rodar como serviços ECS, começando pelos de background. O desenvolvimento do dia a dia continua no compose.

## Consequências

### Positivas

- O projeto exercita um conjunto amplo de serviços AWS, cada um num uso que faria sentido de verdade.
- A empresa e o gateway usam mensageria diferente (Kafka com BullMQ de um lado, EventBridge com SQS do outro), o que permite comparar as abordagens.
- O Object Lock no `landing` torna física a regra de que o dado bruto é imutável.
- A regra dos timers protege o determinismo da simulação contra relógios que não são o simulado.

### Negativas

- O ambiente fica pesado: cerca de seis instâncias de Postgres, dois Redis, um Redpanda, um RabbitMQ, quatro Floci, os proxies de borda e a stack de observabilidade. O Colima precisa de mais memória (8 GB ou mais).
- A fidelidade depende do Floci. Alguns pontos precisam de um spike na fase 0, antes de qualquer serviço depender deles:
  - o BullMQ funciona através do proxy do ElastiCache;
  - um cliente Kafka funciona através do proxy do MSK, e o schema registry fica acessível;
  - a read replica do RDS acompanha o primário;
  - as URLs pré-assinadas funcionam com a imposição de IAM ligada ([floci-io/floci#4367](https://github.com/floci-io/floci/issues/4367)).
- Os Streams do DynamoDB ficam em memória e se perdem quando o Floci reinicia. Nenhum fluxo crítico depende deles.
- Cada serviço AWS acrescenta bootstrap: buckets, filas, regras, tabelas, chaves e políticas em `infra/bootstrap/`.
