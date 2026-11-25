// Código personal: guarda el avance de una persona para abrirlo en otro celu, sin cuentas.
//   POST /sync          → crea un código nuevo con los datos       {datos} → {codigo, t}
//   GET  /sync/:codigo  → trae los datos                                    → {datos, t}
//   PUT  /sync/:codigo  → actualiza los datos (solo si el código existe)    {datos} → {t}
import { json, type Env } from "./index";

const MAX = 400 * 1024;
const PALABRAS = ("PUMA ZORRO CONDOR TERO HORNERO CARPINCHO YAGUAR TAPIR LLAMA VICUNA COATI NUTRIA CIERVO PINGUINO BALLENA DELFIN TUCAN LORO " +
  "COLIBRI CARANCHO BUHO HALCON AGUILA GARZA FLAMENCO CISNE PATO GALLO TORO CABALLO MULITA PELUDO CHINCHILLA LIEBRE ARDILLA CASTOR " +
  "ROBLE CEIBO ALGARROBO QUEBRACHO TALA ESPINILLO SAUCE ALAMO PINO CEDRO OMBU JACARANDA LAPACHO PALMERA CACTUS HELECHO " +
  "MONTE SIERRA VALLE LAGO RIO MAR PLAYA DUNA ISLA CERRO VOLCAN GLACIAR NIEVE LLUVIA TRUENO RAYO VIENTO NUBE SOL LUNA ESTRELLA COMETA " +
  "MATE TERMO YERBA ASADO EMPANADA ALFAJOR DULCE TORTA PAN QUESO MIEL CAFE TE LIMON NARANJA MANZANA PERA UVA FRUTILLA CEREZA DURAZNO " +
  "GUITARRA BOMBO CHARANGO PIANO VIOLIN TANGO ZAMBA CHACARERA CUARTETO RITMO CANTO POEMA LIBRO CUADERNO LAPIZ REGLA COMPAS TIZA MAPA " +
  "BRUJULA FARO PUENTE TORRE CASTILLO MOLINO TREN AVION BARCO VELERO COHETE GLOBO COMETA RUEDA MOTOR IMAN ATOMO PRISMA ESPEJO CRISTAL").split(" ");

const valido = (c: string) => /^[A-Z]+-[A-Z]+-\d{4}$/.test(c);
function nuevoCodigo(): string {
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${PALABRAS[r[0] % PALABRAS.length]}-${PALABRAS[r[1] % PALABRAS.length]}-${String(r[2] % 10000).padStart(4, "0")}`;
}

async function leerDatos(req: Request, h: Record<string, string>): Promise<unknown | Response> {
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX) return json({ error: "muy_grande" }, 413, h);
  try {
    const b = (await req.json()) as { datos?: unknown };
    if (!b?.datos || typeof b.datos !== "object") return json({ error: "pedido_invalido" }, 400, h);
    const txt = JSON.stringify(b.datos);
    if (txt.length > MAX) return json({ error: "muy_grande" }, 413, h);
    return b.datos;
  } catch {
    return json({ error: "pedido_invalido" }, 400, h);
  }
}

export async function sync(req: Request, env: Env, path: string, ip: string, h: Record<string, string>): Promise<Response> {
  const partes = path.split("/").filter(Boolean); // ["sync", codigo?]
  const codigo = partes[1] ? decodeURIComponent(partes[1]).toUpperCase() : "";
  if (partes.length > 2 || (partes[1] && !valido(codigo))) return json({ error: "codigo_invalido" }, 404, h);

  // Probar códigos al azar o crear muchos queda limitado por IP
  if (req.method !== "PUT") {
    const { success } = await env.LIMITER_BANCO.limit({ key: "sync:" + ip });
    if (!success) return json({ error: "muchos_pedidos" }, 429, h);
  }

  if (req.method === "POST" && !codigo) {
    const datos = await leerDatos(req, h);
    if (datos instanceof Response) return datos;
    let c = nuevoCodigo();
    for (let i = 0; i < 5 && (await env.PLANES.get("sync:" + c)); i++) c = nuevoCodigo();
    const t = Date.now();
    await env.PLANES.put("sync:" + c, JSON.stringify({ datos, t }));
    return json({ codigo: c, t }, 201, h);
  }

  if (req.method === "GET" && codigo) {
    const g = await env.PLANES.get("sync:" + codigo);
    if (!g) return json({ error: "no_existe" }, 404, h);
    return new Response(g, { status: 200, headers: { ...h, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  if (req.method === "PUT" && codigo) {
    const { success } = await env.LIMITER_SYNC.limit({ key: ip });
    if (!success) return json({ error: "muchos_pedidos" }, 429, h);
    if (!(await env.PLANES.get("sync:" + codigo))) return json({ error: "no_existe" }, 404, h);
    const datos = await leerDatos(req, h);
    if (datos instanceof Response) return datos;
    const t = Date.now();
    await env.PLANES.put("sync:" + codigo, JSON.stringify({ datos, t }));
    return json({ t }, 200, h);
  }
  return json({ error: "no_encontrado" }, 404, h);
}
