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
      // 使用内联的HTML代码替代从GitHub获取
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