# Use official Node.js LTS image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Build TypeScript
RUN npx tsc

# Expose the port your app runs on (change if needed)
EXPOSE 3001

# Start the server
CMD ["node", "src/index.js"] 