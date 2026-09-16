FROM node:22-alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js config.js ./
RUN mkdir -p data
EXPOSE 4000
VOLUME ["/app/data"]
CMD ["node", "index.js"]
