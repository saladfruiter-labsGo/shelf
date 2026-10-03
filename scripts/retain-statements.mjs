/**
 * Só para os testes (carregado pelo scripts/test.mjs).
 *
 * No Node 24 + Windows, o better-sqlite3 11 aborta o processo quando o GC
 * destrói um statement no meio da execução ("RemoveEnvironmentCleanupHook ...
 * (env) != nullptr"). Migrations e rotinas de boot preparam statements que
 * viram lixo logo depois — e um GC disparado por timer derruba o arquivo de
 * teste inteiro. Manter os statements vivos até o fim do processo evita a
 * coleta; a produção (Node 22) não tem o defeito e não carrega este arquivo.
 */
import Database from 'better-sqlite3'

const retained = []
const prepare = Database.prototype.prepare
Database.prototype.prepare = function retainedPrepare(...args) {
  const statement = prepare.apply(this, args)
  retained.push(statement)
  return statement
}
