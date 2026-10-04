# Performance Contract

## Principio

Uma feature funcionalmente correta nao esta pronta se degrada perceptivelmente o sistema. Meça antes e depois nos caminhos afetados.

## Invariantes

- Evite query por item e N+1.
- Evite full scan novo, especialmente em Historico, fila e `/data`.
- Evite releitura/parse repetido de arquivos grandes.
- Evite lookup remoto em hot path.
- Evite I/O, stringify ou escrita sincronica por oferta na main thread.
- Nao aumente fanout sem medir.
- Nao transforme read model em reconciliacao pesada.
- Nao adicione request, timer, observer ou recaptura a UX sem necessidade.
- Preserve workers/coordenadores para trabalho pesado de persistencia.

## Caminhos sensiveis

- event loop do backend durante VIVA mutation/checkpoint;
- leitura e escrita de `fila.json`/VIVA;
- selecao, scheduler, fairness e executor;
- read model do Historico;
- Radar/importers e resolucao de redirects;
- pagina inicial, Historico, Automacao, Ofertas, Achados e Preview;
- extensao ao abrir/capturar/renderizar;
- Social automatico e renderer.

## Medicao

Para mudanca relevante, registre latencia p50/p95/max, stalls >1s/>2s, CPU, RSS/heap, queue wait, I/O/bytes e requests concorrentes quando aplicavel. Correlacione outlier com operacao concreta; nao atribua ao `fila.json` sem evidencia.

Benchmark sintetico nao substitui prova natural, e boot nao representa UX normal. Nao fabrique carga destrutiva em producao.

## Gate

Patch em hot path e Nivel 3; persistencia/concorrencia sem rollback claro e Nivel 4. Uma nova query, scan ou I/O precisa ser explicitamente justificada e testada.
