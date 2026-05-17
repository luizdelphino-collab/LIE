import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
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
    if (!url) return null;
    if (url.startsWith('data:')) return url;

    // Tenta carregar via Firebase Storage getBlob (mais seguro para CORS)
    try {
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
    } catch (e) {
      console.warn('Erro ao carregar via Storage Blob, tentando fetch direto:', e);
    }

    // Fallback: Fetch direto (requer CORS configurado no bucket)
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Erro total ao buscar imagem:', e);
    return null;
  }
}

function getImgFormat(url: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (url.toLowerCase().includes('.png') || url.startsWith('data:image/png')) return 'PNG';
  if (url.toLowerCase().includes('.webp') || url.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
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

export async function consolidarProjeto(projetoId: string, rubricaUrl?: string): Promise<void> {
  const projSnap = await getDoc(doc(db, 'projects', projetoId));
  if (!projSnap.exists()) throw new Error('Projeto não encontrado');
  const projeto = { id: projSnap.id, ...projSnap.data() } as Projeto;

  const entSnap = await getDoc(doc(db, 'entities', projeto.entidadeId));
  if (!entSnap.exists()) throw new Error('Entidade do projeto não encontrada');
  const entidade = { id: entSnap.id, ...entSnap.data() } as Entidade;

  const docsSnap = await getDocs(collection(db, `projects/${projetoId}/documentos`));
  const documentos = docsSnap.docs.map(d => d.data()).sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0));

  const cor = hexToRgb((entidade as any).corPredominante || '#16A34A');
  const corClara = lightenRgb(cor, 0.88);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // Pág 1: Capa (Projeto/Entidade)
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  const corEscura = cor.map(c => Math.max(0, c - 40)) as [number, number, number];
  pdf.setFillColor(...corEscura);
  pdf.rect(0, PAGE_H - 30, PAGE_W, 30, 'F');

  const faixaY = PAGE_H / 2 - 40;
  const faixaH = 80;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, faixaY, PAGE_W, faixaH, 'F');

  const logoUsar = projeto.logoUrl || (entidade as any).logoUrl;
  if (logoUsar) {
    const imgData = await fetchImageAsBase64(logoUsar);
    if (imgData) pdf.addImage(imgData, getImgFormat(logoUsar), PAGE_W / 2 - 30, faixaY + 10, 60, 60);
  }

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(26);
  pdf.setFont('helvetica', 'bold');
  const entNameLines = pdf.splitTextToSize(entidade.nome.toUpperCase(), CONTENT_W);
  pdf.text(entNameLines, PAGE_W / 2, 40, { align: 'center' });
  pdf.setFontSize(20);
  pdf.text('PLANO DE TRABALHO', PAGE_W / 2, PAGE_H - 40, { align: 'center' });

  let y = 30;

  const chkPage = (needed = 40) => {
    if (y > PAGE_H - needed) {
      pdf.addPage();
      addHeader(pdf, projeto.titulo, cor);
      y = 30;
    }
  };

  // Pág 2: Identificação do Projeto & Entidade
  pdf.addPage();
  addHeader(pdf, projeto.titulo, cor);
  
  y = addSectionTitle(pdf, '1. IDENTIFICAÇÃO DO PROJETO', y, cor);
  y = addField(pdf, 'Título', projeto.titulo, MARGIN, y); y += 2;
  y = addField(pdf, 'Instrumento', projeto.instrumentoOrigem, MARGIN, y); y += 2;
  y = addField(pdf, 'Órgão', projeto.orgao === 'outro' ? projeto.orgaoOutro || '' : projeto.orgao, MARGIN, y); y += 6;
  
  y = addSectionTitle(pdf, '2. DADOS DA ENTIDADE PROPONENTE', y, cor);
  y = addField(pdf, 'Razão Social', entidade.nome, MARGIN, y); y += 2;
  y = addField(pdf, 'Sigla', entidade.sigla || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'CNPJ', entidade.cnpj, MARGIN, y); y += 2;
  const endParts = [entidade.logradouro, entidade.numero, entidade.complemento, entidade.bairro, entidade.cidade, entidade.uf, entidade.cep].filter(Boolean).join(', ');
  y = addField(pdf, 'Endereço', endParts || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'E-mail', entidade.email || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Telefone(s)', (entidade.telefones || []).join(' / ') || '-', MARGIN, y); y += 2;
  
  if ((entidade as any).instagram) { y = addField(pdf, 'Instagram', (entidade as any).instagram, MARGIN, y); y += 2; }
  if ((entidade as any).facebook) { y = addField(pdf, 'Facebook', (entidade as any).facebook, MARGIN, y); y += 2; }
  if ((entidade as any).linkedin) { y = addField(pdf, 'LinkedIn', (entidade as any).linkedin, MARGIN, y); y += 2; }
  y += 6;

  // Pág 3: Plano de Trabalho Descritivo
  pdf.addPage();
  addHeader(pdf, projeto.titulo, cor);
  y = 30;
  y = addSectionTitle(pdf, '3. PLANO DE TRABALHO', y, cor);
  
  y = addField(pdf, 'Resumo', projeto.resumo || '-', MARGIN, y); y += 4;
  chkPage();
  y = addField(pdf, 'Período', `${projeto.mesInicio} até ${projeto.mesTermino} (${projeto.duracaoMeses || 0} meses)`, MARGIN, y); y += 4;
  chkPage();
  y = addField(pdf, 'Âmbito', projeto.ambitoAplicacao || '-', MARGIN, y); y += 4;
  
  if (projeto.locais && projeto.locais.length > 0) {
    chkPage();
    const locaisStr = projeto.locais.map(l => `${l.uf}: ${l.municipios.join(', ')}`).join(' | ');
    y = addField(pdf, 'Locais', locaisStr, MARGIN, y); y += 4;
  }
  if (projeto.modalidades && projeto.modalidades.length > 0) {
    chkPage();
    y = addField(pdf, 'Modalidades', projeto.modalidades.join(', '), MARGIN, y); y += 4;
  }

  chkPage();
  y = addField(pdf, 'Objetivo Geral', projeto.objetivoGeral || '-', MARGIN, y); y += 4;
  
  if (projeto.objetivosEspecificos && projeto.objetivosEspecificos.length > 0) {
    chkPage();
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text('Objetivos Específicos:', MARGIN, y); y += 5;
    pdf.setFont('helvetica', 'normal');
    projeto.objetivosEspecificos.forEach((obj, i) => {
      if (obj.trim()) {
        chkPage(10);
        const lines = pdf.splitTextToSize(`${i+1}. ${obj}`, CONTENT_W - 5);
        pdf.text(lines, MARGIN + 5, y);
        y += lines.length * 6;
      }
    });
    y += 4;
  }

  if (projeto.justificativa) {
    chkPage(30);
    y = addField(pdf, 'Justificativa', projeto.justificativa, MARGIN, y); y += 4;
  }
  if (projeto.caracterizacaoSocioeconomica) {
    chkPage(30);
    y = addField(pdf, 'Caracterização Socioeconômica', projeto.caracterizacaoSocioeconomica, MARGIN, y); y += 4;
  }
  if (projeto.metodologia) {
    chkPage(30);
    y = addField(pdf, 'Metodologia de Aplicação', projeto.metodologia, MARGIN, y); y += 4;
  }

  if (projeto.publicoAlvo) {
    chkPage(30);
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text('Público Alvo:', MARGIN, y); y += 5;
    pdf.setFont('helvetica', 'normal');
    const pubStr = `Direto: ${projeto.publicoAlvo.direto}\nIndireto: ${projeto.publicoAlvo.indireto}\nFaixa Etária: ${projeto.publicoAlvo.faixaEtaria}`;
    const pLines = pdf.splitTextToSize(pubStr, CONTENT_W - 5);
    pdf.text(pLines, MARGIN + 5, y);
    y += pLines.length * 5 + 4;
  }

  // Cronograma
  pdf.addPage();
  addHeader(pdf, projeto.titulo, cor);
  y = 30;
  y = addSectionTitle(pdf, '4. CRONOGRAMA DE EXECUÇÃO', y, cor);
  autoTable(pdf, {
    startY: y,
    head: [['Ação', 'Descrição', 'Início', 'Término']],
    body: projeto.cronograma?.map(a => [a.acao, a.descricao, a.mesInicio, a.mesTermino]) || [['-', '-', '-', '-']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
  });

  // Metas
  y = (pdf as any).lastAutoTable.finalY + 15;
  chkPage(60);
  y = addSectionTitle(pdf, '5. METAS DO PROJETO', y, cor);
  pdf.setFont('helvetica', 'bold'); pdf.text('Metas Qualitativas', MARGIN, y); y += 6;
  autoTable(pdf, {
    startY: y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQualitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
  });
  
  y = (pdf as any).lastAutoTable.finalY + 10;
  chkPage(40);
  pdf.setFont('helvetica', 'bold'); pdf.text('Metas Quantitativas', MARGIN, y); y += 6;
  autoTable(pdf, {
    startY: y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQuantitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
  });

  // Anexos
  y = (pdf as any).lastAutoTable.finalY + 15;
  chkPage(50);
  y = addSectionTitle(pdf, '6. TABELA DE ANEXOS', y, cor);
  
  const toRoman = (n: number) => {
    const vals = [10,9,5,4,1];
    const syms = ['X','IX','V','IV','I'];
    let res = '';
    for (let i = 0; i < vals.length; i++) {
      while (n >= vals[i]) { res += syms[i]; n -= vals[i]; }
    }
    return res;
  };

  const anexoRows = documentos.map((d, i) => [toRoman(i + 1), (d as any).nome || (d as any).tipo || 'Documento']);
  autoTable(pdf, {
    startY: y,
    head: [['Nº', 'Documento']],
    body: anexoRows.length > 0 ? anexoRows : [['—', 'Nenhum documento anexado']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
  });

  const total = (pdf as any).internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8); pdf.setTextColor(150, 150, 150);
    if (i > 1) {
      pdf.text(`Página ${i} de ${total}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
      if (rubricaUrl) {
        try {
          pdf.addImage(rubricaUrl, getImgFormat(rubricaUrl), 10, PAGE_H - 15, 10, 10);
        } catch {}
      }
    }
  }

  pdf.save(`Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
}
