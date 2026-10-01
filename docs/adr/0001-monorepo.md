# ADR 0001: Monorepo

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

O Reconciliation Lab tem seis serviços em quatro linguagens (Node, PHP, Go e Python), distribuídos em três planos: empresa, terceiros e controle da simulação. Além dos serviços, há artefatos transversais usados por todos eles:

- `libs/sim-clock` e `libs/chaos`, com clientes nas quatro linguagens;
- `contracts/`, com os schemas dos eventos internos e o OpenAPI dos terceiros;
- `scenarios/`, a suíte de ponta a ponta que exercita todos os serviços juntos;
- `infra/`, com o docker-compose, as redes e a observabilidade.

A simulação precisa ser determinística: o mesmo cenário com o mesmo seed deve produzir o mesmo resultado. Para isso é preciso saber exatamente qual versão de cada serviço participou da execução.

A fase 1 do roteiro (fatia vertical) altera ao mesmo tempo loja, gateway, integrações, conciliador, contratos e infraestrutura.

A alternativa considerada foi um repositório por serviço, agrupados depois numa organização do GitHub. Isso imitaria melhor a separação entre empresas reais, mas exigiria:

- publicar e versionar as libs compartilhadas em quatro registros de pacotes (npm, Packagist, PyPI e Go modules) ou usar git submodules;
- coordenar PRs entre vários repositórios para cada mudança transversal;
- manter um manifesto com a versão de cada serviço usada em cada cenário.

## Decisão

Usar um único repositório, com a estrutura descrita na seção 10 do `project.md`.

- A raiz não pertence a nenhuma linguagem: não há `package.json`, `composer.json`, `go.mod` nem `pyproject.toml` na raiz.
- Cada serviço é independente, com dependências e lockfile próprios. Não há workspaces npm ou pnpm entre serviços.
- Nenhum serviço importa código de outro serviço. Apenas `libs/` e `contracts/` podem ser compartilhados.
- A fronteira entre empresa e terceiros é garantida no build e na execução, não pela estrutura do repositório:
  - o contexto de build Docker de cada serviço é o próprio diretório, e as libs compartilhadas entram por `additional_contexts`;
  - em execução, as redes Docker separadas (seção 3.4 do `project.md`) impedem acessos indevidos.
- Pastas são criadas quando o primeiro arquivo delas se torna necessário, e não antecipadamente.

## Consequências

### Positivas

- Um commit representa um estado completo e reproduzível do sistema. Qualquer cenário pode ser reexecutado a partir de um SHA.
- Mudanças transversais, como um contrato de evento junto com seu produtor e seus consumidores, entram num único commit.
- As libs compartilhadas são consumidas a partir do código-fonte, sem publicação de pacotes.
- O sistema inteiro sobe a partir de um único clone.

### Negativas

- O repositório, por si só, não impede que um terceiro importe código da empresa. A regra depende do contexto de build isolado (um import indevido quebra o build da imagem) e, futuramente, de uma checagem de fronteiras no lint.
- O CI precisa de filtros por caminho para não executar todas as suítes a cada mudança.
- Ferramentas de quatro linguagens convivem no mesmo repositório, e arquivos como `.gitignore` e `.editorconfig` precisam cobrir todas.

### Reversibilidade

Um serviço pode ser extraído para um repositório próprio com `git filter-repo` ou `git subtree split`, preservando o histórico.
