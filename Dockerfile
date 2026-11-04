# shipstation-e2e-ui — the built desk and its /api, one process, no npm packages at run time (server/ uses node: only).
#   docker build -t shipstation-e2e-ui .
#   docker run --env-file .env -e PUBLIC_ORIGIN=https://desk.example.com -p 5190:5190 shipstation-e2e-ui
# The image listens on 0.0.0.0, so it refuses to start without ACCESS_CODE (server/access.mjs). Keys come from the
# environment: .env is never copied into the image (.dockerignore).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm test && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5190
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5190
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/serve.mjs"]
