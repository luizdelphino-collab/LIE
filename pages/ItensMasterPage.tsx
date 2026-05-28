import { useEffect, useState } from 'react';
import { collection, query, getDocs, doc, setDoc, deleteDoc, serverTimestamp, orderBy, Timestamp, limit, writeBatch } from 'firebase/firestore';
import { Plus, Search, Edit3, Trash2, ArrowUpDown, Loader2, ArrowLeft, Upload, Download, FileSpreadsheet, Wand2, X, CheckCircle2, AlertTriangle, ShieldAlert, ShieldCheck, Lightbulb, Package, Scale, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import type { ItemMaster, CategoriaItem, UnidadeMedida } from '../types';
import CatalogoSearchPicker, { type CatalogoSelecao } from '../components/CatalogoSearchPicker';
import ValidacaoCatmatLoteModal from '../components/ValidacaoCatmatLoteModal';
import CatmatDiagnostico from '../components/CatmatDiagnostico';
import { coletarMercadoItem, coletarMercadoLote, type MercadoResposta, type EstatisticasPorUnidade } from '../lib/mercadoApi';
import { isRecursoHumano } from '../lib/apiCompras';
import MercadoDetalheModal from '../components/MercadoDetalheModal';
import AdaptadorUnidadeCatmat from '../components/AdaptadorUnidadeCatmat';
import PesquisaPrecoModal from '../components/PesquisaPrecoModal';

interface ItemComUso extends ItemMaster {
  projetosUsando: number;
}

interface GrupoDuplicata {
  nomeNormalizado: string;
  paraManter: ItemComUso[];
  paraExcluir: ItemComUso[];
}

function normalizarNome(s: string): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}


const CATEGORIAS: CategoriaItem[] = ['Alimento', 'Transporte', 'Material Esportivo', 'Material não Esportivo', 'Recurso Humano', 'Outro'];
const UNIDADES: (UnidadeMedida | string)[] = ['diária', 'metro', 'metro²', 'unidade', 'pacote', 'caixa', 'kit', 'mês', 'Kg', 'evento', 'jogo', 'geral'];

