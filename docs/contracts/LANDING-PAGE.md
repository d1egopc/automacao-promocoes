# Landing Page por workspace — V1 local

Tarefa: Landing Page V1. Área: backend/frontend, planos e página pública.
Risco: nível 3, isolamento multiworkspace e mídia. Reversibilidade: remover o delta de código; nenhum dado produtivo foi alterado.
Contratos: MULTITENANCY, LINKS-MEDIA, ACHADOS-VITRINE, PERFORMANCE, PRODUCTION-DEPLOYMENT.
Persistência: arquivos pequenos novos em `DATA_DIR/landing-pages`, sem banco/migração. Fonte comercial: Vitrine read-only.
Performance: JSON limitado a 64 KiB; upload até 5 MiB, transformação assíncrona Sharp, uma por workspace e até duas simultâneas no processo; excedente recebe 429 sem fila/retry. Vitrine até 2 MiB e quatro ofertas na resposta.
Superfícies: editor autenticado `/landing-page`, pública `/l/:publicId`, API pública `/public/landing/:publicId`.
Capacidade mínima: Sol Alto; escalar diante de alteração de contrato comercial, fila, schema ou isolamento.
Modo inicial: inspeção read-only. Rollback: delta local isolado; nenhuma publicação autorizada.
Permitidos: módulo landing-page, wiring, recurso de plano e UI. RIO, filas, ACK, créditos, sessões e outros módulos permanecem fora do escopo.
Decisão humana pendente: homologação visual e autorização futura de publicação.

## Estado e publicação

`landing_page` é false quando ausente. Admin Master configura o recurso pelo gerenciamento existente de planos. Menu e API privada exigem a permissão. A página pública também exige workspace ativo e plano com o recurso; uma perda de permissão retorna 404 sem expor configuração.

Cada workspace possui documento próprio com revisão, rascunho, snapshot publicado e lista de assets. A URL usa 128 bits aleatórios e não revela workspace. GET não cria arquivos. Salvar não publica. Publicar usa somente rascunho salvo; despublicar revoga a página e assets públicos. O rascunho posterior nunca substitui a versão pública antes de publicar.

Escritas assíncronas são serializadas por lock exclusivo, com revisão esperada e arquivo temporário + fsync + rename. Um lock deixado por interrupção bloqueia novas escritas; não é apagado por idade ou PID. Recuperação administrativa desse lock exigirá exclusividade comprovada. Não há merge silencioso de edições concorrentes.

Banner e logo aceitam JPEG/PNG/WebP decodificáveis. Sharp limita pixels, normaliza orientação e grava WebP sem metadados. São arquivos imutáveis por hash dentro do identificador público da página, fora dos diretórios atualmente percorridos pelo GC físico. Somente imagens registradas no workspace podem ser selecionadas. Assets de rascunho exigem autenticação; acesso público exige snapshot publicado que os referencie. V1 limita 32 assets/32 MiB por workspace e não executa limpeza automática.

## Quatro ofertas

Usa exclusivamente `clientes/<workspace>/vitrine.json`, projeção existente e limitada, sem queries em fila, RIO ou Histórico. Exige recurso Vitrine, configuração ativa e identidade do workspace no documento. Reutiliza retenção (72h), ordenação e sanitização existentes. Só expõe ofertas com link público Optimus já validado pela Vitrine, até quatro itens. Fonte ausente, inválida ou grande demais retorna lista vazia com status explícito. Landing Page sem Vitrine continua funcionando com o carrossel vazio; ampliar a origem comercial exige autorização e prova do contrato.

## Domínio próprio e Meta Pixel

O editor salva apenas hostname normalizado e ID numérico de Pixel. Código oficial colado pode fornecer um único `fbq('init', 'ID')`; o código é descartado. Nenhum JavaScript fornecido pelo cliente é executado ou persistido. V1 não carrega Pixel externo.

Domínio próprio permanece `not_verified`: uma etapa futura deverá criar desafio aleatório ligado a workspace/hostname, comprovar TXT DNS e titularidade, evitar domínio duplicado, verificar CNAME/A e emissão HTTPS antes de servir. DNS/HTTPS não são ativados pela V1. Tokens de verificação e segredos nunca devem integrar o DTO público.

Pixel permanece `not_activated`: ativação futura exige homologação, política de privacidade/consentimento aplicável e implementação fixa controlada pelo sistema, sem HTML livre.

## Utilização local

