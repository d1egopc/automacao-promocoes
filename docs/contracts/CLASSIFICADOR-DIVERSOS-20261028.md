# Classificador V3 — refinamento focal de 28/10/2026

Tarefa: auditar históricos Optimus Clone/OP Geral e reproduzir natureza/categoria antes do patch.
Área: classificador compartilhado e apresentação comprovadamente incoerente.
Risco: 3, decisão de categoria em hot path; sem nova elegibilidade ou taxonomia.
Reversibilidade: candidata isolada, descartável; nenhuma publicação nesta missão.
Contratos tocados: Marketplaces/V3, fidelidade Ingress Radar/TeleRadar, Multi-tenancy, Performance e Histórico.
Persistência/dados: leitura histórica limitada e READ ONLY, sem reprocessamento/edição produtiva.
Performance: sem nova rede, I/O, query, listener, timer ou lookup por produto.
Superfícies: regras de identidade/finalidade existentes; regressões, replay e CI-only.
Capacidade mínima segura: revisão transversal com causa reproduzida e negativos.
Justificativa: equipamento e consumível pesqueiros podem perder categoria no fallback; roupa e lâmina ambíguas exigem conservação.
Condição para escalar: natureza contraditória, necessidade de mudar destinos, adquirir contexto externo ou persistência.
Modo inicial: somente leitura até causa reproduzida.
Rollback: descartar candidata, mantendo main/runtime c9f81baeeaf966fc581b8310d70c0f54ed90fa46.
Arquivos/módulos permitidos: classificador, Copy apenas se comprovado, fixtures/testes, contrato desta tarefa e CI-only/registro aditivo Guardião.
Áreas congeladas: sensor Garimpei ativo (até 29/10 21h08 BRT conforme proprietário), sessões/conexões, filtros Radar/TeleRadar, RIO, Mensageiro, créditos, workspaces, destinos, preços, cupons, URLs, /data e PostgreSQL.
Decisão humana necessária: somente para futura publicação após a observação; desenvolvimento, commit seletivo e CI isolado autorizados nesta missão. Sem merge, deploy ou restart.

Base verificada: origin/main remoto=c9f81bae; imagem ativa 3c07f90a do mesmo release. Pasta oficial lida e preservada: Git status retorna erro de worktree nesta sessão; não se afirma limpa nem se substituem documentos. A candidata é uma worktree do repositório já reconciliado, criada por necessidade explícita de isolamento sobre o SHA publicado, não uma cópia histórica promovida implicitamente.

## Evidência e primeira regra

Optimus Clone é um grupo WhatsApp, não a tela Clonador. O proprietário corrigiu as datas de Rapala/Frog/graxa: são anteriores a 28/10. Exportação chat(5).txt não está disponível localmente; título/data de Shadow Rap são evidência fornecida pelo proprietário, não uma leitura fictícia do arquivo. Consultas PG são somente leitura, tenant-scoped, janela de data, limites e timeouts; não são pesquisa Telegram nem navegação dos shortlinks. Horário de envio no WhatsApp não é horário de finalização PostgreSQL.

| Caso | Evidência | Reprodução na base c9f81bae | Candidata |
| --- | --- | --- | --- |
| Vara Saint Plus Tucuna Pro 581bc 1,73m 7-17lbs | history101200, offer170724, destino Op Geral Tetes em 28/10 | Nenhuma evidência explícita e nenhum scorer reconhece vara+comprimento+libragem; fallback Diversos | Pesca e Camping |
| Ração Pesca Acquamil Furadinha Pesqueiro Tambaqui | history99242, offer169502 em 28/10 | Scorer Pet vence com sinal forte ração, 80 pontos; registro Universal mantém categoria_declarada_valida Pet, sem prova superior de finalidade | Pesca e Camping por ração+pesca+forma de isca |
| Camisa de pesca UV50 com touca/tube | history100324, offer170192 em 28/10 | Regra de vestuário de pesca já retorna Diversos por público ausente | Diversos, preservado |
| Faca Tática Pescador Aço Inox | history99866, offer170012 em 28/10 | Nenhuma finalidade suficiente; fallback Diversos | Diversos, preservado |
| Facão Grande Inox / Facão Militar | history100071/100558 em 28/10 | Diversos; tamanho/bainha/militar não provam pesca ou camping | Diversos, preservado |
| Isca Rapala Shadow Rap SDR-11 | relato exportação 11/10 20:21:15 | Diversos no título abreviado reproduzido; não exige a palavra artificial | Pesca por tipo isca + identidade dedicada Rapala, nunca Rapala isolada |
| Isca Rapala X-rap / Isca para Corrico Rapala | history79756/79817 em 22/10 | Diversos; ausência de artificial/frog/jig deixa a identidade e técnica de corrico sem evidência | Pesca e Camping |
| Frog Sapo anti enrosco | history7106/85404 e relato exportação | Histórico Diversos, mas base atual já retorna Pesca e Camping | Preservado; não é regressão atual |
| Graxa/óleo para carretilhas e molinetes | history3123/81933/85475 e relato exportação | Histórico Diversos, mas base atual já retorna Pesca e Camping | Preservado; não é regressão atual |

