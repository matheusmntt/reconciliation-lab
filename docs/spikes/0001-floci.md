# Spike 0001: Floci como AWS local

- **Data:** 2026-10-01
- **Versão testada:** `floci/floci:2.1.0` (build nativa)
- **Ambiente:** Colima, perfil `reconlab` (4 CPUs, 8 GB), Docker com buildx 0.37.2

## Objetivo

Verificar, antes de escrever código, as hipóteses da [ADR 0012](../adr/0012-servicos-aws-por-organizacao.md) e as verificações pendentes da [especificação do gateway](../../services/third-parties/gateway/docs/requisitos.md). O teste usou o ambiente real (`infra/docker-compose.yml`) e scripts descartáveis com os mesmos clientes que os serviços vão usar: `pg`, `ioredis`, `bullmq`, `kafkajs` e o AWS SDK v3.

## Resultados

| Verificação | Resultado | Detalhe |
| --- | --- | --- |
| BullMQ pelo proxy do ElastiCache | ✅ | Jobs imediatos, com prioridade e atrasados processados. O engine `redis` cria um Valkey, que se apresenta como `redis_version 7.2.4` |
| Kafka pelo MSK e schema registry | ✅ com ressalvas | Produção, consumo e schema registry (porta 8081, compatibilidade padrão `BACKWARD`) funcionam. Ressalvas na seção seguinte |
| Read replica do RDS | ❌ | `CreateDBInstanceReadReplica` responde `UnsupportedOperation`, embora a documentação do Floci a liste como suportada |
| URLs pré-assinadas com IAM ligado (issue #4367) | ✅ com ressalvas | Funcionam com usuário IAM e passam pelo proxy de borda com o host `gateway-s3`. Sem política, 403. Expirada, 403. A issue não se reproduziu. Ressalvas na seção seguinte |
| EventBridge para SQS | ✅ | Regras com `detail-type` exato e por prefixo entregam só os eventos certos. O envelope chega completo (`source`, `detail-type`, `detail`) |
| DLQ do SQS | ✅ | A mensagem vai para a DLQ depois de `maxReceiveCount` recebimentos |
| Temporal na imagem Docker | ✅ | `node:26.10.0-slim` tem Temporal. O Dockerfile falha a build se ele não existir |
| RDS PostgreSQL 18 | ✅ | PostgreSQL 18.6 (`postgres:18-alpine`), com `uuidv7()` nativo. O proxy aceita TLS e termina a conexão cifrada |
| DynamoDB | ✅ | A escrita condicional (`attribute_not_exists`) recusa o segundo evento com o mesmo id |
| KMS | ✅ | `GenerateDataKey` e `Decrypt` funcionam com o alias `alias/gateway-webhook-secrets` |
| AppConfig | ✅ com ressalvas | Uma nova versão aplicada por deployment chega na leitura seguinte, e o `VersionLabel` traz o número da versão. Ressalvas na seção seguinte |
| Isolamento de rede | ✅ | Da rede `internet` não se alcança o Floci, os serviços do gateway nem o relógio. A borda responde só como `gateway-api` e `gateway-s3`, e o `gateway-s3` só aceita `GET` assinado no bucket de relatórios |
| ACL do Redis do relógio | ✅ | O usuário `gateway` lê `sim:now` e escreve só nas próprias chaves. Escritas em outras chaves e o comando `DEL` são recusados |

## Comportamentos do Floci que o código precisa considerar

1. **Assinaturas SigV4 não são autenticadas.** Com a imposição de IAM ligada, o Floci identifica o usuário pelo access key informado e avalia as políticas dele, mas não confere a assinatura. Uma chamada de API com o segredo errado é aceita, e uma URL pré-assinada com a assinatura adulterada também. A expiração das URLs, porém, é respeitada. No laboratório, a proteção vem da fronteira de rede, das políticas IAM e da expiração, e não da criptografia.
2. **A credencial root tem acesso total.** Um access key de 12 dígitos é tratado como o root da conta, e as políticas não se aplicam a ele, como na AWS. Para restringir um serviço, como o conciliador ou quem assina as URLs de relatório, ele precisa de um usuário IAM com access key criado no bootstrap.
3. **O AppConfig só aceita ids na API de dados.** O `StartConfigurationSession` com nomes (`sim`, `scenario`, `gateway`) responde `Environment not found`. A `libs/chaos` precisa resolver os nomes para ids pela API de controle (`ListApplications`, `ListEnvironments`, `ListConfigurationProfiles`).
4. **O MSK não passa por proxy.** O `GetBootstrapBrokers` devolve o IP do container do Redpanda, e o broker se anuncia pelo nome do container, que tem um sufixo aleatório. Os clientes precisam descobrir o bootstrap pela API a cada inicialização. A imagem usada é `redpandadata/redpanda:latest`, sem versão fixa. Por isso e pela perda de dados no restart, o MSK saiu do projeto ([ADR 0014](../adr/0014-kafka-e-redis-em-containers-proprios.md)).
5. **O proxy do RDS termina o TLS.** O certificado da CA fica em `/app/data/tls/rds-ca.crt`, dentro do container do Floci, e serve para usar `sslmode=verify-full`.

## Divergências encontradas e correções aplicadas

| Problema | Correção |
| --- | --- |
| `CreateCacheCluster` só aceita Memcached | Durante o spike, o bootstrap passou a usar `CreateReplicationGroup`. Depois o ElastiCache saiu do projeto ([ADR 0014](../adr/0014-kafka-e-redis-em-containers-proprios.md)) |
| O Floci anuncia como porta do RDS a porta **publicada no host**, e não a porta em que o proxy escuta. Com o mapeamento 7101→7001, o endpoint e o segredo `gateway/rds` ficavam com uma porta que não funcionava dentro da rede | A porta passou a ser a mesma dentro e fora do container, com uma faixa por organização (empresa 70xx, gateway 71xx, banco 72xx, emissor 73xx) |
| O ElastiCache não sobrevive a um restart do Floci: os metadados voltam, mas o container e o proxy não | Durante o spike, o bootstrap recriava o grupo quando o proxy não respondia. Depois o ElastiCache foi trocado por um Redis em container próprio ([ADR 0014](../adr/0014-kafka-e-redis-em-containers-proprios.md)) |
| O MSK também não sobrevive a um restart: o cluster continua `ACTIVE` e o `GetBootstrapBrokers` devolve o endereço antigo, mas o broker não existe mais | O MSK foi trocado por um Redpanda em container próprio, com versão fixa e volume durável ([ADR 0014](../adr/0014-kafka-e-redis-em-containers-proprios.md)) |
| O RDS sobrevive ao restart, com o container e o proxy restaurados na mesma porta | Nenhuma correção necessária |
| `docker compose down` remove os containers criados pelo Floci, mas deixa órfãos os volumes que ele criou, como `floci-rds-*` | O alvo `make reset` apaga esses volumes junto com os do compose |
| O Dockerfile usa `RUN --mount=type=cache`, que o builder legado não aceita | É obrigatório ter o buildx (BuildKit) instalado |
| A imposição de IAM estava desligada à espera do spike | Ficou ligada. Todas as verificações passaram com ela |

## Decisões tomadas depois do spike

- **Kafka da empresa:** o MSK perdia os tópicos e as mensagens a cada restart do Floci. O Kafka passou a ser um Redpanda em container próprio, com versão fixa e volume durável ([ADR 0014](../adr/0014-kafka-e-redis-em-containers-proprios.md)).
- **Redis:** o ElastiCache perdia as filas do BullMQ e as chaves a cada restart do Floci. A empresa e o gateway passaram a ter Redis em containers próprios: o da empresa com AOF, o do gateway sem persistência ([ADR 0014](../adr/0014-kafka-e-redis-em-containers-proprios.md)).

Depois da troca, a durabilidade foi verificada no ambiente local. Com o Kafka e o Redis da empresa reiniciados, a mensagem no tópico, o schema registrado e a chave no Redis continuaram lá.

## Decisões pendentes

1. **Credenciais IAM por papel.** Quando um serviço precisar de permissões restritas (o conciliador na fase 1, o assinador de relatórios do gateway na fase 2), o bootstrap terá que criar o usuário IAM, a access key e um jeito de entregá-la ao serviço.

## Como reproduzir

Os alvos do Makefile da raiz usam o contexto `colima-reconlab`, a menos que `DOCKER_CONTEXT` já esteja definido.

```bash
make up
make logs c=gateway-bootstrap
curl -H 'Host: gateway-api' http://127.0.0.1:8080/ping
```

Para zerar o ambiente, incluindo os volumes criados pelo Floci:

```bash
make reset
```
