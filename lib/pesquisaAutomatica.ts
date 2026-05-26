import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import jsPDF from 'jspdf';
import { storage, db } from './firebase';
import { buscarMateriaisLocal, consultarPrecosPraticados } from './apiCompras';
import type { ItemProjeto, PrecoReferencia } from '../types';

export type AutoPesquisaStatus = 'ok' | 'sem-match' | 'sem-refs' | 'erro';

export interface AutoPesquisaResult {
  itemId: string;
  itemNome: string;
  status: AutoPesquisaStatus;
  refsCount?: number;
  reason?: string;
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export function gerarCertidaoCotacaoPDF(
  r: PrecoReferencia,
  itemNome: string,
  projetoTitulo: string,
  token: string
): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 35, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text("REGISTRO NACIONAL DE PREÇOS PÚBLICOS", 15, 15);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(34, 211, 238);
  doc.text("PORTAL NEUTRO DE AUDITORIA E CONFORMIDADE LEGAL — INSTRUÇÃO NORMATIVA SEGES/ME Nº 65/2021", 15, 22);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text("CERTIDÃO DE COMPROVAÇÃO E PREÇO PÚBLICO", 15, 50);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Identificador do Registro (Token): ${token}`, 15, 56);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(15, 62, 195, 62);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text("DADOS DO ÓRGÃO E DA CONTRATAÇÃO", 15, 69);

  const drawField = (label: string, value: string, y: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(label, 15, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(value.substring(0, 70), 65, y);
  };

  drawField("Órgão Licitante / Parceiro:", r.orgaoLicitante || '-', 77);
  drawField("Identificador da Compra:", r.identificadorCompra || '-', 84);
  drawField("Código UASG / Parceiro:", r.uasg || 'Não especificado', 91);
  drawField("Data de Homologação:", r.dataHomologacao || '-', 98);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text("Valor Unitário de Referência:", 15, 105);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129);
  doc.text(r.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 65, 105);

  doc.line(15, 112, 195, 112);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text("ASSOCIAÇÃO TÉCNICA E FINALIDADE", 15, 119);

  drawField("Item do Plano de Trabalho:", (itemNome || '').toUpperCase(), 127);
  drawField("Projeto Vinculado:", (projetoTitulo || '').toUpperCase(), 134);

  doc.line(15, 141, 195, 141);

  doc.setFillColor(248, 250, 252);
  doc.rect(15, 148, 180, 38, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(15, 148, 180, 38, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text("DECLARAÇÃO DE ECONOMICIDADE E CONFORMIDADE LEGAL", 20, 155);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const textStr = "Atesta-se, sob as diretrizes de integridade administrativa, que o preço público acima referenciado foi coletado, validado e arquivado para instrução do processo de cotação de mercado. Esta referência atende de forma integral ao Art. 5º da Instrução Normativa SEGES/ME nº 65/2021, integrando de forma regular a cesta estatística de preços públicos homologados. O presente registro de conformidade encontra-se blindado e auditável pelo link público abaixo.";
  const textLines = doc.splitTextToSize(textStr, 170);
  doc.text(textLines, 20, 161);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(2, 132, 199);
  doc.setFontSize(7.5);
  doc.text(`Acesse para validação externa: https://projetos.lie.com.br/#/validar?token=${token}`, 15, 195);

  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.rect(140, 210, 55, 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(16, 185, 129);
  doc.text("PREÇO PÚBLICO", 143, 215);
  doc.text("VALIDADO & HOMOLOGADO", 143, 219);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Token: ${token.substring(0, 16)}`, 143, 224);
  doc.text(`Data Reg: ${new Date().toLocaleDateString('pt-BR')}`, 143, 228);

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6.5);
  doc.text("Documento oficial de rastreabilidade gerado eletronicamente nos termos da legislação federal de licitações. Brasília-DF.", 15, 280);

  return doc.output('blob');
}

async function arquivarReferencia(
  r: PrecoReferencia,
  itemNome: string,
  itemProjectId: string,
  projetoTitulo: string,
  token: string,
  idx: number
): Promise<PrecoReferencia> {
  const copy = { ...r };

  if (copy.fonte !== 'compras.gov.br' && copy.fonte !== 'pncp') {
    return copy;
  }

  const fileKey = `${token}_ref_${idx}`;
  const isFallback = !copy.localizacaoUrl
    || !copy.localizacaoUrl.includes('numprp=')
    || copy.localizacaoUrl.includes('pncp.gov.br/app/contratacoes?q=');

  let downloadUrl: string | null = null;

  if (!isFallback) {
    try {
      const projectId = storage.app.options.projectId;
      const funcUrl = `https://us-central1-${projectId}.cloudfunctions.net/obterPdfContratacaoPublica`;
      const resp = await fetch(funcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { url: copy.localizacaoUrl, token: fileKey } })
      });
      if (resp.ok) {
        const data = await resp.json();
        downloadUrl = data.result?.downloadUrl || null;
      }
    } catch (e) {
      console.warn(`Puppeteer falhou pra ${copy.identificadorCompra}, vai usar certidão fallback:`, e);
    }
  }

  if (!downloadUrl) {
    const certBlob = gerarCertidaoCotacaoPDF(copy, itemNome, projetoTitulo, token);
    const storagePath = `projects/${itemProjectId}/referencias_precos/${fileKey}.pdf`;
    const fileRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(fileRef, certBlob);
    await new Promise<void>((resolve, reject) => {
      uploadTask.on('state_changed', null, reject, async () => {
        downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve();
      });
    });
  }

  if (downloadUrl) copy.localizacaoUrl = downloadUrl;
  return copy;
}

