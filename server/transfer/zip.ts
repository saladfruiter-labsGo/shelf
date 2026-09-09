/**
 * Leitor de `.zip` escrito à mão, só com o que o Node já traz (`zlib`).
 *
 * Por que não uma dependência: o export do Letterboxd é um zip pequeno,
 * "deflate" simples, e a imagem de produção é montada no Actions — cada pacote
 * a mais é superfície de build que não vale por ~120 linhas de parsing.
 *
 * Lê pelo **diretório central** (no fim do arquivo), não pelos cabeçalhos
 * locais: quando o zip foi escrito em streaming, o cabeçalho local traz
 * tamanho e CRC zerados (bit 3 das flags) e só o índice central é confiável.
 *
 * Puro (Buffer entra, Buffer sai) — é a parte que precisa de teste.
 */
import * as zlib from 'node:zlib'

const EOCD_SIG  = 0x06054b50   // fim do diretório central
const CD_SIG    = 0x02014b50   // entrada do diretório central
const LOCAL_SIG = 0x04034b50   // cabeçalho local, antes dos bytes do arquivo

const EOCD_MIN  = 22           // EOCD sem comentário
const CD_FIXED  = 46           // parte fixa da entrada central
const LOCAL_FIX = 30           // parte fixa do cabeçalho local

/** `crc32` só existe no Node ≥ 22.2 — quando falta, a verificação é pulada. */
const crc32 = (zlib as { crc32?: (data: Buffer) => number }).crc32

export interface ZipEntry {
  /** Caminho dentro do zip, com `/` como separador. */
  path: string
  /** Tamanho depois de descompactar, em bytes. */
  size: number
  /** Conteúdo descompactado. Lança se o método de compressão não for suportado. */
  read(): Buffer
  /** Conteúdo como texto UTF-8, sem BOM. */
  text(): string
}

/** Os quatro primeiros bytes de todo zip — `PK\x03\x04`. */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === LOCAL_SIG
}

/** O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele. */
function findEocd(buf: Buffer): number {
  const floor = Math.max(0, buf.length - 0xffff - EOCD_MIN)
  for (let i = buf.length - EOCD_MIN; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

export function readZip(buf: Buffer): ZipEntry[] {
  if (buf.length < EOCD_MIN) throw new Error('O arquivo é pequeno demais para ser um .zip.')

  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('Não achei o índice do .zip — o arquivo parece truncado ou não é um .zip.')

  const count    = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('Esse .zip está em formato Zip64, que este importador não lê. Descompacte e envie os CSVs.')
  }

  const entries: ZipEntry[] = []
  let p = cdOffset

  for (let i = 0; i < count; i++) {
    if (p + CD_FIXED > buf.length || buf.readUInt32LE(p) !== CD_SIG) {
      throw new Error(`O índice do .zip está corrompido na entrada ${i + 1} de ${count}.`)
    }

    const method     = buf.readUInt16LE(p + 10)
    const crc        = buf.readUInt32LE(p + 16)
    const compSize   = buf.readUInt32LE(p + 20)
    const size       = buf.readUInt32LE(p + 24)
    const nameLen    = buf.readUInt16LE(p + 28)
    const extraLen   = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localAt    = buf.readUInt32LE(p + 42)

    // Bit 11 das flags marca nome em UTF-8; na prática o resto também é ASCII
    // ou UTF-8, e latin-1 aqui só quebraria acento de nome de lista.
    // Zipador antigo de Windows às vezes grava "\" no lugar de "/".
    const path = buf.subarray(p + CD_FIXED, p + CD_FIXED + nameLen).toString('utf-8').split('\\').join('/')
    p += CD_FIXED + nameLen + extraLen + commentLen

    if (path.endsWith('/')) continue   // diretório: não tem conteúdo

    entries.push({
      path,
      size,
      read() {
        if (localAt + LOCAL_FIX > buf.length || buf.readUInt32LE(localAt) !== LOCAL_SIG) {
          throw new Error(`Não consegui ler "${path}" — o .zip aponta para um lugar que não existe.`)
        }
        // O cabeçalho local repete nome e extra, e o `extra` costuma ter tamanho
        // diferente do central: os dois precisam ser lidos de onde estão.
        const dataAt = localAt + LOCAL_FIX + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28)
        const raw = buf.subarray(dataAt, dataAt + compSize)

        let out: Buffer
        if (method === 0) out = Buffer.from(raw)
        else if (method === 8) out = zlib.inflateRawSync(raw)
        else throw new Error(`"${path}" usa um método de compressão que não sei ler (${method}).`)

        if (crc32 && crc !== 0 && crc32(out) >>> 0 !== crc) {
          throw new Error(`"${path}" saiu corrompido do .zip.`)
        }
        return out
      },
      text() {
        return this.read().toString('utf-8').replace(/^\uFEFF/, '')
      },
    })
  }

  return entries
}

/**
 * O Letterboxd embrulha tudo numa pasta com data no nome. Some com esse nível
 * quando *todas* as entradas o compartilham, para o importador casar por
 * `diary.csv` e não por `letterboxd-fulano-2026-.../diary.csv`.
 */
export function stripRoot(paths: string[]): (path: string) => string {
  const first = paths[0]?.split('/')[0]
  const shared = !!first && paths.length > 0 && paths.every(p => p.startsWith(`${first}/`))
  return shared ? (path: string) => path.slice(first.length + 1) : (path: string) => path
}
