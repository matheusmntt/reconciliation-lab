# ADR 0009: OpenAPI gerado a partir dos schemas Zod

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

Os serviços Node usam Fastify com `fastify-type-provider-zod`. Os schemas Zod das rotas já fazem a validação das requisições e a tipagem dos handlers. A pasta `contracts/third-party-apis/` guarda o OpenAPI dos terceiros, que funciona como a documentação pública que a empresa consome.

Alternativas consideradas:

- **Contrato primeiro:** escrever o OpenAPI à mão e gerar tipos e validadores a partir dele. Mantém duas fontes que precisam ficar sincronizadas: o YAML e o código.
- **Código primeiro:** gerar o OpenAPI a partir dos schemas Zod das rotas. O `fastify-type-provider-zod` (versão 7) oferece `jsonSchemaTransform` e `jsonSchemaTransformObject` para o `@fastify/swagger`.

No monorepo, a geração a partir do código traz uma tentação: importar os schemas Zod de um serviço em outro, o que seria compartilhamento de código ([ADR 0001](0001-monorepo.md)).

## Decisão

- Nos serviços Node, os schemas Zod das rotas são a fonte única de validação, tipos e especificação.
- Schemas reutilizáveis são registrados com `z.globalRegistry.add(schema, { id })` e viram componentes no OpenAPI.
- A especificação é exportada por um script para `contracts/third-party-apis/<serviço>.yaml` e versionada. O script inicializa a aplicação sem abrir a porta e grava a saída de `app.swagger({ yaml: true })`.
- O alvo `lint` do serviço falha se o arquivo versionado for diferente do gerado.
- Os webhooks enviados pelo serviço são documentados na seção `webhooks` do OpenAPI 3.1, gerada com `z.toJSONSchema()` a partir dos mesmos schemas Zod dos eventos.
- Formatos que não são HTTP, como o CSV do relatório de liquidação, são documentados ao lado do OpenAPI, em `contracts/third-party-apis/`.
- Consumidores usam apenas o arquivo exportado, e podem gerar os próprios tipos a partir dele, por exemplo com `openapi-typescript`. Nunca importam os schemas Zod de outro serviço.
- Cada serviço publica a própria documentação em `GET /openapi.json` e `GET /docs`.

Esta decisão vale para os serviços Node. O emissor de notas, em FastAPI, também gera o OpenAPI a partir do código e segue a mesma regra de exportação. A abordagem do banco, em Go, será decidida na fase 2.

## Consequências

### Positivas

- Validação, tipos e documentação vêm da mesma fonte e não divergem.
- A checagem no `lint` impede que o contrato publicado fique desatualizado.
- O diff do YAML nos commits mostra explicitamente quando o contrato público mudou.

### Negativas

- Nem tudo que o Zod expressa vira JSON Schema. Refinamentos e transformações podem não aparecer na especificação.
- O contrato nasce do código, e o desenho da API pode ficar menos deliberado. Revisar o diff do YAML a cada mudança reduz esse risco.
- O script de exportação, a checagem de diferença e a seção de webhooks precisam ser mantidos à parte das rotas.
