FROM node:18-alpine as build

WORKDIR /app
COPY package*.json ./
RUN npm install

# Pass VITE_API_URL to vite build
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
