# Plano de Implementação — Salvaguardas e Duplicação de Projetos

Este plano descreve o design e as alterações para implementar salvaguardas na edição do período de execução e uma funcionalidade de duplicação para o módulo de projetos do sistema LIE.

## Revisão do Usuário Necessária

> [!IMPORTANT]
> Todas as alterações serão desenvolvidas e testadas exclusivamente no **ambiente local** (`http://localhost:3001`). Nenhum código de produção será alterado ou publicado até que o usuário solicite explicitamente a replicação.

### Regras de Salvaguarda para Modificação do Período de Execução
Ao editar um projeto e alterar o `mesInicio` (Mês de Início) ou o `mesTermino` (Mês de Término):
1. **Bloqueio de Execução**: Se o projeto possuir lançamentos na execução mensal (`projects/${id}/execucao` com quantidades maiores que zero ou anexos de Notas Fiscais/Comprovantes) OU se houver fornecedores indicados para os itens do projeto (`ItemProjeto.fornecedoresIds` preenchido), exiba a seguinte mensagem e **impeça o salvamento**:
   > *"Você possui o módulo Execução preenchido neste projeto, por isso não é possível alterar o período de execução."*
2. **Aviso de Reset do Cronograma**: Se não houver execuções ativas ou fornecedores indicados, mas o projeto já tiver itens distribuídos nos meses (`projects/${id}/cronograma` preenchido), exiba um diálogo de confirmação:
   > *"Este projeto já possui Cronograma de Execução, se continuar com a alteração de período, o cronograma de execução será apagado e deverá ser cadastrado novamente. Deseja continuar?"*
   - Se o usuário clicar em **SIM**, limpe/exclua todos os registros na subcoleção `projects/${id}/cronograma`, salve as novas datas do projeto e recalcule a `duracaoMeses`.
   - Se o usuário clicar em **CANCELAR / NÃO**, aborte o salvamento do formulário.

### Lógica de Duplicação de Projeto
Adicione um botão de ação **"Duplicar Projeto"** na lista de projetos.
Ao clicar no botão, duplique todo o módulo do projeto:
1. **Dados Gerais do Projeto (`projects/${id}`)**: Crie um novo documento com:
   - `id`: novo ID gerado automaticamente.
   - `titulo`: `[Cópia] <titulo_original>`
   - `nome`: `[Cópia] <nome_original>` (se aplicável).
   - `status`: `'em_elaboracao'` (status padrão de novos projetos).
   - `valorExecutado`: `0`
   - `valorCaptado`: `0`
   - `criadoEm` e `atualizadoEm`: `serverTimestamp()`
2. **Itens do Projeto (`projects/${id}/items`)**: Clone todos os itens vinculados ao projeto original na nova subcoleção, mas limpe os vínculos de fornecedores:
   - `fornecedoresIds`: `[]` (zerar os fornecedores vinculados na execução).
3. **Documentos do Projeto (`projects/${id}/documentos`)**: Clone todos os documentos do projeto original na nova subcoleção.
4. **Módulo de Execução (`cronograma` e `execucao`)**: Não copie esses dados; mantenha o novo projeto totalmente zerado para a parte de execução.

---

## Alterações Propostas

### Componentes e Páginas

#### [MODIFICAR] [ProjetoFormPage.tsx](file:///c:/Users/rafae/Projetos/LIE/pages/ProjetoFormPage.tsx)
- Armazene os valores originais de `mesInicio` e `mesTermino` no estado para detectar se houve alteração no salvamento.
- Implemente rotinas de validação dentro de `handleSubmit` para verificar se existem execuções e cronogramas ativos.
- Se houver execução, exiba o alerta impeditivo e aborte.
- Se houver cronograma, exiba o diálogo de confirmação. Se aceito, exclua os documentos da subcoleção de cronograma usando gravação em lote (`writeBatch`) e prossiga com o salvamento.

#### [MODIFICAR] [ProjetosPage.tsx](file:///c:/Users/rafae/Projetos/LIE/pages/ProjetosPage.tsx)
- Refatore o carregamento de projetos para uma função reutilizável `loadProjetos`.
- Adicione um novo botão "Duplicar" na coluna de ações de cada linha de projeto (utilizando o ícone `Copy` de `lucide-react`).
- Implemente a lógica de duplicação (`handleDuplicar`) para clonar o documento principal, itens e documentos do projeto original, zerando os dados de execução.
- Atualize a listagem na tela após a duplicação concluída com sucesso.

---

## Plano de Verificação

### Verificação Manual
1. **Teste de Bloqueio por Execução**:
   - Acesse um projeto com execução ativa (quantidades informadas ou fornecedores vinculados aos itens).
   - Tente alterar a data de início ou término do projeto.
   - Confirme se o salvamento foi bloqueado com a mensagem correta: *"Você possui o módulo Execução preenchido neste projeto, por isso não é possível alterar o período de execução."*.
2. **Teste de Reset do Cronograma**:
   - Escolha um projeto com cronograma distribuído (mas sem fornecedores vinculados ou quantidades executadas).
   - Tente alterar as datas de início/término.
   - Verifique se a confirmação é exibida. Clique em SIM e confirme se o cronograma foi limpo e o período do projeto foi atualizado corretamente.
3. **Teste de Duplicação**:
   - Clique no botão de duplicação ao lado de um projeto.
   - Verifique se um novo projeto com o prefixo `[Cópia]` é criado com status "Em Elaboração".
   - Acesse as abas de Itens e Documentos do novo projeto e certifique-se de que foram totalmente copiados.
   - Acesse o Cronograma e Execução Mensal do novo projeto e confirme que estão completamente zerados.
