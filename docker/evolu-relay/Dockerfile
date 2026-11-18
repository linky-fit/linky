FROM node:24-alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
# @evolu/nodejs lists build tools as optional peers whose pins conflict; the relay needs none.
RUN npm install --omit=dev --legacy-peer-deps
COPY index.js config.js ./
RUN mkdir -p data
EXPOSE 4000
VOLUME ["/app/data"]
CMD ["node", "index.js"]
