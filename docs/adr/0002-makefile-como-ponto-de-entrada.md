# ADR 0002: Makefile como ponto de entrada

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

Cada linguagem do projeto tem seu próprio executor de tarefas: npm scripts no Node, Composer e Artisan no PHP, a CLI do Go e uv ou pip no Python. Sem um padrão, cada serviço teria comandos diferentes para as mesmas ações, e rodar lint ou testes no repositório inteiro exigiria lembrar a ferramenta de cada um.

Como a raiz não pertence a nenhuma linguagem ([ADR 0001](0001-monorepo.md)), o executor da raiz não pode depender do ecossistema Node, o que descarta Turborepo, Nx e scripts num `package.json` da raiz.

O Make já vem instalado no macOS e no Linux e não depende de nenhuma linguagem do projeto. A versão distribuída com o macOS é a GNU Make 3.81.

## Decisão

O `Makefile` da raiz é o único ponto de entrada para as tarefas do repositório.

Todo serviço tem um `Makefile` próprio que implementa o mesmo contrato de alvos:

| Alvo | Responsabilidade |
| --- | --- |
| `install` | Instala as dependências exatamente como estão no lockfile |
| `dev` | Sobe o serviço em modo watch |
| `build` | Gera o artefato de build |
| `test` | Roda os testes |
| `lint` | Roda o linter e a checagem de formatação |
| `typecheck` | Checa os tipos, quando a linguagem permitir |
| `clean` | Remove os artefatos gerados |

Regras do contrato:

- Todos os alvos são obrigatórios. Um alvo que ainda não se aplica existe como no-op que imprime uma mensagem, para que as tarefas agregadas da raiz não quebrem.
- O `Makefile` do serviço apenas traduz o contrato para a ferramenta nativa (por exemplo, `lint` chama `npm run lint`). A lógica fica na ferramenta da linguagem.

A raiz delega com `make -C <diretório> <alvo>`:

- `make <alvo>` executa o alvo em todos os serviços registrados, parando no primeiro erro;
- `make <alvo> s=<serviço>` executa o alvo em um único serviço;
- `make dev s=<serviço>` exige o serviço, porque `dev` bloqueia o terminal.

Novos serviços entram no registro da raiz, com uma variável `dir_<nome>` e o nome na lista `SERVICES`. Tarefas que não pertencem a um serviço, como subir a infraestrutura ou executar cenários, ficam como alvos próprios da raiz.

Os Makefiles devem ser compatíveis com a GNU Make 3.81, sem `.ONESHELL`, grouped targets (`&:`) ou `$(file ...)`.

## Consequências

### Positivas

- Os serviços têm a mesma interface em qualquer linguagem: `make lint`, `make test`, `make build`.
- O CI e os cenários de ponta a ponta podem chamar os mesmos alvos usados no desenvolvimento.
- Cada serviço continua utilizável isoladamente com sua ferramenta nativa.

### Negativas

- Há uma camada fina de duplicação: cada alvo do `Makefile` do serviço repete um script da ferramenta nativa.
- O registro de serviços na raiz é manual. Um serviço não registrado fica de fora das tarefas agregadas.
- O Make tem armadilhas próprias: TAB obrigatório nas receitas, `$$` para variáveis do shell e um shell novo para cada linha da receita.
- As tarefas agregadas rodam em sequência, não em paralelo.