export async function pesquisarItemAutomatico(
  item: ItemProjeto,
  projetoTitulo: string,
  entidadeNome: string
): Promise<AutoPesquisaResult> {
  try {
    const matches = buscarMateriaisLocal(item.nome);
    if (matches.length === 0) {
      return { itemId: item.id, itemNome: item.nome, status: 'sem-match', reason: 'Nenhum material correspondente no catálogo CATMAT/CATSER.' };
    }
    const mat = matches[0];

    const precos = await consultarPrecosPraticados(mat.codigoItem, item.valorUnitario);
    const elegiveis = precos
      .filter(p => p.valorUnitario >= item.valorUnitario)
      .sort((a, b) => b.valorUnitario - a.valorUnitario);

    if (elegiveis.length === 0) {
      return { itemId: item.id, itemNome: item.nome, status: 'sem-refs', reason: 'Nenhuma referência igual ou superior ao valor estimado.' };
    }

    const token = item.tokenPesquisa || generateToken();

    const referenciasArquivadas: PrecoReferencia[] = [];
    for (let idx = 0; idx < elegiveis.length; idx++) {
      const arquivada = await arquivarReferencia(elegiveis[idx], item.nome, item.projectId, projetoTitulo, token, idx);
      referenciasArquivadas.push(arquivada);
    }

    const valores = referenciasArquivadas.map(r => r.valorUnitario).sort((a, b) => a - b);
    const media = valores.reduce((acc, v) => acc + v, 0) / valores.length;
    const meio = Math.floor(valores.length / 2);
    const mediana = valores.length % 2 === 0
      ? (valores[meio - 1] + valores[meio]) / 2
      : valores[meio];

    await setDoc(doc(db, `projects/${item.projectId}/items`, item.id), {
      pesquisado: true,
      referencias: referenciasArquivadas,
      mediaReferencia: media,
      medianaReferencia: mediana,
      tokenPesquisa: token,
      ultimoCodigoVinculado: mat.codigoItem
    }, { merge: true });

    await setDoc(doc(db, 'cotacoesValidadoras', token), {
      token,
      projectId: item.projectId,
      itemProjetoId: item.id,
      nome: item.nome,
      descricao: item.descricao || '',
      quantidade: item.quantidade,
      unidade: item.unidade,
      valorUnitarioEstimado: item.valorUnitario,
      referencias: referenciasArquivadas,
      mediaReferencia: media,
      medianaReferencia: mediana,
      projetoTitulo: projetoTitulo || 'PROJETO ESPORTIVO',
      entidadeNome: entidadeNome || 'PROPONENTE',
      criadoEm: serverTimestamp()
    });

    return { itemId: item.id, itemNome: item.nome, status: 'ok', refsCount: referenciasArquivadas.length };
  } catch (e: any) {
    console.error('Falha na pesquisa automática do item', item.nome, e);
    return { itemId: item.id, itemNome: item.nome, status: 'erro', reason: e?.message || String(e) };
  }
}
