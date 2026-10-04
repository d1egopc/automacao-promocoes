# Truthful History

## Fonte

O read model publico e implementado em `modules/fila/fila-read-model-publico.js`. A UI oficial fica em `src/routes/fila.tsx` no repositorio frontend.

`tipoVisao` nao define o resultado terminal. O campo canonico e `resultadoFinalPublico`.

## Resultados canonicos

- `enviada`: todos os destinos aplicaveis confirmaram.
- `parcial`: pelo menos um confirmou, mas nao todos.
- `nao_enviada`: havia aplicavel, zero confirmacoes e sem falha tecnica.
- `erro`: falha tecnica persistida e zero confirmacoes.
- `nao_elegivel`: zero destinos aplicaveis; label publica "Sem oportunidade".

Causa ausente deve aparecer como `Motivo nao registrado`. Nao invente causa.

## Metricas

- Finalizadas = identidades terminalizadas no periodo.
- Elegiveis = enviadas completas + parciais + nao enviadas + erros.
- Sem oportunidade = finalizadas nao elegiveis.
- Taxa = (enviadas completas + parciais) / elegiveis.
- A soma das categorias terminais deve fechar sem residual oculto.

## Filtros

- Status: Todos, Enviada, Parcial, Nao enviada, Erro e Sem oportunidade.
- Enviada nao inclui Parcial.
- Periodo default permanece Hoje.
- Destino e dropdown carregado pelo fluxo esperado de `GET /destinos`.
- Compare por `destinoId` exato; use apenas fallback legado por nome historico exato.
- Nao use substring.
- Destino removido nao apaga fato; destino novo nao reescreve passado.

## Replay e monotonicidade

Replay nao pode sobrescrever marco temporal terminal, regredir progresso/destinos nem apagar confirmacao enviada. Preserve `terminalOcorridoEm`, `expiradaEm` existente e merge monotonico.

## Performance

Nao adicione query por item, N+1, reconstrucao de eventos por card, full scan historico adicional ou leitura direta de PostgreSQL por item no endpoint publico. Preserve o trabalho agregado do read model.
