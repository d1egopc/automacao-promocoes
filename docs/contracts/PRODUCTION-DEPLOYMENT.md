# Production Deployment

## Backend

O unico alvo oficial e a Hostinger VPS:

- backend: `/opt/optimus/backend`
- Compose: `/opt/optimus/infra/compose.yml`
- servico: `backend`
- dados: `/opt/optimus/data` montado em `/data`
- API: `https://go.optimuspromo.com.br`

Este contrato substitui, para topologia de dominios, a descricao legada de `docs/PRODUCTION.md` que chama `www` de endpoint publico canonico. A funcao comprovada e: `www` serve o frontend na Vercel; `go` serve a API/backend na Hostinger.

O workflow `.github/workflows/deploy-backend-vps.yml` executa **somente CI** em push para `main`: Node 24, `npm ci`, `node --check index.js`, `npm run audit:encoding` e os testes criticos declarados. Push/fast-forward na `main` **nao publica**. O job de publicacao e condicionado a `workflow_dispatch` explicito na `main`, apos CI verde, com quatro entradas obrigatorias: `source_sha` (40 caracteres), `base_sha` (40 caracteres), `base_image` (ID completo `sha256:` da imagem ativa) e `runtime_files` (caminhos alterados de runtime autorizados, separados por virgula).

### Publicacao manual por imagem versionada

1. Confirme imagem realmente ativa, SHA-base que ela representa, ancestry do SHA autorizado, saude, dados/mounts, Compose efetivo e rollback. Nao equipare Git `main` a imagem produtiva sem prova.
2. Antes do fast-forward, confira que o commit de destino **ja contem este workflow corrigido**. O GitHub Actions usa o arquivo de workflow do SHA associado ao evento de push; portanto esse push executara a versao CI-only, nao a versao antiga. Acompanhe o CI do push; nao acione publicacao automaticamente.
3. Acione manualmente **Deploy Backend VPS** na `main`, fornecendo os quatro valores acima. Para o candidato Mensageiro de 2026-10-23, o exemplo de `runtime_files` e `index.js,modules/mensageiro-v3/legacy-compat.js,modules/mensageiro-v3/operational-gates.js`; releia o diff antes de reutilizar.
4. O runner verifica que o SHA esta na ancestry da `main`, que o diff runtime corresponde exatamente a lista autorizada e que cada arquivo-base na imagem ativa tem o mesmo SHA-256 da versao `base_sha`. Qualquer divergencia aborta antes da troca.
5. O build parte da **imagem ativa verificada** e copia somente os arquivos runtime autorizados do checkout limpo do `source_sha` no runner. Preserva os demais arquivos comerciais da imagem, sem usar nem modificar o checkout destacado/sujo `/opt/optimus/backend`. A imagem nova recebe tag versionada por SHA e run ID, e o IMAGE ID e registrado.
6. O Compose-base `/opt/optimus/infra/compose.yml` permanece intacto. O workflow compara o Compose efetivo completo antes/depois, permitindo apenas `services.backend.image`, e salva a selecao em `/opt/optimus/infra/backend-release.yml`. Env, secrets, `/data`, portas, redes, ulimit, PostgreSQL e demais servicos devem ser identicos. A recriacao usa `docker compose -f compose.yml -f backend-release.yml up -d --no-deps --no-build --force-recreate backend`.
7. Antes da troca, uma tag de recovery referencia o mesmo ID da imagem ativa. Em falha de publicacao/health, o workflow restaura o overlay anterior (ou remove somente o overlay novo) e recria **apenas backend** na imagem anterior. Confirme IMAGE ID, HTTP e PostgreSQL depois; se a recuperacao falhar, trate como incidente e nao repita cegamente.
8. Depois do deploy, prove IMAGE ID ativo, HTTP local/publico, PostgreSQL no mesmo container, sessao/mount `/data`, RIO e contratos afetados. Nao remova imagens de recovery. Para operacoes manuais futuras de Compose, inclua sempre `backend-release.yml` quando ele existir, evitando reverter acidentalmente a imagem.

O checkout `/opt/optimus/backend` e referencia historica e pode estar em HEAD destacado com modificacoes locais; `git pull` ou build dele sao proibidos nesse caminho. O overlay de imagem nao autoriza mudar `/data`, PostgreSQL, flags ou estado do Mensageiro.

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

### Exceção fechada: hotfix Baileys ServCel 6.7.22

- Somente o perfil hash-pinned `baileys_buffer_patch` do Guardião autoriza uma etapa adicional no build derivado da imagem ativa. Base obrigatória f50e8a29 e ancestralidade do hotfix83b9f556; três arquivos runtime exatos, sem modificações funcionais posteriores. Dockerfile, postinstall, package.json, lock e dockerignore devem continuar nos hashes integrais da base.
- O Dockerfile gerado pelo Guardião faz somente FROM da imagem ativa verificada, COPY dos três arquivos autorizados, um RUN node fixo do instalador revisado e USER node. Não executa npm/postinstall, rede, comandos de usuário ou leitura de secrets; não monta /data. A versão6.7.22 e os três hashes de dependência antes/depois são exigidos. Qualquer divergência interrompe antes da troca.
- O script/workflow oficial mantém a mesma allowlist, imagem-base, ancestralidade, hashes de runtime, Compose efetivo, env/mounts, PostgreSQL, readiness e rollback. Não é autorização para qualquer script sob scripts/, Dockerfile alterado, instalação genérica ou atualização Baileys. Push main continua CI-only; deploy somente workflow_dispatch e aprovação explícita.
- CI usa base fictícia limpa construída do mesmo SHA, duas construções sem cache/rede do Dockerfile gerado e verifica os mesmos hashes de código nas imagens. Isso prova reprodutibilidade do conteúdo autorizado, não igualdade de metadados/IMAGE IDs entre builds. Não usa imagem, dados ou volumes da VPS. A publicação futura requer reconfirmar a base real e rollback.

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
