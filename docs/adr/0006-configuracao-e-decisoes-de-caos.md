# ADR 0006: Configuração e decisões de caos

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

A seção 7 do `project.md` define um catálogo de falhas por serviço, controladas por probabilidade e seed, que podem ser alteradas sem redeploy. Os cenários declarativos dependem de dois princípios do projeto:

- **A simulação é determinística:** o mesmo cenário, com a mesma seed, deve produzir o mesmo resultado.
- **O conciliador nunca trapaceia:** ele não pode conhecer as falhas injetadas.

Além das falhas, alguns serviços simulam o comportamento do mundo externo, como o pagador dentro do gateway. Esse comportamento também precisa de parâmetros (probabilidades e atrasos) e das mesmas garantias.

Com uma instância do Floci por organização ([ADR 0005](0005-floci-por-organizacao.md)), cada serviço pode guardar a própria configuração no SSM da sua conta.

Alternativas consideradas para a configuração:

- **Variáveis de ambiente:** exigem reiniciar o serviço para mudar o comportamento.
- **Um serviço central de caos:** descartado na ADR 0005.

Para as decisões, a alternativa é `Math.random()`. O resultado dela depende da ordem de processamento e da concorrência, o que quebra o determinismo.

## Decisão

### Configuração

- Os parâmetros de simulação ficam no SSM do Floci da organização do serviço, sob o prefixo `/sim/`:
  - `/sim/seed`: seed do cenário em execução;
  - `/sim/<serviço>/chaos/<parâmetro>`: probabilidades das falhas do catálogo;
  - `/sim/<serviço>/behavior/<parâmetro>`: comportamento simulado do mundo, como o pagador do gateway.
- Parâmetros de negócio da empresa, como taxas contratadas e janelas esperadas, ficam fora desse prefixo, em `/business/`.
- O orquestrador de cenários grava a seed e os parâmetros de cada cenário no SSM de todas as organizações antes de iniciar.
- Cada serviço mantém uma cópia da configuração em memória e verifica periodicamente, em tempo real, se a versão dos parâmetros mudou. Quando muda, ele recarrega a configuração.
- Cada decisão registra a versão dos parâmetros que usou.

### Decisões

- Toda decisão aleatória usa uma função determinística: `decide(seed, chave, decisão)` aplica um hash sobre os três valores e devolve um número em `[0, 1)`, comparado com a probabilidade configurada.
- A chave é estável e derivada de dados determinísticos do cenário, como a `Idempotency-Key` recebida ou um identificador derivado dela. Nunca de valores aleatórios.
- `Math.random()` e equivalentes não são usados em código de simulação.

### Registro e acesso

- Toda falha injetada emite um evento de telemetria `chaos.injected` com serviço, tipo da falha, alvo, instante simulado e versão dos parâmetros. O evento vai para o painel "modo deus" ([ADR 0008](0008-observabilidade-empresa-e-modo-deus.md)).
- No Floci da empresa, uma política IAM nega ao conciliador as ações `ssm:GetParameter*` sobre `/sim/*`.

### `libs/chaos`

A biblioteca `libs/chaos` oferece, em cada linguagem, a leitura da configuração com recarga por versão e a função `decide`, com o mesmo algoritmo em todas as linguagens.

## Consequências

### Positivas

- O comportamento muda sem redeploy, e a mudança fica rastreável pela versão do parâmetro.
- Com a mesma seed e as mesmas versões de parâmetros, as decisões são as mesmas, independentemente da ordem de processamento.
- O evento `chaos.injected` serve de gabarito para os cenários e para depuração, sem nunca chegar ao conciliador.
- Cada serviço é dono da própria configuração.

### Negativas

- Não existe uma visão central da configuração. O orquestrador precisa gravar em quatro instâncias do Floci.
- Uma mudança leva até um intervalo de verificação para valer. O orquestrador precisa confirmar que os serviços já aplicaram a nova versão antes de avançar o cenário.
- O determinismo depende de disciplina: um `Math.random()` ou uma chave instável quebram a reprodutibilidade sem nenhum erro aparente. Uma regra de lint proibindo `Math.random` nos serviços reduz esse risco.
- Os identificadores gerados pelos serviços também precisam ser determinísticos para que as chaves derivadas deles sejam estáveis.
