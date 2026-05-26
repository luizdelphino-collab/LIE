import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as puppeteer from 'puppeteer';

admin.initializeApp();

export const obterPdfContratacaoPublica = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const { url, token } = data;
    if (!url) {
      throw new functions.https.HttpsError('invalid-argument', 'A URL é obrigatória.');
    }

    const storageBucket = admin.storage().bucket();
    const cachePath = `public_quote_pdfs/${token || 'temp_' + Date.now()}.pdf`;
    const file = storageBucket.file(cachePath);

    // 1. Verificar se o arquivo já existe no cache para reuso instantâneo
    try {
      const [exists] = await file.exists();
      if (exists) {
        const [downloadUrl] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500',
        });
        return { downloadUrl };
      }
    } catch (e) {
      console.warn('Erro ao verificar cache no Storage:', e);
    }

    // 2. Iniciar Puppeteer para capturar a página e convertê-la em PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      
      // Abre a página governamental da Ata ou Edital
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Otimização: Forçar quebras de linha limpas para impressão
      await page.addStyleTag({
        content: `
          @media print {
            body { background: white; color: black; }
            a { text-decoration: underline !important; color: black !important; }
            .no-print, header, footer, nav, #menu { display: none !important; }
          }
        `
      });

      // Gerar PDF da página
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      });

      // Salvar PDF gerado no Firebase Storage cache
      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000',
        },
      });

      // Obter URL pública de download
      const [downloadUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      return { downloadUrl };
    } catch (error: any) {
      console.error('Erro ao gerar PDF da contratação pública:', error);
      throw new functions.https.HttpsError('internal', 'Erro ao renderizar a página governamental: ' + error.message);
    } finally {
      await browser.close();
    }
  });
