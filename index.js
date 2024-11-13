// FREE SOFTWARE FOR EDUCATIONAL PURPOSES ONLY, FREE TO USE, MODIFY AND DISTRIBUTE, JUST KEEP THE ORIGINAL AUTHOR AND LICENSE.
// Author: Joaquin LLanos


const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { promises, constants, existsSync, mkdirSync } = fs;
const { resolve, join } = path;
const { createInterface } = readline;

const USERNAME = '##########';
const PASSWORD = '##########';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]+/g, '').trim();
}

async function downloadImage(page, url, fullpath) {
    const data = await page.evaluate(
        async ({ url }) => {
            function readAsBinaryStringAsync(blob) {
                return new Promise((resolve, reject) => {
                    const fr = new FileReader();
                    fr.readAsBinaryString(blob);
                    fr.onload = () => resolve(fr.result);
                    fr.onerror = reject;
                });
            }

            const r = await fetch(url, {
                credentials: 'include',
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'cache-control': 'no-cache',
                    pragma: 'no-cache',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'same-site',
                    'upgrade-insecure-requests': '1'
                },
                referrerPolicy: 'no-referrer-when-downgrade',
                method: 'GET',
                mode: 'cors'
            });

            return await readAsBinaryStringAsync(await r.blob());
        },
        { url }
    );

    fs.writeFileSync(fullpath, data, { encoding: 'binary' });
}

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Add the stealth plugin to the puppeteer instance
puppeteer.use(StealthPlugin());

(async () => {
    const downloadPath = resolve(__dirname, 'descargas');
    if (!existsSync(downloadPath)) {
        mkdirSync(downloadPath, { recursive: true });
    }

    const browser = await puppeteer.launch({
        headless: false, // Change to true if you want to run without a graphical interface
        executablePath: '/usr/bin/brave-browser'
    });

    try {
        let page = await browser.newPage();
        console.log('Iniciando sesión en nave14...');
        await page.goto('https://nave14.ucv.cl/');

        await page.type('#rut_num', USERNAME);
        await page.type('#user_pas', PASSWORD);

        await Promise.all([
            page.click('.btn-primary[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        console.log('Sesión iniciada. Por favor, navega manualmente al curso y unidad deseados.');
        await question('Presiona Enter cuando hayas seleccionado el curso y la unidad...');

        const pages = await browser.pages();
        page = pages[pages.length - 1];

        try {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 2000 });
        } catch (error) {
            console.error('Error esperando la navegación de la página:', error.message);
        }

        const pdfLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .map(a => ({ href: a.href, text: a.textContent.trim() }))
                .filter(({ href }) => href && href.includes('resource') || href.includes('url'));
        });
        console.log(pdfLinks);
        if (pdfLinks.length > 0) {
            console.log(`Encontrado(s) ${pdfLinks.length} enlace(s) PDF:`);

            for (const [index, pdfLink] of pdfLinks.entries()) {
                console.log(`Procesando ${index + 1}/${pdfLinks.length}: ${pdfLink.text}`);

                let newPage;
                try {
                    newPage = await browser.newPage();
                    const client = await newPage.target().createCDPSession();
                    await client.send('Page.setDownloadBehavior', {
                        headless: true,
                        behavior: 'allow',
                        downloadPath: join(__dirname, 'descargas')
                    });
                    await newPage.goto(pdfLink.href, { waitUntil: 'networkidle0' });
                    await newPage.waitForSelector('a[href*=".pdf"]', { timeout: 1500 });
                    const pdfUrl = await newPage.$eval('a[href*=".pdf"]', el => el.href);
                    if (pdfUrl) {
                        let fileName = `${pdfLink.text}.pdf`;
                        fileName = sanitizeFilename(fileName);
                        await downloadImage(newPage, pdfUrl, join(__dirname, 'descargas', fileName));
                        console.log(`PDF descargado: ${fileName}`);
                        console.log(`Ubicación: ${join(__dirname, 'descargas', fileName)}`);
                        console.log('link:', pdfUrl, '\n');
                    } else {
                        console.log(`No se pudo encontrar el enlace del PDF para: ${pdfLink.text}`);
                    }
                    await newPage.waitForSelector('a[href*="htmlpresent"]', { timeout: 1500 });
                    const pptUrl = await newPage.$eval('a[href*="htmlpresent"]', el => el.href);
                    if (pptUrl) {
                        let fileName = `${pdfLink.text}.pptx`;
                        fileName = sanitizeFilename(fileName);
                        await downloadImage(newPage, pptUrl, join(__dirname, 'descargas', fileName));
                        console.log(`PPT descargado: ${fileName}`);
                        console.log(`Ubicación: ${join(__dirname, 'descargas', fileName)}`);
                        console.log('link:', pdfUrl, '\n');
                    }
                } catch (error) {
                    console.error(`Error procesando ${pdfLink.text}: ${error.message}`);
                } finally {
                    if (newPage && !newPage.isClosed()) {
                        await newPage.close();
                    }
                }
            }
        } else {
            console.log('No se encontraron enlaces PDF en la página.');
        }
    } catch (error) {
        console.error('Error al procesar la página:', error);
    } finally {
        await browser.close();
        rl.close();
    }
})();
