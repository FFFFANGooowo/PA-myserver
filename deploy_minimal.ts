import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// 队列数据
interface QueuePerson {
  id: string;
  name: string;
  joinTime: Date;
}

let queue: QueuePerson[] = [];
const clients = new Set<WebSocket>();

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  
  console.log(`收到请求: ${req.method} ${path}`);
  
  // 处理 WebSocket 连接请求
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      
      socket.onopen = () => {
        clients.add(socket);
        socket.send(JSON.stringify({ type: "connected" }));
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received:", data);
          
          // 简单的 echo 响应
          socket.send(JSON.stringify({ 
            type: "echo", 
            message: "Received: " + data.type 
          }));
        } catch (e) {
          console.error("Message error:", e);
        }
      };
      
      socket.onclose = () => {
        clients.delete(socket);
      };
      
      return response;
    } catch (e) {
      console.error("WebSocket error:", e);
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
  }
  
  // 返回简单的测试页面
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WebSocket Test</title>
    </head>
    <body>
      <h1>WebSocket Test</h1>
      <div id="status">Connecting...</div>
      <script>
        const status = document.getElementById('status');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);
        
        ws.onopen = () => {
          status.textContent = 'Connected';
          ws.send(JSON.stringify({type: 'test'}));
        };
        
        ws.onmessage = (event) => {
          const div = document.createElement('div');
          div.textContent = event.data;
          document.body.appendChild(div);
        };
        
        ws.onclose = () => {
          status.textContent = 'Disconnected';
        };
        
        ws.onerror = (error) => {
          status.textContent = 'Error: ' + error;
          console.error('WebSocket error:', error);
        };
      </script>
    </body>
    </html>
  `, {
    headers: { "content-type": "text/html" }
  });
}); 