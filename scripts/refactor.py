import sys
import re

file_path = 'lib/consolidarProjeto.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add PrintOptions and modify signature
old_sig = "export async function consolidarProjeto(projetoId: string, rubricaUrl?: string): Promise<void> {"
new_sig = """export interface PrintOptions {
  projeto: boolean;
  pesquisa: boolean;
  documentosEntidade: boolean;
  certidoes: boolean;
  numerarRubricar: boolean;
  rubricaUrl?: string;
}

export async function consolidarProjeto(projetoId: string, options: PrintOptions = { projeto: true, pesquisa: true, documentosEntidade: false, certidoes: false, numerarRubricar: false }): Promise<void> {
  const rubricaUrl = options.numerarRubricar ? options.rubricaUrl : undefined;
"""
content = content.replace(old_sig, new_sig)

# 2. Wrap CAP 1 to CAP 10
cap1_start = "  // ========== CAP 1: IDENTIFICAÇÃO DO PROJETO (página 3) =========="
content = content.replace(cap1_start, "  if (options.projeto) {\n" + cap1_start)

cap11_start = "  // ========== CAP 11: RELATÓRIO DE PESQUISA DE PREÇOS CONSOLIDADO (IN 65/2021) =========="
content = content.replace(cap11_start, "  }\n\n" + cap11_start + "\n  if (options.pesquisa) {")

# 3. Handle footer logic inside options.pesquisa scope? No, footer was globally drawn.
footer_loop_old = """  for (let i = 3; i <= totalPages; i++) {
    pdf.setPage(i);
    drawLetterheadFooter(pdf, entidade, i, totalPages, rubricaUrl);
  }"""
footer_loop_new = """  }
  
  if (!options.numerarRubricar && options.projeto) {
    for (let i = 3; i <= totalPages; i++) {
      pdf.setPage(i);
      drawLetterheadFooter(pdf, entidade, i, totalPages, rubricaUrl);
    }
  }
"""
content = content.replace(footer_loop_old, footer_loop_new)

# 4. Modify PDF-Lib merging logic
merging_logic_old = """    for (const it of itensPesquisados) {
      if (it.referencias && Array.isArray(it.referencias)) {
        for (const r of it.referencias) {
          try {
            if (r.fonte === 'fomento' && r.localizacaoUrl) {
              console.log(`Efetuando a juntada de documento manual: ${r.arquivoNome || r.identificadorCompra} de ${r.orgaoLicitante}`);
              const bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
              const docToMerge = await PDFDocument.load(bytes);
              const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
              copiedPages.forEach(page => {
                mainPdfDoc.addPage(page);
              });
            } else if (r.fonte === 'compras.gov.br' || r.fonte === 'pncp') {
              console.log(`Efetuando a juntada de documento público: ${r.identificadorCompra} de ${r.orgaoLicitante}`);
              const bytes = await obterPdfPublicoCacheado(r);
              if (bytes) {
                const docToMerge = await PDFDocument.load(bytes);
                const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
                copiedPages.forEach(page => {
                  mainPdfDoc.addPage(page);
                });
              }
            }
          } catch (err) {
            console.error(`Falha ao juntar documento de cotação de ${r.orgaoLicitante}:`, err);
          }
        }
      }
    }"""

merging_logic_new = """    if (options.pesquisa) {
      for (const it of itensPesquisados) {
        if (it.referencias && Array.isArray(it.referencias)) {
          for (const r of it.referencias) {
            try {
              if (r.fonte === 'fomento' && r.localizacaoUrl) {
                console.log(`Efetuando a juntada de documento manual: ${r.arquivoNome || r.identificadorCompra} de ${r.orgaoLicitante}`);
                const bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
                if (bytes) {
                  const docToMerge = await PDFDocument.load(bytes);
                  const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
                  copiedPages.forEach(page => mainPdfDoc.addPage(page));
                }
              } else if ((r.fonte === 'compras.gov.br' || r.fonte === 'pncp') && r.localizacaoUrl) {
                console.log(`Efetuando a juntada de documento público (via URL): ${r.identificadorCompra} de ${r.orgaoLicitante}`);
                const bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
                if (bytes) {
                  const docToMerge = await PDFDocument.load(bytes);
                  const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
                  copiedPages.forEach(page => mainPdfDoc.addPage(page));
                }
              } else if (r.fonte === 'compras.gov.br' || r.fonte === 'pncp') {
                console.log(`Efetuando a juntada de documento público (via Cache): ${r.identificadorCompra} de ${r.orgaoLicitante}`);
                const bytes = await obterPdfPublicoCacheado(r);
                if (bytes) {
                  const docToMerge = await PDFDocument.load(bytes);
                  const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
                  copiedPages.forEach(page => mainPdfDoc.addPage(page));
                }
              }
            } catch (err) {
              console.error(`Falha ao juntar documento de cotação de ${r.orgaoLicitante}:`, err);
            }
          }
        }
      }
    }

    if (options.documentosEntidade || options.certidoes) {
      const entDocsSnap = await getDocs(collection(db, `entities/${projeto.entidadeId}/documentos`));
      const entDocs = entDocsSnap.docs.map(d => d.data());
      for (const d of entDocs) {
        if (!d.arquivoUrl) continue;
        const isCertidao = d.tipo === 'Certidão';
        if ((options.certidoes && isCertidao) || (options.documentosEntidade && !isCertidao)) {
          try {
            console.log(`Juntada de doc da entidade: ${d.nome}`);
            const bytes = await fetchPdfAsArrayBuffer(d.arquivoUrl);
            if (bytes) {
              const docToMerge = await PDFDocument.load(bytes);
              const copiedPages = await mainPdfDoc.copyPages(docToMerge, docToMerge.getPageIndices());
              copiedPages.forEach(page => mainPdfDoc.addPage(page));
            }
          } catch(e) {
             console.error(`Falha ao juntar doc ${d.nome}:`, e);
          }
        }
      }
    }

    if (options.numerarRubricar) {
      const pages = mainPdfDoc.getPages();
      const totalMergedPages = pages.length;
      
      let rubricaImage = null;
      if (rubricaUrl) {
        try {
          const imgBytes = await fetch(rubricaUrl).then(res => res.arrayBuffer());
          rubricaImage = await mainPdfDoc.embedPng(imgBytes);
        } catch(e) { console.error('Falha ao embutir rubrica no pdf-lib', e); }
      }

      for (let i = 2; i < totalMergedPages; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        
        page.drawText(`Página ${i + 1} de ${totalMergedPages}`, {
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
"""

content = content.replace(merging_logic_old, merging_logic_new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Python refactoring completed successfully.")
