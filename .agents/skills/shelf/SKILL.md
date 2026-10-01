---
name: shelf
description: Manter e evoluir o Shelf, aplicação self-hosted de biblioteca de mídia em React, Hono e SQLite. Use para implementar, revisar, diagnosticar ou planejar mudanças neste repositório, especialmente em biblioteca, diário, integrações, banco, segurança, backup, importação/exportação e deploy.
---

# Shelf

O Shelf é uma aplicação self-hosted para organizar filmes, séries, jogos, livros e música. A instância atual é single-user, privada e acessada por LAN/Tailscale. O produto combina curadoria manual com ingestão automática por Plex, Last.fm, Kavita, Playnite, Steam, Telegram e IsThereAnyDeal.

## Antes de agir

1. Confira `git status`, preserve mudanças alheias e sincronize o `main` com `origin/main`.
2. Leia a referência correspondente à área tocada:
   - banco, histórico, status ou migrations: [references/data-model.md](references/data-model.md);
   - React, rotas, cache ou aparência: [references/frontend.md](references/frontend.md);
   - provedores, polling ou webhooks: [references/integrations.md](references/integrations.md);
   - implementação, testes, segurança, Git e entrega: [references/quality-and-workflow.md](references/quality-and-workflow.md).
3. Faça uma entrega coesa por branch e PR. Não empilhe uma nova PR sobre outra: espere o merge e volte a sincronizar o `main`.

## Invariantes do produto

- O status base `wishlist` nunca pertence à biblioteca. Ele se divide em duas filas com páginas próprias — Wishlist (quero comprar/consumir) e Backlog (jogo que tenho e não joguei) — por `QUEUE_PREDICATE`. Use as funções e predicados de `server/media-domain.ts`; não replique comparações de status pelas telas.
- Dado de jogo vindo direto da Steam leva selo de verificado (`SourceBadge`, azul `--steam-solid`); o que é gerado ou editado no Shelf não leva. A procedência mora em `game_status_source`/`playtime_source`. Jogo com AppID e algum dado vindo da Steam (`isSteamVerified`) ganha a marca "Verificado pela Steam" na capa e no título (`SteamVerifiedMark`).
- Jogo ligado à Steam usa a arte vertical oficial (`library_600x900_2x`) como capa (`server/steam/covers.ts`), nunca por cima de capa escolhida à mão (`cover_custom = 1`).
- `game_status` deriva o `status` base por `GAME_STATUS_TO_BASE`, centralizado em `server/media-domain.ts`.
- O diário é histórico N:1: cada consumo pode gerar uma nova linha. Não reduza `diary_entries` a um espelho 1:1 de `media_items`. Filmes e episódios entram ao concluir; um episódio vira uma entrada DE episódio (`season_number` + `episode_number`), nunca um comentário na série, e a transição de uma temporada para concluída cria uma linha própria (`season_number` preenchido e `episode_number` nulo). Livros e jogos acumulam snapshots de progresso somente quando o provedor informa uma atualização real, e o job diário materializa o último snapshot de cada dia. Zerar/platinar pelas conquistas da Steam cria a conclusão com a data real do desbloqueio (`source = 'steam'`). Zerar/platinar no Playnite cria na hora, além disso, uma linha de conclusão (sem campos de progresso) com a nota resolvida; a nota que chega depois completa essa linha, e a avaliação rápida nunca cai num snapshot de progresso.
- Diário, linhas normalizadas de atividade, agregados musicais e histórico de preços não expiram. A retenção de 30 dias define apenas `activity_events.raw = NULL`.
- Uma avaliação rápida de mídia deve manter mídia e conclusão do diário coerentes; reutilize `server/quick-rating.ts`. A nota de temporada vive em `series_seasons.rating`, é independente da nota geral da série e deve atualizar também sua conclusão de temporada no diário.
- Com a biblioteca da Steam ligada, tempo de jogo e última vez jogada vêm da Steam (`playtime_source = 'steam'`); leituras automáticas só promovem status e nunca rebaixam escolha manual.
- A nota do Shelf prevalece sobre o Playnite por padrão. A política configurável fica em `PLAYNITE_RATING_POLICY`.
- Integrações precisam ser idempotentes. Identidade externa e timestamp do evento devem vir do provedor sempre que existirem; retry não pode duplicar card, atividade ou diário.
- Configuração salva em `settings` prevalece sobre `.env`; segredo nunca volta em claro para o frontend.

