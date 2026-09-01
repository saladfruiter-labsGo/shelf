# Shelf

Um app de biblioteca pessoal para rastrear **filmes, séries, games e livros** em um único lugar — com busca unificada em várias fontes externas, histórico de progresso e um relatório anual/mensal estilo *Spotify Wrapped*.

![stack](https://img.shields.io/badge/React-18-61DAFB) ![stack](https://img.shields.io/badge/TypeScript-5-3178C6) ![stack](https://img.shields.io/badge/Hono-4-8A5FE8) ![stack](https://img.shields.io/badge/SQLite-better--sqlite3-044444) ![deploy](https://img.shields.io/badge/Docker-ready-2496ED)

## ✨ Funcionalidades

- **Busca unificada** — uma busca única consulta filmes e séries (TMDB), games (RAWG) e livros (Google Books) em paralelo.
- **Biblioteca** — adicione itens e acompanhe o status: `wishlist`, `in_progress`, `completed`, `dropped`, além de nota (estrelas) e notas próprias.
- **Dashboard** — itens recentes por categoria.
- **Wrap** — relatório anual ou mensal gerado como imagem (canvas 1080×1920, formato de story) com suas estatísticas do período: totais por tipo, nota média, top itens e linha do tempo de atividade.
- **Configurações** — as chaves de API (TMDB, RAWG, Google Books) ficam salvas no próprio banco, sem depender só do ambiente.
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
│  ├─ pages/               # Dashboard, Library, MediaDetail, Settings, Wrap
│  ├─ components/          # Carousel, MediaCard, SearchModal, StarRating, ...
│  ├─ hooks/               # useHotkey
│  ├─ lib/                 # api client, utils
│  └─ types/
├─ server/                 # Backend (Hono)
│  ├─ index.ts             # app, rotas, serve do build estático
│  ├─ db.ts                # conexão + schema SQLite
│  └─ routes/              # search, media, wrap, settings
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

> As chaves também podem ser definidas e editadas pela tela **Settings** — nesse caso elas ficam gravadas no banco.

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
| `GET /api/wrap?period=&year=&month=` | Estatísticas para o Wrap (`annual`/`monthly`) |
| `GET/PATCH /api/settings` | Lê/atualiza as chaves de API |

## 📄 Licença

Distribuído sob a licença [MIT](./LICENSE).
