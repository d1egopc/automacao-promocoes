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

## Baseline obrigatoria

Antes de mudar producao, registre SHA/tree, status Git, container/image IDs, restart/OOM, Postgres health, mounts, hashes de Compose/env, flags relevantes, HTTP local/publico e CPU/RSS. Nao exponha valores secretos; registre apenas hashes e flags nao sensiveis.

## Deploy controlado

1. Prove que o candidato parte do SHA ativo ou preserva integralmente sua ancestry.
2. Prove diff, testes, status limpo e rollback.
3. Atualize somente a branch/SHA autorizada.
4. Acompanhe o workflow ate conclusao real.
5. Confirme o SHA efetivamente implantado e repita a baseline.
6. Preserve evidencias antes de rollback.

Rollback nao e `reset --hard` improvisado. Reimplante um SHA previamente comprovado pelo mesmo caminho controlado.

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