export default function ItensMasterPage() {
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [sortField, setSortField] = useState<keyof ItemMaster>('categoria');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<ItemMaster>>({
    nome: '',
    descricao: '',
    unidade: 'unidade',
    valorUnitario: 0,
    categoria: 'Alimento'
  });

  // CATMAT/CATSER oficial — busca interativa no catálogo Compras.gov.br
  const [sugestaoNomeOficial, setSugestaoNomeOficial] = useState<string>('');

  // Paginação cliente
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [tamanhoPagina, setTamanhoPagina] = useState(25);

  // Validação CATMAT em lote
  const [validacaoLoteOpen, setValidacaoLoteOpen] = useState(false);

  // Preço de mercado (cache local em memória, busca paralela quando há CATMAT)
  const [mercado, setMercado] = useState<Record<number, MercadoResposta | null>>({});
  const [mercadoCarregando, setMercadoCarregando] = useState<Set<number>>(new Set());
  const [mercadoDetalhe, setMercadoDetalhe] = useState<{ item: ItemMaster; dados: MercadoResposta } | null>(null);

  // Picker de embalagem oficial: descobre embalagens do CATMAT no mercado e oferece adotar
  const [embalagensDisponiveis, setEmbalagensDisponiveis] = useState<MercadoResposta['porUnidade'] | null>(null);
  const [buscandoEmbalagens, setBuscandoEmbalagens] = useState(false);

  // Adaptador automático de unidade: dispara após vincular CATMAT
  const [mercadoAdaptador, setMercadoAdaptador] = useState<MercadoResposta | null>(null);
  const [buscandoAdaptador, setBuscandoAdaptador] = useState(false);
  const [adaptadorDispensado, setAdaptadorDispensado] = useState(false);

  // Pesquisa de preço no Banco (etapa 5C): cesta vive no master, vale pra todos projetos
  const [pesquisaItem, setPesquisaItem] = useState<ItemMaster | null>(null);

  const buscarEmbalagensOficiais = async () => {
    if (!formData.codigoCatmat) return;
    setBuscandoEmbalagens(true);
    try {
      const dados = await coletarMercadoItem(formData.codigoCatmat, formData.tipoCatmat || 'material');
      setEmbalagensDisponiveis(dados?.porUnidade || []);
    } finally {
      setBuscandoEmbalagens(false);
    }
  };

  const adotarEmbalagem = (emb: NonNullable<MercadoResposta['porUnidade']>[0]) => {
    setFormData(p => ({
      ...p,
      unidade: emb.unidade.toLowerCase(),  // "GARRAFA" → "garrafa"
      embalagemDescricao: emb.capacidade > 0
        ? `${emb.unidade.toLowerCase()} ${emb.capacidade}${emb.siglaMedida.toLowerCase()}`
        : emb.unidade.toLowerCase(),
      fatorConversao: emb.capacidade > 0 ? emb.capacidade : undefined,
      unidadeBase: emb.siglaMedida || undefined,
      // Sugere o preço com a mediana saneada (user pode ajustar)
      valorUnitario: p.valorUnitario || emb.estatisticas.mediano
    }));
    setEmbalagensDisponiveis(null);
  };

  // Adoção de embalagem direto pelo modal de detalhe de mercado (item ja salvo).
  // razao = quantas embalagens do mercado cabem em 1 unidade atual do item.
  // Ex: caixa 48 copos -> razao=48, valorUnitario dividido por 48.
  const handleAdotarEmbalagemModal = async (item: ItemMaster, emb: EstatisticasPorUnidade, razao?: number) => {
    const novaUnidade = emb.unidade.toLowerCase();
    const novaDescricao = emb.capacidade > 0
      ? `${emb.unidade.toLowerCase()} ${emb.capacidade}${emb.siglaMedida.toLowerCase()}`
      : emb.unidade.toLowerCase();
    const fator = razao && razao > 1 ? razao : 1;
    const novoValor = item.valorUnitario / fator;

    const updates: Record<string, unknown> = {
      unidade: novaUnidade,
      embalagemDescricao: novaDescricao,
      fatorConversao: emb.capacidade > 0 ? emb.capacidade : null,
      unidadeBase: emb.siglaMedida || null,
    };
    if (fator > 1) {
      updates.valorUnitario = Number(novoValor.toFixed(4));
    }
    await setDoc(doc(db, 'items', item.id), updates, { merge: true });

    // Atualiza estado local pra refletir imediatamente (sem recarregar tudo)
    setItems(prev => prev.map(it => it.id === item.id
      ? {
          ...it,
          unidade: novaUnidade,
          embalagemDescricao: novaDescricao,
          fatorConversao: emb.capacidade > 0 ? emb.capacidade : undefined,
          unidadeBase: emb.siglaMedida || undefined,
          ...(fator > 1 ? { valorUnitario: Number(novoValor.toFixed(4)) } : {})
        }
      : it));

    // Atualiza o item refletido no modal para que o badge "em uso" apareça
    setMercadoDetalhe(prev => prev && prev.item.id === item.id
      ? {
          ...prev,
          item: {
            ...prev.item,
            unidade: novaUnidade,
            embalagemDescricao: novaDescricao,
            fatorConversao: emb.capacidade > 0 ? emb.capacidade : undefined,
            unidadeBase: emb.siglaMedida || undefined,
            ...(fator > 1 ? { valorUnitario: Number(novoValor.toFixed(4)) } : {})
          }
        }
      : prev);
  };

  // Reset pra página 1 quando busca/filtro muda
  useEffect(() => { setPaginaAtual(1); }, [searchTerm, tamanhoPagina]);

  // Quando os itens carregam, busca preços de mercado de quem tem CATMAT validado
  // (em lote, paralelismo 4, cache de 24h na Cloud Function via Firestore).
  useEffect(() => {
    const itensComCatmat = items.filter(it => it.codigoCatmat && !(it.codigoCatmat in mercado));
    if (itensComCatmat.length === 0) return;

    const codigosAlvo = itensComCatmat.map(it => ({
      codigoCatmat: it.codigoCatmat!,
      tipo: (it.tipoCatmat || 'material') as 'material' | 'servico'
    }));

    setMercadoCarregando(prev => {
      const n = new Set(prev);
      codigosAlvo.forEach(c => n.add(c.codigoCatmat));
      return n;
    });

    coletarMercadoLote(codigosAlvo).then(resultado => {
      setMercado(prev => ({ ...prev, ...resultado }));
      setMercadoCarregando(prev => {
        const n = new Set(prev);
        codigosAlvo.forEach(c => n.delete(c.codigoCatmat));
        return n;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Estado do limpador de duplicatas
  const [limpezaOpen, setLimpezaOpen] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [grupos, setGrupos] = useState<GrupoDuplicata[]>([]);
  const [backupBaixado, setBackupBaixado] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [excluidos, setExcluidos] = useState<number | null>(null);

  const carregarItens = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'items'), orderBy('codigo', 'asc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster));
      setItems(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const seedItems = async () => {
    const samples: Partial<ItemMaster>[] = [
      { nome: 'Arroz 5kg', categoria: 'Alimento', unidade: 'pacote', valorUnitario: 25.50 },
      { nome: 'Feijão 1kg', categoria: 'Alimento', unidade: 'unidade', valorUnitario: 8.90 },
      { nome: 'Ônibus fretado 40 lugares', categoria: 'Transporte', unidade: 'diária', valorUnitario: 1200 },
      { nome: 'Bola de Futebol Profissional', categoria: 'Material Esportivo', unidade: 'unidade', valorUnitario: 180 },
      { nome: 'Cone de treinamento', categoria: 'Material Esportivo', unidade: 'unidade', valorUnitario: 15 },
      { nome: 'Colete dupla face', categoria: 'Material Esportivo', unidade: 'unidade', valorUnitario: 35 },
      { nome: 'Papel A4 Resma', categoria: 'Material não Esportivo', unidade: 'pacote', valorUnitario: 28 },
      { nome: 'Coordenador Técnico', categoria: 'Recurso Humano', unidade: 'mês', valorUnitario: 4500 },
      { nome: 'Professor de Educação Física', categoria: 'Recurso Humano', unidade: 'mês', valorUnitario: 3200 },
      { nome: 'Garrafa de Água 500ml', categoria: 'Alimento', unidade: 'unidade', valorUnitario: 2.50 },
    ];

    let count = 1;
    for (const s of samples) {
      const id = doc(collection(db, 'items')).id;
      await setDoc(doc(db, 'items', id), {
        ...s,
        id,
        codigo: count++,
        criadoEm: serverTimestamp()
      });
    }
    carregarItens();
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const dataBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(dataBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

      if (jsonData.length === 0) {
        alert("A planilha está vazia!");
        setLoading(false);
        return;
      }



      const mapCategoria = (cat: string): string => {
        if (!cat) return 'Outro';
        const c = cat.trim().toLowerCase();
        if (c.includes('alimento')) return 'Alimento';
        if (c.includes('transporte')) return 'Transporte';
        if (c.includes('recurso humano') || c.includes('rh')) return 'Recurso Humano';
        if (c.includes('material não esportivo')) return 'Material não Esportivo';
        if (c.includes('material esportivo')) return 'Material Esportivo';
        return 'Outro';
      };

      const mapUnidade = (uni: string): string => {
        if (!uni) return 'unidade';
        const u = uni.trim().toLowerCase();
        if (u === 'unidade') return 'unidade';
        if (u === 'diária' || u === 'diaria') return 'diária';
        if (u === 'mês' || u === 'mes' || u === 'mensal') return 'mês';
        if (u === 'metro') return 'metro';
        if (u === 'm²' || u === 'metro²' || u === 'metro quadrado') return 'metro²';
        if (u === 'evento') return 'evento';
        if (u === 'jogo') return 'jogo';
        if (u === 'geral') return 'geral';
        if (u === 'pacote') return 'pacote';
        if (u === 'caixa') return 'caixa';
        if (u === 'kit') return 'kit';
        if (u === 'kg') return 'Kg';
        return u;
      };

      let count = items.length > 0 ? Math.max(...items.map(it => it.codigo)) : 0;
      count++;

      for (const row of jsonData) {
        const nome = row['Item'] || row['Nome'] || row['nome'] || row['item'];
        if (!nome) continue;

        const categoria = mapCategoria(row['Categoria'] || row['categoria']);
        const unidade = mapUnidade(row['Unidade'] || row['unidade']);
        const valorUnitario = parseFloat(row['Valor Unitário'] || row['valorUnitario'] || row['Valor'] || row['valor'] || 0);
        const descricao = row['Descrição'] || row['descricao'] || '';

        const id = doc(collection(db, 'items')).id;
        await setDoc(doc(db, 'items', id), {
          id,
          codigo: count++,
          nome,
          categoria,
          unidade,
          valorUnitario,
          descricao,
          criadoEm: serverTimestamp()
        });
      }

      alert("Importação concluída com sucesso!");
      carregarItens();
    } catch (err) {
      console.error(err);
      alert("Erro ao importar planilha. Verifique o formato do arquivo.");
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    carregarItens();
  }, []);

  const handleSort = (field: keyof ItemMaster) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedItems = [...items]
    .filter(it => {
      const term = searchTerm.toLowerCase();
      return (
        (it.nome || '').toLowerCase().includes(term) || 
        (it.codigo || '').toString().includes(term) ||
        (it.categoria || '').toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA! < valB!) return sortOrder === 'asc' ? -1 : 1;
      if (valA! > valB!) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const totalItens = sortedItems.length;
  const totalPaginas = Math.max(1, Math.ceil(totalItens / tamanhoPagina));
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const offsetIni = (paginaSegura - 1) * tamanhoPagina;
  const itensPaginados = sortedItems.slice(offsetIni, offsetIni + tamanhoPagina);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const id = editId || doc(collection(db, 'items')).id;
      
      let finalCodigo = formData.codigo;
      if (!editId) {
        // Pega o maior código atual
        const maxCodigo = items.length > 0 ? Math.max(...items.map(it => it.codigo)) : 0;
        finalCodigo = maxCodigo + 1;
      }

      await setDoc(doc(db, 'items', id), {
        ...formData,
        id,
        codigo: finalCodigo,
        criadoEm: formData.criadoEm || serverTimestamp()
      }, { merge: true });

      setIsFormOpen(false);
      carregarItens();
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar item");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (it: ItemMaster) => {
    setEditId(it.id);
    setFormData({ ...it });
    setSugestaoNomeOficial('');
    setIsFormOpen(true);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const openNew = () => {
    setEditId(null);
    setFormData({ nome: '', descricao: '', unidade: 'unidade', valorUnitario: 0, categoria: 'Alimento' });
    setSugestaoNomeOficial('');
    setIsFormOpen(true);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const handleCatalogoSelect = (sel: CatalogoSelecao, nomePdm: string) => {
    setFormData(p => ({
      ...p,
      codigoCatmat: sel.codigoCatmat,
      tipoCatmat: sel.tipoCatmat,
      nomeCatmatOficial: sel.nomeCatmatOficial,
      descricaoCatmatOficial: sel.descricaoCatmatOficial,
      descricao: p.descricao || sel.descricaoCatmatOficial
    }));
    // Se o nome do user diverge do PDM oficial, oferece a sugestão
    const nomeAtualNorm = (formData.nome || '').toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const nomePdmNorm = (nomePdm || '').toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (nomePdm && nomeAtualNorm !== nomePdmNorm) {
      setSugestaoNomeOficial(nomePdm);
    } else {
      setSugestaoNomeOficial('');
    }

    // Dispara busca de mercado em background pra o adaptador de unidade
    setAdaptadorDispensado(false);
    setMercadoAdaptador(null);
    setBuscandoAdaptador(true);
    coletarMercadoItem(sel.codigoCatmat, sel.tipoCatmat)
      .then(resp => setMercadoAdaptador(resp))
      .finally(() => setBuscandoAdaptador(false));
  };

  const removerCatmat = () => {
    setFormData(p => ({
      ...p,
      codigoCatmat: undefined,
      tipoCatmat: undefined,
      nomeCatmatOficial: undefined,
      descricaoCatmatOficial: undefined
    }));
    setSugestaoNomeOficial('');
    setMercadoAdaptador(null);
    setAdaptadorDispensado(false);
  };

  const aceitarSugestaoNome = () => {
    if (sugestaoNomeOficial) {
      setFormData(p => ({ ...p, nome: sugestaoNomeOficial }));
      setSugestaoNomeOficial('');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'items', id));
      setItems(prev => prev.filter(it => it.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir. Verifique as permissões do Firestore.");
    }
  };

  const abrirLimpeza = async () => {
    setLimpezaOpen(true);
    setBackupBaixado(false);
    setExcluidos(null);
    setGrupos([]);
    setAnalisando(true);
    try {
      // 1. Carregar todos masters
      const mastersSnap = await getDocs(collection(db, 'items'));
      const masters = mastersSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster));

      // 2. Cruzar com itens dos projetos
      const projectsSnap = await getDocs(collection(db, 'projects'));
      const usoPorItemId = new Map<string, Set<string>>();
      await Promise.all(
        projectsSnap.docs.map(async (projSnap) => {
          const itemsSnap = await getDocs(collection(db, `projects/${projSnap.id}/items`));
          itemsSnap.docs.forEach(d => {
            const data = d.data() as any;
            const refId: string | undefined = data.itemId || data.itemMasterId;
            if (refId) {
              if (!usoPorItemId.has(refId)) usoPorItemId.set(refId, new Set());
              usoPorItemId.get(refId)!.add(projSnap.id);
            }
          });
        })
      );

      // 3. Agrupar por nome normalizado
      const mapa = new Map<string, ItemComUso[]>();
      masters.forEach(m => {
        const k = normalizarNome(m.nome);
        if (!k) return;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k)!.push({ ...m, projetosUsando: (usoPorItemId.get(m.id) || new Set()).size });
      });

      // 4. Decidir manter/excluir
      const resultado: GrupoDuplicata[] = [];
      mapa.forEach((itens, k) => {
        if (itens.length <= 1) return;
        const emUso = itens.filter(it => it.projetosUsando > 0);
        const orfaos = itens.filter(it => it.projetosUsando === 0);
        let paraManter: ItemComUso[];
        let paraExcluir: ItemComUso[];
        if (emUso.length > 0) {
          paraManter = emUso;
          paraExcluir = orfaos;
        } else {
          const ord = itens.slice().sort((a, b) => (a.codigo || 0) - (b.codigo || 0));
          paraManter = [ord[0]];
          paraExcluir = ord.slice(1);
        }
        if (paraExcluir.length > 0) {
          resultado.push({ nomeNormalizado: k, paraManter, paraExcluir });
        }
      });

      resultado.sort((a, b) => a.nomeNormalizado.localeCompare(b.nomeNormalizado));
      setGrupos(resultado);
    } catch (e: any) {
      console.error(e);
      alert(`Erro ao analisar duplicatas: ${e?.message || e}`);
    } finally {
      setAnalisando(false);
    }
  };

  const baixarBackup = async () => {
    try {
      const snap = await getDocs(collection(db, 'items'));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const json = JSON.stringify({
        exportadoEm: new Date().toISOString(),
        total: data.length,
        items: data
      }, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `items-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupBaixado(true);
    } catch (e: any) {
      alert(`Erro ao baixar backup: ${e?.message || e}`);
    }
  };

  const executarExclusao = async () => {
    const total = grupos.reduce((acc, g) => acc + g.paraExcluir.length, 0);
    if (!backupBaixado) {
      alert('Baixe o backup antes de excluir.');
      return;
    }
    if (!confirm(`Excluir definitivamente ${total} item(s) duplicado(s)? Esta ação NÃO pode ser desfeita.`)) return;
    if (!confirm('CONFIRMAÇÃO FINAL: a exclusão é permanente. Continuar?')) return;

    setExcluindo(true);
    try {
      const idsExcluir = grupos.flatMap(g => g.paraExcluir.map(it => it.id));
      // Firestore writeBatch suporta até 500 ops; particiona se preciso
      for (let i = 0; i < idsExcluir.length; i += 400) {
        const batch = writeBatch(db);
        idsExcluir.slice(i, i + 400).forEach(id => {
          batch.delete(doc(db, 'items', id));
        });
        await batch.commit();
      }
      setExcluidos(idsExcluir.length);
      await carregarItens();
    } catch (e: any) {
      alert(`Erro ao excluir: ${e?.message || e}`);
    } finally {
      setExcluindo(false);
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando banco de itens...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Diagnóstico CATMAT — mostra cobertura e permite vincular em lote */}
      <CatmatDiagnostico items={items} onAtualizado={carregarItens} />

      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Banco de Dados de Itens</h1>
          <p className="text-sm text-lie-gray">Gerencie os itens base que serão utilizados nos projetos</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Download Model Button */}
          <a 
            href="/modelo_importacao_itens.xlsx" 
            download="modelo_importacao_itens.xlsx"
            className="group flex items-center bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2 transition-all duration-300 hover:bg-amber-100 shadow-sm"
          >
            <Download className="w-5 h-5 shrink-0 text-amber-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Baixar Modelo Excel
            </span>
          </a>

          {/* Import Batch Label */}
          <label className="group flex items-center bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg p-2 cursor-pointer transition-all duration-300 hover:bg-indigo-100 shadow-sm">
            <FileSpreadsheet className="w-5 h-5 shrink-0 text-indigo-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Importar Lote (Planilha)
            </span>
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={handleImportExcel}
              className="hidden"
            />
          </label>



          {/* Validar CATMAT em Lote */}
          <button
            onClick={() => setValidacaoLoteOpen(true)}
            title="Buscar CATMAT/CATSER oficial em lote — atribui automaticamente"
            className="group flex items-center bg-amber-50 border border-amber-300 text-amber-700 rounded-lg p-2 transition-all duration-300 hover:bg-amber-100 shadow-sm"
          >
            <Wand2 className="w-5 h-5 shrink-0 text-amber-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Validar CATMAT em Lote
            </span>
          </button>

          {/* Limpar Duplicatas */}
          <button
            onClick={abrirLimpeza}
            title="Limpar itens duplicados (mantém os em uso por projetos)"
            className="group flex items-center bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 transition-all duration-300 hover:bg-red-100 shadow-sm"
          >
            <Wand2 className="w-5 h-5 shrink-0 text-red-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Limpar Duplicatas
            </span>
          </button>

          {/* New Item Button */}
          <button onClick={openNew} className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm">
            <Plus className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Novo Item Base
            </span>
          </button>
        </div>
      </header>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input 
          type="text" 
          placeholder="Buscar por nome, código ou categoria..." 
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl shadow-sm focus:ring-lie-green focus:border-lie-green"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isFormOpen && (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in">
          <h2 className="text-lg font-bold text-lie-ink mb-4">{editId ? 'Editar Item Base' : 'Cadastrar Novo Item Base'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Nome do Item *</label>
              <input type="text" required value={formData.nome} onChange={e => setFormData(p => ({...p, nome: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              {sugestaoNomeOficial && (
                <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-xs flex items-start gap-2">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="text-amber-900">
                      Sugestão: o nome oficial no catálogo é <strong>"{sugestaoNomeOficial}"</strong>.
                    </span>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={aceitarSugestaoNome}
                        className="text-amber-700 hover:text-amber-900 font-bold underline text-[10px] uppercase"
                      >
                        Usar nome oficial
                      </button>
                      <button
                        type="button"
                        onClick={() => setSugestaoNomeOficial('')}
                        className="text-gray-500 hover:text-gray-700 text-[10px] uppercase"
                      >
                        Manter atual
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Categoria *</label>
              <select value={formData.categoria} onChange={e => setFormData(p => ({...p, categoria: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Unidade *</label>
              <select value={formData.unidade} onChange={e => setFormData(p => ({...p, unidade: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Valor Unitário (R$) *</label>
              <input type="number" step="0.01" required value={formData.valorUnitario} onChange={e => setFormData(p => ({...p, valorUnitario: parseFloat(e.target.value)}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-1">Descrição / Especificação</label>
              <textarea rows={2} value={formData.descricao} onChange={e => setFormData(p => ({...p, descricao: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>

            {/* === BLOCO CATMAT/CATSER OFICIAL — BUSCA INTELIGENTE === */}
            <div className="md:col-span-3 border-t border-gray-200 pt-4 mt-2">
              <div className="flex items-start gap-2 mb-3">
                <ShieldCheck className="w-5 h-5 text-lie-green shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-lie-ink">Código CATMAT / CATSER oficial</h3>
                  <p className="text-xs text-gray-500 leading-snug">
                    Busca direta no catálogo Compras.gov.br por palavra-chave. Obrigatório pra que o
                    item entre na <strong>Pesquisa Automática de Preços</strong> (IN 65/2021).
                  </p>
                </div>
              </div>

              {!formData.semCorrespondenciaCatalogo && (
                <>
                  <CatalogoSearchPicker
                    initialTermo={formData.nome}
                    selecionado={
                      formData.codigoCatmat
                        ? {
                            codigoCatmat: formData.codigoCatmat,
                            tipoCatmat: formData.tipoCatmat || 'material',
                            nomeCatmatOficial: formData.nomeCatmatOficial || '',
                            descricaoCatmatOficial: formData.descricaoCatmatOficial || ''
                          }
                        : null
                    }
                    onSelect={handleCatalogoSelect}
                    onClear={removerCatmat}
                  />

                  {/* Adaptador automático: aparece após vincular CATMAT, oferece adequar unidade ao mercado */}
                  {formData.codigoCatmat && !adaptadorDispensado && (
                    <AdaptadorUnidadeCatmat
                      mercado={mercadoAdaptador}
                      carregando={buscandoAdaptador}
                      unidadeAtual={formData.unidade || 'unidade'}
                      nomeItem={formData.nome || ''}
                      valorUnitarioAtual={formData.valorUnitario || 0}
                      onAdaptar={(a) => {
                        setFormData(p => ({
                          ...p,
                          unidade: a.unidade,
                          embalagemDescricao: a.embalagemDescricao,
                          fatorConversao: a.fatorConversao,
                          unidadeBase: a.unidadeBase,
                          valorUnitario: a.valorUnitario,
                        }));
                        setAdaptadorDispensado(true);
                      }}
                      onDispensar={() => setAdaptadorDispensado(true)}
                    />
                  )}
                </>
              )}

              {/* Toggle de rota legal alternativa */}
              <div className={`mt-3 rounded-lg border ${formData.semCorrespondenciaCatalogo ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-gray-50'} p-3`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!formData.semCorrespondenciaCatalogo}
                    onChange={e => setFormData(p => ({
                      ...p,
                      semCorrespondenciaCatalogo: e.target.checked,
                      // Se ativando rota alternativa, limpa o CATMAT (incompatíveis)
                      ...(e.target.checked && {
                        codigoCatmat: undefined,
                        tipoCatmat: undefined,
                        nomeCatmatOficial: undefined,
                        descricaoCatmatOficial: undefined
                      })
                    }))}
                    className="mt-0.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-bold text-lie-ink">
                      Este item não tem código CATMAT/CATSER correspondente
                    </div>
                    <div className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                      Use esta opção para itens que genuinamente não existem no catálogo
                      Compras.gov.br (ex: carrinho de pipoca para evento, oficinas específicas,
                      figurino de mascote personalizado). A pesquisa de preço seguirá a{' '}
                      <strong>rota legal alternativa: 3 orçamentos com fornecedores</strong>,
                      conforme <strong>IN SEGES/ME 73/2020 art. 5º IV</strong> (pesquisa
                      direta com fornecedores nos últimos 6 meses) ou{' '}
                      <strong>IN 65/2021 art. 5º V</strong> (notas fiscais eletrônicas) —
                      em linha com Lei 14.133/21 art. 28 e Acórdão TCU 1445/2015.
                    </div>
                    {formData.semCorrespondenciaCatalogo && (
                      <div className="mt-2 text-[11px] text-purple-900 bg-white border border-purple-200 rounded p-2 leading-relaxed">
                        ✓ Item marcado para rota alternativa. Adicione no mínimo{' '}
                        <strong>3 cotações de fornecedores</strong> pela aba de
                        <em> Cotações Manuais / Fomento</em> ao gerar o relatório do projeto.
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {/* === BLOCO CONVERSOR DE UNIDADE (opcional mas crítico) === */}
            <div className="md:col-span-3 border-t border-gray-200 pt-4 mt-2">
              <div className="flex items-start gap-2 mb-3">
                <Package className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-lie-ink">Embalagem oficial</h3>
                    {formData.codigoCatmat && (
                      <button
                        type="button"
                        onClick={buscarEmbalagensOficiais}
                        disabled={buscandoEmbalagens}
                        className="text-xs px-3 py-1 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                      >
                        {buscandoEmbalagens ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        {buscandoEmbalagens ? 'Buscando…' : 'Ver embalagens do mercado'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 leading-snug mt-1">
                    <strong>Ideal:</strong> usar a mesma embalagem que aparece no mercado público
                    (ex: GARRAFA 500ml). Assim a comparação é direta, sem conversão e o parecerista
                    não precisa interpretar matemática.
                  </p>
                </div>
              </div>

              {/* Picker de embalagens do mercado */}
              {embalagensDisponiveis && (
                <div className="mb-3 border-2 border-blue-200 rounded-lg overflow-hidden bg-blue-50/30">
                  <div className="bg-blue-100 px-3 py-2 text-xs font-bold text-blue-900 flex items-center justify-between">
                    <span>
                      {embalagensDisponiveis.length === 0
                        ? 'Nenhuma embalagem encontrada nas cotações públicas'
                        : `${embalagensDisponiveis.length} embalagem(ns) encontrada(s) — clique pra adotar`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEmbalagensDisponiveis(null)}
                      className="text-blue-700 hover:text-blue-900"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="divide-y divide-blue-100 max-h-60 overflow-y-auto">
                    {embalagensDisponiveis.map((emb, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => adotarEmbalagem(emb)}
                        className="w-full text-left p-2.5 hover:bg-blue-100 transition flex items-start gap-3"
                      >
                        <Package className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-lie-ink">
                            {emb.unidade}
                            {emb.capacidade > 0 && (
                              <span className="text-blue-700 ml-1">{emb.capacidade} {emb.siglaMedida}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-600 mt-0.5">
                            {emb.totalCotacoes} cotação(ões) • Mediana: <strong>{emb.estatisticas.mediano.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                            {' '}({emb.estatisticas.minimo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} a {emb.estatisticas.maximo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})
                          </div>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-green-600 opacity-0 group-hover:opacity-100 shrink-0" />
                      </button>
                    ))}
                  </div>
                  <div className="px-3 py-2 bg-blue-50 text-[10px] text-blue-800 italic border-t border-blue-100">
                    Ao adotar, preenche unidade, fator de conversão e sugere o preço pela mediana saneada.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                <div className="md:col-span-6">
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">Descrição da embalagem (humano)</label>
                  <input
                    type="text"
                    placeholder="Ex: Caixa com 48 copos de 200ml"
                    value={formData.embalagemDescricao || ''}
                    onChange={e => setFormData(p => ({ ...p, embalagemDescricao: e.target.value }))}
                    className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">Quantidade total</label>
                  <input
                    type="number" step="0.001" min={0}
                    placeholder="Ex: 9600"
                    value={formData.fatorConversao ?? ''}
                    onChange={e => setFormData(p => ({ ...p, fatorConversao: e.target.value ? Number(e.target.value) : undefined }))}
                    className="w-full border-gray-300 rounded-lg shadow-sm text-sm font-mono"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">48 × 200 = 9600</p>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">Unidade base</label>
                  <select
                    value={formData.unidadeBase || ''}
                    onChange={e => setFormData(p => ({ ...p, unidadeBase: e.target.value || undefined }))}
                    className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
                  >
                    <option value="">Selecione…</option>
                    <option value="ML">ML (mililitros)</option>
                    <option value="L">L (litros)</option>
                    <option value="G">G (gramas)</option>
                    <option value="KG">KG (quilogramas)</option>
                    <option value="UN">UN (unidades)</option>
                    <option value="M">M (metros)</option>
                    <option value="M²">M² (metro quadrado)</option>
                    <option value="M³">M³ (metro cúbico)</option>
                  </select>
                </div>
              </div>

              {/* Preview do cálculo */}
              {formData.fatorConversao && formData.unidadeBase && (formData.valorUnitario || 0) > 0 && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-green-900">
                    Preço base calculado:{' '}
                    <strong className="font-mono">
                      {((formData.valorUnitario || 0) / formData.fatorConversao).toFixed(4)}
                    </strong>{' '}
                    R$/{formData.unidadeBase.toLowerCase()}
                    {' '}— este valor será comparado contra a mediana saneada das cotações governamentais
                    na mesma unidade base.
                  </span>
                </div>
              )}
            </div>

            <div className="md:col-span-3 flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
              <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Salvando...' : 'Salvar no Banco'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
        <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[1000px]">
          <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('categoria')}>
                <div className="flex items-center gap-1">Categoria <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 w-20 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('codigo')}>
                <div className="flex items-center gap-1">Nº <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('nome')}>
                <div className="flex items-center gap-1">Item <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 hidden xl:table-cell">Descritivo</th>
              <th className="px-4 py-3 w-24 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('unidade')}>
                <div className="flex items-center gap-1">Unidade <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 w-32 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('valorUnitario')}>
                <div className="flex items-center gap-1 justify-end">$ Unitário <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 w-36 text-right" title="Mediana do mercado público (Compras.gov.br + PNCP)">
                <div className="flex items-center gap-1 justify-end">Mercado Gov</div>
              </th>
              <th className="px-4 py-3 w-24 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itensPaginados.map(it => (
              <tr key={it.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 rounded-full text-gray-600 uppercase">{it.categoria}</span>
                </td>
                <td className="px-4 py-3 text-sm font-mono text-gray-500">#{String(it.codigo).padStart(3, '0')}</td>
                <td className="px-4 py-3 font-bold text-lie-ink">
                  <div className="flex items-center gap-2">
                    {it.codigoCatmat ? (
                      <span
                        title={`${it.tipoCatmat === 'servico' ? 'CATSER' : 'CATMAT'} ${it.codigoCatmat} — ${it.nomeCatmatOficial || ''}`}
                        className="text-[9px] font-bold px-1.5 py-0.5 bg-green-100 text-green-800 border border-green-200 rounded shrink-0 uppercase tracking-wider"
                      >
                        ✓ {it.tipoCatmat === 'servico' ? 'CATSER' : 'CATMAT'}
                      </span>
                    ) : (
                      <span
                        title="Sem CATMAT/CATSER oficial — não entra na pesquisa automática de preços"
                        className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded shrink-0 uppercase tracking-wider"
                      >
                        ⚠ Sem CATMAT
                      </span>
                    )}
                    <span className="truncate">{it.nome}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate hidden xl:table-cell">{it.descricao || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{it.unidade}</td>
                <td className="px-4 py-3 text-sm font-bold text-right text-lie-ink">
                  {it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3 text-xs text-right">
                  {(() => {
                    const cod = it.codigoCatmat;

                    // Sem CATMAT — diferenciar 3 sub-estados: rota legal alternativa, RH, sem código
                    if (!cod) {
                      // 1. Item formalmente marcado como "sem CATMAT — rota de 3 orçamentos"
                      if (it.semCorrespondenciaCatalogo) {
                        return (
                          <span
                            className="text-[9px] text-purple-700 font-semibold leading-tight block text-right cursor-help"
                            title="Item sem correspondência no CATMAT/CATSER por design. Pesquisa de preço segue rota legal de 3 orçamentos com fornecedores (IN 73/2020 art. 5º IV ou IN 65/2021 art. 5º V)."
                          >
                            📑 3 orçamentos
                          </span>
                        );
                      }
                      // 2. Recurso Humano — sem licitação pública por natureza
                      const isRH = isRecursoHumano(it);
                      if (isRH) {
                        return (
                          <span className="text-[9px] text-gray-400 italic leading-tight block text-right">
                            N/A<br />Serv. Pessoal
                          </span>
                        );
                      }
                      // 3. Item sem código (falta vincular)
                      return (
                        <span
                          className="text-[9px] text-amber-600 font-semibold italic cursor-help"
                          title="Este item não tem código CATMAT/CATSER. Edite o item e vincule o código para habilitar a comparação de preços de mercado, ou marque-o como 'sem correspondência no catálogo' para usar a rota legal alternativa."
                        >
                          ⚠ sem CATMAT
                        </span>
                      );
                    }
                    const dados = mercado[cod];
                    if (mercadoCarregando.has(cod) && !dados) {
                      return (
                        <span className="text-gray-400 italic flex items-center justify-end gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> buscando…
                        </span>
                      );
                    }
                    if (dados && dados.totalCotacoes > 0) {
                      // Comparação justa quando user cadastrou fator de conversão
                      const temFator = !!(it.fatorConversao && it.fatorConversao > 0);
                      const precoBaseItem = temFator ? it.valorUnitario / it.fatorConversao! : it.valorUnitario;
                      // Preço de referência (saneado se disponível)
                      const precoRefGov = dados.saneamento?.precoReferencia ?? dados.estatisticas.mediano;
                      // Calcula referência base: se cotações têm capacidade, divide
                      const capacidadeGov = dados.unidadeDominante?.capacidade || 0;
                      const precoBaseGov = capacidadeGov > 0 ? precoRefGov / capacidadeGov : precoRefGov;

                      // Quando dá pra comparar em base unificada (item TEM fator E mercado TEM capacidade)
                      const podeCompararBase = temFator && capacidadeGov > 0
                        && it.unidadeBase?.toUpperCase() === dados.unidadeDominante?.siglaMedida?.toUpperCase();

                      const valorComparado = podeCompararBase ? precoBaseGov : precoRefGov;
                      const nossoValor = podeCompararBase ? precoBaseItem : it.valorUnitario;
                      const diff = ((nossoValor - valorComparado) / valorComparado) * 100;
                      const cor = diff > 20 ? 'text-red-600' : diff < -20 ? 'text-amber-600' : 'text-green-600';
                      const seta = diff > 5 ? '↑' : diff < -5 ? '↓' : '≈';

                      const diverge = !podeCompararBase && dados.unidadeDominante && it.unidade &&
                        !it.unidade.toLowerCase().includes(dados.unidadeDominante.unidade.toLowerCase().slice(0, 4));

                      const fmtPreco = (v: number) => v < 0.01
                        ? `R$ ${v.toFixed(4)}`
                        : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

                      return (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMercadoDetalhe({ item: it, dados }); }}
                          className={`group inline-flex flex-col items-end gap-0 hover:bg-blue-50 px-2 py-1 rounded transition ${diverge ? 'ring-1 ring-amber-300' : ''}`}
                          title={podeCompararBase
                            ? `Comparação em R$/${it.unidadeBase?.toLowerCase()}: você R$${precoBaseItem.toFixed(4)} vs mercado R$${precoBaseGov.toFixed(4)}`
                            : 'Clique pra ver cotações detalhadas e auditar saneamento'}
                        >
                          <span className="font-bold text-blue-700 flex items-baseline gap-1">
                            {fmtPreco(valorComparado)}
                            <span className="text-[9px] text-gray-500 font-normal">
                              /{podeCompararBase ? it.unidadeBase?.toLowerCase() : (dados.unidadeDominante?.unidade?.toLowerCase() || 'un')}
                            </span>
                          </span>
                          <span className="text-[9px] text-gray-500 font-medium uppercase tracking-wider">
                            {dados.saneamento ? `${dados.saneamento.cotacoesIncluidas}/${dados.totalCotacoes} saneadas` : `${dados.totalCotacoes} cotações`}
                          </span>
                          {diverge ? (
                            <span className="text-[9px] font-bold text-amber-700">⚠ unidade difere</span>
                          ) : (
                            <span className={`text-[9px] font-bold ${cor}`}>
                              {seta} {Math.abs(diff).toFixed(0)}% vs nosso
                            </span>
                          )}
                        </button>
                      );
                    }
                    if (dados && dados.totalCotacoes === 0) {
                      return <span className="text-amber-600 text-[10px] italic">sem cotação</span>;
                    }
                    return <span className="text-gray-300 italic">…</span>;
                  })()}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {confirmDeleteId === it.id ? (
                      <>
                        <span className="text-xs text-red-600 font-semibold mr-1">Excluir?</span>
                        <button
                          onClick={() => handleDelete(it.id)}
                          className="px-2 py-1 bg-red-500 text-white text-xs font-bold rounded hover:bg-red-600 transition"
                        >
                          Sim
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 bg-gray-200 text-gray-700 text-xs font-bold rounded hover:bg-gray-300 transition"
                        >
                          Não
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setPesquisaItem(it)}
                          className={`p-1.5 rounded transition ${it.pesquisado ? 'text-lie-green hover:bg-lie-green/10' : 'text-amber-500 hover:bg-amber-50'}`}
                          title={it.pesquisado ? 'Pesquisa de Preços realizada — clique para refazer/adicionar cotações' : 'Pesquisa de Preços Públicos (IN 65/2021)'}
                        >
                          <Scale className="w-4 h-4" />
                        </button>
                        {it.pesquisado && it.tokenPesquisa && (
                          <a
                            href={`/#/validar?token=${it.tokenPesquisa}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition flex items-center justify-center"
                            title="Visualizar Certificado da Pesquisa (vale pra todos os projetos)"
                          >
                            <Eye className="w-4 h-4" />
                          </a>
                        )}
                        <button onClick={() => openEdit(it)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition" title="Editar">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setConfirmDeleteId(it.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {sortedItems.length === 0 && (
          <div className="p-12 text-center text-lie-gray italic">Nenhum item encontrado.</div>
        )}

        {/* Paginação */}
        {totalItens > 0 && (
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-gray-600">
              Mostrando <strong>{offsetIni + 1}</strong>–<strong>{Math.min(offsetIni + tamanhoPagina, totalItens)}</strong> de <strong>{totalItens}</strong> item(ns)
            </div>

            <div className="flex items-center gap-2">
              <label className="text-gray-500">Por página:</label>
              <select
                value={tamanhoPagina}
                onChange={e => setTamanhoPagina(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:ring-lie-green focus:border-lie-green"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>Todos</option>
              </select>
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPaginaAtual(1)}
                  disabled={paginaSegura === 1}
                  className="px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Primeira página"
                >
                  «
                </button>
                <button
                  onClick={() => setPaginaAtual(p => Math.max(1, p - 1))}
                  disabled={paginaSegura === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Anterior
                </button>
                <span className="px-3 py-1 bg-lie-green text-white rounded font-bold">
                  {paginaSegura} <span className="font-normal opacity-70">de {totalPaginas}</span>
                </span>
                <button
                  onClick={() => setPaginaAtual(p => Math.min(totalPaginas, p + 1))}
                  disabled={paginaSegura === totalPaginas}
                  className="px-3 py-1 border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Próximo
                </button>
                <button
                  onClick={() => setPaginaAtual(totalPaginas)}
                  disabled={paginaSegura === totalPaginas}
                  className="px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Última página"
                >
                  »
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== MODAL DE VALIDAÇÃO CATMAT EM LOTE ===== */}
      <ValidacaoCatmatLoteModal
        isOpen={validacaoLoteOpen}
        onClose={() => setValidacaoLoteOpen(false)}
        items={items}
        onAtualizado={carregarItens}
      />

      {/* ===== MODAL DE PESQUISA DE PREÇO (Banco) ===== */}
      {pesquisaItem && (
        <PesquisaPrecoModal
          isOpen={true}
          onClose={() => setPesquisaItem(null)}
          item={{ ...pesquisaItem, __origem: 'banco' as const }}
          projetoTitulo={undefined}
          entidadeNome={undefined}
          onSave={() => { carregarItens(); }}
        />
      )}

      {/* ===== MODAL DE DETALHE DE MERCADO ===== */}
      {mercadoDetalhe && (
        <MercadoDetalheModal
          item={mercadoDetalhe.item}
          dados={mercadoDetalhe.dados}
          onClose={() => setMercadoDetalhe(null)}
          onAtualizar={(novo) => {
            setMercado(prev => ({ ...prev, [novo.codigoCatmat]: novo }));
            setMercadoDetalhe(prev => prev ? { ...prev, dados: novo } : null);
          }}
          onAdotarEmbalagem={(emb, razao) => handleAdotarEmbalagemModal(mercadoDetalhe.item, emb, razao)}
        />
      )}

      {/* ===== MODAL DE LIMPEZA DE DUPLICATAS ===== */}
      {limpezaOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-zoom-in">
            <header className="bg-lie-ink p-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500 rounded-lg">
                  <Wand2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold">Limpar Itens Duplicados</h3>
                  <p className="text-xs text-gray-300">
                    {analisando ? 'Analisando banco de itens e cruzando com projetos…' :
                     excluidos !== null ? `Concluído: ${excluidos} item(s) excluído(s).` :
                     grupos.length === 0 ? 'Nenhum grupo de duplicatas encontrado.' :
                     `${grupos.length} grupo(s) de duplicatas — ${grupos.reduce((a, g) => a + g.paraExcluir.length, 0)} item(s) serão excluídos.`}
                  </p>
                </div>
              </div>
              {!analisando && !excluindo && (
                <button onClick={() => setLimpezaOpen(false)} className="hover:bg-white/10 p-2 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              )}
            </header>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {analisando && (
                <div className="flex flex-col items-center py-10 text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin text-red-500 mb-3" />
                  <p className="text-sm">Carregando masters e percorrendo projetos…</p>
                </div>
              )}

              {!analisando && excluidos === null && grupos.length === 0 && (
                <div className="p-6 text-center text-green-700 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                  <p className="font-bold">Banco está limpo!</p>
                  <p className="text-xs mt-1">Nenhum grupo de itens com mesmo nome foi encontrado.</p>
                </div>
              )}

              {!analisando && excluidos === null && grupos.length > 0 && (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex gap-2 leading-relaxed">
                    <ShieldAlert className="w-5 h-5 shrink-0 text-amber-600" />
                    <div>
                      <strong>Regra aplicada:</strong> itens com mesmo nome (normalizado) são considerados
                      duplicatas. Pra cada grupo:
                      <ul className="list-disc ml-5 mt-1 space-y-0.5">
                        <li>Se houver pelo menos 1 em uso por projetos → mantém todos os em uso, exclui órfãos.</li>
                        <li>Se nenhum estiver em uso → mantém o de menor código, exclui o resto.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                    {grupos.map((g) => (
                      <div key={g.nomeNormalizado} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div className="font-bold text-sm text-lie-ink mb-2">{g.nomeNormalizado}</div>
                        <div className="space-y-1">
                          {g.paraManter.map(it => (
                            <div key={it.id} className="flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5">
                              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                              <span className="font-mono text-gray-500">#{String(it.codigo || 0).padStart(3, '0')}</span>
                              <span className="flex-1 truncate">{it.nome} · {it.unidade}</span>
                              <span className="text-[10px] font-bold uppercase text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                                {it.projetosUsando > 0 ? `Em uso (${it.projetosUsando})` : 'Mantido (menor #)'}
                              </span>
                            </div>
                          ))}
                          {g.paraExcluir.map(it => (
                            <div key={it.id} className="flex items-center gap-2 text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
                              <Trash2 className="w-4 h-4 text-red-600 shrink-0" />
                              <span className="font-mono text-gray-500">#{String(it.codigo || 0).padStart(3, '0')}</span>
                              <span className="flex-1 truncate">{it.nome} · {it.unidade}</span>
                              <span className="text-[10px] font-bold uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                                Excluir
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {excluidos !== null && (
                <div className="p-6 text-center text-green-700 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                  <p className="font-bold">{excluidos} item(s) excluído(s) com sucesso!</p>
                  <p className="text-xs mt-1">O backup JSON foi baixado antes da exclusão.</p>
                </div>
              )}
            </div>

            {!analisando && excluidos === null && grupos.length > 0 && (
              <div className="p-4 bg-gray-50 border-t flex flex-wrap gap-3 items-center justify-between">
                <button
                  onClick={baixarBackup}
                  className={`flex items-center gap-2 px-4 py-2 font-bold rounded-lg transition ${
                    backupBaixado ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {backupBaixado ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                  {backupBaixado ? 'Backup baixado' : 'Baixar backup JSON'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLimpezaOpen(false)}
                    className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={executarExclusao}
                    disabled={!backupBaixado || excluindo}
                    className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {excluindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {excluindo ? 'Excluindo…' : `Excluir ${grupos.reduce((a, g) => a + g.paraExcluir.length, 0)} item(s)`}
                  </button>
                </div>
              </div>
            )}

            {(analisando || excluindo || excluidos !== null) && (
              <div className="p-4 bg-gray-50 border-t flex justify-end">
                <button
                  onClick={() => setLimpezaOpen(false)}
                  disabled={analisando || excluindo}
                  className="px-5 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark disabled:opacity-50"
                >
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
