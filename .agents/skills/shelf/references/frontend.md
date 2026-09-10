# Frontend

Leia esta referência ao mudar páginas, componentes, rotas, cache, responsividade ou aparência.

## Estrutura e carregamento

React 18, React Router e TanStack Query. Não há store global: dados remotos vivem no cache de queries; estado efêmero de interface permanece local ao componente.

Todas as páginas são lazy-loaded em `src/App.tsx`. O `Layout` fica no bundle inicial e envolve o `Outlet` em `Suspense`, mantendo navbar e player visíveis durante a troca. Ao criar página:

1. exporte o componente nomeado;
2. adicione um `lazy(() => import(...).then(...))` em `App.tsx`;
3. registre a rota filha do `Layout`;
4. atualize navegação/categorias somente se precisar de entrada permanente;
5. rode o build e confira se não voltou o alerta de chunk acima de 500 KB.

Após o code splitting, o JS inicial de referência ficou em aproximadamente 261 KB (81,5 KB gzip), contra cerca de 515 KB antes. Não aumente o limite do warning para esconder regressão.

## Rotas

| Caminho | Responsabilidade |
|---|---|
| `/` | Dashboard: visão geral, favoritos, progresso, promoções e fila de avaliações |
| `/library` e `/library/*` | biblioteca geral e por categoria |
| `/diary` | histórico de conclusões |
| `/wishlist` | backlog |
| `/media/:id` | detalhe, status, nota, histórico e metadados |
| `/lists`, `/lists/:id` | listas, ranking e tierlist |
| `/wrap` | estatísticas mensal/anual e story |
| `/settings` | preferências do app |
| `/integrations` | chaves e serviços conectados |
| `/import-export` | snapshots, export e importadores |

## Cliente HTTP e cache

`src/lib/api.ts` é a única camada de chamadas da UI. Toda nova rota deve ganhar método tipado ali; shapes ficam em `src/types/index.ts`.

Escolha query keys estáveis e invalide todas as visões afetadas por uma mutation. Mudanças em mídia/diário podem impactar detalhe, coleção, diário, recentes/upcoming e Wrap. Quando atualizar cache diretamente, preserve propriedades derivadas que a resposta não contém, por exemplo `{ ...itemAtual, ...itemAtualizado }` para não perder `progress`.

`api.media.listAll()` pagina até o fim. Use-o apenas quando a tela realmente precisa da coleção completa para ordenar/agregar; listagens simples devem continuar paginadas ou limitadas no servidor.

## Avaliações e conclusão

- Conclusão manual abre `DiaryEntryModal`, que coleta data, nota e comentário.
- Conclusões automáticas sem nota aparecem na fila do Dashboard.
- `PATCH /api/media/:id/quick-rating` mantém mídia e diário coerentes.
- `StarRating` suporta meio ponto com mouse/caneta e estrela inteira por toque. Preserve rótulos acessíveis.

Não crie mutation de avaliação rápida que atualize apenas `media_items.rating`.

## CSS e tema

O projeto combina `src/index.css`, CSS local em template literal dentro de páginas grandes e Tailwind com cores mapeadas para CSS variables. Siga o padrão vizinho. Prefira tokens (`--bg`, `--surface`, `--card`, `--text-*`, `--accent`, `--gold` e cores das categorias) e `color-mix`.

O `<style>` local é renderizado no body depois do CSS global. Com a mesma especificidade, a regra local vence. Antes de aumentar especificidade ou usar `!important`, confira a cascata.

Tipografia usa Space Grotesk e base de 16 px. Preserve legibilidade, contraste nos dois temas e numerais tabulares onde houver métricas.

## Responsividade e acessibilidade

Tokens como `--page-x`, `--nav-h`, `--bottomnav-h` e grades controlam a adaptação. Breakpoints globais principais: 1024, 760 e 420 px; componentes complexos podem ter breakpoint local.

- use `button` para ação e link para navegação;
- dê nome acessível a controles apenas visuais;
- preserve foco por teclado, Escape em modais e `prefers-reduced-motion`;
- ofereça estados de carregamento, vazio e erro;
- evite rolagem horizontal no telefone;
- imagens fora da primeira dobra usam `loading="lazy"`.

## Wrap e imagens

`src/lib/story.ts` desenha canvas 1080×1920. Capas usadas no canvas passam por `/api/img`; URL externa direta pode contaminar o canvas por CORS. O proxy só aceita hosts HTTPS permitidos e revalida redirects para impedir SSRF.
