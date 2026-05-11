const express = require('express');
const app = express();
const path = require('path');
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    pingTimeout: 60000 
});

// ИЗМЕНЕНО: Теперь сервер знает, что все картинки, модели и HTML лежат в папке public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    // ИЗМЕНЕНО: Путь к файлу index.html тоже ведет в папку public
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let rooms = {}; 

// Функция для очистки данных комнаты перед отправкой (ПРЕДОТВРАЩАЕТ CRASH СЕРВЕРА)
function getSanitizedRooms() {
    const sanitized = {};
    for (let r in rooms) {
        sanitized[r] = {
            name: rooms[r].name,
            drones: rooms[r].drones,
            players: rooms[r].players,
            mapData: rooms[r].mapData,
            megaBombs: rooms[r].megaBombs
        };
    }
    return sanitized;
}

// Генерация одинаковой карты для комнаты
function generateMapData() {
    let obstacles =[];
    let pickups =[];
    for (let x = -300; x < 300; x += 20) {
        for (let z = -300; z < 300; z += 20) {
            if (Math.random() > 0.6) continue;
            obstacles.push({
                x: x + (Math.random() - 0.5) * 15,
                z: z + (Math.random() - 0.5) * 15
            });
        }
    }
    for (let i = 0; i < 30; i++) {
        pickups.push({
            id: 'pickup_' + i,
            type: Math.random() > 0.5 ? 'health' : 'ammo',
            x: (Math.random() - 0.5) * 300,
            z: (Math.random() - 0.5) * 300
        });
    }
    return { obstacles, pickups };
}

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);
    socket.emit('updateRooms', getSanitizedRooms());

    socket.on('create-room', (data) => {
        const roomId = 'room_' + Date.now();
        rooms[roomId] = { 
            name: `${data.serverName} (Создатель: ${data.nick})`, 
            drones: data.drones, 
            players: {},
            mapData: generateMapData(),
            megaBombs: {}
        };
        io.emit('updateRooms', getSanitizedRooms());
        socket.emit('roomCreated', { roomId });

        // Спавн мега-бомбы каждые 60 секунд
        rooms[roomId].bombInterval = setInterval(() => {
            if(rooms[roomId] && Object.keys(rooms[roomId].players).length > 0) {
                const bombId = 'bomb_' + Date.now();
                const bombData = { 
                    id: bombId, 
                    x: (Math.random() - 0.5) * 100, 
                    y: 0.5, 
                    z: (Math.random() - 0.5) * 100 
                };
                rooms[roomId].megaBombs[bombId] = bombData;
                io.to(roomId).emit('spawnMegaBomb', bombData);
            }
        }, 60000);
    });

    socket.on('joinRoom', (data) => {
        const { roomId, nickname } = data;
        if (rooms[roomId]) {
            socket.join(roomId);
            socket.roomId = roomId;
            socket.nickname = nickname;
            
            rooms[roomId].players[socket.id] = { x: 0, y: 0, z: 0, ry: 0, rx: 0, nickname: nickname, hp: 100, slot: 1, aiming: false, reloading: false };
            socket.emit('gameStarted', { 
                roomId, 
                drones: rooms[roomId].drones, 
                players: rooms[roomId].players,
                mapData: rooms[roomId].mapData,
                megaBombs: rooms[roomId].megaBombs
            });
            socket.to(roomId).emit('playerJoined', { id: socket.id, nickname: nickname, x: 0, y: 0, z: 0 });
        }
    });

    socket.on('move', (data) => {
        if (socket.roomId && rooms[socket.roomId] && rooms[socket.roomId].players[socket.id]) {
            Object.assign(rooms[socket.roomId].players[socket.id], data);
            socket.to(socket.roomId).emit('playerUpdate', { id: socket.id, data: rooms[socket.roomId].players[socket.id] });
        }
    });

    socket.on('shoot', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            socket.to(socket.roomId).emit('playerShoot', data);
        }
    });

    socket.on('startGrenadeAnim', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            socket.to(socket.roomId).emit('playerStartGrenadeAnim', { playerId: socket.id });
        }
    });

    socket.on('throwGrenade', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            data.playerId = socket.id; // Добавляем ID бросившего для анимации у других
            socket.to(socket.roomId).emit('playerGrenade', data);
        }
    });

    socket.on('pickupMegaBomb', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            delete rooms[socket.roomId].megaBombs[data.bombId];
            io.to(socket.roomId).emit('removeMegaBomb', data.bombId);
        }
    });

    socket.on('dropMegaBomb', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].megaBombs[data.bombId] = { id: data.bombId, x: data.x, y: data.y, z: data.z };
            socket.to(socket.roomId).emit('spawnMegaBomb', { id: data.bombId, x: data.x, y: data.y, z: data.z, dropped: true });
        }
    });

    socket.on('throwMegaBomb', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            socket.to(socket.roomId).emit('playerThrowMegaBomb', data);
        }
    });

    socket.on('megaBombAttach', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            io.to(socket.roomId).emit('megaBombAttached', data);
        }
    });

    socket.on('pickupItem', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            const index = rooms[socket.roomId].mapData.pickups.findIndex(p => p.id === data.id);
            if(index !== -1) {
                rooms[socket.roomId].mapData.pickups.splice(index, 1);
                socket.to(socket.roomId).emit('itemPickedUp', data.id);
            }
        }
    });

    socket.on('hitPlayer', (data) => {
        const targetId = data.targetId;
        const damage = data.damage || 10;
        const knockback = data.knockback; 
        const roomId = socket.roomId;
        
        if (rooms[roomId] && rooms[roomId].players[targetId]) {
            rooms[roomId].players[targetId].hp -= damage; 
            io.to(roomId).emit('healthUpdate', { id: targetId, hp: rooms[roomId].players[targetId].hp, knockback: knockback });
            
            if (rooms[roomId].players[targetId].hp <= 0) {
                const killerNick = rooms[roomId].players[socket.id] ? rooms[roomId].players[socket.id].nickname : "Unknown";
                const victimNick = rooms[roomId].players[targetId].nickname;
                
                io.to(roomId).emit('playerKilled', { killer: killerNick, victim: victimNick });
                
                rooms[roomId].players[targetId].hp = 100; 
                io.to(roomId).emit('playerRespawn', { id: targetId });
            }
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            const nick = socket.nickname;
            const rid = socket.roomId;
            delete rooms[rid].players[socket.id];
            socket.to(rid).emit('playerLeft', { id: socket.id, nickname: nick });

            if (Object.keys(rooms[rid].players).length === 0) {
                clearInterval(rooms[rid].bombInterval);
                delete rooms[rid];
                io.emit('updateRooms', getSanitizedRooms());
            }
        }
        console.log('Игрок отключился');
    });
});

const PORT = process.env.PORT || 3000;
const IP = process.env.IP || '0.0.0.0';

http.listen(PORT, IP, () => {
    console.log(`СЕРВЕР ЗАПУЩЕН НА ПОРТУ: ${PORT}`);
});