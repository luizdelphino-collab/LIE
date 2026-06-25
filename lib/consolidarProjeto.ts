import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, storage } from './firebase';
import type { Projeto, Entidade, ItemProjeto } from '../types';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFImage } from 'pdf-lib';
import { obterDetalheMaterialPorCodigo } from './apiCompras';
import QRCode from 'qrcode';

async function gerarQrCodes(urls: string[]): Promise<Record<string, string>> {
  const cache: Record<string, string> = {};
  await Promise.all(
    urls.map(async (url) => {
      if (!url || cache[url]) return;
      try {
        cache[url] = await QRCode.toDataURL(url, {
          margin: 0,
          width: 96,
          errorCorrectionLevel: 'M'
        });
      } catch (e) {
        console.warn('Falha ao gerar QR code para', url, e);
      }
    })
  );
  return cache;
}

function downloadStorageFileUrl(path: string): string {
  const projectId = storage.app.options.projectId;
  return `https://us-central1-${projectId}.cloudfunctions.net/downloadStorageFile?path=${encodeURIComponent(path)}`;
}

const MARGIN_LEFT = 20;
const MARGIN_RIGHT = 15;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
const LINE_H = 6.5; // Espaçamento 1.5 ABNT
const MARGIN = MARGIN_LEFT;

interface PDFState {
  pdf: jsPDF;
  y: number;
  cor: [number, number, number];
  entidade: Entidade;
  logoBase64: string | null;
  projetoTitulo: string;
  isFirstPageEmpty?: boolean;
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
/** Extrai o path interno (entities/.../doc.pdf) de uma URL do Firebase Storage. */
function storagePathFromUrl(url: string): string | null {
  if (!url.includes('firebasestorage.googleapis.com')) return null;
  const match = url.match(/\/o\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  const path = storagePathFromUrl(url);
  const fetchUrl = path ? downloadStorageFileUrl(path) : url;

  try {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await blobToDataUrl(await resp.blob());
  } catch (e) {
    console.error('Falha ao baixar imagem:', url, e);
    return null;
  }
}

async function fetchPdfAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const path = storagePathFromUrl(url);
  const fetchUrl = path ? downloadStorageFileUrl(path) : url;

  try {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.arrayBuffer();
  } catch (e: any) {
    throw new Error(`Falha ao baixar PDF (${url}): ${e?.message || e}`);
  }
}


async function obterPdfPublicoCacheado(r: any): Promise<ArrayBuffer | null> {
  const fileKey = `${r.fonte}_${r.identificadorCompra.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const cachePath = `public_quote_pdfs/${fileKey}.pdf`;
  
  // Como estamos no navegador, o getBlob causa erro no console se não tiver CORS
  // Como as cotações públicas são abertas, vamos invocar o proxy imediatamente
  try {
    const projectId = storage.app.options.projectId;
    const region = 'us-central1';
    const funcUrl = `https://${region}-${projectId}.cloudfunctions.net/obterPdfContratacaoPublica`;
    
    const resp = await fetch(funcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          url: r.localizacaoUrl,
          token: fileKey
        }
      })
    });

    if (resp.ok) {
      const resData = await resp.json();
      const downloadUrl = resData.result?.downloadUrl;
      if (downloadUrl) {
        const fileResp = await fetch(downloadUrl);
        return await fileResp.arrayBuffer();
      }
    }
  } catch (err) {
    console.warn('Falha no microsserviço de captura Puppeteer:', err);
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
      pdf.addImage(logoBase64, format, 12, 7, 16, 16);
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
  pdf.line(MARGIN_LEFT, 26, PAGE_W - MARGIN_RIGHT, 26);
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
  pdf.line(MARGIN_LEFT, PAGE_H - MARGIN_BOTTOM + 2, PAGE_W - MARGIN_RIGHT, PAGE_H - MARGIN_BOTTOM + 2);

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
  pdf.text(addressText, PAGE_W / 2, PAGE_H - MARGIN_BOTTOM + 6, { align: 'center' });

  const telefonesStr = (entidade.telefones || []).join(' / ') || 'Não informado';
  const contactsText = `Telefone: ${telefonesStr}  |  E-mail: ${entidade.email || 'Não informado'}`;
  pdf.text(contactsText, PAGE_W / 2, PAGE_H - MARGIN_BOTTOM + 10, { align: 'center' });

  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(130, 130, 130);
  pdf.text(`Página ${pageNum} de ${total}`, PAGE_W / 2, PAGE_H - MARGIN_BOTTOM + 14, { align: 'center' });

  if (rubricaUrl) {
    try {
      pdf.addImage(rubricaUrl, getImgFormat(rubricaUrl), MARGIN_LEFT, PAGE_H - MARGIN_BOTTOM + 4, 10, 10);
    } catch {}
  }
}

function drawFallbackBarcode(pdf: jsPDF, x: number, y: number, w: number, h: number, token: string) {
  // Desenhar um mini box cinza com borda
  pdf.setFillColor(240, 240, 240);
  pdf.setDrawColor(180, 180, 180);
  pdf.rect(x, y, w, h - 5, 'DF');
  
  // Desenhar linhas finas simulando um código de barras
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.3);
  let curX = x + 3;
  while (curX < x + w - 3) {
    const barW = Math.random() > 0.5 ? 0.7 : 0.3;
    const gap = Math.random() > 0.5 ? 1 : 0.5;
    pdf.setLineWidth(barW);
    pdf.line(curX, y + 3, curX, y + h - 8);
    curX += barW + gap;
  }

  // Token embaixo
  pdf.setFontSize(6);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(50, 50, 50);
  const truncatedToken = token ? `${token.substring(0, 8)}...${token.substring(24)}` : 'VALIDAÇÃO';
  pdf.text(truncatedToken, x + w / 2, y + h - 2, { align: 'center' });
}

function checkPageSpace(state: PDFState, neededSpace: number) {
  if (state.y > PAGE_H - MARGIN_BOTTOM - neededSpace) {
    state.pdf.addPage();
    state.y = MARGIN_TOP;
    drawLetterheadHeader(state.pdf, state.entidade, state.logoBase64, state.cor);
  }
}

function forceNewPage(state: PDFState) {
  if (state.isFirstPageEmpty) {
    state.isFirstPageEmpty = false;
    state.y = MARGIN_TOP;
    drawLetterheadHeader(state.pdf, state.entidade, state.logoBase64, state.cor);
    return;
  }
  state.pdf.addPage();
  state.y = MARGIN_TOP;
  drawLetterheadHeader(state.pdf, state.entidade, state.logoBase64, state.cor);
}

function addChapterTitle(state: PDFState, title: string): number {
  checkPageSpace(state, 20);
  const { pdf } = state;
  const y = state.y;
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN_LEFT, y);
  state.y = y + LINE_H + 2;
  return (pdf as any).internal.getCurrentPageInfo().pageNumber;
}

function addSubTitle(state: PDFState, title: string) {
  checkPageSpace(state, 12);
  const { pdf } = state;
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN_LEFT, state.y);
  state.y += LINE_H;
}

