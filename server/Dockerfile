# Image de production du serveur Pagio : Node.js 24 + LibreOffice (conversions haute fidélité) + tableau de bord.
# Construction depuis le dossier app/ :   docker build -f server/Dockerfile -t pagio-server .
# Lancement :   docker run -d -p 8787:8787 -v pagio-data:/data -e ADMIN_EMAIL=vous@exemple.com -e ADMIN_PASSWORD='...' pagio-server

FROM node:24-bookworm-slim AS dashboard
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu fonts-liberation qpdf ghostscript \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1500 --no-create-home --shell /usr/sbin/nologin conversion
WORKDIR /srv/pagio
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=dashboard /build/dist ./dist
# LibreOffice est lancé sous le compte « conversion » (sans droits, sans accès à /data).
ENV PORT=8787 DATA_DIR=/data DIST_DIR=/srv/pagio/dist SOFFICE_PATH=soffice SOFFICE_UID=1500 NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
