# ADR 0010: Repasses do gateway pela API interbancária do banco

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

O gateway agrupa as liquidações em repasses diários e transfere o valor líquido para a conta bancária da empresa. O banco registra esses repasses como créditos agregados por lote, sem referência a pedidos (seção 4.5 do `project.md`). O `project.md` não definia como o dinheiro sai do gateway e chega ao banco, que são dois terceiros independentes.

Alternativas consideradas:

- **O plano de controle intermedeia a transferência:** viola a regra de que o plano de controle nunca é usado para trocar dados de negócio.
- **Banco de dados ou fila compartilhados entre gateway e banco:** viola o isolamento entre terceiros.
- **Troca de arquivos, no estilo CNAB de remessa e retorno:** é realista, mas acrescenta um segundo fluxo de arquivos quando o banco já tem um, o do extrato.
- **Uma API interbancária no banco**, simulando a infraestrutura de pagamentos entre instituições.

## Decisão

- O banco expõe uma **API interbancária** na rede `internet`, separada da API de extrato, com credenciais próprias para instituições participantes, como o gateway.
- O gateway envia uma transferência para cada repasse, com:
  - valor líquido;
  - conta de destino do lojista;
  - descrição `REPASSE <batch_id>`;
  - chave de idempotência igual ao id do repasse.
- O repasse no gateway vai de `pending` para `paid` ou `failed`. Se falhar, o valor volta ao saldo da conta do lojista e entra no repasse seguinte.
- O banco registra o crédito segundo as próprias regras, como horário de lançamento e formato da descrição no extrato. As falhas do banco previstas no catálogo de caos se aplicam aqui, como lote dividido em dois créditos e descrição truncada.
- A integração é implementada na fase 2, junto com o banco.

## Consequências

### Positivas

- Os dois terceiros se comunicam apenas por uma interface pública, como no mundo real.
- A idempotência é exercitada também entre terceiros, e não só entre a empresa e os terceiros.
- O caos do banco age sobre transferências reais do gateway, gerando divergências naturais no par liquidação ↔ extrato.

### Negativas

- O fechamento dos repasses do gateway depende da disponibilidade do banco.
- O banco passa a ter duas APIs, com credenciais e públicos diferentes.
- A empresa não enxerga essa interação, o que é correto, mas depurar uma divergência nesse par exige o painel "modo deus".
