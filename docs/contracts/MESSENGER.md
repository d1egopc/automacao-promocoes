# Messenger

## Mensageiro V4 — candidata isolada

- Desenvolvimento nas branches `validation/mensageiro-v4-20261025`, derivadas das mains publicadas backend `af56a3af` e frontend `1cc56ad7`. Não substitui o legado em produção antes de homologação e autorização final.
- `OPTIMUS_MENSAGEIRO_V4_TARGETS` recebe uma lista JSON fechada de alvos `{workspaceId, sessionId, groupId, profileId, cards}`. Cada campo é obrigatório; somente grupos explícitos, sem curingas e sem `scheduled`. Ausência, erro, duplicidade ou uso da antiga flag só por workspace mantém V4 OFF. A tupla reservada não cai no legado se o workspace/perfil divergir. Fora da tupla, o legado permanece responsável; Programadas conserva o scheduler V3 único. O canário de grupo não habilita atendimento privado V4.
- Respostas e avisos V4 reservam na autoridade Universal oficial (`engine_universal_credit_balances` / `financial_credit_ledger`), pelo serviço transacional existente do Manual V2, com origem `mensageiro_v4` e chave idempotente própria. O padrão do Manual V2 não muda. Sem modo Universal/saldo/plano válido, não há envio cobrável. Exclusões não criam cobrança de moderação.
- Cada mensagem possui claim operacional no store V3 e ID Baileys persistido antes do transporte. Retorno local ou `server_ack` não debita: a liquidação exige `delivery_ack`/`read`/`played` correlacionado a sessão, grupo e ID de saída. ACK é durável antes do débito idempotente; um passe de recuperação limitado liquida ACKs pendentes sem enviar. Falha comprovada antes da chamada libera reserva; timeout/erro após invocação mantém reserva incerta, sem replay nem estorno automático. Não existe segundo livro financeiro ou novo schema.
- Exclusão reporta `not_attempted`, `local_resolved` ou `error`, com `deleteAttempted` separado. `remoteDeletionConfirmed=false`: não há prova remota fabricada. Aviso usa o mesmo gate financeiro dos demais envios.
- Perfis precisam de preparação aditiva versionada (`migrationVersion=4`). A preparação conserva cards, imagens, escopos, isenções, programações e IDs; não copia claims nem executa eventos. Duplicar gera perfil inativo, com todos os cards inativos e sem clonar envios.
- Operações V4 sobre o store V3 executam em worker com memória e admissão limitadas. Contenção rejeita rapidamente; timeout de persistência interrompe novas operações e é resultado incerto, sem repetição automática. O lock/atomicidade V3 não é relaxado.
- O diagnóstico V4 usa o callback original; não adiciona listeners. OFF não calcula hash/relógio nem faz I/O. Controle diagnóstico exige Admin Master e uma tupla autorizada. Uma coleta é limitada a sessão de propriedade confirmada, workspace e grupo exatos, 15 minutos, 10 eventos e 120 registros HMAC. Pode observar diferença do workspace capturado no socket sem registrar a identidade de outro workspace. Resultados em RAM são eliminados cinco minutos após encerramento; reinício perde os resultados. A cobertura declara `observed_at_original_callback` ou `not_observed_at_original_callback`; zero registros não prova ausência de pacotes, decriptação ou eventos anteriores ao callback.
- O diagnóstico distingue aceite do transporte de confirmação real de exclusão/entrega. `sendMessage` resolvido não prova que a mensagem desapareceu no aparelho. Nenhum ACK é fabricado; resultado comercial incerto permanece `ambiguous` e não autoriza replay.
- Intenções locais preparadas para o privado usam somente configurações autorizadas e links publicados, com cooldown e sem resposta a mensagens próprias. Domínio de rede social não indica assunto; termos profissionais não anulam infrações. Regras novas começam inativas e com ação observar. Remoção de participante e ações legadas não compatíveis exigem revisão explícita antes do canário.
- Interface `/mensageiro-v4` reutiliza autenticação e feature `mensageiro`; menu de prévia depende de `VITE_MENSAGEIRO_V4_ENABLED=true`, desligado por padrão. Configurações e dados continuam isolados pelo workspace autenticado.
- CI usa os workflows existentes CI-only; a branch frontend tem Preview automático desabilitado no `vercel.json`. Nenhum push isolado autoriza main, deploy, canário, alteração de env produtivo ou teste WhatsApp real.
- A causa histórica do SERVMAQ permanece não comprovada. Fixtures/Baileys em laboratório provam caminhos locais, não ingresso do socket produtivo. Canário e substituição do legado dependem de evidência real e gate humano.

