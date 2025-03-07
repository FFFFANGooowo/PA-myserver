import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { 
  WebSocketClient,
  WebSocketServer,
} from "https://deno.land/x/websocket@v0.1.4/mod.ts";

// 配置端口
const PORT = 3000;

console.log(`启动排队系统服务器，端口: ${PORT}`);

// 队列数据
interface QueuePerson {
  id: string;
  name: string;
  joinTime: Date;
}

let queue: QueuePerson[] = [];

// 创建WebSocket服务器
const wss = new WebSocketServer(PORT);

// 客户端连接集合
const clients = new Set<WebSocketClient>();

// 处理WebSocket连接
wss.on("connection", function (ws: WebSocketClient) {
  console.log("客户端已连接");
  clients.add(ws);

  // 发送当前队列状态
  ws.send(JSON.stringify({
    type: "queueUpdate",
    queue: queue
  }));

  // 监听消息
  ws.on("message", function (message: string) {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case "join":
          // 检查姓名是否为空
          if (!data.name || data.name.trim() === "") {
            ws.send(JSON.stringify({
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
            ws.send(JSON.stringify({
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
          ws.send(JSON.stringify({
            type: "joinSuccess"
          }));

          // 广播更新队列
          broadcastQueue();
          break;

        case "getQueue":
          // 发送当前队列
          ws.send(JSON.stringify({
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
  });

  // 处理关闭连接
  ws.on("close", () => {
    console.log("客户端断开连接");
    clients.delete(ws);
  });
});

// 广播队列更新到所有客户端
function broadcastQueue() {
  const message = JSON.stringify({
    type: "queueUpdate",
    queue: queue
  });

  for (const client of clients) {
    client.send(message);
  }
}

// 定期清理长时间闲置的队列项目（例如等待超过2小时）
setInterval(() => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const initialLength = queue.length;
  
  queue = queue.filter(person => person.joinTime > twoHoursAgo);
  
  if (queue.length < initialLength) {
    console.log(`已移除 ${initialLength - queue.length} 个闲置队列项目`);
    broadcastQueue();
  }
}, 15 * 60 * 1000); // 每15分钟检查一次

// 提供静态文件服务
serve(async (req) => {
  const url = new URL(req.url);
  let path = url.pathname;
  
  // 默认提供索引页面
  if (path === "/") {
    path = "/index.html";
  }
  
  try {
    // 尝试读取请求的文件
    const filePath = `.${path}`;
    const fileContent = await Deno.readFile(filePath);
    
    // 确定内容类型
    let contentType = "application/octet-stream";
    if (path.endsWith(".html")) contentType = "text/html";
    else if (path.endsWith(".js")) contentType = "text/javascript";
    else if (path.endsWith(".css")) contentType = "text/css";
    else if (path.endsWith(".json")) contentType = "application/json";
    else if (path.endsWith(".png")) contentType = "image/png";
    else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) contentType = "image/jpeg";
    
    return new Response(fileContent, {
      status: 200,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return new Response("404 - 文件未找到", { status: 404 });
    }
    
    return new Response(`服务器错误: ${e.message}`, { status: 500 });
  }
}, { port: 8000 });

console.log(`HTTP服务运行在: http://localhost:8000/`);
console.log(`WebSocket服务运行在: ws://localhost:${PORT}/`); 