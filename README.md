# Oversells

**Oversells** is an online LaTeX editor — in the spirit of Overleaf — built for
teachers and educational publishers. It puts first-class support for **Uzbek
(Latin and Cyrillic)** textbooks and mathematical content at the centre:
new projects start from a textbook template that compiles out of the box with
XeLaTeX/LuaLaTeX, Uzbek letters (oʻ, gʻ, ʼ, ў, қ, ғ, ҳ), `amsmath`, `tikz`
and `pgfplots`.

> **Status: Phase 1 (MVP).** Single user, no accounts. Run it on your own
> computer or a trusted network only — do not expose Phase 1 to the internet.
> See [PLAN.md](PLAN.md) for the architecture and the roadmap (accounts and
> sharing, real-time collaboration, SyncTeX, AI help, …).

## Features (Phase 1)

- Project list: create, rename, delete, download as ZIP.
- Multi-file projects: `.tex`, `.bib`, `.sty`, `.cls`, images (`png`, `jpg`,
  `pdf`, `eps`), fonts (`ttf`, `otf`), data files; folders; upload, rename/move,
  delete; choose the main file.
- Code editor (CodeMirror 6) with LaTeX highlighting, command completion,
  search, per-file undo history and **auto-save**.
- **Compile** button (or `Ctrl/Cmd+Enter`): the PDF appears next to the
  editor; pdfLaTeX, XeLaTeX or LuaLaTeX per project.
- Readable errors and warnings with file and line — **click an error to jump to
  the line**. Full raw log available.
- Download the PDF.
- Interface in Uzbek (default), Russian and English.
- Security: every compilation runs in a throw-away Docker container with **no
  network**, read-only file system, CPU/memory/process limits, a 60 s time
  limit and shell-escape disabled. File paths and names are validated
  (no path traversal), uploads are limited by size and type.

## Requirements

- **Docker** with Docker Compose v2.24+ (Docker Desktop on Windows/macOS, or
  Docker Engine on Linux). This is all you need to run Oversells.
- About **3 GB** of free disk space (the TeX Live image is ~1.7 GB).
- For development without Docker for the app itself: **Node.js 22+** and npm.
  Compilation always needs Docker.

## Run it (one command)

```bash
git clone <this repository> oversells
cd oversells
cp .env.example .env        # optional, the defaults work
docker compose up --build
```

The first start downloads Ubuntu/TeX Live packages and builds two images; this
takes several minutes. When you see `Server listening`, open
**http://localhost:3000**.

- Stop: `Ctrl+C`, or `docker compose down`.
- Data (projects, PDFs, database) lives in the Docker volumes `oversells_app-data`
  and `oversells_db-data`; `docker compose down -v` deletes it.
- Port 3000 or 5432 taken? Set `APP_PORT` / `DB_PORT` in `.env`.

What `docker compose up` starts:

| Service | What it does |
|---|---|
| `db` | PostgreSQL 16 |
| `compiler` | Builds the `oversells-texlive` sandbox image, then exits (this is expected) |
| `app` | API server + web interface on port 3000; starts one sandbox container per compile through the Docker socket |

## Development

```bash
npm install
docker compose up -d db                 # PostgreSQL only
npm run compiler:build                  # build the TeX Live sandbox image once
cp .env.example .env
npm run db:migrate                      # create the tables
npm run dev                             # API on :3000, web on http://localhost:5173
```

`npm run dev` runs the API with auto-reload (`tsx watch`) and the Vite dev
server, which proxies `/api` to port 3000.

Useful scripts (repository root):

| Script | Description |
|---|---|
| `npm run dev` | API + web in development mode |
| `npm run build` | Production build of web and server |
| `npm run typecheck` | TypeScript checks for all packages |
| `npm test` | Unit tests (shared + server) |
| `npm run test:e2e` | End-to-end tests (needs Docker and the compiler image) |
| `npm run compiler:build` | Build the TeX Live sandbox image |

## Tests

```bash
docker compose up -d db          # tests need PostgreSQL
npm test                         # unit tests
npm run compiler:build           # once, for the e2e tests
npm run test:e2e                 # API e2e + browser e2e
```

