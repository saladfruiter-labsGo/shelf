# Instruções para trabalhar no Shelf

Antes de planejar ou alterar o Shelf, leia integralmente `.agents/skills/shelf/SKILL.md` e as referências que ele indicar para a área afetada. Essa skill é a memória operacional do projeto e deve ser atualizada quando uma mudança alterar arquitetura, regras de domínio ou práticas de manutenção.

- Sincronize `main` com `https://github.com/saladfruiter-labsGo/shelf` antes de começar.
- Preserve alterações locais que não pertencem à tarefa.
- Faça cada entrega coesa em branch própria, com commit e pull request explicativa.
- Rode `npm run typecheck`, `npm test` e `npm run build` antes da PR.
- Não mescle uma PR sem autorização do usuário e CI verde.
- Proteja dados históricos: diário, eventos normalizados, música e preços são duráveis. A retenção atual limpa somente `activity_events.raw`.
- Mantenha integrações idempotentes e use timestamps/identidades estáveis fornecidos pelo provedor.
- O deployment atual é uma única instância privada, acessada por LAN/Tailscale, sem autenticação. Não introduza arquitetura multiusuário ou exposição pública sem uma decisão explícita do usuário.
