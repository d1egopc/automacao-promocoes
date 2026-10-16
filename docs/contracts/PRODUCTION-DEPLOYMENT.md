# Production Deployment

## Backend

O unico alvo oficial e a Hostinger VPS:

- backend: `/opt/optimus/backend`
- Compose: `/opt/optimus/infra/compose.yml`
- servico: `backend`
- dados: `/opt/optimus/data` montado em `/data`
- API: `https://go.optimuspromo.com.br`

Este contrato substitui, para topologia de dominios, a descricao legada de `docs/PRODUCTION.md` que chama `www` de endpoint publico canonico. A funcao comprovada e: `www` serve o frontend na Vercel; `go` serve a API/backend na Hostinger.

O workflow `.github/workflows/deploy-backend-vps.yml` roda em push para `main`. O gate usa Node 24, `npm ci`, `node --check index.js`, `npm run audit:encoding` e os testes criticos declarados no workflow. O deploy usa `git pull --ff-only`, build do backend e `docker compose up -d backend`.

Nunca:

- use `docker compose down`;
- remova volumes;
- recrie PostgreSQL sem plano e autorizacao;
- altere env/flags junto de deploy sem escopo explicito;
- limpe ou substitua `/data`;
- use Railway como baseline.

## Canais de consulta operacional

- Codigo e CI: consulte o repositorio oficial e os runs do GitHub Actions. O workflow de deploy acima e o mecanismo de publicacao, nao uma autorizacao para diagnosticos ou mudancas ad hoc.
- VPS Hostinger: use SSH somente quando a identidade do host e a autenticacao desta sessao estiverem comprovadas. Como alternativa, um workflow READ-ONLY explicitamente autorizado pode consultar o runner self-hosted `[self-hosted, Linux, X64]`. A existencia do runner nao prova acesso SSH local nem autoriza criar/executar workflow sem escopo aprovado.
- No host autorizado, localize o checkout `/opt/optimus/backend`, Compose `/opt/optimus/infra/compose.yml` e bind `/opt/optimus/data -> /data`. Para infraestrutura, consulte metadados de container, imagem, mounts, health, restart/OOM e logs sanitizados com janela e cobertura verificadas; configuracoes de modulo seguem seu contrato proprio. Nao imprima `docker compose config` completo, `.env`, auth ou dados privados.
- Banco: identifique o esquema antes de consultar. Use transacao READ ONLY, `statement_timeout`, filtros indexados e limites; nunca interprete ausencia de log sem confirmar cobertura.
- API publica: `https://go.optimuspromo.com.br`; frontend: painel Vercel do projeto `optimus-promo/optimuspromo` e dominio `https://www.optimuspromo.com.br`. Confirme deployment Production e source SHA no painel; nao infira Production pela branch local ou por um Preview READY.

## Baseline obrigatoria

Antes de mudar producao, registre SHA/tree, status Git, container/image IDs, restart/OOM, Postgres health, mounts, hashes de Compose/env, flags relevantes, HTTP local/publico e CPU/RSS. Nao exponha valores secretos; registre apenas hashes e flags nao sensiveis.

## Deploy controlado

1. Prove que o candidato parte do SHA ativo ou preserva integralmente sua ancestry.
2. Prove diff, testes, status limpo e rollback.
3. Atualize somente a branch/SHA autorizada.
4. Acompanhe o workflow ate conclusao real.
5. Confirme o SHA efetivamente implantado e repita a baseline.
6. Preserve evidencias antes de rollback.

Rollback nao e `reset --hard` improvisado. Antes do deploy, comprove que a imagem anterior ainda existe pelo ID/digest exato, que uma tag protegida aponta para esse mesmo ID e que o Compose pode selecionar essa imagem sem recriar PostgreSQL ou tocar `/data`. Se esse caminho nao estiver disponivel, prove uma reconstrucao controlada de SHA anterior antes de chamar o rollback de operacional. Registre a imagem e o SHA efetivamente ativos depois de qualquer reversao.

## Frontend

- Runtime homologado: `nodejs22.x` via Nitro em `vite.config.ts`.
- Nao use bypass de advisory TanStack/Vercel.
- Build local e testes precedem push.
- Gere Preview do SHA candidato.
- Preview precisa estar `READY`.
- Mudanca visual exige gate humano.
- Promova exatamente o mesmo Preview/SHA para Production.
- Prove source SHA, HTTP 200 e bundle novo.

`Deployment failed` significa que Production nao foi atualizada; nao atribua a cache sem prova de deployment `READY`.

## Extensao

Empacote a partir de uma tree Git comprovada, com `manifest.json` na raiz. Exclua `.git`, testes, logs, backups, credenciais e temporarios. Registre versao, commit/tree, SHA-256, tamanho e quantidade de arquivos. Publicacao/instalacao exige gate humano.

## Evidencia temporal

Mantenha IDs e hashes atuais em [EVIDENCE-REGISTER.md](EVIDENCE-REGISTER.md), nao neste contrato.

## Backup manual de codigo

Registre caminho, branch, HEAD, estado Git e referencias separadas de frontend e extensao. Um commit WIP local preserva trabalho, mas nao transforma a branch experimental em codigo aprovado para producao. Nao use copia espelhada nem substitua a pasta oficial por uma worktree antiga.

Nao envie sem protecao adequada `.env`, chaves, tokens, cookies, sessoes WhatsApp, dados pessoais, dumps de producao ou arquivos temporarios. `node_modules` e artefato reinstalavel, nao parte do backup de fonte. O backup do codigo nao substitui plano de backup de `/data` ou PostgreSQL.
