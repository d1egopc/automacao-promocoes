const { chromium } = require("playwright");

(async () => {
  const executablePath = chromium.executablePath();
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await page.setContent("<!doctype html><title>ok</title><body>ok</body>");
  await page.close();
  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    executablePath
  }));
})().catch(erro => {
  console.error(JSON.stringify({
    ok: false,
    erro: String(erro.message || erro).slice(0, 240)
  }));
  process.exit(1);
});
