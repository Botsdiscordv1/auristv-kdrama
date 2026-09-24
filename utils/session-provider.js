// DESHABITILADO: el navegador (Puppeteer/Chrome) no se usa en el VPS
// para no saturar CPU/RAM con recursos limitados.
// Si una fuente/endpoint requiere navegador, se omite con un error claro.

async function fetchWithBrowser(url, opts = {}) {
  throw new Error(
    "Navegador deshabilitado en el VPS (recursos limitados). " +
    "Fuente/endpoint que requiere browser: " + url
  );
}

module.exports = { fetchWithBrowser };
