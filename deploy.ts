// deploy.ts - Deno Deploy专用文件
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// 队列数据
interface QueuePerson {
  id: string;
  name: string;
  joinTime: Date;
}

let queue: QueuePerson[] = [];
const clients = new Set<WebSocket>();

// 添加简单的管理员密码 - 在生产环境中应使用更安全的方法
const ADMIN_PASSWORD = "admin123";

// 限制队列大小，避免内存问题
const MAX_QUEUE_SIZE = 100;

// 处理HTTP请求和WebSocket连接
serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  
  console.log(`收到请求: ${req.method} ${path}`);
  
  // 处理WebSocket连接
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    console.log("处理WebSocket连接请求");
    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      
      // 确保所有网络错误都被捕获
      socket.onerror = (e) => {
        console.error("WebSocket error:", e);
      };
      
      // 添加WebSocket事件处理
      socket.onopen = () => {
        console.log("客户端已连接");
        clients.add(socket);
        
        // 发送当前队列状态
        socket.send(JSON.stringify({
          type: "queueUpdate",
          queue: queue
        }));
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case "join":
              // 检查姓名是否为空
              if (!data.name || data.name.trim() === "") {
                socket.send(JSON.stringify({
                  type: "error",
                  message: "请输入您的姓名"
                }));
                return;
              }
              
              // 检查是否已在队列中
              const existingPerson = queue.find(
                (person) => person.name.toLowerCase() === data.name.toLowerCase()
              );
              if (existingPerson) {
                socket.send(JSON.stringify({
                  type: "error",
                  message: "您已经在队列中"
                }));
                return;
              }
              
              // 添加到队列
              const newPerson: QueuePerson = {
                id: Date.now().toString(),
                name: data.name,
                joinTime: new Date()
              };
              
              // 添加到队列时检查大小
              if (queue.length >= MAX_QUEUE_SIZE) {
                // 移除最早加入的客户
                queue.shift();
              }
              queue.push(newPerson);
              
              // 通知加入成功
              socket.send(JSON.stringify({
                type: "joinSuccess"
              }));
              
              // 广播更新队列
              broadcastQueue();
              break;
              
            case "getQueue":
              // 发送当前队列
              socket.send(JSON.stringify({
                type: "queueUpdate",
                queue: queue
              }));
              break;
              
            case "leave":
              // 离开队列
              if (data.id) {
                queue = queue.filter((person) => person.id !== data.id);
                broadcastQueue();
              }
              break;
            
            // 添加新的消息类型处理
            case "adminAuth":
              // 验证管理员密码
              if (data.password === ADMIN_PASSWORD) {
                socket.send(JSON.stringify({
                  type: "adminAuthSuccess"
                }));
              } else {
                socket.send(JSON.stringify({
                  type: "error",
                  message: "管理员密码错误"
                }));
              }
              break;
              
            case "removeUser":
              // 管理员移除用户
              if (data.userId) {
                queue = queue.filter((person) => person.id !== data.userId);
                broadcastQueue();
                socket.send(JSON.stringify({
                  type: "success",
                  message: "用户已被移除"
                }));
              }
              break;
              
            case "moveUser":
              // 管理员调整用户顺序
              if (data.userId && (data.direction === "up" || data.direction === "down")) {
                const index = queue.findIndex(person => person.id === data.userId);
                if (index !== -1) {
                  if (data.direction === "up" && index > 0) {
                    // 上移
                    [queue[index], queue[index-1]] = [queue[index-1], queue[index]];
                  } else if (data.direction === "down" && index < queue.length - 1) {
                    // 下移
                    [queue[index], queue[index+1]] = [queue[index+1], queue[index]];
                  }
                  broadcastQueue();
                }
              }
              break;
          }
        } catch (error) {
          console.error("处理消息时出错:", error);
        }
      };
      
      socket.onclose = () => {
        console.log("客户端断开连接");
        clients.delete(socket);
      };
      
      return response;
    } catch (e) {
      console.error("WebSocket upgrade error:", e);
      return new Response(`WebSocket upgrade failed: ${e.message}`, { status: 400 });
    }
  }
  
  // 静态文件服务
  // 默认提供索引页面
  let requestPath = path;
  if (requestPath === "/" || requestPath === "") {
    requestPath = "/index.html";
  }
  
  try {
    // 这里应该处理静态文件请求
    // 但在 Deno Deploy 中，我们可以内联 HTML
    if (requestPath === "/index.html") {
      // 内联的 HTML 内容
      return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>等候系统 | Queue System</title>
    <style>
        /* 全局样式 */
        body {
            font-family: "Source Han Serif", "Fangzheng Songti", serif;
            margin: 0;
            padding: 0;
            background-color: #FAF9F6;
            color: #4A3F35;
            font-weight: 600;
        }

        a {
            text-decoration: none;
            color: #4A3F35;
        }

        /* 头部样式 */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            background-color: #E5E5E5;
        }

        .logo {
            font-size: 24px;
            font-weight: bold;
        }

        nav ul {
            list-style: none;
            display: flex;
            gap: 20px;
        }

        nav ul li a {
            padding: 8px 15px;
            border-radius: 4px;
            transition: background-color 0.3s;
        }

        nav ul li a.active, nav ul li a:hover {
            background-color: #4A3F35;
            color: #FAF9F6;
        }

        /* 主容器样式 */
        .container {
            max-width: 1200px;
            margin: 40px auto;
            padding: 0 20px;
        }

        /* 标题样式 */
        .section-title {
            font-size: 32px;
            margin-bottom: 20px;
            text-align: center;
            color: #4A3F35;
        }

        /* 队列表单样式 */
        .queue-form {
            background-color: white;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            margin-bottom: 40px;
        }

        .form-group {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .form-group input {
            flex: 1;
            padding: 15px;
            border: 2px solid #E5E5E5;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }

        .form-group input:focus {
            border-color: #4A3F35;
            outline: none;
        }

        .form-group button {
            padding: 15px 30px;
            background-color: #4A3F35;
            color: #FAF9F6;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s;
        }

        .form-group button:hover {
            background-color: #2F4F4F;
        }

        /* 队列信息样式 */
        .queue-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .queue-count-container {
            background-color: white;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .connection-status {
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: bold;
        }

        .connected {
            background-color: #27ae60;
            color: white;
        }

        .disconnected {
            background-color: #e74c3c;
            color: white;
        }

        .error {
            background-color: #f39c12;
            color: white;
        }

        /* 队列列表样式 */
        .queue-list-container {
            background-color: white;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
        }

        .queue-list {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .queue-item {
            display: flex;
            align-items: center;
            padding: 15px;
            background-color: #F8F8F8;
            border-radius: 8px;
            transition: transform 0.3s;
        }

        .queue-item:hover {
            transform: translateY(-3px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .queue-position {
            width: 40px;
            height: 40px;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: #4A3F35;
            color: white;
            border-radius: 50%;
            font-weight: bold;
            margin-right: 15px;
        }

        .queue-name {
            flex: 1;
            font-size: 18px;
        }

        .queue-time {
            margin-left: 20px;
            color: #7f8c8d;
        }

        /* 通知样式 */
        .notification-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
        }

        .notification {
            padding: 15px 25px;
            margin-bottom: 10px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            animation: slideIn 0.3s ease-out forwards;
            opacity: 0;
            transform: translateX(100%);
        }

        @keyframes slideIn {
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }

        .notification.success {
            background-color: #27ae60;
            color: white;
        }

        .notification.error {
            background-color: #e74c3c;
            color: white;
        }

        /* 加载动画 */
        .loading-spinner {
            display: none;
            width: 40px;
            height: 40px;
            margin: 30px auto;
            border: 3px solid rgba(74, 63, 53, 0.3);
            border-radius: 50%;
            border-top-color: #4A3F35;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* 页脚样式 */
        footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            background-color: #E5E5E5;
            margin-top: 60px;
        }

        .social-links a {
            margin-left: 15px;
            font-size: 18px;
            color: #4A3F35;
            transition: color 0.3s;
        }

        .social-links a:hover {
            color: #2F4F4F;
        }

        /* 角色选择界面 */
        .role-selection {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: #FAF9F6;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }

        .role-container {
            background-color: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }

        .role-buttons {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 30px;
        }

        .role-btn {
            padding: 15px 30px;
            font-size: 18px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.2s, background-color 0.3s;
        }

        .role-btn:hover {
            transform: translateY(-3px);
        }

        .user-role {
            background-color: #4A3F35;
            color: white;
        }

        .admin-role {
            background-color: #8B735F;
            color: white;
        }

        /* 管理员登录模态框 */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            z-index: 1001;
            justify-content: center;
            align-items: center;
        }

        .modal-content {
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.2);
            width: 90%;
            max-width: 350px;
        }

        .modal-content h2 {
            margin-top: 0;
            color: #4A3F35;
        }

        .modal-content input {
            width: 100%;
            padding: 12px;
            margin: 20px 0;
            box-sizing: border-box;
            border: 2px solid #E5E5E5;
            border-radius: 6px;
            font-size: 16px;
        }

        .modal-buttons {
            display: flex;
            justify-content: space-between;
            margin-top: 20px;
        }

        .modal-buttons button {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
        }

        .modal-buttons button:first-child {
            background-color: #4A3F35;
            color: white;
        }

        .modal-buttons button:last-child {
            background-color: #E5E5E5;
            color: #4A3F35;
        }

        /* 管理员控制按钮 */
        .admin-controls {
            display: flex;
            gap: 10px;
            margin-left: 10px;
        }

        .admin-controls button {
            width: 30px;
            height: 30px;
            border: none;
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .move-up-btn, .move-down-btn {
            background-color: #8B735F;
            color: white;
        }

        .remove-btn {
            background-color: #e74c3c;
            color: white;
        }

        /* 队列项目调整 */
        .queue-item {
            display: flex;
            align-items: center;
        }

        .queue-info {
            flex: 1;
            display: flex;
        }

        .leave-btn {
            background-color: #e74c3c;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 14px;
        }

        /* 禁用的按钮 */
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* 响应式设计 */
        @media (max-width: 768px) {
            .form-group {
                flex-direction: column;
            }
            
            .queue-item {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .queue-position {
                margin-bottom: 10px;
            }
            
            .queue-time {
                margin-left: 0;
                margin-top: 5px;
            }
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
</head>
<body>
    <!-- 角色选择界面 -->
    <div id="roleSelection" class="role-selection">
        <div class="role-container">
            <h2>请选择您的角色</h2>
            <div class="role-buttons">
                <button id="userRoleBtn" class="role-btn user-role">用户</button>
                <button id="adminRoleBtn" class="role-btn admin-role">管理员</button>
            </div>
        </div>
    </div>

    <!-- 管理员登录模态框 -->
    <div id="adminLogin" class="modal">
        <div class="modal-content">
            <h2>管理员登录</h2>
            <input type="password" id="adminPassword" placeholder="请输入管理员密码" />
            <div class="modal-buttons">
                <button id="adminLoginBtn">登录</button>
                <button id="adminCancelBtn">取消</button>
            </div>
        </div>
    </div>

    <header>
        <div class="logo">排队系统</div>
        <nav>
            <ul>
                <li><a href="#" class="active">首页</a></li>
                <li><a href="#">关于</a></li>
                <li><a href="#">帮助</a></li>
            </ul>
        </nav>
    </header>

    <div class="container">
        <h1 class="section-title">实时排队系统</h1>
        
        <!-- 表单部分 -->
        <div class="queue-form">
            <div class="form-group">
                <input type="text" id="nameInput" placeholder="输入您的姓名">
                <button id="joinQueueBtn">加入队列</button>
            </div>
        </div>
        
        <!-- 队列信息 -->
        <div class="queue-info">
            <div class="queue-count-container">
                当前队列：<span id="queueCount">0</span> 人
            </div>
            <div id="connectionStatus" class="connection-status disconnected">
                连接中...
            </div>
        </div>
        
        <!-- 加载动画 -->
        <div id="loadingSpinner" class="loading-spinner"></div>
        
        <!-- 队列列表 -->
        <div class="queue-list-container">
            <h2>当前队列</h2>
            <div id="queueList" class="queue-list">
                <!-- 队列项目将通过JavaScript动态添加 -->
            </div>
        </div>
    </div>
    
    <!-- 通知容器 -->
    <div id="notificationContainer" class="notification-container"></div>
    
    <!-- 管理员控制按钮模板 -->
    <template id="adminControlsTemplate">
        <div class="admin-controls">
            <button class="move-up-btn"><i class="fas fa-arrow-up"></i></button>
            <button class="move-down-btn"><i class="fas fa-arrow-down"></i></button>
            <button class="remove-btn"><i class="fas fa-times"></i></button>
        </div>
    </template>
    
    <footer>
        <div>&copy; 2023 排队系统</div>
        <div class="social-links">
            <a href="#"><i class="fab fa-weixin"></i></a>
            <a href="#"><i class="fab fa-weibo"></i></a>
            <a href="#"><i class="fab fa-github"></i></a>
        </div>
    </footer>

    <script>
        // 角色管理变量
        let socket;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const reconnectDelay = 3000;
        let isAdmin = false;
        let currentUserId = null;
        let pendingAdminAuth = null;

        // DOM 元素引用
        let nameInput;
        let joinQueueBtn;
        let queueList;
        let queueCount;
        let connectionStatus;
        let loadingSpinner;
        let notificationContainer;
        let roleSelection;
        let userRoleBtn;
        let adminRoleBtn;
        let adminLogin;
        let adminPassword;
        let adminLoginBtn;
        let adminCancelBtn;
        let container;

        // 初始化应用
        document.addEventListener('DOMContentLoaded', function() {
            // 获取DOM元素引用
            nameInput = document.getElementById('nameInput');
            joinQueueBtn = document.getElementById('joinQueueBtn');
            queueList = document.getElementById('queueList');
            queueCount = document.getElementById('queueCount');
            connectionStatus = document.getElementById('connectionStatus');
            loadingSpinner = document.getElementById('loadingSpinner');
            notificationContainer = document.getElementById('notificationContainer');
            roleSelection = document.getElementById('roleSelection');
            userRoleBtn = document.getElementById('userRoleBtn');
            adminRoleBtn = document.getElementById('adminRoleBtn');
            adminLogin = document.getElementById('adminLogin');
            adminPassword = document.getElementById('adminPassword');
            adminLoginBtn = document.getElementById('adminLoginBtn');
            adminCancelBtn = document.getElementById('adminCancelBtn');
            container = document.querySelector('.container');

            // 初始化隐藏主容器
            if (container) {
                container.style.visibility = 'hidden';
            }

            // 角色选择处理
            userRoleBtn.addEventListener('click', () => {
                isAdmin = false;
                roleSelection.style.display = 'none';
                // 生成随机用户ID
                currentUserId = 'user_' + Date.now();
                // 显示主容器
                if (container) {
                    container.style.visibility = 'visible';
                }
                // 连接WebSocket
                connectWebSocket();
            });

            adminRoleBtn.addEventListener('click', () => {
                adminLogin.style.display = 'flex';
            });

            adminLoginBtn.addEventListener('click', () => {
                const password = adminPassword.value;
                if (password) {
                    // 尝试管理员登录
                    if (socket && socket.readyState === 1) { // OPEN = 1
                        socket.send(JSON.stringify({
                            type: 'adminAuth',
                            password: password
                        }));
                    } else {
                        // WebSocket未连接，先保存密码，连接后再验证
                        pendingAdminAuth = password;
                        connectWebSocket();
                    }
                } else {
                    showNotification('请输入密码', 'error');
                }
            });

            adminCancelBtn.addEventListener('click', () => {
                adminPassword.value = '';
                adminLogin.style.display = 'none';
            });

            // 加入队列按钮点击事件
            joinQueueBtn.addEventListener('click', joinQueue);

            // 键盘事件 - 回车键提交
            nameInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    joinQueue();
                    e.preventDefault();
                }
            });
        });

        // 连接WebSocket
        function connectWebSocket() {
            // 显示加载动画
            if (loadingSpinner) {
                loadingSpinner.style.display = 'block';
            }

            // 创建WebSocket连接
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}\`;
            socket = new WebSocket(wsUrl);

            // WebSocket事件处理
            socket.onopen = function() {
                // 更新连接状态
                if (connectionStatus) {
                    connectionStatus.textContent = '已连接';
                    connectionStatus.className = 'connection-status connected';
                }
                
                if (loadingSpinner) {
                    loadingSpinner.style.display = 'none';
                }

                // 重置重连尝试次数
                reconnectAttempts = 0;

                // 如果有挂起的管理员验证，进行验证
                if (pendingAdminAuth) {
                    socket.send(JSON.stringify({
                        type: 'adminAuth',
                        password: pendingAdminAuth
                    }));
                    pendingAdminAuth = null;
                }

                // 获取队列状态
                socket.send(JSON.stringify({ type: 'getQueue' }));
            };

            socket.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'queueUpdate') {
                        updateQueueDisplay(data.queue);
                    } else if (data.type === 'joinSuccess') {
                        showNotification('成功加入队列!', 'success');
                    } else if (data.type === 'error') {
                        showNotification(data.message, 'error');
                    } else if (data.type === 'adminAuthSuccess') {
                        // 管理员登录成功
                        isAdmin = true;
                        if (adminPassword) adminPassword.value = '';
                        if (adminLogin) adminLogin.style.display = 'none';
                        if (roleSelection) roleSelection.style.display = 'none';
                        if (container) container.style.visibility = 'visible';
                        
                        showNotification('管理员登录成功', 'success');
                        
                        // 更新队列显示，添加管理员控制
                        socket.send(JSON.stringify({ type: 'getQueue' }));
                    } else if (data.type === 'success') {
                        showNotification(data.message, 'success');
                    }
                } catch (error) {
                    console.error('处理消息时出错:', error);
                }
            };

            socket.onclose = function() {
                if (connectionStatus) {
                    connectionStatus.textContent = '断开连接';
                    connectionStatus.className = 'connection-status disconnected';
                }

                // 尝试重新连接
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    setTimeout(connectWebSocket, reconnectDelay);
                } else {
                    showNotification('服务器连接失败，请刷新页面重试', 'error');
                }
            };

            socket.onerror = function(error) {
                console.error('WebSocket错误:', error);
                if (connectionStatus) {
                    connectionStatus.textContent = '连接错误';
                    connectionStatus.className = 'connection-status error';
                }
            };
        }

        // 更新队列显示
        function updateQueueDisplay(queue) {
            // 隐藏加载动画
            if (loadingSpinner) {
                loadingSpinner.style.display = 'none';
            }

            // 更新队列人数
            if (queueCount) {
                queueCount.textContent = queue.length;
            }

            // 清空现有队列列表
            if (queueList) {
                queueList.innerHTML = '';

                // 添加队列项目
                queue.forEach((person, index) => {
                    const listItem = document.createElement('div');
                    listItem.className = 'queue-item';
                    listItem.dataset.id = person.id;

                    // 计算等待时间
                    const waitTime = formatWaitTime(new Date() - new Date(person.joinTime));

                    // 创建队列信息容器
                    const queueInfo = document.createElement('div');
                    queueInfo.className = 'queue-info';
                    queueInfo.innerHTML = \`
                        <div class="queue-position">\${index + 1}</div>
                        <div class="queue-name">\${person.name}</div>
                        <div class="queue-time">等待时间: \${waitTime}</div>
                    \`;
                    listItem.appendChild(queueInfo);

                    // 如果是管理员，添加管理控制
                    if (isAdmin) {
                        const template = document.getElementById('adminControlsTemplate');
                        if (template) {
                            const adminControls = template.content.cloneNode(true);

                            // 添加事件监听器
                            const upBtn = adminControls.querySelector('.move-up-btn');
                            const downBtn = adminControls.querySelector('.move-down-btn');
                            const removeBtn = adminControls.querySelector('.remove-btn');

                            if (upBtn) upBtn.addEventListener('click', () => moveUser(person.id, 'up'));
                            if (downBtn) downBtn.addEventListener('click', () => moveUser(person.id, 'down'));
                            if (removeBtn) removeBtn.addEventListener('click', () => removeUser(person.id));

                            // 禁用不需要的按钮
                            if (upBtn && index === 0) upBtn.disabled = true;
                            if (downBtn && index === queue.length - 1) downBtn.disabled = true;

                            listItem.appendChild(adminControls);
                        }
                    }
                    // 如果是当前用户，添加"离开队列"按钮
                    else if (person.id === currentUserId) {
                        const leaveBtn = document.createElement('button');
                        leaveBtn.className = 'leave-btn';
                        leaveBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 离开';
                        leaveBtn.addEventListener('click', () => {
                            leaveQueue(person.id);
                        });
                        listItem.appendChild(leaveBtn);
                    }

                    queueList.appendChild(listItem);
                });
            }
        }

        // 管理员控制函数
        function moveUser(userId, direction) {
            if (socket && socket.readyState === 1) { // OPEN = 1
                socket.send(JSON.stringify({
                    type: 'moveUser',
                    userId: userId,
                    direction: direction
                }));
            }
        }

        function removeUser(userId) {
            if (socket && socket.readyState === 1) { // OPEN = 1
                socket.send(JSON.stringify({
                    type: 'removeUser',
                    userId: userId
                }));
            }
        }

        function leaveQueue(userId) {
            if (socket && socket.readyState === 1) { // OPEN = 1
                socket.send(JSON.stringify({
                    type: 'leave',
                    id: userId
                }));
                currentUserId = null;
            }
        }

        // 加入队列
        function joinQueue() {
            if (!nameInput) return;
            
            const name = nameInput.value.trim();
            
            if (!name) {
                showNotification('请输入您的姓名', 'error');
                return;
            }
            
            if (socket && socket.readyState === 1) { // OPEN = 1
                // 加入队列时，记录当前用户ID
                if (!currentUserId) {
                    currentUserId = 'user_' + Date.now();
                }
                
                socket.send(JSON.stringify({
                    type: 'join',
                    name: name,
                    id: currentUserId
                }));
                nameInput.value = '';
            } else {
                showNotification('服务器连接失败，请稍后再试', 'error');
                // 尝试重新连接
                connectWebSocket();
            }
        }

        // 显示通知
        function showNotification(message, type) {
            if (!notificationContainer) return;
            
            const notification = document.createElement('div');
            notification.className = \`notification \${type}\`;
            notification.textContent = message;
            
            notificationContainer.appendChild(notification);
            
            // 3秒后自动移除通知
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                
                // 动画完成后移除元素
                setTimeout(() => {
                    notification.remove();
                }, 300);
            }, 3000);
        }

        // 格式化等待时间
        function formatWaitTime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            if (hours > 0) {
                return \`\${hours}小时\${minutes % 60}分钟\`;
            } else if (minutes > 0) {
                return \`\${minutes}分钟\${seconds % 60}秒\`;
            } else {
                return \`\${seconds}秒\`;
            }
        }
    </script>
</body>
</html>`, {
  headers: { "content-type": "text/html" },
});
    }
    
    // 对于其他静态资源，你需要手动处理或使用GitHub raw URLs
    return new Response("404 - 文件未找到", { status: 404 });
  } catch (e) {
    console.error(`处理请求错误: ${e.message}`);
    console.error(e.stack);
    return new Response(`服务器错误: ${e.message}\n\n${e.stack}`, { 
      status: 500,
      headers: { "content-type": "text/plain" }
    });
  }
});

// 广播队列更新到所有客户端
function broadcastQueue() {
  const message = JSON.stringify({
    type: "queueUpdate",
    queue: queue
  });
  
  for (const client of clients) {
    try {
      // 使用 readyState 数字值而非常量
      if (client.readyState === 1) { // OPEN = 1
        client.send(message);
      }
    } catch (e) {
      console.error("Error broadcasting message:", e);
    }
  }
}

// 暂时禁用定期清理功能
/*
setInterval(() => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const initialLength = queue.length;
  
  queue = queue.filter(person => person.joinTime > twoHoursAgo);
  
  if (queue.length < initialLength) {
    console.log(`已移除 ${initialLength - queue.length} 个闲置队列项目`);
    broadcastQueue();
  }
}, 15 * 60 * 1000);
*/ 