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
