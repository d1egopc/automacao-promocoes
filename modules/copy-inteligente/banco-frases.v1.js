const BANCO_FRASES_V1 = Object.freeze({
  resgate: Object.freeze([
    Object.freeze({ texto: "Tem resgate nessa oferta", exige: ["resgate"] }),
    Object.freeze({ texto: "Essa veio com beneficio extra", exige: ["resgate"] })
  ]),
  cupom: Object.freeze([
    Object.freeze({ texto: "Tem cupom nessa oferta", exige: ["cupom"] }),
    Object.freeze({ texto: "Opa, essa veio com cupom", exige: ["cupom"] })
  ]),
  beneficio: Object.freeze([
    Object.freeze({ texto: "Essa veio com beneficio real", exige: ["beneficio"] }),
    Object.freeze({ texto: "Boa pra aproveitar o beneficio", exige: ["beneficio"] })
  ]),
  economia: Object.freeze([
    Object.freeze({ texto: "Boa oportunidade pra economizar", exige: ["desconto"] }),
    Object.freeze({ texto: "Essa chamou atencao pelo desconto", exige: ["desconto"] })
  ]),
  beleza: Object.freeze([
    Object.freeze({ texto: "Hora de dar um trato no visual", exige: [] }),
    Object.freeze({ texto: "Seu visual agradece essa", exige: [] })
  ]),
  casa: Object.freeze([
    Object.freeze({ texto: "Um upgrade daqueles pra casa", exige: [] }),
    Object.freeze({ texto: "Pra deixar a casa mais pratica", exige: [] })
  ]),
  gamer: Object.freeze([
    Object.freeze({ texto: "Hora de dar um upgrade no setup", exige: [] }),
    Object.freeze({ texto: "Seu setup merece atencao", exige: [] })
  ]),
  presente: Object.freeze([
    Object.freeze({ texto: "Boa ideia pra presentear", exige: [] }),
    Object.freeze({ texto: "Essa pode virar presente", exige: [] })
  ]),
  conforto: Object.freeze([
    Object.freeze({ texto: "Mais conforto no dia a dia", exige: [] }),
    Object.freeze({ texto: "Essa combina com rotina confortavel", exige: [] })
  ]),
  sazonal: Object.freeze([
    Object.freeze({ texto: "Boa pra aproveitar essa temporada", exige: ["sazonal"] }),
    Object.freeze({ texto: "Essa combina com a ocasiao", exige: ["sazonal"] })
  ]),
  oportunidade: Object.freeze([
    Object.freeze({ texto: "Opa, essa vale conferir", exige: [] }),
    Object.freeze({ texto: "Essa chamou atencao por aqui", exige: [] }),
    Object.freeze({ texto: "Boa oportunidade pra aproveitar", exige: [] })
  ])
});

module.exports = {
  BANCO_FRASES_V1
};
