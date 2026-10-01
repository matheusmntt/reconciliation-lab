import { describe, expect, it } from 'vitest'
import {
  BusinessRuleViolation,
  DomainError,
  InvalidState,
  NotFound,
} from './domain-error'

class ChargeNotFound extends NotFound {
  constructor(id: string) {
    super('charge_not_found', `cobrança não encontrada: ${id}`, { param: 'id' })
  }
}

describe('DomainError', () => {
  it('cada categoria tem o próprio type', () => {
    expect(new NotFound('x', 'm').type).toBe('not_found')
    expect(new InvalidState('x', 'm').type).toBe('invalid_state')
    expect(new BusinessRuleViolation('x', 'm').type).toBe('business_rule')
  })

  it('preserva code, mensagem e param', () => {
    const error = new ChargeNotFound('ch_123')
    expect(error.code).toBe('charge_not_found')
    expect(error.message).toBe('cobrança não encontrada: ch_123')
    expect(error.param).toBe('id')
  })

  it('subclasses mantêm a cadeia de instanceof', () => {
    const error = new ChargeNotFound('ch_123')
    expect(error).toBeInstanceOf(ChargeNotFound)
    expect(error).toBeInstanceOf(NotFound)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(InvalidState)
  })

  it('usa o nome da classe concreta e mantém o stack', () => {
    const error = new ChargeNotFound('ch_123')
    expect(error.name).toBe('ChargeNotFound')
    expect(error.stack).toContain('ChargeNotFound')
  })

  it('aceita uma causa', () => {
    const cause = new Error('origem')
    const error = new InvalidState('charge_not_capturable', 'm', { cause })
    expect(error.cause).toBe(cause)
    expect(error.param).toBeUndefined()
  })
})
