import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import jsPDF from 'jspdf';
import { storage, db } from './firebase';
import { buscarMateriaisLocal, consultarPrecosPraticados } from './apiCompras';
import type { ItemProjeto, ItemMaster, PrecoReferencia } from '../types';

export type AutoPesquisaStatus = 'ok' | 'sem-match' | 'sem-catmat-real' | 'sem-refs' | 'erro';

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

  // === Cabeçalho institucional ===
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('REGISTRO DE COTAÇÃO PÚBLICA — IN SEGES/ME Nº 65/2021', 15, 13);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('Documento gerado pelo Sistema LIE-Projetos para arquivamento e auditoria de preços públicos', 15, 19);
  doc.text(`Token de validação: ${token}`, 15, 25);

  // === Título do documento ===
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIDÃO DE COMPROVAÇÃO E PREÇO PÚBLICO', 15, 42);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Emitida em: ${new Date().toLocaleString('pt-BR')}`, 15, 48);

  const FONTE_LABELS: Record<string, string> = {
    'compras.gov.br': 'COMPRAS.GOV.BR',
    'pncp-contratacao': 'PNCP — EDITAL (Lei 14.133/2021)',
    'pncp-ata': 'PNCP — ATA DE REGISTRO DE PREÇOS',
    'pncp': 'PNCP',
    'tce-pe': 'TCE-PE',
    'fomento': 'FOMENTO MANUAL',
    'manual': 'CADASTRO MANUAL'
  };

  // === Helpers de renderização ===
  let y = 56;
  const MAX_W = 125;
  const COL_LABEL_X = 15;
  const COL_VALUE_X = 70;

  const sectionTitle = (title: string) => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(15, y, 195, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(title, COL_LABEL_X, y);
    y += 5;
  };

  const field = (label: string, value: string | undefined, highlight = false) => {
    const safeValue = (value || '').toString().trim();
    if (!safeValue || safeValue === '-') return;
    if (y > 275) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label, COL_LABEL_X, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(highlight ? 16 : 30, highlight ? 185 : 41, highlight ? 129 : 59);
    const lines = doc.splitTextToSize(safeValue, MAX_W);
    doc.text(lines, COL_VALUE_X, y);
    y += Math.max(5, lines.length * 4);
  };

  // === Seção 1: Identidade do órgão ===
  sectionTitle('1. IDENTIDADE DO ÓRGÃO LICITANTE');
  field('Órgão Licitante:', r.orgaoLicitante);
  field('CNPJ:', r.cnpjOrgao);
  field('Código UASG:', r.uasg);
  const esferaUf = [r.poder, r.esfera, r.uf].filter(Boolean).join(' • ');
  field('Poder / Esfera / UF:', esferaUf);

  // === Seção 2: Legalidade da compra ===
  sectionTitle('2. LEGALIDADE DA CONTRATAÇÃO');
  field('Fonte da cotação:', FONTE_LABELS[r.fonte] || r.fonte.toUpperCase());
  field('Modalidade:', r.modalidade);
  field('Situação:', r.situacao);
  field('Identificador da compra:', r.identificadorCompra);
  field('Nº de controle PNCP:', r.numeroControlePNCP);
  field('Data de homologação:', r.dataHomologacao);
  field('Vigência da ARP:', r.dataVigenciaFinalAta ? `até ${r.dataVigenciaFinalAta}` : '');

  // === Seção 3: Identidade do item ===
  sectionTitle('3. IDENTIDADE DO OBJETO');
  field('Item (LIE):', itemNome);
  field('Descrição oficial:', r.descricaoItem);
  field('Código CATMAT/CATSER:', r.codigoCatalogoItem);
  // Compat retroativa: se unidadeMedida salva e capacidade (ML/L/KG/G), usa siglaUnidadeFornecimento
  const SIGLAS_CAPACIDADE_PDF = ['ML', 'L', 'LT', 'KG', 'G', 'GR', 'M', 'M2', 'M3', 'M²', 'M³'];
  const unidSalvaPDF = String(r.unidadeMedida || '').toUpperCase();
  const temEmbPDF = r.siglaUnidadeFornecimento || r.nomeUnidadeFornecimento || (r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento > 0);
  const unidQtdPDF = (SIGLAS_CAPACIDADE_PDF.includes(unidSalvaPDF) && temEmbPDF)
    ? (r.siglaUnidadeFornecimento || 'UN')
    : (r.unidadeMedida || '');
  const qtdUnid = r.quantidade ? `${r.quantidade}${unidQtdPDF ? ' ' + unidQtdPDF : ''}` : '';
  field('Quantidade contratada:', qtdUnid);
  if (r.nomeUnidadeFornecimento || (r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento > 0)) {
    const partesEmb: string[] = [];
    if (r.nomeUnidadeFornecimento) partesEmb.push(r.nomeUnidadeFornecimento);
    if (r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento > 0) {
      partesEmb.push(`${r.capacidadeUnidadeFornecimento} ${r.siglaUnidadeMedida || ''}`.trim() + ' por unidade');
    }
    field('Embalagem:', partesEmb.join(' — '));
  }

  // === Seção 4: Adjudicatário ===
  if (r.fornecedorNome || r.fornecedorCnpj) {
    sectionTitle('4. ADJUDICATÁRIO');
    field('Razão social:', r.fornecedorNome);
    field('CNPJ:', r.fornecedorCnpj);
  }

  // === Seção 5: Valor de referência ===
  sectionTitle('5. VALOR DE REFERÊNCIA');
  field(
    'Valor unitário:',
    r.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    true
  );
  if (r.quantidade && r.valorUnitario) {
    const total = r.quantidade * r.valorUnitario;
    field('Valor total estimado:', total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  }

  // === Seção 6: Vinculação ao projeto ===
  sectionTitle('6. VINCULAÇÃO TÉCNICA AO PROJETO');
  field('Projeto:', projetoTitulo);
  field('Token de validação:', token);

  // === Seção 7: Rastreabilidade pública ===
  sectionTitle('7. RASTREABILIDADE PÚBLICA');
  if (r.linkPncpOriginal && r.linkPncpOriginal !== r.localizacaoUrl) {
    field('Fonte oficial (PNCP/Compras):', r.linkPncpOriginal);
  }
  field('Validação externa:', `https://projetos.lie.com.br/#/validar?token=${token}`);

  // === Declaração de conformidade ===
  if (y > 245) { doc.addPage(); y = 20; }
  y += 4;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.rect(15, y, 180, 30, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text('DECLARAÇÃO DE ECONOMICIDADE E CONFORMIDADE LEGAL', 20, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const declaracao =
    'Atesta-se, sob as diretrizes de integridade administrativa, que o preço público acima referenciado '
    + 'foi coletado, validado e arquivado para instrução do processo de cotação de mercado. Esta referência '
    + 'atende ao Art. 5º da IN SEGES/ME nº 65/2021, integrando a cesta estatística de preços públicos '
    + 'homologados. O presente registro encontra-se blindado e auditável pelos links acima.';
  const decLines = doc.splitTextToSize(declaracao, 170);
  doc.text(decLines, 20, y + 12);
  y += 36;

  // === Carimbo ===
  if (y > 265) { doc.addPage(); y = 20; }
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.rect(140, y, 55, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(16, 185, 129);
  doc.text('PREÇO PÚBLICO', 143, y + 6);
  doc.text('VALIDADO & HOMOLOGADO', 143, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Token: ${token.substring(0, 16)}`, 143, y + 15);
  doc.text(`Data Reg: ${new Date().toLocaleDateString('pt-BR')}`, 143, y + 19);

  // === Rodapé ===
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6.5);
  doc.text(
    'Documento oficial de rastreabilidade gerado eletronicamente nos termos da IN SEGES/ME nº 65/2021. Brasília-DF.',
    15, 285
  );

  return doc.output('blob');
}

async function arquivarReferencia(
  r: PrecoReferencia,
  itemNome: string,
  storagePathPrefix: string,
  projetoTitulo: string,
  token: string,
  idx: number
): Promise<PrecoReferencia> {
  const copy = { ...r };

  // Só arquiva pra fontes federais — TCE-PE e cotações manuais já têm link válido
  const fontesFederais: PrecoReferencia['fonte'][] = ['compras.gov.br', 'pncp', 'pncp-contratacao', 'pncp-ata'];
  if (!fontesFederais.includes(copy.fonte)) {
    return copy;
  }

  // Preserva URL original do PNCP/Compras antes de qualquer sobrescrita
  if (copy.localizacaoUrl && (copy.localizacaoUrl.includes('pncp.gov.br') || copy.localizacaoUrl.includes('compras.gov.br'))) {
    copy.linkPncpOriginal = copy.localizacaoUrl;
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
    const storagePath = `${storagePathPrefix}/${fileKey}.pdf`;
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

/**
 * Limpa a cesta de pesquisa de um item — usado quando o reprocessamento
 * encontra zero cotações elegíveis ou nenhum match no catálogo.
 * Garante que o Firestore reflita o estado real (vazio = sem dados).
 */
async function limparPesquisaItem(item: ItemProjeto, codigoCatalogoTentado?: number): Promise<void> {
  const patch: any = {
    pesquisado: false,
    referencias: [],
    mediaReferencia: 0,
    medianaReferencia: 0
  };
  if (codigoCatalogoTentado) patch.ultimoCodigoVinculado = codigoCatalogoTentado;
  await setDoc(doc(db, `projects/${item.projectId}/items`, item.id), patch, { merge: true });
}

export async function pesquisarItemAutomatico(
  item: ItemProjeto,
  projetoTitulo: string,
  entidadeNome: string
): Promise<AutoPesquisaResult> {
  try {
    console.info(`[pesquisa] iniciando '${item.nome}' (estimado: R$ ${item.valorUnitario})`);

    // Prioridade 1: CATMAT/CATSER validado oficialmente no cadastro do item
    let codigoCatmat: number;
    let nomeCatmat: string;

    if (item.codigoCatmat && item.codigoCatmat > 0) {
      codigoCatmat = item.codigoCatmat;
      nomeCatmat = item.nomeCatmatOficial || item.nome;
      console.info(`[pesquisa] '${item.nome}' usando CATMAT validado: ${codigoCatmat} (${nomeCatmat})`);
    } else {
      // Prioridade 2: tentar match no seed local (códigos REAIS conhecidos)
      const matches = buscarMateriaisLocal(item.nome);
      if (matches.length === 0) {
        console.info(`[pesquisa] '${item.nome}' SEM CATMAT validado nem match no seed local — limpando cesta`);
        await limparPesquisaItem(item);
        return {
          itemId: item.id,
          itemNome: item.nome,
          status: 'sem-catmat-real',
          reason: 'Item não tem CATMAT/CATSER oficial cadastrado. Edite o item base e informe o código (busque em https://catalogo.compras.gov.br/).'
        };
      }
      const mat = matches[0];
      codigoCatmat = mat.codigoItem;
      nomeCatmat = mat.nome;
      console.info(`[pesquisa] '${item.nome}' match seed: ${codigoCatmat} (${nomeCatmat})`);
    }

    const precos = await consultarPrecosPraticados(codigoCatmat, item.valorUnitario, nomeCatmat);
    console.info(`[pesquisa] '${item.nome}' API retornou ${precos.length} cotação(ões) brutas`);

    const elegiveis = precos
      .filter(p => p.valorUnitario >= item.valorUnitario)
      .sort((a, b) => b.valorUnitario - a.valorUnitario);
    console.info(`[pesquisa] '${item.nome}' ${elegiveis.length} elegíveis (>= R$ ${item.valorUnitario})`);

    if (elegiveis.length === 0) {
      console.info(`[pesquisa] '${item.nome}' SEM elegíveis — limpando cesta antiga`);
      await limparPesquisaItem(item, codigoCatmat);
      const motivo = precos.length === 0
        ? 'A API governamental não retornou nenhuma cotação pra esse código CATMAT.'
        : `API retornou ${precos.length} cotação(ões), mas todas abaixo do valor estimado (R$ ${item.valorUnitario}).`;
      return { itemId: item.id, itemNome: item.nome, status: 'sem-refs', reason: motivo };
    }

    const token = generateToken();

    const referenciasArquivadas: PrecoReferencia[] = [];
    for (let idx = 0; idx < elegiveis.length; idx++) {
      const pathPrefix = `projects/${item.projectId}/referencias_precos`;
      const arquivada = await arquivarReferencia(elegiveis[idx], item.nome, pathPrefix, projetoTitulo, token, idx);
      referenciasArquivadas.push(arquivada);
    }

    const valores = referenciasArquivadas.map(r => r.valorUnitario).sort((a, b) => a - b);
    const media = valores.reduce((acc, v) => acc + v, 0) / valores.length;
    const meio = Math.floor(valores.length / 2);
    const mediana = valores.length % 2 === 0
      ? (valores[meio - 1] + valores[meio]) / 2
      : valores[meio];

    // Sempre SETA explicitamente — não há merge silencioso de cesta antiga
    await setDoc(doc(db, `projects/${item.projectId}/items`, item.id), {
      pesquisado: true,
      referencias: referenciasArquivadas,
      mediaReferencia: media,
      medianaReferencia: mediana,
      tokenPesquisa: token,
      ultimoCodigoVinculado: codigoCatmat
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

    console.info(`[pesquisa] '${item.nome}' OK — ${referenciasArquivadas.length} refs salvas`);
    return { itemId: item.id, itemNome: item.nome, status: 'ok', refsCount: referenciasArquivadas.length };
  } catch (e: any) {
    console.error('Falha na pesquisa automática do item', item.nome, e);
    return { itemId: item.id, itemNome: item.nome, status: 'erro', reason: e?.message || String(e) };
  }
}

/**
 * Versao Banco de Itens (etapa 5C+): pesquisa de preco direto no master,
 * sem vinculo a projeto. Mesma logica do pesquisarItemAutomatico mas salva
 * em items/{id} e cotacoesValidadoras com escopo='banco'. Usada pelo botao
 * "Atualizar mercado de todos" do Banco de Itens.
 */
export async function pesquisarItemMasterAutomatico(
  item: ItemMaster
): Promise<AutoPesquisaResult> {
  try {
    console.info(`[pesquisa-banco] iniciando '${item.nome}' (estimado: R$ ${item.valorUnitario})`);

    if (!item.codigoCatmat || item.codigoCatmat <= 0) {
      // Tenta seed local como ultimo recurso
      const matches = buscarMateriaisLocal(item.nome);
      if (matches.length === 0) {
        return {
          itemId: item.id,
          itemNome: item.nome,
          status: 'sem-catmat-real',
          reason: 'Item sem CATMAT/CATSER vinculado. Edite o item e busque o codigo oficial.'
        };
      }
      var codigoCatmat = matches[0].codigoItem;
      var nomeCatmat = matches[0].nome;
    } else {
      var codigoCatmat = item.codigoCatmat;
      var nomeCatmat = item.nomeCatmatOficial || item.nome;
    }

    const precos = await consultarPrecosPraticados(codigoCatmat, item.valorUnitario, nomeCatmat);
    console.info(`[pesquisa-banco] '${item.nome}' API retornou ${precos.length} cotacoes brutas`);

    const elegiveis = precos
      .filter(p => p.valorUnitario >= item.valorUnitario)
      .sort((a, b) => b.valorUnitario - a.valorUnitario);

    if (elegiveis.length === 0) {
      // Limpa cesta antiga
      await setDoc(doc(db, 'items', item.id), {
        pesquisado: false,
        referencias: [],
        mediaReferencia: 0,
        medianaReferencia: 0,
        ultimoCodigoVinculado: codigoCatmat
      }, { merge: true });
      const motivo = precos.length === 0
        ? 'A API governamental nao retornou nenhuma cotacao pra esse codigo.'
        : `API retornou ${precos.length} cotacoes, mas todas abaixo do valor estimado (R$ ${item.valorUnitario}).`;
      return { itemId: item.id, itemNome: item.nome, status: 'sem-refs', reason: motivo };
    }

    const token = generateTokenBanco();
    const pathPrefix = `banco/${item.id}/referencias_precos`;

    const referenciasArquivadas: PrecoReferencia[] = [];
    for (let idx = 0; idx < elegiveis.length; idx++) {
      const arquivada = await arquivarReferencia(elegiveis[idx], item.nome, pathPrefix, '(BANCO DE ITENS)', token, idx);
      referenciasArquivadas.push(arquivada);
    }

    const valores = referenciasArquivadas.map(r => r.valorUnitario).sort((a, b) => a - b);
    const media = valores.reduce((acc, v) => acc + v, 0) / valores.length;
    const meio = Math.floor(valores.length / 2);
    const mediana = valores.length % 2 === 0
      ? (valores[meio - 1] + valores[meio]) / 2
      : valores[meio];

    await setDoc(doc(db, 'items', item.id), {
      pesquisado: true,
      referencias: referenciasArquivadas,
      mediaReferencia: media,
      medianaReferencia: mediana,
      tokenPesquisa: token,
      ultimoCodigoVinculado: codigoCatmat,
      pesquisaAtualizadaEm: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, 'cotacoesValidadoras', token), {
      token,
      itemMasterId: item.id,
      escopo: 'banco' as const,
      nome: item.nome,
      descricao: item.descricao || '',
      unidade: item.unidade,
      valorUnitarioEstimado: item.valorUnitario,
      codigoCatmat: item.codigoCatmat || null,
      tipoCatmat: item.tipoCatmat || null,
      nomeCatmatOficial: item.nomeCatmatOficial || null,
      descricaoCatmatOficial: item.descricaoCatmatOficial || null,
      fatorConversao: item.fatorConversao || null,
      unidadeBase: item.unidadeBase || null,
      embalagemDescricao: item.embalagemDescricao || null,
      referencias: referenciasArquivadas,
      mediaReferencia: media,
      medianaReferencia: mediana,
      projetoTitulo: '(BANCO DE ITENS)',
      entidadeNome: 'PROPONENTE',
      criadoEm: serverTimestamp()
    });

    console.info(`[pesquisa-banco] '${item.nome}' OK — ${referenciasArquivadas.length} refs salvas`);
    return { itemId: item.id, itemNome: item.nome, status: 'ok', refsCount: referenciasArquivadas.length };
  } catch (e: any) {
    console.error('Falha na pesquisa automatica do item master', item.nome, e);
    return { itemId: item.id, itemNome: item.nome, status: 'erro', reason: e?.message || String(e) };
  }
}

function generateTokenBanco(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
