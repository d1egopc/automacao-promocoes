# Links and Media

## Papeis de link

Nao trate URLs diferentes como intercambiaveis:

- link de produto/original: identifica a pagina e o produto;
- canonical/permalink/PC: identidade ou pagina canonica quando o marketplace fornece;
- link afiliado/final: destino comercial atribuido ao workspace;
- link de resgate: ativa cupom/beneficio e pode nao ser pagina do produto;
- app/moda link: papel especifico do marketplace/app;
- shortlink/redirect: precisa ser resolvido pelo contrato oficial antes de provar identidade;
- tracking/publisher/tag: evidencia de atribuicao, nao substituto isolado de identidade.

Nao fabrique identidade a partir de link afiliado, tracking, marketplace ou aparencia da URL. Quando URL original, `productId` e prova apontarem para produtos diferentes, rejeite.

## Afiliacao

- Reutilize os conversores e validadores oficiais; nao crie uma segunda logica.
- Provas assinadas devem permanecer vinculadas a workspace, produto e URLs compativeis.
- Registro legado sem evidencia suficiente permanece bloqueado.
- Nunca afrouxe o gate para fazer um item antigo passar.

## Titulo e imagem

- Preserve origem e fallback comprovado.
- Fallback de texto Radar nao equivale a dado oficial do marketplace.
- Imagem ausente nao deve inventar motivo `sem_imagem` sem causa persistida.
- Nao adicione lookup remoto, recaptura ou download no hot path de leitura.
- UI deve preservar proporcao, preferindo `object-fit: contain` quando a tarefa e apenas visual.

## Verificacao

- Links comerciais: `modules/radar/links-comerciais.js`, `modules/engine/link-role.service.js`, `modules/engine/preparacao-links.service.js`.
- Identidade Manual V2: `modules/manual-v2/ofertas-v2-identidade.js`.
- Captura/extensao: `modules/manual-v2/manual-capture.service.js` e `optimus-capture/adapters`.
- Midia Radar: `modules/radar/whatsapp-media-materializer.js`.

Alterar o papel de qualquer link e mudanca de contrato comercial e requer decisao humana.

## Descoberta administrativa V2.3

- A aba Links usa `/admin/links/resolvers/inspect`, protegida pelo middleware oficial Admin Master, para inspecionar sem escrita. Reutiliza a estratégia administrativa explícita do resolvedor universal (`adminValidation` + `resolucaoEmCamadas`), com DNS fixado e prazo compartilhado de 4,5 s. Não executa JavaScript, API de conversão, captura, preparação comercial ou envio. A integração pública de destino Promozone já existente pode ser consultada exclusivamente no endpoint fixo oficial do código; seu retorno não é prova de produto nem de afiliação.
- O orçamento compartilhado admite até cinco redirects HTTP, quatro camadas HTML e nove requisições no total (incluindo API). Mantém 1 MiB por documento; somente páginas HTTPS oficiais Amazon com rota de produto validada admitem 2 MiB. O teto agregado é 4 MiB, incluindo corpos dos redirects. Nenhum desses limites ou camadas adicionais é habilitado nos consumidores comerciais existentes por padrão.
- Respostas distinguem `resolvido` (destino com prova factual vinculada ao produto na inspeção real), `investigacao_pendente` (rede/HTTP/HTML/identidade insuficiente) e `bloqueado_seguranca`. Host conhecido, HTTP 200, URL com ID, candidato e afiliação são estados distintos. Um shortlink oficial intermediário não comprova um produto.
- A estratégia continua além de shortlinks oficiais e reaproveita os parsers de identidade ML/MLBU, o CTA estrutural `show_product` (transporte, nunca prova isolada), o parser JSON-LD existente e os contratos factuais/ASIN Amazon. Amazon exige título principal factual, ASIN e canonical alinhados quando não há JSON-LD vinculante. Ambiguidade, IDs divergentes, CAPTCHA ou autenticação não geram comprovação. Nenhuma identidade confirma atribuição afiliada; `afiliacaoConfirmada` e `prontoComercial` permanecem falsos.
- `/investigations` reavalia a entrada e salva somente metadados sanitizados no registry existente, `ativo=false`, `estado=investigacao_pendente`, vinculados ao operador autenticado. Não armazena URL original, query, HTML, headers, exceção livre ou credencial. Outros workspaces não listam, leem nem excluem essa investigação; ela não integra a allowlist operacional.
- Rascunhos permanecem inativos. A autorização explícita exige outro endereço do mesmo host/prefixo/mode, revalidação atual dos dois exemplos e método/marketplace compatíveis com produto identificável. PATCH não pode ativar rascunho ou investigação. Domínios oficiais, inclusive meli.la, não são cadastrados como novos padrões.
- Testes e prévia administrativa não geram oferta ou link afiliado. O resolvedor universal mantém seu comportamento operacional anterior sem o opt-in administrativo; não há mudança em fila, distribuição ou conversores. OneLink Magalu com HTTP 403 continua pendente, sem contorno de proteção. Novo aprendizado exige dois exemplos atuais compatíveis com prova suficiente; inspeção não ativa famílias nem altera a allowlist produtiva.
