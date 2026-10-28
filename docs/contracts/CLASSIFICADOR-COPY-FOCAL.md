# Classificador V3 e Copy — correção focal de 27/10/2026

Tarefa: corrigir precedência de natureza e apresentação; área classificação/Copy; risco moderado, reversível por commit isolado. Base f800da32e987c740854a9de02d5bcc93d7f149e9, confirmada na main e no deploy 40619062434 SUCCESS. Sem deploy nesta missão. Nenhuma persistência produtiva ou consulta nova no hot path. Escalar somente diante de conflito factual, regressão ou necessidade de alterar motores. Rollback: descartar/reverter a candidata antes de publicação. Superfícies permitidas: classificador existente, helper local de Copy, regressões e CI/Guardião. Congelados: importadores, RIO, preços, cupons, links, crédito, afiliação, destinos e template universal.

## Evidência e primeira quebra

- Alicate para fabricação/reparo de joias: o classificador da base retorna Diversos; falta combinação contextual de natureza + finalidade. Adicionada a mesma regra de evidência existente, com exclusão de unha/cutícula/manicure/pedicure. Não é regra por marca.
- Kit Parafusadeira de Impacto 48 Peças USB: a base retorna Periféricos, 109 pontos, sinal forte USB. A correção de natureza para parafusadeira dependia de categoria oficial. A natureza explícita agora é independente desse atributo secundário, preservando brinquedos e conflito de produtos distintos.
- Al Noble Ammer 100ml: a base retorna Diversos. A fonte oficial https://lattafa.com/product/al-noble-ameer/ comprova que **Al Noble Ameer** é fragrância de 100ml. O shortlink informado não pôde ser consultado; não há prova de que a grafia Ammer seja a mesma identidade. O título sem tipo permanece Diversos; títulos com perfume explícito passam. Volume isolado não é evidência de perfumaria. Pendente confirmar título factual ou identidade do anúncio, sem inventar alias.
- Os três resultados acima são reproduções locais dos títulos fornecidos, não rastreamento de seus eventos persistidos. O coletor HTTPS oficial em memória encontrou ENOTFOUND neste ambiente. Não foi demonstrada falha de autorização. Nenhuma sonda iniciada; nenhum SSH usado para substituir Telemetria. Não é possível afirmar onde o importador perdeu informação sem o evento correspondente.

## Copy e distribuição

As frases relatadas existem no gerador local e no banco associativo. A Copy C3 pública também reutiliza categoriaOficialCopyLocalV2 e produtoContextualCopyLocalV2. O helper passa a reutilizar avaliarEvidenciaCategoria, sem alterar o objeto comercial, e reconhece Alicate/Parafusadeira/Brinquedo na apresentação. A frase artificial “Esse preço combina com…” foi removida da construção. Baixa confiança explícita sem evidência superior utiliza família oportunidade.

A classificação corrigida torna Ferramentas a categoria candidata para os dois primeiros produtos, em vez de Diversos/Periféricos. A compatibilidade continua sendo decidida pelo distribuidor existente; nenhuma elegibilidade, destino, rota multicategoria ou contrato de envio foi modificado. Não se afirma entrega ou ACK.

## Homologação e limites

Regressões permanentes: tests/classificador-copy-focal.test.cjs cobre os relatos reproduzíveis, equivalentes sem marca, mouse/hub USB, cutícula, brinquedos, conflitos, volume sem tipo, Copy C3 e neutralidade. Guardião inclui esse teste no gate de classificação. CI-only Ubuntu/Node24 preserva motores por diff e executa replay/benchmark.

Replay disponível da V3: 147 casos, hash 541114b883c4397d20a9266ae479380ddf79464e3e5a770c197a3a11186760d2; zero mudanças e zero erros na coorte antiga. As novas correções são fixtures separadas. O conjunto bruto original de 2.000 ofertas não está disponível: não declarar reexecução nem novos totais produtivos. Benchmark local Node20: média 176,82 → 177,73 microssegundos/operação (+0,52%); zero I/O síncrono, rede ou consultas PostgreSQL no classificador. Medição sintética, não performance produtiva.

Falhas locais ambientais: teste C3 público teve EPERM em rename de fixture no sandbox; passou no contexto autorizado. Teste documental Copy V2 exigiu OPTIMUS_FRONTEND_ROOT apontando para o checkout oficial somente leitura; passou. Não foram alterados para mascarar falhas.

Publicação e eventual resolução do anúncio Ammer dependem de avaliação posterior. Nenhuma alteração de produção autorizada nesta missão.
