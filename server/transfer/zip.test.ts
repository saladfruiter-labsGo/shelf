/** Leitor de .zip: índice central, deflate, entradas guardadas e zip quebrado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import * as zlib from 'node:zlib'
import { readZip, looksLikeZip, stripRoot } from './zip.js'

const crc32 = (zlib as { crc32?: (data: Buffer) => number }).crc32

/** Monta um .zip mínimo, do jeito que o Letterboxd (e qualquer zip) escreve. */
function zipOf(files: { name: string; text?: string; store?: boolean }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf-8')
    const plain = Buffer.from(f.text ?? '', 'utf-8')
    const method = f.store || plain.length === 0 ? 0 : 8
    const body = method === 0 ? plain : deflateRawSync(plain)
    const crc = crc32 ? crc32(plain) >>> 0 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(plain.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(plain.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + body.length
  }

  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, cd, eocd])
}

test('lê entradas comprimidas e guardadas, na ordem do índice', () => {
  const buf = zipOf([
    { name: 'diary.csv', text: 'Date,Name\n2026-01-01,Dune\n' },
    { name: 'profile.csv', text: 'Username\nfulano\n', store: true },
  ])

  const entries = readZip(buf)
  assert.deepEqual(entries.map(e => e.path), ['diary.csv', 'profile.csv'])
  assert.equal(entries[0].text(), 'Date,Name\n2026-01-01,Dune\n')
  assert.equal(entries[1].text(), 'Username\nfulano\n')
  assert.equal(entries[0].size, 26)
})

test('nomes com acento vêm em UTF-8 e diretórios não viram entrada', () => {
  const buf = zipOf([
    { name: 'lists/melhores-de-avaliação.csv', text: 'Name\nAmélie\n' },
    { name: 'likes/', text: '' },
  ])

  const entries = readZip(buf)
  assert.deepEqual(entries.map(e => e.path), ['lists/melhores-de-avaliação.csv'])
  assert.equal(entries[0].text(), 'Name\nAmélie\n')
})

test('looksLikeZip separa zip de CSV', () => {
  assert.equal(looksLikeZip(zipOf([{ name: 'a.csv', text: 'x' }])), true)
  assert.equal(looksLikeZip(Buffer.from('Date,Name,Year\n')), false)
  assert.equal(looksLikeZip(Buffer.alloc(0)), false)
})

test('stripRoot tira a pasta do export só quando todos a compartilham', () => {
  const shared = ['letterboxd-fulano-2026/diary.csv', 'letterboxd-fulano-2026/lists/top.csv']
  const strip = stripRoot(shared)
  assert.deepEqual(shared.map(strip), ['diary.csv', 'lists/top.csv'])

  const mixed = ['diary.csv', 'lists/top.csv']
  assert.deepEqual(mixed.map(stripRoot(mixed)), mixed)
})

test('arquivo que não é zip dá erro claro em vez de lixo', () => {
  assert.throws(() => readZip(Buffer.from('Date,Name,Year,Letterboxd URI\n')), /truncado|não é um \.zip/)
  assert.throws(() => readZip(Buffer.alloc(4)), /pequeno demais/)
})

test('índice apontando para fora do arquivo não passa despercebido', () => {
  const buf = zipOf([{ name: 'diary.csv', text: 'Date,Name\n2026-01-01,Dune\n' }])
  // Empurra o início do diretório central para além do fim do arquivo.
  buf.writeUInt32LE(buf.length + 100, buf.length - 6)
  assert.throws(() => readZip(buf), /corrompido/)
})

test('bytes estragados quebram na leitura da entrada, não do zip todo', () => {
  const buf = zipOf([
    { name: 'diary.csv', text: 'Date,Name\n'.repeat(40) },
    { name: 'watchlist.csv', text: 'Date,Name\n2026-01-01,Dune\n' },
  ])
  // O corpo comprimido do primeiro arquivo começa logo depois do cabeçalho local.
  buf[30 + 'diary.csv'.length + 3] ^= 0xff

  const entries = readZip(buf)
  assert.equal(entries.length, 2)
  assert.throws(() => entries[0].read())
  assert.equal(entries[1].text(), 'Date,Name\n2026-01-01,Dune\n')
})

test('limites impedem excesso de entradas e expansão declarada de zip bomb', () => {
  const two = zipOf([{ name: 'a.csv', text: 'a' }, { name: 'b.csv', text: 'b' }])
  assert.throws(() => readZip(two, { maxEntries: 1 }), /entradas demais/)

  const expanded = zipOf([{ name: 'diary.csv', text: 'x' }])
  const cdOffset = expanded.readUInt32LE(expanded.length - 6)
  expanded.writeUInt32LE(1_000_000, cdOffset + 24)
  assert.throws(() => readZip(expanded, { maxEntrySize: 1024 }), /grande demais/)
})