A primeira regra executável foi reproduzida no classificador público da base e no scorer, sem alterar fontes reais. Os logs persistidos provam as decisões Universal acima; não se declara um trace runtime histórico por função que não foi registrado. Adapter ML já chama o classificador compartilhado; seu código fica intacto.

## Correção e proteção

Um único arquivo runtime muda: o classificador compartilhado. Acrescenta evidência antes do fallback: vara com comprimento e libragem; ração como isca com pesca e furadinha/furada/anzol/cevadeira; isca com identidade dedicada, técnica de pesca ou comprimento+peso. A marca não decide sozinha e não há marketplace, workspace, grupo ou título completo como regra. Linhas de nutrição, cozinha, controle de pragas, ferramentas, acessórios e vestuário têm controles negativos. Conflito isca+furadeira usa o gate conservador existente e fica Diversos. Grupo de origem não acrescenta afinidade ou gênero.

Sem nova categoria ou afinidade; sem alterar destinos, taxonomia, filtros, resolvers, preço, cupom, URLs ou importadores. Camisa sem público e faca/facão ambíguos não são forçados a Pesca. Roupa com público explícito preserva a categoria de vestuário. Ração de aquário/criação/pesqueiro sem finalidade de isca preserva Pet.

Copy não precisa de novo código: já reutiliza avaliarEvidenciaCategoria. Os dois casos de 28/10 comprovados passam à família pesca_camping, sem frases Pet/digital, e os objetos comerciais permanecem idênticos. Nenhuma frase factual de faca/camisa é inventada.

## Validação

- 59 testes focais: reprodução da base, 12 títulos reais/referenciados, negativos, contradição conservadora, seis marketplaces e dois workspaces com IDs comerciais coincidentes; destino de pesca não aceita os negativos e as ofertas recuperadas não contaminam Pet/cozinha/ferramentas/moda.
- 102 testes V3/evidência oficial/Copy focal/scorer legado aprovados; parity inclui 2500 combinações determinísticas.
- 20 testes de proteção Radar/TeleRadar, sensor e Shopee aprovados; quatro arquivos de suites Copy passaram após apontar TMP/TEMP ao diretório descartável autorizado. Primeira tentativa teve EPERM de rename em fixture Windows; assertion não foi alterada.
- Replay V3 de 147 casos, hash541114b883c4397d20a9266ae479380ddf79464e3e5a770c197a3a11186760d2: zero mudanças/erros. Coorte bruta antiga de 2000 não disponível; não foi reexecutada.
- Replay focal separado: 53 casos (7 reais28,5 históricos,41 controles), seis alterações esperadas: duas de 28/10, três iscas históricas ainda reproduzíveis, um conflito sintético conservador. Frog/graxa não contam como novas correções. Nenhum reenvio ou reprocessamento comercial.
- Benchmark sintético inicial Node20: média176,484→176,478us/op; p95 186,310→184,706us/op, sem I/O/rede/queries. Não é prova de performance produtiva; CI Linux/Node24 deve gerar seu próprio resultado.
- Dívida preexistente: tests/radar-enriquecimento-conservador.test.js falha em base e candidata na deduplicação de URL AliExpress (duas entradas versus uma). Mantido obrigatoriamente no Guardião com comparação de baseline existente, sem modificar teste ou parser. BASELINE_DEBT não significa PASS do teste. Não corrigir lateralmente nem esconder como regressão da candidata.
- Guardião recebeu somente dois testes aditivos, sem alteração de sua política de bloqueio/comparação. CI-only de branch fechada executa testes/replays e confirma diff vazio das áreas congeladas, incluindo sensor/Shopee/deploy. Não há autorização de merge/deploy/restart.

SHA final, CI remoto e relatório de gates serão entregues com evidência externa após o commit seletivo, sem reescrever este documento só para incluir seu próprio hash.
