# Mensageiro — backend integrado para o frontend

Candidata posterior ao Mensageiro universal publicado. Este contrato não autoriza deploy, ativação ou teste real. Reutiliza autenticação, plano `mensageiro`, V4 Engine/Repository, V3Store, scheduler V3, handlers legados e créditos oficiais. Não muda Radar, TeleRadar, RIO, motores comerciais ou frontend.

## Identidade e ativação

Workspace vem da autenticação oficial; nenhum campo do corpo troca tenant. Sessão e grupos devem pertencer à workspace. Módulos/programações novos só usam subconjunto do alcance do perfil. Criação, duplicação e aplicação de modelo deixam cards OFF; modelo só pode ser aplicado com perfil desativado. O novo perfil também começa OFF.

Perfil: `id`, `workspaceId`, `name`, `sessionId`, `destinations`, `niche`, `active`, `revision`, `cards`, `execution`. O frontend não escreve `execution`. A ativação mantém o contrato homologado: `confirmActivation=true`, revisão atual e ao menos um card ativo; legado exige `confirmLegacyReview=true`. Modelos e cópias não copiam claims, ACK ou programações.

`expectedRevision` é a revisão do perfil para editar perfil/módulo/modelo; programações usam sua própria revisão. Campo `active` omitido no PUT preserva estado do módulo. Conflito retorna 409; reler e pedir decisão do usuário, sem sobrescrita silenciosa.

## HTTP `/mensageiro-v4`

| Operação | Contrato |
| --- | --- |
| GET `/state` | Compatibilidade atual, perfis leves, sessões e catálogos |
| GET `/profiles` | Perfis leves e resumo de programações próprios |
| POST `/profiles` | `{name,sessionId,destinations,niche?}`; criado OFF |
| GET `/profiles/:id` | Perfil/configuração completos da workspace |
| PATCH `/profiles/:id` | Atualização/ativação explícita com CAS existente |
| POST `/profiles/:id/duplicate` | Cópia independente OFF |
| GET `/sessions` | Sessões próprias com `connected` e `liveReady` |
| GET `/groups?sessionId=...` | Grupos conhecidos da sessão conectada, sem forçar sincronização |
| GET `/templates` | Biblioteca local versionada |
| POST `/profiles/:id/template` | `{templateId,expectedRevision}`; copia modelo editável, tudo OFF |
| GET `/profiles/:id/modules` | Todos os módulos e revisão atual do perfil |
| GET `/profiles/:id/modules/:module` | Consulta individual com `configuration`, `state`, `active`, `revision` |
| PUT `/profiles/:id/modules/:module` | `{expectedRevision,configuration?,active?}`; salva somente esse módulo |
| POST `/profiles/:id/media` | `{media:{type,dataUri}}`; devolve mídia validada, `persisted:false` |
| GET `/profiles/:id/schedules` | Programações com conteúdo e revisão |
| POST `/profiles/:id/schedules` | Configuração futura, `ativo` false por padrão |
| PATCH `/profiles/:id/schedules/:scheduleId` | Editar/pausar/ativar com CAS da programação |
| DELETE `/profiles/:id/schedules/:scheduleId` | Excluir configuração com CAS, sem apagar ledger/histórico |
| POST `/profiles/:id/human` | `{expectedRevision,contactId,paused,minutes?}`; pausar/retomar robô para contato privado |
| GET `/profiles/:id/history?limit=30` | Até 100 registros do audit V3, isolados por perfil/workspace |
| GET `/profiles/:id/diagnostic` | Estado da sessão/módulos, totais explicitamente da workspace e até dez registros; somente leitura, sem iniciar observação |

401 sem autenticação; 403 plano bloqueado; 409 revisão; 422 com `code` para validação; 503 para indisponibilidade. Nenhuma rota comercial nova aceita grant read-only `tel_`. Controles administrativos antigos continuam com suas próprias permissões, sem dependência funcional do editor.

Estados: `desativado`, `configurado`, `ativo`, `pendente_de_permissao`; erros vêm do HTTP/code. Conexão OPEN não comprova sincronização nem ingresso. Gerente não presume administração por configuração: o status conserva a pendência de prova, e a checagem factual ocorre em cada ação.

## Configuração dos módulos

Nomes: `welcome`, `farewell`, `commands`, `attendance`, `groupManager`, `scheduled`. Entrada/saída são independentes e representam um módulo visual. FAQ, fluxos e respostas rápidas antigos permanecem preservados no storage. Ao configurar o novo `attendance`, os três auxiliares ficam OFF; suas flags antigas não contornam o OFF do módulo unificado.

Resposta comum: `{text:"Olá, {nome}!",media:null}`. Até oito alternativas por ação, escolhidas deterministicamente pelo evento. Variáveis: `{nome}`, `{grupo}`, `{saudacao}`, `{negocio}`; sem nome factual usa `participante`/`grupo`. Sem IA por mensagem, HTML ou execução de scripts.

