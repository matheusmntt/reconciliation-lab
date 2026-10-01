// Erros de domínio tipados (decisão A6). O domínio só diz o que aconteceu; o
// mapeamento para HTTP fica num único lugar, na borda (arquitetura.md, seção 5.12).

export type DomainErrorType = 'not_found' | 'invalid_state' | 'business_rule'

export interface DomainErrorOptions {
  // Campo da entrada que causou o erro, quando houver. Vira `param` na resposta (RNF-02).
  param?: string
  cause?: unknown
}

export abstract class DomainError extends Error {
  abstract readonly type: DomainErrorType
  readonly param?: string

  constructor(
    readonly code: string,
    message: string,
    options: DomainErrorOptions = {},
  ) {
    super(message, { cause: options.cause })
    this.name = new.target.name
    this.param = options.param
  }
}

// O recurso não existe ou não pertence à conta (HTTP 404).
export class NotFound extends DomainError {
  readonly type = 'not_found'
}

// A operação não é permitida no estado atual (HTTP 409), como capturar uma
// cobrança que já foi paga.
export class InvalidState extends DomainError {
  readonly type = 'invalid_state'
}

// A entrada fere uma regra de negócio (HTTP 422), como um valor abaixo do mínimo.
export class BusinessRuleViolation extends DomainError {
  readonly type = 'business_rule'
}
