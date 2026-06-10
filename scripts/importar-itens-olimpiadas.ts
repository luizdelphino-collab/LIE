/**
 * scripts/importar-itens-olimpiadas.ts
 *
 * Importa os 52 itens do arquivo itens_olimpiadas.json para a coleção
 * Firestore `items`, vinculando automaticamente CATMATs/CATSERs quando
 * disponíveis no seed local.
 *
 * Uso:
 *   npx ts-node --project tsconfig.json scripts/importar-itens-olimpiadas.ts
 *   npx ts-node --project tsconfig.json scripts/importar-itens-olimpiadas.ts --dry-run
 *   npx ts-node --project tsconfig.json scripts/importar-itens-olimpiadas.ts --force  # sobrescreve existentes
 *
 * O script:
 *   1. Lê o JSON com os 52 itens
 *   2. Para cada item, tenta casar com o seed CATMAT/CATSER local
 *   3. Verifica se já existe no Firestore (por nome normalizado)
 *   4. Cria ou atualiza conforme flags
 *   5. Emite relatório final
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

// ── Firebase init ──────────────────────────────────────────────────────────
if (!admin.apps.length) {
  const sa = process.env.SERVICE_ACCOUNT_PATH;
  if (sa && fs.existsSync(sa)) {
    admin.initializeApp({ credential: admin.credential.cert(require(sa)) });
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.VITE_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      })
    });
  }
}
const db = admin.firestore();

// ── Seed CATMAT/CATSER (espelho do lib/apiCompras.ts) ──────────────────────
interface SeedEntry {
  codigoItem: number;
  nome: string;
  nomesAlternativos?: string[];
  descricaoItem: string;
  tipo: 'material' | 'servico';
  categoria: string;
  unidade: string;
}

const SEED: SeedEntry[] = [
  // Materiais
  { codigoItem: 418193, nome: "BOLA VOLEIBOL",         nomesAlternativos: ["bola de voleibol","bola volei"],                                tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA VOLEIBOL, MICROFIBRA, PESO 260-280G" },
  { codigoItem: 447814, nome: "BOLA FUTSAL",            nomesAlternativos: ["bola de futsal"],                                               tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA FUTSAL, POLIURETANO, PESO 400-440G" },
  { codigoItem: 437936, nome: "BOLA BASQUETE",          nomesAlternativos: ["bola de basquete","bola basquete 3x3"],                         tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA BASQUETE, BORRACHA, PESO 600-650G" },
  { codigoItem: 423984, nome: "BOLA FUTEBOL DE CAMPO",  nomesAlternativos: ["bola futebol","bola campo"],                                    tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA FUTEBOL CAMPO, POLIURETANO" },
  { codigoItem: 458231, nome: "BOLA HANDEBOL",          nomesAlternativos: ["bola de handebol"],                                             tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA HANDEBOL, COURO SINTÉTICO" },
  { codigoItem: 461052, nome: "BOLA TÊNIS DE MESA",     nomesAlternativos: ["bolinha ping pong","bolinha tenis de mesa"],                    tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA TÊNIS DE MESA, PLÁSTICO ABS" },
  { codigoItem: 455129, nome: "BOLA FUTMESA",           nomesAlternativos: ["bola de futmesa"],                                              tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "BOLA FUTMESA, BORRACHA EVA" },
  { codigoItem: 349104, nome: "REDE VOLEIBOL",          nomesAlternativos: ["rede de voleibol"],                                             tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "REDE VOLEIBOL, NYLON" },
  { codigoItem: 389104, nome: "REDE FUTSAL",            nomesAlternativos: ["rede de futsal","rede gol futsal"],                             tipo: 'material', categoria: "Material Esportivo",      unidade: "par",        descricaoItem: "REDE FUTSAL, POLIETILENO" },
  { codigoItem: 329048, nome: "REDE BASQUETE",          nomesAlternativos: ["redinha basquete"],                                             tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "REDE BASQUETE, NYLON" },
  { codigoItem: 414822, nome: "UNIFORME ESPORTIVO",     nomesAlternativos: ["kit uniforme","conjunto esportivo","uniforme competição"],       tipo: 'material', categoria: "Material Esportivo",      unidade: "conjunto",   descricaoItem: "UNIFORME ESPORTIVO, POLIÉSTER DRY-FIT" },
  { codigoItem: 409123, nome: "CAMISETA ESPORTIVA",     nomesAlternativos: ["camiseta","camisetas"],                                         tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "CAMISETA ESPORTIVA, DRY-FIT" },
  { codigoItem: 431870, nome: "KIMONO",                 nomesAlternativos: ["kimono judô"],                                                  tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "KIMONO JUDÔ, ALGODÃO" },
  { codigoItem: 367123, nome: "COLETES",                nomesAlternativos: ["colete","colete esportivo"],                                    tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "COLETE ESPORTIVO DUPLA FACE" },
  { codigoItem: 442853, nome: "MEDALHAS",               nomesAlternativos: ["medalha","medalha esportiva","medalha de honra com estojo"],    tipo: 'material', categoria: "Material não Esportivo",  unidade: "unidade",    descricaoItem: "MEDALHA METÁLICA COM FITA" },
  { codigoItem: 447291, nome: "TROFÉUS",                nomesAlternativos: ["troféu","trofeu"],                                              tipo: 'material', categoria: "Material não Esportivo",  unidade: "unidade",    descricaoItem: "TROFÉU ESPORTIVO, POLIPROPILENO" },
  { codigoItem: 379123, nome: "CONE SINALIZADOR",       nomesAlternativos: ["cone"],                                                         tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "CONE SINALIZAÇÃO, PVC" },
  { codigoItem: 445484, nome: "ÁGUA MINERAL",           nomesAlternativos: ["água","agua","água (caixa 48 copos)"],                          tipo: 'material', categoria: "Alimento",                unidade: "unidade",    descricaoItem: "ÁGUA MINERAL NATURAL SEM GÁS, 500ML" },
  { codigoItem: 438972, nome: "KIT LANCHE",             nomesAlternativos: ["lanche","alimentação completa","alimentacao"],                  tipo: 'material', categoria: "Alimento",                unidade: "unidade",    descricaoItem: "KIT LANCHE/REFEIÇÃO EMBALADO" },
  { codigoItem: 463291, nome: "CERTIFICADOS",           nomesAlternativos: ["certificado","certificados de participação","súmulas","sumulas"],tipo: 'material', categoria: "Material não Esportivo",  unidade: "unidade",    descricaoItem: "CERTIFICADO DE PARTICIPAÇÃO, PAPEL COUCHÊ" },
  { codigoItem: 461830, nome: "BACKDROP",               nomesAlternativos: ["back drop","banner","lona"],                                    tipo: 'material', categoria: "Material não Esportivo",  unidade: "metro²",     descricaoItem: "BACKDROP LONA VINÍLICA, IMPRESSÃO DIGITAL" },
  { codigoItem: 459104, nome: "WINDBANNER",             nomesAlternativos: ["windbanner","wind banner","banner"],                            tipo: 'material', categoria: "Material não Esportivo",  unidade: "unidade",    descricaoItem: "WINDBANNER, ESTRUTURA ALUMÍNIO + TECIDO" },
  { codigoItem: 457832, nome: "PLACAR DE MESA",         nomesAlternativos: ["placar","placar de mesa"],                                      tipo: 'material', categoria: "Material Esportivo",      unidade: "unidade",    descricaoItem: "PLACAR DE MESA, MANUAL" },
  { codigoItem: 453821, nome: "TATAME",                 nomesAlternativos: ["tatami","locação de tatames"],                                  tipo: 'material', categoria: "Material Esportivo",      unidade: "metro²",     descricaoItem: "TATAME EVA, 20MM" },
  // Serviços
  { codigoItem: 25682,  nome: "ARBITRAGEM ESPORTIVA",   nomesAlternativos: ["arbitragem","equipe de arbitragem","arbitragem - coletivas","anotador","anotador - interceus","anotador - olimpíadas"], tipo: 'servico', categoria: "Recurso Humano", unidade: "diária", descricaoItem: "SERVIÇO DE ARBITRAGEM ESPORTIVA" },
  { codigoItem: 20062,  nome: "LOCAÇÃO DE ÔNIBUS",      nomesAlternativos: ["ônibus","onibus","ônibus/van","van","transporte","gerenciamento de transporte"], tipo: 'servico', categoria: "Transporte", unidade: "diária", descricaoItem: "LOCAÇÃO DE ÔNIBUS COM MOTORISTA" },
  { codigoItem: 17612,  nome: "COORDENADOR DE EVENTO",  nomesAlternativos: ["coordenador","coordenador acadêmico","coordenador geral da modalidade","coordenadores fedeesp","coordenadores fedeesp - interceus","coordenadores fedeesp - olimpíadas"], tipo: 'servico', categoria: "Recurso Humano", unidade: "diária", descricaoItem: "SERVIÇO DE COORDENAÇÃO DE EVENTOS" },
  { codigoItem: 17620,  nome: "PROFESSOR",              nomesAlternativos: ["professor de educação física","técnico","monitor","equipe de monitoria"], tipo: 'servico', categoria: "Recurso Humano", unidade: "diária", descricaoItem: "SERVIÇO DE DOCÊNCIA/MONITORIA ESPORTIVA" },
  { codigoItem: 17639,  nome: "REPRESENTANTE",          nomesAlternativos: ["representantes - coletivas","secretaria e atendentes","atendente","secretaria"], tipo: 'servico', categoria: "Recurso Humano", unidade: "diária", descricaoItem: "SERVIÇO DE REPRESENTAÇÃO E SECRETARIADO" },
  { codigoItem: 17647,  nome: "SOCORRISTA",             nomesAlternativos: ["socorristas","ambulância","ambulância uti","ambulancia","ambulância básica"], tipo: 'servico', categoria: "Outro", unidade: "evento", descricaoItem: "SERVIÇO DE SUPORTE MÉDICO DE EMERGÊNCIA" },
  { codigoItem: 17655,  nome: "PROFISSIONAL DE SEGURANÇA", nomesAlternativos: ["segurança","vigilante"],                                    tipo: 'servico', categoria: "Recurso Humano", unidade: "diária", descricaoItem: "SERVIÇO DE SEGURANÇA PATRIMONIAL" },
  { codigoItem: 17663,  nome: "PROFISSIONAL DE LIMPEZA",nomesAlternativos: ["limpeza","auxiliar de limpeza"],                                tipo: 'servico', categoria: "Recurso Humano", unidade: "diária", descricaoItem: "SERVIÇO DE LIMPEZA E CONSERVAÇÃO" },
  { codigoItem: 17671,  nome: "LOCUTOR",                nomesAlternativos: ["locução","locutor","intérprete do mascote","interprete do mascote","mascote","apresentador"], tipo: 'servico', categoria: "Recurso Humano", unidade: "evento", descricaoItem: "SERVIÇO DE LOCUÇÃO E ANIMAÇÃO DE EVENTOS" },
  { codigoItem: 22586,  nome: "FOTOGRAFIA E FILMAGEM",  nomesAlternativos: ["foto","filmagem","cobertura foto e filmagem","cobertura jornalística","vídeo institucional","foto giratória 360","transmissão ao vivo"], tipo: 'servico', categoria: "Outro", unidade: "evento", descricaoItem: "SERVIÇO DE FOTOGRAFIA E FILMAGEM" },
  { codigoItem: 22594,  nome: "MONTAGEM E DESMONTAGEM", nomesAlternativos: ["montagem","montagem e desmontagem de eventos","palco praticável","palco","box truss","painel polionda"], tipo: 'servico', categoria: "Outro", unidade: "evento", descricaoItem: "SERVIÇO DE MONTAGEM E DESMONTAGEM DE EVENTOS" },
  { codigoItem: 22608,  nome: "SOM E AUDIOVISUAL",      nomesAlternativos: ["equipamento de som","som","recurso áudio-visual","audiovisual","painel de led","painel led","placar eletrônico natação"], tipo: 'servico', categoria: "Material não Esportivo", unidade: "evento", descricaoItem: "LOCAÇÃO DE SOM, AUDIOVISUAL E ILUMINAÇÃO" },
  { codigoItem: 22616,  nome: "SISTEMA ONLINE",         nomesAlternativos: ["sistema de inscrições on-line","sistema de inscrições","website","site","plataforma"], tipo: 'servico', categoria: "Outro", unidade: "evento", descricaoItem: "SISTEMA DE INSCRIÇÕES E PLATAFORMA DIGITAL" },
  { codigoItem: 22624,  nome: "PLACA DE HOMENAGEM",     nomesAlternativos: ["placa","placa de homenagem"],                                   tipo: 'servico', categoria: "Material não Esportivo", unidade: "unidade", descricaoItem: "CONFECÇÃO DE PLACA DE HOMENAGEM" },
  { codigoItem: 22632,  nome: "FIGURINO MASCOTE",       nomesAlternativos: ["figurino","produção de figurino mascote ic","produção de figurino mascote oe","mascote"], tipo: 'servico', categoria: "Material não Esportivo", unidade: "unidade", descricaoItem: "PRODUÇÃO DE FIGURINO/FANTASIA DE MASCOTE" },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function encontrarMatch(nome: string): SeedEntry | null {
  const nNorm = norm(nome);
  const palavras = nNorm.split(/\s+/).filter(p => p.length >= 3);
  let melhor: { s: SeedEntry; score: number } | null = null;

  for (const s of SEED) {
    const aliases = [s.nome, ...(s.nomesAlternativos || [])].map(norm);
    const texto = aliases.join(' ') + ' ' + norm(s.descricaoItem);

    if (aliases.some(a => a === nNorm || a.includes(nNorm) || nNorm.includes(a))) {
      return s; // exato
    }
    if (palavras.length >= 2 && palavras.every(p => texto.includes(p))) {
      if (!melhor || 0.85 > melhor.score) melhor = { s, score: 0.85 };
    }
  }
  return melhor?.s || null;
}

// Normaliza categoria do JSON para o tipo usado no Firestore
function normCat(c: string): string {
  const m: Record<string, string> = {
    'alimento': 'Alimento',
    'material esportivo': 'Material Esportivo',
    'material não esportivo': 'Material não Esportivo',
    'recurso humano': 'Recurso Humano',
    'transporte': 'Transporte',
    'outro': 'Outro',
  };
  return m[c.toLowerCase()] || c;
}

function normUnidade(u: string): string {
  const m: Record<string, string> = {
    'unidade': 'unidade', 'unidades': 'unidade',
    'evento': 'evento', 'eventos': 'evento',
    'diária': 'diária', 'diaria': 'diária', 'diárias': 'diária',
    'mês': 'mês', 'mes': 'mês', 'meses': 'mês',
    'kit': 'kit', 'kits': 'kit',
    'caixa': 'caixa',
    'metro²': 'metro²', 'metro2': 'metro²', 'm²': 'metro²',
  };
  return m[u.toLowerCase()] || u.toLowerCase();
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`LIE — Importar itens_olimpiadas.json | ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);
  console.log(`${'='.repeat(70)}\n`);

  // Ler JSON
  const jsonPath = path.resolve(__dirname, '../itens_olimpiadas.json');
  const olimp: any[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Itens no JSON: ${olimp.length}\n`);

  // Buscar itens existentes no Firestore
  const snapExist = await db.collection('items').get();
  const existentes = new Map<string, string>(); // nomeNorm → id
  let maxCodigo = 0;
  snapExist.docs.forEach(d => {
    const data = d.data() as any;
    existentes.set(norm(data.nome || ''), d.id);
    if ((data.codigo || 0) > maxCodigo) maxCodigo = data.codigo;
  });
  console.log(`Itens existentes no Firestore: ${existentes.size} (max código: ${maxCodigo})\n`);

  let criados = 0, atualizados = 0, ignorados = 0, semMatch = 0;
  const batch = db.batch();
  let batchCount = 0;
  let proximoCodigo = maxCodigo + 1;

  for (const it of olimp) {
    const nome: string = it['Item'] || it['nome'] || '';
    const categoria = normCat(it['Categoria'] || it['categoria'] || 'Outro');
    const unidade = normUnidade(it['Unidade'] || it['unidade'] || 'unidade');
    const valorUnitario = Number(it['Valor Unitário'] || it['valorUnitario'] || 0);
    const descricao = it['Descrição'] || it['descricao'] || '';
    const memorial = it['Memorial de Cálculo'] || it['memorialCalculo'] || '';

    if (!nome) { console.log('  ⚠ Item sem nome — ignorado'); continue; }

    const nomeNorm = norm(nome);
    const idExistente = existentes.get(nomeNorm);

    if (idExistente && !FORCE) {
      ignorados++;
      console.log(`  = [JÁ EXISTE] ${nome}`);
      continue;
    }

    // Match CATMAT/CATSER
    const match = encontrarMatch(nome);
    const catmatInfo = match ? {
      codigoCatmat: match.codigoItem,
      tipoCatmat: match.tipo,
      nomeCatmatOficial: match.nome,
      descricaoCatmatOficial: match.descricaoItem,
    } : {};

    const payload: any = {
      nome: nome.toUpperCase(),
      categoria,
      unidade,
      valorUnitario,
      descricao,
      memorialCalculo: memorial,
      ...catmatInfo,
    };

    if (idExistente && FORCE) {
      // Atualizar existente
      const ref = db.collection('items').doc(idExistente);
      batch.update(ref, payload);
      atualizados++;
      console.log(`  ↑ [ATUALIZADO] ${nome}${match ? ` → CATMAT ${match.codigoItem}` : ' → SEM CATMAT'}`);
    } else {
      // Criar novo
      payload.codigo = proximoCodigo++;
      payload.criadoEm = admin.firestore.FieldValue.serverTimestamp();
      const ref = db.collection('items').doc();
      payload.id = ref.id;
      batch.set(ref, payload);
      criados++;
      console.log(`  + [CRIADO] ${nome}${match ? ` → CATMAT ${match.codigoItem}` : ' → SEM CATMAT'}`);
    }

    if (!match) semMatch++;
    batchCount++;

    if (batchCount >= 490) {
      if (!DRY_RUN) await batch.commit();
      batchCount = 0;
    }
  }

  if (!DRY_RUN && batchCount > 0) await batch.commit();

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Criados    : ${criados}`);
  console.log(`Atualizados: ${atualizados}`);
  console.log(`Ignorados  : ${ignorados} (já existiam; use --force para atualizar)`);
  console.log(`Sem CATMAT : ${semMatch} (vincular manualmente no LIE → Itens → Editar)`);
  console.log(`${'─'.repeat(70)}\n`);

  if (DRY_RUN) console.log('(DRY-RUN: nenhuma alteração gravada)');
  else console.log('✅ Firestore atualizado.');
  process.exit(0);
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
