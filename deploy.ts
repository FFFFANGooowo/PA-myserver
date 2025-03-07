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
      console.error(`WebSocket升级失败: ${e.message}`);
      return new Response(`WebSocket升级失败: ${e.message}`, { status: 500 });
    }
  }
  
  // 静态文件服务
  // 默认提供索引页面
  if (path === "/" || path === "") {
    path = "/index.html";
  }
  
  try {
    // 注意：在Deno Deploy中，需要将静态文件作为模块导入或使用fetch获取
    if (path === "/index.html") {
      // 使用你的完整index.html内容替换这个简化版
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

        /* ... 复制所有CSS样式 ... */
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
</head>
<body>
    <!-- 复制整个body内容 -->
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

    <!-- ... 所有HTML内容 ... -->

    <script>
        // 客户端 WebSocket 连接
        let socket;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const reconnectDelay = 3000; // 3秒

        // DOM 元素
        const nameInput = document.getElementById('nameInput');
        const joinQueueBtn = document.getElementById('joinQueueBtn');
        const queueList = document.getElementById('queueList');
        const queueCount = document.getElementById('queueCount');
        const connectionStatus = document.getElementById('connectionStatus');
        const loadingSpinner = document.getElementById('loadingSpinner');

        // 连接 WebSocket
        function connectWebSocket() {
            // 显示加载动画
            loadingSpinner.style.display = 'block';
            
            // 创建相对路径的WebSocket连接
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}\`;
            socket = new WebSocket(wsUrl);
            
            // ... 其余WebSocket代码 ... 
        }

        // ... 复制所有JS代码 ...
    </script>
</body>
</html>`;

      return new Response(html, {
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
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// 定期清理队列中的闲置项目
setInterval(() => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const initialLength = queue.length;
  
  queue = queue.filter(person => person.joinTime > twoHoursAgo);
  
  if (queue.length < initialLength) {
    console.log(`已移除 ${initialLength - queue.length} 个闲置队列项目`);
    broadcastQueue();
  }
}, 15 * 60 * 1000); 