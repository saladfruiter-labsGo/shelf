# Integrações

Leia esta referência antes de mudar webhooks, polls, settings de provedores, deduplicação ou notificações.

## Organização

`server/routes/integrations.ts` contém o contrato de configuração, monta sub-routers e orquestra polls. Cada provedor vive em `server/routes/integrations/`; lógica pura e tipos ficam em `server/integrations/`. Não volte a concentrar todas as integrações num arquivo único.

Os loops começam explicitamente por `startIntegrationPolling()` no bootstrap e são drenados por `stopIntegrationPolling()` no shutdown. Importar uma rota não pode iniciar timer.

| Integração | Transporte | Cadência |
|---|---|---|
| Plex sessões | polling | 5 s |
| Last.fm | polling | 30 s |
| Kavita | polling | 60 s |
| Telegram callbacks | polling | 10 s |
| Playnite | webhook disparado pelo PC | fechamento, agenda/catch-up e envio manual |
| Steam/ITAD | jobs próprios | 6 h |

Cada poll tem guarda de reentrância e entra no conjunto de promises aguardadas pelo shutdown.

## Configuração e segredos

`cfg()` lê valor não vazio de `settings` antes do ambiente; `setCfg()` persiste. `GET /api/integrations` retorna apenas estado e máscara dos segredos. `PATCH` só troca token quando recebe valor novo explícito.

Chaves relevantes:

- Plex: enabled, URL, token, usuário e webhook secret;
- Last.fm: enabled, API key, usuário e cursor `LASTFM_LAST_UTS`;
- Kavita: enabled, URL, API key, library id e `KAVITA_STATE`;
- Playnite: enabled, webhook secret, estado e `PLAYNITE_RATING_POLICY`;
- Telegram: enabled, bot token, chat, tópico e `TELEGRAM_UPDATE_OFFSET`;
- Steam: SteamID, API key opcional, cookies de escrita, modo e remoções;
- ITAD: enabled, API key e país.

Ao trocar o token do Telegram, zere o cursor. Tokens em URLs de webhook são credenciais e não devem aparecer em logs ou mensagens públicas.

## Regra geral de ingestão

Separe normalização pura, resolução de identidade, escrita idempotente e efeito externo opcional. Use o timestamp fornecido pelo provedor (`lastViewedAt`, `updatedAt`, scrobble time, última leitura/jogo); `new Date()` é fallback.

Teste enviando o mesmo payload duas vezes e verificando contagem de mídia, atividade e diário. Nunca apague estado válido porque o provedor falhou ou retornou vazio.

## Plex

Webhook multipart em `POST /api/integrations/plex/webhook?token=...`, com `media.scrobble` e `media.rate`. Sessões ativas vêm do poll separado.

Deduplicação tenta identidade Plex, resolve TMDB e só então usa título/ano como fallback não ambíguo. Séries e filmes manuais devem ser reutilizados pelo `tmdb_id`; não crie segundo card porque o Plex usa GUID. Episódio chama a lógica de séries e não conclui a obra sem todos os episódios conhecidos.

Reenvio precisa manter uma única atividade e uma única entrada de diário para a mesma sessão. Capas passam por `/api/integrations/plex/image`, sem expor o token.

## Last.fm

`LASTFM_LAST_UTS` impede reprocessamento. Cada scrobble cria evento normalizado, incrementa/upserta `music_tracks`, enriquece duração/gênero quando necessário e preserva primeira/última reprodução.

Os agregados musicais são duráveis. Limpar `activity_events.raw` não altera contadores nem estatísticas. Em testes, substitua `fetch` e restaure-o em `finally`.

## Kavita

O fluxo troca API key por JWT e reautentica em 401. `all-v2` fornece progresso por série/obra; o Shelf salva páginas, autor, status e nota no nível da obra.

A API atual do Kavita não fornece nota do usuário em `VolumeDto`. Não invente sincronização de nota por volume. Se o produto ganhar isso, modele avaliações próprias do Shelf e trate o progresso dos volumes separadamente.

Conclusões idempotentes gravam diário e podem oferecer avaliação pelo Telegram quando ainda não há nota.

## Playnite

O webhook recebe identidade, nome, playtime, completion status, user score, datas, biblioteca, developers e publishers. O domínio normaliza status, converte score 0–100 para estrelas 0–5 em meio ponto e aceita string/array do PowerShell. Capa/gênero vêm do RAWG quando possível; estado serializado evita eventos duplicados.

### Conflito de notas

- `shelf` (padrão): nota positiva existente é preservada; Playnite só preenche item sem nota;
- `playnite`: a nota positiva mais recente do Playnite prevalece.

Nota vazia nunca apaga avaliação existente. Só gere atividade/notificação quando a nota efetivamente mudar.

A extensão envia no fechamento, na agenda diária, em catch-up e manualmente. Conclusões sem nota também entram na fila do Dashboard e no Telegram, portanto a avaliação não depende mais do timing do PC.

## Telegram

`notifyLibraryActivity()` envia sem bloquear a rota. Música não notifica. Mensagens escapam HTML e suportam tópico.

Conclusão sem nota e com `mediaItemId` recebe teclado de 0,5 a 5 estrelas. Como o Shelf não é público, `server/telegram-rating.ts` usa `getUpdates`:

- valida chat e tópico;
- valida mídia e escala;
- chama `applyQuickRating()` para mídia + diário;
- confirma o callback, remove o teclado e avança o offset.

O Telegram continua opcional e funciona atrás do Tailscale; não crie webhook público para os botões.

## Steam e preços

Steam sincroniza apenas wishlist ↔ backlog. Itens consumidos são responsabilidade do Playnite. Pull requer perfil público; escrita exige cookies. Remoções são opcionais e conservadoras diante de resposta vazia/ambígua.

ITAD acompanha jogos PC no backlog. Correspondência segue Steam AppID, título exato e revisão manual. Na ambiguidade, não mostre preço. `429` respeita `Retry-After`; falha não elimina oferta/histórico anterior.
