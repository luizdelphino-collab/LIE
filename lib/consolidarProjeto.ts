import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, getDoc } from 'firebase/firestore';
import { ref, getBlob } from 'firebase/storage';
import { db, storage } from './firebase';
import type { Projeto, Entidade } from '../types';

const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 7;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [22, 101, 52];
  return [r, g, b];
}

function lightenRgb(rgb: [number, number, number], amount = 0.92): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * amount),
    Math.round(rgb[1] + (255 - rgb[1]) * amount),
    Math.round(rgb[2] + (255 - rgb[2]) * amount),
  ];
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    if (url.startsWith('data:')) return url;
    const match = url.match(/\/o\/([^?]+)/);
    const path = match ? decodeURIComponent(match[1]) : null;
    if (path) {
      const blob = await getBlob(ref(storage, path));
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
    return null;
  } catch (e) { return null; }
}

function addHeader(pdf: jsPDF, title: string, cor: [number, number, number]) {
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, 12, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title.toUpperCase(), MARGIN, 8);
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
  const lines = pdf.splitTextToSize(value || '-', maxW - 35);
  pdf.text(lines, x + 35, y);
  return y + (lines.length * LINE_H);
}

export async function consolidarProjeto(projetoId: string): Promise<void> {
  const projSnap = await getDoc(doc(db, 'projects', projetoId));
  if (!projSnap.exists()) throw new Error('Projeto não encontrado');
  const projeto = { id: projSnap.id, ...projSnap.data() } as Projeto;

  const entSnap = await getDoc(doc(db, 'entities', projeto.entidadeId));
  if (!entSnap.exists()) throw new Error('Entidade do projeto não encontrada');
  const entidade = { id: entSnap.id, ...entSnap.data() } as Entidade;

  const cor = hexToRgb(entidade.corPredominante || '#16A34A');
  const corClara = lightenRgb(cor, 0.88);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // Pág 1: Capa (Entidade)
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, PAGE_H / 2 - 40, PAGE_W, 80, 'F');
  if (entidade.logoUrl) {
    const imgData = await fetchImageAsBase64(entidade.logoUrl);
    if (imgData) pdf.addImage(imgData, 'PNG', PAGE_W / 2 - 30, PAGE_H / 2 - 30, 60, 60);
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(24);
  pdf.setFont('helvetica', 'bold');
  pdf.text(entidade.nome.toUpperCase(), PAGE_W / 2, PAGE_H / 2 - 50, { align: 'center' });

  // Pág 2: Dados da Entidade
  pdf.addPage();
  addHeader(pdf, entidade.nome, cor);
  let y = 30;
  y = addSectionTitle(pdf, 'DADOS DA ENTIDADE PROPONENTE', y, cor);
  y = addField(pdf, 'Razão Social', entidade.nome, MARGIN, y); y += 2;
  y = addField(pdf, 'CNPJ', entidade.cnpj, MARGIN, y); y += 2;
  y = addField(pdf, 'Sigla', entidade.sigla || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Endereço', `${entidade.logradouro}, ${entidade.numero} - ${entidade.cidade}/${entidade.uf}`, MARGIN, y); y += 2;
  y = addField(pdf, 'E-mail', entidade.email || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Responsável', entidade.responsavelLegal?.nome || '-', MARGIN, y);

  // Pág 3: Contracapa (Projeto)
  pdf.addPage();
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(20, 60, PAGE_W - 40, PAGE_H - 120, 'F', 5);
  if (projeto.logoUrl) {
    const imgProj = await fetchImageAsBase64(projeto.logoUrl);
    if (imgProj) pdf.addImage(imgProj, 'PNG', PAGE_W / 2 - 40, 80, 80, 80);
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(28);
  pdf.setFont('helvetica', 'bold');
  pdf.text(projeto.titulo.toUpperCase(), PAGE_W / 2, 45, { align: 'center' });
  pdf.setFontSize(14);
  pdf.text('PLANO DE TRABALHO', PAGE_W / 2, PAGE_H - 40, { align: 'center' });

  // Pág 4+: Dados do Projeto
  pdf.addPage();
  addHeader(pdf, projeto.titulo, cor);
  y = 30;
  y = addSectionTitle(pdf, '1. IDENTIFICAÇÃO DO PROJETO', y, cor);
  y = addField(pdf, 'Título', projeto.titulo, MARGIN, y); y += 2;
  y = addField(pdf, 'Instrumento', projeto.instrumentoOrigem, MARGIN, y); y += 2;
  y = addField(pdf, 'Órgão', projeto.orgao === 'outro' ? projeto.orgaoOutro || '' : projeto.orgao, MARGIN, y); y += 2;
  y = addField(pdf, 'Período', `${projeto.mesInicio} até ${projeto.mesTermino}`, MARGIN, y); y += 2;
  y = addField(pdf, 'Âmbito', projeto.ambitoAplicacao || '-', MARGIN, y); y += 8;

  y = addSectionTitle(pdf, '2. PLANO DE TRABALHO', y, cor);
  y = addField(pdf, 'Resumo', projeto.resumo || '-', MARGIN, y); y += 4;
  y = addField(pdf, 'Objetivo Geral', projeto.objetivoGeral || '-', MARGIN, y); y += 4;
  
  pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text('Objetivos Específicos:', MARGIN, y); y += 5;
  pdf.setFont('helvetica', 'normal');
  projeto.objetivosEspecificos?.forEach((obj, i) => {
    if (obj.trim()) {
      const lines = pdf.splitTextToSize(`${i+1}. ${obj}`, CONTENT_W - 5);
      pdf.text(lines, MARGIN + 5, y);
      y += lines.length * 6;
    }
  });
  y += 6;

  if (y > PAGE_H - 60) { pdf.addPage(); addHeader(pdf, projeto.titulo, cor); y = 30; }
  y = addSectionTitle(pdf, '3. CRONOGRAMA DE EXECUÇÃO', y, cor);
  autoTable(pdf, {
    startY: y,
    head: [['Ação', 'Descrição', 'Início', 'Término']],
    body: projeto.cronograma?.map(a => [a.acao, a.descricao, a.mesInicio, a.mesTermino]) || [['-', '-', '-', '-']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
  });

  pdf.addPage();
  addHeader(pdf, projeto.titulo, cor);
  y = 30;
  y = addSectionTitle(pdf, '4. METAS DO PROJETO', y, cor);
  y += 4;
  pdf.setFont('helvetica', 'bold'); pdf.text('Metas Qualitativas', MARGIN, y); y += 6;
  autoTable(pdf, {
    startY: y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQualitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
  });
  
  y = (pdf as any).lastAutoTable.finalY + 10;
  pdf.setFont('helvetica', 'bold'); pdf.text('Metas Quantitativas', MARGIN, y); y += 6;
  autoTable(pdf, {
    startY: y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQuantitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
  });

  const total = (pdf as any).internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8); pdf.setTextColor(150, 150, 150);
    pdf.text(`Página ${i} de ${total}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
  }

  pdf.save(`Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
}
