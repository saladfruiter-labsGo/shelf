# Shelf Sync — extensão do Playnite

Envia para o Shelf, de cada jogo:

- **Tempo jogado** (`Playtime` do Playnite)
- **Status** — mapeado do `CompletionStatus` (Playing/Beaten/Completed/Abandoned/…)
- **Nota** — do `UserScore` (0–100), convertida para a escala 0–5 do Shelf

A capa e o gênero são buscados pelo próprio Shelf via RAWG (pelo nome do jogo), então
não é preciso enviar arquivos. Não há barra de "jogando agora".

## Quando o envio acontece

1. **Todo dia às 21h** — a extensão varre a biblioteca inteira e envia tudo (com as notas
   que você deu até então). É o envio principal: como você costuma dar a nota depois de
   fechar o jogo, às 21h ela já está registrada. **Precisa do Playnite aberto às 21h.**
2. **Se o Playnite estava fechado às 21h** — no próximo dia, ao abrir o Playnite, ele faz o
   envio atrasado automaticamente (imediatamente se um dia foi pulado; senão, no 21h daquele dia).
3. **Ao fechar um jogo** — envia aquele jogo depois de **30 segundos** (pega o tempo e o
   status na hora). Se você der a nota só mais tarde, ela entra no envio das 21h.

O Shelf ignora o que não mudou, então esses envios se sobrepõem sem duplicar nada.

> A hora do envio (21h) pode ser mudada no `config.json` com `"DailyHour": 22`, por exemplo.

## Instalação

1. No Shelf, vá em **Configurações → Integrações → Playnite**, ative o toggle, clique em
   **Salvar integrações** e copie a **URL do Webhook**.
2. Copie a pasta `playnite-extension` inteira para dentro de:
   ```
   %AppData%\Playnite\Extensions\ShelfSync
   ```
   (crie a subpasta `ShelfSync`; dentro dela devem ficar `extension.yaml` e `ShelfSync.psm1`.)
3. Nessa mesma pasta, crie um arquivo **`config.json`** (pode copiar o `config.example.json`)
   com a URL que você copiou:
   ```json
   { "WebhookUrl": "http://SEU-SHELF:3000/api/integrations/playnite/webhook?token=SEU_TOKEN" }
   ```
4. Reinicie o Playnite. Ele vai pedir para confirmar o carregamento de um script — aceite.

> O `config.json` é separado do `.psm1` de propósito: se você atualizar a extensão no futuro
> e o `.psm1` for sobrescrito, sua URL/token continuam intactos.

## Como usar

- **Automático:** só deixar o Playnite aberto. O envio diário das 21h e o envio ao fechar
  cada jogo acontecem sozinhos.
- **Forçar agora um jogo:** clique com o botão direito no jogo → **Shelf → Enviar ao Shelf**.
  Útil logo depois de dar/alterar a nota, sem esperar as 21h.
- **Sincronizar tudo agora:** menu principal → **Shelf → Sincronizar tudo com o Shelf**.
  O Shelf ignora o que não mudou, então é seguro repetir.

> Um arquivo `shelfsync-state.json` é criado na pasta para lembrar a data do último envio
> diário (evita repetir o envio das 21h). Pode deixar quieto.

## Notas

- O status vem do **CompletionStatus** do Playnite. Os nomes padrão já são reconhecidos
  ("Completed"/"Beaten" → concluído, "Playing"/"Played" → jogando, "Abandoned"/"On Hold" →
  abandonado, "Plan to Play"/"Not Played" → wishlist). Se você renomeou os status, um jogo com
  tempo jogado ainda entra como **jogando** e um sem tempo como **wishlist**.
- Um jogo já marcado como **concluído** no Shelf nunca é rebaixado de volta para "jogando".
- Se as capas vierem vazias, configure a `RAWG_API_KEY` no Shelf (o botão
  **Testar busca de capas** na tela de integrações confirma isso).

## Diagnóstico

Os envios (e erros) ficam no log do Playnite: **Menu → Sobre → Abrir pasta de logs →
`playnite.log`**, procure por `ShelfSync`.
