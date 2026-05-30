# Node SubUrl ChatRoom

A lightweight, real-time chat room application built with Node.js, Express, Socket.io, and EJS. Supports multiple isolated rooms via URL sub-paths.

## Features

- **Multi-room**: Create/join rooms via URL path (e.g., `/gaming`, `/friends`)
- **Private messages**: `@username` or `/w username` syntax
- **Admin controls**: First user in a room becomes admin with mute/unmute powers
- **Mute system**: IP-based mute with configurable duration
- **Message search**: Search through chat history
- **Emoji picker**: Built-in emoji selector
- **Dark/Light theme**: Toggle between themes
- **Mobile responsive**: Drawer-style user list on mobile devices
- **Auto-reconnect**: Socket.io handles reconnection seamlessly
- **Message history cache**: 15-minute message retention for mobile reconnection — when mobile browser switches away and back, missed messages are automatically restored
- **Desktop notifications**: Browser push notifications for new messages, private chats, and @mentions (user-toggleable)
- **Title blink**: Page title flashes on new messages when the tab is in the background

## Quick Start

```bash
npm install
npm start
```

Server runs at `http://localhost:3000` by default. Configure port via `.env` file:

```
PORT=8080
```

### Access Rooms

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Auto-redirects to `default` room |
| `http://localhost:3000/gaming` | Join `gaming` room |
| `http://localhost:3000/friends` | Join `friends` room |

## Usage

- **Nickname**: Saved in `localStorage` per room. Use the "Change Nickname" button to switch.
- **Private chat**: Click a user in the online list to `@mention`, or use `/w username message`.
- **Admin**: The first user in a room becomes admin. Hover over a user to see the mute button.

## Deployment

### Deploy to a VPS (Linux)

```bash
# Install Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone https://github.com/sonictl/node_suburl_chatroom.git
cd node_suburl_chatroom
npm install --production

# Create .env file
echo "PORT=3000" > .env

# Run with process manager (recommended)
npm install -g pm2
pm2 start server.js --name chatroom
pm2 save
pm2 startup
```

### Deploy with Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t chatroom .
docker run -d -p 3000:3000 --name chatroom chatroom
```

### Deploy to Railway / Render / Fly.io

1. Connect your GitHub repository
2. Set build command: `npm install`
3. Set start command: `node server.js`
4. Set environment variable `PORT` if needed

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name chat.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: EJS, Tailwind CSS, DaisyUI
- **Storage**: In-memory (no database required)

## License

ISC
