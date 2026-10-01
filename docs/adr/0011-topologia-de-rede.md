# ADR 0011: Topologia de rede

- **Status:** Aceita
- **Data:** 2026-10-01
- **Substitui parcialmente:** [ADR 0005](0005-floci-por-organizacao.md) (redes do Floci) e [ADR 0008](0008-observabilidade-empresa-e-modo-deus.md) (rede do collector do modo deus)

## Contexto

Com a adoção de mais serviços da AWS ([ADR 0012](0012-servicos-aws-por-organizacao.md)), o Floci passa a criar containers de verdade, como Postgres (RDS), Redis (ElastiCache), Redpanda (MSK) e Lambdas. Isso expõe dois problemas na topologia anterior:

1. **O Floci coloca tudo o que cria numa única rede Docker,** definida por `FLOCI_SERVICES_DOCKER_NETWORK`, `FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK` e `FLOCI_SERVICES_ECS_DOCKER_NETWORK`. Uma Lambda na rede da empresa não alcançaria o relógio, que estava na rede `sim-control`.
2. **O Floci expõe os bancos de dados em todas as redes em que está.** Ele publica os bancos por proxies TCP no próprio container: RDS nas portas 7001 a 7099 e ElastiCache nas portas 6379 a 6399. Na ADR 0005, o Floci do gateway estava nas redes `internet` e `sim-control`. Com isso, o Postgres do gateway ficaria acessível às integrações e a qualquer serviço do projeto, e a fronteira física deixaria de existir.

Na AWS, esse problema é resolvido com sub-redes privadas e um ponto de entrada público, como um load balancer ou o endpoint público de um serviço gerenciado.

## Decisão

### Redes

| Rede | Participantes |
| --- | --- |
| `internal` | Serviços da empresa, Floci da empresa (e o que ele cria), proxy de borda da empresa, collector da empresa |
| `third-party-<nome>` | Serviços do terceiro, Floci do terceiro (e o que ele cria), proxy de borda do terceiro |
| `internet` | Proxies de borda das organizações e os serviços que fazem chamadas para outras organizações |
| `sim-control` | Comunicação interna do plano de controle: Redis do relógio, orquestrador, collector e Grafana do modo deus |

### Floci só na rede privada

Cada Floci fica apenas na rede privada da sua organização. As três variáveis de rede do Floci apontam para essa rede, então tudo o que ele cria (RDS, ElastiCache, MSK, Lambdas e, no futuro, tarefas ECS) fica isolado nela. `FLOCI_HOSTNAME` recebe o nome do serviço no compose.

### Proxy de borda por organização

Cada organização tem um proxy de borda em nginx, nas redes `internet` e privada. Ele expõe na rede `internet` apenas os endpoints públicos daquela organização, com nomes estáveis definidos como aliases de rede:

| Organização | Nome na rede `internet` | Encaminha para |
| --- | --- | --- |
| Empresa | `company-webhooks` | O endpoint do API Gateway que recebe os webhooks (no Floci da empresa) |
| Gateway | `gateway-api` | O papel `api` do gateway |
| Gateway | `gateway-s3` | Somente `GET` com `X-Amz-Signature` no bucket de relatórios (no Floci do gateway) |
| Banco | `bank-api` | As APIs de extrato e interbancária |
| Banco | `bank-sftp` | O servidor SFTP, por passagem TCP (`stream` do nginx) |
| Emissor de notas | `invoicing-api` | A API pública do emissor |

O proxy preserva o header `Host`. Por isso, uma URL pré-assinada gerada com o host `gateway-s3` continua válida quando chega ao Floci.

### Tráfego de entrada e de saída

- **Entrada:** toda requisição vinda de outra organização entra pelo proxy de borda.
- **Saída:** apenas os serviços e papéis que chamam outras organizações entram na rede `internet`. Eles chamam sempre os nomes dos proxies de borda.

| Organização | Quem chama | Destinos |
| --- | --- | --- |
| Empresa | Loja e integrações | Gateway e emissor |
| Gateway | Papel `worker` | Webhooks da empresa e API interbancária do banco |
| Emissor de notas | O papel que envia os webhooks | Webhooks da empresa |

Containers criados pelo Floci, como as Lambdas, ficam numa rede só e por isso não fazem chamadas para outras organizações.

### Plano de controle conectado às redes privadas

Os componentes do plano de controle entram na rede privada de cada organização:

- **Redis do relógio:** cada serviço tem um usuário de ACL próprio, que pode ler `sim:now` e escrever apenas na própria chave, como `sim:watermark:<serviço>`.
- **Orquestrador:** grava a configuração de cada cenário no Floci de cada organização ([ADR 0013](0013-appconfig-para-configuracao-de-caos.md)).
- **Collector do modo deus:** recebe a telemetria de cada organização. O collector da empresa continua na rede `internal` e encaminha uma cópia ao do modo deus.

Os serviços deixam de entrar na rede `sim-control`, que passa a ser usada só pelo plano de controle.

## Consequências

### Positivas

- A fronteira entre organizações continua física, mesmo com os bancos de dados dentro do Floci.
- Lambdas e outros containers criados pelo Floci alcançam o relógio e a telemetria pela rede da própria organização.
- A topologia imita a da AWS: recursos em redes privadas, com um ponto de entrada público por organização.
- Os nomes públicos ficam estáveis e independentes dos nomes internos dos containers.

### Negativas

- São mais quatro containers, os proxies de borda, com configuração própria.
- O plano de controle fica conectado a todas as redes. Ele nunca encaminha tráfego entre organizações, mas um erro de configuração nele poderia criar uma ponte entre elas.
- Cada Floci precisa do socket do Docker (`/var/run/docker.sock`) para criar containers. Com isso, ele poderia criar containers em qualquer rede do host. A fronteira depende da configuração correta das variáveis de rede.
- Quando os serviços passarem a rodar no ECS, as tarefas ficarão numa rede só e precisarão de um proxy de saída para chamar outras organizações, como um NAT gateway faria.
