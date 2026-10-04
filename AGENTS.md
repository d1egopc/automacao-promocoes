# Optimus Promo - Maintenance Manager

Preserve o que ja funciona. Melhore somente com prova. Use a menor capacidade de raciocinio segura para a tarefa.

## Fonte da verdade

- Trate `main` como branch canonica somente quando ela estiver reconciliada com producao.
- Backend oficial: `main`, SHA reconciliado `a8492586a86a392e143515a9113013f2f7272c24`.
- Frontend oficial: repositorio `optimuspromo-frontend`, `main`, SHA/Production reconciliado `c6c79d2d7540df3efdfb702ce117ee00fd9a82a0`.
- Extensao oficial: tag `extension/v0.2.0`, tree `d724a8620a1f0ecb53601ae71d76eaa671a321b0`; a release permanece draft ate autorizacao humana.
- Compare codigo/runtime atual, testes, configuracao ativa e documentacao. Nao resolva contradicoes silenciosamente.
- Coloque SHAs ativos, containers, flags, hashes e metricas temporais em [EVIDENCE-REGISTER.md](docs/contracts/EVIDENCE-REGISTER.md), nunca como contrato eterno.

## Leitura obrigatoria

Leia [PLATFORM-TOPOLOGY.md](docs/contracts/PLATFORM-TOPOLOGY.md), [PRODUCTION-DEPLOYMENT.md](docs/contracts/PRODUCTION-DEPLOYMENT.md) e os contratos da area tocada antes de alterar qualquer arquivo.

## Classificacao obrigatoria

Antes de trabalhar, registre:

```text
Tarefa:
Area:
Risco:
Reversibilidade:
Contratos tocados:
Persistencia/dados:
Performance:
Superficies:
Capacidade minima segura:
Justificativa:
Condicao para escalar:
Modo inicial:
Rollback:
Arquivos/modulos permitidos:
Areas congeladas:
Decisao humana necessaria? sim/nao
```

## Risco e capacidade

- Nivel 1, baixo risco: texto, CSS isolado, leitura simples, relatorio. Use capacidade eficiente, como Luna com esforco baixo/medio.
- Nivel 2, moderado: patch pequeno reversivel, commit/gate, deploy homologado. Use capacidade intermediaria, como Sol Medio.
- Nivel 3, alto: backend + frontend, contrato comercial, links, cupons, marketplace, read model, performance, multiworkspace ou concorrencia. Use Sol Alto.
- Nivel 4, critico: perda/corrupcao de dados, schema/migration, seguranca, persistencia interprocesso, incidente sem rollback claro. Use a maior capacidade disponivel e comece obrigatoriamente em READ-ONLY.
- Use a menor capacidade segura. Nao use capacidade alta apenas por medo nem capacidade baixa contra o risco.
- Escale ao encontrar persistencia, schema, concorrencia, seguranca, multiworkspace, contrato/link comercial, perda de dados, rollback incerto, hot path ou conflito de fontes.
- Desescale quando a causa estiver provada e a etapa restante for patch trivial, commit, gate ou deploy ja homologado.

## Decisao humana

Pare e solicite decisao para mudanca irreversivel, exclusao de dados, schema/migration, contrato comercial, definicao de cupom ou link, elegibilidade, retencao, rollback incerto, duas interpretacoes validas ou alteracao administrativa externa importante.

## Mudanca

- Trabalhe uma frente por vez.
- Nao corrija problema lateral sem autorizacao.
- Fluxo: problema -> auditoria READ-ONLY -> causa comprovada -> patch minimo -> testes -> commit seletivo -> gate -> deploy controlado -> prova real -> congelar.
- Nao altere comportamento homologado sem nomear o contrato e obter autorizacao.
- Performance e isolamento multi-tenant sao contratos.

## Git e producao

- Confirme repositorio, branch, worktree, base e status antes de editar.
- Use `git add` seletivo. Nunca use `git add .` ou `git add -A`.
- Informe SHA completo e rollback conhecido.
- Nunca chame gate local de "CI remoto verde".
- Producao backend e somente a Hostinger VPS. Railway esta retirado.
- Nunca use `docker compose down`, remova volumes, recrie PostgreSQL ou toque `/data` sem plano explicito.
- Nao altere env/flags durante deploy fora do escopo aprovado.
- Sempre registre baseline e prove saude depois do deploy.
- Frontend: Preview `READY` -> gate humano -> promover o mesmo SHA -> provar Production 200.
- Extensao: distribua somente artefato versionado, verificado por hash e aprovado por humano.

## Areas congeladas

Considere Turbo, Historico, VIVA/recovery, Solenoide, Auto Clean, fila operacional e contratos comerciais congelados quando nao forem o escopo explicitamente autorizado.

## Indice de contratos

- [Topologia](docs/contracts/PLATFORM-TOPOLOGY.md)
- [Producao e deploy](docs/contracts/PRODUCTION-DEPLOYMENT.md)
- [Oferta](docs/contracts/OFFER-LIFECYCLE.md)
- [Links e midia](docs/contracts/LINKS-MEDIA.md)
- [Marketplaces](docs/contracts/MARKETPLACES.md)
- [Cupons](docs/contracts/COUPONS.md)
- [Ingressos](docs/contracts/INGRESS-RADAR-CLONADOR.md)
- [Extensao](docs/contracts/EXTENSION.md)
- [Destinos e fila](docs/contracts/DESTINATIONS-QUEUE.md)
- [Historico](docs/contracts/HISTORY.md)
- [Achados e Vitrine](docs/contracts/ACHADOS-VITRINE.md)
- [Auto Clean](docs/contracts/AUTO-CLEAN.md)
- [Mensageiro](docs/contracts/MESSENGER.md)
- [Social](docs/contracts/SOCIAL.md)
- [Multi-tenancy](docs/contracts/MULTITENANCY.md)
- [Performance](docs/contracts/PERFORMANCE.md)
- [Roteamento de capacidade](docs/contracts/MODEL-ROUTING.md)
- [Evidencias temporais](docs/contracts/EVIDENCE-REGISTER.md)
