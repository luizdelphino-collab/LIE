import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { ref, getBlob } from 'firebase/storage';
import { db, storage } from './firebase';
import type { Projeto, Entidade, ItemProjeto } from '../types';

const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 5.2;

interface PDFState {
  pdf: jsPDF;
  y: number;
  cor: [number, number, number];
  entidade: Entidade;
  logoBase64: string | null;
  projetoTitulo: string;
}

// Mapa de páginas de início de cada capítulo (para sumário)
interface TocEntry {
  num: string;
  title: string;
  page: number;
}

function softenColor(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  if (r > 120 && r > g * 1.3 && r > b * 1.3) {
    return [141, 23, 44];
  }
  return rgb;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [141, 23, 44];
  return softenColor([r, g, b]);
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
    console.warn('Erro ao carregar via Storage Blob:', e);
  }

  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  } catch (e) {
    console.warn('Fetch direto bloqueado por CORS:', e);
  }

  try {
    const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=png`;
    const resp = await fetch(weservUrl);
    if (resp.ok) {
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  } catch (e) {
    console.warn('Proxy Weserv falhou:', e);
  }

  try {
    const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const resp = await fetch(allOriginsUrl);
    if (resp.ok) {
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  } catch (e) {
    console.error('Todos os métodos de carregamento de imagem falharam:', e);
  }

  return null;
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

function addChapterTitle(state: PDFState, title: string): number {
  checkPageSpace(state, 20);
  const { pdf, cor } = state;
  const y = state.y;
  const light = lightenRgb(cor, 0.92);
  pdf.setFillColor(...light);
  pdf.rect(MARGIN, y - 4, CONTENT_W, 8, 'F');
  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...cor);
  pdf.text(title, MARGIN + 2, y + 2);
  state.y = y + 10;
  return (pdf as any).internal.getCurrentPageInfo().pageNumber;
}

function addSubTitle(state: PDFState, title: string) {
  checkPageSpace(state, 12);
  const { pdf } = state;
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN, state.y);
  state.y += LINE_H + 1;
}

function addBodyText(state: PDFState, text: string) {
  if (!text) return;
  const { pdf } = state;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0, 0, 0);
  const paragraphs = text.split('\n');
  const lineSpacing = LINE_H + 1.2;
  for (let p = 0; p < paragraphs.length; p++) {
    const paraText = paragraphs[p];
    if (paraText.trim() === '') {
      state.y += lineSpacing * 0.5;
      continue;
    }
    const lines: string[] = pdf.splitTextToSize(paraText, CONTENT_W);
    for (let i = 0; i < lines.length; i++) {
      checkPageSpace(state, 10);
      
      const line = lines[i].trim();
      const isLastLine = (i === lines.length - 1);
      const words = line.split(' ');
      
      if (isLastLine || words.length <= 1) {
        pdf.text(line, MARGIN, state.y);
      } else {
        const textWidth = pdf.getTextWidth(line);
        const extraSpace = CONTENT_W - textWidth;
        const additionalSpacePerSpace = extraSpace / (words.length - 1);
        
        let currentX = MARGIN;
        const spaceWidth = pdf.getTextWidth(' ');
        
        for (let w = 0; w < words.length; w++) {
          pdf.text(words[w], currentX, state.y);
          currentX += pdf.getTextWidth(words[w]) + spaceWidth + additionalSpacePerSpace;
        }
      }
      state.y += lineSpacing;
    }
    if (p < paragraphs.length - 1 && paraText.trim() !== '') {
      state.y += 1.5;
    }
  }
}

function addField(state: PDFState, label: string, value: string, x: number, maxW = CONTENT_W) {
  const { pdf } = state;
  const labelWidth = 35;
  const valMaxW = maxW - labelWidth;
  const lines = pdf.splitTextToSize(value || '-', valMaxW);
  const neededHeight = lines.length * LINE_H;
  checkPageSpace(state, neededHeight + 4);
  const y = state.y;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(label + ':', x, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0, 0, 0);
  pdf.text(lines, x + labelWidth, y);
  state.y = y + neededHeight;
}

function addSubSection(state: PDFState, title: string) {
  checkPageSpace(state, 12);
  const { pdf } = state;
  const y = state.y;
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN, y);
  const lineY = y + 2;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(MARGIN, lineY, MARGIN + CONTENT_W, lineY);
  state.y = lineY + 3.5;
}

function formatMesAno(ym?: string): string {
  if (!ym) return '-';
  const [year, month] = ym.split('-');
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const mName = months[parseInt(month, 10) - 1] || month;
  return `${mName}/${year}`;
}

function getMesNomeAno(mesInicio: string, numeroMes: number): string {
  if (!mesInicio) return `Mês ${numeroMes}`;
  const [yearStr, monthStr] = mesInicio.split('-');
  let y = parseInt(yearStr, 10);
  let m = parseInt(monthStr, 10);
  m += (numeroMes - 1);
  while (m > 12) { m -= 12; y += 1; }
  const mesesExtenso = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ];
  return `${mesesExtenso[m - 1]} / ${y}`;
}

const toRoman = (n: number) => {
  const vals = [10,9,5,4,1];
  const syms = ['X','IX','V','IV','I'];
  let res = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { res += syms[i]; n -= vals[i]; }
  }
  return res;
};

// ─── Renderizar Sumário na página 2 ─────────────────────────────────────────
function drawToc(
  pdf: jsPDF,
  entidade: Entidade,
  logoBase64: string | null,
  cor: [number, number, number],
  toc: TocEntry[]
) {
  pdf.setPage(2);
  // Cabeçalho timbrado
  drawLetterheadHeader(pdf, entidade, logoBase64, cor);

  let y = 38;
  const light = lightenRgb(cor, 0.92);

  // Título do Sumário
  pdf.setFillColor(...light);
  pdf.rect(MARGIN, y - 4, CONTENT_W, 9, 'F');
  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y + 5, MARGIN + CONTENT_W, y + 5);
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...cor);
  pdf.text('SUMÁRIO', MARGIN + 2, y + 2);
  y += 16;

  // Linhas do sumário
  for (const entry of toc) {
    // Linha pontilhada
    const numW = 8;
    const pageStr = `${entry.page}`;
    const pageStrW = pdf.getTextWidth(pageStr);
    const titleX = MARGIN + numW + 2;
    const maxTitleW = CONTENT_W - numW - pageStrW - 8;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text(entry.num, MARGIN, y);

    pdf.setFont('helvetica', 'normal');
    const titleLines = pdf.splitTextToSize(entry.title, maxTitleW);
    pdf.text(titleLines[0], titleX, y);

    // Linha de pontos
    const titleEndX = titleX + pdf.getTextWidth(titleLines[0]);
    const dotLineEndX = PAGE_W - MARGIN - pageStrW - 3;
    if (dotLineEndX > titleEndX + 4) {
      pdf.setTextColor(0, 0, 0);
      let dotX = titleEndX + 2;
      while (dotX < dotLineEndX) {
        pdf.text('.', dotX, y);
        dotX += 2.2;
      }
    }

    // Número da página alinhado à direita
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text(pageStr, PAGE_W - MARGIN - pageStrW, y);

    y += 7;

    if (y > 270) break; // Segurança: não ultrapassar o rodapé
  }
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

  // Buscar itens do projeto para o cronograma financeiro
  const itemsSnap = await getDocs(collection(db, `projects/${projetoId}/items`));
  const itensProjeto = itemsSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as ItemProjeto))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  // Buscar allocations do cronograma financeiro
  // Cada doc tem: { itemProjetoId, mes, quantidade }
  const cronSnap = await getDocs(collection(db, `projects/${projetoId}/cronograma`));
  const allocations: Record<string, Record<number, number>> = {};
  cronSnap.docs.forEach(d => {
    const data = d.data() as any;
    const itemId: string = data.itemProjetoId;
    const mes: number = data.mes;
    const qty: number = data.quantidade || 0;
    if (itemId && mes) {
      if (!allocations[itemId]) allocations[itemId] = {};
      allocations[itemId][mes] = qty;
    }
  });

  const cor = hexToRgb((entidade as any).corPredominante || '#16A34A');
  const corClara = lightenRgb(cor, 0.88);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  const logoUsar = entidade.logoUrl;
  let logoBase64: string | null = null;
  if (logoUsar) {
    try { logoBase64 = await fetchImageAsBase64(logoUsar); } catch {}
  }

  // ========== PÁGINA 1: CAPA ==========
  pdf.setFillColor(248, 250, 252);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, 15, PAGE_H, 'F');

  const logoCapa = projeto.logoUrl || entidade.logoUrl;
  if (logoCapa) {
    try {
      const imgData = await fetchImageAsBase64(logoCapa);
      if (imgData) pdf.addImage(imgData, getImgFormat(logoCapa), 50, 50, 45, 45);
    } catch {}
  }

  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.6);
  pdf.line(50, 110, 170, 110);

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PLANO DE TRABALHO', 50, 120);

  pdf.setTextColor(...cor);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  const projTitleLines = pdf.splitTextToSize(projeto.titulo?.toUpperCase() || '', 120);
  pdf.text(projTitleLines, 50, 132);

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PROPONENTE:', 50, 170);
  pdf.setFont('helvetica', 'normal');
  const entNameLines = pdf.splitTextToSize(entidade.nome || '', 120);
  pdf.text(entNameLines, 50, 178);

  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${entidade.cidade || 'São Paulo'} / ${entidade.uf || 'SP'}, 2026`, 50, 255);

  // ========== PÁGINA 2: SUMÁRIO (placeholder — preenchido ao final) ==========
  pdf.addPage();
  // Cabeçalho será desenhado depois pelo drawToc, mas precisamos garantir que a página existe

  // Inicializar estado começando na página 3
  const state: PDFState = {
    pdf,
    y: 33,
    cor,
    entidade,
    logoBase64,
    projetoTitulo: projeto.titulo
  };

  const toc: TocEntry[] = [];

  // ========== CAP 1: IDENTIFICAÇÃO DO PROJETO (página 3) ==========
  forceNewPage(state);
  const p1 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '1. Identificação do Projeto');
  toc.push({ num: '1', title: 'Identificação do Projeto', page: p1 });
  state.y += 2;
  addField(state, 'Título', projeto.titulo, MARGIN); state.y += 1.5;
  addField(state, 'Instrumento', projeto.instrumentoOrigem, MARGIN); state.y += 1.5;
  addField(state, 'Órgão', projeto.orgao === 'outro' ? projeto.orgaoOutro || '' : projeto.orgao, MARGIN); state.y += 1.5;
  addField(state, 'Status', (projeto as any).status?.replace(/_/g, ' ') || '-', MARGIN);

  // ========== CAP 2: DADOS DA ENTIDADE ==========
  forceNewPage(state);
  const p2 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '2. Dados da Entidade');
  toc.push({ num: '2', title: 'Dados da Entidade', page: p2 });

  addSubSection(state, 'IDENTIFICAÇÃO');
  addField(state, 'Razão Social', entidade.nome, MARGIN); state.y += 1.5;
  addField(state, 'Sigla', entidade.sigla || '-', MARGIN); state.y += 1.5;
  addField(state, 'CNPJ', entidade.cnpj, MARGIN); state.y += 4;

  addSubSection(state, 'ENDEREÇO');
  const endParts = [entidade.logradouro, entidade.numero, entidade.complemento, entidade.bairro, entidade.cidade, entidade.uf, entidade.cep].filter(Boolean).join(', ');
  addField(state, 'Endereço', endParts || '-', MARGIN); state.y += 4;

  addSubSection(state, 'CONTATO E REDES');
  addField(state, 'E-mail', entidade.email || '-', MARGIN); state.y += 1.5;
  addField(state, 'Telefone(s)', (entidade.telefones || []).join(' / ') || '-', MARGIN); state.y += 1.5;
  if ((entidade as any).site) { addField(state, 'Site', (entidade as any).site, MARGIN); state.y += 1.5; }
  if ((entidade as any).instagram) { addField(state, 'Instagram', (entidade as any).instagram, MARGIN); state.y += 1.5; }
  if ((entidade as any).facebook) { addField(state, 'Facebook', (entidade as any).facebook, MARGIN); state.y += 1.5; }
  if ((entidade as any).linkedin) { addField(state, 'LinkedIn', (entidade as any).linkedin, MARGIN); state.y += 1.5; }
  if ((entidade as any).youtube) { addField(state, 'YouTube', (entidade as any).youtube, MARGIN); state.y += 1.5; }
  if ((entidade as any).tiktok) { addField(state, 'TikTok', (entidade as any).tiktok, MARGIN); state.y += 4; }

  const resp = (entidade as any).responsavelLegal;
  if (resp && resp.nome) {
    checkPageSpace(state, 50);
    addSubSection(state, 'RESPONSÁVEL LEGAL');
    addField(state, 'Nome', resp.nome || '-', MARGIN); state.y += 1.5;
    addField(state, 'Cargo', resp.cargo || '-', MARGIN); state.y += 1.5;
    addField(state, 'CPF', resp.cpf || '-', MARGIN); state.y += 1.5;
    addField(state, 'E-mail', resp.email || '-', MARGIN); state.y += 1.5;
    addField(state, 'Telefone', resp.telefone || '-', MARGIN);
  }

  // ========== CAP 3: PLANO DE TRABALHO ==========
  forceNewPage(state);
  const p3 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '3. Plano de Trabalho');
  toc.push({ num: '3', title: 'Plano de Trabalho', page: p3 });
  state.y += 2;

  checkPageSpace(state, 55);
  pdf.setDrawColor(225, 229, 233);
  pdf.setFillColor(248, 250, 252);
  pdf.setLineWidth(0.3);
  pdf.rect(MARGIN, state.y, CONTENT_W, 35, 'DF');

  const boxY = state.y + 6;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(0, 0, 0);
  pdf.text('Período de Execução:', MARGIN + 4, boxY);
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0, 0, 0);
  pdf.text(`${formatMesAno(projeto.mesInicio)} até ${formatMesAno(projeto.mesTermino)} (${projeto.duracaoMeses || 0} meses)`, MARGIN + 48, boxY);

  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0);
  pdf.text('Âmbito de Aplicação:', MARGIN + 4, boxY + 7.5);
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0, 0, 0);
  pdf.text(projeto.ambitoAplicacao || '-', MARGIN + 48, boxY + 7.5);

  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0);
  pdf.text('Locais de Aplicação:', MARGIN + 4, boxY + 15);
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0, 0, 0);
  const locaisStr = projeto.locais?.map(l => `${l.uf}: ${l.municipios.filter(Boolean).join(', ')}`).join(' | ') || '-';
  pdf.text(pdf.splitTextToSize(locaisStr, CONTENT_W - 55), MARGIN + 48, boxY + 15);

  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0);
  pdf.text('Modalidades:', MARGIN + 4, boxY + 22.5);
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0, 0, 0);
  const modStr = projeto.modalidades?.map((m: any) => typeof m === 'string' ? m : m.nome).join(', ') || '-';
  pdf.text(pdf.splitTextToSize(modStr, CONTENT_W - 55), MARGIN + 48, boxY + 22.5);

  state.y += 42;

  if (projeto.resumo) { addSubTitle(state, 'Resumo'); addBodyText(state, projeto.resumo); state.y += 4; }
  if ((projeto as any).planoDivulgacao) { addSubTitle(state, 'Plano de Divulgação'); addBodyText(state, (projeto as any).planoDivulgacao); state.y += 4; }
  addSubTitle(state, 'Objetivo Geral');
  addBodyText(state, projeto.objetivoGeral || '-');
  state.y += 4;
  if (projeto.objetivosEspecificos && projeto.objetivosEspecificos.length > 0) {
    addSubTitle(state, 'Objetivos Específicos');
    addBodyText(state, projeto.objetivosEspecificos.filter(o => o.trim()).map((o, i) => `${i + 1}. ${o}`).join('\n'));
    state.y += 4;
  }
  if (projeto.justificativa) { addSubTitle(state, 'Justificativa'); addBodyText(state, projeto.justificativa); state.y += 4; }
  if (projeto.caracterizacaoSocioeconomica) { addSubTitle(state, 'Caracterização Socioeconômica'); addBodyText(state, projeto.caracterizacaoSocioeconomica); state.y += 4; }
  if (projeto.metodologia) { addSubTitle(state, 'Metodologia de Aplicação'); addBodyText(state, projeto.metodologia); }

  // ========== CAP 4: PÚBLICO ALVO ==========
  forceNewPage(state);
  const p4 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '4. Público Alvo');
  toc.push({ num: '4', title: 'Público Alvo', page: p4 });
  state.y += 2;

  if (projeto.publicoAlvo) {
    addSubTitle(state, 'Público Direto'); addBodyText(state, projeto.publicoAlvo.direto || '-'); state.y += 4;
    addSubTitle(state, 'Público Indireto'); addBodyText(state, projeto.publicoAlvo.indireto || '-'); state.y += 4;
    addSubTitle(state, 'Faixa Etária'); addBodyText(state, projeto.publicoAlvo.faixaEtaria || '-');
  }

  // ========== CAP 5: CRONOGRAMA DE EXECUÇÃO ==========
  forceNewPage(state);
  const p5 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '5. Cronograma de Execução');
  toc.push({ num: '5', title: 'Cronograma de Execução', page: p5 });
  state.y += 2;

  const cronBody = projeto.cronograma?.map(a => [
    a.acao || '-', a.descricao || '-', formatMesAno(a.mesInicio), formatMesAno(a.mesTermino)
  ]) || [['-', '-', '-', '-']];

  autoTable(pdf, {
    startY: state.y,
    head: [['Ação', 'Descrição', 'Início', 'Término']],
    body: cronBody,
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 40 }, 1: { cellWidth: 80 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 },
    },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 6: METAS DO PROJETO ==========
  checkPageSpace(state, 40);
  const p6 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '6. Metas do Projeto');
  toc.push({ num: '6', title: 'Metas do Projeto', page: p6 });
  state.y += 2;

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(60, 60, 60);
  pdf.text('Metas Qualitativas', MARGIN, state.y);
  state.y += 5;

  autoTable(pdf, {
    startY: state.y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQualitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [['-','-','-','-']],
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  state.y = (pdf as any).lastAutoTable.finalY + 10;
  checkPageSpace(state, 45);

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(60, 60, 60);
  pdf.text('Metas Quantitativas', MARGIN, state.y);
  state.y += 5;

  autoTable(pdf, {
    startY: state.y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQuantitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [['-','-','-','-']],
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 7: RELAÇÃO DE ITENS DO PROJETO ==========
  forceNewPage(state);
  const p7 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '7. Relação de Itens do Projeto');
  toc.push({ num: '7', title: 'Relação de Itens do Projeto', page: p7 });

  const itemsBody = itensProjeto.length > 0
    ? itensProjeto.map((it, idx) => [
        `${idx + 1}`,
        it.nome,
        it.descricao || '-',
        it.memorialCalculo || '-',
        it.unidade
      ])
    : [['—', 'Nenhum item cadastrado', '-', '-', '-']];

  autoTable(pdf, {
    startY: state.y,
    head: [['Item', 'Nome', 'Descrição', 'Memorial de Cálculo', 'Unidade']],
    body: itemsBody,
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 38 },
      2: { cellWidth: 48 },
      3: { cellWidth: 55 },
      4: { cellWidth: 19 },
    },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 8: CRONOGRAMA DE EXECUÇÃO FINANCEIRA MENSAL ==========
  forceNewPage(state);
  const p8 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '8. Cronograma de Execução Financeira Mensal');
  toc.push({ num: '8', title: 'Cronograma de Execução Financeira Mensal', page: p8 });
  state.y += 2;

  const duracaoMeses = projeto.duracaoMeses || 12;
  const corCronClara = lightenRgb(cor, 0.90);

  if (itensProjeto.length === 0) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(140, 140, 140);
    pdf.text('Nenhum item cadastrado no projeto. Cadastre itens na aba "Itens" para exibir o cronograma financeiro.', MARGIN, state.y);
    state.y += 10;
  } else {
    for (let m = 1; m <= duracaoMeses; m++) {
      const mesNome = getMesNomeAno(projeto.mesInicio || '', m);
      checkPageSpace(state, 40);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      pdf.setTextColor(60, 60, 60);
      pdf.text(`Mês/Etapa ${m} — ${mesNome}`, MARGIN, state.y);
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
        monthlyAllocations.push(['Sem movimentação financeira prevista', '-', '-', '-', '-']);
      } else {
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
        headStyles: { fillColor: cor },
        alternateRowStyles: { fillColor: corCronClara },
        styles: { fontSize: 10, textColor: [0, 0, 0] },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 15, halign: 'center' },
          2: { cellWidth: 25, halign: 'right' },
          3: { cellWidth: 25, halign: 'center' },
          4: { cellWidth: 25, halign: 'right' },
        },
        didDrawPage: (data) => {
          if (data.doc.internal.getNumberOfPages() > 1)
            drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
        }
      });
      state.y = (pdf as any).lastAutoTable.finalY + 8;
    }
  }

  // ========== CAP 9: RESUMO FINANCEIRO ==========
  forceNewPage(state);
  const p9 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '9. Resumo Financeiro');
  toc.push({ num: '9', title: 'Resumo Financeiro', page: p9 });
  state.y += 2;

  const totalProjeto = itensProjeto.reduce((acc, it) => acc + (it.valorTotal || (it.valorUnitario * it.quantidade) || 0), 0);
  const resumoBody: any[] = [];

  for (let m = 1; m <= duracaoMeses; m++) {
    const mesNome = getMesNomeAno(projeto.mesInicio || '', m);
    let valorMes = 0;
    itensProjeto.forEach(it => {
      const qty = (allocations[it.id] || {})[m] || 0;
      valorMes += qty * it.valorUnitario;
    });
    const porcentagem = totalProjeto > 0 ? (valorMes / totalProjeto) * 100 : 0;
    resumoBody.push([
      `Etapa ${m}`,
      mesNome,
      valorMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      `${porcentagem.toFixed(2)}%`
    ]);
  }

  resumoBody.push([
    { content: 'TOTAL GERAL:', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: totalProjeto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), styles: { fontStyle: 'bold', fillColor: lightenRgb(cor, 0.95) } },
    { content: '100,00%', styles: { fontStyle: 'bold', fillColor: lightenRgb(cor, 0.95) } }
  ]);

  autoTable(pdf, {
    startY: state.y,
    head: [['Etapa', 'Mês de Execução', 'Valor Previsto', 'Porcentagem (%)']],
    body: resumoBody,
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 60 },
      2: { cellWidth: 45, halign: 'right' },
      3: { cellWidth: 35, halign: 'center' },
    },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 10: ANEXOS ==========
  forceNewPage(state);
  const p10 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '10. Anexos');
  toc.push({ num: '10', title: 'Anexos', page: p10 });
  state.y += 2;

  const anexoRows = documentos.map((d, i) => [toRoman(i + 1), (d as any).nome || (d as any).tipo || 'Documento']);
  autoTable(pdf, {
    startY: state.y,
    head: [['Nº', 'Documento']],
    body: anexoRows.length > 0 ? anexoRows : [['—', 'Nenhum documento anexado']],
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });

  // ========== RODAPÉS em todas as páginas (exceto capa e sumário) ==========
  const totalPages = (pdf as any).internal.getNumberOfPages();

  // Página 2 = sumário: desenhar o sumário agora que sabemos as páginas
  drawToc(pdf, entidade, logoBase64, cor, toc);
  // Rodapé do sumário (página 2)
  pdf.setPage(2);
  drawLetterheadFooter(pdf, entidade, 2, totalPages, rubricaUrl);

  // Rodapés nas páginas 3 em diante
  for (let i = 3; i <= totalPages; i++) {
    pdf.setPage(i);
    drawLetterheadFooter(pdf, entidade, i, totalPages, rubricaUrl);
  }

  pdf.save(`Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
}
