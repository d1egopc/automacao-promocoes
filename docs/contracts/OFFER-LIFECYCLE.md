# Offer Lifecycle

## Principio

Oferta comercial e um fato com proveniencia. Nao complete campos ausentes por aparencia, conveniencia ou calculo implicito.

O contrato detalhado em `docs/arquitetura-fidelidade-comercial-v1.md` permanece fonte complementar. Codigo executavel e testes prevalecem em caso de divergencia.

## Ciclo

1. Captura por Radar, Teleradar, Clonador, farejador, Manual V2 ou extensao.
2. Normalizacao por adapter/importer sem perder proveniencia.
3. Validacao de identidade, links, afiliacao e fidelidade comercial.
4. Decisao de elegibilidade, prioridade e cadencia.
5. Persistencia na fila e, quando aplicavel, VIVA/Fila V2.
6. Dispatch por destino usando o template configurado no destino.
7. Confirmacao, parcial, falha ou ausencia de oportunidade.
8. Projecao em Historico e, por contratos proprios, Achados, Vitrine e Social.
9. Retencao e Auto Clean sem apagar referencias ainda necessarias.

## Campos comerciais

Preserve, quando existirem e forem comprovados:

- identidade canonica e marketplace;
- titulo e imagem com origem;
- preco atual, preco anterior e condicao do preco;
- desconto apenas com proveniencia `marketplace` ou `manual`;
- cupom/beneficio e tipo de evidencia;
- link de produto, afiliado, resgate, PC/canonico, app/moda e tracking em papeis distintos;
- workspace/cliente, origem de captura e metadados de afiliacao;
- categorias, destinos e dados necessarios ao template.

## Invariantes

- Preco anterior + atual nao criam `% OFF` automaticamente.
- Edicao manual passa a ser a autoridade do campo editado; nao recapture para sobrescreve-la.
- Nao aceite link original quando o contrato exige afiliado/prova.
- Nao use titulo como identidade canonica.
- Fontes comprovaveis divergentes devem falhar fechadas.
- `+ Lista`, Salvar e Enviar agora sao intencoes diferentes.
- Captura direta para Lista nao cria Oferta normal nem entra no Auto Dispatcher.
- Mensagem final continua sendo renderizada pelo template do destino.

## Mudanca segura

Qualquer adicao de campo deve mapear produtor, transporte, persistencia, consumidores, compatibilidade legada e teste de round-trip. Alteracao de semantica comercial exige decisao humana.
