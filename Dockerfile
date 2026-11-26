FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Only what the server reads; scripts/ is for `npm run seed` and `analyse`.
COPY server.js ./
COPY lib lib
COPY data data
COPY survey survey
COPY public public
COPY scripts scripts
USER node
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --start-interval=2s CMD wget -qO- http://127.0.0.1:4400/healthz || exit 1
CMD ["node", "server.js"]
