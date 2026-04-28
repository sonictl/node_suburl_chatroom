var socket = io();
var roomId = ROOM_ID;
var currentNickname = null;
var isAdmin = false;
var typingTimeout = null;
var muteTarget = null;
var searchResults = [];
var searchIdx = -1;

var nicknameModal = document.getElementById('nickname-modal');
var nicknameInput = document.getElementById('nickname-input');
var nicknameError = document.getElementById('nickname-error');
var nicknameSubmit = document.getElementById('nickname-submit');
var chatMessages = document.getElementById('chat-messages');
var messageInput = document.getElementById('message-input');
var sendBtn = document.getElementById('send-btn');
var onlineCount = document.getElementById('online-count');
var typingIndicator = document.getElementById('typing-indicator');
var connectionStatus = document.getElementById('connection-status');
var changeNicknameBtn = document.getElementById('change-nickname');
var emojiBtn = document.getElementById('emoji-btn');
var emojiPickerContainer = document.getElementById('emoji-picker-container');
var searchToggle = document.getElementById('search-toggle');
var searchBox = document.getElementById('search-box');
var searchInput = document.getElementById('search-input');
var searchPrev = document.getElementById('search-prev');
var searchNext = document.getElementById('search-next');
var searchCountEl = document.getElementById('search-count');
var searchClose = document.getElementById('search-close');
var muteModal = document.getElementById('mute-modal');
var muteCancel = document.getElementById('mute-cancel');
var themeBtn = document.getElementById('theme-btn');
var mobileUserBtn = document.getElementById('mobile-user-btn');
var drawerOverlay = document.getElementById('drawer-overlay');
var mobileDrawer = document.getElementById('mobile-drawer');
var closeDrawerBtn = document.getElementById('close-drawer');
var onlineUsersDesktop = document.getElementById('online-users-desktop');
var onlineUsersMobile = document.getElementById('online-users-mobile');

// 主题
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('chatroom_theme', theme);
}
var savedTheme = localStorage.getItem('chatroom_theme') || 'dark';
applyTheme(savedTheme);
themeBtn.addEventListener('click', function() {
  var cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'cupcake' : 'dark');
});

// 连接
socket.on('connect', function() {
  connectionStatus.innerHTML = '🟢 已连接';
  connectionStatus.className = 'connection-status text-success';
  tryAutoLogin();
});
socket.on('disconnect', function() {
  connectionStatus.innerHTML = '🔴 断开';
  connectionStatus.className = 'connection-status text-error';
});
socket.io.on('reconnect_attempt', function() {
  connectionStatus.innerHTML = '🟡 重连...';
  connectionStatus.className = 'connection-status text-warning';
});
socket.io.on('reconnect', function() {
  connectionStatus.innerHTML = '🟢 已连接';
  connectionStatus.className = 'connection-status text-success';
  tryAutoLogin();
});

function tryAutoLogin() {
  var saved = localStorage.getItem('nickname_' + roomId);
  if (saved) {
    currentNickname = saved;
    socket.emit('join', { roomId: roomId, nickname: saved });
  } else {
    showNicknameModal();
  }
}

function showNicknameModal() {
  nicknameModal.classList.remove('hidden');
  nicknameInput.value = '';
  nicknameError.classList.add('hidden');
  setTimeout(function() { nicknameInput.focus(); }, 100);
}
function hideNicknameModal() { nicknameModal.classList.add('hidden'); }

nicknameSubmit.addEventListener('click', submitNickname);
nicknameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitNickname(); });

function submitNickname() {
  var nickname = nicknameInput.value.trim();
  if (!nickname || nickname.length < 1 || nickname.length > 16) {
    nicknameError.textContent = '昵称长度需为 1-16 个字符';
    nicknameError.classList.remove('hidden');
    return;
  }
  currentNickname = nickname;
  socket.emit('join', { roomId: roomId, nickname: nickname });
}

socket.on('join-error', function(data) {
  nicknameError.textContent = data.message;
  nicknameError.classList.remove('hidden');
  currentNickname = null;
});

socket.on('join-success', function(data) {
  hideNicknameModal();
  localStorage.setItem('nickname_' + roomId, data.nickname);
  currentNickname = data.nickname;
  addSystemMessage('你已加入房间 ' + roomId);
});

changeNicknameBtn.addEventListener('click', function() {
  if (currentNickname) socket.emit('leave-room', { roomId: roomId, nickname: currentNickname });
  localStorage.removeItem('nickname_' + roomId);
  currentNickname = null;
  isAdmin = false;
  chatMessages.innerHTML = '';
  showNicknameModal();
});