## Escopo comprovado

### Correção candidata do buffer inicial Baileys 6.7.22

- Referências: issue WhiskeySockets/Baileys #2810 e PR #2840 (rascunho, não merge confirmado). A versão instalada tem as mesmas conversões indevidas de `offline="0"` e o mesmo intervalo inicial sem timeout. Isso não prova qual atributo chegou na mensagem humana do SERVMAQ.
- Hotfix pelo instalador revisado, limitado à versão e SHA-256 exatos dos três arquivos instalados após o hotfix de retry. Conteúdo ou versão divergente aborta a instalação. Sem atualização integral do Baileys. O perfil fechado `baileys_buffer_patch` do Guardião aplica esse instalador durante o build sem rede sobre a imagem ativa verificada; Dockerfile/postinstall oficiais permanecem nos bytes publicados. Overlay comum não executa o patch e não é aceito para este candidato; ver a exceção exata no contrato de produção.
- Atuação somente no socket workspace SERVMAQ/sessão ServCel. Sem configuração, os demais sockets conservam o caminho original. Corrige offline zero/missing para o caminho online e `notify`, mantendo `offline="1"` no fluxo histórico. Nenhum listener adicional.
- Timer de 20 segundos desde o OPEN autenticado, independente de conclusão offline. Uma recuperação por instância: exige o socket/emissor ainda atuais e conexão aberta; estabelece fence histórico ANTES do flush nativo limitado. Conclusão offline real cancela o timer; fechamento/socket substituído não libera o buffer antigo. Sem replay/retry de envios ou reconexão.
- Mensagens acumuladas no bootstrap, `append`, timestamp ausente/inválido ou anterior ao cutoff não alcançam consumidores comerciais; IDs e mensagens não são alterados ou apagados. Decriptação/ACKs continuam no Baileys. WeakSet por instância conserva a marca da mensagem retida; timestamps protegem trabalho anterior que termina depois. Contexto assíncrono por instância impede boas-vindas/despedidas históricas originadas por processMessage. O callback original mantém a sonda antes do filtro; Radar/Gerente/Comandos/Atendimento/Clonador ficam depois do fence. Programadas e liquidação de ACK/financeiro não são alteradas.
- Este fence é conservador: bootstrap e mensagens sem prova de atualidade não geram respostas/moderação/cobrança. A correção não classifica conteúdo, não altera regras e não concede permissões V4. CI/build isolados não autorizam publicação ou ativação de canário.

### Sonda de ingresso V4 (candidata isolada, 26/10/2026)

- Zero eventos na captura anterior não distingue ausência no socket, buffer Baileys, rejeição do wrapper ou divergência de grupo. Nenhuma dessas causas foi comprovada em produção.
- O controle Admin Master/tupla/TTL existente permanece obrigatório. `ingressProbe` acrescenta contadores em RAM no wrapper e callback originais de `messages.upsert`; sem novo listener, socket, I/O, flush ou alteração de decisão. OFF não consulta relógio, socket ou HMAC. Eventos de participantes não incrementam os contadores de upsert.
- Somente a sessão autorizada é contada. Outros destinos dessa sessão produzem apenas totais, sem conteúdo, JID, participante ou hash do destino. Correspondência alternativa/normalizada é somente contagem diagnóstica: não amplia o escopo nem autoriza ação.
- Referências de socket/emissor/callback são identificadas por HMAC opaco, com geração, igualdade com registro e estado do buffer. `attachmentVerified=null` no emissor Baileys 6.7.22 significa introspecção indisponível; registro presente não comprova que o callback permaneça instalado. A sonda não acessa pacotes criptografados nem comprova chegada anterior ao emissor.
- Usar o mesmo status autenticado durante a janela e coletar `ingressProbe`, cobertura e registros antes do descarte de cinco minutos. TTL/stop interrompem a coleta; reinício permanece OFF. Publicação e nova captura dependem de autorizações próprias; esta candidata não ativa diagnóstico ou moderação.

