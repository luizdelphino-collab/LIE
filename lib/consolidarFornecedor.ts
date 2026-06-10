import jsPDF from 'jspdf';
import { doc, getDoc } from 'firebase/firestore';
import { db, storage } from './firebase';
import type { Fornecedor } from '../types';

const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 7;
const COR_PRIMARIA: [number, number, number] = [22, 163, 74]; // lie-green (tailwind)

function downloadStorageFileUrl(path: string): string {
  const projectId = storage.app.options.projectId;
  return `https://us-central1-${projectId}.cloudfunctions.net/downloadStorageFile?path=${encodeURIComponent(path)}`;
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  let fetchUrl = url;
  if (url.includes('firebasestorage.googleapis.com')) {
    const match = url.match(/\/o\/([^?]+)/);
    const path = match ? decodeURIComponent(match[1]) : null;
    if (path) fetchUrl = downloadStorageFileUrl(path);
  }

  try {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Erro ao buscar imagem:', url, e);
    return null;
  }
}

function getImgFormat(url: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (url.toLowerCase().includes('.png') || url.startsWith('data:image/png')) return 'PNG';
  if (url.toLowerCase().includes('.webp') || url.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
}

function addField(pdf: jsPDF, label: string, value: string, x: number, y: number, maxW = CONTENT_W): number {
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(80, 80, 80);
  pdf.text(label + ':', x, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(20, 20, 20);
  const lines = pdf.splitTextToSize(value || '-', maxW - 35);
  pdf.text(lines, x + 35, y);
  return y + (lines.length * LINE_H);
}

export async function consolidarFornecedor(fornecedorId: string): Promise<void> {
  const snap = await getDoc(doc(db, 'suppliers', fornecedorId));
  if (!snap.exists()) throw new Error('Fornecedor não encontrado');
  const fornecedor = { id: snap.id, ...snap.data() } as Fornecedor;

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  // Header background
  pdf.setFillColor(...COR_PRIMARIA);
  pdf.rect(0, 0, PAGE_W, 30, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text('DADOS DO FORNECEDOR', PAGE_W / 2, 19, { align: 'center' });

  let y = 45;

  if (fornecedor.logoUrl) {
    const imgData = await fetchImageAsBase64(fornecedor.logoUrl);
    if (imgData) {
      pdf.addImage(imgData, getImgFormat(fornecedor.logoUrl), PAGE_W - MARGIN - 30, y - 5, 30, 30);
    }
  }

  // Seção: Identificação
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...COR_PRIMARIA);
  pdf.text('1. Identificação', MARGIN, y);
  y += 8;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);

  y = addField(pdf, 'Razão Social', fornecedor.razaoSocial, MARGIN, y); y += 2;
  y = addField(pdf, 'Nome Fantasia', fornecedor.nomeFantasia || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'CNPJ', fornecedor.cnpj, MARGIN, y); y += 2;
  y = addField(pdf, 'Atuação Principal', fornecedor.atuacaoPrimaria || '-', MARGIN, y); y += 2;
  if (fornecedor.atuacoesSecundarias && fornecedor.atuacoesSecundarias.length > 0) {
    y = addField(pdf, 'Atuações Sec.', fornecedor.atuacoesSecundarias.join(', '), MARGIN, y); y += 2;
  }
  y += 5;

  // Seção: Endereço
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...COR_PRIMARIA);
  pdf.text('2. Endereço', MARGIN, y);
  y += 8;
  pdf.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);
  
  const endParts = [fornecedor.logradouro, fornecedor.numero, fornecedor.complemento, fornecedor.bairro, fornecedor.cidade, fornecedor.uf, fornecedor.cep].filter(Boolean).join(', ');
  y = addField(pdf, 'Logradouro', endParts || '-', MARGIN, y); y += 5;

  // Seção: Contato e Redes
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...COR_PRIMARIA);
  pdf.text('3. Contato e Redes', MARGIN, y);
  y += 8;
  pdf.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);
  
  y = addField(pdf, 'E-mail', fornecedor.email || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Tel. Comercial', fornecedor.telefoneComercial || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Celular/Wpp', fornecedor.celular || '-', MARGIN, y); y += 2;
  y = addField(pdf, 'Site', fornecedor.site || '-', MARGIN, y); y += 2;
  
  if (fornecedor.instagram) { y = addField(pdf, 'Instagram', fornecedor.instagram, MARGIN, y); y += 2; }
  if (fornecedor.facebook) { y = addField(pdf, 'Facebook', fornecedor.facebook, MARGIN, y); y += 2; }
  if (fornecedor.outraRede) { y = addField(pdf, 'Outra Rede', fornecedor.outraRede, MARGIN, y); y += 2; }
  y += 5;

  // Seção: Observações
  if (fornecedor.observacoes) {
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...COR_PRIMARIA);
    pdf.text('4. Observações', MARGIN, y);
    y += 8;
    pdf.line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4);
    y = addField(pdf, 'Gerais', fornecedor.observacoes, MARGIN, y);
  }

  // Footer
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text(`Documento gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, PAGE_W / 2, PAGE_H - 10, { align: 'center' });

  pdf.save(`Fornecedor_${fornecedor.razaoSocial.replace(/\s/g, '_')}.pdf`);
}
