import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export type BackupReason = 'automatic' | 'before-import' | 'before-migration' | 'manual'

export interface DatabaseBackupInfo {
  filename: string
  path: string
  reason: BackupReason
  created_at: string
  size_bytes: number
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/**
 * Produz uma cópia consistente com a Online Backup API do SQLite. A cópia só
 * recebe o nome definitivo depois de abrir e passar no `quick_check`, para que
 * um processo interrompido nunca pareça um backup válido.
 */
export async function writeVerifiedDatabaseBackup(
  database: Database.Database,
  destinationDir: string,
  reason: BackupReason,
  now = new Date(),
): Promise<DatabaseBackupInfo> {
  await mkdir(destinationDir, { recursive: true })

  const suffix = randomBytes(3).toString('hex')
  const filename = `shelf-${reason}-${timestamp(now)}-${suffix}.db`
  const finalPath = path.resolve(destinationDir, filename)
  const temporaryPath = `${finalPath}.tmp`

  try {
    await database.backup(temporaryPath)

    const copy = new Database(temporaryPath, { readonly: true, fileMustExist: true })
    try {
      const rows = copy.pragma('quick_check') as { quick_check: string }[]
      if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') {
        throw new Error(`quick_check falhou: ${rows.map(r => r.quick_check).join('; ') || 'sem resultado'}`)
      }
    } finally {
      copy.close()
    }

    await rename(temporaryPath, finalPath)
    // No Linux, snapshots podem conter credenciais de integração: somente o
    // usuário do container deve lê-los. No Windows o chmod é inofensivo.
    await chmod(finalPath, 0o600).catch(() => {})
    const file = await stat(finalPath)

    return {
      filename,
      path: finalPath,
      reason,
      created_at: now.toISOString(),
      size_bytes: file.size,
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}
