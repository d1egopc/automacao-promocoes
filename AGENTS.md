# Optimus Promo - Maintenance Manager

Preserve o que ja funciona. Melhore somente com prova. Use a menor capacidade de raciocinio segura para a tarefa.

## Fonte da verdade

- Reconciliacao local de 2026-10-23: esta pasta continua sendo a oficial. Consulte o registro temporal em `docs/contracts/EVIDENCE-REGISTER.md` antes de trocar de branch; backups locais e patches do Mensageiro nao substituem o SHA ativo em producao. Para atualizar: preservar o estado sujo em ref Git verificavel, confirmar ancestry e deployment, criar branch local na base publicada, aplicar somente o delta autorizado, testar e aguardar autorizacao de publicacao.

- Trate `main` como branch canonica somente quando ela estiver reconciliada com producao.
- Backend oficial de desenvolvimento: esta pasta `BACKEND-OFICIAL-2026`, no repositorio `d1egopc/automacao-promocoes`. Confira `origin/main`, checkout e SHA ativo na VPS separadamente antes de afirmar equivalencia.
- Frontend oficial: repositorio `d1egopc/optimuspromo-frontend`. A branch Git e o deployment Production da Vercel sao referencias distintas; confirme o SHA publicado no painel antes de promover ou reverter.
- Extensao oficial no codigo: subtree `optimus-capture` deste backend. Diferencie a tree do checkout, a tag/artefato distribuido e a versao realmente instalada; o numero do `manifest.json` sozinho nao prova equivalencia.
- Compare codigo/runtime atual, testes, configuracao ativa e documentacao. Nao resolva contradicoes silenciosamente.
- Coloque SHAs ativos, containers, flags, hashes e metricas temporais em [EVIDENCE-REGISTER.md](docs/contracts/EVIDENCE-REGISTER.md), nunca como contrato eterno.

## Leitura obrigatoria

Leia [PLATFORM-TOPOLOGY.md](docs/contracts/PLATFORM-TOPOLOGY.md), [PRODUCTION-DEPLOYMENT.md](docs/contracts/PRODUCTION-DEPLOYMENT.md) e os contratos da area tocada antes de alterar qualquer arquivo.

## Entrada para uma nova sessao Codex

1. Abra esta pasta oficial, leia este `AGENTS.md` e os contratos do modulo antes de usar uma worktree, backup ou candidata como referencia.
2. Confirme repositorio, branch, HEAD, `origin/main` e alteracoes locais; verifique o SHA ativo de producao por canal autorizado antes de equiparar codigo local a runtime.
3. Para operacao, siga [PLATFORM-TOPOLOGY.md](docs/contracts/PLATFORM-TOPOLOGY.md), [PRODUCTION-DEPLOYMENT.md](docs/contracts/PRODUCTION-DEPLOYMENT.md) e, para WhatsApp, [MESSENGER.md](docs/contracts/MESSENGER.md). Nao presuma SSH funcional nem reutilize workflows de deploy para diagnostico.
4. Worktrees antigas e commits WIP preservam experimentos, mas nunca substituem a base oficial nem autorizam mescla ou publicacao automatica.

## Telemetria Primeiro — regra operacional obrigatória

