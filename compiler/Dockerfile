# Oversells LaTeX compiler image.
#
# Each compile job runs in a fresh, short-lived container created from this
# image with: no network, read-only root filesystem, dropped capabilities,
# CPU/memory/pids limits and size-limited tmpfs mounts for /work and /tmp.
#
# Protocol: the project files arrive as a tar stream on stdin, the outputs
# (PDF, log, SyncTeX) leave as a tar stream on stdout, latexmk's own output goes
# to stderr. No host directories are mounted.
# See apps/server/src/compile/docker-runner.ts.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      latexmk \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-xetex \
      texlive-luatex \
      texlive-fonts-recommended \
      texlive-pictures \
      texlive-science \
      texlive-lang-cyrillic \
      texlive-lang-english \
      texlive-plain-generic \
      texlive-bibtex-extra \
      biber \
      cm-super \
      lmodern \
      fonts-noto-core \
      fonts-dejavu-core \
      fonts-dejavu-extra \
      fonts-cmu \
      fonts-texgyre-math \
      fonts-inter \
      fonts-lato \
      fontconfig \
      poppler-utils \
      pandoc \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*

# Unprivileged user that runs every compile.
RUN useradd --uid 1001 --create-home --home-dir /home/tex --shell /usr/sbin/nologin tex \
 && mkdir -p /work && chown tex:tex /work

# Uzbek hyphenation patterns (TeX Live has none): see hyphenation/generate.py.
COPY hyphenation /tmp/hyphenation
RUN sh /tmp/hyphenation/install.sh && rm -rf /tmp/hyphenation
# Uzbek captions (Mundarija, Rasm, Jadval, Koʻrsatkich...): TeX Live's babel leaves them empty.
COPY babel-uz/captions.py /tmp/captions.py
RUN python3 /tmp/captions.py && rm /tmp/captions.py
# pdfLaTeX: the Uzbek letters ʻ and ʼ (oʻ, gʻ, maʼno) instead of an error.
COPY babel-uz/okina-pdftex.sh /tmp/okina-pdftex.sh
RUN sh /tmp/okina-pdftex.sh && rm /tmp/okina-pdftex.sh

# TeX Gyre text fonts (Heros, Termes, Pagella, Adventor, ...) as OTF: books ask for
# them by file name (\setmainfont{texgyreheros}[Extension=.otf,...]) or by name.
# A layer of its own so that adding it does not reinstall TeX Live.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-texgyre \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/*

# Warm the font caches at build time so that jobs (which run with a read-only
# root filesystem) do not have to rebuild them on every compile.
ENV TEXMFSYSVAR=/var/lib/texmf
COPY warmup.tex /tmp/warmup/warmup.tex
RUN fc-cache -f \
 && mktexlsr \
 && export TEXMFVAR=/var/lib/texmf \
 && luaotfload-tool --update --force \
 && cd /tmp/warmup && lualatex -interaction=nonstopmode warmup.tex >/dev/null \
 && cd / && rm -rf /tmp/warmup \
 && chmod -R a+rX /var/lib/texmf

COPY run-latexmk.sh /usr/local/bin/run-latexmk
COPY run-convert.sh /usr/local/bin/run-convert
COPY oversells-index.pl /usr/local/bin/oversells-index
RUN chmod 0755 /usr/local/bin/run-latexmk /usr/local/bin/run-convert /usr/local/bin/oversells-index

USER tex
WORKDIR /work
# Writable per-user TeX caches live on the /tmp tmpfs created per job.
# openin_any/openout_any=p: TeX may not read or write files outside the work
# directory and TeX trees (e.g. \input{/etc/passwd} is refused).
# max_print_line etc. stop TeX from wrapping log lines at 79 characters,
# which keeps "file:line: error" messages parseable.
ENV HOME=/tmp \
    TEXMFVAR=/tmp/texmf-var \
    TEXMFCONFIG=/tmp/texmf-config \
    openout_any=p \
    openin_any=p \
    max_print_line=10000 \
    error_line=254 \
    half_error_line=238

ENTRYPOINT ["/usr/local/bin/run-latexmk"]
