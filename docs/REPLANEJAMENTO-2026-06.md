# Replanejamento do Sistema LIE — Diagnóstico e Redesenho

> Data: 2026-06-17 · Decisão do dono (Luiz): parar o desenvolvimento incremental e
> replanejar. Foco nas 3 áreas problemáticas: **elaboração, pesquisa de preço,
> prestação de contas.** Base do diagnóstico: mapeamento das 4 frentes (elaboração,
> pesquisa de preço, execução/prestação de contas, arquitetura/dados).

---

## 1. Por que o sistema "não flui" — as 6 causas-raiz

### C1. A jornada está fragmentada em ~22 telas soltas
Não existe um "lugar do projeto". Para elaborar **um** projeto o usuário pula entre
5+ telas independentes: `/projetos/:id` → `/itens` (Banco) → `/projetos/:id/itens`
→ `/projetos/:id/cronograma` → `/projetos/:id/documentos`. Cada salto é troca de
contexto e perda de fio.

### C2. O Banco de Itens é um pré-requisito que trava a elaboração (maior atrito)
Para adicionar um item ao projeto, se ele não existe no Banco global, o usuário tem
que **sair do projeto**, ir ao Banco (`/itens`), criar o item, (idealmente pesquisar
o preço), e **voltar** ao projeto para vincular. Estimativa de retrabalho: **45–90
min por projeto** só com esse vai-e-volta.

### C3. Dados espelhados em dois lugares (sem fonte única)
O mesmo item — e sua pesquisa de preço — vive em `items/{id}` (global) **e** em
`projects/{id}/items/{id}` (cópia). Uma sincronização automática silenciosa roda a
cada abertura e às vezes **reverte o que o usuário digitou** (ex.: editou o nome no
projeto, salvou, voltou ao original do Banco). Risco de divergência e confusão.

### C4. Pesquisa de preço é poderosa, mas complexa e escondida
O motor é bom (Compras.gov/PNCP + saneamento TCU + certificado com QR/validação
pública). Mas: está **fora da elaboração** (escondida no Banco), espalhada em **3
modais** (Pesquisa + Banco de Preços + Detalhe de Mercado), e o caso "sem CATMAT"
oferece **3 caminhos sem nenhum marcado como recomendado**. Embalagem confunde.

### C5. Prestação de contas praticamente não existe
O modelo `Relatorio` está definido em `types.ts` mas **nenhuma tela o cria ou
submete**. O e-mail ao fornecedor é **simulado** (`console.log`, não envia nada). Não
há síntese automática da execução → relatório. A saída final hoje são 3–4 PDFs
separados (pesquisa, dossiê da entidade, cronograma) — **falta o relatório oficial
de prestação de contas consolidado.** É o gap mais grave.

### C6. Execução desconectada do planejamento
O cronograma **planejado** (`cronograma`) e a execução **real** (`execucao`) não
conversam; nada sintetiza um a partir do outro. `Despesa` e `ExecucaoMensal` coexistem
sem integração. `valorAprovado/Captado/Executado` não se atualizam sozinhos.

### Sintomas técnicos que sustentam tudo isso
- **3 arquivos gigantes** concentram ~37% do frontend: `ItensMasterPage` (2.066),
  `ProjetoItensPage` (1.111), `ProjetoFormPage` (1.076), + `PesquisaPrecoModal` (1.936).
- Regra de negócio dentro do componente React; **sem camada de serviços/hooks**.
- Sem checklist de completude / "onde estou" no projeto.
- `ItemMaster` virou um "banheiro de avó" com 80+ campos de ondas sucessivas
  (CATMAT → embalagem → wizard → padronização IA revertida).
- Mudar o período do projeto **apaga o cronograma** sem undo.

---

## 2. A jornada que o sistema DEVERIA ter (ponta a ponta)

O LIE é, na essência, **uma linha do tempo única por projeto**. O redesenho gira em
torno disso — os dados fluem para frente, nada é redigitado:

```
0. CADASTROS BASE        Entidade proponente · Fornecedores         (reutilizáveis)
        │
1. ELABORAÇÃO            Plano de trabalho + Itens/Orçamento + Cronograma
        │                (criar item no contexto do projeto, sem ir ao Banco)
        ▼
2. PESQUISA DE PREÇO     Justificar cada valor — embutida no item, 1 fluxo só
        │                (recomenda o caminho; gera o certificado)
        ▼
3. CAPTAÇÃO              Registrar aportes/patrocínio até o valor aprovado
        │                (valores se somam sozinhos)
        ▼
4. EXECUÇÃO              Mês a mês: o que foi feito + NF/pagamento/extrato por fornecedor
        │                (puxa itens, fornecedores e metas já cadastrados)
        ▼
5. PRESTAÇÃO DE CONTAS   Relatório consolidado (físico + financeiro) gerado da execução
                         (criar → submeter → aprovar; UM documento, não 4)
```

---

## 3. Princípios do redesenho

1. **Workspace único do projeto.** Em vez de 22 telas soltas, uma tela-mãe do projeto
   com etapas e um painel de progresso ("onde estou / o que falta").
2. **Item no contexto.** Adicionar item direto no projeto; ir para o catálogo global é
   efeito colateral automático, não pré-requisito. Acaba o vai-e-volta (mata C2).
3. **Fonte única de verdade.** Acabar com o espelhamento item/pesquisa em duas coleções
   — o projeto referencia, e congela um *snapshot* só no momento de fechar a pesquisa,
   com regra explícita (mata C3).