## Arquitetura atual

```text
src/
  App.tsx                 rotas com lazy-loading por página
  pages/                  Dashboard, bibliotecas, diário, listas, detalhes, Wrap e configurações
  components/Layout.tsx   navegação persistente e Suspense das páginas
  lib/api.ts              único cliente HTTP do frontend
  types/index.ts          contratos do frontend
server/
  index.ts                Hono, segurança, rotas, estáticos e ciclo de vida
  db.ts                   conexão WAL, bootstrap do schema e plano versionado de migrations
  migrations.ts           executor transacional de migrations
  media-domain.ts         enums e regras centrais de biblioteca/status
  quick-rating.ts         nota atômica em mídia + diário
  image-cache.ts           variantes WebP persistentes para capas externas
  routes/integrations.ts  configuração e orquestração explícita dos polls
  routes/integrations/    um módulo por provedor
  diary-progress.ts       snapshots e fechamento diário de livros/jogos
  integrations/           lógica pura/testável por provedor
  transfer/               snapshots, export/import e importadores externos
  prices/ e steam/        domínios isolados de preço e sincronização
```

O backend serve a API e o build Vite pela mesma origem. O acesso de navegador é same-origin; clientes sem `Origin`, como Plex e Playnite, usam seus próprios tokens. O container roda sem root, possui healthcheck e encerra drenando conexões/jobs antes do checkpoint WAL e fechamento do SQLite.

Artes enviadas pelo usuário ficam em `DATA_DIR/covers/<sha256>.webp` e são servidas por `server/routes/covers.ts` (`/api/covers/...`, cache imutável); o arquivo é apagado quando nenhum item o referencia mais. Os snapshots do SQLite não copiam esses arquivos — eles vivem no volume de dados, como o cache de imagens.

Capas externas passam por `server/routes/img.ts`: o primeiro acesso respeita a allowlist HTTPS, redimensiona/converte para WebP e salva em `DATA_DIR/images`; as telas usam o cache local por meio de `src/lib/images.ts`. O SQLite guarda URLs e metadados, nunca os bytes das imagens.

## Forma esperada das mudanças

- Prefira regras puras em módulos de domínio e rotas finas para I/O.
- Reuse o cliente em `src/lib/api.ts`, os tipos existentes e as fontes centrais de enums/predicados.
- Mantenha polls no bootstrap/orquestrador, nunca como efeito colateral de importar uma rota.
- Para alterações de schema, crie a próxima migration versionada e preserve bancos existentes; migrations destrutivas exigem snapshot e verificação de FKs.
- Para páginas novas, use import dinâmico em `src/App.tsx` e fallback dentro do `Layout`.
- Preserve pt-BR, os tokens de tema e a linguagem visual do arquivo vizinho. Garanta estados de carregamento, vazio, erro e acessibilidade básica.

## Validação e entrega

Antes de abrir a PR, rode:

```bash
npm run typecheck
npm test
npm run build
```

O CI usa Node 22 e repete a mesma sequência. No Windows com Node 24, `better-sqlite3` pode abortar durante teardown; `scripts/test.mjs` tenta novamente. Considere isso um problema de ambiente apenas quando o processo abortar nativamente e o teste afetado passar no Node 22/CI — falhas de asserção continuam sendo regressões reais.

Explique na PR: comportamento anterior, decisão tomada, impacto nos dados, testes e qualquer limitação remanescente. Só mescle com autorização e CI verde.
