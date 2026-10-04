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

## Antes de alterar

Mapeie tipo de dado, produtor, consumidores, referencia, TTL atual, volume, custo, comportamento em falha e rollback. Diferencie expiracao comercial, terminalizacao de fila e elegibilidade para GC.

## Gate

Use fixtures descartaveis e prove itens protegidos, itens elegiveis, idempotencia e ausencia de vazamento entre workspaces. Nunca valide uma nova politica diretamente em `/data` de producao.