4. **Pesquisa embutida e unificada.** Um fluxo só (Compras/PNCP + Banco de Preços +
   Manual), dentro do item do projeto, com caminho recomendado (mata C4).
5. **Prestação de contas de verdade.** A execução mensal alimenta automaticamente o
   relatório (resumo, físico-financeiro, comprovantes); fluxo criar→submeter→aprovar;
   um documento consolidado (mata C5/C6).
6. **Valores derivados.** Aprovado/captado/executado calculados, nunca digitados.

---

## 4. O que PRESERVAR vs RECONSTRUIR

**Preservar (é valioso e funciona — jogar fora seria desperdício):**
- Motor de pesquisa de preço + saneamento TCU + integração Compras.gov/PNCP.
- Integração CATMAT/CATSER + cache CNBS + wizard de atributos.
- Geração de PDF (certificados, QR code, validação pública por token).
- Cloud Functions (puppeteer de editais, banco de preços, mercado).
- Modelo de dados no Firestore (em boa parte) e **os dados já cadastrados.**

**Reconstruir:**
- A camada de **fluxo/UX**: workspace unificado, navegação por etapas, progresso.
- **Eliminar a duplicação** item/pesquisa (fonte única).
- **Construir a prestação de contas** (Relatorio + síntese da execução + 1 PDF).
- **Quebrar os 3 arquivos gigantes**; extrair serviços e hooks reutilizáveis.

---

## 5. Abordagem recomendada: Reorganização profunda (híbrida)

Nem reescrita do zero (descartaria os motores difíceis que já funcionam), nem refactor
cosmético (não resolve a fragmentação). A recomendação é **preservar os motores e
reconstruir o fluxo em volta deles**, eliminando duplicação e construindo o que falta.

### Faseamento sugerido (entregas independentes, cada uma já melhora a vida)
- **Fase 1 — Workspace de elaboração.** Tela-mãe do projeto + criação de item no
  contexto + fonte única. Mata o maior atrito (C2/C3). *Maior ganho percebido.*
- **Fase 2 — Pesquisa de preço unificada e embutida.** Um fluxo só, recomendado (C4).
- **Fase 3 — Execução conectada ao planejamento.** Cronograma ↔ execução real (C6).
- **Fase 4 — Prestação de contas.** O relatório oficial consolidado (C5). *Maior gap.*

---

## 6. Decisões do dono (2026-06-17)
- [x] Abordagem: **reorganização profunda híbrida** (preserva motores, reconstrói fluxo).
- [x] Começar pela **Fase 1 — Workspace de Elaboração**.
- [ ] Confirmar o modelo de dados: snapshot congelado vs referência viva (ver §7).

---

## 7. Plano da Fase 1 — Workspace de Elaboração

**Objetivo:** transformar a elaboração de "pular entre 5 telas + vai-e-volta ao Banco"
para **um só lugar**, e acabar com a duplicação silenciosa de dados (C1, C2, C3).

### Entregas
1. **Workspace do projeto** (`/projetos/:id`): tela-mãe com navegação lateral por
   seções — *Plano de trabalho · Itens & Orçamento · Cronograma · Documentos* — e um
   **painel de progresso** ("o que falta pra concluir"). As rotas separadas de hoje
   viram seções dentro do workspace, reaproveitando os componentes existentes (só
   recompõe o invólucro; não reescreve o conteúdo).
2. **Item no contexto:** na seção Itens, "Adicionar item" busca no catálogo global E
   permite **criar item novo ali mesmo** (nome, unidade, valor, categoria, +CATMAT
   opcional) sem sair do projeto. O item criado é publicado no catálogo automaticamente
   (segue reutilizável) e entra no projeto. Mata C2.
3. **Fonte única + snapshot explícito:** remove a sincronização silenciosa que reverte
   edições. O item do projeto guarda um *snapshot* dos campos no momento da inclusão; o
   catálogo é ponto de partida, não dono retroativo. Divergências viram um botão
   explícito **"Atualizar deste item do catálogo"** que mostra o que mudou antes de
   aplicar. Mata C3.
4. **Progresso/checklist:** painel com o estado real do projeto (plano? itens?
   cronograma? pesquisa? documentos?) — o "onde estou" que falta hoje.

### Modelo de dados DEFINIDO pelo dono (2026-06-17)
> **Catálogo de itens é único para todos os projetos, atualizado anualmente. Depois
> que o item entra no projeto, ele não é mais alterado.**

Implicações:
- O catálogo global (`items/`) é a base, mantida **uma vez por ano**.
- Ao adicionar um item ao projeto, congela-se um **snapshot imutável** (nome,
  descrição, unidade, valor, CATMAT, pesquisa). O projeto **nunca** re-sincroniza.
- A **sincronização automática silenciosa é REMOVIDA** (era a causa de C3 — revertia
  edições). Não há botão de "atualizar do catálogo": item no projeto = congelado.
- Campos do projeto que continuam editáveis: apenas os específicos do projeto
  (quantidade, memorial de cálculo, alocação no cronograma, fornecedores).

### Ordem de implementação (incremental, cada passo testável e deployável)
1. Esqueleto do workspace + navegação lateral + painel de progresso (sem mexer em dados).
2. Embutir as seções existentes (plano, itens, cronograma, documentos) no workspace.
3. Criar item no contexto (picker + "criar aqui").
4. Trocar a sync silenciosa pelo snapshot + "atualizar do catálogo" explícito.

### Segurança da migração
Itens já vinculados continuam funcionando; o snapshot passa a valer dali pra frente.
Nada de dado existente é apagado.
