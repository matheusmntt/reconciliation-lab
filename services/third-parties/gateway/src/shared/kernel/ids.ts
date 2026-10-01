// Ids com prefixo por tipo e sufixo ordenável por tempo (RN-29), no formato de
// um ULID: 10 caracteres para o instante e 16 que, num ULID, seriam aleatórios.
// Aqui esses 16 vêm de um hash da seed com a chave de origem, então o mesmo
// cenário gera sempre os mesmos ids (ADR 0006).

import { createHash } from 'node:crypto'

export const ID_PREFIXES = {
  account: 'acct',
  charge: 'ch',
  dispute: 'dp',
  event: 'evt',
  payout: 'po',
  refund: 're',
  report: 'rpt',
  webhookEndpoint: 'whe',
} as const

export type IdKind = keyof typeof ID_PREFIXES

export interface IdGenerator {
  // A origem precisa ser estável e única por entidade, por exemplo a conta junto
  // com a Idempotency-Key da requisição. Nunca um valor aleatório.
  next(kind: IdKind, origin: string, at: Temporal.Instant): string
}

// Base32 de Crockford: sem I, L, O e U, e em ordem crescente, o que faz a ordem
// alfabética dos ids seguir a ordem do tempo.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_LENGTH = 10
const HASH_BYTES = 10 // 80 bits = 16 caracteres de 5 bits
const MAX_EPOCH_MS = 2 ** 48 - 1 // mesmo limite do ULID
const ID_PATTERN = /^([a-z]+)_([0-9A-HJKMNP-TV-Z]{26})$/

function encodeTime(epochMs: number): string {
  let value = epochMs
  let out = ''
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ALPHABET[value % 32] + out
    value = Math.floor(value / 32)
  }
  return out
}

function encodeBytes(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(buffer >> bits) & 31]
    }
    buffer &= (1 << bits) - 1
  }
  return out
}

export class DeterministicIdGenerator implements IdGenerator {
  private readonly seed: string

  constructor(seed: string | number) {
    this.seed = String(seed)
  }

  next(kind: IdKind, origin: string, at: Temporal.Instant): string {
    const epochMs = at.epochMilliseconds
    if (epochMs < 0 || epochMs > MAX_EPOCH_MS) {
      throw new RangeError(`instante fora do intervalo dos ids: ${at}`)
    }
    // O separador \u0000 impede que partes diferentes formem o mesmo texto.
    const digest = createHash('sha256')
      .update(`${this.seed}\u0000${kind}\u0000${origin}`)
      .digest()
    const suffix =
      encodeTime(epochMs) + encodeBytes(digest.subarray(0, HASH_BYTES))
    return `${ID_PREFIXES[kind]}_${suffix}`
  }
}

export interface ParsedId {
  prefix: string
  instant: Temporal.Instant
}

// Lê o prefixo e o instante de um id. Devolve null se o formato for inválido ou,
// quando `expected` é informado, se o prefixo não for o desse tipo.
export function parseId(id: string, expected?: IdKind): ParsedId | null {
  const match = ID_PATTERN.exec(id)
  if (!match) {
    return null
  }
  const [, prefix, suffix] = match
  if (expected && prefix !== ID_PREFIXES[expected]) {
    return null
  }
  let epochMs = 0
  for (const char of suffix.slice(0, TIME_LENGTH)) {
    epochMs = epochMs * 32 + ALPHABET.indexOf(char)
  }
  if (epochMs > MAX_EPOCH_MS) {
    return null
  }
  return { prefix, instant: Temporal.Instant.fromEpochMilliseconds(epochMs) }
}
