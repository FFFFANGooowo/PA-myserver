// deploy.ts - Deno Deploy专用文件
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// 队列数据
interface QueuePerson {
  id: string;
  name: string;
  joinTime: Date;
}

// 使用Deno KV存储
const kv = await Deno.openKv();
const QUEUE_KEY = ["queue_data"];

// 初始化队列（从KV存储加载）
let queue: QueuePerson[] = [];
const loadQueue = async () => {
  const entry = await kv.get(QUEUE_KEY);
  if (entry.value) {
    queue = entry.value as QueuePerson[];
    console.log(`已从存储加载 ${queue.length} 个队列项目`);
  }
};

// 保存队列到KV存储
const saveQueue = async () => {
  await kv.set(QUEUE_KEY, queue);
  console.log(`已保存 ${queue.length} 个队列项目到存储`);
};

// 初始加载队列
await loadQueue();

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
      
      socket.onmessage = async (event) => {
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
              
              // 保存队列到KV存储
              await saveQueue();
              
              // 通知加入成功
              socket.send(JSON.stringify({
                type: "joinSuccess"
              }));
              
              // 广播更新队列
              broadcastQueue();
              break;
              
            case "getQueue":
              // 确保发送最新队列
              await loadQueue();
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
                await saveQueue();
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
                console.log(`管理员移除用户: ${data.userId}`);
                queue = queue.filter((person) => person.id !== data.userId);
                
                // 确保保存操作完成后再继续
                try {
                  await saveQueue();
                  console.log(`成功保存移除用户后的队列状态，当前队列长度: ${queue.length}`);
                  
                  // 发送确认消息
                  socket.send(JSON.stringify({
                    type: "userRemoveConfirmed",
                    userId: data.userId,
                    queueLength: queue.length
                  }));
                  
                  // 广播更新队列
                  broadcastQueue();
                } catch (error) {
                  console.error("保存队列失败:", error);
                  // 尝试再次保存
                  setTimeout(async () => {
                    try {
                      await saveQueue();
                      console.log("重试保存队列成功");
                      broadcastQueue();
                    } catch (retryError) {
                      console.error("重试保存队列失败:", retryError);
                    }
                  }, 1000);
                }
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
                  await saveQueue();
                  broadcastQueue();
                }
              }
              break;

            case "forceSave":
              // 检查是否为管理员请求
              if (data.admin) {
                try {
                  await saveQueue();
                  console.log("管理员手动强制保存队列");
                  socket.send(JSON.stringify({
                    type: "saveSuccess",
                    message: "队列状态已保存",
                    timestamp: new Date().toISOString(),
                    queueLength: queue.length
                  }));
                } catch (error) {
                  console.error("手动保存失败:", error);
                  socket.send(JSON.stringify({
                    type: "error",
                    message: "保存队列失败，请重试"
                  }));
                }
              }
              break;

            case "clearQueue":
              // 检查是否为管理员请求
              if (data.admin) {
                try {
                  console.log("管理员正在清空队列");
                  // 记录之前的队列长度
                  const previousLength = queue.length;
                  
                  // 清空队列
                  queue = [];
                  
                  // 保存到KV存储
                  await saveQueue();
                  console.log("队列已清空并保存");
                  
                  // 发送确认消息
                  socket.send(JSON.stringify({
                    type: "queueCleared",
                    message: `队列已清空 (移除了${previousLength}个项目)`,
                    timestamp: new Date().toISOString()
                  }));
                  
                  // 广播队列更新
                  broadcastQueue();
                } catch (error) {
                  console.error("清空队列失败:", error);
                  socket.send(JSON.stringify({
                    type: "error",
                    message: "清空队列失败，请重试"
                  }));
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
      console.error("WebSocket连接失败:", e);
      return new Response("WebSocket连接失败", { status: 400 });
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
                  height: 100%;
              }

              /* 页面布局 */
              body {
                  display: flex;
                  flex-direction: column;
                  min-height: 100vh;
              }

              .page-content {
                  flex: 1 0 auto;
                  padding: 0 20px;
                  max-width: 1200px;
                  margin: 0 auto;
                  width: 100%;
                  box-sizing: border-box;
              }

              /* 页头样式 */
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

              /* 状态栏样式统一 */
              .status-bar {
                  display: flex;
                  justify-content: flex-end;
                  align-items: center;
                  gap: 15px;
                  flex-wrap: wrap;
              }

              /* 统一按钮和状态显示样式 */
              .admin-switch, .connection-status {
                  padding: 10px 20px;
                  border-radius: 8px;
                  font-weight: bold;
                  font-size: 14px;
                  color: white;
                  transition: background-color 0.3s;
              }

              .admin-switch {
                  background-color: #4A3F35;
                  border: none;
                  cursor: pointer;
              }

              .admin-switch:hover {
                  background-color: #2F2F2F;
              }
              
              .admin-active {
                  background-color: #6A5F45;
              }

              .connected {
                  background-color: #27ae60;
              }

              .disconnected {
                  background-color: #e74c3c;
              }

              /* 队列信息样式 */
              .queue-info {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin: 30px 0;
                  flex-wrap: wrap;
                  gap: 15px;
              }

              .queue-count-container {
                  background-color: white;
                  padding: 15px 25px;
                  border-radius: 8px;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.1);
              }

              /* 队列表单样式 */
              .queue-form {
                  background-color: white;
                  padding: 30px;
                  border-radius: 15px;
                  box-shadow: 0 8px 25px rgba(0,0,0,0.1);
                  margin-bottom: 30px;
              }

              .form-group {
                  display: flex;
                  gap: 10px;
              }

              .form-group input {
                  flex: 1;
                  padding: 15px;
                  border: 2px solid #E5E5E5;
                  border-radius: 8px;
                  font-size: 16px;
              }

              .form-group button {
                  padding: 15px 30px;
                  background-color: #4A3F35;
                  color: #FAF9F6;
                  border: none;
                  border-radius: 8px;
                  font-size: 16px;
                  cursor: pointer;
              }

              /* 管理员登录模态框 */
              .modal {
                  display: none;
                  position: fixed;
                  z-index: 9999;
                  left: 0;
                  top: 0;
                  width: 100%;
                  height: 100%;
                  background-color: rgba(0,0,0,0.5);
                  justify-content: center;
                  align-items: center;
              }

              .modal-content {
                  background-color: #FAF9F6;
                  padding: 30px;
                  border-radius: 10px;
                  min-width: 300px;
                  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                  position: relative;
              }

              .modal h2 {
                  margin-top: 0;
                  margin-bottom: 20px;
                  text-align: center;
              }

              .modal input {
                  width: 100%;
                  padding: 10px;
                  margin-bottom: 20px;
                  border: 1px solid #ccc;
                  border-radius: 4px;
                  box-sizing: border-box;
              }

              .modal-buttons {
                  display: flex;
                  justify-content: space-between;
                  gap: 10px;
              }

              .modal-buttons button {
                  flex: 1;
                  padding: 10px;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-weight: bold;
                  transition: background-color 0.3s;
              }

              .modal-buttons button:first-child {
                  background-color: #4A3F35;
                  color: #FAF9F6;
              }

              .modal-buttons button:last-child {
                  background-color: #E5E5E5;
                  color: #4A3F35;
              }

              /* 页脚样式 */
              footer {
                  flex-shrink: 0;
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 20px;
                  background-color: #4A3F35; 
                  color: #FAF9F6;
                  border-top: 1px solid #ccc;
                  margin-top: auto;
              }
              
              .social-link {
                  color: #FAF9F6;
                  transition: color 0.3s;
              }
              
              .social-link:hover {
                  color: #D3CEC4;
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

              /* 标题样式 */
              .section-title {
                  font-size: 28px;
                  margin: 30px 0 20px;
                  text-align: center;
              }

              /* 队列列表样式 */
              .queue-list-container {
                  margin-bottom: 40px;
              }

              .queue-list {
                  background-color: white;
                  border-radius: 15px;
                  box-shadow: 0 8px 25px rgba(0,0,0,0.1);
                  overflow: hidden;
              }

              .queue-item {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 20px;
                  border-bottom: 1px solid #eee;
              }

              .queue-item:last-child {
                  border-bottom: none;
              }

              .queue-item .queue-info {
                  margin: 0;
                  flex: 1;
                  display: flex;
                  align-items: center;
                  gap: 20px;
              }

              .queue-position {
                  width: 36px;
                  height: 36px;
                  border-radius: 50%;
                  background-color: #4A3F35;
                  color: white;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  font-weight: bold;
              }

              .person-name {
                  font-size: 18px;
                  font-weight: bold;
              }

              .wait-time {
                  color: #777;
                  font-size: 14px;
              }

              /* 管理员控制样式 */
              .admin-controls {
                  display: flex;
                  gap: 5px;
              }

              .admin-controls button {
                  width: 36px;
                  height: 36px;
                  border: none;
                  border-radius: 4px;
                  background-color: #E5E5E5;
                  cursor: pointer;
                  transition: background-color 0.3s;
                  display: flex;
                  justify-content: center;
                  align-items: center;
              }

              .admin-controls button:hover {
                  background-color: #D5D5D5;
              }

              .admin-controls button:disabled {
                  opacity: 0.5;
                  cursor: not-allowed;
              }

              .move-up-btn, .move-down-btn {
                  color: #4A3F35;
              }

              .remove-btn {
                  color: #e74c3c;
              }

              .leave-btn {
                  padding: 8px 15px;
                  background-color: #e74c3c;
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  transition: background-color 0.3s;
              }

              .leave-btn:hover {
                  background-color: #c0392b;
              }

              /* 通知容器样式 */
              .notification-container {
                  position: fixed;
                  top: 20px;
                  right: 20px;
                  z-index: 9000;
                  display: flex;
                  flex-direction: column;
                  gap: 10px;
              }

              .notification {
                  padding: 15px 20px;
                  border-radius: 8px;
                  color: white;
                  width: 300px;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                  transition: opacity 0.3s, transform 0.3s;
              }

              .success {
                  background-color: #27ae60;
              }

              .error {
                  background-color: #e74c3c;
              }

              .info {
                  background-color: #3498db;
              }

              /* 管理员操作按钮样式 */
              .admin-action {
                  padding: 10px 20px;
                  border-radius: 8px;
                  font-weight: bold;
                  font-size: 14px;
                  color: white;
                  background-color: #2980b9;
                  border: none;
                  cursor: pointer;
                  transition: background-color 0.3s;
                  display: none; /* 默认隐藏 */
              }
              
              .admin-action:hover {
                  background-color: #3498db;
              }
              
              .admin-action:active {
                  background-color: #1c638d;
              }

              /* 危险操作按钮样式 */
              .admin-danger {
                  background-color: #e74c3c !important;
              }
              
              .admin-danger:hover {
                  background-color: #c0392b !important;
              }
              
              .confirm-content {
                  max-width: 400px;
              }
              
              .danger-btn {
                  background-color: #e74c3c !important;
                  color: white !important;
              }
              
              .danger-btn:hover {
                  background-color: #c0392b !important;
              }
          </style>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
      </head>
      <body>
          <!-- 页头 -->
          <header>
              <div class="logo">SF 排队系统</div>
              <nav>
                  <ul style="list-style: none; padding: 0; margin: 0; display: flex;">
                      <li style="margin-left: 20px;"><a href="https://sammfang.us.kg" target="_blank" style="text-decoration: none; color: #4A3F35; font-weight: bold; padding: 8px 15px; background-color: #E0E0E0; color: #4A3F35; border-radius: 4px;">访问个人网站</a></li>
                  </ul>
              </nav>
          </header>

          <!-- 页面主要内容区域 -->
          <div class="page-content">
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
                  <div class="status-bar">
                      <div id="connectionStatus" class="connection-status disconnected">未连接</div>
                      <button id="adminModeBtn" class="admin-switch">管理员模式</button>
                      <button id="forceSaveBtn" class="admin-action" style="display: none;">强制保存队列</button>
                      <button id="clearQueueBtn" class="admin-action admin-danger" style="display: none;">清空队列</button>
                  </div>
              </div>

              <section class="queue-list-container">
                  <h2 class="section-title">当前队列</h2>
                  <div id="queueList" class="queue-list"></div>
              </section>
              
              <!-- 通知容器 -->
              <div id="notificationContainer" class="notification-container"></div>

              <!-- 添加确认对话框 -->
              <div id="confirmDialog" class="modal">
                  <div class="modal-content confirm-content">
                      <h3 id="confirmTitle">确认操作</h3>
                      <p id="confirmMessage"></p>
                      <div class="modal-buttons">
                          <button id="confirmYes" class="danger-btn">确认</button>
                          <button id="confirmNo">取消</button>
                      </div>
                  </div>
              </div>
          </div>

          <!-- 管理员控制按钮模板 -->
          <template id="adminControlsTemplate">
              <div class="admin-controls">
                  <button class="move-up-btn"><i class="fas fa-arrow-up"></i></button>
                  <button class="move-down-btn"><i class="fas fa-arrow-down"></i></button>
                  <button class="remove-btn"><i class="fas fa-times"></i></button>
              </div>
          </template>

          <!-- 页脚 -->
          <footer>
              <div class="footer-left" style="font-size: 14px; color: #FAF9F6;">
                  &copy; 2025 萨慕堏. 保留所有权利.
              </div>
              <div class="footer-right" style="display: flex; gap: 15px;">
                  <a href="javascript:void(0)" class="social-link" title="QQ" onclick="showContactInfo('QQ', '260379602')">
                      <i class="fab fa-qq"></i>
                  </a>
                  <a href="javascript:void(0)" class="social-link" title="微信" onclick="showContactInfo('微信', 'yyyingFFFFangOwO（不常用）')">
                      <i class="fab fa-weixin"></i>
                  </a>
                  <a href="https://space.bilibili.com/495830200" target="_blank" class="social-link" title="哔哩哔哩">
                      <i class="fab fa-bilibili"></i>
                  </a>
                  <a href="https://github.com/FFFFANGooowo" target="_blank" class="social-link" title="GitHub">
                      <i class="fab fa-github"></i>
                  </a>
                  <a href="https://steamcommunity.com/id/sammfang/" target="_blank" class="social-link" title="Steam">
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
              // 声明全局变量
              let socket;
              let reconnectAttempts = 0;
              const maxReconnectAttempts = 5;
              const reconnectDelay = 3000; // 3秒
              let isAdmin = false;
              let currentUserId = 'user_' + Date.now(); // 默认为用户模式并分配ID
              let waitTimeUpdateInterval; // 等待时间更新计时器
              let forceSaveBtn;
              let clearQueueBtn;
              let confirmDialog;
              let confirmTitle;
              let confirmMessage;
              let pendingConfirmAction = null;
              
              // 获取DOM元素
              const nameInput = document.getElementById('nameInput');
              const joinQueueBtn = document.getElementById('joinQueueBtn');
              const queueList = document.getElementById('queueList');
              const queueCount = document.getElementById('queueCount');
              const connectionStatus = document.getElementById('connectionStatus');
              const adminModeBtn = document.getElementById('adminModeBtn');
              const adminLogin = document.getElementById('adminLogin');
              const adminPassword = document.getElementById('adminPassword');
              const adminLoginBtn = document.getElementById('adminLoginBtn');
              const adminCancelBtn = document.getElementById('adminCancelBtn');
              const notificationContainer = document.getElementById('notificationContainer');
              
              // 添加事件监听器
              if (joinQueueBtn) {
                  joinQueueBtn.addEventListener('click', joinQueue);
              }
              
              // 管理员模式切换
              if (adminModeBtn) {
                  adminModeBtn.addEventListener('click', () => {
                      if (isAdmin) {
                          // 已是管理员，点击退出管理员模式
                          isAdmin = false;
                          adminModeBtn.textContent = '管理员模式';
                          adminModeBtn.classList.remove('admin-active');
                          showNotification('已退出管理员模式', 'info');
                          // 更新队列显示
                          updateQueueDisplay(queue);
                      } else {
                          // 显示管理员登录框
                          adminLogin.style.display = 'flex';
                      }
                  });
              }
              
              // 管理员登录
              if (adminLoginBtn) {
                  adminLoginBtn.addEventListener('click', () => {
                      const password = adminPassword.value;
                      if (!password) {
                          showNotification('请输入密码', 'error');
                          return;
                      }
                      
                      if (socket && socket.readyState === WebSocket.OPEN) {
                          socket.send(JSON.stringify({
                              type: 'adminAuth',
                              password: password
                          }));
                      } else {
                          showNotification('服务器连接失败，请稍后再试', 'error');
                      }
                      
                      adminPassword.value = '';
                  });
              }
              
              // 取消管理员登录
              if (adminCancelBtn) {
                  adminCancelBtn.addEventListener('click', () => {
                      adminPassword.value = '';
                      adminLogin.style.display = 'none';
                  });
              }
              
              // 初始化连接
              connectWebSocket();
              
              // WebSocket连接函数
              function connectWebSocket() {
                  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                  const wsUrl = \`\${protocol}//\${window.location.host}\`;
                  console.log("连接到WebSocket:", wsUrl);
                  
                  if (connectionStatus) {
                      connectionStatus.textContent = '连接中...';
                      connectionStatus.className = 'connection-status';
                  }
                  
                  socket = new WebSocket(wsUrl);
                  
                  socket.onopen = () => {
                      console.log("WebSocket连接已建立");
                      if (connectionStatus) {
                          connectionStatus.textContent = '已连接';
                          connectionStatus.className = 'connection-status connected';
                      }
                      reconnectAttempts = 0;
                      
                      // 请求当前队列数据
                      socket.send(JSON.stringify({ type: 'getQueue' }));
                      
                      // 启动等待时间更新
                      startWaitTimeUpdates();
                  };
                  
                  socket.onmessage = (event) => {
                      try {
                          const data = JSON.parse(event.data);
                          console.log("收到消息:", data);
                          
                          switch(data.type) {
                              case "queueUpdate":
                                  // 更新界面上的队列
                                  updateQueueDisplay(data.queue);
                                  break;
                                  
                              case "adminAuthSuccess":
                                  isAdmin = true;
                                  adminLogin.style.display = 'none';
                                  adminModeBtn.textContent = '管理员模式（已激活）';
                                  adminModeBtn.classList.add('admin-active');
                                  
                                  // 显示管理员专属按钮
                                  if (forceSaveBtn) {
                                      forceSaveBtn.style.display = 'inline-block';
                                  }
                                  if (clearQueueBtn) {
                                      clearQueueBtn.style.display = 'inline-block';
                                  }
                                  
                                  showNotification('管理员验证成功', 'success');
                                  
                                  // 重新加载队列以显示管理控件
                                  socket.send(JSON.stringify({type: 'getQueue'}));
                                  break;
                                  
                              case "joinSuccess":
                                  showNotification('已成功加入队列', 'success');
                                  break;
                              
                              case "error":
                                  showNotification(data.message, 'error');
                                  break;
                              
                              case "success":
                                  showNotification(data.message, 'success');
                                  break;
                              
                              case "userRemoveConfirmed":
                                  showNotification('用户已被移除', 'success');
                                  break;
                              
                              case "saveSuccess":
                                  showNotification(data.message, 'success');
                                  break;
                              
                              case "queueCleared":
                                  showNotification(data.message, 'success');
                                  break;
                          }
                      } catch (error) {
                          console.error('处理消息时出错:', error);
                      }
                  };
                  
                  socket.onclose = (event) => {
                      console.log("WebSocket连接已关闭:", event.code, event.reason);
                      if (connectionStatus) {
                          connectionStatus.textContent = '已断开';
                          connectionStatus.className = 'connection-status disconnected';
                      }
                      
                      // 清除等待时间更新计时器
                      if (waitTimeUpdateInterval) {
                          clearInterval(waitTimeUpdateInterval);
                          waitTimeUpdateInterval = null;
                      }
                      
                      // 尝试重新连接（如果不是因为页面卸载导致的关闭）
                      if (!window.isUnloading && reconnectAttempts < maxReconnectAttempts) {
                          reconnectAttempts++;
                          console.log(\`尝试重新连接 (\${reconnectAttempts}/\${maxReconnectAttempts})...\`);
                          setTimeout(connectWebSocket, reconnectDelay);
                      }
                  };
                  
                  socket.onerror = (error) => {
                      console.error("WebSocket错误:", error);
                  };
              }
              
              // 启动定时更新等待时间
              function startWaitTimeUpdates() {
                  // 清除现有计时器（如果有）
                  if (waitTimeUpdateInterval) {
                      clearInterval(waitTimeUpdateInterval);
                  }
                  
                  // 创建新计时器，每10秒更新一次
                  waitTimeUpdateInterval = setInterval(updateWaitTimes, 10000);
                  
                  // 立即执行一次更新
                  updateWaitTimes();
              }
              
              // 更新所有等待时间显示
              function updateWaitTimes() {
                  const waitTimeElements = document.querySelectorAll('.wait-time');
                  
                  waitTimeElements.forEach(element => {
                      const joinTimeStr = element.getAttribute('data-join-time');
                      if (joinTimeStr) {
                          const joinTime = new Date(joinTimeStr);
                          const waitDuration = Date.now() - joinTime.getTime();
                          element.textContent = \`等待: \${formatWaitTime(waitDuration)}\`;
                      }
                  });
              }
              
              // 队列变量
              let queue = [];
              
              // 更新队列显示
              function updateQueueDisplay(newQueue) {
                  if (!queueList || !queueCount) return;
                  
                  // 更新全局队列变量
                  queue = newQueue;
                  
                  queueList.innerHTML = '';
                  queueCount.textContent = queue.length;
                  
                  if (queue.length === 0) {
                      const emptyMessage = document.createElement('div');
                      emptyMessage.className = 'empty-queue-message';
                      emptyMessage.textContent = '队列当前为空';
                      emptyMessage.style.padding = '20px';
                      emptyMessage.style.textAlign = 'center';
                      emptyMessage.style.color = '#777';
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
                      // 存储加入时间用于实时更新
                      waitTime.setAttribute('data-join-time', person.joinTime);
                      
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
                      showNotification('您已离开队列', 'success');
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

              // 联系信息弹窗函数
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

              // 在页面加载后初始化按钮
              document.addEventListener('DOMContentLoaded', function() {
                  // 已有变量初始化...
                  
                  forceSaveBtn = document.getElementById('forceSaveBtn');
                  clearQueueBtn = document.getElementById('clearQueueBtn');
                  confirmDialog = document.getElementById('confirmDialog');
                  confirmTitle = document.getElementById('confirmTitle');
                  confirmMessage = document.getElementById('confirmMessage');
                  confirmYesBtn = document.getElementById('confirmYes');
                  confirmNoBtn = document.getElementById('confirmNo');
                  
                  // 添加按钮点击事件
                  if (forceSaveBtn) {
                      forceSaveBtn.addEventListener('click', forceSaveQueue);
                  }
                  if (clearQueueBtn) {
                      clearQueueBtn.addEventListener('click', confirmClearQueue);
                  }
                  if (confirmYesBtn && confirmNoBtn) {
                      confirmYesBtn.addEventListener('click', executeConfirmedAction);
                      confirmNoBtn.addEventListener('click', cancelConfirmDialog);
                  }
              });
              
              // 强制保存队列函数
              function forceSaveQueue() {
                  if (socket && socket.readyState === WebSocket.OPEN && isAdmin) {
                      socket.send(JSON.stringify({
                          type: 'forceSave',
                          admin: true
                      }));
                      showNotification('正在保存队列...', 'info');
                  }
              }

              // 显示确认对话框
              function showConfirmDialog(title, message, action) {
                  if (!confirmDialog) return;
                  
                  confirmTitle.textContent = title;
                  confirmMessage.textContent = message;
                  pendingConfirmAction = action;
                  
                  confirmDialog.style.display = 'flex';
              }
              
              // 取消确认对话框
              function cancelConfirmDialog() {
                  if (!confirmDialog) return;
                  
                  confirmDialog.style.display = 'none';
                  pendingConfirmAction = null;
              }
              
              // 执行确认的操作
              function executeConfirmedAction() {
                  if (pendingConfirmAction) {
                      pendingConfirmAction();
                      pendingConfirmAction = null;
                  }
                  
                  if (confirmDialog) {
                      confirmDialog.style.display = 'none';
                  }
              }
              
              // 确认清空队列
              function confirmClearQueue() {
                  showConfirmDialog(
                      '清空队列',
                      '确定要清空整个队列吗？此操作不可撤销。',
                      clearQueue
                  );
              }
              
              // 清空队列函数
              function clearQueue() {
                  if (socket && socket.readyState === WebSocket.OPEN && isAdmin) {
                      socket.send(JSON.stringify({
                          type: 'clearQueue',
                          admin: true
                      }));
                      showNotification('正在清空队列...', 'info');
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
    
    if (requestPath === "/obs-view.html") {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OBS 队列视图</title>
    <style>
        /* 全局样式 */
        body {
            margin: 0;
            padding: 0;
            background: transparent;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 16px;
            line-height: 1.4;
        }

        /* 队列容器 */
        .queue-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            padding: 10px;
            box-sizing: border-box;
        }

        /* 队列项 */
        .queue-item {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            background: rgba(0, 0, 0, 0.7);
            border-radius: 8px;
            padding: 8px;
        }

        /* 位次 */
        .position {
            width: 40px;
            text-align: center;
            font-weight: bold;
            margin-right: 10px;
        }

        /* 姓名 */
        .name {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* 等待时间 */
        .wait-time {
            width: 80px;
            text-align: right;
            font-family: monospace;
        }

        /* 低分辨率优化 */
        @media (max-width: 480px) {
            body {
                font-size: 14px;
            }
            .queue-item {
                padding: 6px;
            }
            .position {
                width: 30px;
                margin-right: 8px;
            }
            .wait-time {
                width: 60px;
            }
        }
    </style>
</head>
<body>
    <div class="queue-container" id="queueContainer">
        <!-- 队列项将通过JavaScript动态插入 -->
    </div>

    <script>
        let ws;
        let queueContainer = document.getElementById('queueContainer');

        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);

            ws.onopen = () => {
                console.log('WebSocket连接已建立');
                ws.send(JSON.stringify({type: 'getQueue'}));
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'queueUpdate') {
                    updateQueueDisplay(data.queue);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket连接已关闭');
                setTimeout(connectWebSocket, 5000); // 5秒后重连
            };

            ws.onerror = (error) => {
                console.error('WebSocket错误:', error);
            };
        }

        function updateQueueDisplay(queue) {
            queueContainer.innerHTML = queue.map((person, index) => \`
                <div class="queue-item">
                    <div class="position">\${index + 1}</div>
                    <div class="name">\${person.name}</div>
                    <div class="wait-time">\${formatWaitTime(new Date() - new Date(person.joinTime))}</div>
                </div>
            \`).join('');
        }

        function formatWaitTime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);

            if (hours > 0) {
                return \`\${hours}h \${minutes % 60}m\`;
            } else if (minutes > 0) {
                return \`\${minutes}m \${seconds % 60}s\`;
            } else {
                return \`\${seconds}s\`;
            }
        }

        // 初始化连接
        connectWebSocket();
    </script>
</body>
</html>`;

      return new Response(html, {
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
      if (client.readyState === 1) { // OPEN = 1
        client.send(message);
      }
    } catch (e) {
      console.error("Error broadcasting message:", e);
    }
  }
}

// 添加定期存储功能
setInterval(async () => {
  await saveQueue();
}, 5 * 60 * 1000); // 每5分钟保存一次

// 清理长时间闲置项目
setInterval(async () => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24小时
  const initialLength = queue.length;
  
  queue = queue.filter(person => new Date(person.joinTime) > dayAgo);
  
  if (queue.length < initialLength) {
    console.log(`已移除 ${initialLength - queue.length} 个24小时前的队列项目`);
    await saveQueue();
    broadcastQueue();
  }
}, 60 * 60 * 1000); // 每小时检查一次 