const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// configure EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage
const rooms = new Map();

// Route - match /:roomId
app.get('/:roomId', (req, res) => {
  const { roomId } = req.params;
  res.render('index', { roomId });
});

// Root route redirects to random room
app.get('/', (req, res) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let roomId = '';
  for (let i = 0; i < 4; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  res.redirect('/' + roomId);
});

// Socket.io logic
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentNickname = null;

  // Join room
  socket.on('join', ({ roomId, nickname }) => {
    // Initialize room
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        nicknamesSet: new Set(),
        mutedIPs: new Map() // IP -> { until: timestamp }
      });
    }

    const room = rooms.get(roomId);

    // Check if nickname is already taken
    if (room.nicknamesSet.has(nickname)) {
      socket.emit('join-error', { message: 'Nickname is already taken' });
      return;
    }

    // Check if muted
    const clientIP = socket.handshake.address;
    if (room.mutedIPs.has(clientIP)) {
      const muteInfo = room.mutedIPs.get(clientIP);
      if (Date.now() < muteInfo.until) {
        socket.emit('join-error', { message: `You are muted, ${Math.ceil((muteInfo.until - Date.now()) / 1000)} seconds remaining` });
        return;
      } else {
        room.mutedIPs.delete(clientIP);
      }
    }

    // Leave previous room
    if (currentRoom) {
      leaveCurrentRoom(socket, currentRoom, currentNickname);
    }

    // Join new room
    currentRoom = roomId;
    currentNickname = nickname;
    socket.join(roomId);

    room.users.set(socket.id, { nickname, socket });
    room.nicknamesSet.add(nickname);

    // Notify other users in the room
    socket.to(roomId).emit('message', {
      id: uuidv4(),
      type: 'system',
      from: '系统',
      to: null,
      content: `${nickname} joined the room`,
      timestamp: Date.now(),
      roomId
    });

    // Send online users list to new user
    const onlineUsers = Array.from(room.users.values()).map(u => u.nickname);
    socket.emit('online-users', onlineUsers);
    // Also notify other users to update list
    socket.to(roomId).emit('online-users', onlineUsers);

    // Confirm join success
    socket.emit('join-success', { nickname, roomId });
  });

  // Handle regular chat messages
  socket.on('chat-message', ({ content }) => {
    if (!currentRoom || !currentNickname) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    // Check mute status
    const clientIP = socket.handshake.address;
    if (room.mutedIPs.has(clientIP)) {
      const muteInfo = room.mutedIPs.get(clientIP);
      if (Date.now() < muteInfo.until) {
        socket.emit('message', {
          id: uuidv4(),
          type: 'system',
          from: '系统',
          to: null,
          content: `你已被禁言，剩余 ${Math.ceil((muteInfo.until - Date.now()) / 1000)} 秒`,
          timestamp: Date.now(),
          roomId: currentRoom
        });
        return;
      } else {
        room.mutedIPs.delete(clientIP);
      }
    }

    const message = {
      id: uuidv4(),
      type: 'chat',
      from: currentNickname,
      to: null,
      content,
      timestamp: Date.now(),
      roomId: currentRoom
    };

    io.to(currentRoom).emit('message', message);
  });

  // Handle private messages
  socket.on('private-message', ({ to, content }) => {
    if (!currentRoom || !currentNickname) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    // Check mute status
    const clientIP = socket.handshake.address;
    if (room.mutedIPs.has(clientIP)) {
      const muteInfo = room.mutedIPs.get(clientIP);
      if (Date.now() < muteInfo.until) {
        socket.emit('message', {
          id: uuidv4(),
          type: 'system',
          from: '系统',
          to: null,
          content: `你已被禁言，剩余 ${Math.ceil((muteInfo.until - Date.now()) / 1000)} 秒`,
          timestamp: Date.now(),
          roomId: currentRoom
        });
        return;
      } else {
        room.mutedIPs.delete(clientIP);
      }
    }

    // Find target user
    let targetSocketId = null;
    for (const [sid, user] of room.users) {
      if (user.nickname === to) {
        targetSocketId = sid;
        break;
      }
    }

    if (!targetSocketId) {
      socket.emit('message', {
        id: uuidv4(),
        type: 'system',
        from: '系统',
        to: null,
        content: `User ${to} is not online or does not exist`,
        timestamp: Date.now(),
        roomId: currentRoom
      });
      return;
    }

    // Send to recipient
    io.to(targetSocketId).emit('message', {
      id: uuidv4(),
      type: 'private',
      from: currentNickname,
      to,
      content,
      timestamp: Date.now(),
      roomId: currentRoom
    });

    // Send to sender (self)
    socket.emit('message', {
      id: uuidv4(),
      type: 'private',
      from: currentNickname,
      to,
      content,
      timestamp: Date.now(),
      roomId: currentRoom,
      isSelf: true
    });
  });

  // Handle typing status
  socket.on('typing', ({ isTyping }) => {
    if (!currentRoom || !currentNickname) return;
    socket.to(currentRoom).emit('typing-status', {
      nickname: currentNickname,
      isTyping
    });
  });

  // Handle leaving room
  socket.on('leave-room', ({ roomId, nickname }) => {
    if (currentRoom === roomId && currentNickname === nickname) {
      leaveCurrentRoom(socket, roomId, nickname);
      currentRoom = null;
      currentNickname = null;
    }
  });

  // Handle mute (admin feature)
  socket.on('mute-user', ({ targetNickname, duration }) => {
    if (!currentRoom || !currentNickname) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Simple admin: first user to enter room is admin
    const firstUser = room.users.values().next().value;
    if (!firstUser || firstUser.nickname !== currentNickname) {
      socket.emit('message', {
        id: uuidv4(),
        type: 'system',
        from: '系统',
        to: null,
        content: 'You are not an admin, cannot mute users',
        timestamp: Date.now(),
        roomId: currentRoom
      });
      return;
    }

    // Find target user's socket
    let targetSocket = null;
    let targetIP = null;
    for (const [sid, user] of room.users) {
      if (user.nickname === targetNickname) {
        targetSocket = user.socket;
        targetIP = targetSocket.handshake.address;
        break;
      }
    }

    if (!targetSocket) {
      socket.emit('message', {
        id: uuidv4(),
        type: 'system',
        from: '系统',
        to: null,
        content: `User ${targetNickname} is not online`,
        timestamp: Date.now(),
        roomId: currentRoom
      });
      return;
    }

    const until = Date.now() + duration * 1000;
    room.mutedIPs.set(targetIP, { until });

    // Notify muted user
    io.to(targetSocket.id).emit('message', {
      id: uuidv4(),
      type: 'system',
      from: '系统',
      to: null,
      content: `You have been muted by admin for ${duration} seconds`,
      timestamp: Date.now(),
      roomId: currentRoom
    });

    // Notify admin
    socket.emit('message', {
      id: uuidv4(),
      type: 'system',
      from: '系统',
      to: null,
      content: `User ${targetNickname} has been muted for ${duration} seconds`,
      timestamp: Date.now(),
      roomId: currentRoom
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoom && currentNickname) {
      leaveCurrentRoom(socket, currentRoom, currentNickname);
    }
  });
});

function leaveCurrentRoom(socket, roomId, nickname) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.delete(socket.id);
  room.nicknamesSet.delete(nickname);

  // Notify other users
  socket.to(roomId).emit('message', {
    id: uuidv4(),
    type: 'system',
    from: '系统',
    to: null,
    content: `${nickname} left the room`,
    timestamp: Date.now(),
    roomId
  });

  // Update online users list
  const onlineUsers = Array.from(room.users.values()).map(u => u.nickname);
  io.to(roomId).emit('online-users', onlineUsers);

  socket.leave(roomId);

  // Clean up empty rooms
  if (room.users.size === 0) {
    rooms.delete(roomId);
  }
}

server.listen(PORT, () => {
  console.log(`Chat server running at http://localhost:${PORT}`);
});
