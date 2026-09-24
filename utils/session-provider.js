const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

let browserInstance = null;

/**
 * Mantiene una instancia única del navegador para evitar lentitud.
 */
async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;

  console.log("🚀 Iniciando navegador persistente...");
  browserInstance = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ]
  });
  return browserInstance;
}

/**
 * Realiza una petición usando el navegador para saltar Cloudflare.
 * Devuelve el HTML de la página.
 */
async function fetchWithBrowser(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    console.log(`📡 [Browser] Fetching: ${url}`);

    // Ir a la URL. Si hay reto, esperamos.
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // ESPERA INTELIGENTE MEJORADA: Terminar en cuanto haya datos
    try {
      await Promise.race([
        page.waitForSelector('a[href*="/ver/"]', { timeout: 15000 }),
        page.waitForSelector('article', { timeout: 15000 }),
        page.waitForSelector('.anime-card', { timeout: 15000 }),
        page.waitForSelector('.post-entry', { timeout: 15000 }),
        page.waitForSelector('ul.list-episodes', { timeout: 15000 })
      ]);
      console.log("   - [Browser] Contenido renderizado");
    } catch (e) {
      console.warn("   - [Browser] Timeout de selectores, procediendo con scroll rápido...");

      // Si hay un iframe de Cloudflare (Turnstile), intentamos esperar a que desaparezca o se resuelva
      const cfIframe = await page.$('iframe[src*="cloudflare"]');
      if (cfIframe) {
        console.log("   - [Browser] Cloudflare detectado, esperando 10s adicionales...");
        await new Promise(r => setTimeout(r, 10000));
      }

      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise(r => setTimeout(r, 3000));
    }

    const content = await page.content();
    return content;
  } catch (err) {
    console.error(`❌ [Browser] Error: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}

module.exports = { fetchWithBrowser };
