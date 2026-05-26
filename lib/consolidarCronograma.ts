import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, storage } from './firebase';
import type { Projeto, Entidade, ItemProjeto } from '../types';

function downloadStorageFileUrl(path: string): string {
  const projectId = storage.app.options.projectId;
  return `https://us-central1-${projectId}.cloudfunctions.net/downloadStorageFile?path=${encodeURIComponent(path)}`;
}

const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

interface PDFState {
  pdf: jsPDF;
  y: number;
  cor: [number, number, number];
  entidade: Entidade;
  logoBase64: string | null;
  projetoTitulo: string;
}

function softenColor(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  if (r > 120 && r > g * 1.3 && r > b * 1.3) {
    return [141, 23, 44]; // Vinho/Burgundy corporativo e elegante (#8D172C)
  }
  return rgb;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [22, 163, 74]; // Fallback para verde LIE (#16A34A)
  
  const rawRgb: [number, number, number] = [r, g, b];
  return softenColor(rawRgb);
}

function lightenRgb(rgb: [number, number, number], amount = 0.92): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * amount),
    Math.round(rgb[1] + (255 - rgb[1]) * amount),
    Math.round(rgb[2] + (255 - rgb[2]) * amount),
  ];
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  let fetchUrl = url;
  if (url.includes('firebasestorage.googleapis.com')) {
    const match = url.match(/\/o\/([^?]+)/);
    const path = match ? decodeURIComponent(match[1]) : null;
    if (path) fetchUrl = downloadStorageFileUrl(path);
  }

  try {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Falha ao baixar imagem:', url, e);
    return null;
  }
}

function getImgFormat(url: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (url.toLowerCase().includes('.png') || url.startsWith('data:image/png')) return 'PNG';
  if (url.toLowerCase().includes('.webp') || url.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
}

function drawLetterheadHeader(pdf: jsPDF, entidade: Entidade, logoBase64: string | null, cor: [number, number, number]) {
  if (logoBase64) {
    try {
      const format = getImgFormat(entidade.logoUrl || '');
      pdf.addImage(logoBase64, format, MARGIN, 7, 16, 16);
    } catch (e) {
      console.warn('Erro ao desenhar logo no cabeçalho:', e);
    }
  }

  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(50, 50, 50);
  pdf.text(entidade.nome.toUpperCase(), PAGE_W / 2, 14, { align: 'center' });

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(110, 110, 110);
  pdf.text(`CNPJ: ${entidade.cnpj}`, PAGE_W / 2, 19, { align: 'center' });

  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, 26, PAGE_W - MARGIN, 26);
}

function drawLetterheadFooter(
  pdf: jsPDF,
  entidade: Entidade,
  pageNum: number,
  total: number,
  rubricaUrl?: string
) {
  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, 280, PAGE_W - MARGIN, 280);

  const addressParts = [
    entidade.logradouro && entidade.numero ? `${entidade.logradouro}, ${entidade.numero}` : entidade.logradouro,
    entidade.complemento,
    entidade.bairro,
    entidade.cidade && entidade.uf ? `${entidade.cidade}/${entidade.uf}` : (entidade.cidade || entidade.uf),
    entidade.cep ? `CEP ${entidade.cep}` : null
  ].filter(Boolean);
  const addressText = addressParts.join(' - ') || 'Endereço não cadastrado';

  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(110, 110, 110);
  pdf.text(addressText, PAGE_W / 2, 284, { align: 'center' });

  const telefonesStr = (entidade.telefones || []).join(' / ') || 'Não informado';
  const contactsText = `Telefone: ${telefonesStr}  |  E-mail: ${entidade.email || 'Não informado'}`;
  pdf.text(contactsText, PAGE_W / 2, 288, { align: 'center' });

  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(130, 130, 130);
  pdf.text(`Página ${pageNum} de ${total}`, PAGE_W / 2, 292, { align: 'center' });

  if (rubricaUrl) {
    try {
      pdf.addImage(rubricaUrl, getImgFormat(rubricaUrl), 10, PAGE_H - 14, 10, 10);
    } catch {}
  }
}

function checkPageSpace(state: PDFState, neededSpace: number) {
  if (state.y > 275 - neededSpace) {
    state.pdf.addPage();
    state.y = 33;
    drawLetterheadHeader(state.pdf, state.entidade, state.logoBase64, state.cor);
  }
}

function forceNewPage(state: PDFState) {
  state.pdf.addPage();
  state.y = 33;
  drawLetterheadHeader(state.pdf, state.entidade, state.logoBase64, state.cor);
}

