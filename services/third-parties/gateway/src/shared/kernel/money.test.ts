import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { BusinessRuleViolation } from './domain-error'
import { InvalidMoney, Money } from './money'

// Centavos que cabem com folga em qualquer operação deste arquivo.
const cents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 })
const positiveCents = fc.integer({ min: 0, max: 1_000_000_000 })
const basisPoints = fc.integer({ min: 0, max: 10_000 })
const installments = fc.integer({ min: 1, max: 12 })

function expectInvalid(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidMoney)
    expect((error as InvalidMoney).code).toBe(code)
    return
  }
  throw new Error(`esperava InvalidMoney com código ${code}`)
}

describe('Money.of', () => {
  it('aceita centavos inteiros em BRL', () => {
    const money = Money.of(1234)
    expect(money.cents).toBe(1234)
    expect(money.currency).toBe('BRL')
  })

  it('recusa valores que não são inteiros seguros', () => {
    expectInvalid(() => Money.of(10.5), 'amount_not_integer')
    expectInvalid(() => Money.of(Number.NaN), 'amount_not_integer')
    expectInvalid(
      () => Money.of(Number.MAX_SAFE_INTEGER + 1),
      'amount_not_integer',
    )
  })

  it('recusa moedas diferentes de BRL (RN-01)', () => {
    expectInvalid(() => Money.of(100, 'USD'), 'currency_not_supported')
  })

  it('InvalidMoney é uma violação de regra de negócio (HTTP 422)', () => {
    const error = new InvalidMoney('currency_not_supported', 'm')
    expect(error).toBeInstanceOf(BusinessRuleViolation)
    expect(error.type).toBe('business_rule')
    expect(error.name).toBe('InvalidMoney')
  })
})

describe('soma e subtração', () => {
  it('soma e subtrai valores', () => {
    expect(Money.of(150).plus(Money.of(50)).cents).toBe(200)
    expect(Money.of(150).minus(Money.of(200)).cents).toBe(-50)
  })

  it('recusa estouro dos inteiros seguros', () => {
    expectInvalid(
      () => Money.of(Number.MAX_SAFE_INTEGER).plus(Money.of(1)),
      'amount_overflow',
    )
  })

  test.prop([cents, cents])('soma e subtração se anulam', (a, b) => {
    expect(Money.of(a).plus(Money.of(b)).minus(Money.of(b)).cents).toBe(a)
  })

  test.prop([cents, cents])('a soma é comutativa', (a, b) => {
    expect(
      Money.of(a)
        .plus(Money.of(b))
        .equals(Money.of(b).plus(Money.of(a))),
    ).toBe(true)
  })
})

describe('applyRate (RN-12)', () => {
  it('aplica a taxa em pontos-base', () => {
    // R$ 100,00 a 3,49% = R$ 3,49
    expect(Money.of(10_000).applyRate(349).cents).toBe(349)
  })

  it('arredonda meio centavo para cima', () => {
    // 50 centavos a 1% = 0,5 centavo
    expect(Money.of(50).applyRate(100).cents).toBe(1)
    // 49 centavos a 1% = 0,49 centavo
    expect(Money.of(49).applyRate(100).cents).toBe(0)
  })

  it('arredonda para longe do zero em valores negativos', () => {
    expect(Money.of(-50).applyRate(100).cents).toBe(-1)
  })

  it('recusa taxas negativas ou fracionárias', () => {
    expectInvalid(() => Money.of(100).applyRate(-1), 'invalid_rate')
    expectInvalid(() => Money.of(100).applyRate(3.49), 'invalid_rate')
  })

  test.prop([cents, basisPoints])(
    'o resultado fica a no máximo meio centavo do valor exato',
    (amount, rate) => {
      const exactTimesUnit = amount * rate
      const roundedTimesUnit = Money.of(amount).applyRate(rate).cents * 10_000
      expect(Math.abs(roundedTimesUnit - exactTimesUnit)).toBeLessThanOrEqual(
        5_000,
      )
    },
  )

  test.prop([positiveCents, basisPoints])(
    'a taxa nunca passa do valor original',
    (amount, rate) => {
      expect(Money.of(amount).applyRate(rate).cents).toBeLessThanOrEqual(amount)
    },
  )
})

describe('split (RN-11)', () => {
  it('dá os centavos que sobram para a primeira parcela', () => {
    expect(
      Money.of(1_000)
        .split(3)
        .map((m) => m.cents),
    ).toEqual([334, 333, 333])
    expect(
      Money.of(10)
        .split(4)
        .map((m) => m.cents),
    ).toEqual([4, 2, 2, 2])
  })

  it('recusa números de parcelas inválidos', () => {
    expectInvalid(() => Money.of(100).split(0), 'invalid_installments')
    expectInvalid(() => Money.of(100).split(2.5), 'invalid_installments')
  })

  test.prop([cents, installments])('as parcelas somam o total', (amount, n) => {
    const total = Money.of(amount)
      .split(n)
      .reduce((sum, part) => sum.plus(part), Money.zero())
    expect(total.cents).toBe(amount)
  })

  test.prop([cents, installments])(
    'gera n parcelas, todas iguais a partir da segunda',
    (amount, n) => {
      const parts = Money.of(amount).split(n)
      expect(parts).toHaveLength(n)
      expect(
        new Set(parts.slice(1).map((p) => p.cents)).size,
      ).toBeLessThanOrEqual(1)
    },
  )

  test.prop([positiveCents, installments])(
    'a primeira parcela é a maior e excede as outras em menos de n centavos',
    (amount, n) => {
      const [first, ...rest] = Money.of(amount).split(n)
      for (const part of rest) {
        expect(first.cents - part.cents).toBeGreaterThanOrEqual(0)
        expect(first.cents - part.cents).toBeLessThan(n)
      }
    },
  )
})

describe('comparação e formatação', () => {
  it('compara valores', () => {
    expect(Money.of(100).compare(Money.of(200))).toBe(-1)
    expect(Money.of(200).compare(Money.of(200))).toBe(0)
    expect(Money.of(300).compare(Money.of(200))).toBe(1)
  })

  it('informa o sinal', () => {
    expect(Money.zero().isZero()).toBe(true)
    expect(Money.of(-1).isNegative()).toBe(true)
    expect(Money.of(1).isPositive()).toBe(true)
  })

  it('formata para depuração', () => {
    expect(Money.of(123_456).toString()).toBe('BRL 1234.56')
    expect(Money.of(-5).toString()).toBe('-BRL 0.05')
  })
})
