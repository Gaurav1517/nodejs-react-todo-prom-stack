FROM node:18-alpine
WORKDIR /usr/src/app

# install bash + curl
RUN apk add --no-cache bash curl

# copy backend package.json and install
COPY backend/package*.json ./
RUN npm install --production

# copy backend source
COPY backend/ ./

# copy script from project scripts folder
COPY scripts/load_test.sh /app/load_test.sh
RUN chmod +x /app/load_test.sh

# ensure logs directory exists
RUN mkdir -p /var/log

EXPOSE 4000
CMD ["node", "server.js"]


# FROM node:18-alpine
# WORKDIR /usr/src/app
# COPY package*.json ./
# RUN npm install --production
# COPY . .
# RUN mkdir -p /var/log
# # Copy load test script into container
# COPY scripts/load_test.sh /app/load_test.sh
# RUN chmod +x /app/load_test.sh
# # Install bash + curl for Alpine
# RUN apk add --no-cache bash curl
# EXPOSE 4000
# CMD ["node", "server.js"]
