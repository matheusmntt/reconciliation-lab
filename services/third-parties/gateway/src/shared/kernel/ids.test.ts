import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  DeterministicIdGenerator,
  ID_PREFIXES,
  type IdKind,
  parseId,
} from './ids'

const MAX_EPOCH_MS = 2 ** 48 - 1
const instant = fc
  .integer({ min: 0, max: MAX_EPOCH_MS })
  .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms))
const kind = fc.constantFrom(...(Object.keys(ID_PREFIXES) as IdKind[]))
const origin = fc.string({ minLength: 1, maxLength: 64 })
const seed = fc.oneof(fc.integer(), fc.string())

const at = Temporal.Instant.from('2026-01-01T00:00:00Z')

describe('DeterministicIdGenerator', () => {
  it('gera ids no formato prefixo_ULID', () => {
    const id = new DeterministicIdGenerator(42).next('charge', 'o', at)
    expect(id).toMatch(/^ch_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('mantém o algoritmo estável (valor de referência)', () => {
    // Se este teste quebrar, ids de cenários antigos deixam de ser reproduzíveis.
    const id = new DeterministicIdGenerator(42).next(
      'charge',
      'acct_test:idem-1',
      at,
    )
    expect(id).toBe('ch_01KDVDNA00AH1NA021SX90YP6Q')
  })

  it('usa o prefixo de cada tipo (RN-29)', () => {
    const ids = new DeterministicIdGenerator(1)
    for (const [k, prefix] of Object.entries(ID_PREFIXES)) {
      expect(ids.next(k as IdKind, 'o', at).startsWith(`${prefix}_`)).toBe(true)
    }
  })

  it('recusa instantes fora do intervalo', () => {
    const ids = new DeterministicIdGenerator(1)
    expect(() =>
      ids.next('charge', 'o', Temporal.Instant.fromEpochMilliseconds(-1)),
    ).toThrow(RangeError)
    expect(() =>
      ids.next(
        'charge',
        'o',
        Temporal.Instant.fromEpochMilliseconds(MAX_EPOCH_MS + 1),
      ),
    ).toThrow(RangeError)
  })

  test.prop([seed, kind, origin, instant])(
    'as mesmas entradas geram sempre o mesmo id',
    (s, k, o, t) => {
      expect(new DeterministicIdGenerator(s).next(k, o, t)).toBe(
        new DeterministicIdGenerator(s).next(k, o, t),
      )
    },
  )

  test.prop([kind, origin, origin, instant, instant])(
    'ids de instantes maiores ordenam depois',
    (k, o1, o2, t1, t2) => {
      fc.pre(t1.epochMilliseconds !== t2.epochMilliseconds)
      const ids = new DeterministicIdGenerator(7)
      const [earlier, later] =
        t1.epochMilliseconds < t2.epochMilliseconds ? [t1, t2] : [t2, t1]
      expect(ids.next(k, o1, earlier) < ids.next(k, o2, later)).toBe(true)
    },
  )

  test.prop([kind, fc.uniqueArray(origin, { minLength: 2, maxLength: 200 })])(
    'origens diferentes no mesmo instante não colidem',
    (k, origins) => {
      const ids = new DeterministicIdGenerator(7)
      const generated = new Set(origins.map((o) => ids.next(k, o, at)))
      expect(generated.size).toBe(origins.length)
    },
  )

  test.prop([
    fc.uniqueArray(fc.string(), { minLength: 2, maxLength: 20 }),
    origin,
  ])('seeds diferentes geram ids diferentes', (seeds, o) => {
    const generated = new Set(
      seeds.map((s) => new DeterministicIdGenerator(s).next('charge', o, at)),
    )
    expect(generated.size).toBe(seeds.length)
  })
})

describe('parseId', () => {
  test.prop([kind, origin, instant])(
    'recupera o prefixo e o instante, em milissegundos',
    (k, o, t) => {
      const parsed = parseId(new DeterministicIdGenerator(1).next(k, o, t), k)
      expect(parsed?.prefix).toBe(ID_PREFIXES[k])
      expect(parsed?.instant.epochMilliseconds).toBe(t.epochMilliseconds)
    },
  )

  it('descarta frações abaixo do milissegundo', () => {
    const precise = Temporal.Instant.from('2026-01-01T00:00:00.123456789Z')
    const id = new DeterministicIdGenerator(1).next('charge', 'o', precise)
    expect(parseId(id)?.instant.toString()).toBe('2026-01-01T00:00:00.123Z')
  })

  it('devolve null para formatos inválidos', () => {
    expect(parseId('')).toBeNull()
    expect(parseId('ch_123')).toBeNull()
    expect(parseId('CH_01KDVDNA00AH1NA021SX90YP6Q')).toBeNull()
    // I, L, O e U não fazem parte do base32 de Crockford
    expect(parseId('ch_01KDVDNA00AH1NA021SX90YP6I')).toBeNull()
    // o instante não cabe em 48 bits
    expect(parseId('ch_ZZZZZZZZZZAH1NA021SX90YP6Q')).toBeNull()
  })

  it('devolve null quando o prefixo não é o do tipo esperado', () => {
    expect(parseId('ch_01KDVDNA00AH1NA021SX90YP6Q', 'refund')).toBeNull()
  })
})
