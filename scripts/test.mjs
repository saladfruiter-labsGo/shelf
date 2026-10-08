/**
 * Runner dos testes do servidor e da lógica pura do front (`src/lib`).
 *
 * Roda cada arquivo `*.test.ts` num processo próprio via `node --test`.
 *
 * Por que não `node --test <glob>` direto: no Node 24 + Windows, o
 * better-sqlite3 11 aborta o processo no teardown do V8
 * ("RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr")
 * ao destruir statements já coletadas. É um bug do addon nativo, não dos
 * testes — acontece depois que tudo rodou e some ao repetir. A imagem de
 * produção usa Node 22 e não é afetada.
 *
 * O `retain-statements.mjs` evita a maior parte desses aborts (o GC deixa de
 * destruir statements no meio da execução). Este script ainda repete um
 * arquivo APENAS quando a saída traz essa assinatura nativa. Falha de asserção normal (linhas "not ok") é reportada na hora.
 */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const DIRS = ['server', 'server/integrations', 'server/prices', 'server/routes', 'server/steam', 'server/transfer', 'src/lib']
const MAX_TRIES = 10
const NATIVE_ABORT = /RemoveEnvironmentCleanupHook|Assertion failed: \(env\) != nullptr/

const files = DIRS.flatMap(dir =>
  readdirSync(dir).filter(f => f.endsWith('.test.ts')).map(f => join(dir, f)),
)
let failed = 0

for (const file of files) {
  let out = ''
  let ok = false

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--import', './scripts/retain-statements.mjs', '--test-reporter', 'tap', '--test', file], {
      encoding: 'utf-8',
      env: process.env,
    })
    out = (r.stdout ?? '') + (r.stderr ?? '')
    if (r.status === 0) { ok = true; break }
    if (!NATIVE_ABORT.test(out)) break            // falha de verdade: reporta
    if (attempt < MAX_TRIES) console.log(`  (${file}: abort nativo do better-sqlite3, repetindo ${attempt}/${MAX_TRIES - 1})`)
  }

  const passing = out.match(/^ok \d+ - (.+)$/gm) ?? []
  console.log(`${ok ? '✔' : '✖'} ${file} — ${passing.length} teste(s)`)
  for (const line of passing) console.log(`    ${line.replace(/^ok \d+ - /, '')}`)
  if (!ok) { failed++; console.log(out) }
}

console.log(failed === 0 ? `\nTodos os ${files.length} arquivos passaram.` : `\n${failed} arquivo(s) falharam.`)
process.exit(failed === 0 ? 0 : 1)
