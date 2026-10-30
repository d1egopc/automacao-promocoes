# Auto Clean and Retention

## Escopo

Auto Clean vive em `modules/engine/auto-clean` e trabalha com rotacao por workspace, indice de referencias e GC relay. Referencias da fila tambem aparecem em `modules/fila/fila-gc-references.js`.

## Invariantes

- Nao aumente retencao apenas para facilitar uma feature.
- Nao desative limpeza para manter Historico sem avaliar custo e referencias.
- Nao remova arquivo/midia enquanto houver referencia operacional, historica ou social que o contrato preserve.
- Isolamento de limpeza e por workspace.
- Dry-run/shadow, quando existentes, nao autorizam apagar dados.
- Mudanca de TTL, janela, lote, referencia ou politica de exclusao exige decisao humana.

## Trava de exclusão produtiva

Os caminhos de exclusão do Auto-Clean exigem liberações independentes com valor exato `approved`:

- `OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE` para os estágios PostgreSQL, inclusive chamadas diretas e modo recorrente `execute`.
- `OPTIMUS_AUTO_CLEAN_FILE_DELETE_RELEASE` para compactação da fila, thumbnails e arquivos operacionais.
- `OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE` para o GC físico de mídia, inclusive quando `OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE=true` já estiver configurado.

Ausência ou qualquer outro valor mantém a exclusão bloqueada. As liberações não substituem as flags, limites, referências e demais condições existentes. O modo `validate` não precisa dessas liberações. A habilitação futura exige recuperação atual testada e autorização explícita para o lote ou origem correspondente.

### Candidata recorrente restrita — eventos brutos `admin`

Desligada por padrão. Requer simultaneamente `OPTIMUS_AUTO_CLEAN_RECURRING_MODE=execute`,
`OPTIMUS_AUTO_CLEAN_RECURRING_SCOPE=engine_eventos_brutos:admin` e
`OPTIMUS_AUTO_CLEAN_RAW_ADMIN_RELEASE=approved`. A liberação geral do banco deve continuar ausente;
se for habilitada junto com esta origem, a candidata bloqueia. O agendador em `execute` não percorre
os outros seis estágios. Chamadas diretas legadas continuam protegidas pela liberação geral.

Um ciclo de dez minutos remove no máximo **um** `engine_eventos_brutos` com mais de **168 horas**,
`origem_tipo=whatsapp`, espelho Radar da workspace `admin` e sem referências nas seis tabelas de
evento conhecidas. Um novo campo de referência ou trigger inesperado bloqueia a execução.
O lock consultivo transacional preserva concorrência; elegibilidade e referências são rechecadas
sob lock antes do DELETE. Falha de backup, de esquema, de limite ou de transação bloqueia o lote.

Antes do DELETE, o registro completo é salvo com hash SHA-256, modo `0600` e fsync em
`/data/auto-clean/recurring-eventos-brutos-admin`; a leitura de volta valida o arquivo.
Somente arquivos desse formato e desse diretório podem expirar após **72 horas**. O diretório é
`0700`, não aceita symlink e bloqueia em arquivo desconhecido/corrompido. O máximo é **512 arquivos**,
**16 MiB** totais e **64 KiB** por registro; exceder qualquer limite suspende novas exclusões.
Backups históricos e de recuperação externos ficam fora desse diretório e não são tocados.
O arquivo permite restauração pontual em PostgreSQL 17 isolado; a janela de 72 horas e o
procedimento de recuperação devem ser homologados antes da primeira ativação recorrente.
Esta candidata não altera o limite padrão de **4 MiB** da projeção GC de `user_pss60lus`.
`fila-projecao-leve.json` passa a ser gravado sem espaços de apresentação, preservando
todos os campos e a cobertura do checkpoint; os demais JSON continuam com o formato
anterior. A projeção existente só muda na próxima publicação normal da fila. Até
comprovar uma projeção atual, íntegra e abaixo de 4 MiB, o GC dessa workspace
continua bloqueado. Não há aumento do limite nem regravação produtiva automática.

## Antes de alterar

Mapeie tipo de dado, produtor, consumidores, referencia, TTL atual, volume, custo, comportamento em falha e rollback. Diferencie expiracao comercial, terminalizacao de fila e elegibilidade para GC.

## Gate

Use fixtures descartaveis e prove itens protegidos, itens elegiveis, idempotencia e ausencia de vazamento entre workspaces. Nunca valide uma nova politica diretamente em `/data` de producao.
