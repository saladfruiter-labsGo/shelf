# Qualidade e fluxo de trabalho

Leia esta referência antes de implementar uma mudança, preparar PR, mexer em segurança/dados ou interpretar falhas de teste.

## Ciclo de uma entrega

1. Parta do `main` limpo e sincronizado com `origin/main`.
2. Crie branch dedicada com nome descritivo (`feat/`, `fix/`, `refactor/`, `perf/`, `docs/`).
3. Faça a menor alteração coesa que resolve o comportamento, incluindo testes e documentação afetada.
4. Revise `git diff` e rode `git diff --check`.
5. Rode typecheck, testes e build.
6. Crie commit convencional e PR explicando decisão, risco de dados e validação.
7. Aguarde o CI. Só mescle quando o usuário autorizou e o check está verde.
8. Depois do merge, volte ao `main`, execute `git pull --ff-only` e confirme a árvore limpa antes da próxima PR.

Não crie PR empilhada sobre branch ainda não mesclada. Não force-push nem reescreva histórico compartilhado sem pedido explícito.

## Validação

```bash
npm run typecheck
npm test
npm run build
```

O CI (`.github/workflows/ci.yml`) usa Node 22, instala com `npm ci` e roda os três. Um push em `main` também publica a imagem no GHCR; portanto merge é mudança de distribuição, não apenas organização do Git.

No Windows/Node 24, o teardown do `better-sqlite3` 11 pode abortar com `RemoveEnvironmentCleanupHook` depois de testes válidos. `scripts/test.mjs` isola arquivos e repete somente essa assinatura. Não use isso para ignorar `not ok`, erros TypeScript ou falhas de asserção.

## Estratégia de testes

- Extraia lógica determinística para módulos de domínio e teste sem rede.
- Rotas e integrações recebem fixtures realistas, `fetch` substituído e banco temporário via `DATA_DIR`.
- Restaure globals alterados em `finally`.
- Para webhooks/polls, execute o mesmo payload duas vezes e teste contagens, não apenas status HTTP.
- Para migrations, comece por schema legado com dados, confirme snapshot, preservação, versão e constraints.
- Para dados históricos, teste explicitamente o que não pode ser apagado.
- Para preço/dinheiro, use inteiros em centavos e cubra falha/429/timeout.

O objetivo não é cobertura numérica: teste invariantes que já causaram regressão ou cujo erro destruiria confiança nos dados.

## Proteção de dados

Antes de alterar persistência, responda:

- a operação é aditiva, substitutiva ou destrutiva?
- retries duplicam alguma coisa?
- um provedor indisponível pode apagar estado válido?
- a migration funciona num banco antigo e parcialmente populado?
- snapshot/export continuam incluindo o novo dado?
- importação roundtrip restaura o comportamento, não só a coluna?

Não confunda payload bruto com histórico. `activity_events.raw` é diagnóstico temporário; a linha normalizada e os registros derivados são permanentes.

## Segurança compatível com o deployment

O modelo atual é instância única privada por LAN/Tailscale, sem login. Preserve:

- API de navegador same-origin, sem CORS aberto;
- webhooks sem `Origin` autenticados por secret próprio;
- limites de corpo, headers defensivos e `Cache-Control: no-store` na API dinâmica;
- segredos mascarados na resposta e ausentes de exports portáveis;
- proxy de imagens com HTTPS allowlist, revalidação de redirects e limite de corpo;
- processo Docker sem root, healthcheck e shutdown gracioso.

Não introduza autenticação improvisada em uma rota isolada. Multiusuário exigirá modelo completo de identidade, autorização e ownership; está deliberadamente adiado.

## Backend e jobs

- Rotas Hono validam entrada, delegam regra de domínio e devolvem erro acionável.
- SQL sensível a consistência usa transação.
- Jobs têm start/stop explícitos, guarda contra sobreposição e são aguardados no shutdown.
- Efeitos externos não críticos, como notificação, não devem bloquear a persistência principal.
- Toda chamada externa tem comportamento conservador diante de resposta vazia ou erro.

Ao dividir arquivos grandes, mantenha o contrato público da rota e mova lógica pura primeiro. Evite import side effects.

## Frontend

- Use `src/lib/api.ts` e TanStack Query; não faça `fetch` disperso em componentes.
- Invalide ou atualize todos os caches derivados afetados.
- Preserve lazy-loading por rota e meça o build.
- Siga tokens/tema e o padrão visual local.
- Verifique desktop e mobile conceitualmente; quando possível, inspecione a tela renderizada.
- Ações importantes precisam de feedback de carregamento/erro e nome acessível.

## Checklist de revisão da PR

- comportamento pedido está completo, inclusive caminho automático e manual;
- não existe regra duplicada em páginas/integrações;
- dados históricos e segredos continuam protegidos;
- retries e jobs são idempotentes/drenáveis;
- tipos e cliente API refletem o contrato;
- testes cobrem sucesso e falha relevante;
- build não apresenta alerta novo;
- README, `.env.example` e esta skill foram atualizados se o comportamento operacional mudou;
- diff não contém arquivos gerados, banco local, credenciais ou mudanças alheias.
