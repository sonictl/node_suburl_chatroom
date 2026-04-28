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

// 设置 EJS 模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 内存存储
const rooms = new Map();

// 路由 - 匹配 /:roomId
app.get('/:roomId', (req, res) => {
  const { roomId } = req.params;
  res.render('index', { roomId });
});

// 根路由重定向到随机房间
app.get('/', (req, res) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let roomId = '';
  for (let i = 0; i < 4; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  res.redirect('/' + roomId);
});

// Socket.io 逻辑
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentNickname = null;

  // 加入房间
  socket.on('join', ({ roomId, nickname }) => {
    // 初始化房间
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        nicknamesSet: new Set(),
        mutedIPs: new Map() // IP -> { until: timestamp }
      });
    }

    const room = rooms.get(roomId);

    // 检查昵称是否已被占用
    if (room.nicknamesSet.has(nickname)) {
      socket.emit('join-error', { message: '昵称已被占用' });
      return;
    }

    // 检查是否被禁言
    const clientIP = socket.handshake.address;
    if (room.mutedIPs.has(clientIP)) {
      const muteInfo = room.mutedIPs.get(clientIP);
      if (Date.now() < muteInfo.until) {
        socket.emit('join-error', { message: `你已被禁言，剩余 ${Math.ceil((muteInfo.until - Date.now()) / 1000)} 秒` });
        return;
      } else {
        room.mutedIPs.delete(clientIP);
      }
    }

    // 离开之前的房间
    if (currentRoom) {
      leaveCurrentRoom(socket, currentRoom, currentNickname);
    }

    // 加入新房间
    currentRoom = roomId;
    currentNickname = nickname;
    socket.join(roomId);

    room.users.set(socket.id, { nickname, socket });
    room.nicknamesSet.add(nickname);

    // 通知房间内其他用户
    socket.to(roomId).emit('user-join', { nickname });
    socket.to(roomId).emit('message', {
      id: uuidv4(),
      type: 'system',
      from: '系统',
      to: null,
      content: `${nickname} 加入了房间`,
      timestamp: Date.now(),
      roomId
    });

    // 发送在线用户列表给新用户
    const onlineUsers = Array.from(room.users.values()).map(u => u.nickname);
    socket.emit('online-users', onlineUsers);
    // 也通知其他用户更新列表
    socket.to(roomId).emit('online-users', onlineUsers);

    // 确认加入成功
    socket.emit('join-success', { nickname, roomId });
  });

  // 处理普通聊天消息
  socket.on('chat-message', ({ content }) => {
    if (!currentRoom || !currentNickname) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    // 检查禁言
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

  // 处理私聊消息
  socket.on('private-message', ({ to, content }) => {
    if (!currentRoom || !currentNickname) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    // 检查禁言
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

    // 查找目标用户
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
        content: `用户 ${to} 不在线或不存在`,
        timestamp: Date.now(),
        roomId: currentRoom
      });
      return;
    }

    // 发送给接收方
    io.to(targetSocketId).emit('message', {
      id: uuidv4(),
      type: 'private',
      from: currentNickname,
      to,
      content,
      timestamp: Date.now(),
      roomId: currentRoom
    });

    // 发送给发送方（自己能看到）
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

  // 处理打字状态
  socket.on('typing', ({ isTyping }) => {
    if (!currentRoom || !currentNickname) return;
    socket.to(currentRoom).emit('typing-status', {
      nickname: currentNickname,
      isTyping
    });
  });

  // 处理离开房间
  socket.on('leave-room', ({ roomId, nickname }) => {
    if (currentRoom === roomId && currentNickname === nickname) {
      leaveCurrentRoom(socket, roomId, nickname);
      currentRoom = null;
      currentNickname = null;
    }
  });

  // 处理禁言（管理员功能）
  socket.on('mute-user', ({ targetNickname, duration }) => {
    if (!currentRoom || !currentNickname) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // 简单管理员机制：第一个进入房间的用户是管理员
    const firstUser = room.users.values().next().value;
    if (!firstUser || firstUser.nickname !== currentNickname) {
      socket.emit('message', {
        id: uuidv4(),
        type: 'system',
        from: '系统',
        to: null,
        content: '你不是管理员，无法禁言用户',
        timestamp: Date.now(),
        roomId: currentRoom
      });
      return;
    }

    // 查找目标用户的 socket
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
        content: `用户 ${targetNickname} 不在线`,
        timestamp: Date.now(),
        roomId: currentRoom
      });
      return;
    }

    const until = Date.now() + duration * 1000;
    room.mutedIPs.set(targetIP, { until });

    // 通知被禁言用户
    io.to(targetSocket.id).emit('message', {
      id: uuidv4(),
      type: 'system',
      from: '系统',
      to: null,
      content: `你已被管理员禁言 ${duration} 秒`,
      timestamp: Date.now(),
      roomId: currentRoom
    });

    // 通知管理员
    socket.emit('message', {
      id: uuidv4(),
      type: 'system',
      from: '系统',
      to: null,
      content: `已禁言用户 ${targetNickname} ${duration} 秒`,
      timestamp: Date.now(),
      roomId: currentRoom
    });
  });

  // 断开连接
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

  // 通知其他用户
  socket.to(roomId).emit('user-leave', { nickname });
  socket.to(roomId).emit('message', {
    id: uuidv4(),
    type: 'system',
    from: '系统',
    to: null,
    content: `${nickname} 离开了房间`,
    timestamp: Date.now(),
    roomId
  });

  // 更新在线用户列表
  const onlineUsers = Array.from(room.users.values()).map(u => u.nickname);
  io.to(roomId).emit('online-users', onlineUsers);

  socket.leave(roomId);

  // 清理空房间
  if (room.users.size === 0) {
    rooms.delete(roomId);
  }
}

server.listen(PORT, () => {
  console.log(`聊天室服务器运行在 http://localhost:${PORT}`);
});
