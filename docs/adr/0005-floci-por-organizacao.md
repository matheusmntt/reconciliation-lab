# ADR 0005: Uma instância do Floci por organização

- **Status:** Aceita, substituída parcialmente
- **Data:** 2026-10-01
- **Substituída parcialmente por:** [ADR 0011](0011-topologia-de-rede.md), nas redes em que cada Floci fica, e [ADR 0012](0012-servicos-aws-por-organizacao.md), nos serviços usados em cada instância. A decisão de ter uma instância por organização continua valendo.

## Contexto

O `project.md` previa uma única instância do Floci, representando a conta AWS da empresa, na rede `internal`. Outras necessidades apareceram ao detalhar os serviços:

- todo serviço, inclusive os terceiros, lê sua configuração de caos do SSM Parameter Store (seção 7 do `project.md`);
- o gateway precisa guardar os relatórios de liquidação e entregá-los por URL pré-assinada.

Os terceiros não alcançam a rede `internal` (seção 3.4). Além disso, um terceiro usando a conta AWS da empresa violaria o princípio de que terceiros nunca acessam a infraestrutura dela.

Alternativas consideradas:

- **Um Floci compartilhado por todos:** viola a fronteira entre empresa e terceiros.
- **Um Floci por serviço:** dentro da empresa, quebra o que precisa ser compartilhado. As integrações gravam o bruto no bucket `landing`, e o conciliador o lê para reprocessar períodos (seção 6.7). A loja e as integrações usam as mesmas API keys dos terceiros no Secrets Manager.
- **Um serviço global de configuração de caos no plano de controle:** tira dos serviços a autonomia sobre a própria configuração e acrescenta um serviço novo, quando cada organização já pode ter o SSM dela.

## Decisão

Cada organização tem sua própria instância do Floci, que representa a conta AWS dela: uma para a empresa e uma para cada terceiro (gateway, banco e emissor de notas).

| Organização | Uso |
| --- | --- |
| Empresa | S3 (`landing` e `reports`), SQS, Secrets Manager, SSM (parâmetros de negócio e caos da loja e das integrações) |
| Gateway | S3 (relatórios de liquidação com URL pré-assinada) e SSM (caos e comportamento do pagador) |
| Banco | SSM (caos) |
| Emissor de notas | SSM (caos) |

Redes:

- cada Floci fica na rede privada da sua organização (`internal` para a empresa, `third-party-<nome>` para os terceiros);
- todas as instâncias também ficam na rede `sim-control`, para o orquestrador gravar a seed e os parâmetros de cada cenário;
- o Floci do gateway também fica na rede `internet`, para servir os downloads das URLs pré-assinadas às integrações, como o endpoint público do S3 faria.

Credenciais:

- os serviços de cada organização usam apenas as credenciais da própria conta. Nenhum serviço tem credenciais da conta de outra organização;
- a imposição de IAM fica ligada no Floci da empresa, para negar ao conciliador o acesso aos parâmetros de simulação ([ADR 0006](0006-configuracao-e-decisoes-de-caos.md)), e no Floci do gateway, que fica exposto na rede `internet`.

As URLs pré-assinadas são geradas com o hostname que as integrações resolvem na rede `internet`, e não com `localhost`, porque o host faz parte da assinatura.

## Consequências

### Positivas

- A fronteira entre empresa e terceiros vale também para armazenamento e configuração, e não só para a rede.
- Cada terceiro tem autonomia sobre a própria infraestrutura, como uma empresa real com sua própria conta na nuvem.
- Fica resolvida a inconsistência entre a seção 7 (caos no SSM) e a seção 3.4 (terceiros fora da rede `internal`).

### Negativas

- São quatro instâncias do Floci, com mais containers, mais memória e um bootstrap para cada uma (buckets, parâmetros e segredos).
- Expor o Floci do gateway na rede `internet` deixa todos os serviços dessa instância alcançáveis nessa rede, e a proteção depende da imposição de IAM. Há uma issue aberta no Floci em que URLs pré-assinadas são recusadas com a autenticação do S3 ligada ([floci-io/floci#4367](https://github.com/floci-io/floci/issues/4367)). Isso precisa ser verificado na fase 2. Se o problema persistir, a imposição fica desligada nessa instância e a proteção passa a depender de disciplina.
- A expiração das URLs pré-assinadas é validada pelo Floci com o relógio do sistema, então ela corre em tempo real, e não no tempo simulado.
