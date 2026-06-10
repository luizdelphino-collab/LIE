# Anexo III — Plano final: Cadastro Wizard + Pesquisa em 3 Tiers

**Data:** 2026-05-29
**Status:** plano consolidado pra execução

---

## 1. A virada conceitual

Antes: tentávamos reconstruir semântica DEPOIS do cadastro (padronizar IA, filtrar embalagem, validar unidade). Cada camada perdia informação.

Agora: **capturar dados estruturados na origem**, no momento do cadastro, quando o usuário tem máximo contexto. A pesquisa de preço depois vira determinística.

### Implicação direta
- A maioria das mudanças da Opção 2 que eu tinha proposto fica **simplificada ou eliminada**
- Sem padronização IA a posteriori
- Sem filtro de embalagem (já vem amarrada)
- Sem re-rank semântico de cotações (a cotação ou bate atributos OR não)
- Custo Gemini cai drasticamente (~R$2/mês em vez de R$10)

---

## 2. Fluxo do cadastro com Wizard

### Tela 1 — Descrição livre
```
┌─────────────────────────────────────────────────┐
│ Cadastrar novo item                             │
│                                                  │
│ Descreva o que você precisa contratar:          │
│ ┌─────────────────────────────────────────────┐ │
│ │ água mineral em copo descartável de 200ml  │ │
│ │ para hidratação em torneio esportivo        │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│              [Cancelar]  [Buscar no catálogo →] │
└─────────────────────────────────────────────────┘
```

### Tela 2 — Sistema sugere famílias (PDMs candidatos)
Backend chama em paralelo:
- `CNBS /material/v1/palavra?palavra={tokens}` pra cada token chave
- Reciprocal Rank Fusion dos resultados
- Top-5 PDMs com contagem real de cotações dos últimos 12 meses

```
┌─────────────────────────────────────────────────┐
│ Encontrei estas famílias no catálogo oficial:   │
│                                                  │
│ ⦿ Água mineral natural                          │
│   PDM 1234 · 1.247 cotações nos últimos 12m    │
│   [esta é a melhor opção pra evento esportivo]  │
│                                                  │
│ ○ Água mineral natural com gás                  │
│   PDM 5678 · 312 cotações                       │
│                                                  │
│ ○ Refresco / suco em pó                         │
│   PDM 9012 · 89 cotações                        │
│                                                  │
│ ○ Nenhuma destas cobre o que preciso →          │
│   [busca alternativa via mídia especializada]   │
│                                                  │
│                       [Voltar]  [Continuar →]   │
└─────────────────────────────────────────────────┘
```

Sistema mostra:
- **Contagem real de cotações** (sinal forte de qual PDM é o "certo")
- **Justificativa textual** da IA (1 linha por opção) — "esta é a melhor opção pra X porque Y"
- **Saída pra rota alternativa** sempre disponível

### Tela 3 — Wizard de atributos (a parte chave)
Após escolher PDM 1234, sistema chama `CNBS /caracteristicaPorCodigoPdm?codigo_pdm=1234` e renderiza UMA pergunta por característica obrigatória:

```
┌─────────────────────────────────────────────────┐
│ Água mineral natural — etapa 1 de 5             │
│                                                  │
│ Tipo:                                            │
│   ○ Com gás                                      │
│   ⦿ Sem gás                                      │
│                                                  │
│ ⓘ "Sem gás" é usado em 89% das cotações pra    │
│   eventos esportivos                             │
│                                                  │
│             [Voltar]  [Próxima →]                │
└─────────────────────────────────────────────────┘

[etapa 2/5] Material da embalagem: PLÁSTICO / VIDRO
[etapa 3/5] Tipo da embalagem: DESCARTÁVEL / RETORNÁVEL
[etapa 4/5] Capacidade: 200ML / 500ML / 1L / 1.5L / 5L / 20L
[etapa 5/5] Unidade fornecimento: COPO / GARRAFA / GALÃO / CAIXA
```

Para cada atributo, sistema mostra **frequência real nas cotações** ("89% das cotações pra esse PDM usam X") — ajuda o usuário a escolher conscientemente.

Botão discreto em cada tela: **"Característica não listada"** → abre rota alternativa.

### Tela 4 — Confirmação e quantidade
```
┌─────────────────────────────────────────────────┐
│ Item resolvido:                                  │
│                                                  │
│ ✓ CATMAT 445484                                  │
│   ÁGUA MINERAL NATURAL                           │
│   Sem gás · Plástico · Descartável               │
│   Copo 200ml                                     │
│                                                  │
│ Quantidade necessária:  [600] [Copo]             │
│ Valor unitário estimado: R$ [0,75]               │
│                                                  │
│ Descrição livre adicional (opcional):            │
│ ┌─────────────────────────────────────────────┐ │
│ │ Para hidratação em torneio estudantil de   │ │
│ │ basquete. Distribuição pelos voluntários.   │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│                 [Voltar]  [Salvar item ✓]       │
└─────────────────────────────────────────────────┘
```

A descrição livre adicional NÃO afeta a pesquisa de preço. Vai pro projeto/edital como contexto adicional pro avaliador.

---

