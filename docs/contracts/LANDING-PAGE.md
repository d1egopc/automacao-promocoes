# Landing Page por workspace — V1.3 candidata

## V1.3 — mídia pública e miniaturas opcionais dos botões

A rota pública de assets, após validar plano, publicação, registro no workspace e referência no snapshot, responde `Cross-Origin-Resource-Policy: cross-origin`: o frontend oficial e a API possuem origens diferentes. A política privada e os gates de acesso permanecem intactos. Banner/logo existentes não precisam de migração ou reupload.

Cada botão aceita `avatar` opcional com nome WebP por hash registrado no próprio workspace. `POST /landing-page/assets/button` reutiliza autenticação, plano, revisão esperada, tipos JPEG/PNG/WebP, limite de 5 MiB/16 milhões de pixels, backpressure, quotas e persistência atômica existentes. Normaliza até 512 × 512 sem metadados e devolve `uploadedAsset`; o upload só registra a mídia, sem selecionar ou publicar botão. Salvar associa pelo ID estável; Publicar inclui no snapshot. Remover a miniatura não apaga arquivos, e despublicar ou perder o plano revoga o acesso público. Nenhuma foto privada é consultada.

Ícones são vetores locais; identificação por hostname conhecido não segue redirects, não altera URLs e mantém o ícone explícito para links desconhecidos. A prévia busca somente mídias autorizadas, com duas requisições simultâneas, cache por nome e revogação dos Blob URLs ao remover/desmontar. Os oito temas, consentimento/Pixel, domínio, slug, Vitrine e contratos comerciais são preservados.

A candidata parte das versões publicadas backend `eda20ff6b69449c69a00ac7777beb3b868e1da80` e frontend `21b39c8abceb66c9af647b9b90bd5aae34e93bb7`. O teste de preservação V1.3 compara toda a árvore frontend contra esta publicação e permite somente os quatro arquivos Landing autorizados; o teste histórico da reconciliação V1.2 permanece inalterado e não representa equivalência de novas funcionalidades com o antigo candidato V1.2.

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

## V1.2 — Meta Pixel, slug e domínio self-service

O editor retém somente o ID numérico do Pixel, inclusive quando recebe HTML oficial contendo um único `fbq('init', 'ID')`. HTML/JavaScript não são persistidos nem executados. `metaPixelEnabled` ausente é false. Salvar altera só o rascunho; a publicação inclui ou remove o Pixel no snapshot. O componente público carrega exclusivamente o script oficial fixo após consentimento explícito, respeita GPC/DNT, desliga configuração automática e usa `trackSingle` para o ID daquele workspace. PageView é deduplicado por página/Pixel/publicação/caminho no documento, com memória limitada e sem retry após efeito incerto. Editor e Preview visual não carregam o Pixel. O teste na página publicada orienta a conferir PageView em Testar eventos da Meta/Pixel Helper; `queued` nunca é apresentado como evento recebido pela Meta. Não há CAPI, login Meta ou HTML livre.

O slug aceita 3–50 caracteres ASCII minúsculos, números e hífen, com nomes reservados bloqueados. A disponibilidade é consultiva; a reserva única é feita sob fence interprocesso na publicação. A reserva sobrevive à despublicação. Um novo rascunho não troca o link ativo; publicar o novo endereço libera o anterior somente após commit durável. O token público original permanece utilizável. Índices pequenos de endereço apontam para a mesma autoridade de página, não constituem outra Landing Page.

Um domínio conectado recebe vínculo exclusivo workspace/publicId/bindingId e TXT aleatório `_optimus-verify.<hostname>`. A associação usa a API oficial Vercel, sem force, compra, transferência ou mudança de DNS. Domínios já presentes no projeto sem vínculo desta integração e domínios Optimus/Vercel são rejeitados. Os registros CNAME/A e desafios Vercel são os retornados para o domínio; não há destino DNS universal hardcoded. A ativação exige simultaneamente TXT do workspace, verificação Vercel, DNS configurado e TLS público com cadeia/certificado/SNI válidos. O probe fixa IP público validado, não faz requisição HTTP arbitrária e possui timeout. Ausência de prova, credencial, DNS, HTTPS ou plano fecha a rota de domínio; token/slug padrão continuam disponíveis conforme publicação/plano.

