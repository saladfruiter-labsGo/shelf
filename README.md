# Shelf

Um app de biblioteca pessoal para rastrear **filmes, séries, games e livros** em um único lugar — com busca unificada em várias fontes externas, histórico de progresso e um relatório anual/mensal estilo *Spotify Wrapped*.

![stack](https://img.shields.io/badge/React-18-61DAFB) ![stack](https://img.shields.io/badge/TypeScript-5-3178C6) ![stack](https://img.shields.io/badge/Hono-4-8A5FE8) ![stack](https://img.shields.io/badge/SQLite-better--sqlite3-044444) ![deploy](https://img.shields.io/badge/Docker-ready-2496ED)

## ✨ Funcionalidades

- **Busca unificada** — uma busca única consulta filmes e séries (TMDB), games (RAWG) e livros (Google Books) em paralelo.
- **Biblioteca** — adicione itens e acompanhe o status: `wishlist`, `in_progress`, `completed`, `dropped`, além de nota (estrelas, com meio-ponto) e notas próprias. Também navegável por categoria (`/library/games`, `/library/books`, `/library/films`, `/library/series`, `/library/music`).
- **Diário** — histórico cronológico de tudo que foi concluído, com data, categoria e nota.
- **Listas** — crie listas personalizadas para organizar a coleção (ex.: "Favoritos", "Maratona de fim de ano") e adicione/remova itens nelas.
- **Dashboard** — itens recentes por categoria.
- **Detalhes enriquecidos** — sinopse, diretor/desenvolvedor/autor buscados sob demanda na fonte externa (TMDB, RAWG, Google Books) e cacheados no banco.
- **Tema claro/escuro** — alternável, com preferência salva no navegador.
- **Wrap** — relatório anual ou mensal gerado como imagem (canvas 1080×1920, formato de story) com suas estatísticas do período: totais por tipo, nota média, top itens e linha do tempo de atividade.
- **Configurações** — as chaves de API (TMDB, RAWG, Google Books) ficam salvas no próprio banco, sem depender só do ambiente.
- **Integrações** — monitoramento automático via **Plex** (webhook: registra o que foi assistido até o fim e a nota dada) e **YouTube Music via Last.fm** (registra músicas ouvidas, com horas e gêneros). Uma barra "assistindo agora" sob a navbar mostra a reprodução do Plex em tempo real, com progresso. Notificações via **Telegram** avisam sobre atividades da biblioteca (adicionado, concluído, abandonado, nota) — apenas filmes, séries, games e livros.
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
│  ├─ pages/               # Dashboard, Library (+ por categoria), Diary, Lists, ListDetail, MediaDetail, Settings, Wrap
│  ├─ components/          # Carousel, CategoryTag, Layout, MediaCard, SearchModal, StarRating, ...
│  ├─ hooks/               # useHotkey, useTheme
│  ├─ lib/                 # api client, utils
│  └─ types/
├─ server/                 # Backend (Hono)
│  ├─ index.ts             # app, rotas, serve do build estático
│  ├─ db.ts                # conexão + schema SQLite
│  └─ routes/              # search, media, details, wrap, settings, lists
├─ Dockerfile
├─ docker-compose.yml
└─ .env.example
```

## 🚀 Rodando localmente

Pré-requisito: **Node 22+**.

```bash
npm install
cp .env.example .env        # opcional: preencha as chaves ou defina pela UI em Settings
npm run dev                 # sobe cliente (Vite) + servidor (tsx watch) juntos
```

- `npm run dev:client` — só o frontend
- `npm run dev:server` — só o backend
- `npm run build` — build de produção do frontend para `dist/public`
- `npm run typecheck` — checagem de tipos

O servidor, em produção, também serve o build estático do frontend (ver `server/index.ts`).

### Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (default `3000`) |
| `DATA_DIR` | Diretório do banco (default `./data`) |
| `TMDB_API_KEY` | Chave do TMDB (filmes e séries) |
| `RAWG_API_KEY` | Chave do RAWG (games) |
| `GOOGLE_BOOKS_KEY` | Chave do Google Books (livros) |
| `LASTFM_ENABLED` | `1` para ativar o Last.fm (música) |
| `LASTFM_API_KEY` | Chave de API do Last.fm ([last.fm/api/accounts](https://www.last.fm/api/accounts)) |
| `LASTFM_USER` | Nome de usuário do Last.fm |

> Todas as integrações (chaves de API, Last.fm, Plex, Kavita, …) podem ser definidas por `.env` **ou** pela tela **Settings**. Quando definidas na UI ficam gravadas no banco e **têm prioridade** sobre o `.env`; se estiverem em branco na UI, o valor do ambiente é usado.

## 🐳 Rodando com Docker

```bash
cp .env.example .env
docker compose up -d --build
```

O compose sobe o container na porta `3000` e persiste os dados em um volume em `/app/data` (mapeado, no exemplo, para `/mnt/user/appdata/shelf/data` — ajuste conforme seu host).

Saúde: `GET /api/health` → `{ "ok": true }`

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
| `GET/PATCH /api/integrations` | Status e configuração de Plex/Last.fm |
| `POST /api/integrations/plex/webhook?token=` | Recebe webhooks do Plex (`media.scrobble`, `media.rate`) |
| `GET /api/integrations/now-playing` | Mídia em reprodução agora (Plex com progresso; música sem posição) |
| `GET /api/integrations/activity` | Feed de atividade em tempo real |
| `GET /api/integrations/music/stats` | Reproduções, horas ouvidas e gêneros (Last.fm) |
| `POST /api/integrations/lastfm/sync` | Sincroniza o histórico do Last.fm sob demanda |
| `POST /api/integrations/telegram/test` | Envia mensagem de teste no Telegram |
| `GET /api/integrations/telegram/detect-chat` | Descobre o `chat_id` de quem falou com o bot |
| `GET /api/lists` | Lista todas as listas (com contagem de itens) |
| `GET /api/lists/check/:mediaItemId` | Verifica em quais listas um item já está |
| `GET /api/lists/:id` | Detalhe de uma lista com seus itens |
| `POST /api/lists` | Cria uma lista |
| `PATCH /api/lists/:id` | Atualiza nome/descrição de uma lista |
| `DELETE /api/lists/:id` | Remove uma lista |
| `POST /api/lists/:id/items` | Adiciona um item à lista |
| `DELETE /api/lists/:id/items/:mediaItemId` | Remove um item da lista |

## 📄 Licença

Distribuído sob a licença [MIT](./LICENSE).