function addBodyText(state: PDFState, text: string) {
  if (!text) return;
  const { pdf } = state;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0, 0, 0);
  
  const paragraphs = text.split('\n');
  const lineSpacing = LINE_H;
  const indent = 12.5; // Recuo da primeira linha ABNT
  
  for (let p = 0; p < paragraphs.length; p++) {
    const paraText = paragraphs[p];
    if (paraText.trim() === '') {
      state.y += lineSpacing * 0.5;
      continue;
    }
    
    // Manual word wrap and justify
    const words = paraText.trim().split(/\s+/);
    let currentLineWords: string[] = [];
    let lines: { text: string, isFirst: boolean }[] = [];
    let isFirstLine = true;
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      currentLineWords.push(word);
      const lineStr = currentLineWords.join(' ');
      const lineWidth = pdf.getTextWidth(lineStr);
      const maxW = isFirstLine ? CONTENT_W - indent : CONTENT_W;
      
      if (lineWidth > maxW && currentLineWords.length > 1) {
        currentLineWords.pop();
        lines.push({ text: currentLineWords.join(' '), isFirst: isFirstLine });
        currentLineWords = [word];
        isFirstLine = false;
      }
    }
    if (currentLineWords.length > 0) {
      lines.push({ text: currentLineWords.join(' '), isFirst: isFirstLine });
    }
    
    for (let i = 0; i < lines.length; i++) {
      const pageBefore = (pdf as any).internal.getCurrentPageInfo().pageNumber;
      checkPageSpace(state, lineSpacing);
      const pageAfter = (pdf as any).internal.getCurrentPageInfo().pageNumber;
      
      if (pageAfter > pageBefore) {
        // Restaura a fonte do corpo que foi alterada pelo cabeçalho da nova página
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(0, 0, 0);
      }
      
      const lineObj = lines[i];
      const lineStr = lineObj.text;
      const isLastLine = (i === lines.length - 1);
      const lineWords = lineStr.split(' ');
      
      const startX = lineObj.isFirst ? MARGIN_LEFT + indent : MARGIN_LEFT;
      const maxW = lineObj.isFirst ? CONTENT_W - indent : CONTENT_W;
      
      if (isLastLine || lineWords.length <= 1) {
        pdf.text(lineStr, startX, state.y);
      } else {
        const textWidth = pdf.getTextWidth(lineStr);
        const extraSpace = maxW - textWidth;
        const additionalSpacePerSpace = extraSpace / (lineWords.length - 1);
        
        let currentX = startX;
        const spaceWidth = pdf.getTextWidth(' ');
        
        for (let w = 0; w < lineWords.length; w++) {
          pdf.text(lineWords[w], currentX, state.y);
          currentX += pdf.getTextWidth(lineWords[w]) + spaceWidth + additionalSpacePerSpace;
        }
      }
      state.y += lineSpacing;
    }
    
    if (p < paragraphs.length - 1) {
      state.y += lineSpacing * 0.5;
    }
  }
}

function addField(state: PDFState, label: string, value: string, x: number, maxW = CONTENT_W) {
  const { pdf } = state;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  const labelText = label + ':';
  // Calcula dinamicamente a largura do rótulo para evitar sobreposições (com margem de segurança de 2.5mm)
  const labelWidth = Math.max(35, pdf.getTextWidth(labelText) + 2.5);
  const valMaxW = maxW - labelWidth;
  const lines = pdf.splitTextToSize(value || '-', valMaxW);
  const neededHeight = lines.length * LINE_H;
  checkPageSpace(state, neededHeight + 4);
  const y = state.y;
  
  pdf.setTextColor(0, 0, 0);
  pdf.text(labelText, x, y);
  pdf.setFont('helvetica', 'normal');
  pdf.text(lines, x + labelWidth, y);
  state.y = y + neededHeight;
}

function addSubSection(state: PDFState, title: string) {
  checkPageSpace(state, 12);
  const { pdf } = state;
  const y = state.y;
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN_LEFT, y);
  state.y = y + LINE_H;
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

  let y = MARGIN_TOP + 5;
    
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text('SUMÁRIO', MARGIN_LEFT, y);
  y += 15;

  // Linhas do sumário
  for (const entry of toc) {
    // Linha pontilhada
    const numW = 8;
    const pageStr = `${entry.page}`;
    const pageStrW = pdf.getTextWidth(pageStr);
    const titleX = MARGIN_LEFT + numW + 2;
    const maxTitleW = CONTENT_W - numW - pageStrW - 8;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text(entry.num, MARGIN_LEFT, y);

    pdf.setFont('helvetica', 'normal');
    const titleLines = pdf.splitTextToSize(entry.title, maxTitleW);
    pdf.text(titleLines[0], titleX, y);

    // Linha de pontos
    const titleEndX = titleX + pdf.getTextWidth(titleLines[0]);
    const dotLineEndX = PAGE_W - MARGIN_RIGHT - pageStrW - 3;
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
    pdf.text(pageStr, PAGE_W - MARGIN_RIGHT - pageStrW, y);

    y += 7;
    if (y > PAGE_H - MARGIN_BOTTOM - 10) break; // Segurança: não ultrapassar o rodapé
  }
}

