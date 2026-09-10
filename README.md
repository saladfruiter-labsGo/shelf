# Shelf

Um app de biblioteca pessoal para rastrear **filmes, séries, games e livros** em um único lugar — com busca unificada em várias fontes externas, histórico de progresso e um relatório anual/mensal estilo *Spotify Wrapped*.

![stack](https://img.shields.io/badge/React-18-61DAFB) ![stack](https://img.shields.io/badge/TypeScript-5-3178C6) ![stack](https://img.shields.io/badge/Hono-4-8A5FE8) ![stack](https://img.shields.io/badge/SQLite-better--sqlite3-044444) ![deploy](https://img.shields.io/badge/Docker-ready-2496ED)

## ✨ Funcionalidades

- **Busca unificada** — uma busca única consulta filmes e séries (TMDB), games (RAWG) e livros (Google Books) em paralelo.
- **Biblioteca** — adicione itens e acompanhe o status: `wishlist`, `in_progress`, `completed`, `dropped`, além de nota (estrelas, com meio-ponto) e notas próprias. Também navegável por categoria (`/library/games`, `/library/books`, `/library/films`, `/library/series`, `/library/music`).
- **Diário** — histórico cronológico de tudo que foi concluído, com data, categoria e nota.
- **Listas** — crie listas personalizadas para organizar a coleção (ex.: "Favoritos", "Maratona de fim de ano") em três modos: **Lista** (grade de capas), **Ranking** (mesma grade, com a posição em cada capa e reordenação arrastando) e **Tierlist** (tiers que você cria, renomeia, colore e reordena, arrastando as capas entre eles ou adicionando direto em um tier). Cada lista tem filtros de década, gênero e tipo, um interruptor para **esmaecer o que você já consumiu** e a barra de progresso "já consumi X de Y".
- **Dashboard** — itens recentes por categoria.
- **Detalhes enriquecidos** — sinopse, diretor/desenvolvedor/autor buscados sob demanda na fonte externa (TMDB, RAWG, Google Books) e cacheados no banco.
- **Tema claro/escuro** — alternável, com preferência salva no navegador.
- **Wrap** — relatório anual ou mensal gerado como imagem (canvas 1080×1920, formato de story) com suas estatísticas do período: totais por tipo, nota média, top itens e linha do tempo de atividade.
- **Configurações** — preferências do app (tema). As chaves de API e os serviços conectados moram em **Integrações**.
- **Proteção e portabilidade** — cria snapshots integrais e verificados do SQLite, com retenção automática, e exporta biblioteca, backlog ou tudo em **JSON v2** (itens, diário, séries, listas/tierlists, atividade musical e preços, sem credenciais) ou **CSV**. Importa exports v1/v2 do Shelf, o **Letterboxd** (`diary`, `ratings`, `watched`, `watchlist`) e a **wishlist da Steam**. Reimportar não duplica nada, e a `watchlist` nunca rebaixa um filme já assistido de volta ao backlog.
- **Steam (backlog bidirecional)** — mantém a wishlist da Steam e o backlog de jogos do Shelf em sincronia nos dois sentidos, a cada 6 horas. **A Steam mexe só no backlog** — jogo consumido é assunto do Playnite. Detalhes em [Steam: o que sincroniza e o que exige cookie](#steam-o-que-sincroniza-e-o-que-exige-cookie).
- **Integrações** — as chaves de API (TMDB, RAWG, Google Books) ficam salvas no próprio banco, sem depender só do ambiente. Monitoramento automático via **Plex** (webhook: registra o que foi assistido até o fim e a nota dada) e **YouTube Music via Last.fm** (registra músicas ouvidas, com horas e gêneros). Uma barra "assistindo agora" sob a navbar mostra a reprodução do Plex em tempo real, com progresso. Notificações via **Telegram** avisam sobre atividades da biblioteca (adicionado, concluído, abandonado, nota) — apenas filmes, séries, games e livros.
- **Preços do backlog** — jogos de PC marcados como backlog têm o preço acompanhado no [IsThereAnyDeal](https://isthereanydeal.com/) na região configurada (padrão `BR`). A **home abre com as promoções do backlog**; o card do backlog mostra a melhor oferta, o desconto e o selo de menor histórico; e a página do jogo traz os indicadores (melhor preço, menor histórico, menor do mês, menor em 30 dias), gráfico do menor preço por dia — com tabela equivalente para leitores de tela —, a **lista completa de lojas** (preço atual, menor histórico daquela loja e há quanto tempo cada um foi visto, inclusive de lojas que já não ofertam) e correspondência manual quando a edição é ambígua. Sincroniza a cada 6 horas.
- **Armazenamento local** — dados em SQLite (WAL), auto-criado em `data/shelf.db`.

## 🧱 Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Vite, React 18, TypeScript, Tailwind CSS, React Router, TanStack Query |
| Backend | Hono (Node) rodando TypeScript direto via `tsx` |
| Banco | better-sqlite3 (SQLite) |
| Fontes externas | TMDB, RAWG, Google Books |
| Deploy | Docker / docker-compose |

## 📁 Estrutura

```
shelf/
├─ src/                    # Frontend (Vite + React)
│  ├─ pages/               # Dashboard, Library (+ por categoria), Diary, Lists, ListDetail, MediaDetail, Settings, Integrations, ImportExport, Wrap
│  ├─ components/          # Carousel, CategoryTag, Layout, MediaCard, SearchModal, StarRating, ...
│  ├─ hooks/               # useHotkey, useTheme
│  ├─ lib/                 # api client, utils
│  └─ types/
├─ server/                 # Backend (Hono)
│  ├─ index.ts             # app, rotas, serve do build estático
│  ├─ db.ts                # conexão + schema SQLite
│  ├─ prices/              # preços do backlog (ITAD): provider, matcher, repository, stats, service, sync
│  ├─ steam/               # conector Steam: client (Web API + loja), plan (diff bidirecional), sync
│  ├─ transfer/            # importação/exportação: export, importer, letterboxd
│  └─ routes/              # search, media, details, wrap, settings, lists, prices, transfer
├─ Dockerfile
├─ docker-compose.yml
└─ .env.example
```

## 🚀 Rodando localmente

Pré-requisito: **Node 22+**.

```bash
npm install
cp .env.example .env        # opcional: preencha as chaves ou defina pela UI em Integrações
npm run dev                 # sobe cliente (Vite) + servidor (tsx watch) juntos
```

- `npm run dev:client` — só o frontend
- `npm run dev:server` — só o backend
- `npm run build` — build de produção do frontend para `dist/public`
- `npm run typecheck` — checagem de tipos
- `npm test` — testes do backend (`node --test` com fixtures gravadas; nenhuma chamada externa real)

O servidor, em produção, também serve o build estático do frontend (ver `server/index.ts`).

### Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (default `3000`) |
| `DATA_DIR` | Diretório do banco (default `./data`) |
| `IMG_PROXY_ALLOWED_HOSTS` | Hosts HTTPS extras aceitos pelo proxy de capas, separados por vírgula |
| `BACKUP_ENABLED` | `0` desativa os snapshots automáticos (default `1`) |
| `BACKUP_DIR` | Diretório persistente dos snapshots (default `DATA_DIR/backups`) |
| `BACKUP_INTERVAL_HOURS` | Intervalo entre snapshots automáticos (default `24`) |
| `BACKUP_RETENTION_DAYS` | Janela de snapshots diários (default `14`) |
| `BACKUP_RETENTION_WEEKLY` | Quantidade de semanas preservadas (default `8`) |
| `BACKUP_RETENTION_SAFETY` | Cópias manuais/pré-importação preservadas por tipo (default `5`) |
| `TMDB_API_KEY` | Chave do TMDB (filmes e séries) |
| `RAWG_API_KEY` | Chave do RAWG (games) |
| `GOOGLE_BOOKS_KEY` | Chave do Google Books (livros) |
| `LASTFM_ENABLED` | `1` para ativar o Last.fm (música) |
| `LASTFM_API_KEY` | Chave de API do Last.fm ([last.fm/api/accounts](https://www.last.fm/api/accounts)) |
| `LASTFM_USER` | Nome de usuário do Last.fm |
| `ITAD_ENABLED` | `1` para ativar o acompanhamento de preços do backlog |
| `ITAD_API_KEY` | Chave do IsThereAnyDeal ([isthereanydeal.com/apps/new](https://isthereanydeal.com/apps/new/)) |
| `ITAD_COUNTRY` | Região das ofertas, ISO de 2 letras (default `BR`) |
| `STEAM_ENABLED` | `1` para ativar o conector da Steam |
| `STEAM_ID` | SteamID64 do perfil (17 dígitos) |
| `STEAM_API_KEY` | Chave da Steam Web API ([steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)) — opcional, só para não enviar à wishlist jogo já comprado |
| `STEAM_LOGIN_SECURE` | Cookie da loja — habilita escrever na wishlist (Shelf → Steam) |
| `STEAM_SESSION_ID` | Cookie `sessionid` da loja, par do anterior |
| `STEAM_SYNC_MODE` | `both` (default), `pull` (só Steam → Shelf) ou `push` (só Shelf → Steam) |
| `STEAM_SYNC_REMOVALS` | `1` para propagar remoções entre os dois lados |

> Todas as integrações (chaves de API, Last.fm, Plex, Kavita, Steam, …) podem ser definidas por `.env` **ou** pela tela **Integrações**. Quando definidas na UI ficam gravadas no banco e **têm prioridade** sobre o `.env`; se estiverem em branco na UI, o valor do ambiente é usado.

## 🐳 Rodando com Docker

```bash
cp .env.example .env
docker compose up -d --build
```

O compose sobe o container na porta `3000` e persiste o banco em `/app/data` e os snapshots integrais em `/app/backups`. No exemplo, ambos ficam sob `/mnt/user/appdata/shelf`; inclua a pasta `backups` na sua cópia externa do appdata. Snapshots no mesmo servidor protegem contra corrupção e importações ruins, mas não substituem uma cópia em outro dispositivo.

O Shelf cria um snapshot consistente pela Online Backup API do SQLite, abre a cópia com `PRAGMA quick_check` e só então publica o arquivo definitivo. Também cria uma cópia preventiva antes de atualizar um schema antigo e antes de aplicar importações. A tela **Importação/Exportação** mostra o último snapshot e permite criar um sob demanda.

Saúde: `GET /api/health` consulta também o SQLite e responde `{ "ok": true }`; durante o encerramento ou se o banco falhar, responde `503`. A imagem executa esse check a cada 30 segundos. O Docker marca o container como `unhealthy`; para reinício por healthcheck é necessário que o orquestrador/plug-in do Unraid observe esse estado. Falhas fatais do processo encerram com erro e são cobertas por `restart: unless-stopped`.

No `SIGTERM`/`SIGINT`, o Shelf para de aceitar conexões, cancela novos polls, espera requisições e jobs correntes, faz checkpoint do WAL e fecha o banco. O compose concede 30 segundos para esse ciclo. O entrypoint ajusta a propriedade dos volumes legados e executa o processo Node como o usuário não privilegiado `node`.

### Segurança de acesso

O Shelf ainda é uma aplicação de instância única, sem login. Use-o apenas numa LAN confiável ou por uma VPN como o Tailscale; não publique a porta `3000` diretamente na internet. Se precisar colocá-lo atrás de um domínio público antes da autenticação multiusuário, aplique autenticação no reverse proxy.

A API aceita navegadores apenas no mesmo host do Shelf e não habilita CORS. Clientes de webhook sem cabeçalho `Origin` continuam funcionando com o token próprio. Respostas dinâmicas da API não são gravadas no cache do navegador/service worker; chaves de API e cookies configurados são devolvidos à interface somente como estado e máscara. Os tokens que aparecem nas URLs de webhook são credenciais: compartilhe-os apenas com o Plex ou o Playnite correspondente.

O proxy usado para desenhar capas nos Stories aceita apenas HTTPS dos provedores conhecidos. Para uma capa hospedada em outro serviço público, acrescente apenas o hostname necessário em `IMG_PROXY_ALLOWED_HOSTS`; endereços arbitrários e redirects para a rede interna são bloqueados.

## 🌐 API

| Rota | Descrição |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/search?q=&type=` | Busca unificada (`type`: movie, series, game, book ou vazio = tudo) |
| `GET /api/media` | Lista itens da biblioteca (filtros `type`, `status`, `limit`) |
| `GET /api/media/recent` | Itens recentes por tipo |
| `GET /api/media/:id` | Detalhe de um item |
| `GET /api/details/:type/:external_id` | Sinopse/criador/autor do item na fonte externa (cacheado no banco após a 1ª busca) |
| `GET /api/wrap?period=&year=&month=` | Estatísticas para o Wrap (`annual`/`monthly`) |
| `GET/PATCH /api/settings` | Lê/atualiza as chaves de API |
| `GET/PATCH /api/integrations` | Status e configuração de Plex/Last.fm/Telegram/Kavita/Playnite/Steam/preços |
| `GET /api/transfer/export?scope=&format=` | Baixa o export (`scope`: `all`, `library`, `backlog`; `format`: `json`, `csv`) |
| `GET /api/transfer/export/summary` | Contagens por escopo, para a tela de exportação |
| `GET /api/transfer/backup/status` | Estado, retenção e último snapshot integral |
| `POST /api/transfer/backup` | Cria e verifica um snapshot integral sob demanda |
| `POST /api/transfer/import/shelf` | Restaura um export JSON do Shelf (`mode`: `merge` ou `replace`) |
| `POST /api/transfer/import/letterboxd` | Importa um CSV do Letterboxd (`kind`: `diary`, `ratings`, `watched`, `watchlist`) |
| `POST /api/transfer/import/letterboxd/detect` | Detecta o tipo do CSV pelo cabeçalho e pelo nome do arquivo |
| `POST /api/transfer/import/steam` | Traz a wishlist da Steam para o backlog, uma vez |
| `POST /api/integrations/steam/test` | Testa o acesso à wishlist/biblioteca e informa se a escrita está liberada |
| `POST /api/integrations/steam/sync` | Sincroniza o backlog com a wishlist da Steam sob demanda |
| `POST /api/integrations/steam/resolve` | Converte link de perfil ou vanity URL em SteamID64 |
| `POST /api/integrations/itad/test` | Testa a chave do IsThereAnyDeal na região configurada |
| `POST /api/integrations/itad/sync` | Sincroniza os preços do backlog sob demanda |
| `POST /api/integrations/plex/webhook?token=` | Recebe webhooks do Plex (`media.scrobble`, `media.rate`) |
| `GET /api/integrations/now-playing` | Mídia em reprodução agora (Plex com progresso; música sem posição) |
| `GET /api/integrations/activity` | Feed de atividade em tempo real |
| `GET /api/integrations/music/stats` | Reproduções, horas ouvidas e gêneros (Last.fm) |
| `POST /api/integrations/lastfm/sync` | Sincroniza o histórico do Last.fm sob demanda |
| `POST /api/integrations/telegram/test` | Envia mensagem de teste no Telegram |
| `GET /api/integrations/telegram/detect-chat` | Descobre o `chat_id` de quem falou com o bot |
| `GET /api/lists` | Lista todas as listas (com contagem de itens, capas da colagem e itens por tipo) |
| `GET /api/lists/check/:mediaItemId` | Verifica em quais listas um item já está |
| `GET /api/lists/:id` | Detalhe de uma lista com seus itens e tiers |
| `POST /api/lists` | Cria uma lista (`mode`: `list`, `ranking` ou `tier`) |
| `PATCH /api/lists/:id` | Atualiza nome, descrição, modo ou o interruptor de esmaecer |
| `DELETE /api/lists/:id` | Remove uma lista |
| `POST /api/lists/:id/items` | Adiciona um item à lista (opcionalmente já num tier) |
| `DELETE /api/lists/:id/items/:mediaItemId` | Remove um item da lista |
| `PUT /api/lists/:id/order` | Grava a ordem manual inteira (ranking e arraste entre tiers) |
| `POST /api/lists/:id/tiers` | Cria um tier |
| `PATCH /api/lists/:id/tiers/:tierId` | Renomeia ou troca a cor de um tier |
| `PUT /api/lists/:id/tiers/order` | Reordena os tiers |
| `DELETE /api/lists/:id/tiers/:tierId` | Apaga um tier (as capas voltam para "sem tier") |
| `GET /api/prices/backlog` | Resumo de preço de todos os jogos do backlog (uma consulta em lote) |
| `GET /api/prices/games/:id?range=&shop=` | Indicadores, ofertas e pontos do gráfico de um jogo (`range`: `30d`, `90d`, `1y`, `all`) |
| `POST /api/prices/games/:id/refresh` | Atualização manual, com cooldown de 5 min por jogo |
| `GET /api/prices/games/:id/matches?q=` | Candidatos do provedor para correção manual da correspondência |
| `PATCH /api/prices/games/:id/match` | Confirma, troca (`provider_game_id`) ou desassocia (`clear: true`) o produto |

### Steam: o que sincroniza e o que exige cookie

- **Escopo:** wishlist da Steam ↔ jogos com `status = 'wishlist'` no Shelf, **e nada além disso**. O conector nunca cria, promove ou rebaixa item da biblioteca: um jogo que já existe aqui só adota o AppID, mantendo o `game_status` que o Playnite definiu. A biblioteca comprada na Steam não é importada — quem registra o que foi jogado é o Playnite.
- **Chave de casamento:** o **AppID**, guardado em `media_items.steam_appid`. Ele é descoberto pelas lojas da RAWG e, em último caso, pela busca da loja — e só quando o título bate **exatamente** depois de normalizado. Na dúvida o jogo fica listado como "sem AppID" e não sobe, para não adicionar a edição errada na conta.
- **Ler não precisa de chave:** trazer a wishlist só exige o SteamID com o perfil público. A Web API key é opcional e serve a um único propósito: consultar os jogos que você já comprou, para não tentar enviá-los à wishlist.
- **Escrever exige os cookies da loja:** a Steam não tem endpoint público para alterar a wishlist — só o AJAX da loja, autenticado por `steamLoginSecure` + `sessionid`. Sem eles a sincronização segue funcionando de mão única, e o relatório diz quantos itens ficaram esperando. Os cookies ficam apenas no banco do seu servidor e expiram quando você sai da conta na Steam.
- **Remoções são opcionais e conservadoras:** só se propagam para itens que já estavam nos dois lados numa sincronização anterior, e só com a opção ligada. Como a Steam responde igual para wishlist vazia e perfil privado, uma wishlist que volta vazia tendo histórico **desliga as remoções daquela rodada** e reporta o aviso, em vez de esvaziar o backlog.

### Preços: como funciona e o que fica de fora

- **Fonte:** IsThereAnyDeal. O RAWG continua sendo a identidade do jogo (é dele que sai o Steam AppID usado para casar a edição certa).
- **Escopo:** só jogos de **PC** com `status = 'wishlist'`. PlayStation, Xbox e Nintendo ficam para uma etapa posterior — essas lojas não expõem preços públicos adequados.
- **Correspondência:** Steam AppID → título exato → revisão manual. Na dúvida o jogo fica `ambiguous` e **nenhum preço é exibido** até a confirmação, para não mostrar o preço de uma DLC ou de uma edição Deluxe.
- **Histórico:** ao casar o jogo, o log de mudanças de preço do último ano é importado; depois disso cada sincronização grava um snapshot diário por oferta. Sair do backlog só interrompe as consultas — o histórico é preservado e o acompanhamento retoma se o jogo voltar.
- **Limites:** os quatro indicadores usam o histórico local; a interface informa "histórico local desde DD/MM/AAAA" para não sugerir precisão que não existe. Respostas `429` são reagendadas respeitando o `Retry-After`, e a indisponibilidade do provedor nunca apaga o último preço conhecido.
- **Segurança:** a chave do ITAD nunca é enviada ao navegador (aparece mascarada em `/api/integrations`), as chamadas externas só vão para `api.isthereanydeal.com`, e só links de compra HTTPS são persistidos e renderizados (com `rel="noopener noreferrer sponsored"`, preservando os parâmetros de afiliado do provedor).

## 📄 Licença

Distribuído sob a licença [MIT](./LICENSE).
