#!/bin/bash

# 检查Deno是否安装
if ! command -v deno &> /dev/null; then
    echo "Deno未安装，正在安装..."
    curl -fsSL https://deno.land/install.sh | sh
    export PATH="$HOME/.deno/bin:$PATH"
fi

# 运行服务器
echo "启动排队系统服务器..."
deno run --allow-net --allow-read server.ts 