import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { ref, getBlob } from 'firebase/storage';
import { db, storage } from './firebase';
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

const LINE_H = 5.2;
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
  projetoTitulo?: string;
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

function softenColor(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  if (r > 120 && r > g * 1.3 && r > b * 1.3) {
    return [141, 23, 44]; // Vinho corporativo elegante (#8D172C)
  }
  return rgb;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [141, 23, 44];
  
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

/** Baixa imagem como dataURL. Pra URLs do Firebase Storage usa getBlob
 *  nativo (depende do CORS configurado em cors.json). Pra URLs externas,
 *  fetch direto. Sem gambiarra de proxy — se CORS não estiver no bucket,
 *  nenhum proxy resolve mesmo (testado: corsproxy.io/AllOrigins falham). */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  const toDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  // Firebase Storage → SDK nativo (precisa CORS configurado no bucket).
  if (url.includes('firebasestorage.googleapis.com')) {
    const match = url.match(/\/o\/([^?]+)/);
    const path = match ? decodeURIComponent(match[1]) : null;
    if (path) {
      try {
        const blob = await getBlob(ref(storage, path));
        return await toDataUrl(blob);
      } catch (e) {
        console.error(`Falha ao baixar imagem do Storage (${path}). CORS configurado? Veja cors.json:`, e);
        return null;
      }
    }
  }

  // URL externa.
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await toDataUrl(await resp.blob());
  } catch (e) {
    console.error('Falha ao baixar imagem externa:', url, e);
    return null;
  }
}

function getImgFormat(url: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (url.toLowerCase().includes('.png') || url.startsWith('data:image/png')) return 'PNG';
  if (url.toLowerCase().includes('.webp') || url.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
}

function drawLetterheadHeader(pdf: jsPDF, entidade: Entidade, logoBase64: string | null, cor: [number, number, number]) {
  // 1. Logotipo no topo esquerdo (X=20, Y=7, tamanho 16x16)
  if (logoBase64) {
    try {
      const format = getImgFormat(entidade.logoUrl || '');
      pdf.addImage(logoBase64, format, MARGIN, 7, 16, 16);
    } catch (e) {
      console.warn('Erro ao desenhar logo no cabeçalho:', e);
    }
  }

  // 2. Nome da entidade no centro
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(50, 50, 50);
  pdf.text(entidade.nome.toUpperCase(), PAGE_W / 2, 14, { align: 'center' });

  // 3. CNPJ abaixo do nome
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(110, 110, 110);
  pdf.text(`CNPJ: ${entidade.cnpj}`, PAGE_W / 2, 19, { align: 'center' });

  // 4. Linha decorativa fina em Y=26 na cor suavizada
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
  // 1. Linha divisória fina em Y=280
  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, 280, PAGE_W - MARGIN, 280);

  // 2. Endereço completo formatado
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

  // 3. Contatos
  const telefonesStr = (entidade.telefones || []).join(' / ') || 'Não informado';
  const contactsText = `Telefone: ${telefonesStr}  |  E-mail: ${entidade.email || 'Não informado'}`;
  pdf.text(contactsText, PAGE_W / 2, 288, { align: 'center' });

  // 4. Paginação
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(130, 130, 130);
  pdf.text(`Página ${pageNum} de ${total}`, PAGE_W / 2, 292, { align: 'center' });

  // 5. Rubrica no canto esquerdo
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

function addSubSectionTitle(state: PDFState, title: string) {
  checkPageSpace(state, 12);
  
  const { pdf } = state;
  const y = state.y;
  
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text(title, MARGIN, y);
  
  const lineY = y + 2;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(MARGIN, lineY, MARGIN + CONTENT_W, lineY);
  
  state.y = lineY + 3.5;
}

function addField(state: PDFState, label: string, value: string, x: number, maxW = CONTENT_W) {
  const { pdf } = state;
  
  const labelWidth = 28;
  const valMaxW = maxW - labelWidth;
  const lines = pdf.splitTextToSize(value || '-', valMaxW);
  const neededHeight = lines.length * LINE_H;
  
  checkPageSpace(state, neededHeight + 4);
  
  const y = state.y;
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text(label + ':', x, y);
  
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  pdf.text(lines, x + labelWidth, y);
  
  state.y = y + neededHeight;
}

function addJustifiedText(state: PDFState, text: string) {
  if (!text) return;
  const { pdf } = state;
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  
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
      
      const isLastLine = (i === lines.length - 1);
      if (isLastLine) {
        pdf.text(lines[i], MARGIN, state.y);
      } else {
        pdf.text(lines[i], MARGIN, state.y, { align: 'justify', maxWidth: CONTENT_W });
      }
      
      state.y += lineSpacing;
    }
    
    if (p < paragraphs.length - 1 && paraText.trim() !== '') {
      state.y += 1.5;
    }
  }
}

