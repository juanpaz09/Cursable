// Banco de planes: la gente comparte el plan de su carrera (universidad, ciudad, país)
// y otros lo encuentran sin tener que leer el PDF otra vez.
//   GET  /planes               → lista (solo datos para buscar)
//   GET  /planes/:id           → plan completo
//   POST /planes               → compartir un plan
//   POST /planes/:id/reportar  → avisar que está mal (con 3 avisos de personas distintas se oculta)
import { json, type Env } from "./index";

type Meta = { carrera: string; uni: string; ciudad: string; pais: string; n: number; f: string; r: number };
type Materia = { id: string; nombre: string; nivel: number; tipo: string; cuat: string; hs: number; creditos: number; reg: string[]; apr: string[] };
type Guardado = { meta: Meta; plan: { nombre: string; creditosReq: number; materias: Materia[] } };

const MAX_BODY = 300 * 1024;
const OCULTAR_CON = 3;

const txt = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v) || 0);
  return Math.min(max, Math.max(min, n));
};

// Rearma el plan con solo los campos conocidos y verifica que las correlativas existan
function limpiar(b: any): Guardado | string {
  const meta = { carrera: txt(b?.carrera, 120), uni: txt(b?.uni, 100), ciudad: txt(b?.ciudad, 60), pais: txt(b?.pais, 40) };
  if (!meta.carrera || !meta.uni || !meta.ciudad || !meta.pais) return "faltan_datos";
  const ms = b?.plan?.materias;
  if (!Array.isArray(ms) || ms.length < 1 || ms.length > 250) return "plan_invalido";
  const materias: Materia[] = ms.map((m: any) => ({
    id: txt(m?.id, 12),
    nombre: txt(m?.nombre, 120),
    nivel: num(m?.nivel, 1, 10),
    tipo: ["anual", "cuatrimestral", "electiva"].includes(m?.tipo) ? m.tipo : "anual",
    cuat: ["1C", "2C"].includes(m?.cuat) ? m.cuat : "",
    hs: num(m?.hs, 0, 40),
    creditos: num(m?.creditos, 0, 30),
    reg: (Array.isArray(m?.reg) ? m.reg : []).slice(0, 40).map((x: unknown) => txt(x, 12)),
    apr: (Array.isArray(m?.apr) ? m.apr : []).slice(0, 40).map((x: unknown) => txt(x, 12)),
  }));
  const ids = new Set(materias.map((m) => m.id));
  if (ids.size !== materias.length || ids.has("")) return "plan_invalido";
  for (const m of materias) {
    if (!m.nombre) return "plan_invalido";
    if ([...m.reg, ...m.apr].some((c) => !ids.has(c))) return "plan_invalido";
  }
  const plan = { nombre: txt(b?.plan?.nombre, 120) || meta.carrera, creditosReq: num(b?.plan?.creditosReq, 0, 200), materias };
  return { meta: { ...meta, n: materias.length, f: new Date().toISOString().slice(0, 10), r: 0 }, plan };
}

// Mismo plan de la misma universidad → mismo id (evita duplicados)
async function idDe(g: Guardado): Promise<string> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const base = JSON.stringify([norm(g.meta.uni), norm(g.meta.carrera), g.plan.materias]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return [...new Uint8Array(hash)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function banco(req: Request, env: Env, path: string, ip: string, h: Record<string, string>): Promise<Response> {
  const partes = path.split("/").filter(Boolean); // ["planes", id?, "reportar"?]
  const id = partes[1] && /^[0-9a-f]{12}$/.test(partes[1]) ? partes[1] : null;
  if (partes[1] && !id) return json({ error: "no_encontrado" }, 404, h);

  if (req.method === "GET" && !id) {
    const lista: (Meta & { id: string })[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await env.PLANES.list<Meta>({ prefix: "plan:", cursor });
      for (const k of r.keys) if (k.metadata) lista.push({ id: k.name.slice(5), ...k.metadata });
      if (r.list_complete) break;
      cursor = r.cursor;
    }
    return json({ planes: lista }, 200, { ...h, "Cache-Control": "public, max-age=60" });
  }

  if (req.method === "GET" && id && partes.length === 2) {
    const g = await env.PLANES.get<Guardado>("plan:" + id, "json");
    if (!g) return json({ error: "no_encontrado" }, 404, h);
    return json({ id, ...g.meta, plan: g.plan }, 200, { ...h, "Cache-Control": "public, max-age=300" });
  }

  if (req.method !== "POST") return json({ error: "no_encontrado" }, 404, h);
  const { success } = await env.LIMITER_BANCO.limit({ key: ip });
  if (!success) return json({ error: "muchos_pedidos" }, 429, h);

  if (!id) {
    if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BODY) return json({ error: "muy_grande" }, 413, h);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "pedido_invalido" }, 400, h);
    }
    const g = limpiar(body);
    if (typeof g === "string") return json({ error: g }, 400, h);
    const nuevo = await idDe(g);
    if (await env.PLANES.get("plan:" + nuevo)) return json({ id: nuevo, ya_estaba: true }, 200, h);
    await env.PLANES.put("plan:" + nuevo, JSON.stringify(g), { metadata: g.meta });
    return json({ id: nuevo }, 201, h);
  }

  if (partes[2] === "reportar" && partes.length === 3) {
    const g = await env.PLANES.get<Guardado>("plan:" + id, "json");
    if (!g) return json({ ok: true }, 200, h);
    const yaAviso = "rep:" + id + ":" + ip;
    if (await env.PLANES.get(yaAviso)) return json({ ok: true }, 200, h);
    await env.PLANES.put(yaAviso, "1", { expirationTtl: 60 * 60 * 24 * 90 });
    g.meta.r = (g.meta.r || 0) + 1;
    if (g.meta.r >= OCULTAR_CON) {
      await env.PLANES.put("oculto:" + id, JSON.stringify(g)); // queda guardado para revisarlo a mano
      await env.PLANES.delete("plan:" + id);
    } else {
      await env.PLANES.put("plan:" + id, JSON.stringify(g), { metadata: g.meta });
    }
    return json({ ok: true }, 200, h);
  }
  return json({ error: "no_encontrado" }, 404, h);
}
