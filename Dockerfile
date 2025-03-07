FROM denoland/deno:1.37.0

WORKDIR /app

# 复制项目文件
COPY . .

# 缓存依赖
RUN deno cache server.ts

# 暴露端口
EXPOSE 3000
EXPOSE 8000

# 运行服务器
CMD ["run", "--allow-net", "--allow-read", "server.ts"] 