export async function consolidarEntidade(entidadeId: string, rubricaUrl?: string): Promise<void> {
  const entSnap = await getDoc(doc(db, 'entities', entidadeId));
  if (!entSnap.exists()) throw new Error('Entidade não encontrada');
  const entidade = { id: entSnap.id, ...entSnap.data() } as Entidade;

  const cor = hexToRgb((entidade as any).corPredominante || '#16A34A');
  const corClara = lightenRgb(cor, 0.88);

  const docsEntSnap = await getDocs(collection(db, `entities/${entidadeId}/documentos`));
  const docsEntidade: DocItem[] = docsEntSnap.docs
    .map(d => (d.data() as DocItem))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

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

  const allDocs: { nome: string; url?: string }[] = [];
  docsEntidade.forEach(d => allDocs.push({ nome: d.nome || d.tipo || 'Documento', url: d.arquivoUrl }));
  dirigentes.forEach(d => {
    (d.documentos || []).forEach(dd => {
      allDocs.push({ nome: dd.nome || dd.tipo || 'Documento', url: dd.arquivoUrl });
    });
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // Pre-carregar logotipo em Base64
  const logoUsar = entidade.logoUrl;
  let logoBase64: string | null = null;
  if (logoUsar) {
    try {
      logoBase64 = await fetchImageAsBase64(logoUsar);
    } catch (e) {
      console.warn('Erro ao buscar logo da entidade:', e);
    }
  }

  // ========== CAPA DE ALTÍSSIMA ELEGÂNCIA (CORPORATIVA OFF-WHITE) ==========
  pdf.setFillColor(248, 250, 252);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Faixa vertical da marca
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, 15, PAGE_H, 'F');

  if (logoUsar) {
    try {
      const imgData = await fetchImageAsBase64(logoUsar);
      if (imgData) {
        pdf.addImage(imgData, getImgFormat(logoUsar), 50, 50, 45, 45);
      }
    } catch { }
  }

  // Linha horizontal decorativa
  pdf.setDrawColor(...cor);
  pdf.setLineWidth(0.6);
  pdf.line(50, 110, 170, 110);

  // Textos da Capa
  pdf.setTextColor(100, 100, 100);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('DOSSIÊ INSTITUCIONAL', 50, 120);

  pdf.setTextColor(...cor);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  const nomeLines = pdf.splitTextToSize(entidade.nome || '', 120);
  pdf.text(nomeLines, 50, 132);

  if (entidade.sigla) {
    pdf.setTextColor(60, 60, 60);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text('SIGLA:', 50, 170);
    pdf.setFont('helvetica', 'normal');
    pdf.text(entidade.sigla, 50, 178);
  }

  pdf.setTextColor(140, 140, 140);
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${entidade.cidade || 'São Paulo'} / ${entidade.uf || 'SP'}, 2026`, 50, 255);

  // Inicializar o estado do PDF para o miolo (inicia na página 2)
  const state: PDFState = {
    pdf,
    y: 33,
    cor,
    entidade,
    logoBase64
  };

  // ===== DADOS DA ENTIDADE =====
  forceNewPage(state);
  addSectionTitle(state, '1. Dados da Entidade');
  state.y += 2;
  addField(state, 'Razão Social', entidade.nome || '', MARGIN); state.y += 1.5;
  addField(state, 'Sigla', entidade.sigla || '-', MARGIN); state.y += 1.5;
  addField(state, 'CNPJ', entidade.cnpj || '-', MARGIN); state.y += 4;

  addSubSectionTitle(state, 'ENDEREÇO');
  const endParts = [entidade.logradouro, entidade.numero, entidade.complemento, entidade.bairro, entidade.cidade, entidade.uf, entidade.cep].filter(Boolean).join(', ');
  addField(state, 'Endereço', endParts || '-', MARGIN); state.y += 4;

  addSubSectionTitle(state, 'CONTATO E REDES SOCIAIS');
  addField(state, 'E-mail', entidade.email || '-', MARGIN); state.y += 1.5;
  addField(state, 'Telefone(s)', (entidade.telefones || []).join(' / ') || '-', MARGIN); state.y += 1.5;
  if ((entidade as any).site) { addField(state, 'Site', (entidade as any).site, MARGIN); state.y += 1.5; }
  if ((entidade as any).instagram) { addField(state, 'Instagram', (entidade as any).instagram, MARGIN); state.y += 1.5; }
  if ((entidade as any).facebook) { addField(state, 'Facebook', (entidade as any).facebook, MARGIN); state.y += 1.5; }
  if ((entidade as any).linkedin) { addField(state, 'LinkedIn', (entidade as any).linkedin, MARGIN); state.y += 1.5; }
  if ((entidade as any).youtube) { addField(state, 'YouTube', (entidade as any).youtube, MARGIN); state.y += 1.5; }
  if ((entidade as any).tiktok) { addField(state, 'TikTok', (entidade as any).tiktok, MARGIN); state.y += 1.5; }
  state.y += 4;

  // Responsável Legal na mesma página
  const resp = (entidade as any).responsavelLegal;
  if (resp && resp.nome) {
    checkPageSpace(state, 60);
    addSubSectionTitle(state, 'RESPONSÁVEL LEGAL');
    addField(state, 'Nome', resp.nome || '-', MARGIN); state.y += 1.5;
    addField(state, 'Cargo', resp.cargo || '-', MARGIN); state.y += 1.5;
    addField(state, 'CPF', resp.cpf || '-', MARGIN); state.y += 1.5;
    addField(state, 'E-mail', resp.email || '-', MARGIN); state.y += 1.5;
    addField(state, 'Telefone', resp.telefone || '-', MARGIN);
  }

  // ===== DIRIGENTES =====
  forceNewPage(state);
  addSectionTitle(state, '2. Relação de Dirigentes');
  state.y += 2;
  for (const dir of dirigentes) {
    checkPageSpace(state, 60);
    
    pdf.setFillColor(...corClara);
    pdf.rect(MARGIN, state.y, CONTENT_W, 7, 'F');
    pdf.setFontSize(9.5); 
    pdf.setFont('helvetica', 'bold'); 
    pdf.setTextColor(...cor);
    pdf.text(dir.nome?.toUpperCase() || '', MARGIN + 2, state.y + 5);
    state.y += 7;

    const dirRows = [
      ['CARGO', dir.cargo || '-', 'CPF', dir.cpf || '-'],
      ['E-MAIL', dir.email || '-', 'TELEFONE', dir.telefone || '-'],
      ['ESCOLARIDADE', dir.escolaridade || '-', '', ''],
      ['ENDEREÇO', [dir.logradouro, dir.numero, dir.complemento, dir.bairro, dir.cidade, dir.uf].filter(Boolean).join(', ') || '-', '', '']
    ];

    autoTable(pdf, {
      startY: state.y,
      body: dirRows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: [100, 100, 100], cellWidth: 30 },
        2: { fontStyle: 'bold', textColor: [100, 100, 100], cellWidth: 20 },
      },
      margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
      didDrawPage: (data) => {
        const pageCount = data.doc.internal.getNumberOfPages();
        if (pageCount > 1) {
          drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
        }
      }
    });
    
    state.y = (pdf as any).lastAutoTable.finalY + 10;
  }

  // ===== HISTÓRICO =====
  forceNewPage(state);
  addSectionTitle(state, '3. Histórico');
  state.y += 2;
  if (entidade.historico) {
    addJustifiedText(state, entidade.historico);
    state.y += 8;
  }

  // ===== CAPACIDADE TÉCNICA =====
  checkPageSpace(state, 40);
  addSectionTitle(state, '4. Capacidade Técnica e Operacional');
  state.y += 2;
  if (entidade.capacidadeTecnica) {
    addJustifiedText(state, entidade.capacidadeTecnica);
  }

  // ===== TABELA DE ANEXOS =====
  forceNewPage(state);
  addSectionTitle(state, '5. Anexos');
  state.y += 2;
  const anexoRows = allDocs.map((d, i) => [toRoman(i + 1), d.nome]);
  autoTable(pdf, {
    startY: state.y,
    head: [['Nº', 'Documento']],
    body: anexoRows.length > 0 ? anexoRows : [['—', 'Nenhum documento anexado']],
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 8.5 },
    didDrawPage: (data) => {
      const pageCount = data.doc.internal.getNumberOfPages();
      if (pageCount > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    }
  });

  const totalPages = (pdf as any).internal.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    pdf.setPage(p);
    drawLetterheadFooter(pdf, entidade, p, totalPages, rubricaUrl);
  }

  pdf.save(`Dossie_${(entidade.sigla || entidade.nome || 'Entidade').replace(/\s/g, '_')}.pdf`);
}
