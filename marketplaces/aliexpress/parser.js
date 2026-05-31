// ================= PARSER AMAZON =================

function extrairLinksAmazon(html = "") {

  const linksExtraidos = [
    ...html.matchAll(
      /href="([^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/g
    ),

    ...html.matchAll(
      /href="([^"]*\/gp\/product\/[A-Z0-9]{10}[^"]*)"/g
    )
  ]
    .map(m => m[1])
    .map(link => {

      let limpo = String(link)
        .replace(/&amp;/g, "&")
        .split("?")[0];

      if (limpo.startsWith("/")) {
        limpo =
          "https://www.amazon.com.br" +
          limpo;
      }

      return limpo;

    })
    .filter(link =>
      link.includes("amazon.com.br") &&
      !link.includes("/sspa/") &&
      !link.includes("/gp/slredirect")
    );

  return [
    ...new Set(linksExtraidos)
  ];

}

module.exports = {
  extrairLinksAmazon
};