O Mensageiro esta em `modules/mensageiro` e possui storage, service, routes, scheduler de programacoes, imagem, perfis e gerente/moderacao.

O storage modela:

- escopo privado, grupo ou ambos;
- boas-vindas e despedida com texto/imagem;
- grupos e sessoes por perfil/modulo;
- cooldowns;
- programacoes;
- configuracao de atendimento e gerente.

O gerente opera mensagens de grupo, permissoes administrativas, regras, avisos, remocao e historico de infracoes/motivos. Nao documente comando especifico como suportado sem localizar seu handler e teste na revisao atual.

## Isolamento

- Perfil resolve por `clienteId`, sessao e grupo.
- Grupo configurado deve pertencer a sessao informada.
- Grupo ativo nao pode pertencer simultaneamente a perfis conflitantes.
- Ausencia ou ambiguidade de perfil deve falhar fechada.
- Cooldown e idempotencia precisam incluir contexto de tenant/grupo/participante/regra.

## Perfis, grupos e programacoes

- `modulo.gruposConfigurados === true` usa `modulo.grupos`, inclusive quando a lista esta vazia; sem essa marca, o modulo herda `perfil.grupos`. Ocultar o seletor global na interface nao autoriza apagar grupos antigos persistidos.
- Migracao de sessao conserva o mesmo perfil e seus textos, imagens, regras, comandos e horarios. Grupos so permanecem vinculados por ID real presente na nova sessao; nome parecido nao autoriza remapeamento. Incompatibilidades exigem decisao explicita antes de salvar, e cancelar/erro conserva a configuracao anterior.
- Para programacao, `gruposConfigurados` proprio tem precedencia; caso contrario vale o alcance proprio do modulo de programacoes, depois `config.grupos`. Programacao com `perfilId` usa a sessao do perfil ativo; programacao legada sem `perfilId` continua usando a sessao global configurada.
- O trace temporario do Gerente e opt-in, desligado por padrao e condicionado a workspace, sessao e grupo exatos. Nao o habilite por mudanca documental ou deploy nao relacionado; sua ativacao e evidencias pertencem ao registro temporal.

## Diagnostico autorizado por workspace

- Encontre a configuracao global em `/data/mensageiro.json`, pela chave `clienteId`, e o historico/configuracao complementar em `/data/clientes/<clienteId>/mensageiro-config.json`. Para diagnostico READ-ONLY, leia e analise JSON diretamente; nao chame getters do storage que possam normalizar e gravar.
- Compare a sessao do perfil, o grupo por ID e o alcance efetivo do modulo com o estado **runtime** do socket Baileys. Sessao configurada nao equivale a `open`; nome da sessao ou do grupo nao prova identidade nem permissao no grupo.
- Siga o listener ativo `messages.upsert` em `index.js` ate `tratarMensagemGrupoGerente()` em `modules/mensageiro/gerente.service.js`. Separe recebimento/decriptacao, roteamento do tenant, perfil/regra, isencao do remetente, permissao do bot e resultado de delete/aviso.
- Use somente SSH verificado ou runner READ-ONLY com autorizacao especifica, conforme [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md). Logs Docker sem cobertura historica nao comprovam ausencia de mensagem. Nao exponha JIDs, numeros, texto privado, auth ou chaves Signal e nao execute teste real sem autorizacao.

## Mudanca segura

Teste grupo e privado separadamente; preserve imagens, texto, programacoes, cooldown e permissoes. Nao altere sessao, grupos ou moderacao como efeito colateral de mudanca na fila/oferta.

Comandos como `!pix`, `!setup`, `!cupom` ou FAQ somente entram no contrato apos prova no codigo/runtime atual; sua existencia nao e assumida por memoria verbal.

