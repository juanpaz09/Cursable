# Cursable

Cargá tu plan de estudios, marcá cómo tenés cada materia y la app te dice:

- **Mapa:** toda la carrera en cuadraditos de colores (aprobada, regular, media promoción, cursando, falta).
- **Cursar:** qué materias podés cursar el año que viene y cuáles se te abren si rendís ciertos finales.
- **Armar:** elegí qué cursar según las horas que tenés y mirá qué se te habilita después.
- **¿Y si?:** qué materias del año que viene te bloquea abandonar o desaprobar cada una.
- **Finales:** qué finales rendir primero, incluidas las medias promociones que se te vencen.

Viene con Ingeniería Industrial Plan 2023 (UTN FRC). Para cargar otra carrera:

- **Buscarla en el banco:** planes que compartió otra gente, por universidad, carrera, ciudad y país. Lo ves entero antes de usarlo.
- **Subir el PDF:** la app lo lee con Claude (necesita el servidor de abajo).
- **Usar tu propia IA:** la app te da un pedido para pegar en ChatGPT, Gemini o Claude junto con el PDF, y pegás la respuesta. No gasta nada del servidor.
- **A mano** o **pegando un plan** que alguien te pasó.

Tu avance se guarda en tu dispositivo. Si creás tu **código personal** (abajo de todo en la app), también se guarda en el servidor con ese código, y en otro celu entrás poniéndolo, sin cuenta ni contraseña. Al banco va únicamente el plan, si elegís compartirlo.

## Instalarla en el celu

Abrí la página y:

- **Android (Chrome):** menú ⋮ → *Agregar a la pantalla principal* o *Instalar app*.
- **iPhone (Safari):** botón Compartir → *Agregar a inicio*.

## Cómo está hecha

Un solo `index.html` sin dependencias de compilación, más `manifest.webmanifest` y `sw.js` para instalarla y usarla sin internet. Se publica con GitHub Pages desde la rama `main`.

## Servidor (carpeta `worker/`)

Un servidor chico en Cloudflare Workers hace dos cosas:

- `/leer`: recibe el PDF y se lo pasa a Claude. La clave de API de Anthropic vive solo ahí, como secreto.
- `/sync`: el código personal (por ejemplo `PUMA-ROBLE-1234`) para llevar tu avance a otro dispositivo. Guarda solo cuando hay cambios, como mucho cada 15 segundos.
- `/planes`: el banco de planes compartidos, guardado en Cloudflare KV (Cloudflare lo crea solo al publicar). No usa Claude: funciona aunque no cargues la clave.

1. **Clave de Claude:** en [console.anthropic.com](https://console.anthropic.com) creá una cuenta, cargá crédito, poné un límite de gasto mensual y creá una API key.
2. **Cloudflare:** en [dash.cloudflare.com](https://dash.cloudflare.com) → *Workers & Pages* → *Create* → *Import a repository* → elegí este repo y poné `worker` como *root directory*. Cada push a `main` lo vuelve a publicar.
3. **Secreto:** en el Worker → *Settings* → *Variables and Secrets* → agregá `ANTHROPIC_API_KEY` como **Secret**.
4. Copiá la dirección del Worker (`https://cursable.<tu-subdominio>.workers.dev`) y ponela en `LECTOR_URL` dentro de `index.html`.

Protecciones: solo acepta envíos desde `ALLOWED_ORIGINS` (en `wrangler.toml`), hasta 3 lecturas por minuto por IP y archivos de hasta 12 MB. En el banco: hasta 10 envíos por minuto por IP, se valida que cada correlativa exista, el mismo plan no se duplica, y un plan con avisos de 3 personas distintas se oculta (queda guardado como `oculto:<id>` para revisarlo).

Límites del plan gratis de Cloudflare: KV permite unas 1.000 escrituras por día. Cada guardado del código personal y cada plan compartido es una escritura. Si Cursable crece y se queda corto, el plan Workers Paid (USD 5 por mes) lo lleva a 1 millón por mes.