## 3. Pesquisa de preço — agora determinística

Com o item completo, pesquisa vira simples:

```sql
WHERE codigoCatmat = 445484
  AND siglaUnidadeFornecimento = 'COPO'
  AND capacidadeUnidadeFornecimento BETWEEN 180 AND 220
  AND tipo = 'SEM GAS'  
  AND materialEmbalagem = 'PLASTICO'
  AND tipoEmbalagem = 'DESCARTAVEL'
```

**Resultado:** cesta limpa, atributos casam. Sem "Efeito Embalagem". Sem ambiguidade.

Análise estatística (média saneada TCU + IQR — modelo Quanto Custa) define preço de referência.

---

## 4. Quando o catálogo NÃO cobre — 3 Tiers de fallback

Pra "carrinho de pipoca em evento", "serviço de montagem de palco", "kit lanche personalizado" — itens onde o catálogo CATMAT/CATSER ou não tem PDM ou tem só código genérico inútil.

### Tier 1 — Catálogo oficial (default, art. 5º II da IN 65/2021)
O fluxo wizard descrito acima. Audit-safe, melhor opção quando aplicável.

### Tier 2 — Sites especializados + IA (art. 5º III da IN 65/2021)
Quando usuário marca "característica não listada" ou "nenhuma destas cobre":

```
┌─────────────────────────────────────────────────┐
│ Catálogo oficial não cobre seu item.            │
│                                                  │
│ Vou buscar em sites especializados (autorizado  │
│ pela IN 65/2021 art. 5º inciso III).            │
│                                                  │
│ Confirme a especificação:                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ Locação de carrinho de pipoca para evento   │ │
│ │ esportivo escolar, atendimento 4 horas,     │ │
│ │ inclui pipoca + copos descartáveis para    │ │
│ │ até 300 pessoas, com atendente             │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│       [Editar]  [Buscar mídia especializada →] │
└─────────────────────────────────────────────────┘
```

Backend dispara em paralelo:
1. **WebSearch** focado em sites de locação de equipamento de evento + buffets infantis + serviços de evento esportivo (lista curada de domínios confiáveis)
2. **Extração** de preços por região, evento similar, prazo
3. **IA classifica** cada resultado: confiável ✓ / suspeito ⚠ / lixo ✗
4. **Apresenta** ao usuário: 5-10 resultados com link + preço + data + região

Critérios de confiabilidade (cada um vira score):
- Domínio existe há >2 anos (registro WHOIS)
- Tem CNPJ visível
- Endereço físico declarado
- Site não é marketplace de revenda
- Preço razoável (não é dropshipping)

Cada cotação salva fica com **link público + timestamp + screenshot PDF**. Auditável.

### Tier 3 — 3 fornecedores manuais (art. 5º IV da IN 65/2021)
Última opção. Quando Tier 2 não traz nada confiável OU quando o item é tão específico que só fornecedor direto sabe precificar.

IA ajuda a achar fornecedores:
- Busca CNPJs que prestam aquele serviço na UF
- Mostra contato (telefone, e-mail) coletados do site público
- Usuário contata e registra orçamento manualmente

Sistema gera **carta de solicitação de orçamento padronizada** (IN 65 art. 5º §1º exige formalismo).

### Visão geral dos tiers

| Tier | Quando | Esforço usuário | Esforço IA | Audit-safe |
|---|---|---|---|---|
| 1 — Catálogo | Item tem PDM com atributos completos | Baixo (wizard) | Mínimo | ★★★ |
| 2 — Mídia especializada | Item não tem PDM ou atributos faltam | Médio (revisa sugestões) | Alto | ★★ |
| 3 — 3 fornecedores | Tier 2 sem sucesso | Alto (contato manual) | Médio (acha candidatos) | ★★★ |

Sistema escolhe o tier sozinho mas sempre mostra ao usuário em qual está e por quê.

---

## 5. Migração dos 192 itens existentes

Você escolheu: **restaurar originais + botão "completar cadastro" por item**.

**Fase 1.1 — Restaurar dados:**
```typescript
// Pra cada item do banco
if (item.nomeOriginalLIE) {
  // Restaura: o que IA escreveu vira o "fallback", original volta a ser fonte
  await setDoc(itemRef, {
    nome: item.nomeOriginalLIE,
    descricao: item.descricaoOriginalLIE || item.descricao,
    unidade: item.unidadeOriginalLIE || item.unidade,
    // Preserva o trabalho da IA pra eventual referência
    nomePadronizadoIA: item.nome,  // tinha sido sobrescrito
    descricaoPadronizadaIA: item.descricao,
    unidadePadronizadaIA: item.unidade,
    // Sinal de migração
    precisaCompletarWizard: !item.codigoCatmat || !item.atributosCompletos,
    migradoEm: serverTimestamp()
  }, { merge: true });
}
```

**Fase 1.2 — Badge visual:**
Lista de itens no Banco passa a mostrar badge **🔧 Completar cadastro** nos itens com `precisaCompletarWizard=true`. Clicando, abre o wizard de atributos pra aquele item.

Você completa quando precisar pesquisar preço daquele item. Sem big-bang forçado.

---

