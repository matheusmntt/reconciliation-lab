# ADR 0008: Observabilidade da empresa e modo deus

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

A seção 9.4 do `project.md` define que o contexto de trace só é propagado dentro da empresa e que os terceiros têm telemetria própria, visível num painel separado, o "modo deus", que o conciliador nunca consulta.

O OpenTelemetry Collector previsto fica na rede `internal`, que os terceiros não alcançam.

Para depurar um cenário, é útil ver tudo ao mesmo tempo: o que a empresa fez, o que cada terceiro fez e quais falhas foram injetadas ([ADR 0006](0006-configuracao-e-decisoes-de-caos.md)).

## Decisão

### Dois collectors

- O **collector da empresa** fica na rede `internal` e recebe a telemetria da loja, das integrações e do conciliador.
- O **collector do modo deus** fica na rede `sim-control` e recebe a telemetria dos terceiros e do plano de controle.
- O collector da empresa também encaminha uma cópia da telemetria dela para o modo deus, que assim vê tudo.

### Organização dos dados

- Todo serviço declara o atributo de recurso `org`, com um destes valores: `empresa`, `gateway`, `banco`, `emissor` ou `sim`.
- Os dados são separados por organização no armazenamento (Tempo, Loki e Prometheus).
- O Grafana tem duas áreas:
  - **Empresa:** só enxerga `org=empresa`;
  - **Modo deus:** enxerga todas as organizações e os eventos `chaos.injected`.

### Propagação de contexto

- Dentro da empresa, o contexto de trace é propagado nos headers HTTP e Kafka.
- Chamadas da empresa para terceiros não enviam `traceparent`.
- Os terceiros ignoram qualquer `traceparent` recebido e iniciam os próprios traces. Os webhooks que eles enviam não carregam contexto de trace.
- No modo deus, a correlação entre organizações é feita por atributos de negócio, como `charge.id`, e não por trace.

### Restrições

O conciliador e os demais serviços da empresa nunca consultam os backends de observabilidade. Eles só exportam telemetria.

## Consequências

### Positivas

- O modo deus mostra o sistema inteiro, incluindo as falhas injetadas, ao lado das divergências encontradas pelo conciliador.
- A visão da empresa continua restrita ao que uma empresa real conheceria.
- Correlacionar por atributos de negócio, e não por trace, imita o que um time de operações faria entre empresas diferentes.

### Negativas

- São dois pipelines de telemetria para configurar e manter.
- Não existe trace de ponta a ponta atravessando a fronteira. Isso é intencional, mas deixa a depuração mais trabalhosa.
- A separação por organização no armazenamento e no Grafana exige configuração específica de cada backend.