- **welcome/farewell**: `{responses,delaySeconds:0,destination:"group",groups?}`. `destination:"private"` restringe envio aos participantes do evento. Até 30 s de atraso e oito participantes. Dedupe durável e bloqueio de histórico/bootstrap existentes.
- **commands**: `{commands:[{id,triggers:["!regras"],responses,groups?,cooldownSeconds:30}],groups?}`. Até 50 comandos, gatilhos exatos únicos. Cooldown por workspace/perfil/sessão/grupo/participante/comando. Não responde mensagens próprias.
- **attendance**: `{greeting:[],fallback:[],rules:[],nodes:[],humanTerms:["humano","atendente"],humanPauseMinutes:60,cooldownSeconds:60,delaySeconds:0,hours:null}`. Privado somente. Regras `{id,terms,match:"exact"|"contains"|"starts",priority,responses,next?,human?}`. Maior prioridade primeiro; empate conserva ordem. Até 50 regras e 30 nós. Nós `{id,responses,options:[{terms,next?,human?}]}`; referências precisam existir. Cada aresta depende de nova mensagem, sem loops automáticos. Transferência humana pausa antes de responder, por 1–1440 minutos; retomada por API ou expiração. Não envia aviso de transferência automaticamente.
- **hours**: `{days:[1,2,3,4,5],start:"08:00",end:"18:00"}` em São Paulo, domingo=0. Intervalos noturnos preservam o dia inicial configurado.
- **groupManager**: `{groups?,rules:[{id,category,enabled,action,terms?,allowedDomains?,media?,warning?,threshold?,windowSeconds?,strikes:2,strikeWindowMinutes:60}]}`. Catálogo determinístico existente. Ações `observe`, `warn`, `delete`, `delete_warn`, `warn_ban`. Limiar de 2 ou 4 infrações, janela 1–1440 minutos. `warn_ban` avisa antes do limiar e tenta remover ao atingir o limiar; não inventa exclusão adicional. Administradores/dono protegidos sempre no contrato novo. Banimento exige nova leitura de metadata e revalidação do contexto; somente o remetente da infração é alvo. Retorno local não comprova confirmação no aparelho.
- **scheduled**: `{groups?}` e ativação do card; conteúdo/recorrência usam o scheduler V3.

Modelos `general`, `tools`, `refrigeration`, `fishing`, `beauty`, `custom`: cópias por valor, independentes da biblioteca. Sugestões não ativam recursos; regras sugeridas ficam desabilitadas/observação. Não existe classificação semântica genérica de conteúdo incerto.

## Programações

```json
{
  "name":"Lembrete",
  "ativo":false,
  "grupos":["ID_REAL_SELECIONADO@g.us"],
  "recurrence":{"mode":"weekly","days":[1,3,5],"time":"09:00","jitterMinutes":{"min":0,"max":2}},
  "responses":[{"text":"Bom dia! Consulte nossas regras."}]
}
```

`once` usa `startAt` ISO; `daily` usa `time`; `weekly` usa `days`/`time`; `interval` aceita `intervalMinutes` ou `intervalHours`. Fuso São Paulo. Intervalos de um minuto a sete dias. Variação entre 0 e 60 minutos, menor que o intervalo e sem cruzar o dia de uma recorrência diária/semanal. Jitter pseudorrandômico determinístico, persistido em `nextRunAt`; retry não sorteia execução nova. Alternativas de conteúdo rotacionam por ocorrência concluída. Execução única não é reagendada pelo jitter.

Pausar: PATCH `{expectedRevision,ativo:false}`. Edição de conteúdo/recorrência com revisão; `nextRunAt` não é autoridade do cliente. Fence de atraso/sem replay, ocorrência, destinos, claims e ACK continuam no V3. Sem segundo timer, cron ou fila.

## Mídia e performance

- PNG/JPEG/WebP até 5 MiB; MP4 até 6 MiB, assinatura/container coerentes. Bloqueia URL externa, MIME divergente, base64 inválido, MP4 truncado e excesso de tamanho. Não executa nem baixa mídia arbitrária.
- POST de mídia valida; salvar a resposta do módulo/programação persiste na configuração oficial. POST isolado não promete arquivo persistido ou URL pública.
- Corpo HTTP global existente: 10 MiB. Conteúdo/configuração até 9 MiB serializados. Frontend deve validar o total, inclusive várias mídias.
- Validação também na fronteira do V3Store, inclusive escritores compatíveis. Decodificação de mídia dos módulos ocorre no worker existente; callback recebe bytes preparados. Sem I/O síncrono, base64 de vídeo ou consulta externa adicional no listener.
- Estado de conversa/cooldown/infrações na mesma autoridade V3: chaves opacas, até 1000 entradas/workspace, 60 slots/30 regras por entrada. Limpeza limitada no worker ao acessar o estado; sem cron novo ou conteúdo de mensagens. Estado vigente sobrevive à releitura/restart.
- Sem novo livro financeiro: respostas/avisos usam reserva e ACK elegível oficiais, idempotência e saldo. Remoção administrativa não é mensagem cobrável. Saldo zero bloqueia avisos/respostas e não bloqueia exclusão gratuita autorizada.
- Audit V3 limitado não é fila e não comprova entrega por si só. Retorno local continua diferente de ACK.

## Homologação

`tests/mensageiro-backend-definitivo.test.cjs`: HTTP local real, duas workspaces, worker/store reais, eventos simulados, relógio controlado e regressões V3/V4. PNG gerado e MP4 público CC0 da MDN percorrem validação, persistência, payload e preparação criptográfica real pelo Baileys, com upload/WhatsApp simulados. Suíte financeira oficial em PostgreSQL isolado obrigatória no CI Linux/Node 24.

Esta missão não comprova recebimento da sessão Vivo, sincronização offline nem ACK em aparelho. Publicação e teste real exigem etapas posteriores. A próxima interface usa estes endpoints sem combinar configurações de versões antigas; frontend não foi modificado nesta missão.