## Canário runtime V4 — preparação isolada de 25/10/2026

- Controle exclusivamente Admin Master em `/mensageiro-v4/canary` (GET), `/canary/prepare`, `/canary/start`, `/canary/arm` e `/canary/stop` (POST). Exige autenticação oficial; o alvo é indicado por `workspaceId` no corpo/consulta dos controles, sem alterar a identidade autenticada nem habilitar troca de tenant nas rotas de negócio. Preparar/iniciar/armar exigem plano/conta elegível do alvo. Status/stop continuam disponíveis ao Admin Master se o plano perder permissão.
- Allowlist operacional desta versão: workspace SERVMAQ, sessão ServCel, perfil confirmado e SHA-256 completo do único grupo autorizado. A origem da identidade é a configuração V3, não nome/telefone. Outro alvo falha fechado. A lista geral de targets do ambiente deve permanecer vazia; nenhuma ativação por workspace isolado.
- `prepare` exige tupla oficial conectada, seleção inequívoca de perfil/card e `expectedRevision`; usa a transação de migração já existente com CAS estrito, preservando regras, imagens, IDs e programações. Preparação funciona em OFF e não inicia moderação. `start` exige perfil preparado, ausência de moderação legada em andamento e duração <=900000 ms/eventos <=10. Não cancelar trabalho ativo para abrir janela.
- `observation` reserva somente groupManager nessa tupla: leitura/decisão simulada, metadados de permissão/isencão e trace HMAC, sem claims de execução, transporte ou créditos. Outros cards, grupos e scheduler Programadas seguem no fluxo existente. Não executar o legado de moderação simultaneamente na tupla observada.
- `controlled_test` exige `authorization=single_test_delete` explícita no start e no arm. Start retorna desafio aleatório de 128 bits. Arm exige `runId`, `participantId` exato e texto sintético completo contendo o desafio; guarda somente HMACs. `sendNotice` é false por padrão. Apenas notify novo, socket atual, workspace correto, participante não isento e correspondência integral de texto podem consumir a única tentativa. Não selecionar a primeira URL natural, não aceitar append, fromMe, texto alterado, outro participante ou replay como autorização.
- Lista de domínios permitidos permanece vazia; não existe classificação semântica nova de conteúdo profissional. Toda mensagem natural incerta fica em observação, mesmo no modo de teste. Regras e prioridades permanecem intactas.
- TTL monotônico verificado na admissão, depois dos awaits e imediatamente antes do transporte. Timer, limite de eventos, stop manual e conclusão da tentativa encerram a permissão funcional e o diagnóstico. A mensagem que atinge o teto já não pode agir. Sem persistência da ativação; restart/crash volta OFF. Resultados diagnósticos em RAM: coletar durante a janela e no stop; descarte após cinco minutos. Não registrar corpos de controle, Bearer, participante bruto ou texto de teste em logs operacionais.
- Exclusividade inclui promessa física ainda pendente, mesmo se o timeout local venceu. Estado funcional OFF com `draining=true` bloqueia ambas as moderações até a promessa real terminar; não anunciar liberação segura enquanto houver transporte incerto. A expiração não desfaz uma chamada já invocada. Eventos do lote já observado não caem no legado após stop/troca de janela. Não há retry automático.
- Máximo uma exclusão gratuita. Aviso opcional usa reserva/ACK/débito idempotente oficiais; zero saldo bloqueia aviso, não exclusão. Retorno local é `local_resolved`, nunca confirmação remota. Se expirar antes da chamada, `not_attempted`. Correlações financeiras pendentes do journal V3 continuam liquidáveis com runtime OFF: leitura única no worker no boot, até64 tuplas, recuperação somente de ACK factual, sem reenvio/ativação/refund automático. Não muda livro, schema, crédito por mensagem ou contratos do Manual V2.
- Esta documentação e candidata NÃO autorizam deploy ou canário produtivo. Publicação depende de CI verde/preflight e OK do proprietário; ativação real requer autorização específica e coletor protegido preparado, sem solicitar credenciais no chat.
