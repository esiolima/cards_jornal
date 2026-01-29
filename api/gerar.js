import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import archiver from 'archiver';
import puppeteer from 'puppeteer';
import formidable from 'formidable';

export const config = {
  api: {
    bodyParser: false,
  },
};

const TMP_BASE = '/tmp';
const TMP_HTML = path.join(TMP_BASE, 'html');
const TMP_PDF = path.join(TMP_BASE, 'pdf');
const TMP_ZIP = path.join(TMP_BASE, 'cards_jornal.zip');

const upper = (v) => String(v || '').toUpperCase();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function imageToBase64(imagePath) {
  if (!fs.existsSync(imagePath)) return '';
  const ext = path.extname(imagePath).replace('.', '');
  const buffer = fs.readFileSync(imagePath);
  return `data:image/${ext};base64,${buffer.toString('base64')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    ensureDir(TMP_HTML);
    ensureDir(TMP_PDF);

    const form = formidable({ multiples: false });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const file = files.file;
    if (!file) {
      return res.status(400).json({ error: 'Planilha não enviada' });
    }

    const workbook = xlsx.readFile(file.filepath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    let index = 1;

    for (const row of rows) {
      if (!row.tipo) continue;

      let tipo = String(row.tipo)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      if (tipo.includes('promo')) tipo = 'promocao';
      else if (tipo.includes('cupom')) tipo = 'cupom';
      else if (tipo.includes('queda')) tipo = 'queda';
      else if (tipo === 'bc') tipo = 'bc';
      else continue;

      const templatePath = path.join(process.cwd(), 'templates', `${tipo}.html`);
      if (!fs.existsSync(templatePath)) continue;

      let html = fs.readFileSync(templatePath, 'utf8');

      const logoPath = path.join(process.cwd(), 'logos', row.logo || '');
      const logoBase64 = imageToBase64(logoPath);

      html = html
        .replaceAll('{{LOGO}}', logoBase64)
        .replaceAll('{{TEXTO}}', upper(row.texto))
        .replaceAll('{{VALOR}}', upper(row.valor))
        .replaceAll('{{CUPOM}}', upper(row.cupom))
        .replaceAll('{{LEGAL}}', upper(row.legal))
        .replaceAll('{{UF}}', upper(row.uf))
        .replaceAll('{{SEGMENTO}}', upper(row.segmento));

      const htmlPath = path.join(TMP_HTML, `card_${index}.html`);
      const pdfPath = path.join(TMP_PDF, `card_${String(index).padStart(3, '0')}.pdf`);

      fs.writeFileSync(htmlPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 2115 });
      await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

      await page.pdf({
        path: pdfPath,
        width: '1400px',
        height: '2115px',
        printBackground: true,
        pageRanges: '1',
      });

      await page.close();
      index++;
    }

    await browser.close();

    const output = fs.createWriteStream(TMP_ZIP);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(TMP_PDF, false);
    await archive.finalize();

    const zipBuffer = fs.readFileSync(TMP_ZIP);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=cards_jornal.zip');
    res.status(200).send(zipBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar os arquivos' });
  }
}
