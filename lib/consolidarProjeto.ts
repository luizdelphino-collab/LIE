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
const LINE_H = 5.2; // Altura de linha compacta e elegante

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
  // Se for um vermelho, laranja ou coral agressivo (R alto, G e B moderados ou baixos)
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
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [141, 23, 44]; // Fallback para vinho elegante
  
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

  // 1. Tentar via Storage SDK (getBlob)
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

  // 2. Tentar Fetch direto
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
    console.warn('Fetch direto bloqueado por CORS, tentando Proxy 1 (Weserv):', e);
  }

  // 3. Tentar via Proxy Weserv
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
    console.warn('Proxy Weserv falhou, tentando Proxy 2 (AllOrigins):', e);
  }

  // 4. Tentar via Proxy AllOrigins
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

function addChapterTitle(state: PDFState, title: string) {
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

function addSubTitle(state: PDFState, title: string) {
  checkPageSpace(state, 12);
  
  const { pdf } = state;
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text(title, MARGIN, state.y);
  state.y += LINE_H + 1;
}

function addBodyText(state: PDFState, text: string) {
  if (!text) return;
  const { pdf } = state;
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  
  const paragraphs = text.split('\n');
  const lineSpacing = LINE_H + 1.2; // 6.4mm
  
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
        // Última linha do parágrafo: estritamente alinhada à esquerda
        pdf.text(lines[i], MARGIN, state.y);
      } else {
        // Linhas intermediárias do parágrafo: justificadas
        pdf.text(lines[i], MARGIN, state.y, { align: 'justify', maxWidth: CONTENT_W });
      }
      
      state.y += lineSpacing;
    }
    
    // Pequeno espaçamento adicional entre parágrafos
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
  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text(label + ':', x, y);
  
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  pdf.text(lines, x + labelWidth, y);
  
  state.y = y + neededHeight;
}

