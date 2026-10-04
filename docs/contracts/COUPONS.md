# Coupons

## Evidencia

Tipos observados no sistema incluem `real`, `confirmado`, `validado`, `texto_radar`, `texto_clonador`, `provavel`, beneficios sem codigo, percentuais/valores e resgate de marketplace.

Nao promova:

- `provavel` apenas por conter texto parecido;
- sentinelas `COPIADO`, `APPLIED` ou `SEM CUPOM`;
- codigo tecnico sem contexto de cupom;
- evidencia suspeita ou monetariamente incompatível;
- beneficio sem codigo para um codigo inventado.

## Cupom Turbo

- `texto_radar` ou `texto_clonador` confiavel e com cupom valido: prioridade final minima `95`.
- `real`, `confirmado` ou `validado`: prioridade final minima `110`.
- Preserve prioridade maior: `Math.max(prioridadeDecisaoV2, prioridadeMinimaCupom)`.
- A Engine V2 nao pode apagar o piso aplicado pelo normalizador.
- Fast Lane confiavel continua `real_detectado` conforme o contrato atual.
- Nao altere TTL, scheduler, fairness ou Solenoide para implementar Turbo.

Fontes: normalizacao em `index.js`, preservacao pos-V2 em `utils/fila-ofertas.js`, cadencia em `modules/engine/cadencia.service.js` e testes `tests/cupom-turbo-normalizacao.test.js`.

## Desconto

`descontoPercentual` somente pode ser exibido quando `descontoPercentualOrigem` for `marketplace` ou `manual`. Nao calcule `% OFF` apenas de preco anterior e atual. Registro legado sem origem nao exibe percentual.

## Alteracao

Redefinir o que conta como cupom, beneficio ou desconto e decisao comercial humana. Comece em READ-ONLY e use casos reais mais controles negativos.
