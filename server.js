const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

io.on('connection', (socket) => {
    console.log('🎮 玩家连接:', socket.id);

    socket.on('createRoom', () => {
        const code = generateRoomCode();
        console.log('🏠 创建房间，邀请码:', code);
        
        rooms.set(code, {
            host: socket.id,
            guest: null,
            hostReady: false,
            guestReady: false,
            gameStarted: false,
            player1: null,
            player2: null,
            enemies: [],
            createdAt: Date.now()
        });
        
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log('✅ 房间创建成功:', code);
    });

    socket.on('joinRoom', (code) => {
        code = code.toUpperCase();
        console.log('🚪 尝试加入房间:', code);
        
        const room = rooms.get(code);
        
        if (!room) {
            socket.emit('joinError', '邀请码无效或房间不存在');
            console.log('❌ 房间不存在:', code);
            return;
        }
        
        if (room.guest) {
            socket.emit('joinError', '房间已满');
            console.log('❌ 房间已满:', code);
            return;
        }
        
        room.guest = socket.id;
        socket.join(code);
        
        console.log('✅ 玩家加入房间:', code);
        
        socket.emit('roomJoined', code);
        io.to(code).emit('playerJoined', { guestId: socket.id });
    });

    socket.on('playerReady', (data) => {
        const { roomCode, isHost } = data;
        const room = rooms.get(roomCode);
        
        if (!room) return;
        
        if (isHost) {
            room.hostReady = true;
        } else {
            room.guestReady = true;
        }
        
        console.log('👤 玩家准备就绪:', roomCode, isHost ? '主机' : '客机');
        
        if (room.hostReady && room.guestReady && !room.gameStarted) {
            room.gameStarted = true;
            io.to(roomCode).emit('startGame');
            console.log('🎮 游戏开始:', roomCode);
        }
    });

    socket.on('updatePlayer', (data) => {
        const { roomCode, player, isHost } = data;
        const room = rooms.get(roomCode);
        
        if (!room) return;
        
        if (isHost) {
            room.player1 = player;
        } else {
            room.player2 = player;
        }
        
        socket.to(roomCode).emit('playerUpdate', { player, isHost });
    });

    socket.on('updateEnemies', (data) => {
        const { roomCode, enemies } = data;
        const room = rooms.get(roomCode);
        
        if (!room) return;
        
        room.enemies = enemies;
        socket.to(roomCode).emit('enemiesUpdate', enemies);
    });

    socket.on('shoot', (data) => {
        socket.to(data.roomCode).emit('shoot', data);
    });

    socket.on('useUltimate', (data) => {
        socket.to(data.roomCode).emit('useUltimate', data);
    });

    socket.on('damageEnemy', (data) => {
        socket.to(data.roomCode).emit('damageEnemy', data);
    });

    socket.on('disconnect', () => {
        console.log('👋 玩家断开连接:', socket.id);
        
        for (const [code, room] of rooms) {
            if (room.host === socket.id || room.guest === socket.id) {
                console.log('🏠 房间关闭:', code);
                io.to(code).emit('playerDisconnected');
                rooms.delete(code);
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log('=================================');
    console.log('🎮 孤独的小王子 服务器启动成功！');
    console.log(`🚀 服务器运行在: http://localhost:${PORT}`);
    console.log('=================================');
});