function addSubSection(state: PDFState, title: string) {
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

function formatMesAno(ym?: string): string {
  if (!ym) return '-';
  const [year, month] = ym.split('-');
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const mName = months[parseInt(month, 10) - 1] || month;
  return `${mName}/${year}`;
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

  // Pre-carregar logotipo em Base64 com suporte a desvio de CORS
  const logoUsar = entidade.logoUrl;
  let logoBase64: string | null = null;
  if (logoUsar) {
    try {
      logoBase64 = await fetchImageAsBase64(logoUsar);
    } catch (e) {
      console.warn('Erro ao carregar logo da entidade:', e);
    }
  }

  // ========== CAPA DE ALTÍSSIMA ELEGÂNCIA (CORPORATIVA OFF-WHITE) ==========
  pdf.setFillColor(248, 250, 252); // Fundo off-white luxuoso
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Faixa vertical da marca à esquerda (15mm de largura na cor vinho suavizada)
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, 15, PAGE_H, 'F');

  // Inserção da Logotipo na Capa (Sem fundo poluído)
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
  pdf.text('PLANO DE TRABALHO', 50, 120);

  pdf.setTextColor(...cor);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  const projTitleLines = pdf.splitTextToSize(projeto.titulo?.toUpperCase() || '', 120);
  pdf.text(projTitleLines, 50, 132);

  pdf.setTextColor(60, 60, 60);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PROPONENTE:', 50, 170);
  pdf.setFont('helvetica', 'normal');
  const entNameLines = pdf.splitTextToSize(entidade.nome || '', 120);
  pdf.text(entNameLines, 50, 178);

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
    logoBase64,
    projetoTitulo: projeto.titulo
  };

  // ========== CAP 1: IDENTIFICAÇÃO DO PROJETO ==========
  forceNewPage(state);
  addChapterTitle(state, '1. Identificação do Projeto');
  state.y += 2;
  addField(state, 'Título', projeto.titulo, MARGIN); state.y += 1.5;
  addField(state, 'Instrumento', projeto.instrumentoOrigem, MARGIN); state.y += 1.5;
  addField(state, 'Órgão', projeto.orgao === 'outro' ? projeto.orgaoOutro || '' : projeto.orgao, MARGIN); state.y += 1.5;
  addField(state, 'Status', (projeto as any).status?.replace(/_/g, ' ') || '-', MARGIN);

  // ========== CAP 2: DADOS DA ENTIDADE ==========
  forceNewPage(state);
  addChapterTitle(state, '2. Dados da Entidade');

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

  // Responsável legal
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
  addChapterTitle(state, '3. Plano de Trabalho');
  state.y += 2;

  // Caixa de Sumário Compacto dos Metadados (Resolução de Espaços Vazios)
  checkPageSpace(state, 55);
  pdf.setDrawColor(225, 229, 233);
  pdf.setFillColor(248, 250, 252);
  pdf.setLineWidth(0.3);
  pdf.rect(MARGIN, state.y, CONTENT_W, 35, 'DF');

  const boxY = state.y + 6;
  // Coluna 1
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(80, 80, 80);
  pdf.text('Período de Execução:', MARGIN + 4, boxY);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  const periodoStr = `${formatMesAno(projeto.mesInicio)} até ${formatMesAno(projeto.mesTermino)} (${projeto.duracaoMeses || 0} meses)`;
  pdf.text(periodoStr, MARGIN + 48, boxY);

  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text('Âmbito de Aplicação:', MARGIN + 4, boxY + 7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  pdf.text(projeto.ambitoAplicacao || '-', MARGIN + 48, boxY + 7.5);

  // Coluna 2
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text('Locais de Aplicação:', MARGIN + 4, boxY + 15);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  const locaisStr = projeto.locais?.map(l => `${l.uf}: ${l.municipios.filter(Boolean).join(', ')}`).join(' | ') || '-';
  pdf.text(pdf.splitTextToSize(locaisStr, CONTENT_W - 55), MARGIN + 48, boxY + 15);

  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text('Modalidades:', MARGIN + 4, boxY + 22.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(40, 40, 40);
  const modStr = projeto.modalidades?.map((m: any) => typeof m === 'string' ? m : m.nome).join(', ') || '-';
  pdf.text(pdf.splitTextToSize(modStr, CONTENT_W - 55), MARGIN + 48, boxY + 22.5);

  state.y += 42;

  // Resumo
  if (projeto.resumo) {
    addSubTitle(state, 'Resumo');
    addBodyText(state, projeto.resumo);
    state.y += 4;
  }

  // Plano de Divulgação
  if ((projeto as any).planoDivulgacao) {
    addSubTitle(state, 'Plano de Divulgação');
    addBodyText(state, (projeto as any).planoDivulgacao);
    state.y += 4;
  }

  // Objetivo Geral
  addSubTitle(state, 'Objetivo Geral');
  addBodyText(state, projeto.objetivoGeral || '-');
  state.y += 4;

  // Objetivos Específicos
  if (projeto.objetivosEspecificos && projeto.objetivosEspecificos.length > 0) {
    addSubTitle(state, 'Objetivos Específicos');
    const objTexto = projeto.objetivosEspecificos
      .filter(o => o.trim())
      .map((o, i) => `${i + 1}. ${o}`)
      .join('\n');
    addBodyText(state, objTexto);
    state.y += 4;
  }

  // Justificativa
  if (projeto.justificativa) {
    addSubTitle(state, 'Justificativa');
    addBodyText(state, projeto.justificativa);
    state.y += 4;
  }

  // Caracterização
  if (projeto.caracterizacaoSocioeconomica) {
    addSubTitle(state, 'Caracterização Socioeconômica');
    addBodyText(state, projeto.caracterizacaoSocioeconomica);
    state.y += 4;
  }

  // Metodologia
  if (projeto.metodologia) {
    addSubTitle(state, 'Metodologia de Aplicação');
    addBodyText(state, projeto.metodologia);
  }

  // ========== CAP 4: PÚBLICO ALVO ==========
  forceNewPage(state);
  addChapterTitle(state, '4. Público Alvo');
  state.y += 2;

  if (projeto.publicoAlvo) {
    addSubTitle(state, 'Público Direto');
    addBodyText(state, projeto.publicoAlvo.direto || '-');
    state.y += 4;
    addSubTitle(state, 'Público Indireto');
    addBodyText(state, projeto.publicoAlvo.indireto || '-');
    state.y += 4;
    addSubTitle(state, 'Faixa Etária');
    addBodyText(state, projeto.publicoAlvo.faixaEtaria || '-');
  }

  // ========== CAP 5: CRONOGRAMA DE EXECUÇÃO ==========
  forceNewPage(state);
  addChapterTitle(state, '5. Cronograma de Execução');
  state.y += 2;

  const cronBody = projeto.cronograma?.map(a => [
    a.acao || '-',
    a.descricao || '-',
    formatMesAno(a.mesInicio),
    formatMesAno(a.mesTermino)
  ]) || [['-', '-', '-', '-']];

  autoTable(pdf, {
    startY: state.y,
    head: [['Ação', 'Descrição', 'Início', 'Término']],
    body: cronBody,
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 80 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
    },
    didDrawPage: (data) => {
      const pageCount = data.doc.internal.getNumberOfPages();
      if (pageCount > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    }
  });

  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 6: METAS DO PROJETO ==========
  checkPageSpace(state, 40);
  addChapterTitle(state, '6. Metas do Projeto');
  state.y += 2;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Metas Qualitativas', MARGIN, state.y);
  state.y += 5;

  autoTable(pdf, {
    startY: state.y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQualitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [['-','-','-','-']],
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 8.5 },
    didDrawPage: (data) => {
      const pageCount = data.doc.internal.getNumberOfPages();
      if (pageCount > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    }
  });

  state.y = (pdf as any).lastAutoTable.finalY + 10;
  checkPageSpace(state, 45);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Metas Quantitativas', MARGIN, state.y);
  state.y += 5;

  autoTable(pdf, {
    startY: state.y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQuantitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [['-','-','-','-']],
    margin: { left: MARGIN, right: MARGIN, top: 35, bottom: 22 },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 8.5 },
    didDrawPage: (data) => {
      const pageCount = data.doc.internal.getNumberOfPages();
      if (pageCount > 1) {
        drawLetterheadHeader(data.doc, entidade, logoBase64, cor);
      }
    }
  });

  state.y = (pdf as any).lastAutoTable.finalY + 10;

  // ========== CAP 7: ANEXOS ==========
  forceNewPage(state);
  addChapterTitle(state, '7. Anexos');
  state.y += 2;

  const anexoRows = documentos.map((d, i) => [toRoman(i + 1), (d as any).nome || (d as any).tipo || 'Documento']);
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

  // Renderizar rodapés, paginação e rubricas nas páginas de miolo (página 2 em diante)
  const total = (pdf as any).internal.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    pdf.setPage(i);
    drawLetterheadFooter(pdf, entidade, i, total, rubricaUrl);
  }

  pdf.save(`Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
}
