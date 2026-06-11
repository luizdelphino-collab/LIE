/**
 * Camada de serviço (frontend) da integração Banco de Preços.
 * Fala SÓ com as Cloud Functions proxy (lib/bancoDePrecos no functions/),
 * que guardam o token. O navegador nunca vê o UsuarioApiToken.
 */
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db, storage } from './firebase';
import { ItemMaster, PrecoReferencia } from '../types';

// Base das Cloud Functions (mesmo padrão das demais funções do LIE).
function fnBase(): string {
  const projectId = (storage.app.options as any).projectId;
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

async function callFn(name: string, body: any): Promise<any> {
  const resp = await fetch(`${fnBase()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Falha na função ${name} (HTTP ${resp.status}).`);
  return json;
}

export interface BpCotacao {
  idCotacao: number;
  descricao: string;
  finalidade?: string;
  quantidadeItens?: number;
  dataAbertura?: string;
  finalizada?: boolean;
}
export interface BpItem {
  idItem: number;
  nome?: string;
  descricao?: string;
  codigo?: number;
  nomeLote?: string;
  countPrecos: number;
  unidade?: string;
}
export interface BpPreco {
  fontePesquisa?: string;
  produto?: string;
  descricao?: string;
  unidadeMedida?: string;
  quantidade?: number;
  modalidade?: string;
  data?: string;
  dataHomologacao?: string;
  uf?: string;
  preco: number;
  cnpjFornecedor?: string;
  isDesconsideradoDoCalculo?: boolean;
}

export async function listarCotacoes(): Promise<BpCotacao[]> {
  const r = await callFn('bancoPrecosCotacoes', {});
  return r.cotacoes || [];
}
export async function listarItens(idCotacao: number): Promise<BpItem[]> {
  const r = await callFn('bancoPrecosCotacaoItens', { idCotacao });
  return r.itens || [];
}
export async function listarPrecos(idCotacao: number, idItem: number): Promise<BpPreco[]> {
  const r = await callFn('bancoPrecosItemPrecos', { idCotacao, idItem });
  return r.precos || [];
}

/** Converte um preço da BP em PrecoReferencia do LIE. */
function mapPreco(p: BpPreco, idCotacao: number, idItem: number, idx: number, pdfUrl: string): PrecoReferencia {
  return {
    orgaoLicitante: p.fontePesquisa || 'Banco de Preços',
    identificadorCompra: `BP-${idCotacao}-${idItem}-${idx + 1}`,
    dataHomologacao: p.dataHomologacao || p.data || '',
    quantidade: p.quantidade,
    unidadeMedida: p.unidadeMedida,
    valorUnitario: Number(p.preco) || 0,
    fonte: 'banco-de-precos',
    uf: p.uf,
    modalidade: p.modalidade,
    descricaoItem: p.descricao || p.produto,
    fornecedorCnpj: p.cnpjFornecedor,
    localizacaoUrl: pdfUrl,
    arquivoNome: `banco-precos-cotacao-${idCotacao}.pdf`,
    dataPublicacao: p.data,
  };
}

function calcStats(refs: PrecoReferencia[]): { media: number; mediana: number } {
  const vals = refs.map(r => r.valorUnitario).filter(v => v > 0).sort((a, b) => a - b);
  if (!vals.length) return { media: 0, mediana: 0 };
  const media = vals.reduce((a, b) => a + b, 0) / vals.length;
  const mid = Math.floor(vals.length / 2);
  const mediana = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return { media, mediana };
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Gera o PDF-snapshot da pesquisa (comprovante para prestação de contas). */
function gerarPdf(item: ItemMaster, cotacao: BpCotacao, idItem: number, precos: BpPreco[]): Blob {
  const docu = new jsPDF();
  docu.setFontSize(14);
  docu.text('Pesquisa de Preços — Banco de Preços', 14, 18);
  docu.setFontSize(10);
  docu.text(`Item: ${item.nome}`, 14, 28);
  docu.text(`Cotação: ${cotacao.descricao} (id ${cotacao.idCotacao})`, 14, 34);
  docu.text(`Fonte: Banco de Preços (BP4) — item id ${idItem}`, 14, 40);
  autoTable(docu, {
    startY: 46,
    head: [['Fonte', 'Descrição', 'Fornecedor (CNPJ)', 'UF', 'Modalidade', 'Data Homolog.', 'Valor Unit.']],
    body: precos.map(p => [
      p.fontePesquisa || '—',
      (p.descricao || p.produto || '').slice(0, 60),
      p.cnpjFornecedor || '—',
      p.uf || '—',
      p.modalidade || '—',
      (p.dataHomologacao || p.data || '').slice(0, 10),
      brl(Number(p.preco) || 0) + (p.isDesconsideradoDoCalculo ? ' (desc.)' : ''),
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [31, 41, 55] },
  });
  return docu.output('blob');
}

/**
 * Anexa os preços de um item de cotação BP ao ItemMaster:
 * gera o PDF, sobe ao Storage, grava referencias[] + media/mediana no item.
 */
export async function anexarPrecosAoItem(
  item: ItemMaster,
  cotacao: BpCotacao,
  idItem: number,
  precos: BpPreco[]
): Promise<{ refs: number; media: number; mediana: number; pdfUrl: string }> {
  // 1. PDF snapshot -> Storage
  const blob = gerarPdf(item, cotacao, idItem, precos);
  const path = `pesquisa_precos/${item.id}/banco-precos-${cotacao.idCotacao}-${idItem}.pdf`;
  const sref = ref(storage, path);
  await uploadBytes(sref, blob, { contentType: 'application/pdf' });
  const pdfUrl = await getDownloadURL(sref);

  // 2. Mapeia só os preços considerados (exclui isDesconsideradoDoCalculo).
  const validos = precos.filter(p => !p.isDesconsideradoDoCalculo && Number(p.preco) > 0);
  const novasRefs = validos.map((p, i) => mapPreco(p, cotacao.idCotacao, idItem, i, pdfUrl));

  // 3. Mescla com referências existentes (sem duplicar as desta mesma cotação/item).
  const existentes = (item.referencias || []).filter(
    r => !(r.fonte === 'banco-de-precos' && r.arquivoNome === `banco-precos-cotacao-${cotacao.idCotacao}.pdf`)
  );
  const referencias = [...existentes, ...novasRefs];
  const { media, mediana } = calcStats(referencias);

  // 4. Persiste no item.
  await setDoc(doc(db, 'items', item.id), {
    referencias,
    pesquisado: referencias.length > 0,
    mediaReferencia: media,
    medianaReferencia: mediana,
    pesquisaAtualizadaEm: serverTimestamp(),
  }, { merge: true });

  return { refs: novasRefs.length, media, mediana, pdfUrl };
}
