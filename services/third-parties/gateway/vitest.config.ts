import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Testes ficam ao lado do código (*.test.ts). A pasta test/ guarda utilitários
    // e as suítes de contrato compartilhadas (arquitetura.md, seção 9).
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Enquanto não houver testes, `make test` passa em vez de falhar.
    passWithNoTests: true,
  },
})
