# Auto-Clean funcional — candidata para homologação separada

Base reconciliada: `f16d37eb4811d0943bc788ce930fe799ddc4c276`. A candidata anterior `0b1c5255a294da2a88a46cffe1d8feced4cf495e` foi aplicada seletivamente sobre essa base. Diagnóstico usado: `AUTO-CLEAN-DISCO-DIAGNOSTICO-20261029.md`.

Tarefa: wiring recorrente e validação da retenção. Área: Auto-Clean. Risco: alto por persistência/exclusão futura. Reversibilidade: candidata isolada; gate de execução novo OFF. Contratos: AUTO-CLEAN, HISTORY, PERFORMANCE, MULTITENANCY e deploy. Persistência: somente fixtures descartáveis e relatórios de CI; nenhuma escrita produtiva. Performance: admissão sem await comercial, single-flight, intervalo existente, SELECTs limitados e timeout. Superfícies: módulo Auto-Clean e uma chamada no coordenador existente. Capacidade: análise de persistência e concorrência. Escalar antes de mudança de TTL, produtor de referência ou schema. Modo inicial: laboratório/validação. Rollback: flag recorrente OFF e imagem anterior em publicação futura autorizada. Arquivos permitidos: Auto-Clean, wiring no orquestrador, testes, documentação e CI-only. Áreas congeladas: motores comerciais, fila, Links, Mensageiro, sessões e produção. Decisão humana: qualquer publicação/execução futura.

## Causa e mudança

A rotina `executarAutoCleanPostgresRecorrenteSeguro` não possuía chamador. A nova admissão está no coordenador existente, antes e independentemente do gate Shadow; não há novo timer, listener ou loop por workspace. Um `setImmediate` tira a consulta da cadeia aguardada do ciclo comercial. Single-flight impede sobreposição local; os locks transacionais, limites e sete estágios do executor original permanecem intactos.

`OPTIMUS_AUTO_CLEAN_RECURRING` e intervalo de dez minutos mantêm seus valores e semântica de habilitação/admissão. Nova variável **`OPTIMUS_AUTO_CLEAN_RECURRING_MODE`**: ausente, inválida ou `validate` significa somente validação; apenas valor exato `execute` encaminha ao executor original. A flag é reavaliada antes do trabalho adiado. Esta candidata não altera env produtivo.

Validação usa conexão do pool existente, `BEGIN READ ONLY`, statement timeout de 1 segundo por consulta, lock timeout de 100ms, lote de 32 por origem, ROLLBACK e release em sucesso/falha. São seis SELECTs do inventário existente: amostra de ofertas/jobs/eventos/links/processamentos/eventos comerciais. Falha parcial de consulta marca o ciclo como falho. A conexão limitada do executor restaura `query` e `release` ao devolvê-la ao pool. **É pré-seleção amostral, não simulação exata de todos os DELETEs dos sete estágios**, especialmente histórico e órfãos. Não aprova ativação destrutiva nem demonstra economia física. O timeout limita cada statement; não se alega isolamento completo de custo do banco compartilhado. A aquisição de conexão obedece à configuração existente do pool.

O executor geral legado e o GC de mídia conservam seus gates anteriores; esta candidata não liga nenhum deles. A nova execução PostgreSQL permanece OFF por padrão, mesmo com a flag recorrente herdada ligada. Se for necessária uma janela de **zero exclusões em todos os componentes**, será preciso autorizar separadamente a suspensão dos gates de execução de mídia já ativos; esta candidata não os modifica silenciosamente.

## Referências GC: cobertura parcial, proteção mantida

O diagnóstico demonstra duas fontes compactas ausentes e uma desatualizada. As validações atuais exigem cobertura de fila/proof, cliente exato, checksum e identidade/mtime do arquivo; o índice não pode inventar cobertura quando o produtor não a publicou. Os testes existentes de fase 14/14.1 reproduzem ausência, divergência, troca de workspace, invalidação e publicação natural pelo produtor oficial. Também comprovam que a cobertura volta após publicação válida em fixtures.

