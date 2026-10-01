// Dinheiro em centavos inteiros (project.md, seção 12). No domínio o valor é um
// `number` inteiro seguro; o `bigint` fica só no banco de dados.

import { BusinessRuleViolation } from './domain-error'

export type Currency = 'BRL'

const SUPPORTED_CURRENCIES: readonly string[] = ['BRL']

// 10.000 pontos-base = 100%.
const BASIS_POINTS_PER_UNIT = 10_000

export type MoneyErrorCode =
  | 'amount_not_integer'
  | 'amount_overflow'
  | 'currency_not_supported'
  | 'currency_mismatch'
  | 'invalid_rate'
  | 'invalid_installments'

export class InvalidMoney extends BusinessRuleViolation {
  declare readonly code: MoneyErrorCode

  constructor(code: MoneyErrorCode, message: string) {
    super(code, message)
  }
}

function assertSafeInteger(value: number, code: MoneyErrorCode): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidMoney(
      code,
      `valor fora dos inteiros seguros em centavos: ${value}`,
    )
  }
}

export class Money {
  private constructor(
    readonly cents: number,
    readonly currency: Currency,
  ) {}

  // A única moeda aceita é BRL (RN-01).
  static of(cents: number, currency = 'BRL'): Money {
    assertSafeInteger(cents, 'amount_not_integer')
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new InvalidMoney(
        'currency_not_supported',
        `moeda não suportada: ${currency}`,
      )
    }
    return new Money(cents, currency as Currency)
  }

  static zero(currency = 'BRL'): Money {
    return Money.of(0, currency)
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other)
    const cents = this.cents + other.cents
    assertSafeInteger(cents, 'amount_overflow')
    return new Money(cents, this.currency)
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other)
    const cents = this.cents - other.cents
    assertSafeInteger(cents, 'amount_overflow')
    return new Money(cents, this.currency)
  }

  // Aplica uma taxa em pontos-base (349 = 3,49%) e arredonda ao centavo, com
  // meio centavo arredondado para cima, isto é, para longe do zero (RN-12).
  applyRate(basisPoints: number): Money {
    if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
      throw new InvalidMoney(
        'invalid_rate',
        `taxa inválida em pontos-base: ${basisPoints}`,
      )
    }
    const scaled = this.cents * basisPoints
    assertSafeInteger(scaled, 'amount_overflow')

    const quotient = Math.trunc(scaled / BASIS_POINTS_PER_UNIT)
    const remainder = scaled % BASIS_POINTS_PER_UNIT
    const roundsAway = Math.abs(remainder) * 2 >= BASIS_POINTS_PER_UNIT
    const cents = roundsAway ? quotient + Math.sign(scaled) : quotient
    return new Money(cents, this.currency)
  }

  // Divide em n parcelas iguais; os centavos que sobram vão para a primeira (RN-11).
  split(installments: number): Money[] {
    if (!Number.isSafeInteger(installments) || installments < 1) {
      throw new InvalidMoney(
        'invalid_installments',
        `número de parcelas inválido: ${installments}`,
      )
    }
    const base = Math.trunc(this.cents / installments)
    const remainder = this.cents - base * installments
    return Array.from(
      { length: installments },
      (_, index) =>
        new Money(index === 0 ? base + remainder : base, this.currency),
    )
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.cents === other.cents
  }

  // Negativo se este valor for menor, zero se igual, positivo se maior.
  compare(other: Money): number {
    this.assertSameCurrency(other)
    return Math.sign(this.cents - other.cents)
  }

  isZero(): boolean {
    return this.cents === 0
  }

  isNegative(): boolean {
    return this.cents < 0
  }

  isPositive(): boolean {
    return this.cents > 0
  }

  toString(): string {
    const sign = this.cents < 0 ? '-' : ''
    const abs = Math.abs(this.cents)
    const units = Math.trunc(abs / 100)
    const fraction = String(abs % 100).padStart(2, '0')
    return `${sign}${this.currency} ${units}.${fraction}`
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new InvalidMoney(
        'currency_mismatch',
        `moedas diferentes: ${this.currency} e ${other.currency}`,
      )
    }
  }
}
