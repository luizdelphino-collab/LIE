/**
 * lib/gerarPrestacaoPdf.ts
 *
 * Gera o PDF da Prestação de Contas a partir dos dados já carregados na tela:
 * identificação, demonstrativo físico-financeiro por Etapa › Item (previsto ×
 * realizado), relação de pagamentos/documentos, remanejamento, saldo a devolver
 * e o relatório de cumprimento do objeto (narrativa). Abre em nova aba p/ imprimir.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Projeto, ItemProjeto, EtapaProjeto, Fornecedor, Prestacao } from '../types';

interface Execucao { id: string; itemProjetoId: string; mes: number; quantidade: number; fornecedorId: string; notaFiscalUrl: string; certidoesUrl: string; pagamentoUrl: string; }

const FMT = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloMes(n: number, mesInicio?: string): string {
  if (!mesInicio) return `Mês ${n}`;
  const [ay, am] = mesInicio.split('-').map(Number);
  if (!ay || !am) return `Mês ${n}`;
  const idx = (am - 1) + (n - 1);
  return `${MESES_ABREV[idx % 12]}/${String(ay + Math.floor(idx / 12)).slice(2)}`;
}

interface Args {
  projeto: Projeto;
  prestacao: Prestacao;
  itens: ItemProjeto[];
  etapas: EtapaProjeto[];
  execucoes: Execucao[];
  fornecedores: Fornecedor[];
  previsto: Record<string, Record<number, number>>;
  entidadeNome?: string;
  totalOrcado: number;
  totalExecutado: number;
  saldoDevolver: number;
}

export function gerarPrestacaoPdf(a: Args) {
  const { projeto, prestacao, itens, etapas, execucoes, fornecedores, previsto, entidadeNome, totalOrcado, totalExecutado, saldoDevolver } = a;
  const pdf = new jsPDF();
  const W = pdf.internal.pageSize.getWidth();
  const M = 14;
  const COR: [number, number, number] = [22, 101, 52]; // lie-green
  let y = 16;

  const mesesPeriodo = (() => { const r: number[] = []; for (let m = prestacao.mesInicio; m <= prestacao.mesFim; m++) r.push(m); return r; })();
  const prevItem = (iid: string) => mesesPeriodo.reduce((s, m) => s + (previsto[iid]?.[m] || 0), 0);
  const realItem = (iid: string) => execucoes.filter(e => e.itemProjetoId === iid && e.mes >= prestacao.mesInicio && e.mes <= prestacao.mesFim).reduce((s, e) => s + (e.quantidade || 0), 0);
  const fornNome = (fid: string) => { const f = fornecedores.find(x => x.id === fid); return f ? (f.nomeFantasia || f.razaoSocial) : '—'; };

  // Cabeçalho
  pdf.setFillColor(...COR); pdf.rect(0, 0, W, 6, 'F');
  pdf.setFontSize(16); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...COR);
  pdf.text('PRESTAÇÃO DE CONTAS', M, y); y += 7;
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40, 40, 40);
  pdf.text(`${prestacao.tipo === 'final' ? 'Prestação Final' : 'Prestação Parcial'} · ${rotuloMes(prestacao.mesInicio, projeto.mesInicio)}–${rotuloMes(prestacao.mesFim, projeto.mesInicio)}`, M, y); y += 6;
  pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0);
  pdf.text(projeto.titulo || 'Projeto', M, y); y += 5;
  if (entidadeNome) { pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(90, 90, 90); pdf.text(`Entidade: ${entidadeNome}`, M, y); y += 5; }
  y += 2;

  // 1. Demonstrativo físico-financeiro
  pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...COR);
  pdf.text('1. Demonstrativo físico-financeiro', M, y); y += 2;

  const grupos: EtapaProjeto[] = [...etapas, ...(itens.some(it => !it.etapaId) ? [{ id: '', nome: 'Sem etapa' } as EtapaProjeto] : [])];
  const body: any[] = [];
  let tPrev = 0, tReal = 0;
  grupos.forEach((et, gi) => {
    const itensEt = itens.filter(it => (it.etapaId || '') === et.id && (prevItem(it.id) > 0 || realItem(it.id) > 0));
    if (!itensEt.length) return;
    body.push([{ content: `${et.id ? `${gi + 1}.0 — ` : ''}${(et.nome || '').toUpperCase()}`, colSpan: 5, styles: { fillColor: COR, textColor: [255, 255, 255], fontStyle: 'bold' } }]);
    itensEt.forEach(it => {
      const pq = prevItem(it.id), rq = realItem(it.id), vu = it.valorUnitario || 0;
      tPrev += pq * vu; tReal += rq * vu;
      body.push([`${it.nome} (${it.unidade})`, String(pq), String(rq), FMT(pq * vu), FMT(rq * vu)]);
    });
  });
  body.push([{ content: 'TOTAL DO PERÍODO', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } }, { content: FMT(tPrev), styles: { fontStyle: 'bold' } }, { content: FMT(tReal), styles: { fontStyle: 'bold' } }]);
  autoTable(pdf, {
    startY: y + 1,
    head: [['Etapa / Item', 'Prev. qtd', 'Real. qtd', 'Prev. R$', 'Real. R$']],
    body,
    margin: { left: M, right: M },
    headStyles: { fillColor: COR, textColor: [255, 255, 255], fontSize: 8 },
    styles: { fontSize: 8, valign: 'top' },
    columnStyles: { 0: { cellWidth: 78 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });
  y = (pdf as any).lastAutoTable.finalY + 8;

  // 2. Resumo financeiro
  autoTable(pdf, {
    startY: y,
    body: [[
      { content: `Valor inicial: ${FMT(totalOrcado)}`, styles: { fontStyle: 'bold' } },
      { content: `Executado: ${FMT(totalExecutado)}`, styles: { fontStyle: 'bold', textColor: COR } },
      { content: `Saldo a devolver: ${FMT(saldoDevolver)}`, styles: { fontStyle: 'bold', textColor: [180, 120, 0] } },
    ]],
    margin: { left: M, right: M },
    styles: { fontSize: 9, halign: 'center' },
    theme: 'grid',
  });
  y = (pdf as any).lastAutoTable.finalY + 8;

  // 3. Relação de pagamentos e documentos
  pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...COR);
  pdf.text('2. Relação de pagamentos e documentos', M, y);
  const execs = execucoes.filter(e => e.mes >= prestacao.mesInicio && e.mes <= prestacao.mesFim);
  const docBody: any[] = execs.length
    ? execs.map(e => {
      const it = itens.find(i => i.id === e.itemProjetoId);
      return [rotuloMes(e.mes, projeto.mesInicio), it?.nome || '—', `${e.quantidade} ${it?.unidade || ''}`, fornNome(e.fornecedorId), e.notaFiscalUrl ? 'Sim' : '—', e.certidoesUrl ? 'Sim' : '—', e.pagamentoUrl ? 'Sim' : '—'];
    })
    : [[{ content: 'Nenhuma execução no período.', colSpan: 7, styles: { halign: 'center', textColor: [140, 140, 140] } }]];
  autoTable(pdf, {
    startY: y + 2,
    head: [['Mês', 'Item', 'Qtd', 'Fornecedor', 'NF', 'Cert.', 'Pgto']],
    body: docBody,
    margin: { left: M, right: M },
    headStyles: { fillColor: COR, textColor: [255, 255, 255], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: { 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' } },
  });
  y = (pdf as any).lastAutoTable.finalY + 8;

  // 4. Remanejamento
  if (projeto.justificativaRemanejamento) {
    if (y > 250) { pdf.addPage(); y = 16; }
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...COR);
    pdf.text('3. Remanejamento de quantidades', M, y); y += 6;
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40, 40, 40);
    const linhas = pdf.splitTextToSize(projeto.justificativaRemanejamento, W - 2 * M);
    pdf.text(linhas, M, y); y += linhas.length * 4.5 + 6;
  }

  // 5. Relatório de cumprimento do objeto (narrativa)
  const secoes: [string, string | undefined][] = [
    ['Resumo executivo', prestacao.resumoExecutivo],
    ['Metas atingidas', prestacao.metasAtingidas],
    ['Dificuldades encontradas', prestacao.dificuldades],
    ['Observações', prestacao.observacoes],
  ];
  if (secoes.some(([, v]) => v && v.trim())) {
    if (y > 240) { pdf.addPage(); y = 16; }
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...COR);
    pdf.text('4. Relatório de cumprimento do objeto', M, y); y += 7;
    secoes.forEach(([titulo, txt]) => {
      if (!txt || !txt.trim()) return;
      if (y > 270) { pdf.addPage(); y = 16; }
      pdf.setFontSize(9.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(60, 60, 60);
      pdf.text(titulo, M, y); y += 5;
      pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40, 40, 40);
      const linhas = pdf.splitTextToSize(txt, W - 2 * M);
      for (const linha of linhas) {
        if (y > 285) { pdf.addPage(); y = 16; }
        pdf.text(linha, M, y); y += 4.4;
      }
      y += 4;
    });
  }

  // Rodapé com numeração
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8); pdf.setTextColor(150, 150, 150);
    pdf.text(`Prestação de Contas — ${projeto.titulo || ''} — pág. ${i}/${total}`, M, pdf.internal.pageSize.getHeight() - 6);
  }

  window.open(pdf.output('bloburl'), '_blank');
}