Backend base: `5a31e60524d9caac45883ca07511dcc208852f53`; frontend base: `ce05231617a3d34fa530aad7395241222cf019dc`.
Branches locais: `feature/landing-page-v1-20261024`. Não houve push ou publicação.
Testes usam diretório temporário próprio e dois workspaces; nunca `/data` produtivo.

Fixture visual: `node tests/helpers/landing-page-local-demo.cjs --local-only` escuta apenas `127.0.0.1:3031`; iniciar Vite no frontend com `VITE_API_URL=http://127.0.0.1:3031` e porta 5176. Login fictício: `demo-local@example.com` / `local-only`. Esses valores pertencem somente à fixture, não são credenciais de produção. Dados são descartáveis fora da árvore Git e não existe conexão PostgreSQL ou WhatsApp.

## Checkpoint local

Implementados editor, prévia desktop/celular, ordenação, uploads, draft/publish/unpublish, permissão de plano e leitura das quatro ofertas. Nenhum arquivo de RIO, Mensageiro, GC, banco ou sessão foi alterado.
Build Vite client/SSR/Nitro passou em Node 24.22.1. Testes focais cobrem isolamento, revisão, falha de escrita, publicação e mídia. Os testes legados de Vitrine/planos passaram após atualizar o catálogo esperado para incluir o Clonador já existente na base e a Landing Page autorizada.
Typecheck geral: 32 diagnósticos também reproduzidos na base exata `ce052316...`; sem diagnóstico adicional no candidato (a diferença textual remanescente é a ordem de membros de union no erro existente de Radar). O teste legado `ux-planos-v2-locks` falha na base e no candidato por depender de uma linha exata de código que a base já quebra em duas linhas; não foi alterado nesta missão.
Pendentes: homologação visual do proprietário, CI remoto autorizado e futura integração validada de domínio/Pixel. Sem push, merge, deploy ou alteração produtiva.

Validação final local em Node 24.22.1: API Landing 14/14 PASS; frontend Landing 4/4 PASS; catálogo Vitrine/planos PASS; Guardião V1 10/10 PASS, incluindo RIO, Radar, TeleRadar, Clonador, fila viva, Gerente, Comandos e Programadas. A primeira execução no sandbox sofreu restrições de temporários/loopback; a execução autorizada com temporários isolados passou integralmente, sem alteração das assertions. Relatório: `Documents/Codex/landing-v1-guardian-report.json`.

## Manifesto do delta local

Backend (seis arquivos):

- `index.js`: recurso de plano e montagem das rotas.
- `modules/landing-page/service.js`: validação, persistência e origem das ofertas.
- `modules/landing-page/routes.js`: API autenticada e acesso público.
- `tests/landing-page-v1.test.cjs`: testes focais.
- `tests/helpers/landing-page-local-demo.cjs`: fixture visual loopback, sem serviços produtivos.
- `docs/contracts/LANDING-PAGE.md`: este contrato e checkpoint.

Frontend (doze arquivos):

- `src/components/app-sidebar.tsx`, `src/lib/feature-access.ts`, `src/lib/planos-store.ts`, `src/routes/admin.tsx`: recurso, menu e planos.
- `src/routes/__root.tsx`, `src/routeTree.gen.ts`: duas rotas novas; as 33 definições anteriores foram comparadas e permanecem equivalentes. O gerador reordenou o arquivo.
- `src/lib/landing-page.ts`: tipos e helpers.
- `src/components/landing-page-view.tsx`: visualização compartilhada.
- `src/routes/landing-page.tsx`: editor.
- `src/routes/l.$pageId.tsx`: página pública.
- `tests/landing-page-v1.test.cjs`, `tests/vitrine-admin-planos.test.cjs`: testes.

Próxima ação: revisar a versão local e, mediante autorização futura, homologar os dois candidatos em CI isolado antes de qualquer publicação. As pastas oficiais e seus documentos pendentes foram preservados; o trabalho está somente nas duas worktrees locais.

## V1.1 — temas

O seletor Aparência → Temas oferece oito paletas predefinidas. Escolher uma troca o tema e a cor dos botões no rascunho em memória e atualiza a prévia; a persistência segue o mesmo Salvar/Publicar/Despublicar existente. A API aceita somente os oito IDs conhecidos. Documentos V1 sem `theme` são lidos como `optimus`; não há migração ou alteração global. O tema viaja no snapshot publicado do workspace. Testes verificam os oito IDs, escolha, salvamento, recarga, publicação, workspace independente e compatibilidade com documento V1 sem campo.

