# Histórico Definitivo V1

## Autoridade

Histórico comercial não é fila nem hot path. Sua autoridade é a projeção
PostgreSQL aditiva `engine_history_items` + `engine_history_targets`.

- Lista e cards: `GET /historico`.
- Detalhe sob demanda: `GET /historico/:historyId`.
- `GET /fila` permanece operacional e não é autoridade da tela Histórico.
- JSON, shadow, VIVA, fila legado e configuração atual de destinos não podem
  reconstruir ou reescrever fatos históricos.

## Cutover e retenção

- `HISTORY_BACKFILL=false`.
- O Histórico Definitivo V1 começa no epoch/cutover em que a migration desta
  projeção é aplicada e o writer passa a registrar fatos terminais.
- Fatos anteriores ao cutover não são reconstruídos com configuração atual,
  JSON, shadow, legado ou filas operacionais; isso evitaria inventar snapshots.

### Retenção física

- A exibição comercial continua limitada ao período contratado de 7 dias.
- A exclusão física automática só considera `finalized_at` com pelo menos 192
  horas (7 dias mais 24 horas de carência).
- A rotina é PostgreSQL-only, tenant-scoped por `workspace_id`, usa lotes
  limitados, transação curta, `FOR UPDATE SKIP LOCKED` e lock advisory próprio.
- `engine_history_targets` é removida antes de `engine_history_items`; qualquer
  falha de referência, lock ou consulta faz rollback do lote inteiro.
- Um item ligado a fila universal ainda viva ou sem terminalidade permanece
  protegido. Itens do usuário, agendamentos, configurações, mídias, backups,
  fila JSON e demais arquivos não são candidatos dessa rotina.
- O executor não reconstitui nem ressuscita históricos antigos: o ciclo só faz
  `DELETE` em fatos já persistidos e elegíveis, de forma idempotente.

## Resultados comerciais

- `sent`: pelo menos um ACK confirmado e nenhuma falha terminal factual.
- `partial`: pelo menos um ACK confirmado e pelo menos uma falha terminal factual.
- `error`: zero ACK e falha terminal factual.

Estados operacionais (`pending`, `claimed`, `send_started`, `skipped`,
`expired`, `discarded_without_replay`, `not_sent`, `no_opportunity`,
cooldown/cadência) não entram no Histórico comercial. Nunca invente causa ou ACK.

## Metricas

- Finalizadas = `sent + partial + error`.
- Enviadas = `sent + partial`.
- Parciais são subconjunto de Enviadas.
- Erros têm zero ACK.
- Taxa de envio = Enviadas / Finalizadas.

## Filtros

- Status: Todos, Enviadas, Parciais e Erros.
- Periodo default permanece Hoje.
- Destino e dropdown carregado pelo fluxo esperado de `GET /destinos`.
- Compare por `destinoId` exato.
- Nao use substring.
- Destino removido nao apaga fato; destino novo nao reescreve passado.

## Snapshots e idempotência

Destino e alvo são capturados no fanout e copiados para o Histórico na mesma
transação da decisão terminal. A chave `(workspace_id, source_key)` torna a
projeção idempotente. Falhas anteriores ao Universal só podem ser projetadas
depois de uma transição terminal persistida e quando o motivo puder ser
classificado com segurança. Além do motivo, o writer pré-Universal exige
evidência comercial estruturada já persistida: marketplace identificado,
identidade canônica de produto, link comercial classificado ou título e preço
capturados com proveniência. Texto da mensagem, título isolado e URL não
comercial não bastam. Esse gate não altera a terminalização técnica do job.

## Performance

- Lista limitada a 50 itens.
- Cursor estável por `finalized_at + history_id`.
- Nenhum N+1 e nenhum alvo/ACK completo na listagem.
- Targets são lidos apenas no detalhe.
- Toda consulta inclui `workspace_id`.
- Filtros de canal/destino usam `EXISTS` e índices tenant-scoped.
