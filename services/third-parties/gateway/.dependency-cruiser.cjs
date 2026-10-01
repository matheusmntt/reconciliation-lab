// Fronteiras do gateway, verificadas no `make lint` (arquitetura.md, seção 4, e decisão A7).

// Testes montam o cenário com fakes, repositórios em memória e utilitários de
// test/. Por isso ficam fora das regras de camada, mas não das regras entre
// módulos nem das de higiene.
const testFiles = '\\.test\\.ts$'

// Pacotes de infraestrutura que domínio e application nunca importam.
const infraPackages =
  '^node_modules/(fastify|@fastify/[^/]+|fastify-type-provider-zod|drizzle-orm|pg|ioredis|@aws-sdk/[^/]+|zod)/'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // --- Camadas -------------------------------------------------------------
    {
      name: 'domain-is-pure',
      comment:
        'O domínio só importa o próprio domínio e o shared/kernel. Ele não conhece application, infra, http, factories nem outros módulos.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/domain/', pathNot: testFiles },
      to: {
        path: '^src/',
        pathNot: ['^src/modules/$1/domain/', '^src/shared/kernel/'],
      },
    },
    {
      name: 'kernel-is-pure',
      comment: 'O shared/kernel não importa nada de src/ fora dele.',
      severity: 'error',
      from: { path: '^src/shared/kernel/', pathNot: testFiles },
      to: { path: '^src/', pathNot: '^src/shared/kernel/' },
    },
    {
      name: 'domain-has-no-packages',
      comment:
        'Domínio e shared/kernel não dependem de pacotes npm. Módulos nativos do Node (node:*) são permitidos.',
      severity: 'error',
      from: {
        path: '^src/(modules/[^/]+/domain|shared/kernel)/',
        pathNot: testFiles,
      },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
        ],
      },
    },
    {
      name: 'application-points-inward',
      comment:
        'A application só importa o próprio domínio, a própria application, o shared/kernel e a API pública (index.ts) de outros módulos.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/application/', pathNot: testFiles },
      to: {
        path: '^src/',
        pathNot: [
          '^src/modules/$1/(domain|application)/',
          '^src/shared/kernel/',
          '^src/modules/[^/]+/index\\.ts$',
        ],
      },
    },
    {
      name: 'application-has-no-infra-packages',
      comment:
        'A application não importa pacotes de infraestrutura: HTTP, banco de dados, Redis, AWS ou validação de borda.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application/', pathNot: testFiles },
      to: { path: infraPackages },
    },
    {
      name: 'core-ignores-simulation-and-chaos',
      comment:
        'Domínio, application e shared/kernel não conhecem o mundo simulado nem o caos. Os decorators de caos entram nas factories.',
      severity: 'error',
      from: {
        path: '^src/(modules/[^/]+/(domain|application)|shared/kernel)/',
        pathNot: testFiles,
      },
      to: { path: '^src/(simulation|chaos)/' },
    },

    // --- Módulos ---------------------------------------------------------------
    {
      name: 'modules-only-through-index',
      comment:
        'Um módulo só usa outro pela API pública dele (index.ts), nunca pelo domínio, pela infra ou pelas tabelas.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'only-packages-and-shared-libs-outside-src',
      comment:
        'Fora de src/, o código só importa pacotes e as libs compartilhadas libs/sim-clock e libs/chaos (ADR 0001).',
      severity: 'error',
      from: { path: '^src/', pathNot: testFiles },
      to: {
        pathNot: ['^src/', '^node_modules/', '(^|/)libs/(sim-clock|chaos)/'],
        dependencyTypesNot: ['core'],
        // Imports que não resolvem já são apontados pela regra not-to-unresolvable.
        couldNotResolve: false,
      },
    },

    // --- Higiene -------------------------------------------------------------------
    {
      name: 'no-circular',
      comment:
        'Ciclos de import impedem entender e testar os módulos isoladamente.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'Todo import precisa resolver para um arquivo ou pacote existente.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      comment: 'Todo pacote importado precisa estar declarado no package.json.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Código de produção não importa devDependencies. Testes podem.',
      severity: 'error',
      from: { path: '^src/', pathNot: testFiles },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: '^node_modules/' },
    // Imports só de tipo também contam: um tipo da infra dentro do domínio também é acoplamento.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // Com o pnpm, os pacotes são links simbólicos. Preservá-los mantém os caminhos
    // como node_modules/<pacote>, que é o que as regras acima esperam.
    preserveSymlinks: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
}
