# Risk and Model Routing

## Politica

Escolha capacidade por risco e reversibilidade, nao por tamanho aparente do prompt. Nomes de modelos mudam; as classes abaixo sao permanentes.

| Nivel | Perfil | Exemplos | Capacidade atual de referencia |
| --- | --- | --- | --- |
| 1 | Baixo risco, local, reversivel | texto, CSS isolado, leitura, relatorio, teste conhecido | Luna; esforco baixo/medio |
| 2 | Moderado, patch pequeno | endpoint conhecido, commit/gate, deploy homologado | Sol Medio |
| 3 | Alto, transversal | backend + frontend, oferta, marketplace, links, cupons, read model, performance, multiworkspace | Sol Alto |
| 4 | Critico | perda/corrupcao, schema, seguranca, persistencia interprocesso, incidente sem rollback | maior capacidade disponivel; READ-ONLY inicial |

Use a menor capacidade segura. Capacidade alta sem necessidade desperdiça recursos; capacidade baixa contra o risco aumenta chance de regressao.

## Escalonamento automatico

Pare e suba de nivel ao encontrar:

- persistencia ou schema/migration;
- concorrencia, worker, lock ou crash recovery;
- seguranca ou multiworkspace;
- contrato/link comercial;
- risco de perda de dados;
- rollback incerto;
- performance em hot path;
- conflito entre fonte declarada e runtime.

## Desescalonamento

Depois de causa comprovada, patch trivial e contratos delimitados, commit/gate/deploy homologado podem usar capacidade menor. Desescalar nao remove os gates.

## Decisao humana

Exija humano para irreversibilidade, exclusao de dados, schema, contrato comercial, definicao de cupom/link/elegibilidade/retencao, rollback incerto, interpretacoes validas concorrentes ou configuracao administrativa externa relevante.

## Cabecalho obrigatorio

Use o bloco de classificacao de `AGENTS.md` antes de qualquer trabalho. Se a classificacao mudar durante a auditoria, atualize-a antes de editar.