O frontend TanStack usa `createIsomorphicFn` e a URL efetiva do Request/window, sem aceitar headers forwarded como identidade de tenant. Hosts oficiais mantêm a aplicação existente/SSR; o host do cliente renderiza somente a raiz da página pública dele e não monta autenticação/painel. A API resolve o hostname exclusivamente pelo vínculo confirmado e não usa Host para selecionar workspace. Não há redirecionamento aberto.

Estado do domínio fica em registro pequeno separado da revisão editorial. Um verificador assíncrono opt-in varre no máximo 32 registros e verifica até dois por tick de 5 s; cada domínio possui cadência mínima de 60 s e prova válida por até 10 min. DNS, TLS e Vercel têm deadlines; não existe I/O síncrono novo no hot path. Alterações de diagnóstico/domínio não avançam a revisão do rascunho. O editor acompanha estados pendentes a cada 30 s, uma consulta por vez e por até 15 min, encerrando no unmount. Falhas externas invalidam prontidão e não mudam decisões de envio/comerciais.

A desconexão revoga primeiro a rota do domínio, remove apenas a associação confirmada desta integração e preserva página, rascunho, slug, mídias e snapshot. Associação com resultado incerto é reconciliada por GET/TXT; não se repete POST cegamente. Locks interrompidos falham fechados; nunca são removidos por idade/PID. Sua recuperação operacional exige exclusividade comprovada, preservando o contrato de persistência existente.

### Credencial única da plataforma — configuração futura, uma vez

