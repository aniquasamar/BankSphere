# ---- install production dependencies in their own layer (cached until package*.json changes)
FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime image
FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Uploads are written to public/<folder>; make sure the non-root user can write there.
RUN mkdir -p public && chown -R node:node /app/public
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "./bin/www"]