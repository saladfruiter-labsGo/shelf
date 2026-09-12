# Modelo de dados e durabilidade

Leia esta referência ao alterar schema, queries, status, diário, estatísticas, import/export, backup ou retenção.

## SQLite e ciclo de vida

O banco é `${DATA_DIR:-./data}/shelf.db`, aberto por `better-sqlite3` com WAL e foreign keys. Uma única instância é a arquitetura deliberada atual; SQLite continua adequado para esse deployment privado. Não proponha PostgreSQL apenas por expectativa de múltiplos usuários futuros: reavalie quando houver requisito concreto de várias instâncias, escrita concorrente distribuída ou operação externa do banco.

No encerramento, o servidor para conexões e novos jobs, aguarda polls/requisições ativos, executa `wal_checkpoint(TRUNCATE)` e fecha o banco. Não contorne `server/lifecycle.ts` nem introduza jobs que continuem usando o banco depois de `stopBackgroundJobs`.

## Tabelas principais

### `media_items`

Uma linha por obra, com `UNIQUE(external_id, type)`.

- `type`: `movie | series | game | book | music`.
- `status`: `wishlist | in_progress | completed | dropped`.
- `rating`: escala 0–5; 0 significa sem nota na mídia. A UI trabalha em passos de 0,5.
- metadados comuns: título, capa, ano, gênero, runtime, sinopse, criadores/autor e datas;
- livros: `pages_total`, `pages_read`;
- jogos: `playtime_seconds`, `game_status`, `last_played_at`, publisher, library, `steam_appid`;
- filmes/séries do Plex podem usar GUID como `external_id`; `tmdb_id` mantém a identidade comum para deduplicação;
- `favorite`: 0 fora dos favoritos, 1 favorito, 2 destaque coroado da categoria.

O schema impõe `CHECK` para type/status/game_status. Valide também na borda HTTP para devolver 400 claro em vez de depender do erro do SQLite.

### Biblioteca e backlog

`wishlist` é backlog e não biblioteca. O predicado canônico é `LIBRARY_STATUS_PREDICATE`, em `server/media-domain.ts`; use-o no SQL antes de `LIMIT`. O cliente pode paginar tudo via `api.media.listAll`, mas não deve redefinir o conceito de biblioteca.

Games têm um `game_status` granular:

| `game_status` | `status` base |
|---|---|
| `jogando` | `in_progress` |
| `zerado` | `completed` |
| `platinado` | `completed` |
| `abandonado` | `dropped` |
| `nunca_jogado` | `wishlist` |

Use `GAME_STATUS_TO_BASE` de `server/media-domain.ts`. Não duplique o mapa.

### `diary_entries`

Histórico N:1 em relação à mídia. Cada consumo pode gerar uma linha com data, nota, comentário e origem. Séries também guardam temporada/episódio.

O alcance de uma entrada mora em `season_number`/`episode_number`, nunca no texto: episódio tem os dois preenchidos, temporada só `season_number`, obra inteira nenhum. `comment` é o campo do usuário e não serve de rótulo — o título do episódio vem do join com `series_episodes` (`episode_title`) e o da temporada de `series_seasons` (`season_title`). No frontend, use `diaryScope()` de `src/lib/diary.ts` em vez de remontar `T2E5` por tela.

- nunca apague entradas por idade;
- retries de integrações não podem duplicar a mesma sessão;
- ao avaliar rapidamente uma conclusão automática, use `applyQuickRating()` para atualizar em transação a mídia e a conclusão sem nota mais recente;
- apagar uma mídia remove seu diário por `ON DELETE CASCADE`, portanto essa ação precisa continuar explícita na UI.

### Séries

`series_seasons` e `series_episodes` pertencem a `media_items` com cascade. `server/series.ts` é responsável por estrutura TMDB, marcação e `recomputeSeriesStatus`. Uma série só conclui quando todos os episódios conhecidos foram vistos; receber um episódio isolado nunca autoriza inventar que a série inteira acabou.

Cada temporada tem sua própria `rating` (0 significa sem nota), independente de `media_items.rating`. Na transição para concluída, a temporada cria uma entrada automática no diário com `season_number` e sem `episode_number`; retries enquanto ela já está concluída não duplicam essa entrada. A avaliação rápida atualiza a temporada e a conclusão de temporada sem nota mais recente.

### Atividade e música

- `activity_events` mantém o evento normalizado de cada integração. `UNIQUE(source, external_ref, occurred_at)` ajuda a tornar retries idempotentes.
- `music_tracks` é o agregado por artista/faixa, com contador, primeira/última execução, duração e gênero.

A retenção executada por `server/activity-retention.ts` **não apaga linhas**: após a janela configurada, somente `activity_events.raw` vira `NULL`. Feed, timestamps, notas, títulos, diário e estatísticas continuam por tempo indeterminado.

### Mídia isolada de listas

`list_only_items` guarda snapshots de resultados pesquisados dentro de uma lista. Eles pertencem à lista, não são linhas de `media_items`, não entram na biblioteca, no backlog, no diário, nos preços ou nas integrações. A mesma obra pode existir independentemente em listas diferentes.

### Preços

`game_price_products`, `game_price_offers` e `game_price_history` guardam identidade no provedor, snapshot atual e histórico. Valores monetários são inteiros em centavos. Ausência/erro do provedor não pode apagar o último preço conhecido, e sair do backlog não apaga o histórico.

## Migrations

As migrations são versionadas em `server/db.ts` e executadas por `server/migrations.ts`.

- nunca altere uma migration já publicada; literais históricos permanecem congelados;
- acrescente a próxima versão em ordem crescente e nome estável;
- cada migration roda uma vez, em transação, e é registrada em `schema_migrations`;
- versão desconhecida ou nome divergente interrompe o startup;
- reconstrução de tabela referenciada declara `foreignKeys: 'off'`, roda `foreign_key_check` e restaura o pragma;
- valide dados existentes antes de adicionar constraints;
- se um banco existente precisa de upgrade, o startup cria snapshot verificado `before-migration`; falha no backup impede a migration.

O baseline v1 ainda contém compatibilidade aditiva para schemas legados. Não continue empilhando alterações informais dentro dele: mudanças novas recebem nova versão.

## Backup, exportação e importação

Snapshots integrais usam a Online Backup API do SQLite, são escritos em arquivo temporário, abertos com `PRAGMA quick_check` e só então publicados. Há snapshots automáticos, manuais, antes de migration e antes de importação, com retenção diária/semanal e cópias de segurança por tipo.

O export JSON v2 é portável e não inclui credenciais; cobre mídia, diário, séries, listas/tiers, atividade/música e preços. Snapshot restaura fielmente a instância; export serve para portabilidade e merge controlado.

Importações devem ser idempotentes, rejeitar versões futuras e criar snapshot preventivo antes de qualquer modo destrutivo ou substituição.