- `LANDING_VERCEL_TOKEN`: segredo exclusivo do backend Optimus; nunca usar prefixo `VITE_`, retornar por API, imprimir, colocar no Git ou copiar do login/arquivo do CLI. Nenhum cliente fornece token.
- `LANDING_VERCEL_PROJECT_ID=prj_oi7F49tqPLMb4eTs9TyISoaWWhu3` e `LANDING_VERCEL_TEAM_ID=team_y4OAUleUSAKmAL73mL33aG7k` identificam o alvo aprovado; `LANDING_DOMAINS_ENABLED=true` habilita o serviço somente depois da configuração autorizada.
- O proprietário provisiona credencial dedicada pelo mecanismo oficial da Vercel e a instala no armazenamento/env protegido do backend durante uma janela autorizada. Uma integração OAuth oficial deve solicitar somente `project` e `domain` Read/Write e ser instalada para o projeto Optimus. Tokens pessoais herdam permissões do titular/time; não presumir escopo por projeto quando não oferecido pelo plano. Usar o menor acesso disponível e expiração/rotação. Referências: [escopos oficiais](https://vercel.com/docs/integrations/create-integration/vercel-api-integrations), [tokens](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token).
- Antes de adicionar/remover, o provider lê o projeto e exige ID, time, repositório `d1egopc/optimuspromo-frontend` e Production Branch `main`; rejeita domínio com redirect, outro branch/ambiente/projeto. Isso restringe o código, não reduz o alcance administrativo intrínseco de uma credencial roubada.
- Conferir por GET autenticado os acessos de projeto, domínio e configuração DNS. Homologar permissões de escrita em domínio descartável autorizado antes de liberar clientes. Certificado é emitido pela Vercel; o Optimus observa HTTPS sem comprar certificado ou alterar DNS externo.
- Não instalar a credencial nem mudar VPS/Compose nesta missão. A instalação futura é um gate operacional separado e explícito: não relaxar a comparação de env/Compose do deploy para introduzir segredo silenciosamente. Falta de configuração retorna 503 nas operações de domínio, sem afetar a URL padrão.

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

## Gerenciamento de Planos — prova focal local (2026-10-25)

A integração já estava presente nas candidatas backend `eb360900...` e frontend `46b4d0c...` (que preserva a versão funcional `e8766ba...` e o demo posterior). O `PlanoEditor` real lista `landing_page` em Recursos depois de Social/Vitrine, usa o mesmo Switch e o serializador/POST `/admin/planos` existentes. A única mudança funcional desta etapa é a descrição solicitada para Landing Page; regras de permissão e persistência foram preservadas.

Os testes agora exercitam os callbacks do componente real: abrir, habilitar, salvar, reabrir, desabilitar e reabrir. O teste de API lê novamente `/admin/planos` e o arquivo temporário persistido após ON/OFF; compara os demais recursos, limites e o plano não editado. Plano legado sem `landing_page` continua bloqueado. DTOs `/me` gerados pela fixture backend alimentam o menu real frontend: tenant autorizado recebe link; bloqueado/legado recebe cadeado; API privada retorna 403. Dois workspaces permanecem isolados.

Resultado local Node 24.22.1: backend 26/26, frontend 16/16, regressões Vitrine/planos 4/4, build normal PASS e typecheck com os mesmos 32 diagnósticos da baseline `ce052316...`, zero novos. A primeira tentativa HTTP foi bloqueada por EACCES de loopback no sandbox; a execução autorizada com a mesma fixture passou. O Preview visual continua sem API/login e não serve para testar o Admin Master. Alterações permanecem locais nas worktrees existentes, sem commit, push ou deploy nesta etapa; próximo gate é CI autorizado do delta final.

## Checkpoint V1.2 — homologação local (2026-10-25)

Candidatas continuam nas worktrees vinculadas `Documents/Codex/landing-v1-backend` e `landing-v1-frontend`, branch `feature/landing-page-v1-20261024`. Os documentos e alterações das pastas oficiais foram preservados. Bases anteriores: backend `eb360900197718e1af9d515fdc0905a342770d48`, frontend `46b4d0cee036fe92d189094faa6bfb6c1dcd8c74` (preserva o funcional `e8766ba...` e o Preview demo sem API). Não equiparar a branch candidata ao código produtivo.

Node 24.22.1: backend focal e integração 35/35 PASS; frontend focal, planos, demo e comparação de diagnósticos 22/22 PASS. Typecheck: baseline frontend exata `ce05231617a3d34fa530aad7395241222cf019dc` 32, candidata 32, zero novos. Build normal e build Preview demo PASS; output Vercel `nodejs22.x`. Testes exercitam extração de Pixel, consentimento/deduplicação, isolamento, slugs, domínio com DNS/TLS pendentes, projeto incorreto, Host forjado, falhas de associação/desconexão e retomada limitada. Fixture usa respostas oficiais sanitizadas; nenhum domínio real foi adicionado/removido, nenhum Pixel real disparado e nenhuma credencial instalada.

O roteamento por domínio usa a URL efetiva do adaptador TanStack, não headers encaminhados como autoridade. O backend exige binding/propriedade/DNS/TLS atuais; o frontend mantém SSR do painel oficial e não monta autenticação em hosts de clientes. A implementação demo continua sem API e sem Pixel real.

Guardião e CI remoto da V1.2 ainda pendentes neste checkpoint. Os workflows existentes foram estendidos somente para os testes V1.2 e continuam CI-only. Push isolado está autorizado, main/deploy produtivo não. A conexão GitHub desta sessão ainda retorna 404 ao repositório frontend privado mesmo após a autorização informada pelo proprietário; leitura de commits/workflows/Actions não está comprovada. Não declarar CI verde por testes locais.

Próxima ação: commit seletivo dos deltas, Guardião no SHA exato e pushes somente da branch existente se os gates passarem; acompanhar ambos os CIs e emitir GO/NO-GO. A instalação protegida da credencial Vercel e qualquer promoção/publicação produtiva exigem o OK final. Recebimento real de PageView pela Meta e escrita em domínio descartável autorizado são gates externos separados, não comprovados pelas fixtures.
