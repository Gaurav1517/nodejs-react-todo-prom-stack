# build stage
FROM node:18-alpine as build

WORKDIR /app
COPY package*.json ./
RUN npm install

# inject API URL into build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

# serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80