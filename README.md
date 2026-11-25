# Cursable

Cargá tu plan de estudios, marcá cómo tenés cada materia y la app te dice:

- **Mapa:** toda la carrera en cuadraditos de colores (aprobada, regular, media promoción, cursando, falta).
- **Cursar:** qué materias podés cursar el año que viene y cuáles se te abren si rendís ciertos finales.
- **Armar:** elegí qué cursar según las horas que tenés y mirá qué se te habilita después.
- **¿Y si?:** qué materias del año que viene te bloquea abandonar o desaprobar cada una.
- **Finales:** qué finales rendir primero, incluidas las medias promociones que se te vencen.

Viene con Ingeniería Industrial Plan 2023 (UTN FRC). Otras carreras se cargan a mano o pegando un plan que alguien compartió.

Todo se guarda en tu dispositivo. No hay cuentas ni servidor.

## Instalarla en el celu

Abrí la página y:

- **Android (Chrome):** menú ⋮ → *Agregar a la pantalla principal* o *Instalar app*.
- **iPhone (Safari):** botón Compartir → *Agregar a inicio*.

## Cómo está hecha

Un solo `index.html` sin dependencias de compilación, más `manifest.webmanifest` y `sw.js` para instalarla y usarla sin internet. Se publica con GitHub Pages desde la rama `main`.
