function registrarMiddlewaresBase(app, deps = {}) {
  const {
    express,
    helmet,
    cors,
    capturarRawBody
  } = deps;

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "10mb", verify: capturarRawBody }));
}

function registrarMiddlewaresOperacionais(app, deps = {}) {
  const {
    express,
    helmet,
    cors,
    rateLimit,
    capturarRawBody,
    criarRequestIdPerf,
    getClienteId
  } = deps;

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({
    origin: true,
    credentials: true
  }));

  app.options("*", cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json({ limit: "10mb", verify: capturarRawBody }));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path.startsWith("/conexoes") ||
      req.path.startsWith("/sessoes") ||
      req.path.startsWith("/conectar") ||
      req.path.startsWith("/desconectar") ||
      req.path.startsWith("/reset") ||
      req.path.startsWith("/limpar-sessao") ||
      req.path.startsWith("/login") ||
      req.path.startsWith("/config") ||
      req.path.startsWith("/status") ||
      req.path.startsWith("/qr") ||
      req.path.startsWith("/fila") ||
      req.path.startsWith("/automacao") ||
      req.path.startsWith("/destinos") ||
      req.path.startsWith("/grupos")
  }));
  const ROTAS_PERF_DIAGNOSTICO = [
    "/login",
    "/me",
    "/fila",
    "/sessoes",
    "/destinos",
    "/integracoes",
    "/grupos",
    "/status",
    "/radar/config",
    "/automacao"
  ];

  function rotaPerfDiagnostico(path = "") {
    const alvo = String(path || "");
    return ROTAS_PERF_DIAGNOSTICO.some(rota =>
      alvo === rota ||
      alvo.startsWith(`${rota}/`) ||
      (rota === "/integracoes" && alvo === "/integracoes/alertas") ||
      (rota === "/automacao" && alvo === "/automacao/status")
    );
  }

  app.use((req, res, next) => {
    if (!rotaPerfDiagnostico(req.path)) return next();

    const requestId = criarRequestIdPerf(req);
    const inicio = process.hrtime.bigint();
    const recebidoEm = new Date(req.perfRecebidoEmMs || Date.now()).toISOString();

    console.log("[PERF HTTP RECEBIDO]", {
      requestId,
      metodo: req.method,
      path: req.originalUrl || req.path,
      recebidoEm
    });

    res.on("finish", () => {
      const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      const totalDesdeRecebidoMs = req.perfRecebidoHr
        ? Number(process.hrtime.bigint() - req.perfRecebidoHr) / 1e6
        : duracaoMs;
      const clienteId = (() => {
        try {
          return getClienteId(req) || "admin";
        } catch {
          return "admin";
        }
      })();

      console.log("[PERF]", {
        requestId,
        metodo: req.method,
        path: req.originalUrl || req.path,
        clienteId,
        duracaoMs: Math.round(duracaoMs),
        totalDesdeRecebidoMs: Math.round(totalDesdeRecebidoMs),
        statusCode: res.statusCode
      });
    });

    return next();
  });
}

module.exports = {
  registrarMiddlewaresBase,
  registrarMiddlewaresOperacionais
};