## 6. Plano final de execução

### Fase 1 — Reset + restauração (semana 1)
- Reverter os 192 itens (script de restauração com nomeOriginalLIE)
- Remover botões "Padronizar Nomenclatura" e "Atualizar Mercado em Lote"
- Remover CF `padronizarItemNomenclatura`
- Manter `consultarPrecosMulti`, `coletarMercadoItem`, `traduzirTermoCatmat` (úteis pro novo fluxo)
- Adicionar badge "Completar cadastro" nos itens precisando wizard

### Fase 2 — Cache local do catálogo CNBS (semana 2)
- Importar PDMs + características + valores em coleção Firestore `catalogo_pdms`
- Job mensal de sincronização
- Estrutura: PDM → array de características → cada uma com valores possíveis
- Pra ~50 PDMs comuns do LIE (alimentação, esporte, audiovisual, comunicação visual)

### Fase 3 — Tela 1+2: descrição + sugestão de PDM (semana 3)
- Diálogo "Descreva o objeto"
- Backend: tokenize + chamadas paralelas a `CNBS /palavra`
- RRF dos resultados
- Top-5 PDMs com contagem de cotações reais (pré-calculadas no cache)
- IA gera justificativa textual de 1 linha por opção

### Fase 4 — Tela 3: Wizard de atributos (semana 4)
- Pra cada PDM escolhido, carrega características do cache local
- Renderiza 1 pergunta por atributo
- Mostra frequência real de cada valor ("89% das cotações usam X")
- Resolve combinação → codigoCatmat específico
- Botão "característica não listada" em cada tela → muda pro Tier 2

### Fase 5 — Pesquisa determinística (semana 5)
- Refatorar `pesquisarItemMasterAutomatico` pra usar atributos amarrados
- Query Firestore com TODOS os atributos como filtros
- Análise estatística IQR + média saneada TCU
- UI: cesta clean

### Fase 6 — Tier 2: mídia especializada via IA (semana 6-7)
- Lista curada de domínios confiáveis pra cada categoria LIE
- CF `buscarMidiaEspecializada(descricao, categoria, uf)` que faz WebSearch + extração + scoring
- IA classifica resultados: confiável/suspeito/lixo
- Screenshot PDF + timestamp + link arquivado no Storage

### Fase 7 — Tier 3: 3 fornecedores assistido (semana 8)
- Busca CNPJs que prestam serviço por UF + categoria
- Gera carta de solicitação padronizada
- UI pra usuário registrar resposta de cada fornecedor

### Fase 8 — Ampliação de fontes federais + estaduais (semana 9)
- TCE-SP Audesp Fase IV
- TCE-MG SICOM
- ANVISA (se houver itens médicos)
- ANP (se houver combustíveis)

### Resumo
**9 semanas, 1 dev sênior, ~R$5-10/mês operacional.**

Pode ser parcelado: depois da Fase 5 (semana 5) o sistema já está utilizável pros casos cobertos pelo catálogo. Fases 6-8 vão melhorando coverage progressivamente.

---

## 7. Custos Gemini revisados

| Operação | Volume | Custo |
|---|---|---|
| Tokenização busca PDM (Gemini Flash) | ~50 cadastros/mês × 200 tok | R$0,02 |
| Justificativa de PDMs candidatos | 50 × 5 PDMs × 100 tok | R$0,05 |
| IA classifica resultados Tier 2 | 10 cadastros sem PDM × 10 resultados × 300 tok | R$0,30 |
| **Total Gemini** | | **~R$0,40/mês** |

Plus Firestore (negligível). **Operacional ~R$5/mês contando outras CFs.**

---

## 8. Risco residual e mitigação

| Risco | Mitigação |
|---|---|
| PDM escolhido não tem atributos suficientes (catálogo defeituoso) | Tier 2 disponível como saída por característica |
| Usuário escolhe atributos errados sem perceber | Mostra preview "isso vai trazer X cotações" antes de salvar |
| Cache de PDMs desatualiza | Job mensal + flag manual de re-sync no admin |
| IA classifica errado no Tier 2 (lixo passa) | Usuário sempre confirma antes de incluir na cesta + screenshot evidencial |
| Tier 3 (3 fornecedores) demanda muito do usuário | IA pré-popula candidatos; usuário só confirma e copia/cola resposta |

---

## 9. Pergunta de execução pra você

Posso começar pela **Fase 1 (reset + restauração)** agora? São 2-3 horas de trabalho:

1. Script de restauração que devolve os nomes/descrições/unidades originais aos 192 itens
2. Adiciona campo `precisaCompletarWizard` 
3. Remove botões "Padronizar Nomenclatura" e "Atualizar Mercado em Lote" da UI
4. Remove (ou desativa) CF `padronizarItemNomenclatura`
5. Adiciona badge visual "🔧 Completar cadastro" nos itens

Mantém intacto: `consultarPrecosMulti`, `coletarMercadoItem`, `traduzirTermoCatmat`, todo o fluxo de pesquisa atual (continuam funcionando como estão pra você não ficar sem nada).

Te avisa quando terminar — não vou empilhar features sem confirmação.

OK pra começar?
