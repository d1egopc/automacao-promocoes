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

## Antes de alterar

Mapeie tipo de dado, produtor, consumidores, referencia, TTL atual, volume, custo, comportamento em falha e rollback. Diferencie expiracao comercial, terminalizacao de fila e elegibilidade para GC.

## Gate

Use fixtures descartaveis e prove itens protegidos, itens elegiveis, idempotencia e ausencia de vazamento entre workspaces. Nunca valide uma nova politica diretamente em `/data` de producao.
