# Messenger

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

## Mudanca segura

Teste grupo e privado separadamente; preserve imagens, texto, programacoes, cooldown e permissoes. Nao altere sessao, grupos ou moderacao como efeito colateral de mudanca na fila/oferta.

Comandos como `!pix`, `!setup`, `!cupom` ou FAQ somente entram no contrato apos prova no codigo/runtime atual; sua existencia nao e assumida por memoria verbal.
