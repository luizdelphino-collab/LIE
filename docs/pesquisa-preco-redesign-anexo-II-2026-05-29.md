# Anexo II — Aprofundamento Opção 2 (Híbrido)

**Data:** 2026-05-29
**Foco:** os 4 pontos que você levantou na decisão pela opção 2

---

## 1. Achado-chave: o "Quanto Custa" já existe (e funciona)

**Paper:** [Costa, Dutra, Oliveira et al., "Quanto Custa: Banco de Preços de Compras Públicas do Estado de Minas Gerais", SBBD 2024](https://sol.sbc.org.br/index.php/sbbd_estendido/article/download/30800/30603/)

Sistema desenvolvido pelo **MPMG + UFMG** que resolve EXATAMENTE o nosso problema, mas pra Minas Gerais. Faz desambiguação de itens, agregação multi-fonte, detecção de sobrepreço. Vou destrinchar o que vale copiar:

### Stack que usaram
- **Frontend:** React
- **Backend:** Python + FastAPI
- **Armazenamento:** **ElasticSearch** (busca textual avançada) + Apache Hive
- **Data pipeline:** Apache Spark
- **Auth:** WSO2

### Fontes que agregaram (modelo a copiar)
- **TCE-MG SICOM** — licitações + NFe + contratos municipais (~30 milhões de itens)
- **Portal Transparência TCE-MG** — licitações estaduais
- **ANVISA** — preços de medicamentos
- **ANP** — preços de combustíveis
- **CEASA-MG** — preços de hortifrúti

**Lição:** combinar bases governamentais GENERALISTAS (TCE) com bases SETORIAIS (ANVISA, ANP, CEASA) dá precisão por categoria.

### Como fazem busca (o coração do sistema)
Duas modalidades:

1. **Busca inteligente**: text matching com **mínimo 70% de precisão**. Tolera variações, typos, sinônimos.
2. **Busca assistida**: filtros booleanos com 4 operadores:
   - "Todas as palavras" (AND)
   - "Pelo menos uma das palavras" (OR)
   - "Não contendo as palavras" (NOT)
   - "Com a frase exata"
   - Wildcards (`*`) entre caracteres

**Exemplo do paper:** preço de palco 6m x 4m
```
Query: "palco" AND "6*x*4" NOT "equipamento"
Filtro: ano 2022 ou 2023
```
O `*` cobre "6m x 4m", "6mx4m", "6 x 4", "6x4". O NOT exclui resultados de equipamentos de iluminação que aparecem misturados.

**Isso resolve o "carrinho de pipoca em evento":**
```
Query: "carrinho" AND "pipoca" AND ("evento" OR "festa") NOT ("milho" OR "máquina" OR "industrial")
Filtro: ano últimos 36 meses, modalidade pregão
```

### Curadoria de dados (essencial)
O paper cita explicitamente: dados de compras vêm sujos. Implementaram validações específicas baseadas em papers [Oliveira et al. 2022, 2023; Brum et al. 2024]. **Não dá pra confiar nos dados crus** — precisa de uma camada de saneamento antes de usar.

### Detecção de sobrepreço (o resultado final)
Usam **amplitude interquartil (IQR)** pra detectar itens com preço fora do esperado [Silva et al. 2023, 2024]. Mais robusto que média + desvio padrão.

### Conclusão sobre o Quanto Custa
- Já existe um sistema brasileiro fazendo isso, validado em ambiente real (MPMG)
- Stack ElasticSearch é a peça-chave (não Firestore Vector Search)
- A combinação **busca textual rica + filtros booleanos + curadoria de dados** é o que faz funcionar
- IA semântica é **complementar**, não substituta — o caminho 1 deles é texto bem feito

---

## 2. Sobre sugestão de similaridade — caso "carrinho de pipoca ≠ milho"

### O problema
Usuário cadastra "carrinho de pipoca em evento esportivo". Esse termo não existe no CATSER federal. A IA chuta candidatos: "Máquina de fazer pipoca", "Milho de pipoca", "Fornecimento de refeições" — todos errados semanticamente.

### A solução em 3 camadas

**Camada A — busca textual rica (modelo Quanto Custa):**
1. Quebrar termo do usuário em tokens chave: `carrinho`, `pipoca`, `evento`, `esportivo`
2. Chamar `CNBS /servico/v1/palavra?palavra=X` pra CADA token relevante
3. Combinar resultados via **Reciprocal Rank Fusion** (RRF) — quem aparece em múltiplas buscas sobe no rank
4. Excluir tokens lixo via NOT: `NOT "máquina"`, `NOT "industrial"`, `NOT "milho cru"`

**Camada B — embeddings semânticos:**
1. Embedding do termo do usuário (Gemini-embedding-001)
2. Query no índice CATMAT/CATSER (Firestore Vector Search com ~15k itens)
3. Top-50 candidatos por similaridade cosseno

**Camada C — re-ranker IA com regras LIE:**
Pra cada candidato (top-50), Gemini Flash responde:
```
"Este CATSER {nome+descrição} pode ser usado pra contratar o item
LIE {nome+descrição} num projeto esportivo?
- SIM: candidato direto
- TALVEZ: candidato com ressalva (justifique)
- NÃO: rejeita (justifique)"
```

Resultado: lista limpa pro usuário escolher, com justificativa textual em linguagem natural.

### Por que isso resolve o "carrinho de pipoca"
- **Camada A** quebra em tokens → não casa com "milho" porque o NOT bloqueia
- **Camada B** acha "fornecimento de alimentação em evento" por similaridade semântica
- **Camada C** filtra: máquina pra fazer pipoca → NÃO (é equipamento, não fornecimento), milho cru → NÃO (é matéria-prima, não serviço), fornecimento de lanche em evento → SIM (essa é a boa)

### Dicionário de sinônimos curado (acelera tudo)
Manter um JSON LIE-específico que mapeia termos LIE → variações canônicas do catálogo:
```json
{
  "carrinho de pipoca": ["fornecimento alimentação evento", "serviço alimentação esportivo", "venda alimento"],
  "kit lanche": ["fornecimento lanche preparado", "kit alimentação"],
  "medalha": ["medalha esportiva premiação", "medalha personalizada"],
  ...
}
```

Esse dicionário **já existe parcialmente** em [lib/catalogoApi.ts:325](lib/catalogoApi.ts#L325). Precisa ser expandido com base nos itens reais do banco LIE + casos do TCE.

---

## 3. Sobre métricas de embalagem — caso "água 200ml ≠ qualquer tamanho"

### O termo técnico oficial é "Efeito Embalagem"
Doutrina brasileira reconhece isso há anos:
> "Efeito embalagem é causado pela escolha de uma unidade de comercialização inadequada para o tipo de insumo pesquisado, considerando a forma mais usual de comercialização, sua finalidade e aplicação."

[Fonte: ebook formação de preços, Eduardo Guimarães (TCE-RJ)](https://eduguimaraes.com/wp-content/uploads/2021/03/ebook-formacao-de-precos-contratacoes-publicas-banco-de-precos.pdf)

### Padrão internacional: OCDS extension para itens
O relatório [Qualidade de Dados PNCP, Transparência Brasil 2024](https://www.transparencia.org.br/downloads/publicacoes/qualidade_dados_portal_nacional_de_contratacoes_publicas.pdf) confirma o problema **e** recomenda solução:
- PNCP tem `unidadeMedida` totalmente bagunçado: "litro", "FRASCO 1000,00 ML", "Frasco 1 L", "Litro (LTR)"
- Recomendação: adotar **[OCDS extension for medicines](https://standard.open-contracting.org/profiles/medicine/latest/en/)** pra padronizar
- Unidades canônicas: `mg`, `ml`, `g`, `l`, `kg`, `un`
- Códigos pra forma de apresentação (cápsula, comprimido, frasco, etc)
- Razão de uso normalizada (`mg/ml`, `g/l`, etc)

### Como aplicar pro LIE (regra de equivalência de embalagem)

**Definição operacional:** duas cotações são equivalentes em embalagem se, depois de normalizadas pra unidade-base canônica, a razão preço/unidade-base diverge em **menos de 25%** (tolerância TCU).

**Algoritmo:**
```
preco_base_cotacao = valor_unitario / (capacidade × fator_conversao_pra_base)
preco_base_item    = valor_unitario_item / (capacidade_item × fator_conversao_item)

if abs(preco_base_cotacao - preco_base_item) / preco_base_item > 0.25:
    rejeitar com motivo "preço por unidade-base fora de ±25%"
```

**Exemplo água 200ml a R$0,75:**
- Item LIE: copo 200ml a R$0,75 → R$3,75/litro
- Cotação A: garrafa 1.5L a R$2,00 → R$1,33/litro → 64% abaixo → REJEITA
- Cotação B: copo 200ml a R$0,60 → R$3,00/litro → 20% abaixo → ACEITA
- Cotação C: garrafa 500ml a R$1,80 → R$3,60/litro → 4% abaixo → ACEITA

### Pra serviços (sem embalagem)
Quando não há embalagem mensurável (locação de palco, serviço de coordenação, carrinho de pipoca), a equivalência vai por **descrição + UF + período**, não por embalagem. Aí o re-ranker semântico (Camada C acima) é que faz o trabalho.

---

## 4. Como o mercado descreve — alinhamento com a linguagem dos órgãos

### Realidade documentada (PNCP qualidade 2024)
> "O campo descrição não é padronizado, apresentando várias descrições diferentes para o mesmo produto. Sem a padronização desse campo, a tarefa de comparação de preços se torna bastante limitada."

Cada município/órgão preenche do seu jeito. Não há padrão.

### Implicação pra busca
**NÃO confiar na descricao curta.** Sempre buscar em:
- `descricao` (geralmente nome técnico curto)
- `descricaoDetalhadaItem` (texto livre rico)
- `objetoCompra` (descrição geral do edital)
- `nomeUnidadeFornecimento` + `siglaUnidadeFornecimento` (embalagem)
- `marca` (quando disponível)

### Como aprender o léxico real
Estratégia: rodar um job **offline** uma vez por mês que:
1. Baixa últimos 12 meses de cotações por CATSER (via Compras + PNCP)
2. Extrai `descricaoDetalhadaItem` de TODAS
3. Faz TF-IDF + clustering (k-means leve)
4. Identifica as 5 famílias semânticas dentro de cada CATSER
5. Salva resumos das famílias num índice

Aí quando o usuário cadastra item, mostro as famílias e ele escolhe ("você quer carrinho de pipoca **em festa infantil** ou **em evento esportivo escolar**?").

Isso elimina o ruído do CATSER genérico ser usado pra coisas diferentes.

---

## 5. Ampliação de fontes — chegando aos 1000 que o Banco de Preços tem

### Fontes federais (que já uso)
| Fonte | Cobertura | Status atual |
|---|---|---|
| Compras.gov.br `dadosabertos` | Federal | ✓ usa |
| PNCP (contratações + atas) | Multi-esfera | ✓ usa |
| TCE-PE | Pernambuco | ✓ usa |
| SERPRO CNBS | Catálogo | ✓ usa, mas só ~15% |

### Fontes que devo adicionar (PRIORIDADE ALTA)

| Fonte | API/URL | Cobertura | Notas |
|---|---|---|---|
| **TCE-SP Audesp Fase IV** | [audesp.tce.sp.gov.br/api](https://audesp.tce.sp.gov.br/api/) | SP municipal + estadual | Maior estado, ~25% das licitações BR. Pós-Lei 14.133/21, JSON |
| **TCE-MG SICOM Dados Abertos** | [dadosabertos.tce.mg.gov.br](https://dadosabertos.tce.mg.gov.br/) | MG municipal + estadual | É a fonte do "Quanto Custa" (UFMG). ~30M itens |
| **TCE-RS Dados Abertos** | [dados.tce.rs.gov.br](https://dados.tce.rs.gov.br/) | RS municipal + estadual | CKAN API, 73k+ datasets |
| **TCE-RJ Dados Abertos** | [dados.tcerj.tc.br/api/v1/docs](https://dados.tcerj.tc.br/api/v1/docs) | RJ municipal + estadual | API REST documentada |
| **ANVISA Preços** | [consultas.anvisa.gov.br](https://consultas.anvisa.gov.br/) | Medicamentos federal | Tabela CMED de preço máximo (cap regulatório) |
| **ANP Preços** | [anp.gov.br](https://www.anp.gov.br/) | Combustíveis federal | Pesquisa semanal por região |
| **CEASA-MG / CEAGESP / outras CEASA** | varia por estado | Hortifrúti regional | Útil pra cesta básica |

### Fontes que valem investigar (PRIORIDADE MÉDIA)

| Fonte | URL | Cobertura |
|---|---|---|
| TCE-PR Consulta | [pncp.tce.pr.gov.br](https://pncp.tce.pr.gov.br/ConsultaPublicaEditais/List) | PR municipal |
| TCE-BA / TCE-CE / TCE-DF / TCM-GO | varia | Outros estados |
| SUS BNAFAR | [bnafar.github.io/statusenvio](https://bnafar.github.io/statusenvio/) | Medicamentos SUS (estados+municípios) |
| Compras-SP | [compras.sp.gov.br](https://compras.sp.gov.br/) | SP estadual |
| Compras Paraná | [compraspr.pr.gov.br](https://www.compraspr.pr.gov.br) | PR estadual |

### Como o Banco de Preços chega aos 1000+
Provavelmente combinam:
- 26 TCEs estaduais + TCDF (cada um com SICOM próprio)
- ~50 portais estaduais e DF
- Dezenas de capitais e grandes cidades
- Portais setoriais (saúde, segurança, educação)
- Talvez raspagem de portais de prefeitura

Réplicar tudo é big-bang. Estratégia incremental: **começar com TCE-SP + TCE-MG + ANVISA + ANP**. Isso já triplica nossa cobertura.

### Custo de adicionar uma fonte
- Investigar API/scraping: 2-4h
- Mapear schema → schema interno LIE: 2-4h
- Implementar conector: 4-8h
- Testes e validação: 2-4h
- **Total: ~1-2 dias por fonte**

Pra 8 fontes prioritárias: ~2 semanas de trabalho.

---

## 6. Revisão da arquitetura Opção 2 com os novos achados

Atualizando o que escrevi no doc original:

### Stack revisado
- **Vector DB:** Firestore Vector Search funciona, mas considerar **ElasticSearch** (o que o Quanto Custa usa). ElasticSearch suporta hybrid retrieval nativamente (BM25 + dense vector + boost). Custa um Cloud Run com ~2GB RAM (~R$50-100/mês).
- **Recomendação atualizada:** começar com Firestore Vector Search (zero infra), migrar pra ElasticSearch quando o volume justificar.

### Fases revisadas (5 fases agora)

**Fase 1 (semana 1) — Reverter mudanças destrutivas:**
- Restaurar nomes/descrições/unidades dos 192 itens via `nomeOriginalLIE`
- Remover botões e CFs do Padronizar
- Manter fixes de bug reais (siglas UN/ML)

**Fase 2 (semana 2-3) — Fundação textual + boolean search:**
- Implementar busca via `CNBS /palavra` + filtros booleanos no Firestore
- Adicionar `descricaoDetalhadaItem`, `marca`, `objetoCompra` no schema
- UI tipo Quanto Custa: query box + filtros avançados ("contém todas", "ao menos uma", "não contém")
- Janelar 36 meses com segmentação UF/esfera/poder

**Fase 3 (semana 4) — Dicionário canônico + normalização:**
- Expandir dicionário sinônimos LIE → catálogo (semente em [lib/catalogoApi.ts:325](lib/catalogoApi.ts#L325))
- Normalização de unidades (OCDS extension model)
- Algoritmo de equivalência de embalagem ±25%
- Detecção e tratamento de descrição livre

**Fase 4 (semana 5-6) — Indexação vetorial + re-rank IA:**
- Indexar CATMAT/CATSER em Firestore Vector Search
- Embedding via Gemini-embedding-001
- Re-rank semântico via Gemini Flash com prompt LIE-aware
- UI: 3 colunas (compatível ✓, talvez ⚠, incompatível ✗)

**Fase 5 (semana 7-8) — Ampliação de fontes:**
- Conectar TCE-SP Audesp (maior fonte estadual)
- Conectar TCE-MG SICOM
- Conectar ANVISA + ANP (setoriais)
- Total: 4 novas fontes + as 3 federais que já tem

**Fase 6 (semana 9) — Documentação automática:**
- Gerar justificativa textual da cesta no formato IN 65/2021
- PDF da pesquisa com memória de cálculo, fontes, exclusões fundamentadas
- Exportar pra prestação de contas

### Esforço total revisado
**8-9 semanas de 1 dev sênior.** Maior que as 4-5 que estimei antes, mas com cobertura **MUITO maior** e usando padrões já validados (Quanto Custa, OCDS).

### Custo operacional revisado
- Gemini embeddings + Flash: ~R$10/mês
- Firestore vector storage + queries: ~R$5/mês  
- Cloud Functions adicionais (conectores das 4 novas fontes): ~R$5/mês
- **Total: ~R$20/mês**

---

## 7. Próximas decisões a alinhar com você

1. **Fase 1 — reverter agora?** Os 192 itens estão com nomes da IA padronizada que não fazem sentido. O `nomeOriginalLIE` está preservado. Posso fazer um script de restauração que devolve `nome ← nomeOriginalLIE`, sem perder dado novo (mantém ConvergeCatmat se for válido).

2. **Fase 2 — começar pelo Quanto Custa model?** A busca booleana tipo `palco AND "6*x*4" NOT equipamento` é prática e auditável. IA fica como Fase 4. Topa?

3. **Ampliação de fontes — quais 2-3 começar?** Sugiro TCE-SP + TCE-MG. SP porque é o maior. MG porque o sistema "Quanto Custa" já provou o caminho. Topa, ou prefere outra?

4. **Stack — Firestore ou ElasticSearch?** Firestore é mais simples e barato no curto prazo. ElasticSearch é o que o Quanto Custa usa e escala melhor. Posso começar com Firestore e migrar depois.

---

## Sources adicionais (Round 2)

### Acadêmico / pesquisa
- [Costa et al., "Quanto Custa", SBBD 2024 — PDF](https://sol.sbc.org.br/index.php/sbbd_estendido/article/download/30800/30603/) **★ leitura obrigatória**
- [Vídeo institucional Quanto Custa MPMG](https://youtu.be/Hm8KHYi-2sc)
- [Relatório Qualidade PNCP, Transparência Brasil 2024](https://www.transparencia.org.br/downloads/publicacoes/qualidade_dados_portal_nacional_de_contratacoes_publicas.pdf)
- [ebook Formação de Preços, Eduardo Guimarães TCE-RJ](https://eduguimaraes.com)

### APIs estaduais
- [TCE-SP Audesp Fase IV](https://audesp.tce.sp.gov.br/api/)
- [TCE-MG Dados Abertos](https://dadosabertos.tce.mg.gov.br/)
- [TCE-RS Dados Abertos](https://dados.tce.rs.gov.br/)
- [TCE-RJ Dados Abertos](https://dados.tcerj.tc.br/api/v1/docs)
- [TCE-PR Consulta](https://pncp.tce.pr.gov.br/)

### Fontes setoriais
- [ANVISA Consultas](https://consultas.anvisa.gov.br/)
- [ANP](https://www.anp.gov.br/)
- [BNAFAR](https://bnafar.github.io/statusenvio/)
- [Painel de Preços Governo Federal](https://paineldeprecos.planejamento.gov.br/)

### Padrões
- [OCDS Standard](https://standard.open-contracting.org/)
- [OCDS Medicine Extension](https://standard.open-contracting.org/profiles/medicine/latest/en/)
