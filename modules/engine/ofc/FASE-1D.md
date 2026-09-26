# Fase 1D — observabilidade paralela

Implementacao local. Sem commit, deploy, migracao executada ou autoridade nova.
ENTREGA POR DESTINO/ALVO != FINALIZACAO DA OFERTA.

## Fontes e unidades

- `outputRate`: conserva calculo/consumidor decisorio atual. O bloco paralelo
  informa sua unidade real: eventos `executor_enviado` por minuto. O evento
  depende da finalizacao/fanout e tem fallback agregado; nao e drenagem imediata.
- `throughputEntregasConfirmadasPorDestino`: checkpoints `enviado` com
  `confirmado_em` dentro da janela, em confirmacoes persistidas por destino/alvo
  por minuto. A chave continua cliente + itemFila + destino + alvo. Multiplos
  alvos contam separadamente, mesmo no mesmo destino. Debito nao e requisito
  da metrica de transporte. Nao implica leitura pelo usuario final.
- `finalizacoesComerciaisPorOferta`: ofertas com `status=enviado` e `enviadoEm`
  no snapshot de fila ja persistido, uma vez por cliente/item. Reutiliza os
  campos escritos pelo finalizador homologado, sem alterar Executor/fanout.
  Esta primeira metrica cobre finalizacao comercial enviada, nao erros,
  expiracoes ou retencoes. Fanout parcial nao conta como oferta finalizada.

Cada observacao publica unidade, janela, fonte, qualidade, timestamp e idade.
As novas metricas nao participam de sinaisAusentes, confianca decisoria,
thresholds, evidence, dwell, cooldown ou transicoes do Auto Gate.

## Qualidade e limites

O transporte agrega a tabela inteira na janela, mas limita o detalhe do log
a 100 pares cliente/destino; o total nao e truncado. Checkpoints antigos sem
horario confiavel nao recebem backfill: a fonte indica cobertura parcial.
Fonte/coluna ausente ou erro retorna null, nunca zero artificial.

A finalizacao reutiliza a passagem existente sobre a fila, sem nova leitura
ou serializacao da oferta. O fim da janela e fixado no inicio do snapshot.
Seu escopo sao workspaces cadastrais observados e arquivos de fila presentes;
nao consulta arquivo historico separado. Filas invalidas e terminais sem
identidade/horario sinalizam qualidade parcial. Nao apresentar essa contagem
como censo global de todas as finalizacoes historicas.

## Disponibilidade read-only do Reset

Probe de catalogo `to_regclass`, estados DISPONIVEL/AUSENTE/DESCONHECIDO.
Resultado conhecido revalidado em cinco minutos; erro reavaliado apos quinze
segundos. Chamadas concorrentes compartilham probe. Somente inexistencia
comprovada produz AUSENTE. Erros de banco/conexao produzem DESCONHECIDO.
Sem query de negocio enquanto a fonte nao estiver disponivel. Fonte disponivel
sem reset concluido conserva contadores null, com motivo explicito.

## Timestamp duravel — preparacao autorizada localmente

Nao existia timestamp imutavel no checkpoint. A extensao minima preparada e
`confirmado_em`, preenchido no mesmo UPDATE/CAS que persiste `enviado`.
`clock_timestamp()` evita usar o inicio de uma transacao que possa ter
antecedido a chamada ao provider. Debito posterior nao modifica esse campo.
Nao ha evento fire-and-forget, nova tentativa ou alteracao do protocolo de envio.

`modules/fila/observabilidade-confirmacao.sql` NAO e carregado pelo bootstrap.
Aplicar coluna/indice depende de nova autorizacao, fora desta fase local, e
deve preceder qualquer deploy do repository alterado. O schema principal
`modules/engine/schema.sql` permanece intacto. O helper de schema do repository
foi atualizado para schemas isolados de teste. Nao executar o teste PostgreSQL
contra banco algum sem autorizacao especifica; nesta fase usa-se modelo local
de SQL e testes funcionais, nao prova integrada PostgreSQL.

## Instrumentacao

Tempos monotonicos de coleta, fila ativa, fluxo vivo/comercial, absorption,
drenagem, etapas Engine e Auto Gate. Mede leitura/parse da fila e serializacoes
que ja aconteciam, sem stringify extra para estimar tamanho de snapshots.
Bytes sao estimativa de stat do arquivo, sujeita a troca atomica concorrente;
leituras injetadas sem tamanho nao fingem bytes conhecidos. Ha uma consulta
leve de metadados por arquivo real instrumentado, sem releitura do conteudo.

Timer de 20 ms e histograma cobrem o ciclo, incluindo atraso pendente na cauda
sincrona. Sao medidas de atraso do processo compartilhado, nao atribuicao de
culpa exclusiva ao OFC. Duracao nao deve ser somada a tempos aninhados.
Timers sao encerrados em finally. Engine continua sem aguardar Auto Gate.

Os dois logs completos antigos do Gate foram mantidos: os consumidores locais
foram inspecionados, mas nao se comprovou ausencia de consumidores externos.
Esta fase apenas mede a serializacao existente. Remocao/compactacao fica adiada.

## Invariantes

Nenhuma oferta e reconstruida. Links produto/afiliado/resgate/app/PC, imagens
oficiais/materializadas/fallback, render/branding, midia, templates, titulo,
precos, cupom, condicoes, categoria, marketplace e origem permanecem intactos.
Radar/TeleRadar, Manual, Extensao, Achados, Social, Clonador e os canais
WhatsApp/Telegram/Discord preservam seus contratos e distribuicao.

Antes de producao: Gate final do diff, validacao PostgreSQL autorizada em
ambiente isolado, aprovacao separada de migracao e deploy somente Shadow.