Antes de investigar defeitos em qualquer workspace ou motor, consultar primeiro a Telemetria Operacional existente, conforme [TELEMETRIA-OPERACIONAL.md](docs/contracts/TELEMETRIA-OPERACIONAL.md#telemetria-primeiro--contrato-permanente).

Ao receber relato sobre Radar, TeleRadar, Mensageiro, Clonador, RIO, Executor, marketplace, importador, links, destinos, filas ou outra parte da plataforma:

1. Lembrar proativamente o proprietário de que a Telemetria Operacional já existe.
2. Solicitar autorização temporária `tel_` ao proprietário quando necessária, com escopo plataforma/workspace e prazo autorizados. Não pedir JWT principal, SSH ou credenciais comerciais para substituir esse acesso.
3. Consultar somente os endpoints read-only existentes, respeitando escopo, expiração e revogação. O coletor aceita a autorização previamente fornecida em memória; REQUEST_ID permanece como alternativa. Não repetir segredos em respostas, logs, URLs, comandos persistentes ou relatórios.
4. Localizar a primeira etapa com falha comprovada e indicar fonte, horário e identificador sanitizado disponíveis.
5. Distinguir ausência de registro de falha demonstrada: sem cobertura não há prova de que uma mensagem ou evento não chegou.
6. Propor instrumentação adicional somente após identificar uma lacuna concreta nos sinais disponíveis. Se o acesso estiver indisponível, registrar o impedimento específico, sem repetir autenticações nem contornar permissões.
7. Não executar ações produtivas com a autorização read-only: não iniciar sondas, alterar configuração, filas, destinos, sessões, enviar mensagens, fazer deploy ou restart.

## Classificacao obrigatoria

Antes de trabalhar, registre:

```text
Tarefa:
Area:
Risco:
Reversibilidade:
Contratos tocados:
Persistencia/dados:
Performance:
Superficies:
Capacidade minima segura:
Justificativa:
Condicao para escalar:
Modo inicial:
Rollback:
Arquivos/modulos permitidos:
Areas congeladas:
Decisao humana necessaria? sim/nao
```

## Risco e capacidade

- Nivel 1, baixo risco: texto, CSS isolado, leitura simples, relatorio. Use capacidade eficiente, como Luna com esforco baixo/medio.
- Nivel 2, moderado: patch pequeno reversivel, commit/gate, deploy homologado. Use capacidade intermediaria, como Sol Medio.
- Nivel 3, alto: backend + frontend, contrato comercial, links, cupons, marketplace, read model, performance, multiworkspace ou concorrencia. Use Sol Alto.
- Nivel 4, critico: perda/corrupcao de dados, schema/migration, seguranca, persistencia interprocesso, incidente sem rollback claro. Use a maior capacidade disponivel e comece obrigatoriamente em READ-ONLY.
- Use a menor capacidade segura. Nao use capacidade alta apenas por medo nem capacidade baixa contra o risco.
- Escale ao encontrar persistencia, schema, concorrencia, seguranca, multiworkspace, contrato/link comercial, perda de dados, rollback incerto, hot path ou conflito de fontes.
- Desescale quando a causa estiver provada e a etapa restante for patch trivial, commit, gate ou deploy ja homologado.

## Decisao humana

Pare e solicite decisao para mudanca irreversivel, exclusao de dados, schema/migration, contrato comercial, definicao de cupom ou link, elegibilidade, retencao, rollback incerto, duas interpretacoes validas ou alteracao administrativa externa importante.

## Mudanca

- Trabalhe uma frente por vez.
- Nao corrija problema lateral sem autorizacao.
- Fluxo: problema -> auditoria READ-ONLY -> causa comprovada -> patch minimo -> testes -> commit seletivo -> gate -> deploy controlado -> prova real -> congelar.
- Nao altere comportamento homologado sem nomear o contrato e obter autorizacao.
- Performance e isolamento multi-tenant sao contratos.

## Git e producao

- Confirme repositorio, branch, worktree, base e status antes de editar.
- Push em `main` executa somente CI; nunca presuma deploy automatico. O deploy backend exige `workflow_dispatch` explicito de `.github/workflows/deploy-backend-vps.yml`, com SHA de fonte, SHA-base, ID completo da imagem ativa e lista exata de arquivos runtime autorizados. Veja [PRODUCTION-DEPLOYMENT.md](docs/contracts/PRODUCTION-DEPLOYMENT.md).
- O workflow de publicacao usa checkout limpo do SHA no runner e overlay sobre a imagem ativa verificada; nao usa `/opt/optimus/backend` (HEAD destacado/sujo), nao faz `git pull` nem `docker compose build` no Compose produtivo. A selecao persistente de imagem fica em `backend-release.yml` separado do Compose-base.
- Use `git add` seletivo. Nunca use `git add .` ou `git add -A`.
- Informe SHA completo e rollback conhecido.
- Nunca chame gate local de "CI remoto verde".
- Producao backend e somente a Hostinger VPS. Railway esta retirado.
- Nunca use `docker compose down`, remova volumes, recrie PostgreSQL ou toque `/data` sem plano explicito.
- Nao altere env/flags durante deploy fora do escopo aprovado.
- Sempre registre baseline e prove saude depois do deploy.
- O overlay de tres arquivos do deploy manual de outubro/2026 e exclusivo do hotfix do Mensageiro aprovado no SHA 4db00b0b. Nao o reutilize como procedimento geral: qualquer publicacao futura que modifique dependencias ou outros modulos exige imagem completa construida de checkout limpo pelo SHA autorizado, com comparacao da base produtiva, CI, rollback e deploy manual controlado.
- Frontend: Preview `READY` -> gate humano -> promover o mesmo SHA -> provar Production 200.
- Exceção fechada de dependência: somente o perfil hash-pinned `baileys_buffer_patch` descrito em `PRODUCTION-DEPLOYMENT.md` pode executar o instalador Baileys 6.7.22 durante o build derivado da imagem ativa. Não autoriza npm/postinstall genérico, Dockerfile modificado ou outros scripts; source/base/hashes/Compose/rollback continuam obrigatórios.
- Extensao: distribua somente artefato versionado, verificado por hash e aprovado por humano.

## Areas congeladas

Considere Turbo, Historico, VIVA/recovery, Solenoide, Auto Clean, fila operacional e contratos comerciais congelados quando nao forem o escopo explicitamente autorizado.

## Extension Golden Regression Gate

Antes de alterar Launcher, Side Panel, captura compartilhada, registry, product-contract, marketplace-detector, empacotamento da extensao ou implementar Modo Selecao:

1. Preserve os seis adapters homologados: Mercado Livre, Amazon, Shopee, AliExpress, Magalu e KaBuM.
2. Trate KaBuM como invariante comercial: preco Pix estruturado em `number-flow-react[data]` tem prioridade, o fallback legado permanece, e parcelamento, outros sellers e relacionados nunca substituem o preco principal.
3. Preserve Mercado Livre com MLBU factual e MLB somente como alias comprovado.
4. Mantenha o Launcher abrindo nos seis marketplaces e preserve na Shopee a estrategia de nao colisao com o chat.
5. Mantenha Salvar, Enviar agora e `+ Lista` como acoes distintas e funcionais.
6. Exija regressao executavel dos seis marketplaces antes de candidata/release quando houver mudanca compartilhada da extensao; use o [mapa de testes golden](docs/contracts/MARKETPLACES.md#mapa-de-regressao-executavel-existente) e confira o CI realmente acionado.
7. Nao substitua comportamento mais novo de uma fonte oficial por copia mais velha sem diff e prova explicita.
8. Faca o Modo Selecao reutilizar os adapters e o pipeline homologados; nao crie segunda autoridade de captura.

Este texto nao substitui testes executaveis; o gate documental e a regressao automatizada sao obrigatorios.

## Indice de contratos

- [Topologia](docs/contracts/PLATFORM-TOPOLOGY.md)
- [Producao e deploy](docs/contracts/PRODUCTION-DEPLOYMENT.md)
- [Oferta](docs/contracts/OFFER-LIFECYCLE.md)
- [Links e midia](docs/contracts/LINKS-MEDIA.md)
- [Marketplaces](docs/contracts/MARKETPLACES.md)
- [Cupons](docs/contracts/COUPONS.md)
- [Ingressos](docs/contracts/INGRESS-RADAR-CLONADOR.md)
- [Extensao](docs/contracts/EXTENSION.md)
- [Destinos e fila](docs/contracts/DESTINATIONS-QUEUE.md)
- [Historico](docs/contracts/HISTORY.md)
- [Achados e Vitrine](docs/contracts/ACHADOS-VITRINE.md)
- [Auto Clean](docs/contracts/AUTO-CLEAN.md)
- [Mensageiro](docs/contracts/MESSENGER.md)
- [Social](docs/contracts/SOCIAL.md)
- [Multi-tenancy](docs/contracts/MULTITENANCY.md)
- [Performance](docs/contracts/PERFORMANCE.md)
- [Roteamento de capacidade](docs/contracts/MODEL-ROUTING.md)
- [Evidencias temporais](docs/contracts/EVIDENCE-REGISTER.md)

## Fonte única de desenvolvimento

- Backend e frontend oficiais são a fonte única de trabalho.
- Pasta externa, worktree ou candidata só pode ser usada quando houver necessidade técnica explícita.
- Candidata anterior não é baseline implícita para trabalho novo.
- Ao terminar um experimento, reconciliar o resultado na árvore oficial.
- Backup manual é proteção e não fonte de desenvolvimento.
- Antes de sincronizar uma arvore oficial com alteracoes locais, preserve cada arquivo versionavel em branch/commit local verificavel; nunca use `reset --hard`, `git clean` ou copia espelhada para ocultar conflito.
- Backup de codigo nao deve incluir `.env`, tokens, cookies, credenciais, sessoes WhatsApp, dados pessoais, dumps de producao, `node_modules` ou temporarios sem protecao apropriada. Inventarie branch, SHA, status e referencia de frontend/extensao separadamente.

## Selection Mode — invariantes de distribuição

- Selection Mode escolhe produtos; a captura segue o pipeline oficial.
- Não criar uma segunda autoridade para título, preço ou imagem.
- Um card canônico não pode possuir múltiplos controles de Selection.
- Swatches, variantes, badges e wrappers não são produtos independentes.
- Shopee Selection preserva o Capture oficial e a semantic readiness de preço.
- Semantic readiness não pode ser substituída por sleep fixo.
- Mudanças de UX não podem alterar Capture, List API ou adapters.
- Scroll e infinite scroll preservam identidade e estado de seleção.
- `+ Nova lista` reutiliza o contrato oficial de criação de listas.
- O launcher fica oculto enquanto Selection Mode estiver ativo.