- **Unit tests** (Vitest): path validation and file-name sanitising, storage,
  project and file CRUD through the HTTP API (uploads, limits, path traversal,
  folder operations, ZIP), the compile queue (dedupe, concurrency, timeouts,
  output pruning, restart recovery) and the LaTeX log parser (real log
  fixtures). They use a separate database, `oversells_test`, derived from
  `DATABASE_URL` (override with `TEST_DATABASE_URL`); its name must contain
  `test`. Migrations are applied automatically; tables are truncated between
  tests.
- **API end-to-end** (`apps/server/test/e2e`): real HTTP server + PostgreSQL +
  Docker sandbox. Creates projects, compiles the Uzbek template with XeLaTeX
  and LuaLaTeX and checks the PDF; checks error locations; checks that
  `\write18` and reading `/etc/passwd` are blocked. Skipped automatically if
  Docker or the compiler image is missing.
- **Browser end-to-end** (`apps/web/e2e`, Playwright): needs a running
  instance on `http://localhost:3000` (e.g. `docker compose up`); set
  `E2E_BASE_URL` for another address. Creates a project in the UI, compiles,
  waits for the rendered PDF, introduces an error, clicks it and checks that
  the editor jumps to the line. Install a browser once with
  `npx playwright install chromium`.

## Project structure

```
.
├── PLAN.md               architecture, API, data model, roadmap, decisions
├── docker-compose.yml    db + compiler image + app
├── Dockerfile            app image (server + built web client)
├── .env.example          configuration with defaults
├── compiler/             TeX Live sandbox image (Dockerfile, entry script)
├── packages/shared/      shared TypeScript: API types, path/file-name rules
├── apps/server/          Fastify API, Prisma schema & migrations, templates, tests
│   ├── src/compile/      Docker runner, compile queue, LaTeX log parser
│   ├── src/files/        file service and validation
│   ├── src/projects/     project service, templates, ZIP export
│   ├── src/storage/      Storage interface + local disk implementation
│   └── templates/        project templates (uzbek-textbook, blank)
└── apps/web/             React + Vite client (CodeMirror 6, PDF.js, i18n)
```

## Configuration

All settings are environment variables; see [.env.example](.env.example) for
the full list with defaults. The most important ones:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | – | PostgreSQL connection string |
| `DATA_DIR` | `./data` | Where file contents and PDFs are stored |
| `COMPILE_TIMEOUT_MS` | `60000` | Wall-clock limit per compile |
| `COMPILE_MEMORY_MB` / `COMPILE_CPUS` | `1024` / `1` | Sandbox resources |
| `COMPILE_CONCURRENCY` | `2` | Parallel compiles |
| `MAX_UPLOAD_BYTES` | 20 MB | Upload size limit |

## Writing Uzbek documents

The default template (`main.tex`) shows the recommended setup:

```latex
\usepackage{fontspec}
\setmainfont{Noto Serif}                 % covers Uzbek Latin and Cyrillic
\usepackage{babel}
\babelprovide[import=uz-Latn, main]{uzbek}
\babelprovide[import=uz-Cyrl]{uzbekcyr}  % \begin{otherlanguage}{uzbekcyr} ... \end{otherlanguage}
```

- Use the proper characters **ʻ** (U+02BB) in oʻ/gʻ and **ʼ** (U+02BC) for the
  tutuq belgisi. Fonts available in the sandbox include Noto Serif/Sans,
  CMU Serif (Computer Modern look — its *italic* lacks ʻ) and DejaVu.
- Compile with **XeLaTeX** (default) or **LuaLaTeX**; pdfLaTeX cannot use
  `fontspec`.
- There are no Uzbek hyphenation patterns in TeX Live, so the template sets
  `\emergencystretch` to avoid overfull lines.
- You can upload your own `.ttf`/`.otf` fonts and load them with
  `\setmainfont{MyFont.ttf}`.

## Security notes

- The app container mounts the Docker socket to start compile containers;
  this is equivalent to root access on the host. Keep Phase 1 on trusted
  machines. A separate compile worker is planned (PLAN.md, Phase 4).
- Compile containers: no network, read-only root, `tmpfs` work directory,
  all capabilities dropped, `no-new-privileges`, unprivileged user,
  memory/CPU/PID limits, 60 s timeout, `latexmk -norc`, `-no-shell-escape`,
  `openin_any=p`/`openout_any=p`.
