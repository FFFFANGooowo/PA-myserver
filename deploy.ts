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

// 处理HTTP请求和WebSocket连接
serve(async (req) => {
  const url = new URL(req.url);
  
  // 处理WebSocket连接
  if (req.headers.get("upgrade") === "websocket") {
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
  }
  
  // 静态文件服务
  let path = url.pathname;
  
  // 默认提供索引页面
  if (path === "/" || path === "") {
    path = "/index.html";
  }
  
  try {
    // 注意：在Deno Deploy中，需要将静态文件作为模块导入或使用fetch获取
    if (path === "/index.html") {
      // 直接内联HTML或从GitHub raw URL获取
      // 这里我们采用内联方式，你需要将整个HTML文件内容放在这里
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>等候系统 | Queue System</title>
    <style>
        /* 全部CSS样式... */
        /* 复制index.html中的所有CSS样式到这里 */
        body {
            font-family: "Source Han Serif", "Fangzheng Songti", serif;
            margin: 0;
            padding: 0;
            background-color: #FAF9F6;
            color: #4A3F35;
            font-weight: 600;
        }
        /* ... 其余所有CSS ... */
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
</head>
<body>
    <!-- HTML内容... -->
    <!-- 复制index.html中的所有HTML内容到这里 -->
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
    <!-- ... 其余所有HTML ... -->
    
    <script>
        // JavaScript代码...
        // 复制index.html中的所有JS代码到这里
        
        // 修改WebSocket连接URL，使用相对路径
        function connectWebSocket() {
            // 显示加载动画
            loadingSpinner.style.display = 'block';
            
            // 创建相对路径的WebSocket连接
            // 注意这里的修改 - 使用相对路径而不是硬编码的localhost
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}\`;
            socket = new WebSocket(wsUrl);
            
            // ... 其余WebSocket代码保持不变 ...
        }
        // ... 其余所有JS ...
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
    return new Response(`服务器错误: ${e.message}`, { status: 500 });
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