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

// 添加简单的管理员密码
const ADMIN_PASSWORD = "admin123";

// 限制队列大小
const MAX_QUEUE_SIZE = 100;

// 替换为你的真实 GitHub 仓库信息
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/FFFFANGooowo/PA-myserver/main";

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
  let requestPath = path;
  if (requestPath === "/" || requestPath === "") {
    requestPath = "/index.html";
  }
  
  try {
    if (requestPath === "/index.html") {
      const html = `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>等候系统 | Queue System</title>
          <style>
              /* 全局样式 */
              html, body {
                  font-family: "Source Han Serif", "Fangzheng Songti", serif;
                  margin: 0;
                  padding: 0;
                  background-color: #FAF9F6;
                  color: #4A3F35;
                  font-weight: 600;
                  height: 100%; /* 确保html和body占满高度 */
              }

              /* 页面布局 - 添加flex布局使页脚固定在底部 */
              body {
                  display: flex;
                  flex-direction: column;
                  min-height: 100vh; /* 至少占满视窗高度 */
              }

              .page-content {
                  flex: 1 0 auto; /* 内容区域自动增长 */
              }

              /* 页脚固定样式 */
              footer {
                  flex-shrink: 0; /* 防止页脚被压缩 */
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 20px;
                  background-color: #4A3F35; 
                  color: #FAF9F6;
                  border-top: 1px solid #ccc;
                  margin-top: auto; /* 将页脚推到底部 */
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
                  margin: 0;
                  padding: 0;
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

              .connecting {
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

              .queue-item {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 15px;
                  border-bottom: 1px solid #E5E5E5;
                  transition: background-color 0.3s;
              }

              .queue-item:last-child {
                  border-bottom: none;
              }

              .queue-item:hover {
                  background-color: #F5F5F5;
              }

              .queue-position {
                  display: inline-block;
                  width: 32px;
                  height: 32px;
                  line-height: 32px;
                  text-align: center;
                  background-color: #4A3F35;
                  color: white;
                  border-radius: 50%;
                  margin-right: 15px;
              }

              .person-name {
                  font-weight: bold;
                  flex: 1;
              }

              .wait-time {
                  color: #7f8c8d;
                  margin-left: 15px;
                  text-align: right;
              }

              /* 通知样式 */
              .notification-container {
                  position: fixed;
                  top: 20px;
                  right: 20px;
                  z-index: 1000;
              }

              .notification {
                  background-color: white;
                  padding: 15px 25px;
                  margin-bottom: 10px;
                  border-radius: 8px;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                  animation: slideIn 0.3s forwards;
                  transition: opacity 0.3s, transform 0.3s;
                  opacity: 1;
              }

              .notification.success {
                  border-left: 4px solid #27ae60;
              }

              .notification.error {
                  border-left: 4px solid #e74c3c;
              }

              .notification.info {
                  border-left: 4px solid #3498db;
              }

              @keyframes slideIn {
                  from {
                      transform: translateX(100%);
                      opacity: 0;
                  }
                  to {
                      transform: translateX(0);
                      opacity: 1;
                  }
              }

              /* 加载动画 */
              .loading-spinner {
                  border: 4px solid rgba(0, 0, 0, 0.1);
                  border-left-color: #4A3F35;
                  border-radius: 50%;
                  width: 20px;
                  height: 20px;
                  animation: spin 1s linear infinite;
                  display: inline-block;
                  vertical-align: middle;
                  margin-left: 10px;
              }

              @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
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
                  gap: 20px;
                  margin-top: 30px;
                  justify-content: center;
              }

              .role-btn {
                  padding: 15px 30px;
                  border: none;
                  border-radius: 8px;
                  font-size: 16px;
                  cursor: pointer;
                  transition: background-color 0.3s;
                  width: 120px;
              }

              .user-role {
                  background-color: #3498db;
                  color: white;
              }

              .user-role:hover {
                  background-color: #2980b9;
              }

              .admin-role {
                  background-color: #e74c3c;
                  color: white;
              }

              .admin-role:hover {
                  background-color: #c0392b;
              }

              /* 模态框样式 */
              .modal {
                  display: none;
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background-color: rgba(0,0,0,0.5);
                  z-index: 2000;
                  justify-content: center;
                  align-items: center;
              }

              .modal-content {
                  background-color: white;
                  padding: 30px;
                  border-radius: 15px;
                  box-shadow: 0 8px 25px rgba(0,0,0,0.3);
                  max-width: 400px;
                  width: 90%;
              }

              .modal-content h2 {
                  margin-top: 0;
                  margin-bottom: 20px;
                  text-align: center;
              }

              .modal-content input {
                  width: 100%;
                  padding: 15px;
                  border: 2px solid #E5E5E5;
                  border-radius: 8px;
                  font-size: 16px;
                  margin-bottom: 20px;
                  box-sizing: border-box;
              }

              .modal-buttons {
                  display: flex;
                  justify-content: center;
                  gap: 15px;
              }

              .modal-buttons button {
                  padding: 12px 25px;
                  border: none;
                  border-radius: 8px;
                  cursor: pointer;
                  font-size: 16px;
                  transition: background-color 0.3s;
              }

              #adminLoginBtn {
                  background-color: #4A3F35;
                  color: white;
              }

              #adminLoginBtn:hover {
                  background-color: #2F4F4F;
              }

              #adminCancelBtn {
                  background-color: #E5E5E5;
                  color: #4A3F35;
              }

              #adminCancelBtn:hover {
                  background-color: #D3D3D3;
              }

              /* 管理员控制按钮 */
              .admin-controls {
                  display: flex;
                  gap: 10px;
              }

              .admin-controls button {
                  background-color: #E5E5E5;
                  color: #4A3F35;
                  border: none;
                  border-radius: 5px;
                  width: 36px;
                  height: 36px;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  cursor: pointer;
                  transition: background-color 0.3s;
              }

              .admin-controls button:hover {
                  background-color: #D3D3D3;
              }

              .admin-controls button:disabled {
                  opacity: 0.5;
                  cursor: not-allowed;
              }

              .remove-btn:hover {
                  background-color: #e74c3c !important;
                  color: white;
              }

              /* 离开队列按钮 */
              .leave-btn {
                  padding: 8px 15px;
                  background-color: #e74c3c;
                  color: white;
                  border: none;
                  border-radius: 8px;
                  cursor: pointer;
                  transition: background-color 0.3s;
              }

              .leave-btn:hover {
                  background-color: #c0392b;
              }

              /* 空队列消息 */
              .empty-queue-message {
                  padding: 20px;
                  text-align: center;
                  color: #7f8c8d;
                  font-style: italic;
              }

              /* 响应式设计 */
              @media (max-width: 768px) {
                  .form-group {
                      flex-direction: column;
                  }
                  
                  .queue-info {
                      flex-direction: column;
                      gap: 15px;
                      align-items: flex-start;
                  }
                  
                  .queue-count-container, .connection-status {
                      width: 100%;
                  }
              }

              /* 联系方式弹窗样式 */
              .contact-modal {
                  display: none;
                  position: fixed;
                  z-index: 10000;
                  left: 0;
                  top: 0;
                  width: 100%;
                  height: 100%;
                  background-color: rgba(0,0,0,0.5);
              }
              
              .modal-content {
                  background-color: #FAF9F6;
                  margin: 15% auto;
                  padding: 20px;
                  border-radius: 10px;
                  width: 300px;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                  position: relative;
                  text-align: center;
                  color: #4A3F35;
              }
              
              .close-modal {
                  position: absolute;
                  top: 10px;
                  right: 15px;
                  font-size: 24px;
                  font-weight: bold;
                  cursor: pointer;
                  color: #4A3F35;
              }
              
              .close-modal:hover {
                  color: #000;
              }
          </style>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
      </head>
      <body>
          <!-- 页头 -->
          <header style="display: flex; justify-content: space-between; align-items: center; padding: 20px; background-color: #E5E5E5;">
              <div class="logo" style="font-size: 24px; font-weight: bold;">SF</div>
              <nav>
                  <ul style="list-style: none; padding: 0; margin: 0; display: flex;">
                      <li style="margin-left: 20px;"><a href="/" style="text-decoration: none; color: #4A3F35;">排队系统</a></li>
                      <li style="margin-left: 20px;"><a href="https://sammfang.us.kg" target="_blank" style="text-decoration: none; color: #4A3F35; font-weight: bold; padding: 8px 15px; background-color: #4A3F35; color: #FAF9F6; border-radius: 4px;">访问个人网站</a></li>
                  </ul>
              </nav>
          </header>

          <!-- 页面主要内容区域 -->
          <div class="page-content">
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

              <!-- 主应用容器 -->
              <div class="container">
                  <header>
                      <div class="logo">排队系统</div>
                      <nav>
                          <ul>
                              <li><a href="#" class="active">队列</a></li>
                          </ul>
                      </nav>
                  </header>

                  <h1 class="section-title">加入队列</h1>
                  
                  <section class="queue-form">
                      <div class="form-group">
                          <input type="text" id="nameInput" placeholder="输入您的姓名" />
                          <button id="joinQueueBtn">加入队列</button>
                      </div>
                  </section>

                  <div class="queue-info">
                      <div class="queue-count-container">
                          当前排队人数: <span id="queueCount">0</span>
                      </div>
                      <div id="connectionStatus" class="connection-status disconnected">
                          未连接
                      </div>
                      <div id="loadingSpinner" class="loading-spinner" style="display: none;"></div>
                  </div>

                  <section class="queue-list-container">
                      <h2 class="section-title">当前队列</h2>
                      <div id="queueList" class="queue-list">
                          <!-- 队列项目将在这里动态生成 -->
                      </div>
                  </section>
              </div>
          </div>

          <!-- 页脚 -->
          <footer>
              <div class="footer-left" style="font-size: 14px; color: #FAF9F6;">
                  &copy; 2025 萨慕堏. 保留所有权利.
              </div>
              <div class="footer-right" style="display: flex; gap: 15px;">
                  <a href="javascript:void(0)" class="social-link" title="QQ" onclick="showContactInfo('QQ', '260379602')" style="color: #FAF9F6;">
                      <i class="fab fa-qq"></i>
                  </a>
                  <a href="javascript:void(0)" class="social-link" title="微信" onclick="showContactInfo('微信', 'yyyingFFFFangOwO（不常用）')" style="color: #FAF9F6;">
                      <i class="fab fa-weixin"></i>
                  </a>
                  <a href="https://space.bilibili.com/495830200" target="_blank" class="social-link" title="哔哩哔哩" style="color: #FAF9F6;">
                      <i class="fab fa-bilibili"></i>
                  </a>
                  <a href="https://github.com/FFFFANGooowo" target="_blank" class="social-link" title="GitHub" style="color: #FAF9F6;">
                      <i class="fab fa-github"></i>
                  </a>
                  <a href="https://steamcommunity.com/id/sammfang/" target="_blank" class="social-link" title="Steam" style="color: #FAF9F6;">
                      <i class="fab fa-steam"></i>
                  </a>
              </div>
          </footer>

          <!-- 联系信息弹窗 -->
          <div id="contactModal" class="contact-modal">
              <div class="modal-content">
                  <span class="close-modal">&times;</span>
                  <h3 id="modalTitle">联系方式</h3>
                  <p id="modalContent"></p>
              </div>
          </div>

          <script>
              // 简单的调试检查
              console.log("JavaScript正在运行");
              
              // 声明全局变量
              let socket;
              let reconnectAttempts = 0;
              const maxReconnectAttempts = 5;
              const reconnectDelay = 3000; // 3秒
              let isAdmin = false;
              let currentUserId = null;
              let pendingAdminAuth = null;
              
              // 在HTML加载完成后执行
              window.onload = function() {
                  console.log("页面完全加载");
                  
                  // 获取DOM元素
                  const nameInput = document.getElementById('nameInput');
                  const joinQueueBtn = document.getElementById('joinQueueBtn');
                  const queueList = document.getElementById('queueList');
                  const queueCount = document.getElementById('queueCount');
                  const connectionStatus = document.getElementById('connectionStatus');
                  const loadingSpinner = document.getElementById('loadingSpinner');
                  const notificationContainer = document.getElementById('notificationContainer');
                  const roleSelection = document.getElementById('roleSelection');
                  const userRoleBtn = document.getElementById('userRoleBtn');
                  const adminRoleBtn = document.getElementById('adminRoleBtn');
                  const adminLogin = document.getElementById('adminLogin');
                  const adminPassword = document.getElementById('adminPassword');
                  const adminLoginBtn = document.getElementById('adminLoginBtn');
                  const adminCancelBtn = document.getElementById('adminCancelBtn');
                  const container = document.querySelector('.container');
                  
                  console.log("角色选择界面:", roleSelection ? "已找到" : "未找到");
                  console.log("主容器:", container ? "已找到" : "未找到");
                  
                  // 确保主容器初始隐藏，角色选择界面可见
                  if (container) container.style.visibility = 'hidden';
                  if (roleSelection) roleSelection.style.display = 'flex';
                  
                  // 角色选择处理
                  if (userRoleBtn) {
                      userRoleBtn.addEventListener('click', function() {
                          isAdmin = false;
                          roleSelection.style.display = 'none';
                          // 生成一个随机用户ID
                          currentUserId = 'user_' + Date.now();
                          // 显示主容器
                          if (container) container.style.visibility = 'visible';
                          // 连接WebSocket
                          connectWebSocket();
                      });
                  }
                  
                  if (adminRoleBtn) {
                      adminRoleBtn.addEventListener('click', function() {
                          if (adminLogin) adminLogin.style.display = 'flex';
                      });
                  }
                  
                  if (adminLoginBtn) {
                      adminLoginBtn.addEventListener('click', function() {
                          if (!adminPassword) return;
                          
                          const password = adminPassword.value;
                          if (password) {
                              pendingAdminAuth = password;
                              roleSelection.style.display = 'none';
                              container.style.visibility = 'visible';
                              connectWebSocket();
                          } else {
                              showNotification('请输入密码', 'error');
                          }
                      });
                  }
                  
                  if (adminCancelBtn) {
                      adminCancelBtn.addEventListener('click', function() {
                          if (adminPassword) adminPassword.value = '';
                          if (adminLogin) adminLogin.style.display = 'none';
                      });
                  }
                  
                  // 添加加入队列按钮监听器
                  if (joinQueueBtn) {
                      joinQueueBtn.addEventListener('click', joinQueue);
                  }
                  
                  // 添加回车键监听器
                  if (nameInput) {
                      nameInput.addEventListener('keypress', function(e) {
                          if (e.key === 'Enter') {
                              joinQueue();
                          }
                      });
                  }
              };
              
              // 连接 WebSocket
              function connectWebSocket() {
                  // 获取DOM元素
                  const connectionStatus = document.getElementById('connectionStatus');
                  const loadingSpinner = document.getElementById('loadingSpinner');
                  
                  // 显示加载动画
                  if (loadingSpinner) loadingSpinner.style.display = 'block';
                  
                  // 创建相对路径的WebSocket连接
                  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                  const wsUrl = \`\${protocol}//\${window.location.host}\`;
                  console.log("连接到WebSocket:", wsUrl);
                  
                  socket = new WebSocket(wsUrl);
                  
                  socket.onopen = () => {
                      console.log("WebSocket连接已建立");
                      if (connectionStatus) {
                          connectionStatus.textContent = '已连接';
                          connectionStatus.className = 'connection-status connected';
                      }
                      if (loadingSpinner) loadingSpinner.style.display = 'none';
                      reconnectAttempts = 0;
                      
                      // 如果是挂起的管理员验证，进行验证
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
                  
                  socket.onmessage = (event) => {
                      try {
                          console.log("收到消息:", event.data);
                          const data = JSON.parse(event.data);
                          
                          if (data.type === 'queueUpdate') {
                              updateQueueDisplay(data.queue);
                          } else if (data.type === 'joinSuccess') {
                              showNotification('成功加入队列!', 'success');
                          } else if (data.type === 'error') {
                              showNotification(data.message, 'error');
                          } else if (data.type === 'success') {
                              showNotification(data.message, 'success');
                          } else if (data.type === 'adminAuthSuccess') {
                              // 管理员登录成功
                              isAdmin = true;
                              const adminPassword = document.getElementById('adminPassword');
                              const adminLogin = document.getElementById('adminLogin');
                              const roleSelection = document.getElementById('roleSelection');
                              const container = document.querySelector('.container');
                              
                              if (adminPassword) adminPassword.value = '';
                              if (adminLogin) adminLogin.style.display = 'none';
                              if (roleSelection) roleSelection.style.display = 'none';
                              if (container) container.style.visibility = 'visible';
                              
                              showNotification('管理员登录成功', 'success');
                              // 更新队列显示，添加管理员控制
                              socket.send(JSON.stringify({ type: 'getQueue' }));
                          }
                      } catch (error) {
                          console.error("解析消息出错:", error);
                      }
                  };
                  
                  socket.onclose = (event) => {
                      console.log("WebSocket连接已关闭:", event);
                      if (connectionStatus) {
                          connectionStatus.textContent = '未连接';
                          connectionStatus.className = 'connection-status disconnected';
                      }
                      
                      // 尝试重连
                      if (reconnectAttempts < maxReconnectAttempts) {
                          if (connectionStatus) {
                              connectionStatus.textContent = \`正在重连... (\${reconnectAttempts + 1}/\${maxReconnectAttempts})\`;
                              connectionStatus.className = 'connection-status connecting';
                          }
                          reconnectAttempts++;
                          setTimeout(connectWebSocket, reconnectDelay);
                      } else {
                          showNotification('无法连接到服务器，请刷新页面重试', 'error');
                      }
                  };
                  
                  socket.onerror = (error) => {
                      console.error("WebSocket错误:", error);
                      showNotification('连接错误', 'error');
                  };
              }

              // 更新队列显示
              function updateQueueDisplay(queue) {
                  const queueList = document.getElementById('queueList');
                  const queueCount = document.getElementById('queueCount');
                  
                  if (!queueList || !queueCount) return;
                  
                  queueList.innerHTML = '';
                  queueCount.textContent = queue.length;
                  
                  if (queue.length === 0) {
                      const emptyMessage = document.createElement('div');
                      emptyMessage.className = 'empty-queue-message';
                      emptyMessage.textContent = '队列当前为空';
                      queueList.appendChild(emptyMessage);
                      return;
                  }
                  
                  queue.forEach((person, index) => {
                      const listItem = document.createElement('div');
                      listItem.className = 'queue-item';
                      
                      // 队列信息
                      const queueInfo = document.createElement('div');
                      queueInfo.className = 'queue-info';
                      
                      const position = document.createElement('span');
                      position.className = 'queue-position';
                      position.textContent = index + 1;
                      
                      const name = document.createElement('span');
                      name.className = 'person-name';
                      name.textContent = person.name;
                      
                      const waitTime = document.createElement('span');
                      waitTime.className = 'wait-time';
                      const joinTime = new Date(person.joinTime);
                      const waitDuration = Date.now() - joinTime.getTime();
                      waitTime.textContent = \`等待: \${formatWaitTime(waitDuration)}\`;
                      
                      queueInfo.appendChild(position);
                      queueInfo.appendChild(name);
                      queueInfo.appendChild(waitTime);
                      
                      listItem.appendChild(queueInfo);
                      
                      // 添加管理员控制或离开按钮
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

              // 管理员控制函数
              function moveUser(userId, direction) {
                  if (socket && socket.readyState === WebSocket.OPEN) {
                      socket.send(JSON.stringify({
                          type: 'moveUser',
                          userId: userId,
                          direction: direction
                      }));
                  }
              }

              function removeUser(userId) {
                  if (socket && socket.readyState === WebSocket.OPEN) {
                      socket.send(JSON.stringify({
                          type: 'removeUser',
                          userId: userId
                      }));
                  }
              }

              function leaveQueue(userId) {
                  if (socket && socket.readyState === WebSocket.OPEN) {
                      socket.send(JSON.stringify({
                          type: 'leave',
                          id: userId
                      }));
                      currentUserId = null;
                  }
              }

              // 加入队列
              function joinQueue() {
                  const nameInput = document.getElementById('nameInput');
                  if (!nameInput) return;
                  
                  const name = nameInput.value.trim();
                  
                  if (!name) {
                      showNotification('请输入您的姓名', 'error');
                      return;
                  }
                  
                  if (socket && socket.readyState === WebSocket.OPEN) {
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
                  const notificationContainer = document.getElementById('notificationContainer');
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

              // 在现有JavaScript之后添加弹窗函数
              function showContactInfo(platform, info) {
                  const modal = document.getElementById('contactModal');
                  const modalTitle = document.getElementById('modalTitle');
                  const modalContent = document.getElementById('modalContent');
                  
                  modalTitle.textContent = platform + '联系方式';
                  modalContent.textContent = info;
                  modal.style.display = 'block';
                  
                  // 关闭按钮
                  const closeBtn = document.querySelector('.close-modal');
                  closeBtn.onclick = function() {
                      modal.style.display = 'none';
                  }
                  
                  // 点击弹窗外关闭
                  window.onclick = function(event) {
                      if (event.target == modal) {
                          modal.style.display = 'none';
                      }
                  }
              }
          </script>
      </body>
      </html>`;
      
      return new Response(html, {
        headers: { "content-type": "text/html" },
      });
    }
    
    if (requestPath === "/test.html") {
      const testHtml = `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>测试页面</title>
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
              
              /* 这里添加所有CSS样式... */
          </style>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
      </head>
      <body>
          <!-- 这里添加所有HTML内容... -->
          
          <script>
              // 这里添加所有JavaScript代码...
          </script>
      </body>
      </html>`;
      
      return new Response(testHtml, {
        headers: { "content-type": "text/html" },
      });
    }
    
    // 处理其他静态文件请求
    const response = await fetch(`${GITHUB_RAW_URL}${requestPath}`);
    if (!response.ok) {
      return new Response("404 - 文件未找到", { status: 404 });
    }
    
    // 确定内容类型
    let contentType = "application/octet-stream";
    if (requestPath.endsWith(".html")) contentType = "text/html";
    else if (requestPath.endsWith(".js")) contentType = "text/javascript";
    else if (requestPath.endsWith(".css")) contentType = "text/css";
    
    const content = await response.arrayBuffer();
    return new Response(content, {
      headers: { "content-type": contentType },
    });
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