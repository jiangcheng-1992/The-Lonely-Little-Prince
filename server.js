const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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

let leaderboardSurvival = [];
let leaderboardChallenge = [];
const MAX_LEADERBOARD_SIZE = 100;

const STATS_FILE = path.join(__dirname, 'stats.json');

function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const data = fs.readFileSync(STATS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('📊 统计文件加载失败，使用默认值');
    }
    return {
        daily: {},
        totalVisitors: 0,
        totalVisits: 0,
        uniqueVisitors: new Set()
    };
}

function saveStats(stats) {
    try {
        const dataToSave = {
            ...stats,
            uniqueVisitors: Array.from(stats.uniqueVisitors || [])
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (e) {
        console.error('❌ 保存统计数据失败:', e);
    }
}

let stats = loadStats();
if (Array.isArray(stats.uniqueVisitors)) {
    stats.uniqueVisitors = new Set(stats.uniqueVisitors);
}

function getTodayKey() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

app.use(express.json());

app.get('/api/leaderboard/survival', (req, res) => {
    res.json(leaderboardSurvival);
});

app.get('/api/leaderboard/challenge', (req, res) => {
    res.json(leaderboardChallenge);
});

app.post('/api/leaderboard', (req, res) => {
    const { name, value, type, level } = req.body;
    
    if (!name || !value || !type) {
        return res.status(400).json({ error: '缺少必要参数' });
    }
    
    const entry = {
        name: name,
        value: type === 'survival' ? Math.floor(value) : level,
        level: level || 1,
        date: Date.now()
    };
    
    if (type === 'survival') {
        leaderboardSurvival.push(entry);
        leaderboardSurvival.sort((a, b) => b.value - a.value);
        leaderboardSurvival = leaderboardSurvival.slice(0, MAX_LEADERBOARD_SIZE);
    } else {
        leaderboardChallenge.push(entry);
        leaderboardChallenge.sort((a, b) => b.value - a.value || b.level - a.level);
        leaderboardChallenge = leaderboardChallenge.slice(0, MAX_LEADERBOARD_SIZE);
    }
    
    console.log('📊 排行榜更新:', entry);
    res.json({ success: true });
});

app.post('/api/stats/visit', (req, res) => {
    const { visitorId } = req.body;
    const today = getTodayKey();
    
    if (!stats.daily[today]) {
        stats.daily[today] = { visitors: 0, visits: 0, uniqueVisitors: new Set() };
    }
    
    const todayStats = stats.daily[today];
    
    if (visitorId && !todayStats.uniqueVisitors.has(visitorId)) {
        todayStats.uniqueVisitors.add(visitorId);
        todayStats.visitors++;
    }
    
    todayStats.visits++;
    stats.totalVisits++;
    
    if (visitorId && !stats.uniqueVisitors.has(visitorId)) {
        stats.uniqueVisitors.add(visitorId);
        stats.totalVisitors++;
    }
    
    saveStats(stats);
    
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    const today = getTodayKey();
    const todayStats = stats.daily[today] || { visitors: 0, visits: 0 };
    
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const dayStats = stats.daily[key] || { visitors: 0, visits: 0 };
        last7Days.push({
            date: key,
            visitors: dayStats.visitors || 0,
            visits: dayStats.visits || 0
        });
    }
    
    res.json({
        today: {
            visitors: todayStats.visitors || 0,
            visits: todayStats.visits || 0
        },
        total: {
            visitors: stats.totalVisitors || 0,
            visits: stats.totalVisits || 0
        },
        last7Days
    });
});

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
