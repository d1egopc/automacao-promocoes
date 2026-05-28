// ================= PARSER KABUM =================

function extrairLinksKabum(html = "") {

  const links = [

    ...html.matchAll(/href="(https:\/\/www\.kabum\.com\.br\/produto\/[^"]+)"/gi),

    ...html.matchAll(/"url":"(https:\/\/www\.kabum\.com\.br\/produto\/[^"]+)"/gi)

  ]
    .map(m => m[1])
    .filter(Boolean);

  return [...new Set(links)];
}

module.exports = {
  extrairLinksKabum
};