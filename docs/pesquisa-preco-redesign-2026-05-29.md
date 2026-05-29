# Redesign Pesquisa de Preço LIE — Diagnóstico + Opções

**Data:** 2026-05-29
**Status:** documento de decisão — não implementar até alinhamento

---

## 1. Diagnóstico do problema atual

### Sintoma observado
Itens muito diferentes (carrinho de pipoca R$950, kit lanche R$13, marmitex R$22, alimentação completa R$51) foram agrupados pela IA sob o mesmo CATSER genérico "Fornecimento de Refeições". A pesquisa de preço então traz cotações irrelevantes e a cesta fica vazia ou enviesada.

### Causa raiz
**CATMAT/CATSER é um código de FAMÍLIA, não de OBJETO.** O catálogo SERPRO tem ~15 mil entradas pra um universo de milhões de itens reais. Confiar no código como ponto de verdade para "isso é o mesmo item" é metodologicamente errado, especialmente em serviços.

### Por que as 5 camadas que empilhei não resolveram
- **Padronizar Nomenclatura (IA)** — agrupa itens diferentes sob o mesmo CATSER (piorou o problema)
- **Filtro de embalagem** — não funciona em serviços (sem capacidade)
- **Filtro de faixa de preço** — rejeita carrinho de pipoca R$950 vs marmitex R$22 mas não distingue semanticamente
- **Busca ativa CATMAT** — encontra o código GENÉRICO mais provável, perpetuando o problema
- **Validador de unidade** — questão técnica menor, não muda a equação

Todas confiam no CATMAT como pivot. Nenhuma resolve o pivot estar errado.

---

## 2. Achados da pesquisa (resumo executivo)

### A. Base legal — o que conta como cotação equivalente

