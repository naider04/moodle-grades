# Grade Insight

Analizador académico de calificaciones para Moodle UNEMI.

Calcula la nota final real de cada asignatura según el sistema SGA de UNEMI, incluyendo el detalle de cada categoría (N1, N2, EXP1, etc.) y su contribución ponderada a la nota final.

## Características

- Compatible con **aulagradoa.unemi.edu.ec** (presencial) y **aulagradob.unemi.edu.ec** (en línea)
- Soporte para URL personalizada de cualquier instancia Moodle
- Extracción automática del nombre de la carrera desde las categorías del curso
- Cálculo preciso de la nota final según la fórmula SGA:
  - `P1 = N1 + N2 + EXP1` (máx 35)
  - `P2 = N3 + N4 + EXP2` (máx 35) — EXT no incluido
  - `EXT` categoría separada (máx 30)
  - `Total = P1 + P2 + EXT` (máx 100)
  - Si `RE > 0`: `Total = ceil((P1 + P2 + EXT + RE) / 2)`
- Vista expandible por asignatura con detalle de actividades, rendimiento y aporte

## Requisitos

- Node.js 16+

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

Abrir en el navegador: `http://localhost:3001`

## Despliegue

Esta aplicación requiere un **servidor Node.js** (no funciona en GitHub Pages ni en sitios estáticos).

### Vercel (recomendado)

Conectar el repositorio de GitHub a Vercel. La configuración se detecta automáticamente desde `vercel.json`:

| Configuración | Valor |
|---------------|-------|
| Framework | Other |
| Build Command | `npm install` |
| Output Directory | `public` |
| Root Directory | `GradeInsight/` |

### Local

```bash
npm install
npm start
# Abrir http://localhost:3001
```

## Stack

- **Backend:** Node.js + Express
- **Frontend:** HTML + CSS + JavaScript vanilla
- **API:** Moodle REST webservices (`moodle_mobile_app`)

## Licencia

MIT
