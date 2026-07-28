# Arquitetura Fidelidade Comercial e Visual Optimus V1

Status: arquitetura aprovada em aproximadamente 95%.

Este documento consolida a arquitetura alvo para a Fase 1 e incorpora os ajustes obrigatorios antes de qualquer implementacao funcional.

## Principio Central

A aparencia pode ser limpa e padronizada.

A verdade comercial nao pode ser alterada.

O Optimus deve preservar a mensagem original, confirmar identidade do produto, converter apenas o link correto do produto e publicar somente quando a fidelidade comercial for comprovada ou quando a politica explicita permitir publicacao com avisos.

## Fluxo Alvo

1. Oferta original do grupo: texto, midia e links.
2. Captura Radar.
3. Mensagem Original imutavel.
4. Espelho Bruto imutavel.
5. Leitor Comercial e de Midia.
6. Classificador de Links.
7. Importador do mesmo produto.
8. Conversor de afiliado.
9. Contrato Comercial Canonico.
10. Validacao de Fidelidade Comercial.
11. Normalizador de Apresentacao.
12. Template Padrao ou Personalizado.
13. Distributor.
14. Executor.
15. Publicacao final.

## Camada Obrigatoria de Validacao de Fidelidade Comercial

Inserir uma camada obrigatoria entre o Contrato Comercial Canonico e o Normalizador de Apresentacao.

Responsabilidades:

- decidir se a oferta pode ser publicada;
- decidir se a oferta deve ser retida;
- registrar conflitos, avisos e campos ausentes;
- impedir que o Normalizador de Apresentacao receba uma oferta comercialmente invalida como se fosse valida;
- impedir publicacao quando houver produto divergente, marketplace divergente, preco conflitante, link de produto nao confirmado, cupom suspeito usado como codigo ou contrato critico incompleto.

Essa camada nao deve limpar texto, renderizar template nem enviar mensagens. Ela apenas valida fidelidade comercial.

## Contrato Comercial Canonico

Estrutura minima:

```js
{
  versaoContrato: "optimus_comercial_v1",

  rastreamento: {
    ofertaId,
    mensagemId,
    clienteId,
    origemTipo,
    origemNome,
    capturadaEm
  },

  bruto: {
    textoOriginal,
    linksOriginais,
    possuiMidiaOriginal
  },

  produto: {
    tituloOriginal,
    tituloLimpo,
    tituloOficial,
    marketplaceOriginal,
    marketplaceConfirmado,
    produtoIdOriginal,
    produtoIdConfirmado,
    urlProdutoOriginal,
    identidadeStatus
  },

  preco: {
    precoDe,
    precoPor,
    moeda,
    condicaoPreco,
    pix,
    parcelamento,
    quantidadeParcelas,
    valorParcela,
    origemPreco,
    status
  },

  cupom: {
    codigo,
    tipo,
    descontoTexto,
    instrucao,
    origem,
    status
  },

  links: {
    originais,
    produtoOriginal,
    produtoAfiliado,
    resgateOriginal,
    resgateFinal,
    desconhecidos,
    status
  },

  imagem: {
    original,
    thumbnailOriginal,
    oficial,
    final,
    origem,
    status
  },

  apresentacao: {
    frete,
    cashback,
    avaliacao,
    observacaoComercial
  },

  qualidadeComercial: {
    score,
    aprovado,
    motivos
  },

  validacao: {
    fidelidadeStatus,
    conflitos,
    avisos,
    camposAusentes,
    podePublicar
  },

  origemDosCampos
}
```

## qualidadeComercial

Adicionar ao contrato o objeto `qualidadeComercial`.

Campos:

- `score`: nota numerica de qualidade/fidelidade comercial.
- `aprovado`: booleano indicando se a oferta passou pela validacao.
- `motivos`: lista de motivos usados para auditoria, retencao e futuras decisoes automaticas.

Esse objeto facilita leitura operacional sem substituir `validacao`. A decisao final continua registrada em `validacao.fidelidadeStatus` e `validacao.podePublicar`.

## Imutabilidade da Origem

Formalizar que `Mensagem Original` e `Espelho Bruto` sao somente leitura.

Regras:

- a mensagem original nunca pode ser reescrita;
- o espelho bruto nunca pode ser sobrescrito pelo importador;
- o Contrato Comercial Canonico apenas enriquece dados;
- nenhum enriquecimento pode apagar informacao explicita da origem;
- conflitos devem ser registrados, nao ocultados;
- valores originais devem permanecer disponiveis para auditoria.

## Historico de Origem e Alteracoes

Para todos os campos criticos, preservar historico de origem e alteracoes.

Campos criticos:

- produto;
- marketplace;
- preco;
- cupom;
- links;
- imagem.

Cada campo critico deve permitir rastrear:

```js
{
  valor,
  origem,
  confianca,
  extraidoPor,
  alteradoPor,
  motivoAlteracao,
  historico
}
```

Cada item de `historico` deve registrar:

```js
{
  valorAnterior,
  valorNovo,
  origemAnterior,
  origemNova,
  alteradoPor,
  motivoAlteracao,
  criadoEm
}
```

Nenhum campo critico pode ser sobrescrito silenciosamente.

## Estrategia de Compatibilidade

O contrato canonico deve ser criado de forma paralela aos campos legados.

Campos legados devem continuar existindo:

- `titulo`;
- `preco`;
- `precoAtual`;
- `precoOriginal`;
- `cupom`;
- `linkAfiliado`;
- `imagem`;
- `marketplace`.

Durante as primeiras fases, o contrato deve viver em `metadata.contratoComercialCanonico` ou estrutura equivalente, sem remover campos atuais e sem alterar comportamento comercial.

## Fase 1 Sem Mudanca de Comportamento

A Fase 1 pode ser feita sem alterar comportamento comercial.

Permitido na Fase 1:

- criar rastreamento unico por oferta;
- criar logs estruturados;
- gerar snapshots por camada;
- registrar origem dos campos;
- registrar status de imagem;
- registrar status de links;
- registrar status de identidade;
- registrar motivo de retencao;
- registrar diagnostico de queda para texto.

Nao permitido na Fase 1:

- alterar template;
- alterar importador;
- alterar decisao de publicacao;
- alterar Distributor;
- alterar Executor;
- reter ofertas novas por regra ainda nao ativa;
- corrigir dados automaticamente.

## Ordem de Implementacao

1. Observabilidade e rastreamento.
2. Contrato Canonico compativel.
3. Fidelidade de links.
4. Fidelidade de produto e marketplace.
5. Fidelidade de preco e cupom.
6. Fidelidade de imagem.
7. Apresentacao e templates.
8. Vazao operacional.

Cada fase deve parar para aprovacao antes da proxima.
