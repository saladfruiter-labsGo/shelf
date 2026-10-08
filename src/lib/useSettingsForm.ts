import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { IntegrationStatus } from '../types'
import { dirtyKeys, formFromStatus, mergeServerState, withoutSecrets, type FormState } from './settings-form'

interface Model {
  form: FormState
  /** O que o servidor tinha na última leitura; a diferença para `form` é o que ainda não foi salvo. */
  synced: FormState
}

/**
 * Formulário de Integrações alimentado pelo status do servidor. Uma releitura do
 * status (depois de "Ler biblioteca agora", ao voltar para a aba) atualiza só o
 * que o usuário não mexeu — a edição pendente sobrevive (ver `settings-form.ts`).
 */
export function useSettingsForm(status: IntegrationStatus | undefined) {
  const [model, setModel] = useState<Model>({ form: {}, synced: {} })

  useEffect(() => {
    if (!status) return
    const next = formFromStatus(status)
    setModel(current => ({ form: mergeServerState(current.form, current.synced, next), synced: next }))
  }, [status])

  const setForm = useCallback<Dispatch<SetStateAction<FormState>>>(update => {
    setModel(current => ({ ...current, form: typeof update === 'function' ? update(current.form) : update }))
  }, [])

  /**
   * Chamar quando o servidor confirmou o que `sent` continha: não há mais nada
   * pendente nesses campos (o que foi digitado depois do clique segue pendente)
   * e os segredos enviados deixam de aparecer na tela.
   */
  const markSaved = useCallback((sent: FormState) => {
    setModel(current => ({ form: withoutSecrets(current.form), synced: withoutSecrets(sent) }))
  }, [])

  const dirty = useMemo(() => dirtyKeys(model.form, model.synced), [model])

  return { form: model.form, setForm, dirty, markSaved }
}