// 消息渲染
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addMessage(msg) {
  var wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper';
  var time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
  if (msg.type === 'system') {
    wrapper.className += ' message-system';
    wrapper.innerHTML = '<div class="message-bubble px-3 py-1">' + msg.content + '</div>';
  } else if (msg.type === 'private') {
    var isSelf = msg.isSelf || msg.from === currentNickname;
    wrapper.className += isSelf ? ' message-self' : ' message-other';
    var prefix = isSelf ? '私聊给 ' + msg.to : '私聊 from ' + msg.from;
    wrapper.innerHTML = '<div class="msg-sender ' + (isSelf ? 'text-right' : '') + '">' + prefix + '</div>' +
      '<div class="message-bubble px-3 py-2 message-private">' +
      '<div class="msg-time mb-1">' + msg.from + ' ' + time + '</div>' +
      '<div>' + escapeHtml(msg.content) + '</div></div>';
  } else {
    var isSelf2 = msg.from === currentNickname;
    wrapper.className += isSelf2 ? ' message-self' : ' message-other';
    if (isSelf2) {
      wrapper.innerHTML = '<div class="message-bubble px-3 py-2">' + escapeHtml(msg.content) + '</div><div class="msg-time text-right">' + time + '</div>';
    } else {
      wrapper.innerHTML = '<div class="msg-sender">' + msg.from + '</div><div class="message-bubble px-3 py-2">' + escapeHtml(msg.content) + '</div><div class="msg-time">' + time + '</div>';
    }
  }
  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

function addSystemMessage(content) {
  addMessage({ id: Date.now().toString(), type: 'system', from: '系统', to: null, content: content, timestamp: Date.now(), roomId: roomId });
}

// 标题闪烁
var titleBlinkInterval = null;
var originalTitle = document.title;
var isBlinking = false;

function startTitleBlink() {
  if (isBlinking) return;
  isBlinking = true;
  titleBlinkInterval = setInterval(function() {
    document.title = document.title === originalTitle ? '📩 新消息' : originalTitle;
  }, 600);
}

function stopTitleBlink() {
  if (titleBlinkInterval) clearInterval(titleBlinkInterval);
  isBlinking = false;
  document.title = originalTitle;
}

window.addEventListener('focus', stopTitleBlink);

socket.on('message', function(msg) {
  addMessage(msg);
  if (msg.type !== 'system' && msg.from !== currentNickname) startTitleBlink();
  if (msg.type === 'private' && msg.to === currentNickname && Notification.permission === 'granted')
    new Notification('私聊', { body: msg.from + ': ' + msg.content });
  if (msg.content && msg.content.indexOf('@' + currentNickname) !== -1 && Notification.permission === 'granted')
    new Notification('有人@你', { body: msg.from + ': ' + msg.content });
});

// 更新用户列表
function updateUserListUI(users) {
  onlineCount.textContent = '在线人数: ' + users.length;
  onlineUsersDesktop.innerHTML = '';
  onlineUsersMobile.innerHTML = '';
  users.forEach(function(nickname) {
    var isSelf = nickname === currentNickname;
    function createItem(targetContainer) {
      var div = document.createElement('div');
      div.className = 'online-user flex items-center justify-between group' + (isSelf ? ' self' : '');
      var nameSpan = document.createElement('span');
      nameSpan.className = 'text-sm';
      nameSpan.textContent = isSelf ? nickname + ' (自己)' : nickname;
      div.appendChild(nameSpan);
      if (isAdmin && !isSelf) {
        var mb = document.createElement('span');
        mb.className = 'text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-error';
        mb.textContent = '🔇';
        mb.title = '禁言';
        mb.addEventListener('click', function(e) {
          e.stopPropagation();
          muteTarget = nickname;
          muteModal.classList.remove('hidden');
        });
        div.appendChild(mb);
      }
      if (!isSelf) {
        div.addEventListener('click', function() {
          messageInput.value = '@' + nickname + ' ';
          messageInput.focus();
          if (mobileDrawer.classList.contains('open')) closeDrawerPanel();
        });
      }
      targetContainer.appendChild(div);
    }
    createItem(onlineUsersDesktop);
    createItem(onlineUsersMobile);
  });
  if (users.length > 0 && users[0] === currentNickname) isAdmin = true;
}

socket.on('online-users', updateUserListUI);
socket.on('user-join', function(data) { addSystemMessage(data.nickname + ' 加入了房间'); });
socket.on('user-leave', function(data) { addSystemMessage(data.nickname + ' 离开了房间'); });

// 发送消息
function sendMessage() {
  var content = messageInput.value.trim();
  if (!content) return;
  var wMatch = content.match(/^\/w\s+(\S+)\s+(.+)/);
  if (wMatch) { socket.emit('private-message', { to: wMatch[1], content: wMatch[2] }); messageInput.value = ''; return; }
  var atMatch = content.match(/^@(\S+)\s+(.+)/);
  if (atMatch) { socket.emit('private-message', { to: atMatch[1], content: atMatch[2] }); messageInput.value = ''; return; }
  socket.emit('chat-message', { content: content });
  messageInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// 打字指示器
messageInput.addEventListener('input', function() {
  clearTimeout(typingTimeout);
  socket.emit('typing', { isTyping: true });
  typingTimeout = setTimeout(function() { socket.emit('typing', { isTyping: false }); }, 1000);
  // 自动调高
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
});

socket.on('typing-status', function(data) {
  typingIndicator.textContent = data.isTyping ? data.nickname + ' 正在输入...' : '';
});

// 自动滚动
var autoScroll = true;
chatMessages.addEventListener('scroll', function() {
  var diff = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
  autoScroll = diff < 100;
});
function scrollToBottom() {
  if (autoScroll) chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Emoji
emojiBtn.addEventListener('click', function() { emojiPickerContainer.classList.toggle('show'); });
document.addEventListener('click', function(e) {
  if (!emojiBtn.contains(e.target) && !emojiPickerContainer.contains(e.target)) emojiPickerContainer.classList.remove('show');
});
var emojiPicker = document.querySelector('emoji-picker');
if (emojiPicker) {
  emojiPicker.addEventListener('emoji-click', function(event) {
    messageInput.value += event.detail.unicode;
    messageInput.focus();
    emojiPickerContainer.classList.remove('show');
  });
}

// 搜索
searchToggle.addEventListener('click', function() {
  searchBox.classList.toggle('show');
  if (searchBox.classList.contains('show')) searchInput.focus();
});
searchClose.addEventListener('click', function() { searchBox.classList.remove('show'); clearHighlights(); });

function clearHighlights() {
  var highlights = document.querySelectorAll('.highlight');
  highlights.forEach(function(el) {
    var parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
  searchResults = [];
  searchIdx = -1;
  searchCountEl.textContent = '0/0';
}

function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function performSearch() {
  var query = searchInput.value.trim().toLowerCase();
  clearHighlights();
  if (!query) return;
  var messages = chatMessages.querySelectorAll('.message-bubble');
  messages.forEach(function(msg) {
    if (msg.textContent.toLowerCase().indexOf(query) !== -1) {
      var regex = new RegExp('(' + escapeRegExp(searchInput.value.trim()) + ')', 'gi');
      msg.innerHTML = msg.innerHTML.replace(regex, '<span class="highlight">$1</span>');
      searchResults.push(msg);
    }
  });
  searchIdx = searchResults.length ? 0 : -1;
  searchCountEl.textContent = searchResults.length ? '1/' + searchResults.length : '0/0';
  if (searchResults[0]) searchResults[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

searchInput.addEventListener('input', performSearch);
searchPrev.addEventListener('click', function() {
  if (!searchResults.length) return;
  searchIdx = (searchIdx - 1 + searchResults.length) % searchResults.length;
  searchCountEl.textContent = (searchIdx + 1) + '/' + searchResults.length;
  searchResults[searchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
});
searchNext.addEventListener('click', function() {
  if (!searchResults.length) return;
  searchIdx = (searchIdx + 1) % searchResults.length;
  searchCountEl.textContent = (searchIdx + 1) + '/' + searchResults.length;
  searchResults[searchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// 禁言
var muteOptions = document.querySelectorAll('.mute-option');
muteOptions.forEach(function(btn) {
  btn.addEventListener('click', function() {
    var duration = parseInt(btn.dataset.duration);
    if (muteTarget) {
      socket.emit('mute-user', { targetNickname: muteTarget, duration: duration });
      muteModal.classList.add('hidden');
      muteTarget = null;
    }
  });
});
muteCancel.addEventListener('click', function() { muteModal.classList.add('hidden'); muteTarget = null; });

// 手机抽屉
function openDrawer() { mobileDrawer.classList.add('open'); drawerOverlay.classList.add('open'); }
function closeDrawerPanel() { mobileDrawer.classList.remove('open'); drawerOverlay.classList.remove('open'); }
mobileUserBtn.addEventListener('click', openDrawer);
closeDrawerBtn.addEventListener('click', closeDrawerPanel);
drawerOverlay.addEventListener('click', closeDrawerPanel);

// 通知权限
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