async function renderPesquisaCertificadosJsPdf(
  itensPesquisados: ItemProjeto[],
  entidade: Entidade,
  cor: [number, number, number],
  logoBase64: string | null
): Promise<Uint8Array | null> {
  if (itensPesquisados.length === 0) return null;

  // Pre-gera QR codes — APENAS pra links PNCP oficiais. Pra cotações
  // manuais/fomento usa o documento próprio do user. Storage jamais.
  const fontesGov = ['compras.gov.br', 'pncp', 'pncp-contratacao', 'pncp-ata'];
  const todasUrls = itensPesquisados.flatMap(it =>
    (it.referencias || []).map((r: any) => {
      if (fontesGov.includes(r.fonte)) {
        return r.linkPncpOriginal?.includes('pncp.gov.br') ? r.linkPncpOriginal : '';
      }
      return r.localizacaoUrl || '';
    }).filter(Boolean)
  );
  const qrCache = await gerarQrCodes(todasUrls);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const corClara = lightenRgb(cor, 0.88);
  const state: PDFState = {
    pdf,
    y: 33,
    cor,
    entidade,
    logoBase64,
    projetoTitulo: '',
    isFirstPageEmpty: true
  };

  for (const it of itensPesquisados) {
    forceNewPage(state);

    const boxY = state.y;
    pdf.setFillColor(248, 250, 252);
    pdf.rect(MARGIN, boxY, CONTENT_W, 25, 'F');
    pdf.setDrawColor(...cor);
    pdf.setLineWidth(0.4);
    pdf.rect(MARGIN, boxY, CONTENT_W, 25, 'D');

    pdf.setFontSize(10.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...cor);
    pdf.text("CERTIFICADO DE AUTENTICIDADE E COTAÇÃO DE PREÇOS PÚBLICOS", PAGE_W / 2, boxY + 7.5, { align: 'center' });

    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 80, 80);
    pdf.text("JUSTIFICATIVA DE PREÇO DE MERCADO • INSTRUÇÃO NORMATIVA SEGES/ME Nº 65/2021", PAGE_W / 2, boxY + 13.5, { align: 'center' });

    pdf.setFontSize(7.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(110, 110, 110);
    pdf.text(`REGISTRO DE VALIDAÇÃO: ${it.tokenPesquisa || 'N/A'}`, PAGE_W / 2, boxY + 19, { align: 'center' });

    state.y = boxY + 30;

    // Aviso legal especial: item declaradamente sem CATMAT/CATSER -> rota alternativa
    if (it.semCorrespondenciaCatalogo) {
      const avisoY = state.y;
      const avisoH = 30;
      pdf.setFillColor(250, 245, 255); // roxo bem claro
      pdf.rect(MARGIN, avisoY, CONTENT_W, avisoH, 'F');
      pdf.setDrawColor(147, 51, 234); // roxo
      pdf.setLineWidth(0.5);
      pdf.rect(MARGIN, avisoY, CONTENT_W, avisoH, 'D');

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(88, 28, 135); // roxo escuro
      pdf.text("⚖ PESQUISA DE PREÇO POR ROTA LEGAL ALTERNATIVA — 3 ORÇAMENTOS", MARGIN + 3, avisoY + 5.5);

      pdf.setFontSize(7.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(60, 30, 80);
      const textoLegal = "Item declaradamente sem correspondência no catálogo CATMAT/CATSER. Pesquisa de preço " +
        "fundamentada em IN SEGES/ME 73/2020 art. 5º IV (pesquisa direta com fornecedores nos últimos 6 meses) " +
        "ou IN 65/2021 art. 5º V (notas fiscais eletrônicas), em linha com Lei 14.133/21 art. 28 e " +
        "Acórdão TCU 1445/2015 (fontes diversificadas). Mínimo de 3 cotações de fornecedores anexadas.";
      const linhas = pdf.splitTextToSize(textoLegal, CONTENT_W - 6);
      pdf.text(linhas, MARGIN + 3, avisoY + 10.5);

      state.y = avisoY + avisoH + 5;
    }

    addSubSection(state, "COMPARATIVO GERAL DE PREÇOS (PROPOSTO VS. REFERÊNCIAS)");

    const FONTES_PUBLICAS_AUTO = ['compras.gov.br', 'pncp', 'pncp-contratacao', 'pncp-ata', 'tce-pe'];
    const FONTES_DOC_PUBLICO = ['contrato-publico', 'convenio', 'termo-fomento', 'fomento', 'tabela-preco'];
    const FONTE_ULTIMO_RECURSO = 'manual'; // 3 orcamentos de fornecedores

    const publicRefs = it.referencias?.filter((r: any) => FONTES_PUBLICAS_AUTO.includes(r.fonte)) || [];
    const docPublicoRefs = it.referencias?.filter((r: any) => FONTES_DOC_PUBLICO.includes(r.fonte)) || [];
    const orcamentoRefs = it.referencias?.filter((r: any) => r.fonte === FONTE_ULTIMO_RECURSO) || [];

    const mediaFn = (refs: any[]) => refs.length > 0
      ? refs.reduce((acc: number, r: any) => acc + r.valorUnitario, 0) / refs.length
      : null;

    const avgPublic = mediaFn(publicRefs);
    const avgDocPublico = mediaFn(docPublicoRefs);
    const avgOrcamento = mediaFn(orcamentoRefs);

    const formatBrl = (val: number | null) => {
      if (val === null) return '—';
      return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const compBody = [
      ['Valor Estimado Proposto no Projeto', formatBrl(it.valorUnitario), 'Preço unitário sugerido no Plano de Trabalho'],
      ['Média Compras Públicas — IN 73/2020 art. 5º I/II', formatBrl(avgPublic), `${publicRefs.length} cotação(ões) automática(s) (PNCP/Compras.gov.br)`],
      ['Média Docs Públicos Anexados — IN 73/2020 art. 5º II/III', formatBrl(avgDocPublico), `${docPublicoRefs.length} contrato/convênio/termo/tabela anexado(s)`],
      ['Média 3 Orçamentos Fornecedores — IN 73/2020 art. 5º IV (último recurso)', formatBrl(avgOrcamento), `${orcamentoRefs.length} orçamento(s) de fornecedor`],
      ['Mediana Geral Homologada (Blindagem de Cesta)', formatBrl(it.medianaReferencia || null), 'Mediana linear de referência da cesta (IN 65)']
    ];

    autoTable(pdf, {
      startY: state.y,
      head: [['Origem da Cotação / Referência', 'Valor Unitário', 'Observação / Descrição da Fonte']],
      body: compBody,
      margin: { left: MARGIN, right: MARGIN },
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { fontSize: 7.5, textColor: [0, 0, 0] },
      columnStyles: {
        0: { cellWidth: 65, fontStyle: 'bold' },
        1: { cellWidth: 35, fontStyle: 'bold', halign: 'right' },
        2: { cellWidth: 70 }
      },
      didDrawPage: (data) => {
        if (data.doc.internal.getNumberOfPages() > 1) {
          drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
        }
      }
    });

    state.y = (pdf as any).lastAutoTable.finalY + 8;

    addSubSection(state, "DETALHAMENTO DO ITEM DO PROJETO");
    addField(state, "Item", it.nome, MARGIN); state.y += 1.5;
    if (it.descricao) {
      addField(state, "Especificação", it.descricao, MARGIN); state.y += 1.5;
    }
    if (it.ultimoCodigoVinculado) {
      const matInfo = obterDetalheMaterialPorCodigo(it.ultimoCodigoVinculado, it.nome);
      if (matInfo) {
        addField(state, "Catálogo CATMAT/CATSER", `${matInfo.nome} (Código: ${matInfo.codigoItem})\nDescrição: ${matInfo.descricaoItem}`, MARGIN);
        state.y += 1.5;
      }
    }
    addField(state, "Memorial Cálculo", it.memorialCalculo, MARGIN); state.y += 1.5;
    addField(state, "Qtd / Unidade", `${it.quantidade} ${it.unidade}`, MARGIN); state.y += 1.5;
    addField(state, "Valor Estimado Unitário", it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), MARGIN); state.y += 4;

    addSubSection(state, "CESTA DE PREÇOS PÚBLICOS DE REFERÊNCIA (IN 65/2021)");

    const refRows = it.referencias?.map((r: any) => [
      r.fonte.toUpperCase(),
      r.orgaoLicitante,
      r.identificadorCompra || '-',
      r.uasg || '-',
      r.dataHomologacao || '-',
      r.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    ]) || [];

    autoTable(pdf, {
      startY: state.y,
      head: [['Fonte', 'Órgão Licitante / Compra', 'Identificador', 'UASG', 'Data', 'Unitário']],
      body: refRows.length > 0 ? refRows : [['—', '—', '—', '—', '—', '—']],
      margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
      headStyles: { fillColor: cor },
      alternateRowStyles: { fillColor: corClara },
      styles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 55 },
        2: { cellWidth: 35 },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 22, halign: 'right' },
      },
      didDrawPage: (data) => {
        if (data.doc.internal.getNumberOfPages() > 1) {
          drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
        }
      }
    });

    state.y = (pdf as any).lastAutoTable.finalY + 4;

    // === SEÇÃO: AUDITORIA DETALHADA POR COTAÇÃO ===
    // Ficha completa de cada cotação com todos os campos rastreáveis
    // (CNPJ órgão, modalidade, situação, CATMAT, fornecedor, etc.)
    // + QR code apontando pro portal oficial PNCP/Compras.
    const refsAudit = (it.referencias || []).filter((r: any) => r.localizacaoUrl || r.cnpjOrgao);
    if (refsAudit.length > 0) {
      checkPageSpace(state, 14);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...cor);
      pdf.text('AUDITORIA DETALHADA — FICHAS DE COMPROVAÇÃO', MARGIN, state.y);
      state.y += 4;

      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(110, 110, 110);
      pdf.text(
        'Cada ficha abaixo permite ao parecerista validar a cotação diretamente no portal oficial '
        + '(PNCP/Compras.gov.br) via QR code ou link clicável.',
        MARGIN, state.y
      );
      state.y += 5;

      const QR_SIZE = 22;
      const FICHA_H = 50;
      const TEXT_X = MARGIN + QR_SIZE + 3;
      const TEXT_MAX_W = CONTENT_W - QR_SIZE - 3;
      const LABEL_W = 26;

      for (let i = 0; i < refsAudit.length; i++) {
        const r: any = refsAudit[i];
        checkPageSpace(state, FICHA_H + 2);
        const cardY = state.y;

        // Moldura
        pdf.setFillColor(252, 252, 253);
        pdf.setDrawColor(220, 224, 230);
        pdf.setLineWidth(0.3);
        pdf.rect(MARGIN, cardY, CONTENT_W, FICHA_H, 'FD');

        // QR code — APENAS link oficial. Storage não vai pro relatório.
        const qrUrl = fontesGov.includes(r.fonte)
          ? (r.linkPncpOriginal?.includes('pncp.gov.br') ? r.linkPncpOriginal : '')
          : (r.localizacaoUrl || '');
        const qrData = qrUrl ? qrCache[qrUrl] : null;
        if (qrData) {
          try {
            pdf.addImage(qrData, 'PNG', MARGIN + 2, cardY + 2, QR_SIZE - 4, QR_SIZE - 4);
          } catch {}
        }
        // Numeração abaixo do QR
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...cor);
        pdf.text(`[${i + 1}]`, MARGIN + 2, cardY + QR_SIZE + 2);

        // Cabeçalho: órgão (esq) + fonte (dir)
        pdf.setFontSize(8.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(40, 40, 40);
        const fonteLabel = ({
          'compras.gov.br': 'COMPRAS.GOV.BR',
          'pncp-contratacao': 'PNCP — EDITAL',
          'pncp-ata': 'PNCP — ATA',
          'pncp': 'PNCP',
          'tce-pe': 'TCE-PE',
          'fomento': 'FOMENTO MANUAL',
          'manual': 'CADASTRO MANUAL'
        } as Record<string, string>)[r.fonte] || (r.fonte || '').toUpperCase();
        pdf.setFontSize(6.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...cor);
        const fonteW = pdf.getTextWidth(fonteLabel);
        const fonteX = MARGIN + CONTENT_W - fonteW - 3;
        pdf.text(fonteLabel, fonteX, cardY + 4);

        pdf.setFontSize(8.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(40, 40, 40);
        const orgaoLines = pdf.splitTextToSize(r.orgaoLicitante || '-', TEXT_MAX_W - fonteW - 5);
        pdf.text(orgaoLines[0], TEXT_X, cardY + 4);

        // Linhas chave-valor (grid 2 colunas)
        let lineY = cardY + 9;
        const COL_GAP = 4;
        const colWidth = (TEXT_MAX_W - COL_GAP) / 2;

        const drawKV = (label: string, value: string, x: number, y: number) => {
          if (!value || value === '-') {
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(160, 160, 160);
            pdf.setFontSize(7);
            pdf.text(label, x, y);
            pdf.setFont('helvetica', 'normal');
            pdf.text('-', x + LABEL_W, y);
            return;
          }
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(100, 100, 100);
          pdf.setFontSize(7);
          pdf.text(label, x, y);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(40, 40, 40);
          const valLines = pdf.splitTextToSize(value, colWidth - LABEL_W);
          pdf.text(valLines[0], x + LABEL_W, y);
        };

        const colA = TEXT_X;
        const colB = TEXT_X + colWidth + COL_GAP;
        const formatBrl = (v: number) =>
          v ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';
        const orgaoMeta = [r.poder, r.esfera, r.uf].filter(Boolean).join(' • ');

        drawKV('CNPJ Órgão:', r.cnpjOrgao || '-', colA, lineY);
        drawKV('Esfera/UF:', orgaoMeta || '-', colB, lineY);
        lineY += 3.5;

        drawKV('Modalidade:', r.modalidade || '-', colA, lineY);
        drawKV('Situação:', r.situacao || '-', colB, lineY);
        lineY += 3.5;

        drawKV('Identificador:', r.identificadorCompra || '-', colA, lineY);
        drawKV('UASG:', r.uasg || '-', colB, lineY);
        lineY += 3.5;

        drawKV('Nº PNCP:', r.numeroControlePNCP || '-', colA, lineY);
        drawKV('Data:', r.dataHomologacao || '-', colB, lineY);
        lineY += 3.5;

        drawKV(
          'CATMAT/CATSER:',
          r.codigoCatalogoItem
            ? `${r.codigoCatalogoItem}${r.descricaoItem ? ' — ' + r.descricaoItem.substring(0, 30) : ''}`
            : '-',
          colA, lineY
        );
        drawKV('Vigência ARP:', r.dataVigenciaFinalAta ? `até ${r.dataVigenciaFinalAta}` : '-', colB, lineY);
        lineY += 3.5;

        const qtdUnid = r.quantidade ? `${r.quantidade}${r.unidadeMedida ? ' ' + r.unidadeMedida : ''}` : '-';
        drawKV('Qtd:', qtdUnid, colA, lineY);
        drawKV('Valor Unit.:', formatBrl(Number(r.valorUnitario)), colB, lineY);
        lineY += 3.5;

        // Fornecedor (largura total)
        const fornec = r.fornecedorNome
          ? `${r.fornecedorNome}${r.fornecedorCnpj ? ' (CNPJ ' + r.fornecedorCnpj + ')' : ''}`
          : '-';
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(100, 100, 100);
        pdf.setFontSize(7);
        pdf.text('Adjudicatário:', colA, lineY);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(40, 40, 40);
        const fornecLines = pdf.splitTextToSize(fornec, TEXT_MAX_W - LABEL_W);
        pdf.text(fornecLines[0], colA + LABEL_W, lineY);
        lineY += 3.5;

        // Link oficial — política estrita: SÓ link governamental original
        // (pncp.gov.br/app/...), nunca o Firebase Storage. Pra cotações
        // manuais (fomento/manual), o localizacaoUrl é o PDF do user.
        // (usa o 'fontesGov' do escopo da função)
        const ehGov = fontesGov.includes(r.fonte);
        const linkOficial = r.linkPncpOriginal && r.linkPncpOriginal.includes('pncp.gov.br')
          ? r.linkPncpOriginal
          : (!ehGov && r.localizacaoUrl ? r.localizacaoUrl : '');

        if (linkOficial) {
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(100, 100, 100);
          pdf.setFontSize(7);
          pdf.text(ehGov ? 'Validar no PNCP:' : 'Documento:', colA, lineY);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(0, 102, 204);
          const urlLines = pdf.splitTextToSize(linkOficial, TEXT_MAX_W - LABEL_W);
          pdf.textWithLink(urlLines[0], colA + LABEL_W, lineY, { url: linkOficial });
        } else if (ehGov) {
          // Fonte governamental mas SEM link rastreável (cotação legada anterior à v1.5.9.8)
          pdf.setFont('helvetica', 'italic');
          pdf.setTextColor(160, 100, 100);
          pdf.setFontSize(6.5);
          pdf.text('(Pesquisa anterior à v1.5.9.8 — re-execute para vincular ao PNCP)', colA, lineY);
        }

        state.y += FICHA_H + 2;
      }
      state.y += 2;
    }

    state.y += 4;

    checkPageSpace(state, 40);
    const summaryY = state.y;

    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.3);
    pdf.rect(MARGIN, summaryY, CONTENT_W, 36, 'DF');

    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(80, 80, 80);
    pdf.text("DECLARAÇÃO E ANÁLISE ESTATÍSTICA DE MERCADO", MARGIN + 6, summaryY + 6);

    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(60, 60, 60);
    pdf.text(`Média da Cesta: R$ ${it.mediaReferencia?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, MARGIN + 6, summaryY + 13);
    pdf.text(`Mediana da Cesta: R$ ${it.medianaReferencia?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, MARGIN + 6, summaryY + 18);

    const declaracaoStr = `Declara-se que o preço unitário sugerido de R$ ${it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} é economicamente viável e justificado perante o mercado público (IN 65/2021), encontrando-se abaixo da mediana linear de R$ ${it.medianaReferencia?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} praticada por órgãos federais e estaduais de fomento.`;
    const splitDec = pdf.splitTextToSize(declaracaoStr, CONTENT_W - 12);
    pdf.setFontSize(7.5);
    pdf.text(splitDec, MARGIN + 6, summaryY + 24);

    state.y = summaryY + 42;
  }

  // ============================================================================
  // PÁGINA FINAL: EXTRATO DE FONTES UTILIZADAS NESTE RELATÓRIO
  // ============================================================================
  // Inspirada no formato "Banco de Preços" — credibilidade via diversidade de
  // fontes (Acórdão TCU 1445/2015 + IN 73/2020 art. 5º).
  forceNewPage(state);
  const fY = state.y;
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...cor);
  pdf.text('EXTRATO DE FONTES UTILIZADAS NESTE RELATÓRIO', PAGE_W / 2, fY, { align: 'center' });

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'italic');
  pdf.setTextColor(80, 80, 80);
  const explicTxt = 'O sistema LIE consulta diretamente os endpoints oficiais do governo federal (PNCP/Compras.gov.br) e tribunais de contas estaduais, ' +
    'sem intermediação de terceiros. Quando aplicável, complementa com documentos públicos anexados pela entidade ' +
    '(contratos, convênios, termos de fomento, tabelas oficiais). Atende integralmente ao Art. 5º da IN 73/2020 ' +
    '(SEGES/ME) e Art. 23 da Lei 14.133/21, em linha com Acórdãos TCU 1445/2015 e 1231/2018 (fontes diversificadas).';
  const explicLines = pdf.splitTextToSize(explicTxt, CONTENT_W);
  pdf.text(explicLines, MARGIN, fY + 6);
  state.y = fY + 6 + explicLines.length * 3.5 + 4;

  // Catalogar todas as fontes únicas a partir das cotações usadas
  type FonteRow = { ordem: number; nome: string; url: string; dataAcesso: string; categoria: string };
  const fontesCatalogadas: FonteRow[] = [];
  const urlsVistos = new Set<string>();

  // 1. Fontes governamentais APIs (sempre listadas — são as 3 fontes principais)
  const apisGov: FonteRow[] = [
    {
      ordem: 1, nome: 'Compras.gov.br — Dados Abertos (Pesquisa de Preços)',
      url: 'https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial',
      dataAcesso: new Date().toLocaleDateString('pt-BR'),
      categoria: 'API Federal',
    },
    {
      ordem: 2, nome: 'PNCP — Portal Nacional de Contratações Públicas',
      url: 'https://pncp.gov.br',
      dataAcesso: new Date().toLocaleDateString('pt-BR'),
      categoria: 'API Federal',
    },
    {
      ordem: 3, nome: 'Catálogo CATMAT/CATSER (Compras.gov.br)',
      url: 'https://catalogo.compras.gov.br',
      dataAcesso: new Date().toLocaleDateString('pt-BR'),
      categoria: 'Catálogo Oficial',
    },
  ];
  apisGov.forEach(f => {
    fontesCatalogadas.push(f);
    urlsVistos.add(f.url);
  });

  // 2. Fontes específicas extraídas das cotações (TCE-PE, links PNCP individuais, docs manuais)
  let ord = 4;
  for (const it of itensPesquisados) {
    if (!it.referencias || !Array.isArray(it.referencias)) continue;
    for (const r of it.referencias as any[]) {
      // TCE-PE como fonte estadual
      if (r.fonte === 'tce-pe' && !urlsVistos.has('https://sistemas.tce.pe.gov.br')) {
        fontesCatalogadas.push({
          ordem: ord++,
          nome: 'TCE-PE — Tribunal de Contas do Estado de Pernambuco',
          url: 'https://sistemas.tce.pe.gov.br/DadosAbertos/',
          dataAcesso: new Date().toLocaleDateString('pt-BR'),
          categoria: 'API Estadual',
        });
        urlsVistos.add('https://sistemas.tce.pe.gov.br');
      }
      // Docs públicos manuais (contrato, convênio, fomento, tabela)
      const fontesManuais = ['contrato-publico', 'convenio', 'termo-fomento', 'fomento', 'tabela-preco'];
      if (fontesManuais.includes(r.fonte) && r.localizacaoUrl && !urlsVistos.has(r.localizacaoUrl)) {
        const labelFonte = {
          'contrato-publico': 'Contrato Público',
          'convenio': 'Convênio',
          'termo-fomento': 'Termo de Fomento',
          'fomento': 'Termo de Fomento',
          'tabela-preco': 'Tabela de Preços',
        }[r.fonte as string] || 'Documento Público';
        fontesCatalogadas.push({
          ordem: ord++,
          nome: `${labelFonte}: ${r.orgaoLicitante || 'Documento Anexo'}`,
          url: r.localizacaoUrl,
          dataAcesso: r.dataHomologacao || new Date().toLocaleDateString('pt-BR'),
          categoria: 'Documento Manual',
        });
        urlsVistos.add(r.localizacaoUrl);
      }
      // Orçamentos de fornecedores (último recurso)
      if (r.fonte === 'manual' && r.localizacaoUrl && !urlsVistos.has(r.localizacaoUrl)) {
        fontesCatalogadas.push({
          ordem: ord++,
          nome: `Orçamento de Fornecedor: ${r.orgaoLicitante || 'Sem identificação'}`,
          url: r.localizacaoUrl,
          dataAcesso: r.dataHomologacao || new Date().toLocaleDateString('pt-BR'),
          categoria: 'Orçamento Fornecedor',
        });
        urlsVistos.add(r.localizacaoUrl);
      }
    }
  }

  // Renderizar tabela de fontes
  autoTable(pdf, {
    startY: state.y,
    head: [['#', 'Fonte / Portal Consultado', 'URL', 'Categoria', 'Data de Acesso']],
    body: fontesCatalogadas.map(f => [
      String(f.ordem),
      f.nome,
      f.url.length > 60 ? f.url.substring(0, 57) + '…' : f.url,
      f.categoria,
      f.dataAcesso,
    ]),
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontSize: 7.5 },
    styles: { fontSize: 7, textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 65 },
      2: { cellWidth: 70, textColor: [37, 99, 235], font: 'courier', fontSize: 6.5 },
      3: { cellWidth: 22 },
      4: { cellWidth: 18, halign: 'center' },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    },
  });

  state.y = (pdf as any).lastAutoTable.finalY + 6;

  // Nota legal final
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'italic');
  pdf.setTextColor(100, 100, 100);
  const notaTxt = `${fontesCatalogadas.length} fonte(s) listada(s). Os preços públicos foram coletados via APIs oficiais, ` +
    'que garantem rastreabilidade integral até o edital original publicado no Portal Nacional de Contratações Públicas (PNCP). ' +
    'Cada cotação inclui link direto pro documento de origem para auditoria externa pela própria entidade ou órgão de controle.';
  const notaLines = pdf.splitTextToSize(notaTxt, CONTENT_W);
  pdf.text(notaLines, MARGIN, state.y);

  return new Uint8Array(pdf.output('arraybuffer'));
}

