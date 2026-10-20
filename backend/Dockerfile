FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY backend/package.json backend/
RUN npm ci --workspace shared --workspace backend --no-audit --no-fund
COPY shared shared
COPY backend backend
COPY samples samples
RUN npm run prisma:generate --workspace backend
ENV NODE_ENV=development PORT=4000
EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "backend"]
