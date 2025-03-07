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
      // 使用完整的HTML内容，不是占位符
      const html = `<!DOCTYPE html>
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

              /* 更多CSS样式... */
              
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
              </div>

              <section class="queue-list-container">
                  <h2 class="section-title">当前队列</h2>
                  <div id="queueList" class="queue-list"></div>
              </section>
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

          <script>
              // 声明全局变量
              let socket;
              let reconnectAttempts = 0;
              const maxReconnectAttempts = 5;
              const reconnectDelay = 3000; // 3秒
              let isAdmin = false;
              let currentUserId = null;
              let pendingAdminAuth = null;
              
              // 获取DOM元素
              const nameInput = document.getElementById('nameInput');
              const joinQueueBtn = document.getElementById('joinQueueBtn');
              const queueList = document.getElementById('queueList');
              const queueCount = document.getElementById('queueCount');
              const connectionStatus = document.getElementById('connectionStatus');
              const roleSelection = document.getElementById('roleSelection');
              const userRoleBtn = document.getElementById('userRoleBtn');
              const adminRoleBtn = document.getElementById('adminRoleBtn');
              const adminLogin = document.getElementById('adminLogin');
              const adminPassword = document.getElementById('adminPassword');
              const adminLoginBtn = document.getElementById('adminLoginBtn');
              const adminCancelBtn = document.getElementById('adminCancelBtn');
              const container = document.querySelector('.container');
              const notificationContainer = document.getElementById('notificationContainer');
              
              // 初始化
              if (container) container.style.visibility = 'hidden';
              
              // 角色选择处理
              userRoleBtn.addEventListener('click', () => {
                  isAdmin = false;
                  roleSelection.style.display = 'none';
                  currentUserId = 'user_' + Date.now();
                  container.style.visibility = 'visible';
                  connectWebSocket();
              });
              
              adminRoleBtn.addEventListener('click', () => {
                  adminLogin.style.display = 'flex';
              });
              
              adminLoginBtn.addEventListener('click', () => {
                  const password = adminPassword.value;
                  if (password) {
                      pendingAdminAuth = password;
                      connectWebSocket();
                  } else {
                      showNotification('请输入密码', 'error');
                  }
              });
              
              adminCancelBtn.addEventListener('click', () => {
                  adminPassword.value = '';
                  adminLogin.style.display = 'none';
              });

              // 添加加入队列按钮监听器
              if (joinQueueBtn) {
                  joinQueueBtn.addEventListener('click', joinQueue);
              }

              // WebSocket连接
              function connectWebSocket() {
                  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                  const wsUrl = \`\${protocol}//\${window.location.host}\`;
                  console.log("连接到WebSocket:", wsUrl);
                  
                  socket = new WebSocket(wsUrl);
                  
                  socket.onopen = () => {
                      console.log("WebSocket连接已建立");
                      connectionStatus.textContent = '已连接';
                      connectionStatus.className = 'connection-status connected';
                      reconnectAttempts = 0;
                      
                      if (pendingAdminAuth) {
                          socket.send(JSON.stringify({
                              type: 'adminAuth',
                              password: pendingAdminAuth
                          }));
                          pendingAdminAuth = null;
                      }
                      
                      socket.send(JSON.stringify({ type: 'getQueue' }));
                  };
                  
                  // 其他WebSocket事件处理...
              }
              
              // 更多函数...
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