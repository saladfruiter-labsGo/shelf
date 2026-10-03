import { currentUserId } from './db.js'

/**
 * Estado em memória separado por conta. Jobs e integrações guardavam coisas
 * como "já está rodando", o token do Kavita ou o "tocando agora" em variáveis
 * de módulo — com várias pessoas, cada uma precisa da sua.
 *
 * A chave é quem está no contexto (`runAsUser`/sessão); `null` é o banco único
 * de antes da primeira conta.
 */
export class PerUser<T> {
  private readonly values = new Map<number | null, T>()

  constructor(private readonly initial: () => T) {}

  get(): T {
    const id = currentUserId()
    if (!this.values.has(id)) this.values.set(id, this.initial())
    return this.values.get(id) as T
  }

  set(value: T): void {
    this.values.set(currentUserId(), value)
  }

  /** Valores de todas as contas (para o desligamento esperar quem está rodando). */
  all(): T[] {
    return [...this.values.values()]
  }
}
