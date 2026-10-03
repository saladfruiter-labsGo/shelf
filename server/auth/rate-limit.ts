/**
 * Limite de tentativas em memória (uma instância só). Cada chave guarda as
 * falhas recentes; ao passar do limite, a chave fica bloqueada até a janela
 * andar. Sucesso não zera o IP — só a chave da conta.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>()

  constructor(private readonly max: number, private readonly windowMs: number) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter(at => now - at < this.windowMs)
    if (list.length) this.failures.set(key, list)
    else this.failures.delete(key)
    return list
  }

  /** Segundos até poder tentar de novo; 0 = liberado. */
  retryAfter(keys: string[], now = Date.now()): number {
    let wait = 0
    for (const key of keys) {
      const list = this.recent(key, now)
      if (list.length >= this.max) wait = Math.max(wait, Math.ceil((list[0] + this.windowMs - now) / 1000))
    }
    return wait
  }

  fail(keys: string[], now = Date.now()): void {
    for (const key of keys) {
      const list = this.recent(key, now)
      list.push(now)
      this.failures.set(key, list)
    }
    if (this.failures.size > 10_000) this.failures.clear()
  }

  clear(key: string): void {
    this.failures.delete(key)
  }
}

/** Limite simples de ações por janela (comentários, posts, mensagens). */
export class ActionLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(private readonly max: number, private readonly windowMs: number) {}

  take(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter(at => now - at < this.windowMs)
    if (list.length >= this.max) {
      this.hits.set(key, list)
      return false
    }
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 10_000) this.hits.clear()
    return true
  }
}
