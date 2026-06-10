/**
 * scripts/seed-catmat-firestore.ts
 *
 * Vincula automaticamente códigos CATMAT/CATSER oficiais a todos os itens
 * do banco Firestore que ainda não têm codigoCatmat cadastrado.
 *
 * Estratégia de match:
 *   1. Correspondência exata de nome (case-insensitive, sem acento)
 *   2. Correspondência por palavras-chave (todas as palavras do nome do item
 *      presentes em algum alias do seed)
 *   3. Score de similaridade Dice (fallback pra nomes parcialmente diferentes)
 *
 * Uso:
 *   npx ts-node --project tsconfig.json scripts/seed-catmat-firestore.ts
 *   (Precisa do .env configurado com VITE_FIREBASE_* ou SERVICE_ACCOUNT_PATH)
 *
 * Saída:
 *   - Tabela no terminal com: item, CATMAT encontrado, score, ação tomada
 *   - Atualiza o Firestore somente nos itens sem CATMAT (--dry-run pra simular)
 *
 * FLAGS:
 *   --dry-run       Mostra o que seria feito sem gravar no Firestore
 *   --force         Atualiza MESMO em itens que já têm CATMAT (cuidado!)
 *   --min-score 0.7 Score mínimo de similaridade (padrão: 0.6)
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// ── Configuração ───────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');
const MIN_SCORE = (() => {
  const idx = process.argv.indexOf('--min-score');
  return idx !== -1 ? parseFloat(process.argv[idx + 1]) : 0.6;
})();

// Inicializa Firebase Admin
if (!admin.apps.length) {
  const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
  } else {
    // Usa variáveis VITE_FIREBASE_* do .env como fallback
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

// ── Seed CATMAT (espelho do lib/apiCompras.ts) ─────────────────────────────
// Mantemos aqui para não importar o módulo frontend (dependências browser)

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
  { codigoItem: 418193, nome: "BOLA VOLEIBOL",       nomesAlternativos: ["bola de voleibol","bola volei","bola vôlei"],                    descricaoItem: "BOLA VOLEIBOL, MATERIAL: COURO SINTÉTICO (MICROFIBRA), PESO: 260 A 280 G",  tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 447814, nome: "BOLA FUTSAL",          nomesAlternativos: ["bola de futsal","bola futsal adulto"],                             descricaoItem: "BOLA FUTSAL, MATERIAL: POLIURETANO (PU), PESO: 400 A 440 G",                tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 437936, nome: "BOLA BASQUETE",        nomesAlternativos: ["bola de basquete","bola basketball","bola basquete 3x3"],          descricaoItem: "BOLA BASQUETE, MATERIAL: BORRACHA, PESO: 600 A 650 G",                    tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 423984, nome: "BOLA FUTEBOL DE CAMPO",nomesAlternativos: ["bola futebol","bola de futebol","bola campo"],                    descricaoItem: "BOLA FUTEBOL CAMPO, MATERIAL: POLIURETANO (PU)",                           tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 458231, nome: "BOLA HANDEBOL",        nomesAlternativos: ["bola de handebol","bola handball","handebol"],                    descricaoItem: "BOLA HANDEBOL, MATERIAL: COURO SINTÉTICO",                                  tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 461052, nome: "BOLA TÊNIS DE MESA",   nomesAlternativos: ["bolinha tênis de mesa","bolinha ping pong","bola ping pong","bolinha de tenis de mesa"], descricaoItem: "BOLA TÊNIS DE MESA, MATERIAL: PLÁSTICO ABS, DIÂMETRO: 40 MM", tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 455129, nome: "BOLA FUTMESA",         nomesAlternativos: ["bola de futmesa"],                                                descricaoItem: "BOLA FUTMESA, MATERIAL: BORRACHA EVA",                                     tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 349104, nome: "REDE VOLEIBOL",        nomesAlternativos: ["rede de voleibol","rede vôlei","rede para voleibol"],              descricaoItem: "REDE VOLEIBOL, MATERIAL: NYLON FIO 2,5 MM",                                tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 389104, nome: "REDE FUTSAL",          nomesAlternativos: ["rede de futsal","rede gol futsal","rede para gol de futsal"],      descricaoItem: "REDE BALIZA FUTSAL, MATERIAL: POLIETILENO",                                tipo: 'material', categoria: "Material Esportivo", unidade: "par"     },
  { codigoItem: 329048, nome: "REDE BASQUETE",        nomesAlternativos: ["redinha basquete","rede de basquete"],                            descricaoItem: "REDE BASQUETE, MATERIAL: NYLON DE ALTA RESISTÊNCIA",                      tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 414822, nome: "UNIFORME ESPORTIVO",   nomesAlternativos: ["kit uniforme","conjunto esportivo","uniforme competição","uniforme de competição","uniforme voleibol","uniforme wrestling"], descricaoItem: "UNIFORME ESPORTIVO, MATERIAL: 100% POLIÉSTER DRY-FIT", tipo: 'material', categoria: "Material Esportivo", unidade: "conjunto" },
  { codigoItem: 409123, nome: "CAMISETA ESPORTIVA",   nomesAlternativos: ["camiseta dry fit","camiseta uniforme","camisa esportiva","camisetas"], descricaoItem: "CAMISETA ESPORTIVA, MATERIAL: 100% POLIÉSTER DRY-FIT", tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 416504, nome: "CALÇÃO ESPORTIVO",     nomesAlternativos: ["shorts esportivo","calção uniforme","bermuda esportiva"],          descricaoItem: "CALÇÃO ESPORTIVO, MATERIAL: 100% POLIÉSTER DRY-FIT",                    tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 431870, nome: "KIMONO",               nomesAlternativos: ["kimono judô","judogi","quimono"],                                 descricaoItem: "KIMONO JUDÔ, MATERIAL: ALGODÃO 100%",                                      tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 367123, nome: "COLETES",              nomesAlternativos: ["colete esportivo","colete treino","colete identificador","colete dupla face"], descricaoItem: "COLETE ESPORTIVO DUPLA FACE, MATERIAL: 100% POLIÉSTER", tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 442853, nome: "MEDALHAS",             nomesAlternativos: ["medalha","medalha esportiva","medalha de honra com estojo"],       descricaoItem: "MEDALHA METÁLICA, MATERIAL: ZAMAK/LATÃO",                                  tipo: 'material', categoria: "Material não Esportivo", unidade: "unidade" },
  { codigoItem: 447291, nome: "TROFÉU",               nomesAlternativos: ["trofeu","troféu esportivo","troféu metálico","troféu acrílico"],   descricaoItem: "TROFÉU ESPORTIVO, MATERIAL: POLIPROPILENO/ACRÍLICO COM BASE",            tipo: 'material', categoria: "Material não Esportivo", unidade: "unidade" },
  { codigoItem: 443621, nome: "APITO ARBITRAGEM",     nomesAlternativos: ["apito árbitro","apito de árbitro","apito esportivo"],              descricaoItem: "APITO ESPORTIVO, MATERIAL: PLÁSTICO ABS",                                  tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 448109, nome: "CRONÔMETRO DIGITAL",   nomesAlternativos: ["cronometro digital","cronômetro esportivo"],                       descricaoItem: "CRONÔMETRO DIGITAL, MODELO ESPORTIVO",                                    tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 379123, nome: "CONE SINALIZADOR",     nomesAlternativos: ["cone de sinalização","cone treino","cone treinamento"],            descricaoItem: "CONE SINALIZAÇÃO/TREINAMENTO, MATERIAL: PVC FLEXÍVEL",                    tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 453821, nome: "TATAME",               nomesAlternativos: ["tatami","colchão tatame","locação de tatames","tatames"],          descricaoItem: "TATAME EVA DUPLA FACE, ESPESSURA: 20 MM",                                  tipo: 'material', categoria: "Material Esportivo", unidade: "metro²"  },
  { codigoItem: 455714, nome: "COLCHÃO GINÁSTICA",    nomesAlternativos: ["colchão de ginástica","colchonete ginástica","colchão atletismo"],  descricaoItem: "COLCHÃO GINÁSTICA, MATERIAL: ESPUMA REVESTIDA",                           tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 451036, nome: "NÚMERO DE PEITO",      nomesAlternativos: ["dorsal","número atleta","faixa peito","faixa identificação","faixa de identificação"], descricaoItem: "NÚMERO DE PEITO (DORSAL), MATERIAL: PAPEL PLASTIFICADO", tipo: 'material', categoria: "Material Esportivo", unidade: "unidade" },
  { codigoItem: 445484, nome: "ÁGUA MINERAL",         nomesAlternativos: ["água mineral sem gás","água sem gás","água copo","água (caixa 48 copos)"], descricaoItem: "ÁGUA MINERAL NATURAL SEM GÁS, GARRAFA 500 ML", tipo: 'material', categoria: "Alimento", unidade: "unidade" },
  { codigoItem: 438972, nome: "KIT LANCHE",           nomesAlternativos: ["lanche","kit lanche tipo 1","kit lanche tipo 2","alimentação completa","refeição"], descricaoItem: "KIT LANCHE/REFEIÇÃO EMBALADO", tipo: 'material', categoria: "Alimento", unidade: "unidade" },
  { codigoItem: 441209, nome: "CAFÉ DA MANHÃ",        nomesAlternativos: ["cafe da manha","café manhã","desjejum"],                           descricaoItem: "REFEIÇÃO CAFÉ DA MANHÃ",                                                   tipo: 'material', categoria: "Alimento", unidade: "unidade" },
  { codigoItem: 444530, nome: "GELO",                 nomesAlternativos: ["gelo saco","gelo 30kg"],                                           descricaoItem: "GELO EM CUBO OU ESCAMA",                                                   tipo: 'material', categoria: "Alimento", unidade: "unidade" },
  { codigoItem: 25682,  nome: "ARBITRAGEM ESPORTIVA", nomesAlternativos: ["arbitragem","serviço de arbitragem","arbitragem voleibol","arbitragem futsal"], descricaoItem: "SERVIÇO DE ARBITRAGEM ESPORTIVA", tipo: 'servico', categoria: "Recurso Humano", unidade: "diária" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function diceScore(a: string, b: string): number {
  const na = norm(a); const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const bi = (s: string) => { const r = new Set<string>(); for (let i=0;i<s.length-1;i++) r.add(s.slice(i,i+2)); return r; };
  const sa = bi(na); const sb = bi(nb);
  let inter = 0; sa.forEach(b => { if (sb.has(b)) inter++; });
  return (2 * inter) / (sa.size + sb.size);
}

interface MatchResult {
  seed: SeedEntry;
  score: number;
  metodo: 'exato' | 'palavras' | 'dice';
}

function encontrarMatch(nomeItem: string): MatchResult | null {
  const nomeNorm = norm(nomeItem);
  const palavras = nomeNorm.split(/\s+/).filter(p => p.length >= 3);

  let melhor: MatchResult | null = null;

  for (const seed of SEED) {
    const aliases = [seed.nome, ...(seed.nomesAlternativos || [])].map(norm);

    // 1. Match exato
    if (aliases.some(a => a === nomeNorm)) {
      return { seed, score: 1.0, metodo: 'exato' };
    }

    // 2. Match por substring
    if (aliases.some(a => a.includes(nomeNorm) || nomeNorm.includes(a))) {
      const s = 0.95;
      if (!melhor || s > melhor.score) melhor = { seed, score: s, metodo: 'exato' };
      continue;
    }

    // 3. Todas as palavras-chave presentes
    const textoCombinado = aliases.join(' ') + ' ' + norm(seed.descricaoItem);
    if (palavras.length >= 2 && palavras.every(p => textoCombinado.includes(p))) {
      const s = 0.85;
      if (!melhor || s > melhor.score) melhor = { seed, score: s, metodo: 'palavras' };
      continue;
    }

    // 4. Score Dice entre o nome do item e cada alias
    const maxDice = Math.max(...aliases.map(a => diceScore(nomeItem, a)));
    if (maxDice >= MIN_SCORE && (!melhor || maxDice > melhor.score)) {
      melhor = { seed, score: maxDice, metodo: 'dice' };
    }
  }

  return melhor;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`LIE — Seed CATMAT Firestore  |  ${DRY_RUN ? 'DRY-RUN (sem gravação)' : 'MODO REAL'}`);
  console.log(`Min score: ${MIN_SCORE}  |  Force: ${FORCE}`);
  console.log(`${'='.repeat(70)}\n`);

  const snap = await db.collection('items').get();
  const itens = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));

  console.log(`Total de itens no Firestore: ${itens.length}\n`);

  let atualizados = 0, ignorados = 0, semMatch = 0;
  const batch = db.batch();
  let batchCount = 0;

  const linhas: string[] = [];

  for (const item of itens) {
    const jaTem = item.codigoCatmat && item.codigoCatmat > 0;

    if (jaTem && !FORCE) {
      ignorados++;
      linhas.push(`  ✓ [JÁ TEM] ${item.nome.padEnd(40)} CATMAT: ${item.codigoCatmat}`);
      continue;
    }

    const match = encontrarMatch(item.nome);

    if (!match) {
      semMatch++;
      linhas.push(`  ✗ [SEM MATCH] ${item.nome.padEnd(40)} score < ${MIN_SCORE}`);
      continue;
    }

    const s = match.seed;
    const acao = jaTem ? 'FORÇANDO' : 'VINCULANDO';
    linhas.push(
      `  → [${acao}] ${item.nome.padEnd(40)} ` +
      `CATMAT: ${s.codigoItem} (${s.nome}) ` +
      `score: ${match.score.toFixed(2)} via ${match.metodo}`
    );

    if (!DRY_RUN) {
      const ref = db.collection('items').doc(item.id);
      batch.update(ref, {
        codigoCatmat: s.codigoItem,
        tipoCatmat: s.tipo,
        nomeCatmatOficial: s.nome,
        descricaoCatmatOficial: s.descricaoItem,
      });
      batchCount++;
      atualizados++;

      // Firestore batch limit = 500 operações
      if (batchCount >= 490) {
        await batch.commit();
        batchCount = 0;
      }
    } else {
      atualizados++;
    }
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }

  linhas.forEach(l => console.log(l));

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Atualizados : ${atualizados}`);
  console.log(`Já tinham   : ${ignorados}`);
  console.log(`Sem match   : ${semMatch}`);
  console.log(`${'─'.repeat(70)}\n`);

  if (semMatch > 0) {
    console.log('⚠  Itens sem match precisam de CATMAT manual:');
    console.log('   1. Acesse Itens → editar o item');
    console.log('   2. Use o CatalogoSearchPicker para buscar no catalogo.compras.gov.br');
    console.log('   3. Selecione e salve o código oficial\n');
  }

  console.log(DRY_RUN ? '(DRY-RUN: nenhuma alteração foi gravada)' : '✅ Firestore atualizado com sucesso.');
  process.exit(0);
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