Da [IN 65/2021](https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-65-de-7-de-julho-de-2021), [art. 4º e 5º](https://licitacoesecontratos.tcu.gov.br/4-3-9-1-fontes-para-obtencao-de-precos-2/):

A norma exige observar **condições comerciais praticadas**: prazos e locais de entrega, instalação, quantidade, formas e prazos de pagamento, fretes, garantias, marcas/modelos. Cinco fontes em ordem de prioridade:

1. Painel de Preços / banco oficial (≤ mediana)
2. Contratações similares da AP (12 meses)
3. Mídia especializada (6 meses)
4. **3 fornecedores diretos** (6 meses, com justificativa)
5. NFe nacional (12 meses)

Art. 6º exige **3+ preços** e desconsideração de inexequíveis/inconsistentes/excessivamente elevados com **critério fundamentado**. **Análise crítica obrigatória** quando há grande variação.

[Acórdão TCU 1875/2021](https://www.conjur.com.br/2021-set-30/interesse-publico-acordao-187521-tcu-pesquisas-precos-lei-1413321/) reforça: cotações com fornecedor diretamente são "último caso", priorizar preços públicos. Exige descrição completa, CNPJ/CPF, contatos, data, e registro de fornecedores que não responderam.

**Implicação pro LIE:** o sistema precisa entregar pra cada item (a) cesta com mínimo 3 cotações, (b) justificativa documentada de cada inclusão/exclusão, (c) memória de cálculo. **A cesta precisa ser semanticamente equivalente, não só CATMAT-equivalente.**

### B. APIs governamentais — granularidade que estou ignorando

Investigação completa das APIs SERPRO/PNCP/Compras revelou que uso **~15% do que está disponível**. Endpoints críticos não explorados:

| Endpoint | Por que importa |
|---|---|
| `CNBS /material/v1/palavra?palavra=X` | Busca textual oficial no catálogo. "bola" → Bola squash, vidro, futebol, isopor (4 PDMs distintos). **Substitui o exigir CATMAT do usuário.** |
| `CNBS /material/v1/caracteristicaPorCodigoPdm` | Atributos técnicos do PDM (cor, tamanho, material, capacidade) com códigos de valor |
| `Compras /modulo-material/7_consultarMaterialCaracteristicas` | Atributos do item específico |
| `Compras /modulo-arp/2_consultarARPItem` | Atas de Registro de Preço vigentes — preços ainda válidos |
| `Compras /modulo-arp/5_consultarAdesoesItem` | Caronas — validação de mercado |
| `PNCP /v1/pca` | Plano de Contratações Anual — intenção declarada com valor estimado |

**Atributos no retorno do `consultarMaterial` que ignoro:**
`marca`, `niFornecedor`, `descricaoDetalhadaItem`, `objetoCompra`, `criterioJulgamento`, `modalidade`, `dataResultado`, `estado`/`codigoMunicipio`/`esfera`/`poder`.

**Limites técnicos confirmados:**
- `tamanhoPagina` entre 10–500
- Janela máx **365 dias** (precisa fazer 3 chamadas pra cobrir 36 meses TCU 2318/2017)
- Painel de Preços **não tem API pública** (bloqueado por Cloudflare)
- Banco de Preços de Referência do TCU **não existe como API** (é só o painel BPS do próprio Compras com flag `bps=true`)

### C. Estado da arte — busca semântica + matching

- **Embeddings PT-BR:** Gemini-embedding-001 (estado da arte, US$0.15/1M tok), BGE-M3 (open source, dense+sparse nativo)
- **Vector DB recomendado:** [Firestore Vector Search nativo](https://firebase.google.com/docs/firestore/vector-search) (GA 2024) — funciona dentro do mesmo Firebase, custa ~US$0.06/100k leituras, zero infra nova
- **Hybrid retrieval (BM25 + vector + RRF):** padrão moderno, resolve 95% dos casos com ~5 linhas de código
- **Re-rank com LLM:** 2ª camada onde Gemini Flash julga "é a mesma família?" — flexível pra embutir regras LIE no prompt

**Custo estimado pro LIE** (200 itens × 10 cotações cada):
- Embedding inicial CATMAT (50k itens): ~R$ 3 uma vez
- Embedding 200 itens novos por execução: ~R$ 0,01
- Vector query + re-rank Gemini Flash: ~R$ 0,80/execução
- **Total por execução: ~R$ 0,80 a R$ 5**

### D. Comparação com mercado — o que outros fazem

**[Banco de Preços](https://www.bancodeprecos.com.br)** (líder de mercado):
- 200M+ preços, ~1000 fontes
- Cotação rápida (1 item) vs cotação em lote (N itens)
- Match por **descrição textual** — usuário busca por palavra, sistema retorna candidatos, **usuário seleciona o que aproxima de sua especificação**
- 26+ fórmulas de cálculo
- 7 dias trial grátis, planos não publicados (estimado R$200-800/mês)
- **Não usa IA/semantic search** explicitamente (texto livre + filtros)

**Effecti** — segmento diferente (foco em fornecedor que QUER ganhar licitação, não em proponente que justifica preço). IA "Aimê" para análise de edital. Não cobre LIE/Rouanet.

**Insight crítico:** Banco de Preços não tem feature de "vincular CATMAT". O usuário faz busca textual e seleciona cotações compatíveis manualmente. **A lógica é: humano no loop com ferramenta de filtro, não automação completa.**

### E. Sistemas comparáveis no Brasil (LIE estadual, Rouanet, ProAC)

- **[Salic/Rouanet](https://www.gov.br/cultura/pt-br/centrais-de-conteudo/marcas-e-logotipos/marcas-rouanet/2025.03ManualoProponenteMduloIIMonitoramentoeExecuo.pdf)**: planilha orçamentária aprovada por categoria. NFe deve coincidir com item aprovado (categoria + descrição). Pesquisa de preço fica a cargo do proponente — **não há ferramenta integrada no SALIC**. Glosas comuns: item fora da rubrica, sem documento fiscal, preço descolado do mercado.
- **[LIE federal](https://www.gov.br/esporte/pt-br/acoes-e-programas/lei-de-incentivo-ao-esporte)**: manual 2022 exige justificativa de orçamento mas não impõe metodologia rígida. Avaliação caso a caso pelo Ministério do Esporte.
- **[LPIE SP](http://www.lpie.sp.gov.br/)**: lei paulista, regras próprias. Pesquisa de preço seguindo IN 65 federal por analogia.
- **[ProAC](https://www.proac.sp.gov.br/)**: edital define teto por item; proponente apresenta orçamento que será aceito até o teto.

**Padrão geral**: nenhum sistema público tem ferramenta de pesquisa de preço **integrada e automatizada**. O proponente faz fora e justifica documentalmente. **Aí está a oportunidade do LIE como produto.**

### F. Open source — repositório-chave encontrado

**[artdelpi/classificador-compras-gov](https://github.com/artdelpi/classificador-compras-gov)** (atualizado 2026-05, MIT):
- BGE-M3 fine-tuned em 50k registros do compras.gov
- Classifica descrição → CATMAT/CATSER + NCM
- **Cobre ~70% do nosso desafio quase direto**
- Não há concorrente brasileiro consolidado neste nicho

Outros úteis: [ant-rod-silva/catmat_compras_gov_pub](https://github.com/ant-rod-silva/catmat_compras_gov_pub) (dump CATMAT), [megagonlabs/ditto](https://github.com/megagonlabs/ditto) (entity matching VLDB 2020), [wbsg-uni-mannheim/MatchGPT](https://github.com/wbsg-uni-mannheim/MatchGPT) (LLM re-ranking).

---

## 3. Três opções de arquitetura

### Opção 1 — Reset radical: humano-no-loop + busca textual rica

**Resumo:** seguir o modelo do Banco de Preços. Eliminar a tentativa de automação completa. Construir uma **ferramenta** que ajuda o usuário a achar cotações, não um robô que decide por ele.

**Fluxo:**
1. Item cadastrado tem **descrição rica** (o usuário escreve com detalhes)
2. Botão "Pesquisar Mercado" abre tela de busca tipo Banco de Preços
3. Busca textual via **CNBS `/palavra`** + filtro por atributos PDM (cor, capacidade, marca) + período + UF
4. Resultados mostrados em lista paginada com **descrição completa**, valor, órgão, data
5. **Usuário marca quais entrar na cesta** (checkbox)
6. Sistema calcula média/mediana, mostra análise estatística e exporta a justificativa documental

**Trade-offs:**
- ✅ Tira da IA a decisão crítica (proteção auditorial)
- ✅ Usa máximo de granularidade que as APIs já oferecem
- ✅ UX testada (Banco de Preços é líder de mercado)
- ❌ Mais trabalho manual por item
- ❌ Não diferencia LIE de Banco de Preços (apenas copia o modelo)

**Custo:** sem Gemini. Ganho de competitividade é só ergonomia.

**Esforço:** 2 semanas de 1 dev.

### Opção 2 — Híbrido: IA sugere, humano confirma (RECOMENDAÇÃO)

**Resumo:** combinar o que aprendi de Banco de Preços (humano no controle) com o que aprendi de busca semântica (IA acelera). Padrão "retrieval + re-rank + human-in-the-loop".

**Fluxo:**
1. Cadastro de item com descrição rica
2. **Indexação offline** de todo CATMAT/CATSER em Firestore Vector Search (uma vez, ~R$3)
3. Cadastro novo gera embedding do item e busca top-50 PDMs candidatos no vetor
4. Gemini Flash re-rankeia top-50 e sugere top-5 **com justificativa textual** ("este PDM bate com o item porque...")
5. Usuário aprova um PDM (não precisa decorar CATMAT)
6. Pesquisa busca cotações DAQUELE PDM via Compras + PNCP + ARP
7. **Gemini Flash classifica cada cotação trazida** como "comparável ✓", "talvez ⚠", "incompatível ✗" com justificativa
8. Usuário revisa lista e confirma cesta final

**Trade-offs:**
- ✅ Resolve o problema raiz: IA julga semanticamente, não confia só no código
- ✅ Humano sempre no controle das decisões críticas
- ✅ Justificativa textual gerada automaticamente (atende IN 65 art. 6º §3º)
- ✅ Diferencial real vs Banco de Preços
- ✅ Reaproveita boa parte do que já existe (PesquisaPrecoModal, ValidarCotacao)
- ❌ Custo Gemini ~R$0,80-5 por execução de 200 itens
- ❌ Complexidade técnica média (Firestore Vector Search + 2 prompts calibrados)

**Esforço:** 3-4 semanas de 1 dev.

### Opção 3 — Big bang: fine-tune próprio

**Resumo:** seguir o caminho do [classificador-compras-gov](https://github.com/artdelpi/classificador-compras-gov). Fine-tunar BGE-M3 com dados brasileiros pra ter um classificador item→CATMAT estado-da-arte.

**Trade-offs:**
- ✅ Melhor precisão técnica possível
- ✅ Diferencial competitivo forte (poderia até virar SaaS)
- ❌ Exige GPU pra treino (~R$2-5k uma vez ou usar Colab Pro)
- ❌ Exige dataset rotulado pra avaliar (~500 pares manualmente)
- ❌ Custo operacional alto se self-hosted (BGE-M3 inference em GPU ~US$350/mês)
- ❌ Curva longa: 2-3 meses de trabalho

**Esforço:** 6-10 semanas.

---

## 4. Recomendação

**Opção 2 (Híbrido)** com fases:

**Fase 1 (semana 1-2) — Fundação API:**
- Implementar busca via `CNBS /palavra` (substitui exigir CATMAT)
- Adicionar campos `descricaoDetalhada`, `marca`, `criterioJulgamento` no schema das referências
- Janelar 36 meses (3 chamadas de 12) com segmentação por UF

**Fase 2 (semana 3) — Indexação vetorial:**
- Baixar dump CATMAT/CATSER ([ant-rod-silva/catmat_compras_gov_pub](https://github.com/ant-rod-silva/catmat_compras_gov_pub))
- Indexar em Firestore Vector Search com embeddings Gemini
- Endpoint `sugerirCatmat(descricao, top=10)`

**Fase 3 (semana 4) — Re-rank semântico:**
- Pra cada cotação trazida pela API, chamar Gemini Flash com prompt: "esta cotação descreve o mesmo objeto que o item LIE? sim/não/talvez + justificativa"
- UI mostra cotações classificadas em 3 colunas
- Usuário aprova a cesta

**Fase 4 (semana 5) — Documentação automática:**
- Gerar justificativa textual da cesta no formato IN 65/2021
- Exportar PDF da pesquisa com memória de cálculo, fontes, exclusões

**Antes de começar:** reverter as mudanças que escreveram nos dados reais (nome, descrição, unidade dos 192 itens) — preservar os `nomeOriginalLIE` como fonte de verdade enquanto redesenhamos.

---

## 5. Custos consolidados

| Item | Custo unitário | Volume estimado mensal | Custo mensal |
|---|---|---|---|
| Gemini embeddings | US$ 0,15/1M tok | 50k itens novos | ~R$ 0,05 |
| Gemini Flash re-rank | US$ 0,075/1M in | 200 itens × 20 cotações × 200 tok | ~R$ 6 |
| Firestore Vector queries | US$ 0,06/100k | 10k queries | ~R$ 0,30 |
| Firestore storage vetores | US$ 0,18/GB/mês | 50k × 3kB ≈ 150MB | ~R$ 0,15 |
| **Total operacional** | | | **~R$ 7/mês** |

Investimento de dev: 4-5 semanas de 1 dev sênior. A R$200/h e 40h/semana ≈ R$32-40k.

---

## 6. O que fica e o que sai do código atual

### Mantém (correções de bug reais):
- Fix `siglaUnidadeFornecimento` vs `siglaUnidadeMedida` em consultarPrecosMulti/coletarMercadoItem
- Etapa 5B (edição restrita no projeto)
- Etapa 5C (cesta no Banco de Itens)
- Cloud Functions de pesquisa base (consultarPrecosMulti, coletarMercadoItem)

### Reverte:
- Botão "Padronizar Nomenclatura (IA)" + CF padronizarItemNomenclatura
- Botão "Atualizar Mercado em Lote"
- Filtro de equivalência de embalagem (substituído por re-rank semântico)
- Badge "Dados pré-correção"
- Mudanças nos 192 itens do Firestore: restaurar `nome`/`descricao`/`unidade` a partir dos campos `nomeOriginalLIE` preservados

---

## 7. Próximos passos imediatos

1. **Você decide** entre opção 1, 2 ou 3 (ou variação)
2. Aprovação → reverto o que precisa ser revertido (commit limpo, sem destruir dados)
3. Começamos pela Fase 1 da opção escolhida
4. Aprovação por fase, não big-bang

Você tá no controle do ritmo.

---

## Fontes consultadas

### Base legal
- [IN 65/2021 — Portal Compras](https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-65-de-7-de-julho-de-2021)
- [Acórdão TCU 1875/2021 analisado — Conjur](https://www.conjur.com.br/2021-set-30/interesse-publico-acordao-187521-tcu-pesquisas-precos-lei-1413321/)
- [TCU Licitações e Contratos — Fontes para obtenção de preços](https://licitacoesecontratos.tcu.gov.br/4-3-9-1-fontes-para-obtencao-de-precos-2/)
- [Acórdão TCU 1445/2015 — Plenário](https://pesquisa.apps.tcu.gov.br/doc/acordao-completo/1445/2015/Plen%C3%A1rio)

### APIs
- [Compras dadosabertos Swagger](https://dadosabertos.compras.gov.br/swagger-ui/index.html)
- [PNCP Consulta Swagger](https://pncp.gov.br/api/consulta/swagger-ui/index.html)
- [CNBS SERPRO Swagger](https://cnbs.estaleiro.serpro.gov.br/cnbs-api/v3/api-docs)
- [Painel de Preços](https://paineldeprecos.planejamento.gov.br/)

### Comerciais
- [Banco de Preços](https://www.bancodeprecos.com.br/)
- [Effecti](https://effecti.com.br/)

### Sistemas comparáveis
- [Manual LIE federal 2022](https://www.gov.br/esporte/pt-br/acoes-e-programas/lei-de-incentivo-ao-esporte/ManualLeideIncentivoATUALIZADO20222.pdf)
- [Manual SALIC execução e prestação de contas](https://aic.org.br/uploads/2020/10/Manual-de-execucao-e-prestacao-de-contas_SALIC_24-06-20.pdf)
- [ProAC SP](https://www.proac.sp.gov.br/)
- [LPIE SP](http://www.lpie.sp.gov.br/)

### Tecnologia
- [Firestore Vector Search](https://firebase.google.com/docs/firestore/vector-search)
- [Gemini Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [artdelpi/classificador-compras-gov](https://github.com/artdelpi/classificador-compras-gov)
- [BGE-M3](https://github.com/FlagOpen/FlagEmbedding)
- [Reciprocal Rank Fusion](https://github.com/AmenRa/ranx)
- [Amazon ESCI dataset](https://github.com/amazon-science/esci-data)
- [megagonlabs/ditto](https://github.com/megagonlabs/ditto) — entity matching VLDB 2020
- [wbsg-uni-mannheim/MatchGPT](https://github.com/wbsg-uni-mannheim/MatchGPT)
