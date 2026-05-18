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
const LINE_H = 6;

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

function addFooter(pdf: jsPDF, pageNum: number, total: number) {
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Página ${pageNum} de ${total}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
}

function addChapterTitle(pdf: jsPDF, title: string, y: number, cor: [number, number, number]): number {
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
  return y + 14;
}

function addSubTitle(pdf: jsPDF, title: string, y: number): number {
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text(title, MARGIN, y);
  return y + LINE_H + 1;
}

function addBodyText(pdf: jsPDF, text: string, y: number, checkPage: () => void): number {
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(20, 20, 20);
  const lines = pdf.splitTextToSize(text || '-', CONTENT_W);
  for (const line of lines) {
    checkPage();
    pdf.text(line, MARGIN, y, { align: 'justify', maxWidth: CONTENT_W });
    y += LINE_H + 1;
  }
  return y + 3;
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

function addSubSection(pdf: jsPDF, title: string, y: number): number {
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text(title, MARGIN, y);
  y += 3;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  return y + 5;
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

  // ========== CAPA ==========
  pdf.setFillColor(...cor);
  pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  const corEscura = cor.map(c => Math.max(0, c - 40)) as [number, number, number];
  pdf.setFillColor(...corEscura);
  pdf.rect(0, PAGE_H - 30, PAGE_W, 30, 'F');

  const faixaY = PAGE_H / 2 - 40;
  const faixaH = 80;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, faixaY, PAGE_W, faixaH, 'F');

  // Logo: projeto ou entidade
  const logoUsar = projeto.logoUrl || (entidade as any).logoUrl;
  if (logoUsar) {
    try {
      const imgData = await fetchImageAsBase64(logoUsar);
      if (imgData) pdf.addImage(imgData, getImgFormat(logoUsar), PAGE_W / 2 - 30, faixaY + 10, 60, 60);
    } catch {}
  }

  // Título no topo da capa (branco)
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  const projTitleLines = pdf.splitTextToSize(projeto.titulo?.toUpperCase() || '', CONTENT_W);
  pdf.text(projTitleLines, PAGE_W / 2, 25, { align: 'center' });

  // Nome da entidade e "PLANO DE TRABALHO" no rodapé da capa
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'normal');
  const entNameLines = pdf.splitTextToSize(entidade.nome || '', CONTENT_W);
  pdf.text(entNameLines, PAGE_W / 2, faixaY + faixaH + 15, { align: 'center' });
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PLANO DE TRABALHO', PAGE_W / 2, PAGE_H - 15, { align: 'center' });

  // Helpers de paginação
  const newPage = (header: string) => {
    pdf.addPage();
    addHeader(pdf, header, cor);
    return 26;
  };

  const makeChkPage = (neededSpace = 40) => () => {
    if (y > PAGE_H - neededSpace) {
      y = newPage(projeto.titulo);
    }
  };

  let y = 26;

  // ========== CAP 1: IDENTIFICAÇÃO DO PROJETO ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '1. Identificação do Projeto', y, cor);
  y = addField(pdf, 'Título', projeto.titulo, MARGIN, y); y += 2;
  y = addField(pdf, 'Instrumento', projeto.instrumentoOrigem, MARGIN, y); y += 2;
  y = addField(pdf, 'Órgão', projeto.orgao === 'outro' ? projeto.orgaoOutro || '' : projeto.orgao, MARGIN, y); y += 2;
  y = addField(pdf, 'Status', (projeto as any).status?.replace(/_/g, ' ') || '-', MARGIN, y);

  // ========== CAP 2: DADOS DA ENTIDADE ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '2. Dados da Entidade', y, cor);

  y = addSubSection(pdf, 'IDENTIFICAÇÃO', y);
  y = addField(pdf, 'Razão Social', entidade.nome, MARGIN, y); y += 2;
  y = addField(pdf, 'Sigla', entidade.sigla || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'CNPJ', entidade.cnpj, MARGIN, y); y += 6;

  y = addSubSection(pdf, 'ENDEREÇO', y);
  const endParts = [entidade.logradouro, entidade.numero, entidade.complemento, entidade.bairro, entidade.cidade, entidade.uf, entidade.cep].filter(Boolean).join(', ');
  y = addField(pdf, 'Endereço', endParts || '-', MARGIN, y); y += 6;

  y = addSubSection(pdf, 'CONTATO E REDES', y);
  y = addField(pdf, 'E-mail', entidade.email || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Telefone(s)', (entidade.telefones || []).join(' / ') || '-', MARGIN, y); y += 2;
  if ((entidade as any).site) { y = addField(pdf, 'Site', (entidade as any).site, MARGIN, y); y += 2; }
  if ((entidade as any).instagram) { y = addField(pdf, 'Instagram', (entidade as any).instagram, MARGIN, y); y += 2; }
  if ((entidade as any).facebook) { y = addField(pdf, 'Facebook', (entidade as any).facebook, MARGIN, y); y += 2; }
  if ((entidade as any).linkedin) { y = addField(pdf, 'LinkedIn', (entidade as any).linkedin, MARGIN, y); y += 2; }
  if ((entidade as any).youtube) { y = addField(pdf, 'YouTube', (entidade as any).youtube, MARGIN, y); y += 2; }
  if ((entidade as any).tiktok) { y = addField(pdf, 'TikTok', (entidade as any).tiktok, MARGIN, y); y += 6; }

  // Responsável legal
  const resp = (entidade as any).responsavelLegal;
  if (resp && resp.nome) {
    if (y > PAGE_H - 60) { y = newPage(projeto.titulo); }
    y = addSubSection(pdf, 'RESPONSÁVEL LEGAL', y);
    y = addField(pdf, 'Nome', resp.nome || '-', MARGIN, y); y += 2;
    y = addField(pdf, 'Cargo', resp.cargo || '-', MARGIN, y); y += 2;
    y = addField(pdf, 'CPF', resp.cpf || '-', MARGIN, y); y += 2;
    y = addField(pdf, 'E-mail', resp.email || '-', MARGIN, y); y += 2;
    y = addField(pdf, 'Telefone', resp.telefone || '-', MARGIN, y);
  }

  // ========== CAP 3: PLANO DE TRABALHO ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '3. Plano de Trabalho', y, cor);

  const chkPage = makeChkPage(40);

  // Resumo
  if (projeto.resumo) {
    y = addSubTitle(pdf, 'Resumo', y);
    y = addBodyText(pdf, projeto.resumo, y, chkPage);
  }

  // Plano de Divulgação
  if ((projeto as any).planoDivulgacao) {
    chkPage();
    y = addSubTitle(pdf, 'Plano de Divulgação', y);
    y = addBodyText(pdf, (projeto as any).planoDivulgacao, y, chkPage);
  }

  // Período
  chkPage();
  y = addSubTitle(pdf, 'Período de Execução', y);
  const periodoStr = `${formatMesAno(projeto.mesInicio)} até ${formatMesAno(projeto.mesTermino)} (${projeto.duracaoMeses || 0} meses)`;
  y = addBodyText(pdf, periodoStr, y, chkPage);

  // Âmbito
  chkPage();
  y = addSubTitle(pdf, 'Âmbito de Aplicação', y);
  y = addBodyText(pdf, projeto.ambitoAplicacao || '-', y, chkPage);

  // Locais
  if (projeto.locais && projeto.locais.length > 0) {
    chkPage();
    y = addSubTitle(pdf, 'Locais de Aplicação', y);
    const locaisStr = projeto.locais.map(l => `${l.uf}: ${l.municipios.filter(Boolean).join(', ')}`).join(' | ');
    y = addBodyText(pdf, locaisStr, y, chkPage);
  }

  // Modalidades
  if (projeto.modalidades && projeto.modalidades.length > 0) {
    chkPage();
    y = addSubTitle(pdf, 'Modalidades Esportivas', y);
    const modStr = projeto.modalidades
      .map((m: any) => {
        const nome = typeof m === 'string' ? m : m.nome;
        const flag = typeof m === 'object' && m.paralimpica ? ' (Paralímpica)' : '';
        return nome + flag;
      })
      .join(', ');
    y = addBodyText(pdf, modStr, y, chkPage);
  }

  // Objetivo Geral
  chkPage();
  y = addSubTitle(pdf, 'Objetivo Geral', y);
  y = addBodyText(pdf, projeto.objetivoGeral || '-', y, chkPage);

  // Objetivos Específicos
  if (projeto.objetivosEspecificos && projeto.objetivosEspecificos.length > 0) {
    chkPage();
    y = addSubTitle(pdf, 'Objetivos Específicos', y);
    const objTexto = projeto.objetivosEspecificos
      .filter(o => o.trim())
      .map((o, i) => `${i + 1}. ${o}`)
      .join('\n');
    y = addBodyText(pdf, objTexto, y, chkPage);
  }

  // Justificativa
  if (projeto.justificativa) {
    chkPage();
    y = addSubTitle(pdf, 'Justificativa', y);
    y = addBodyText(pdf, projeto.justificativa, y, chkPage);
  }

  // Caracterização
  if (projeto.caracterizacaoSocioeconomica) {
    chkPage();
    y = addSubTitle(pdf, 'Caracterização Socioeconômica', y);
    y = addBodyText(pdf, projeto.caracterizacaoSocioeconomica, y, chkPage);
  }

  // Metodologia
  if (projeto.metodologia) {
    chkPage();
    y = addSubTitle(pdf, 'Metodologia de Aplicação', y);
    y = addBodyText(pdf, projeto.metodologia, y, chkPage);
  }

  // ========== CAP 4: PÚBLICO ALVO ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '4. Público Alvo', y, cor);

  if (projeto.publicoAlvo) {
    y = addSubTitle(pdf, 'Público Direto', y);
    y = addBodyText(pdf, projeto.publicoAlvo.direto || '-', y, makeChkPage());
    y = addSubTitle(pdf, 'Público Indireto', y);
    y = addBodyText(pdf, projeto.publicoAlvo.indireto || '-', y, makeChkPage());
    y = addSubTitle(pdf, 'Faixa Etária', y);
    y = addBodyText(pdf, projeto.publicoAlvo.faixaEtaria || '-', y, makeChkPage());
  }

  // ========== CAP 5: CRONOGRAMA DE EXECUÇÃO ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '5. Cronograma de Execução', y, cor);

  const cronBody = projeto.cronograma?.map(a => [
    a.acao || '-',
    a.descricao || '-',
    formatMesAno(a.mesInicio),
    formatMesAno(a.mesTermino)
  ]) || [['-', '-', '-', '-']];

  autoTable(pdf, {
    startY: y,
    head: [['Ação', 'Descrição', 'Início', 'Término']],
    body: cronBody,
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 80 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
    }
  });

  // ========== CAP 6: METAS DO PROJETO ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '6. Metas do Projeto', y, cor);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Metas Qualitativas', MARGIN, y);
  y += 6;

  autoTable(pdf, {
    startY: y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQualitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [['-','-','-','-']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9 },
  });

  y = (pdf as any).lastAutoTable.finalY + 10;
  if (y > PAGE_H - 60) { y = newPage(projeto.titulo); }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Metas Quantitativas', MARGIN, y);
  y += 6;

  autoTable(pdf, {
    startY: y,
    head: [['Meta', 'Indicador', 'Fórmula', 'Verificação']],
    body: projeto.metasQuantitativas?.map(m => [m.meta, m.indicador, m.formula, m.verificacao]) || [['-','-','-','-']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor },
    alternateRowStyles: { fillColor: corClara },
    styles: { fontSize: 9 },
  });

  // ========== CAP 7: ANEXOS ==========
  y = newPage(projeto.titulo);
  y = addChapterTitle(pdf, '7. Anexos', y, cor);

  const anexoRows = documentos.map((d, i) => [toRoman(i + 1), (d as any).nome || (d as any).tipo || 'Documento']);
  autoTable(pdf, {
    startY: y,
    head: [['Nº', 'Documento']],
    body: anexoRows.length > 0 ? anexoRows : [['—', 'Nenhum documento anexado']],
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: cor, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: corClara },
  });

  // Rodapés e Rubrica
  const total = (pdf as any).internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    if (i > 1) {
      addFooter(pdf, i, total);
      if (rubricaUrl) {
        try {
          pdf.addImage(rubricaUrl, getImgFormat(rubricaUrl), 10, PAGE_H - 15, 10, 10);
        } catch {}
      }
    }
  }

  pdf.save(`Projeto_${projeto.titulo.replace(/\s/g, '_')}.pdf`);
}
