FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY frontend/package.json frontend/
RUN npm ci --workspace shared --workspace frontend --no-audit --no-fund
COPY shared shared
COPY frontend frontend
RUN npm run build --workspace frontend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "frontend", "--", "-p", "3000"]
