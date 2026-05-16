import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Entidade } from '../types';

interface DocItem {
  nome: string;
  arquivoUrl?: string;
  tipo?: string;
  ordem?: number;
}

interface DirigentePdf {
  id: string;
  nome: string;
  cargo?: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  escolaridade?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  ordem?: number;
  documentos?: DocItem[];
}

const toRoman = (n: number): string => {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
};

// Converte hex (#RRGGBB) → [R, G, B]
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [22, 101, 52];
  return [r, g, b];
}

// Clareia a cor para o fundo alternado das linhas
function lightenRgb(rgb: [number, number, number], amount = 0.92): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * amount),
    Math.round(rgb[1] + (255 - rgb[1]) * amount),
    Math.round(rgb[2] + (255 - rgb[2]) * amount),
  ];
}

const LINE_H = 7;
const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

function addHeader(pdf: jsPDF, entNome: string, cor: [number, number, number]) {
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, 12, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text(entNome.toUpperCase(), MARGIN, 8);
}

function addFooter(pdf: jsPDF, pageNum: number) {
  const total = (pdf as any).internal.getNumberOfPages();
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Página ${pageNum} de ${total}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
}

function addSectionTitle(pdf: jsPDF, title: string, y: number, cor: [number, number, number]): number {
  const light = lightenRgb(cor, 0.88);
  pdf.setFillColor(...light);
  pdf.rect(MARGIN, y - 5, CONTENT_W, 9, 'F');
  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...cor);
  pdf.text(title, MARGIN, y + 1);
  return y + 12;
}