Validação V1.1 em Node 24.22.1: API Landing 16/16 e frontend Landing 5/5; catálogo Vitrine/planos 1/1. Os oito pares de cor de botão/texto passam contraste mínimo 4,5:1. O teste confirma atualização imediata da prévia a partir do rascunho e a grade de temas em 4 colunas no celular e 8 em telas maiores; o editor preserva a prévia móvel de 390 px. Build Vite client/SSR/Nitro passou após as alterações de tema.

## Homologação funcional isolada — autenticação e planos

Base funcional: backend `676e3a8615010128cee27c29f13558ee1602eddc`; frontend `e182d5e04549021ff9544f9d5bc76dad52ae2e57`. Esta etapa acrescenta somente testes, fixtures, preparação de CI e este checkpoint. Não altera arquivos funcionais.

A fixture executa trechos exatos de `index.js`: middleware JWT, autorização Admin Master, GET/POST de planos, resolução de recursos, GET /me e o wiring Landing. Usa os módulos reais de identidade, planos, serviço e rotas. Contadores de consumo e financeiro de /me recebem valores locais fixos; não se inicia index.js inteiro, schedulers, PostgreSQL ou WhatsApp. O JWT tem segredo aleatório exclusivo da fixture. Apenas usuários fictícios e diretórios temporários são utilizados.

A prova confirma habilitação pelo Admin e persistência do plano, bloqueio de cliente na administração, tokens inválidos/expirados, usuário inativo, 403 em todas as operações privadas sem recurso, dois tenants independentes, DTO público anônimo, quatro ofertas de cada fonte autorizada, rascunho versus snapshot, temas e revogação imediata do plano. Domínio continua `not_verified`, Pixel `not_activated` e só o ID é retido; não há execução de código colado.

As respostas sanitizadas de /me da fixture alimentam o teste do AppSidebar real no frontend. Somente contextos React, roteador e componentes visuais de contorno são substituídos; a decisão de cadeado, o link, a guarda da rota e os serializadores do Admin são os existentes. O JSON de fixture versionado não contém tokens nem dados de clientes.

Typecheck comparado usando a mesma versão instalada do TypeScript e uma árvore extraída por Git do SHA frontend exato `ce05231617a3d34fa530aad7395241222cf019dc`: 32 diagnósticos na base, 32 no candidato, zero novos e zero resolvidos. A comparação mantém arquivo, código, categoria, mensagem e multiplicidade; ignora posição deslocada e ordenação equivalente de unions literais. Novos erros, duplicatas e literais diferentes reprovam em testes negativos.

Execução local Node 24.22.1 desta etapa: backend 25/25 (16 focais e 9 da integração), além de identidade de planos e fundação SaaS aprovadas; frontend 15/15, incluindo renderização do menu com as respostas /me, serializador Admin, comparação de diagnósticos e Vitrine. O build V1.1 já aprovado é reutilizado porque nenhum arquivo funcional mudou.

CI preparado, ainda não executado remotamente:

- Backend: reutiliza `.github/workflows/guardian-v1-ci.yml` para `feature/landing-page-v1-*`; acrescenta a integração, planos e fundação SaaS, preservando Guardião e regressões existentes. Base Landing fixa `5a31e605...`.
- Frontend: `.github/workflows/landing-page-ci.yml`, único job `validate`, testes Landing/menu/planos/Vitrine, comparação estrita do typecheck e build completo. Base fixa `ce052316...`.
- Ambos: Linux hospedado, Node 24, token contents:read, checkout sem credencial persistente, nenhum job de deploy, nenhum segredo produtivo. Nenhum push ou dispatch foi executado. Um futuro push frontend pode gerar Preview pela integração Vercel; isso exige autorização específica junto ao push.

Próxima ação: autorizar os pushes isolados e a execução dos dois CIs após revisar os commits locais de validação. Publicação continua pendente de gate próprio.

Validação V1.1 em Node 24.22.1: API Landing 16/16 e frontend Landing 5/5; catálogo Vitrine/planos 1/1. Os oito pares de cor de botão/texto passam contraste mínimo 4,5:1. O teste confirma atualização imediata da prévia a partir do rascunho e a grade de temas em 4 colunas no celular e 8 em telas maiores; o editor preserva a prévia móvel de 390 px. Build Vite final registrada após as alterações desta versão.