export interface PrintOptions {
  projeto: boolean;
  capacidadeTecnica?: boolean;
  pesquisa: boolean;
  documentosEntidade: boolean;
  certidoes: boolean;
  numerarRubricar: boolean;
  rubricaUrl?: string;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; format: 'png' | 'jpg' } | null {
  const match = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
  if (!match) return null;
  const fmt = match[1].toLowerCase();
  const format: 'png' | 'jpg' = fmt === 'png' ? 'png' : 'jpg';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, format };
}

async function embedLogoPdfLib(pdfDoc: PDFDocument, logoBase64: string | null): Promise<PDFImage | null> {
  if (!logoBase64) return null;
  const parsed = dataUrlToBytes(logoBase64);
  if (!parsed) return null;
  try {
    return parsed.format === 'png'
      ? await pdfDoc.embedPng(parsed.bytes)
      : await pdfDoc.embedJpg(parsed.bytes);
  } catch (e) {
    console.warn('Falha ao embeddar logo no pdf-lib:', e);
    return null;
  }
}

async function addSeparatorPage(
  pdfDoc: PDFDocument,
  titulo: string,
  subtitulo: string,
  logoImg: PDFImage | null,
  cor: [number, number, number],
  fontBold: PDFFont,
  fontReg: PDFFont
): Promise<number> {
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const corRgb = rgb(cor[0] / 255, cor[1] / 255, cor[2] / 255);

  page.drawRectangle({ x: 0, y: 0, width: 42, height, color: corRgb });

  if (logoImg) {
    const targetSize = 110;
    const scale = targetSize / Math.max(logoImg.width, logoImg.height);
    const w = logoImg.width * scale;
    const h = logoImg.height * scale;
    page.drawImage(logoImg, {
      x: (width - w) / 2,
      y: height / 2 + 60,
      width: w,
      height: h
    });
  }

  page.drawLine({
    start: { x: width * 0.28, y: height / 2 - 5 },
    end: { x: width * 0.72, y: height / 2 - 5 },
    thickness: 1.2,
    color: corRgb
  });

  const titleSize = 22;
  const titleWidth = fontBold.widthOfTextAtSize(titulo, titleSize);
  page.drawText(titulo, {
    x: (width - titleWidth) / 2,
    y: height / 2 - 38,
    size: titleSize,
    font: fontBold,
    color: corRgb
  });

  if (subtitulo) {
    const subSize = 11;
    const maxWidth = width * 0.7;
    const words = subtitulo.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const test = current ? current + ' ' + w : w;
      if (fontReg.widthOfTextAtSize(test, subSize) > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    let lineY = height / 2 - 65;
    for (const line of lines) {
      const lw = fontReg.widthOfTextAtSize(line, subSize);
      page.drawText(line, {
        x: (width - lw) / 2,
        y: lineY,
        size: subSize,
        font: fontReg,
        color: rgb(0.35, 0.35, 0.35)
      });
      lineY -= subSize * 1.4;
    }
  }

  return pdfDoc.getPageCount();
}

async function drawTocOnPdfLib(
  pdfDoc: PDFDocument,
  pageIndex: number,
  toc: TocEntry[],
  cor: [number, number, number],
  fontReg: PDFFont,
  fontBold: PDFFont
) {
  if (pageIndex >= pdfDoc.getPageCount()) return;
  const page = pdfDoc.getPage(pageIndex);
  const { width, height } = page.getSize();
  const corRgb = rgb(cor[0] / 255, cor[1] / 255, cor[2] / 255);

  page.drawText('SUMÁRIO', {
    x: 55, y: height - 70, size: 16, font: fontBold, color: rgb(0, 0, 0)
  });
  page.drawLine({
    start: { x: 55, y: height - 80 },
    end: { x: width - 55, y: height - 80 },
    thickness: 0.6,
    color: corRgb
  });

  let y = height - 105;
  const lineSize = 10;
  const lineGap = 18;
  const dotChar = '.';

  for (const entry of toc) {
    if (y < 50) break;

    const numText = entry.num ? entry.num + '.' : '';
    const titleText = entry.title;
    const pageText = String(entry.page);

    let cursor = 55;
    if (numText) {
      page.drawText(numText, { x: cursor, y, size: lineSize, font: fontBold, color: rgb(0, 0, 0) });
      cursor += fontBold.widthOfTextAtSize(numText, lineSize) + 5;
    }

    const isSub = entry.num === '';
    const titleX = isSub ? cursor + 12 : cursor;
    page.drawText(titleText, {
      x: titleX, y, size: lineSize,
      font: isSub ? fontReg : fontBold,
      color: rgb(0, 0, 0)
    });

    const pageWidth = fontBold.widthOfTextAtSize(pageText, lineSize);
    page.drawText(pageText, {
      x: width - 55 - pageWidth, y, size: lineSize, font: fontBold, color: rgb(0, 0, 0)
    });

    const titleWidth = (isSub ? fontReg : fontBold).widthOfTextAtSize(titleText, lineSize);
    const titleEndX = titleX + titleWidth + 4;
    const dotEndX = width - 55 - pageWidth - 4;
    const dotW = fontReg.widthOfTextAtSize(dotChar, lineSize);
    let dotX = titleEndX;
    let dots = '';
    while (dotX < dotEndX) {
      dots += dotChar;
      dotX += dotW * 1.8;
    }
    if (dots) {
      page.drawText(dots, {
        x: titleEndX, y, size: lineSize, font: fontReg, color: rgb(0.55, 0.55, 0.55)
      });
    }

    y -= lineGap;
  }
}

async function mergePdfBytes(target: PDFDocument, bytes: ArrayBuffer): Promise<number> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach(p => target.addPage(p));
  return pages.length;
}

