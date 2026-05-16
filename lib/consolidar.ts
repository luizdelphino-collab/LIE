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
}

interface Dirigente {
  id: string;
  nome: string;
  cargo?: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  escolaridade?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
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

const formatDate = (ts?: any): string => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR');
};

const LINE_H = 7;
const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

function addHeader(pdf: jsPDF, entNome: string) {
  pdf.setFillColor(22, 101, 52); // verde escuro
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
  pdf.text(`Página ${pageNum} de ${total}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  pdf.text(new Date().toLocaleDateString('pt-BR'), MARGIN, PAGE_H - 8);
}

function addSectionTitle(pdf: jsPDF, title: string, y: number): number {
  pdf.setFillColor(240, 253, 244);
  pdf.rect(MARGIN, y - 5, CONTENT_W, 9, 'F');
  pdf.setDrawColor(22, 101, 52);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(22, 101, 52);
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
  // 1. Carregar dados do Firestore
  const entSnap = await getDoc(doc(db, 'entities', entidadeId));
  if (!entSnap.exists()) throw new Error('Entidade não encontrada');
  const entidade = { id: entSnap.id, ...entSnap.data() } as Entidade;

  // Documentos da entidade
  const docsEntSnap = await getDocs(collection(db, `entities/${entidadeId}/documentos`));
  const docsEntidade: DocItem[] = docsEntSnap.docs
    .map(d => ({ ...(d.data() as DocItem) }))
    .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0));

  // Dirigentes e seus documentos
  const dirsSnap = await getDocs(collection(db, `entities/${entidadeId}/dirigentes`));
  const dirigentes: Dirigente[] = [];
  for (const dirDoc of dirsSnap.docs.sort((a, b) => ((a.data().ordem || 0) - (b.data().ordem || 0)))) {
    const dirData = { id: dirDoc.id, ...dirDoc.data() } as Dirigente;
    const docsDirSnap = await getDocs(collection(db, `entities/${entidadeId}/dirigentes/${dirDoc.id}/documentos`));
    dirData.documentos = docsDirSnap.docs
      .map(d => d.data() as DocItem)
      .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0));
    dirigentes.push(dirData);
  }

  // Lista geral de anexos (todos os PDFs)
  const allDocs: { nome: string; url?: string; source: string }[] = [];
  docsEntidade.forEach(d => allDocs.push({ nome: d.nome || d.tipo || 'Documento', url: d.arquivoUrl, source: entidade.sigla || 'Entidade' }));
  dirigentes.forEach(d => {
    (d.documentos || []).forEach(dd => {
      allDocs.push({ nome: dd.nome || dd.tipo || 'Documento', url: dd.arquivoUrl, source: d.nome });
    });
  });

  // 2. Gerar PDF principal com jsPDF
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // ============= PÁGINA 1 — CAPA =============
  pdf.setFillColor(22, 101, 52);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Logo
  let logoY = 60;
  if (entidade.logoUrl) {
    try {
      let imgData = entidade.logoUrl;
      if (!imgData.startsWith('data:')) {
        imgData = (await fetchImageAsBase64(entidade.logoUrl)) || '';
      }
      if (imgData) {
        pdf.addImage(imgData, 'PNG', PAGE_W / 2 - 25, logoY, 50, 50);
        logoY += 60;
      }
    } catch { /* sem logo */ }
  }

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(28);
  pdf.setFont('helvetica', 'bold');
  const nomeLines = pdf.splitTextToSize(entidade.nome || '', CONTENT_W);
  pdf.text(nomeLines, PAGE_W / 2, logoY + 15, { align: 'center' });

  if (entidade.sigla) {
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'normal');
    pdf.text(entidade.sigla, PAGE_W / 2, logoY + 15 + (nomeLines.length * 10) + 8, { align: 'center' });
  }

  pdf.setFontSize(11);
  pdf.setTextColor(200, 240, 210);
  pdf.text('Dossiê Institucional', PAGE_W / 2, PAGE_H - 40, { align: 'center' });
  pdf.setFontSize(9);
  pdf.text(new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' }), PAGE_W / 2, PAGE_H - 32, { align: 'center' });

  // ============= PÁGINA 2 — SUMÁRIO =============
  pdf.addPage();
  addHeader(pdf, entidade.nome || '');
  let y = 30;
  y = addSectionTitle(pdf, 'Sumário', y);
  y += 4;

  const sumario = [
    ['1.', 'Dados da Entidade', '3'],
    ['2.', 'Relação de Dirigentes', '4'],
    ['3.', 'Histórico', '5'],
    ['4.', 'Capacidade Técnica e Operacional', '5'],
    ['5.', 'Tabela de Anexos', '6'],
    ['6.', 'Documentos Anexados', '7'],
  ];

  pdf.setFontSize(11);
  pdf.setTextColor(20, 20, 20);
  for (const [num, titulo, pag] of sumario) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(num, MARGIN, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(titulo, MARGIN + 10, y);
    pdf.text(pag, PAGE_W - MARGIN, y, { align: 'right' });
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    const lineStart = MARGIN + 10 + pdf.getTextWidth(titulo) + 2;
    const lineEnd = PAGE_W - MARGIN - 6;
    if (lineEnd > lineStart) {
      pdf.line(lineStart, y - 1, lineEnd, y - 1);
    }
    y += 10;
  }

  // ============= PÁGINA 3 — DADOS DA ENTIDADE =============
  pdf.addPage();
  addHeader(pdf, entidade.nome || '');
  y = 30;
  y = addSectionTitle(pdf, '1. Dados da Entidade', y);
  y += 2;

  pdf.setTextColor(20, 20, 20);
  y = addField(pdf, 'Razão Social', entidade.nome || '', MARGIN, y);
  y += 2;
  y = addField(pdf, 'Sigla', entidade.sigla || '', MARGIN, y);
  y += 2;
  y = addField(pdf, 'CNPJ', entidade.cnpj || '', MARGIN, y);
  y += 6;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text('ENDEREÇO', MARGIN, y);
  y += 5;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 5;

  const endParts = [
    entidade.logradouro, entidade.numero, entidade.complemento, entidade.bairro,
    entidade.cidade, entidade.uf, entidade.cep
  ].filter(Boolean).join(', ');
  y = addField(pdf, 'Endereço', endParts, MARGIN, y);
  y += 6;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text('CONTATO', MARGIN, y);
  y += 5;
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 5;

  y = addField(pdf, 'E-mail', entidade.email || '', MARGIN, y);
  y += 2;
  y = addField(pdf, 'Telefone(s)', (entidade.telefones || []).join(' / '), MARGIN, y);
  y += 2;
  if (entidade.site) { y = addField(pdf, 'Site', entidade.site, MARGIN, y); y += 2; }
  if (entidade.instagram) { y = addField(pdf, 'Instagram', entidade.instagram, MARGIN, y); y += 2; }
  if (entidade.linkedin) { y = addField(pdf, 'LinkedIn', entidade.linkedin, MARGIN, y); y += 2; }
  y += 6;

  if (entidade.responsavelLegal?.nome) {
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(80, 80, 80);
    pdf.text('RESPONSÁVEL LEGAL', MARGIN, y);
    y += 5;
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;
    y = addField(pdf, 'Nome', entidade.responsavelLegal.nome, MARGIN, y); y += 2;
    if (entidade.responsavelLegal.cargo) { y = addField(pdf, 'Cargo', entidade.responsavelLegal.cargo, MARGIN, y); y += 2; }
    if (entidade.responsavelLegal.cpf) { y = addField(pdf, 'CPF', entidade.responsavelLegal.cpf, MARGIN, y); y += 2; }
    if (entidade.responsavelLegal.email) { y = addField(pdf, 'E-mail', entidade.responsavelLegal.email, MARGIN, y); y += 2; }
    if (entidade.responsavelLegal.telefone) { y = addField(pdf, 'Telefone', entidade.responsavelLegal.telefone, MARGIN, y); }
  }

  addFooter(pdf, 3);

  // ============= PÁGINA 4 — DIRIGENTES =============
  pdf.addPage();
  addHeader(pdf, entidade.nome || '');
  y = 30;
  y = addSectionTitle(pdf, '2. Relação de Dirigentes', y);

  if (dirigentes.length === 0) {
    pdf.setFontSize(10); pdf.setTextColor(100, 100, 100);
    pdf.text('Nenhum dirigente cadastrado.', MARGIN, y + 8);
  } else {
    for (const dir of dirigentes) {
      if (y > PAGE_H - 60) { pdf.addPage(); addHeader(pdf, entidade.nome || ''); y = 30; }

      pdf.setFillColor(245, 245, 245);
      pdf.roundedRect(MARGIN, y, CONTENT_W, 8, 2, 2, 'F');
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(22, 101, 52);
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
      y += 6;
    }
  }

  addFooter(pdf, 4);

  // ============= PÁGINA 5 — HISTÓRICO =============
  pdf.addPage();
  addHeader(pdf, entidade.nome || '');
  y = 30;
  y = addSectionTitle(pdf, '3. Histórico', y);
  y += 4;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(20, 20, 20);
  if (entidade.historico) {
    const lines = pdf.splitTextToSize(entidade.historico, CONTENT_W);
    pdf.text(lines, MARGIN, y);
    y += lines.length * LINE_H + 10;
  } else {
    pdf.setTextColor(120, 120, 120);
    pdf.text('Não informado.', MARGIN, y);
    y += 10;
  }

  if (y > PAGE_H - 60) { pdf.addPage(); addHeader(pdf, entidade.nome || ''); y = 30; }
  y = addSectionTitle(pdf, '4. Capacidade Técnica e Operacional', y);
  y += 4;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(20, 20, 20);
  if (entidade.capacidadeTecnica) {
    const lines = pdf.splitTextToSize(entidade.capacidadeTecnica, CONTENT_W);
    pdf.text(lines, MARGIN, y);
  } else {
    pdf.setTextColor(120, 120, 120);
    pdf.text('Não informado.', MARGIN, y);
  }

  addFooter(pdf, 5);

  // ============= PÁGINA 6 — TABELA DE ANEXOS =============
  pdf.addPage();
  addHeader(pdf, entidade.nome || '');
  y = 30;
  y = addSectionTitle(pdf, '5. Tabela de Anexos', y);
  y += 4;

  const anexoRows = allDocs.map((d, i) => [toRoman(i + 1), d.nome, d.source]);

  autoTable(pdf, {
    startY: y,
    head: [['Nº', 'Documento', 'Origem']],
    body: anexoRows,
    margin: { left: MARGIN, right: MARGIN },
    headStyles: {
      fillColor: [22, 101, 52],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: { fontSize: 9, textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [240, 253, 244] },
    columnStyles: { 0: { cellWidth: 15 }, 2: { cellWidth: 45 } },
  });

  const totalPagesEstrutura = (pdf as any).internal.getNumberOfPages();
  // Adiciona footers nas páginas de estrutura
  for (let p = 2; p <= totalPagesEstrutura; p++) {
    pdf.setPage(p);
    addFooter(pdf, p);
  }

  // 3. Exportar o PDF base como bytes
  const pdfBase64 = pdf.output('arraybuffer');

  // 4. Usar pdf-lib para mesclar com os PDFs anexados
  const finalDoc = await PDFDocument.load(pdfBase64);

  const docsComUrl = allDocs.filter(d => d.url);
  for (const d of docsComUrl) {
    try {
      const bytes = await fetchPdfBytes(d.url!);
      if (!bytes) continue;
      const extPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await finalDoc.copyPages(extPdf, extPdf.getPageIndices());
      pages.forEach(p => finalDoc.addPage(p));
    } catch (err) {
      console.warn(`Não foi possível incluir o PDF "${d.nome}":`, err);
    }
  }

  const finalBytes = await finalDoc.save();
  const blob = new Blob([finalBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Dossie_${(entidade.sigla || entidade.nome || 'Entidade').replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