function addField(pdf: jsPDF, label: string, value: string, x: number, y: number, maxW = CONTENT_W): number {
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text(label + ':', x, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(20, 20, 20);
  const lines = pdf.splitTextToSize(value || '-', maxW - 28);
  pdf.text(lines, x + 28, y);
  return y + (lines.length * LINE_H);
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function fetchPdfBytes(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function consolidarEntidade(entidadeId: string): Promise<void> {
  // 1. Carregar dados
  const entSnap = await getDoc(doc(db, 'entities', entidadeId));
  if (!entSnap.exists()) throw new Error('Entidade não encontrada');
  const entidade = { id: entSnap.id, ...entSnap.data() } as Entidade;

  const cor = hexToRgb((entidade as any).corPredominante || '#16A34A');
  const corClara = lightenRgb(cor, 0.88);

  // Documentos da entidade
  const docsEntSnap = await getDocs(collection(db, `entities/${entidadeId}/documentos`));
  const docsEntidade: DocItem[] = docsEntSnap.docs
    .map(d => (d.data() as DocItem))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  // Dirigentes e seus documentos
  const dirsSnap = await getDocs(collection(db, `entities/${entidadeId}/dirigentes`));
  const dirigentes: DirigentePdf[] = [];
  for (const dirDoc of dirsSnap.docs.sort((a, b) => ((a.data().ordem || 0) - (b.data().ordem || 0)))) {
    const dirData = { id: dirDoc.id, ...dirDoc.data() } as DirigentePdf;
    const docsDirSnap = await getDocs(collection(db, `entities/${entidadeId}/dirigentes/${dirDoc.id}/documentos`));
    dirData.documentos = docsDirSnap.docs
      .map(d => d.data() as DocItem)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    dirigentes.push(dirData);
  }

  // Lista unificada de anexos
  const allDocs: { nome: string; url?: string; source: string }[] = [];
  docsEntidade.forEach(d => allDocs.push({ nome: d.nome || d.tipo || 'Documento', url: d.arquivoUrl, source: entidade.sigla || 'Entidade' }));
  dirigentes.forEach(d => {
    (d.documentos || []).forEach(dd => {
      allDocs.push({ nome: dd.nome || dd.tipo || 'Documento', url: dd.arquivoUrl, source: d.nome });
    });
  });

  // 2. Criar PDF com jsPDF
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // ===== CAPA =====
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Faixa inferior decorativa mais escura
  const corEscura = cor.map(c => Math.max(0, c - 40)) as [number, number, number];
  pdf.setFillColor(...corEscura);
  pdf.rect(0, PAGE_H - 30, PAGE_W, 30, 'F');

  // --- Faixa branca central para o logo ---
  const faixaY = PAGE_H / 2 - 40;
  const faixaH = 80;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, faixaY, PAGE_W, faixaH, 'F');

  // Logo centralizado na faixa branca
  if ((entidade as any).logoUrl) {
    try {
      let imgData = (entidade as any).logoUrl as string;
      if (!imgData.startsWith('data:')) {
        imgData = (await fetchImageAsBase64(imgData)) || '';
      }
      if (imgData) {
        const logoSize = 60;
        pdf.addImage(imgData, 'PNG', PAGE_W / 2 - logoSize / 2, faixaY + (faixaH - logoSize) / 2, logoSize, logoSize);
      }
    } catch { /* sem logo */ }
  }

  // Nome da entidade — acima da faixa branca
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(26);
  pdf.setFont('helvetica', 'bold');
  const nomeLines = pdf.splitTextToSize(entidade.nome || '', CONTENT_W);
  pdf.text(nomeLines, PAGE_W / 2, faixaY - 20, { align: 'center' });

  // Sigla — abaixo da faixa branca
  if (entidade.sigla) {
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(255, 255, 255);
    pdf.text(entidade.sigla, PAGE_W / 2, faixaY + faixaH + 18, { align: 'center' });
  }

  // ===== SUMÁRIO =====
  pdf.addPage();
  addHeader(pdf, entidade.nome || '', cor);
  let y = 30;
  y = addSectionTitle(pdf, 'Sumário', y, cor);
  y += 6;

  const sumario = [
    ['1.', 'Dados da Entidade', '3'],
    ['2.', 'Relação de Dirigentes', '4'],
    ['3.', 'Histórico', '5'],
    ['4.', 'Capacidade Técnica e Operacional', '5'],
    ['5.', 'Tabela de Anexos', '6'],
    ['6.', 'Documentos Anexados', '7'],
  ];

  pdf.setFontSize(11);
  for (const [num, titulo, pag] of sumario) {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...cor);
    pdf.text(num, MARGIN, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(30, 30, 30);
    pdf.text(titulo, MARGIN + 10, y);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...cor);
    pdf.text(pag, PAGE_W - MARGIN, y, { align: 'right' });
    pdf.setDrawColor(210, 210, 210);
    pdf.setLineWidth(0.3);
    const ls = MARGIN + 10 + pdf.getTextWidth(titulo) + 2;
    const le = PAGE_W - MARGIN - 8;
    if (le > ls) pdf.line(ls, y - 1, le, y - 1);
    y += 11;
  }

  // ===== DADOS DA ENTIDADE =====
  pdf.addPage();
  addHeader(pdf, entidade.nome || '', cor);
  y = 30;
  y = addSectionTitle(pdf, '1. Dados da Entidade', y, cor);
  y += 4;

  pdf.setTextColor(20, 20, 20);
  y = addField(pdf, 'Razão Social', entidade.nome || '', MARGIN, y); y += 2;
  y = addField(pdf, 'Sigla', entidade.sigla || '', MARGIN, y); y += 2;
  y = addField(pdf, 'CNPJ', entidade.cnpj || '', MARGIN, y); y += 8;

  const secTitle = (t: string) => {
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(80, 80, 80);
    pdf.text(t, MARGIN, y); y += 4;
    pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.4);
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y); y += 5;
  };

  secTitle('ENDEREÇO');
  const endParts = [entidade.logradouro, entidade.numero, entidade.complemento, entidade.bairro, entidade.cidade, entidade.uf, entidade.cep].filter(Boolean).join(', ');
  y = addField(pdf, 'Endereço', endParts, MARGIN, y); y += 8;

  secTitle('CONTATO');
  y = addField(pdf, 'E-mail', entidade.email || '', MARGIN, y); y += 2;
  y = addField(pdf, 'Telefone(s)', (entidade.telefones || []).join(' / '), MARGIN, y); y += 2;
  if (entidade.site) { y = addField(pdf, 'Site', entidade.site, MARGIN, y); y += 2; }
  if (entidade.instagram) { y = addField(pdf, 'Instagram', entidade.instagram, MARGIN, y); y += 2; }
  if (entidade.linkedin) { y = addField(pdf, 'LinkedIn', entidade.linkedin, MARGIN, y); y += 2; }
  y += 4;

  if (entidade.responsavelLegal?.nome) {
    secTitle('RESPONSÁVEL LEGAL');
    y = addField(pdf, 'Nome', entidade.responsavelLegal.nome, MARGIN, y); y += 2;
    if (entidade.responsavelLegal.cargo) { y = addField(pdf, 'Cargo', entidade.responsavelLegal.cargo, MARGIN, y); y += 2; }
    if (entidade.responsavelLegal.cpf) { y = addField(pdf, 'CPF', entidade.responsavelLegal.cpf, MARGIN, y); y += 2; }
    if (entidade.responsavelLegal.email) { y = addField(pdf, 'E-mail', entidade.responsavelLegal.email, MARGIN, y); y += 2; }
    if (entidade.responsavelLegal.telefone) { y = addField(pdf, 'Telefone', entidade.responsavelLegal.telefone, MARGIN, y); }
  }

  // ===== DIRIGENTES =====
  pdf.addPage();
  addHeader(pdf, entidade.nome || '', cor);
  y = 30;
  y = addSectionTitle(pdf, '2. Relação de Dirigentes', y, cor);
  y += 4;

  if (dirigentes.length === 0) {
    pdf.setFontSize(10); pdf.setTextColor(120, 120, 120);
    pdf.text('Nenhum dirigente cadastrado.', MARGIN, y + 8);
  } else {
    for (const dir of dirigentes) {
      if (y > PAGE_H - 60) { pdf.addPage(); addHeader(pdf, entidade.nome || '', cor); y = 30; }
      pdf.setFillColor(...corClara);
      pdf.roundedRect(MARGIN, y, CONTENT_W, 8, 1, 1, 'F');
      pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...cor);
      pdf.text(dir.nome || '', MARGIN + 3, y + 6);
      y += 12;
      pdf.setTextColor(20, 20, 20);
      if (dir.cargo) { y = addField(pdf, 'Cargo', dir.cargo, MARGIN + 2, y, CONTENT_W - 2); y += 1; }
      if (dir.cpf) { y = addField(pdf, 'CPF', dir.cpf, MARGIN + 2, y, CONTENT_W - 2); y += 1; }
      if (dir.escolaridade) { y = addField(pdf, 'Escolaridade', dir.escolaridade, MARGIN + 2, y, CONTENT_W - 2); y += 1; }
      if (dir.telefone) { y = addField(pdf, 'Telefone', dir.telefone, MARGIN + 2, y, CONTENT_W - 2); y += 1; }
      if (dir.email) { y = addField(pdf, 'E-mail', dir.email, MARGIN + 2, y, CONTENT_W - 2); y += 1; }
      const endDir = [dir.logradouro, dir.numero, dir.complemento, dir.bairro, dir.cidade, dir.uf].filter(Boolean).join(', ');
      if (endDir) { y = addField(pdf, 'Endereço', endDir, MARGIN + 2, y, CONTENT_W - 2); y += 1; }
      y += 8;
    }
  }

  // ===== HISTÓRICO + CAPACIDADE =====
  pdf.addPage();
  addHeader(pdf, entidade.nome || '', cor);
  y = 30;
  y = addSectionTitle(pdf, '3. Histórico', y, cor);
  y += 4;
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(20, 20, 20);
  if (entidade.historico) {
    const lines = pdf.splitTextToSize(entidade.historico, CONTENT_W);
    pdf.text(lines, MARGIN, y);
    y += lines.length * LINE_H + 12;
  } else {
    pdf.setTextColor(130, 130, 130); pdf.text('Não informado.', MARGIN, y); y += 12;
  }
  if (y > PAGE_H - 70) { pdf.addPage(); addHeader(pdf, entidade.nome || '', cor); y = 30; }
  y = addSectionTitle(pdf, '4. Capacidade Técnica e Operacional', y, cor);
  y += 4;
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(20, 20, 20);
  if (entidade.capacidadeTecnica) {
    const lines = pdf.splitTextToSize(entidade.capacidadeTecnica, CONTENT_W);
    pdf.text(lines, MARGIN, y);
  } else {
    pdf.setTextColor(130, 130, 130); pdf.text('Não informado.', MARGIN, y);
  }

  // ===== TABELA DE ANEXOS =====
  pdf.addPage();
  addHeader(pdf, entidade.nome || '', cor);
  y = 30;
  y = addSectionTitle(pdf, '5. Tabela de Anexos', y, cor);
  y += 4;

  const anexoRows = allDocs.map((d, i) => [toRoman(i + 1), d.nome, d.source]);

  autoTable(pdf, {
    startY: y,
    head: [['Nº', 'Documento', 'Origem']],
    body: anexoRows.length > 0 ? anexoRows : [['—', 'Nenhum documento anexado', '']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: corClara },
    columnStyles: { 0: { cellWidth: 15 }, 2: { cellWidth: 45 } },
  });

  // Adicionar rodapés em todas as páginas geradas
  const totalPagesEstrutura = (pdf as any).internal.getNumberOfPages();
  for (let p = 2; p <= totalPagesEstrutura; p++) {
    pdf.setPage(p);
    addFooter(pdf, p);
  }

  // 3. Exportar base como ArrayBuffer
  const pdfBuffer = pdf.output('arraybuffer');

  // 4. Mesclar PDFs anexados usando pdf-lib
  const finalDoc = await PDFDocument.load(pdfBuffer);

  const docsComUrl = allDocs.filter(d => d.url);
  for (const d of docsComUrl) {
    try {
      const bytes = await fetchPdfBytes(d.url!);
      if (!bytes) {
        console.warn(`Não foi possível baixar: ${d.nome}`);
        continue;
      }
      const extPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await finalDoc.copyPages(extPdf, extPdf.getPageIndices());
      pages.forEach(p => finalDoc.addPage(p));
    } catch (err) {
      console.warn(`Erro ao incluir PDF "${d.nome}":`, err);
    }
  }

  // 5. Salvar e baixar
  const finalBytes = await finalDoc.save();
  const blob = new Blob([finalBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Dossie_${(entidade.sigla || entidade.nome || 'Entidade').replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