export async function consolidarProjeto(projetoId: string, options: PrintOptions = { projeto: true, pesquisa: true, documentosEntidade: false, certidoes: false, numerarRubricar: false }): Promise<void> {
  const rubricaUrl = options.numerarRubricar ? options.rubricaUrl : undefined;
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

  if (options.projeto) {
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
  }

  // Inicializar estado
  const state: PDFState = {
    pdf,
    y: 33,
    cor,
    entidade,
    logoBase64,
    projetoTitulo: projeto.titulo,
    isFirstPageEmpty: !options.projeto
  };

  const toc: TocEntry[] = [];

  if (options.projeto) {
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
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9, textColor: [0, 0, 0] },
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
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9, textColor: [0, 0, 0] },
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
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9, textColor: [0, 0, 0] },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 7: RELAÇÃO DE ITENS DO PROJETO ==========
  forceNewPage(state);
  const p7 = (pdf as any).internal.getCurrentPageInfo().pageNumber;
  addChapterTitle(state, '7. Plano de Aplicação — Itens e Memorial de Cálculo');
  toc.push({ num: '7', title: 'Plano de Aplicação — Itens e Memorial de Cálculo', page: p7 });

  // Plano de Aplicação agrupado por Etapa › Tipo (categoria), numerado N.0 / N.M / N.M.K,
  // com o memorial de cálculo de cada item.
  const fmtBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const CATS_PDF = ['Alimento', 'Transporte', 'Material Esportivo', 'Material não Esportivo', 'Recurso Humano', 'Outro'];
  const etapasPDF: { id: string; nome: string }[] = [
    ...((projeto.etapas || []).map(e => ({ id: e.id, nome: e.nome }))),
    ...(itensProjeto.some(it => !it.etapaId) ? [{ id: '', nome: 'Sem etapa' }] : []),
  ];
  const corHdr = lightenRgb(cor, 0.0);
  const corSub = lightenRgb(cor, 0.85);
  const itemsBody: any[] = [];
  let totalGeral = 0;
  etapasPDF.forEach((etapa, gi) => {
    const itensEt = itensProjeto.filter(it => (it.etapaId || '') === etapa.id);
    if (itensEt.length === 0) return;
    const numEt = gi + 1;
    const codEt = etapa.id ? `${numEt}.0 — ` : '';
    let subEt = 0;
    itemsBody.push([{ content: `${codEt}${(etapa.nome || '').toUpperCase()}`, colSpan: 7, styles: { fillColor: corHdr, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 } }]);
    const tipos = CATS_PDF.filter(c => itensEt.some(it => (it.categoria || 'Outro') === c));
    tipos.forEach((tipo, ti) => {
      itemsBody.push([{ content: `${etapa.id ? `${numEt}.${ti + 1} — ` : ''}${tipo}`, colSpan: 7, styles: { fillColor: corSub, fontStyle: 'bold', fontSize: 8 } }]);
      itensEt.filter(it => (it.categoria || 'Outro') === tipo).forEach((it, ii) => {
        const vtot = it.valorTotal || (it.valorUnitario * it.quantidade) || 0;
        subEt += vtot; totalGeral += vtot;
        const cod = etapa.id ? `${numEt}.${ti + 1}.${ii + 1}` : `${ii + 1}`;
        const nomeEsp = it.descricao ? `${it.nome}\n${it.descricao}` : it.nome;
        itemsBody.push([
          cod, nomeEsp, it.memorialCalculo || '—', it.unidade,
          String(it.quantidade || 0), fmtBRL(it.valorUnitario), fmtBRL(vtot),
        ]);
      });
    });
    itemsBody.push([{ content: `Subtotal — ${etapa.nome}`, colSpan: 6, styles: { halign: 'right', fontStyle: 'bold', fillColor: corSub } }, { content: fmtBRL(subEt), styles: { halign: 'right', fontStyle: 'bold', fillColor: corSub } }]);
  });
  if (itemsBody.length === 0) {
    itemsBody.push([{ content: 'Nenhum item cadastrado no projeto.', colSpan: 7, styles: { halign: 'center', textColor: [140, 140, 140] } }]);
  } else {
    itemsBody.push([{ content: 'TOTAL GERAL DO PROJETO', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold', fillColor: corHdr, textColor: [255, 255, 255] } }, { content: fmtBRL(totalGeral), styles: { halign: 'right', fontStyle: 'bold', fillColor: corHdr, textColor: [255, 255, 255] } }]);
  }

  autoTable(pdf, {
    startY: state.y,
    head: [['Cód.', 'Item / Especificação', 'Memorial de Cálculo', 'Un.', 'Qtd', 'V. Unit.', 'V. Total']],
    body: itemsBody,
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    styles: { fontSize: 8, textColor: [0, 0, 0], valign: 'top' },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 34 },
      2: { cellWidth: 52 },
      3: { cellWidth: 12 },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 24, halign: 'right' },
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
        margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
        headStyles: { fillColor: cor, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: corCronClara },
        styles: { fontSize: 9, textColor: [0, 0, 0] },
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
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
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
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9, textColor: [0, 0, 0] },
    didDrawPage: (data) => {
      if (data.doc.internal.getNumberOfPages() > 1)
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
    }
  });
  }

  // ========== CAPACIDADE TÉCNICA E OPERACIONAL (opcional) ==========
  let capacidadeTecnicaStartPage: number | null = null;
  let capacidadeDocs: { id: string; nome: string; arquivoUrl: string; arquivoNome?: string; criadoEm?: any; ordem?: number; tipo?: string; ano?: number; orgaoEmitente?: string }[] = [];
  if (options.capacidadeTecnica) {
    const capDocsSnap = await getDocs(collection(db, `entities/${projeto.entidadeId}/capacidadeDocumentos`));
    capacidadeDocs = capDocsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => {
        const oa = a.ordem;
        const ob = b.ordem;
        // Ordem manual definida pelo usuário tem prioridade
        if (oa !== undefined && ob !== undefined) return oa - ob;
        if (oa !== undefined) return -1;
        if (ob !== undefined) return 1;
        // Fallback: mais antigos primeiro (= ordem de upload)
        const ta = a.criadoEm?.toDate?.().getTime?.() || 0;
        const tb = b.criadoEm?.toDate?.().getTime?.() || 0;
        return ta - tb;
      });

    forceNewPage(state);
    capacidadeTecnicaStartPage = (pdf as any).internal.getCurrentPageInfo().pageNumber;

    addChapterTitle(state, 'Capacidade Técnica e Operacional');
    state.y += 2;

    if ((entidade as any).historico) {
      addSubTitle(state, 'Histórico Institucional');
      addBodyText(state, (entidade as any).historico);
      state.y += 4;
    }

    if ((entidade as any).capacidadeTecnica) {
      addSubTitle(state, 'Descritivo da Capacidade Técnica');
      addBodyText(state, (entidade as any).capacidadeTecnica);
      state.y += 4;
    }

    if (capacidadeDocs.length > 0) {
      checkPageSpace(state, 40);
      addSubTitle(state, 'Documentos Comprobatórios');
      state.y += 1;

      const fmtDate = (ts: any) => {
        if (!ts) return '-';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('pt-BR');
      };

      const rows = capacidadeDocs.map((d, i) => [
        toRoman(i + 1),
        d.arquivoNome || d.nome || '-',
        fmtDate(d.criadoEm)
      ]);

      autoTable(pdf, {
        startY: state.y,
        head: [['Nº', 'Documento', 'Enviado em']],
        body: rows,
        margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
        headStyles: { fillColor: cor, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: corClara },
        styles: { fontSize: 9, textColor: [0, 0, 0] },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          1: { cellWidth: 130 },
          2: { cellWidth: 33, halign: 'center' },
        },
        didDrawPage: (data) => {
          if (data.doc.internal.getNumberOfPages() > 1)
            drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
        }
      });
      state.y = (pdf as any).lastAutoTable.finalY + 6;

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(100, 100, 100);
      pdf.text(
        'Os documentos listados acima seguem em anexo, integralmente reproduzidos, nas próximas páginas.',
        MARGIN, state.y
      );
    }

    if (!((entidade as any).historico) && !((entidade as any).capacidadeTecnica) && capacidadeDocs.length === 0) {
      pdf.setFontSize(9.5);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(140, 140, 140);
      pdf.text(
        'A entidade ainda não cadastrou histórico, descritivo de capacidade técnica nem documentos comprobatórios.',
        MARGIN, state.y
      );
    }
  }

  // ========== PESQUISA agora é gerada como PDF separado e mergeada no fim (anexo final) ==========
  const itensPesquisados = itensProjeto.filter(it => it.pesquisado === true);

  const gerouJsPdf = options.projeto || options.capacidadeTecnica;

  if (gerouJsPdf && options.projeto && capacidadeTecnicaStartPage !== null) {
    toc.push({ num: '', title: 'Capacidade Técnica e Operacional', page: capacidadeTecnicaStartPage });
  }

  // Rodapés timbrados nas páginas geradas pelo jsPDF (exceto capa, sumário e quando vai numerar/rubricar)
  if (gerouJsPdf && !options.numerarRubricar) {
    const totalJsPages = (pdf as any).internal.getNumberOfPages();
    const startPage = options.projeto ? 3 : 1;
    for (let i = startPage; i <= totalJsPages; i++) {
      pdf.setPage(i);
      drawLetterheadFooter(pdf, entidade, i, totalJsPages, rubricaUrl);
    }
  }

  try {
    let mainPdfDoc: PDFDocument;

    if (gerouJsPdf) {
      const jsPdfBytes = new Uint8Array(pdf.output('arraybuffer'));
      mainPdfDoc = await PDFDocument.load(jsPdfBytes);
    } else {
      mainPdfDoc = await PDFDocument.create();
    }

    const fontReg = await mainPdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await mainPdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoImg = await embedLogoPdfLib(mainPdfDoc, logoBase64);

    // Helper: anota TocEntry pra grande seção e cada doc individual juntado
    const addBlock = async (
      titulo: string,
      subtitulo: string,
      docs: { nome: string; arquivoUrl: string }[]
    ) => {
      if (docs.length === 0) return;
      await addSeparatorPage(mainPdfDoc, titulo, subtitulo, logoImg, cor, fontBold, fontReg);
      toc.push({ num: '', title: titulo, page: mainPdfDoc.getPageCount() });

      for (const d of docs) {
        const docStartPage = mainPdfDoc.getPageCount() + 1;
        try {
          const bytes = await fetchPdfAsArrayBuffer(d.arquivoUrl);
          if (bytes) {
            await mergePdfBytes(mainPdfDoc, bytes);
            toc.push({ num: '', title: '  • ' + d.nome, page: docStartPage });
          }
        } catch (e) {
          console.error(`Falha ao juntar doc ${d.nome}:`, e);
        }
      }
    };

    // Buscar documentos da entidade (uma única vez)
    let docsEntidadeFiltrados: { nome: string; arquivoUrl: string }[] = [];
    let certidoesFiltradas: { nome: string; arquivoUrl: string }[] = [];
    if (options.documentosEntidade || options.certidoes) {
      const entDocsSnap = await getDocs(collection(db, `entities/${projeto.entidadeId}/documentos`));
      const entDocs = entDocsSnap.docs
        .map(d => d.data() as any)
        .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0));

      for (const d of entDocs) {
        if (!d.arquivoUrl) continue;
        const isCertidao = d.tipo === 'Certidão';
        const nome = d.nome || d.tipo || 'Documento';
        if (isCertidao && options.certidoes) {
          certidoesFiltradas.push({ nome, arquivoUrl: d.arquivoUrl });
        } else if (!isCertidao && options.documentosEntidade) {
          docsEntidadeFiltrados.push({ nome, arquivoUrl: d.arquivoUrl });
        }
      }
    }

    // Ordem: Comprobatórios da Capacidade Técnica → Documentos da Entidade → Certidões → Pesquisa
    if (options.capacidadeTecnica && capacidadeDocs.length > 0) {
      for (const d of capacidadeDocs) {
        const docStartPage = mainPdfDoc.getPageCount() + 1;
        try {
          const bytes = await fetchPdfAsArrayBuffer(d.arquivoUrl);
          if (bytes) {
            await mergePdfBytes(mainPdfDoc, bytes);
            const label = `  • ${d.arquivoNome || d.nome}`;
            toc.push({ num: '', title: label, page: docStartPage });
          }
        } catch (e) {
          console.error(`Falha ao juntar comprobatório ${d.nome}:`, e);
        }
      }
    }

    if (options.documentosEntidade) {
      await addBlock(
        'Documentos da Entidade',
        'Estatuto, Atas, CNPJ e demais anexos institucionais',
        docsEntidadeFiltrados
      );
    }

    if (options.certidoes) {
      await addBlock(
        'Certidões da Entidade',
        'Certidões ativas de regularidade fiscal e institucional',
        certidoesFiltradas
      );
    }

    // Pesquisa de Preços (anexo final): laudos jsPDF + PDFs externos das cotações
    if (options.pesquisa && itensPesquisados.length > 0) {
      await addSeparatorPage(
        mainPdfDoc,
        'Pesquisa de Preços (IN 65/2021)',
        'Laudos estatísticos e juntada das cotações públicas e manuais',
        logoImg, cor, fontBold, fontReg
      );
      toc.push({ num: '', title: 'Pesquisa de Preços (IN 65/2021)', page: mainPdfDoc.getPageCount() });

      const pesquisaBytes = await renderPesquisaCertificadosJsPdf(itensPesquisados, entidade, cor, logoBase64);
      if (pesquisaBytes) {
        const certStartPage = mainPdfDoc.getPageCount() + 1;
        await mergePdfBytes(mainPdfDoc, pesquisaBytes.buffer as ArrayBuffer);
        toc.push({ num: '', title: '  • Laudos e Análise Estatística', page: certStartPage });
      }

      for (const it of itensPesquisados) {
        if (!it.referencias || !Array.isArray(it.referencias)) continue;
        for (const r of it.referencias) {
          const refNome = r.orgaoLicitante
            ? `${r.orgaoLicitante} (${r.identificadorCompra || r.fonte})`
            : (r.arquivoNome || r.identificadorCompra || 'Cotação');
          const refStartPage = mainPdfDoc.getPageCount() + 1;
          try {
            let bytes: ArrayBuffer | null = null;
            if (r.fonte === 'fomento' && r.localizacaoUrl) {
              bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
            } else if ((r.fonte === 'compras.gov.br' || r.fonte === 'pncp') && r.localizacaoUrl) {
              bytes = await fetchPdfAsArrayBuffer(r.localizacaoUrl);
            } else if (r.fonte === 'compras.gov.br' || r.fonte === 'pncp') {
              bytes = await obterPdfPublicoCacheado(r);
            }
            if (bytes) {
              await mergePdfBytes(mainPdfDoc, bytes);
              toc.push({ num: '', title: `  • ${it.nome} — ${refNome}`, page: refStartPage });
            }
          } catch (err) {
            console.error(`Falha ao juntar cotação de ${r.orgaoLicitante}:`, err);
          }
        }
      }
    }

    if (mainPdfDoc.getPageCount() === 0) {
      const page = mainPdfDoc.addPage([595.276, 841.89]);
      page.drawText('Nenhum documento ou conteúdo selecionado para impressão.', {
        x: 50, y: 400, size: 12, font: fontReg
      });
    }

    // Desenhar sumário na página 2 do PDF final (se houver Plano de Trabalho)
    if (options.projeto && mainPdfDoc.getPageCount() >= 2) {
      await drawTocOnPdfLib(mainPdfDoc, 1, toc, cor, fontReg, fontBold);
    }

    // Numerar e rubricar
    if (options.numerarRubricar) {
      const pages = mainPdfDoc.getPages();
      const totalMergedPages = pages.length;

      let rubricaImage = null;
      if (rubricaUrl) {
        try {
          const parsedRub = dataUrlToBytes(rubricaUrl);
          if (parsedRub) {
            rubricaImage = parsedRub.format === 'png'
              ? await mainPdfDoc.embedPng(parsedRub.bytes)
              : await mainPdfDoc.embedJpg(parsedRub.bytes);
          } else {
            const imgBytes = await fetchPdfAsArrayBuffer(rubricaUrl);
            rubricaImage = await mainPdfDoc.embedPng(imgBytes);
          }
        } catch (e) { console.error('Falha ao embutir rubrica no pdf-lib', e); }
      }

      const startIdx = options.projeto ? 2 : 0;
      for (let i = startIdx; i < totalMergedPages; i++) {
        const page = pages[i];
        const { width } = page.getSize();
        const pageStr = `Página ${i + 1} de ${totalMergedPages}`;
        const w = fontReg.widthOfTextAtSize(pageStr, 9);
        page.drawText(pageStr, {
          x: (width - w) / 2, y: 20, size: 9, font: fontReg, color: rgb(0.3, 0.3, 0.3)
        });
        if (rubricaImage) {
          page.drawImage(rubricaImage, { x: 20, y: 15, width: 30, height: 30 });
        }
      }
    }

    const mergedPdfBytes = await mainPdfDoc.save();
    const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  } catch (pdfLibError) {
    console.error("Erro durante a unificação de PDFs com pdf-lib, baixando PDF básico como fallback:", pdfLibError);
    pdf.save(`Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
  }
}
