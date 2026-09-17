---
name: agenda-e2e-local-necesita-urls-de-mocks
description: En la máquina de desarrollo el `.env` no trae AGENDA ni las cuatro URLs de los mocks de Zoom/Google; sin ellas el self-test de la 015 le habla al Zoom real y el bloque Zoom sale con 5 FAIL por `invalid_client`. Un `.env.local` temporal (gitignored) los aporta sin tocar `.env`.
metadata:
  type: project
---

Visto el 2026-09-17 al verificar la corrección del agente incluido (015,
FR-023..FR-025). `pnpm test:e2e` con `AGENDA=on` dio 5 FAIL, todos del bloque
"conector Zoom contra su mock": «Zoom rechazó las credenciales:
invalid_client». No era el código: el conector lee `ZOOM_BASE_URL` /
`ZOOM_OAUTH_BASE_URL` de `getEnv()` y, sin definirlas, apunta a `api.zoom.us`.

**Why:** el `.env` de esta máquina nació sin agenda (la 015 se desarrolló en
otro worktree) y el self-test de la agenda depende de cuatro URLs que solo
documenta `specs/015-motor-agenda-universal/quickstart.md`, no `.env`.

**How to apply:** antes de un self-test con `AGENDA=on`, un `.env.local`
temporal (gitignored por `.env.*`; `next dev` lo carga sobre `.env`) con:

```
DATABASE_URL=<la de .env con /uniko_dev_e2eNNN>   # base desechable, pnpm db:dev la crea
AGENDA=on
ZOOM_BASE_URL=http://localhost:3000/api/dev/zoom-mock
ZOOM_OAUTH_BASE_URL=http://localhost:3000/api/dev/zoom-mock
GOOGLE_CAL_BASE_URL=http://localhost:3000/api/dev/google-mock
GOOGLE_OAUTH_BASE_URL=http://localhost:3000/api/dev/google-mock
```

y exportar las mismas vars en la shell del arnés (`node --env-file=.env` no
pisa lo que ya está en el entorno). Borrar `.env.local` y la base al terminar.
Sin `psql` en la máquina: la base se borra con un script de `postgres` (el
driver del repo). Ver también [[worktree-y-arneses-en-la-maquina-de-desarrollo]].
