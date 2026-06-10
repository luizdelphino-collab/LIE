const fs = require('fs');

const path = 'lib/consolidarProjeto.ts';
let code = fs.readFileSync(path, 'utf8');

// 1. Add PrintOptions interface
code = code.replace(
  "export async function consolidarProjeto(projetoId: string, rubricaUrl?: string): Promise<void> {",
  `export interface PrintOptions {
  projeto: boolean;
  pesquisa: boolean;
  documentosEntidade: boolean;
  certidoes: boolean;
  numerarRubricar: boolean;
  rubricaUrl?: string;
}

export async function consolidarProjeto(projetoId: string, options: PrintOptions = { projeto: true, pesquisa: true, documentosEntidade: false, certidoes: false, numerarRubricar: false }): Promise<void> {
  const rubricaUrl = options.numerarRubricar ? options.rubricaUrl : undefined;`
);

// 2. Wrap CAP 1 in `if (options.projeto) {`
code = code.replace(
  "  // ========== CAP 1: IDENTIFICAÇÃO DO PROJETO (página 3) ==========",
  "  if (options.projeto) {\n  // ========== CAP 1: IDENTIFICAÇÃO DO PROJETO (página 3) =========="
);

// 3. Close CAP 10 `if (options.projeto) {` and wrap CAP 11 in `if (options.pesquisa) {`
code = code.replace(
  "  // ========== CAP 11: RELATÓRIO DE PESQUISA DE PREÇOS CONSOLIDADO (IN 65/2021) ==========",
  "  }\n\n  // ========== CAP 11: RELATÓRIO DE PESQUISA DE PREÇOS CONSOLIDADO (IN 65/2021) ==========\n  if (options.pesquisa) {"
);

// 4. Close CAP 11 `if (options.pesquisa) {` before footer generation
code = code.replace(
  "  // Rodapés nas páginas 3 em diante",
  "  }\n\n  // Rodapés nas páginas 3 em diante (apenas no que foi gerado pelo jsPDF)\n  if (!options.numerarRubricar) {\n    for (let i = 3; i <= totalPages; i++) {\n      pdf.setPage(i);\n      drawLetterheadFooter(pdf, entidade, i, totalPages, rubricaUrl);\n    }\n  }\n"
);

// Remove the old loop for Rodapés since I already replaced it
code = code.replace(
  `  for (let i = 3; i <= totalPages; i++) {
    pdf.setPage(i);
    drawLetterheadFooter(pdf, entidade, i, totalPages, rubricaUrl);
  }`,
  ``
);

// 5. Add merging logic for options.pesquisa and other documents
const mergingLogic = `
    // Buscar todas as referências dos itens pesquisados e fazer a juntada física (manuais e públicas)
    if (options.pesquisa) {
      for (const it of itensPesquisados) {
        if (it.referencias && Array.isArray(it.referencias)) {
          for (const r of it.referencias) {
            try {
              if (r.localizacaoUrl) {
                console.log(\`Efetuando a juntada do documento arquivado: \${r.identificadorCompra} de \${r.orgaoLicitante}\`);
                const bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
                if (bytes) {
                  const docToMerge = await PDFDocument.load(bytes);
                  const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
                  copiedPages.forEach(page => mainPdfDoc.addPage(page));
                }
              }
            } catch (err) {
              console.error(\`Falha ao juntar documento de cotação de \${r.orgaoLicitante}:\`, err);
            }
          }
        }
      }
    }

    // Buscar e juntar documentos/certidões da entidade
    if (options.documentosEntidade || options.certidoes) {
      const entDocsSnap = await getDocs(collection(db, \`entities/\${projeto.entidadeId}/documentos\`));
      const entDocs = entDocsSnap.docs.map(d => d.data());
      for (const d of entDocs) {
        if (!d.arquivoUrl) continue;
        const isCertidao = d.tipo === 'Certidão';
        if ((options.certidoes && isCertidao) || (options.documentosEntidade && !isCertidao)) {
          try {
            console.log(\`Juntada de doc da entidade: \${d.nome}\`);
            const bytes = await fetchPdfAsArrayBuffer(d.arquivoUrl);
            if (bytes) {
              const docToMerge = await PDFDocument.load(bytes);
              const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
              copiedPages.forEach(page => mainPdfDoc.addPage(page));
            }
          } catch(e) {
             console.error(\`Falha ao juntar doc \${d.nome}:\`, e);
          }
        }
      }
    }

    // Numeração e Rubrica Global
    if (options.numerarRubricar) {
      const pages = mainPdfDoc.getPages();
      const totalMergedPages = pages.length;
      
      let rubricaImage = null;
      if (rubricaUrl) {
        try {
          const imgBytes = await fetch(rubricaUrl).then(res => res.arrayBuffer());
          // always assuming PNG for rubrica based on modal restrictions
          rubricaImage = await mainPdfDoc.embedPng(imgBytes);
        } catch(e) { console.error('Falha ao embutir rubrica no pdf-lib', e); }
      }

      for (let i = 2; i < totalMergedPages; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        
        // Desenhar rodapé simples
        page.drawText(\`Página \${i + 1} de \${totalMergedPages}\`, {
          x: width / 2 - 30,
          y: 20,
          size: 9,
        });

        if (rubricaImage) {
          page.drawImage(rubricaImage, {
            x: 20,
            y: 15,
            width: 30,
            height: 30
          });
        }
      }
    }
`;

code = code.replace(
  `    // Buscar todas as referências dos itens pesquisados e fazer a juntada física (manuais e públicas)
    for (const it of itensPesquisados) {
      if (it.referencias && Array.isArray(it.referencias)) {
        for (const r of it.referencias) {
          try {
            if (r.localizacaoUrl) {
              console.log(\`Efetuando a juntada do documento arquivado: \${r.identificadorCompra} de \${r.orgaoLicitante}\`);
              // Todas as cotações (fomento, compras, pncp) possuem agora PDFs reais arquivados no Storage
              const bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
              if (bytes) {
                const docToMerge = await PDFDocument.load(bytes);
                const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
                copiedPages.forEach(page => {
                  mainPdfDoc.addPage(page);
                });
              }
            }
          } catch (err) {
            console.error(\`Falha ao juntar documento de cotação de \${r.orgaoLicitante}:\`, err);
          }
        }
      }
    }`,
  mergingLogic
);

fs.writeFileSync(path, code);
console.log('Refactoring completed successfully.');
