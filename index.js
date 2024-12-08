const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { promises, constants, existsSync, mkdirSync } = fs;
const { resolve, join, extname } = path; // Asegúrate de incluir extname aquí
const { createInterface } = readline;

// Configuración
const CONFIG = {
    USERNAME: '#',
    PASSWORD: '#',
    BROWSER_PATH: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    DOWNLOAD_PATH: resolve(__dirname, 'descargas')
};

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]+/g, '').trim();
}

async function downloadFile(page, url, fullpath) {
    const data = await page.evaluate(async ({ url }) => {
        function readAsBinaryStringAsync(blob) {
            return new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.readAsBinaryString(blob);
                fr.onload = () => resolve(fr.result);
                fr.onerror = reject;
            });
        }

        const response = await fetch(url, {
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

        return await readAsBinaryStringAsync(await response.blob());
    }, { url });

    fs.writeFileSync(fullpath, data, { encoding: 'binary' });
}

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Añadir el plugin de stealth a la instancia de puppeteer
puppeteer.use(StealthPlugin());

(async () => {
    if (!existsSync(CONFIG.DOWNLOAD_PATH)) {
        mkdirSync(CONFIG.DOWNLOAD_PATH, { recursive: true });
    }

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: CONFIG.BROWSER_PATH
    });

    try {
        let page = await browser.newPage();
        console.log('Iniciando sesión en nave14...');
        await page.goto('https://navegador.pucv.cl');

        await page.type('#rut_num', CONFIG.USERNAME);
        await page.type('#user_pas', CONFIG.PASSWORD);

        await Promise.all([
            page.click('.btn-primary[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        console.log('Sesión iniciada. Por favor, navega manualmente al curso y unidad deseados.');
        await question('Presiona Enter cuando hayas seleccionado el curso y la unidad...');

        const pages = await browser.pages();
        page = pages[pages.length - 1];

        const resourceLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a')).map(a => ({
                index: a.id.trim(),
                href: a.href,
                text: a.textContent.trim()
            }));
            const uniqueLinks = [...new Set(links.map(link => JSON.stringify(link)))].map(item => JSON.parse(item));
            return uniqueLinks.filter(({ href, text }) => href && href.includes('resource') && !text.includes('File'));
        });

        console.log(resourceLinks);

        if (resourceLinks.length > 0) {
            console.log(`Encontrado(s) ${resourceLinks.length} enlace(s) de recursos:`);

            for (const [index, resourceLink] of resourceLinks.entries()) {
                console.log(`Procesando ${index + 1}/${resourceLinks.length}: ${resourceLink.text}`);

                let newPage;
                try {
                    newPage = await browser.newPage();
                    console.log('waiting chrome devtools protocols session creation');
                    const client = await newPage.createCDPSession();
                    await client.send('Page.setDownloadBehavior', {
                        behavior: 'allow',
                        downloadPath: join(__dirname, 'descargas')
                    });
                    console.log('processing link in goto');
                    await newPage.goto(resourceLink.href, { waitUntil: 'networkidle0' });
                    console.log('no error in goto func');
                    await newPage.waitForSelector('a[href*=".pdf"], a[href*=".pptx"], a[href*=".docx"], a[href*=".sqlite"], a[href*=".sql"], a[href*=".ipynb"]', { timeout: 1000 });
                    console.log('no error in selector func');
                    const resourceUrl = await newPage.$eval('a[href*=".pdf"], a[href*=".pptx"], a[href*=".docx"], a[href*=".sqlite"], a[href*=".sql"], a[href*=".ipynb"]', el => el.href).catch(() => null);
                    if (resourceUrl) {
                        const extension = extname(resourceUrl);
                        let fileName = `${resourceLink.text}${extension}`;
                        fileName = sanitizeFilename(fileName);
                        await downloadFile(newPage, resourceUrl, join(__dirname, 'descargas', fileName));
                        console.log(`Recurso descargado: ${fileName}`);
                        console.log(`Ubicación: ${join(__dirname, 'descargas', fileName)}`);
                    } else {
                        console.log(`No se pudo encontrar el enlace del recurso para: ${resourceLink.text}`);
                    }

                } catch (error) {
                    console.error(`Error procesando ${resourceLink.text}: ${error.message}`);
                } finally {
                    if (newPage && !newPage.isClosed()) {
                        await newPage.close();
                    }
                }
            }
        } else {
            console.log('No se encontraron enlaces de recursos en la página.');
        }
    } catch (error) {
        console.error('Error al procesar la página:', error);
    } finally {
        await browser.close();
        rl.close();
    }
})();
