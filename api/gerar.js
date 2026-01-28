import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import puppeteer from 'puppeteer';
import archiver from 'archiver';

export const config = {
  api: {
    bodyParser: false
  }
};

const ROOT = process.cwd();
const TEMPLATES = path.join(ROOT, 'templates');
const LOGOS = path.join(ROOT, 'logos');
const TMP = path.join(ROOT, 'tmp');
const OUTPUT = path.join(ROOT, 'output');

const upper = (v) => String(v || '').toUpperCase();

function imageToBase64(imgPath) {
  if (!fs.existsSync(imgPath)) return '';
  const ext = path.extname(imgPath).replace('.', '');
  const buffer = fs.readFileSync(imgPath);
  return `data:image/${ext};base64,${buffer.toString('base64')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
  if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT);

  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).send('Erro no upload');
      return;
    }

    const filePath = files.file.filepath;
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let index = 1;

    for (const row of rows) {
      if (!row.TIPO && !row.tipo) continue;

      let tipo = upper(row.TIPO || row.tipo)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      if (tipo.includes('PROMO')) tipo = 'promocao';
      else if (tipo.includes('CUPOM')) tipo = 'cupom';
      else if (tipo.includes('QUEDA')) tipo = 'queda';
      else if (tipo === 'BC') tipo = 'bc';
      else continue;

      const templatePath = path.join(TEMPLATES, `${tipo}.html`);
      if (!fs.existsSync(templatePath)) continue;

      let html = fs.readFileSync(templatePath, 'utf8');

      const logoPath = path.join(LOGOS, row.LOGO || row.logo);
      const logoBase64 = imageToBase64(logoPath);

      html = html
        .replaceAll('{{LOGO}}', logoBase64)
        .replaceAll('{{TEXTO}}', upper(row.TEXTO || row.texto))
        .replaceAll('{{VALOR}}', upper(row.VALOR || row.valor))
        .replaceAll('{{CUPOM}}', upper(row.CUPOM || row.cupom))
        .replaceAll('{{LEGAL}}', upper(row.LEGAL || row.legal))
        .replaceAll('{{UF}}', upper(row.UF || row.uf))
        .replaceAll('{{SEGMENTO}}', upper(row.SEGMENTO || row.segmento));

      const tmpHtml = path.join(TMP, `card_${index}.html`);
      fs.writeFileSync(tmpHtml, html, 'utf8');

      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 2115 });

      await page.goto(`file://${tmpHtml}`, {
        waitUntil: 'networkidle0'
      });

      // ⚠️ PDF COM UMA ÚNICA PÁGINA (SEM PÁGINA 2 EM BRANCO)
      await page.pdf({
        path: path.join(OUTPUT, `card_${String(index).padStart(3, '0')}.pdf`),
        width: '1400px',
        height: '2115px',
        pageRanges: '1',
        printBackground: true
      });

      await page.close();
      index++;
    }

    await browser.close();

    // 📦 ZIP FINAL
    const zipPath = path.join(OUTPUT, 'cards_jornal.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(OUTPUT, false);
    await archive.finalize();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=cards_jornal.zip');

    fs.createReadStream(zipPath).pipe(res);
  });
}