Não foi comprovado que as três recusas produtivas sejam falsos positivos. Portanto **nenhuma regra de referência foi afrouxada e nenhum produtor/arquivo de fila foi reescrito**. Reparar as três instâncias produtivas continua BLOQUEADO, exigindo evidência da origem exata ausente/desatualizada e sua publicação pelo produtor oficial, em missão autorizada. Não executar refresh, bootstrap, reconstrução de proof nem ler filas completas produtivas por improviso.

Adicionada métrica sanitizada por resultado do GC: inspecionados, pré-elegíveis, protegidos, alvos bloqueados por referências, códigos de motivo, removidos e bytes físicos declarados pelo GC. Não exporta caminho, conteúdo, sessão ou workspace. Bytes de PostgreSQL são rotulados **lógicos**; não são bytes devolvidos ao filesystem. Contadores são por ciclo e limitados à amostra/lote; não um inventário global. Erros de referência continuam fail-closed.

## Homologação progressiva futura (não executar agora)

1. Conferir nova base/imagem, CI/Guardião, SHA final e rollback antes de autorizar publicação. Publicação, alteração de flags e ativação são decisões distintas.
2. Publicar apenas os três arquivos runtime aprovados, mantendo `RECURRING_MODE` ausente/`validate`. Observar métricas sem chamar o executor recorrente. Confirmar flag OFF resulta em zero consultas novas e que modo desconhecido não executa DELETE.
3. Executar no CI o teste PostgreSQL 17 descartável dos sete estágios com fixtures de elegível/protegido, dois tenants, ACK, histórico e idempotência. Reavaliar qualquer falha antes de publicação. A homologação de fixtures não aprova execução destrutiva no banco produtivo.
4. Comprovar a cadeia dos três produtores de referência bloqueados, sem falsificar índices ou dispensar fila/histórico/social. Mídia velha sozinha não autoriza execução.
5. Só após aprovação separada, selecionar execução `execute` do recorrente. Reutiliza caps existentes (até 32 mutações, lote canário, sem arquivos/leases/fila JSON) e locks do executor. Não elevar limites para acelerar. A cadência de sete estágios é mantida.
6. Abortar por dado vivo elegível, mistura de tenant, lock/timeout excessivo, erro de referência ou regressão de captura/envio. Desligar a flag recorrente impede novas admissões; trabalho transacional já em andamento exige acompanhamento até commit/rollback, não prometer cancelamento retroativo.
7. Rollback futuro: recuperar imagem anterior pelo workflow homologado, preservando env/mounts/dados. Rollback de imagem **não restaura registros já removidos**: backup/restauração validada é pré-condição da ativação destrutiva. Nunca usar prune/limpeza como rollback.

## Backups — situação em 30/10/2026

Os dois backups antigos foram copiados como TAR para `D:\OptimusPromo-Backups\2026-10-29-PreLimpeza`, com SHA-256 e inventário por arquivo conferidos. O proprietário aceitou expressamente o risco residual de não haver teste integral de restauração e autorizou a remoção exata dos dois diretórios antigos da VPS. A remoção já foi concluída em missão separada; não integra esta candidata. Os TARs externos permanecem protegidos. A ativação destrutiva do Auto-Clean ainda requer recuperação atual utilizável e autorização separada.

## Docker logs — proposta separada, não aplicada

Propor para revisão do Compose atual, exclusivamente no serviço aprovado:

```yaml
logging:
  driver: json-file
  options:
    max-size: "20m"
    max-file: "5"
```

É sugestão de teto aproximado de 100 MB por container configurado, não medição dos logs atuais nem limite global. Escolha de retenção exige decisão humana; não muda `/data`, PostgreSQL ou mounts. Aplicação requer plano separado porque opções não são retroativas e podem exigir recriação do container. Não rotacionar/truncar arquivos JSON ativos manualmente; preservar evidência e imagem de rollback. Nenhum serviço Docker foi alterado.

## Limites para decisão

Wiring corrigido e validação segura são candidatos à homologação. A correção integral do GC permanece parcial, e desempenho no banco/carga comercial real não foi medido. A autorização noturna de 30/10/2026 permite uma publicação única somente em modo não destrutivo após todos os gates; não permite `execute` nem remoção produtiva. Os testes usam fixtures e o CI usa runner GitHub-hosted com PostgreSQL descartável, sem secrets de produção.