function addSectionTitle(state: PDFState, title: string) {
  checkPageSpace(state, 20);
  
  const { pdf, cor } = state;
  const y = state.y;
  const light = lightenRgb(cor, 0.92);
  
  pdf.setFillColor(...light);
  pdf.rect(MARGIN, y - 4, CONTENT_W, 8, 'F');
  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4);
  pdf.setFontSize(10.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...cor);
  pdf.text(title, MARGIN + 2, y + 1.5);
  
  state.y = y + 10;
}

function getMesNomeAno(mesInicio: string, numeroMes: number): string {
  if (!mesInicio) return `Mês ${numeroMes}`;
  const [yearStr, monthStr] = mesInicio.split('-');
  let y = parseInt(yearStr, 10);
  let m = parseInt(monthStr, 10);
  
  m += (numeroMes - 1);
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  
  const mesesExtenso = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return `${mesesExtenso[m - 1]} / ${y}`;
}

export async function consolidarCronograma(
  projetoId: string,
  allocations: Record<string, Record<number, number>>,
  rubricaUrl?: string
): Promise<void> {
  const projSnap = await getDoc(doc(db, 'projects', projetoId));
  if (!projSnap.exists()) throw new Error('Projeto não encontrado');
  const projeto = { id: projSnap.id, ...projSnap.data() } as Projeto;

  const entSnap = await getDoc(doc(db, 'entities', projeto.entidadeId));
  if (!entSnap.exists()) throw new Error('Entidade do projeto não encontrada');
  const entidade = { id: entSnap.id, ...entSnap.data() } as Entidade;

  // Buscar itens do projeto
  const itemsSnap = await getDocs(collection(db, `projects/${projetoId}/items`));
  const itensProjeto = itemsSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as ItemProjeto))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  const cor = hexToRgb((entidade as any).corPredominante || '#16A34A');
  const corClara = lightenRgb(cor, 0.90);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // Pre-carregar logotipo
  let logoBase64: string | null = null;
  if (entidade.logoUrl) {
    try {
      logoBase64 = await fetchImageAsBase64(entidade.logoUrl);
    } catch (e) {
      console.warn('Erro ao carregar logo da entidade:', e);
    }
  }

  // ========== CAPA DO PROJETO (SEM REPETIR DADOS DA ENTIDADE) ==========
  pdf.setFillColor(248, 250, 252); // Fundo off-white luxuoso
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Faixa vertical decorativa
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, 15, PAGE_H, 'F');

  // Logotipo
  const logoCapa = projeto.logoUrl || entidade.logoUrl;
  if (logoCapa) {
    try {
      const imgData = await fetchImageAsBase64(logoCapa);
      if (imgData) {
        pdf.addImage(imgData, getImgFormat(logoCapa), 50, 50, 45, 45);
      }
    } catch (e) {
      console.error('Erro ao renderizar logo na capa:', e);
    }
  }

  // Linha horizontal decorativa
  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.6);
  pdf.line(50, 110, 170, 110);

  // Textos da Capa
  pdf.setTextColor(100, 100, 100);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('CRONOGRAMA DE EXECUÇÃO FINANCEIRA', 50, 120);

  pdf.setTextColor(...cor);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  const projTitleLines = pdf.splitTextToSize(projeto.titulo?.toUpperCase() || '', 120);
  pdf.text(projTitleLines, 50, 132);

  pdf.setTextColor(60, 60, 60);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PROPONENTE:', 50, 175);
  pdf.setFont('helvetica', 'normal');
  const entNameLines = pdf.splitTextToSize(entidade.nome || '', 120);
  pdf.text(entNameLines, 50, 183);

  pdf.setTextColor(140, 140, 140);
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${entidade.cidade || 'São Paulo'} / ${entidade.uf || 'SP'}, 2026`, 50, 255);

  // Inicializar estado para as páginas seguintes
  const state: PDFState = {
    pdf,
    y: 33,
    cor,
    entidade,
    logoBase64,
    projetoTitulo: projeto.titulo
  };

  // ========== PAG. 1 - RELAÇÃO DE ITENS ==========
  forceNewPage(state);
  addSectionTitle(state, 'Relação de Itens do Projeto');

  const itemsBody = itensProjeto.map((it, idx) => [
    `${idx + 1}`,
    it.nome,
    it.descricao || '-',
    it.memorialCalculo || '-',
    it.unidade
  ]);

  autoTable(pdf, {
    startY: state.y,
    head: [['Item', 'Nome', 'Descrição', 'Memorial de Cálculo', 'Unidade']],
    body: itemsBody,
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9, textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 40 },
      2: { cellWidth: 50 },
      3: { cellWidth: 55 },
      4: { cellWidth: 15 },
    },
    didDrawPage: (data) => {
      const pageCount = data.doc.internal.getNumberOfPages();
      if (pageCount > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    }
  });

  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== PAG. 2 - CRONOGRAMA DE EXECUÇÃO FINANCEIRA ==========
  forceNewPage(state);
  addSectionTitle(state, 'Cronograma de Execução Financeira Mensal');
  state.y += 2;

  const duracaoMeses = projeto.duracaoMeses || 12;

  for (let m = 1; m <= duracaoMeses; m++) {
    const mesNome = getMesNomeAno(projeto.mesInicio || '', m);
    checkPageSpace(state, 40);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(60, 60, 60);
    pdf.text(`Mês/Etapa ${m} - ${mesNome}`, MARGIN, state.y);
    state.y += 4;

    const monthlyAllocations: any[] = [];
    let subtotalMes = 0;

    itensProjeto.forEach(it => {
      const qty = (allocations[it.id] || {})[m] || 0;
      if (qty > 0) {
        const itemValTotal = qty * it.valorUnitario;
        subtotalMes += itemValTotal;
        monthlyAllocations.push([
          it.nome,
          it.unidade,
          it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          qty,
          itemValTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        ]);
      }
    });

    if (monthlyAllocations.length === 0) {
      monthlyAllocations.push([
        'Sem movimentação financeira prevista',
        '-',
        '-',
        '-',
        '-'
      ]);
    } else {
      // Adicionar linha de total do mês
      monthlyAllocations.push([
        { content: 'SUBTOTAL DO MÊS:', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: subtotalMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), styles: { fontStyle: 'bold', fillColor: lightenRgb(cor, 0.95) } }
      ]);
    }

    autoTable(pdf, {
      startY: state.y,
      head: [['Item', 'Unidade', 'Valor Unitário', 'Quantidade', 'Valor Total']],
      body: monthlyAllocations,
      margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
      headStyles: { fillColor: cor, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: corClara },
      styles: { fontSize: 9, textColor: [0, 0, 0] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 15, halign: 'center' },
        2: { cellWidth: 25, halign: 'right' },
        3: { cellWidth: 25, halign: 'center' },
        4: { cellWidth: 25, halign: 'right' },
      },
      didDrawPage: (data) => {
        const pageCount = data.doc.internal.getNumberOfPages();
        if (pageCount > 1) {
          drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
        }
      }
    });

    state.y = (pdf as any).lastAutoTable.finalY + 8;
  }

  // ========== PAG. 3 - RESUMO FINANCEIRO ==========
  forceNewPage(state);
  addSectionTitle(state, 'Resumo Financeiro do Cronograma');
  state.y += 2;

  const totalProjeto = itensProjeto.reduce((acc, it) => acc + it.valorTotal, 0);
  const resumoBody: any[] = [];
  let acumulado = 0;

  for (let m = 1; m <= duracaoMeses; m++) {
    const mesNome = getMesNomeAno(projeto.mesInicio || '', m);
    let valorMes = 0;

    itensProjeto.forEach(it => {
      const qty = (allocations[it.id] || {})[m] || 0;
      valorMes += qty * it.valorUnitario;
    });

    acumulado += valorMes;
    const porcentagem = totalProjeto > 0 ? (valorMes / totalProjeto) * 100 : 0;

    resumoBody.push([
      `Etapa ${m}`,
      mesNome,
      valorMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      `${porcentagem.toFixed(2)}%`
    ]);
  }

  // Linha final do resumo
  resumoBody.push([
    { content: 'TOTAL GERAL:', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: totalProjeto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), styles: { fontStyle: 'bold', fillColor: lightenRgb(cor, 0.95) } },
    { content: '100.00%', styles: { fontStyle: 'bold', fillColor: lightenRgb(cor, 0.95) } }
  ]);

  autoTable(pdf, {
    startY: state.y,
    head: [['Etapa', 'Mês de Execução', 'Valor Previsto', 'Porcentagem (%)']],
    body: resumoBody,
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9, textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 60 },
      2: { cellWidth: 45, halign: 'right' },
      3: { cellWidth: 35, halign: 'center' },
    },
    didDrawPage: (data) => {
      const pageCount = data.doc.internal.getNumberOfPages();
      if (pageCount > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    }
  });

  // Renderizar rodapés, paginação e rubricas nas páginas de miolo (página 2 em diante)
  const total = (pdf as any).internal.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    pdf.setPage(i);
    drawLetterheadFooter(pdf, entidade, i, total, rubricaUrl);
  }

  pdf.save(`Cronograma_Financeiro_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
}
