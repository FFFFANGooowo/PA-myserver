const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
    // 简单的静态文件服务
    let filePath;
    if (req.url === '/') {
        filePath = path.join(__dirname, 'index.html');
    } else {
        filePath = path.join(__dirname, req.url);
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
    }[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                // 文件不存在
                res.writeHead(404);
                res.end('404 - 文件未找到');
            } else {
                // 服务器错误
                res.writeHead(500);
                res.end(`服务器错误: ${error.code}`);
            }
        } else {
            // 成功响应
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// 队列数据
let queue = [];

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

// WebSocket 连接处理
wss.on('connection', (ws) => {
    console.log('客户端已连接');

    // 发送当前队列状态
    ws.send(JSON.stringify({
        type: 'queueUpdate',
        queue: queue
    }));

    // 处理消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'join':
                    // 检查姓名是否为空
                    if (!data.name || data.name.trim() === '') {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: '请输入您的姓名'
                        }));
                        return;
                    }

                    // 检查是否已在队列中
                    const existingPerson = queue.find(person => 
                        person.name.toLowerCase() === data.name.toLowerCase());
                    if (existingPerson) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: '您已经在队列中'
                        }));
                        return;
                    }

                    // 添加到队列
                    const newPerson = {
                        id: Date.now().toString(),
                        name: data.name,
                        joinTime: new Date()
                    };
                    queue.push(newPerson);

                    // 通知加入成功
                    ws.send(JSON.stringify({
                        type: 'joinSuccess'
                    }));

                    // 广播更新队列
                    broadcastQueue();
                    break;

                case 'getQueue':
                    // 发送当前队列
                    ws.send(JSON.stringify({
                        type: 'queueUpdate',
                        queue: queue
                    }));
                    break;

                case 'leave':
                    // 如果实现离开队列功能
                    if (data.id) {
                        queue = queue.filter(person => person.id !== data.id);
                        broadcastQueue();
                    }
                    break;
            }
        } catch (error) {
            console.error('处理消息时出错:', error);
        }
    });

    // 断开连接
    ws.on('close', () => {
        console.log('客户端断开连接');
    });
});

// 广播队列更新到所有客户端
function broadcastQueue() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'queueUpdate',
                queue: queue
            }));
        }
    });
}

// 定期清理长时间闲置的队列项目（例如等待超过2小时）
setInterval(() => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const initialLength = queue.length;
    
    queue = queue.filter(person => new Date(person.joinTime) > twoHoursAgo);
    
    if (queue.length < initialLength) {
        console.log(`已移除 ${initialLength - queue.length} 个闲置队列项目`);
        broadcastQueue();
    }
}, 15 * 60 * 1000); // 每15分钟检查一次

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
}); 