// Cursable · lector de planes
// Recibe el PDF (o fotos) de un régimen de correlativas y devuelve el plan como JSON,
// leído por Claude. La clave de API vive solo acá, como secreto del Worker.
import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string; // separados por coma, ej: "https://juanpaz09.github.io"
  LIMITER: RateLimit; // límite de pedidos por IP (wrangler.toml)
}

const MAX_BYTES = 12 * 1024 * 1024; // tamaño máximo del pedido
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

// Forma exacta que la app espera (structured outputs garantiza que se cumpla)
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["carrera", "creditosElectivas", "materias", "dudas"],
  properties: {
    carrera: { type: "string" },
    creditosElectivas: { type: "number" },
    dudas: { type: "array", items: { type: "string" } },
    materias: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "nombre", "anio", "horas", "tipo", "cuatrimestre", "creditos", "regulares", "aprobadas"],
        properties: {
          codigo: { type: "string" },
          nombre: { type: "string" },
          anio: { type: "number" },
          horas: { type: "number" },
          tipo: { type: "string", enum: ["anual", "cuatrimestral", "electiva"] },
          cuatrimestre: { type: "string", enum: ["", "1C", "2C"] },
          creditos: { type: "number" },
          regulares: { type: "array", items: { type: "string" } },
          aprobadas: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const INSTRUCCIONES = (nombre: string) => `Te paso el plan de estudios / régimen de correlatividades de una carrera universitaria argentina${nombre ? ` (${nombre})` : ""}. Armá el plan para una app que calcula qué materias puede cursar un estudiante.

Reglas:
- "regulares": códigos de las materias que hay que tener regularizadas (cursada aprobada) para CURSAR esta materia. "aprobadas": las que hay que tener aprobadas (final) para CURSAR esta materia. Si el documento solo trae correlativas para rendir, usalas igual y avisalo en "dudas".
- "codigo": el número o código de la materia en el documento. Si no tiene, inventá uno corto y único (por ejemplo E1, E2 para electivas) y usá esos mismos códigos en las correlativas.
- Si una correlativa aparece por nombre, convertila al código de esa materia.
- "tipo": "anual", "cuatrimestral" o "electiva". "cuatrimestre": "1C", "2C" o "" si es anual. "anio": año o nivel de la carrera (para electivas, el más cercano).
- "horas": horas semanales si figuran, si no 0. "creditos": solo electivas, si figuran, si no 0. "creditosElectivas": créditos de electivas que pide el título, si figura, si no 0.
- No inventes correlativas. Si una celda está cortada o es ambigua, poné tu mejor lectura y explicala en "dudas" con una frase corta en castellano. Si no hay dudas, dejá la lista vacía.
- Si el archivo no es un plan de estudios, devolvé "materias" vacío y explicá en "dudas".`;

type Pedido = {
  nombre?: string;
  pdf?: string; // base64
  imagenes?: { media_type: string; data: string }[];
};

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const ok = origin && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] ?? "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin");
    const h = cors(origin, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST" || new URL(req.url).pathname !== "/leer") return json({ error: "no_encontrado" }, 404, h);

    // Solo desde la app (no es seguridad fuerte, pero frena el uso casual desde otros sitios)
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    if (!origin || !allowed.includes(origin)) return json({ error: "origen_no_permitido" }, 403, h);

    const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) return json({ error: "muchos_pedidos" }, 429, h);

    const largo = Number(req.headers.get("Content-Length") ?? 0);
    if (largo > MAX_BYTES) return json({ error: "muy_grande" }, 413, h);

    let p: Pedido;
    try {
      p = await req.json();
    } catch {
      return json({ error: "pedido_invalido" }, 400, h);
    }

    const contenido: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (p.pdf) {
      contenido.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.pdf } });
    }
    for (const img of (p.imagenes ?? []).slice(0, 10)) {
      if (!IMAGE_TYPES.includes(img.media_type as ImageType)) continue;
      contenido.push({ type: "image", source: { type: "base64", media_type: img.media_type as ImageType, data: img.data } });
    }
    if (!contenido.length) return json({ error: "sin_archivo" }, 400, h);
    contenido.push({ type: "text", text: INSTRUCCIONES(String(p.nombre ?? "").slice(0, 120)) });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const msg = await client.beta.messages
        .stream({
          model: "claude-opus-5-5",
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: { type: "json_schema", schema: PLAN_SCHEMA } },
          messages: [{ role: "user", content: contenido }],
        })
        .finalMessage();

      if (msg.stop_reason === "refusal") return json({ error: "rechazado" }, 422, h);
      if (msg.stop_reason === "max_tokens") return json({ error: "muy_largo" }, 422, h);
      const texto = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return json({ plan: JSON.parse(texto) }, 200, h);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "ocupado" }, 503, h);
      if (e instanceof Anthropic.BadRequestError) return json({ error: "archivo_no_valido" }, 400, h);
      if (e instanceof Anthropic.APIError) return json({ error: "error_claude" }, 502, h);
      return json({ error: "error_interno" }, 500, h);
    }
  },
} satisfies ExportedHandler<Env>;
