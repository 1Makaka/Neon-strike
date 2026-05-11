// ============================================================================
// 🌍 ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================================
let scene, camera, renderer, controls;
let leftGun, rightGun, autoRifle, megaBombWeapon;
let currentSlot = 1;

let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isSprinting = false, stamina = 100;
let isShooting = false;
let isAiming = false; 
let velocity = new THREE.Vector3(), direction = new THREE.Vector3();

// Прыжки
let velocityY = 0;
let canJump = true;

let isDead = false, health = 100; 
let ammo1 = 100, ammoInventory1 = 200; 
let ammo2 = 30, ammoInventory2 = 90;
let grenadesAmmo = 3;
let isReloading = false;
let isPaused = false; 

// Анимация гранаты
let isThrowing = false;
let throwAnimT = 0;
let animGrenadeMesh = null; 

let reloadAnimT = 0; 

let bullets = [], enemyBullets = [], enemies = [], obstacles = [], pickups =[];
let grenades =[], explosions = [], impactVFX = [], shockwaves =[];
let lastShot = 0, shotSide = true;

// Мега-бомба
let activeMegaBombs = {}; // Лежащие на полу
let flyingMegaBombs =[]; // Брошенные
let holdingMegaBomb = false;
let megaBombTemplate = null;

let listener, shootSound, bgMusic, grenadeSound, pikSound, megaVibuhSound;
let grenadeModelTemplate = null; 
let particleTexture = null; // Для густого и красивого дыма

let socket; 
let remotePlayers = {}; 
let targetPositions = {}; 
let remoteWeapons = {}; 
let lastNetworkUpdate = 0; 
let myNickname = "Player";
let availableRooms = {};

// Настройки
let sensitivity = 1.0;
let sfxVolume = 0.5;
let musicVolume = 0.3;

// ============================================================================
// 🚀 UI И ЛОГИКА
// ============================================================================
function showMenu(menuId) {
    document.querySelectorAll('.menu-screen').forEach(el => el.classList.remove('active-menu'));
    const target = document.getElementById(menuId);
    if (target) target.classList.add('active-menu');
    if (menuId === 'menu-join' || menuId === 'menu-create') connectSocket();
}

function resumeGame() {
    controls.lock(); 
}

function updateSettings() {
    const sensEl = document.getElementById('sens-slider');
    const sfxEl = document.getElementById('vol-sfx-slider');
    const musEl = document.getElementById('vol-music-slider');
    
    if (sensEl) sensitivity = parseFloat(sensEl.value);
    if (sfxEl) sfxVolume = parseFloat(sfxEl.value);
    if (musEl) musicVolume = parseFloat(musEl.value);
    
    if (controls) controls.pointerSpeed = sensitivity;
    if (bgMusic) bgMusic.setVolume(musicVolume);
    if (shootSound) shootSound.setVolume(sfxVolume);
    if (grenadeSound) grenadeSound.setVolume(sfxVolume);
    if (pikSound) pikSound.setVolume(sfxVolume);
    if (megaVibuhSound) megaVibuhSound.setVolume(sfxVolume);
}

function showJoinNotification(text) {
    const container = document.getElementById('notifications-right') || createNotifContainer();
    const notif = document.createElement('div');
    notif.className = 'notif-right';
    notif.style.cssText = "background: rgba(0, 247, 255, 0.2); color: #00f7ff; padding: 10px; margin: 5px; border-right: 4px solid #00f7ff; font-family: 'Orbitron', sans-serif; animation: slideIn 0.3s forwards;";
    notif.innerText = text;
    container.appendChild(notif);
    setTimeout(() => { notif.style.opacity = '0'; setTimeout(() => notif.remove(), 500); }, 4000);
}

function createNotifContainer() {
    const div = document.createElement('div');
    div.id = 'notifications-right';
    div.style.cssText = "position: fixed; right: 20px; top: 100px; display: flex; flex-direction: column; align-items: flex-end; z-index: 1000;";
    document.body.appendChild(div);
    return div;
}

function showNotification(text) {
    const notif = document.createElement('div');
    notif.className = 'notif';
    notif.innerText = text;
    const container = document.getElementById('notifications');
    if (container) container.appendChild(notif);
    setTimeout(() => { if(notif.parentNode) notif.remove(); }, 3000);
}

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function connectSocket() {
    if (socket && socket.connected) return;
    try {
        socket = io(); 
        socket.on('updateRooms', (rooms) => { availableRooms = rooms; updateServerList(); });
        socket.on('roomCreated', (data) => { joinServer(data.roomId); });
        
        socket.on('gameStarted', (data) => {
            if (!scene) init();
            buildMapFromServer(data.mapData); 
            if (data.drones) spawnAdvancedEnemies(25);
            for(let id in data.players) { if(id !== socket.id) addRemotePlayer(id, data.players[id].nickname); }
            
            if(data.megaBombs) {
                for(let key in data.megaBombs) spawnMegaBombOnMap(data.megaBombs[key]);
            }
            
            startEngine();
        });
        
        socket.on('playerJoined', (data) => { 
            showJoinNotification(`${data.nickname} присоединился`); 
            addRemotePlayer(data.id, data.nickname); 
        });
        
        socket.on('playerLeft', (data) => {
            showJoinNotification(`${data.nickname || 'Игрок'} покинул мир`);
            if (remotePlayers[data.id]) { scene.remove(remotePlayers[data.id]); delete remotePlayers[data.id]; delete targetPositions[data.id]; }
        });
        
        socket.on('playerUpdate', (data) => { 
            if (remotePlayers[data.id]) {
                targetPositions[data.id] = {
                    ...targetPositions[data.id],
                    x: data.data.x, y: data.data.y, z: data.data.z,
                    ry: data.data.ry, rx: data.data.rx, slot: data.data.slot, aiming: data.data.aiming, reloading: data.data.reloading
                };
            }
        });

        socket.on('playerStartGrenadeAnim', (data) => {
            if (targetPositions[data.playerId]) {
                targetPositions[data.playerId].throwing = 1.0;
            }
        });

        socket.on('playerShoot', (data) => {
            const bullet = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
            bullet.position.set(data.px, data.py, data.pz);
            const q = new THREE.Quaternion(data.qx, data.qy, data.qz, data.qw);
            bullet.quaternion.copy(q);
            const shootDir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
            bullet.userData = { velocity: shootDir.multiplyScalar(3.5), dist: 0, isRemote: true, damage: data.damage || 10 }; 
            bullets.push(bullet); 
            scene.add(bullet);
        });
        
        socket.on('playerGrenade', (data) => {
            let g = grenadeModelTemplate ? grenadeModelTemplate.clone() : new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({color: 0xff0000}));
            g.position.set(data.px, data.py, data.pz);
            g.userData = { vel: new THREE.Vector3(data.vx, data.vy, data.vz), timer: 3000 };
            scene.add(g); grenades.push(g);
        });

        socket.on('healthUpdate', (data) => {
            if (data.id === socket.id) {
                health = data.hp;
                if (data.knockback) {
                    velocity.add(new THREE.Vector3(data.knockback.x, data.knockback.y, data.knockback.z));
                }
                updateHUD();
                checkDeath();
            }
        });

        socket.on('playerKilled', (data) => {
            showJoinNotification(`${data.killer} УБИЛ ${data.victim}`);
        });

        socket.on('playerRespawn', (data) => {
            if (data.id === socket.id) {
                isDead = false; health = 100; 
                if (currentSlot === 3) dropMegaBomb(); 
                updateHUD();
                randomizeSpawn();
                document.getElementById('death-screen').style.display = 'none';
                controls.lock();
            }
        });

        socket.on('itemPickedUp', (id) => {
            const itemIndex = pickups.findIndex(p => p.userData.id === id);
            if(itemIndex !== -1) {
                scene.remove(pickups[itemIndex]);
                pickups.splice(itemIndex, 1);
            }
        });

        socket.on('spawnMegaBomb', (data) => { spawnMegaBombOnMap(data); });
        socket.on('removeMegaBomb', (id) => { 
            if(activeMegaBombs[id]) { scene.remove(activeMegaBombs[id]); delete activeMegaBombs[id]; }
        });
        socket.on('playerThrowMegaBomb', (data) => { spawnPhysicsMegaBomb(data, false); });
        
        socket.on('megaBombAttached', (data) => { attachMegaBombToPlayer(data.bombId, data.playerId, data.offset); });

    } catch(e) { console.error("Socket error:", e); }
}

function updateServerList() {
    const list = document.getElementById('servers-list');
    if (!list) return;
    list.innerHTML = '';
    for (const roomId in availableRooms) {
        const room = availableRooms[roomId];
        const btn = document.createElement('div');
        btn.className = 'server-item';
        btn.innerText = `${room.name} (${Object.keys(room.players).length} чел.)`;
        btn.onclick = () => { joinServer(roomId); };
        list.appendChild(btn);
    }
}

function createServer() {
    const srvInput = document.getElementById('create-servername');
    const nickInput = document.getElementById('create-nick');
    const dronesCheckbox = document.getElementById('create-drones');
    myNickname = nickInput ? nickInput.value : "Player";
    const sName = srvInput ? srvInput.value : "Мой Сервер";
    
    if (socket && socket.connected) {
        socket.emit('create-room', { nick: myNickname, serverName: sName, drones: dronesCheckbox ? dronesCheckbox.checked : true });
    }
}

function joinServer(roomId) {
    const nickInput = document.getElementById('join-nick');
    myNickname = nickInput ? nickInput.value : "Guest";
    if (socket) socket.emit('joinRoom', { roomId, nickname: myNickname });
}

function startGame(mode) {
    if (!scene) init();
    let mockMapData = { obstacles: [], pickups:[] };
    for (let x = -300; x < 300; x += 20) {
        for (let z = -300; z < 300; z += 20) {
            if (Math.random() <= 0.4) mockMapData.obstacles.push({x: x + (Math.random()-0.5)*15, z: z + (Math.random()-0.5)*15});
        }
    }
    for(let i=0; i<30; i++) mockMapData.pickups.push({id: 'l_'+i, type: Math.random()>0.5?'health':'ammo', x:(Math.random()-0.5)*300, z:(Math.random()-0.5)*300});
    
    buildMapFromServer(mockMapData);
    spawnAdvancedEnemies(25);
    
    // Спавн с увеличенным радиусом 200
    setInterval(() => {
        spawnMegaBombOnMap({ id: 'local_' + Date.now(), x: (Math.random()-0.5)*200, y: 0.5, z: (Math.random()-0.5)*200 });
    }, 60000);

    startEngine();
}

function startEngine() {
    const overlay = document.getElementById('ui-overlay');
    if (overlay) overlay.style.display = 'none';
    const bgVisual = document.getElementById('menu-background-visual');
    if (bgVisual) bgVisual.style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('crosshair').style.display = 'block';

    if (!listener) {
        listener = new THREE.AudioListener();
        camera.add(listener);
        const audioLoader = new THREE.AudioLoader();
        
        shootSound = new THREE.Audio(listener);
        audioLoader.load('sounds/neonshut.mp3', (buffer) => { shootSound.setBuffer(buffer); shootSound.setVolume(sfxVolume); }, undefined, () => {});
        
        grenadeSound = new THREE.Audio(listener);
        audioLoader.load('sounds/vibuhgranata.mp3', (buffer) => { grenadeSound.setBuffer(buffer); grenadeSound.setVolume(sfxVolume); }, undefined, () => {});

        pikSound = new THREE.Audio(listener);
        audioLoader.load('sounds/pik.mp3', (buffer) => { pikSound.setBuffer(buffer); pikSound.setVolume(sfxVolume); }, undefined, () => {});

        megaVibuhSound = new THREE.Audio(listener);
        audioLoader.load('sounds/megavibuh.mp3', (buffer) => { megaVibuhSound.setBuffer(buffer); megaVibuhSound.setVolume(sfxVolume); }, undefined, () => {});

        bgMusic = new THREE.Audio(listener);
        audioLoader.load('sounds/music.mp3', (buffer) => { bgMusic.setBuffer(buffer); bgMusic.setLoop(true); bgMusic.setVolume(musicVolume); bgMusic.play(); }, undefined, () => {});
    }
    controls.lock();
    updateHUD();
}

function buildMapFromServer(mapData) {
    obstacles.forEach(o => { if(o.parent) o.parent.remove(o); }); obstacles =[];
    pickups.forEach(p => scene.remove(p)); pickups =[];

    const colGeo = new THREE.BoxGeometry(4, 50, 4);
    const colMat = new THREE.MeshStandardMaterial({ color: 0x020202 });
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x00f7ff });
    
    mapData.obstacles.forEach(pos => {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(colGeo, colMat);
        group.add(mesh);
        
        const stripGeo = new THREE.BoxGeometry(0.15, 50, 0.15);
        const s1 = new THREE.Mesh(stripGeo, neonMat); s1.position.set(2.05, 0, 2.05); group.add(s1);
        const s2 = new THREE.Mesh(stripGeo, neonMat); s2.position.set(-2.05, 0, 2.05); group.add(s2);
        const s3 = new THREE.Mesh(stripGeo, neonMat); s3.position.set(2.05, 0, -2.05); group.add(s3);
        const s4 = new THREE.Mesh(stripGeo, neonMat); s4.position.set(-2.05, 0, -2.05); group.add(s4);

        group.position.set(pos.x, 25, pos.z);
        scene.add(group); 
        obstacles.push(mesh); // Добавляем именно сетку (Mesh) для точной коллизии с гранатами
    });

    const itemGeo = new THREE.BoxGeometry(1, 1, 1);
    mapData.pickups.forEach(p => {
        const isHealth = p.type === 'health';
        const mat = new THREE.MeshStandardMaterial({ color: isHealth ? 0x00ff00 : 0xffff00, emissive: isHealth ? 0x00ff00 : 0xffff00 });
        const item = new THREE.Mesh(itemGeo, mat);
        item.position.set(p.x, 0.5, p.z);
        item.userData = { id: p.id, type: p.type, amount: isHealth ? 40 : 50 };
        scene.add(item); pickups.push(item);
    });
}

function randomizeSpawn() {
    const r = Math.random() * 50;
    const theta = Math.random() * 2 * Math.PI;
    camera.position.set(Math.cos(theta) * r, 1.6, Math.sin(theta) * r);
    velocityY = 0;
}

function checkDeath() {
    if (health <= 0 && !isDead) {
        isDead = true; 
        controls.unlock(); 
        document.getElementById('death-screen').style.display = 'flex';
    }
}

// Создание радиального градиента для объемного и красивого дыма
function createParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; 
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.8, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; 
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

// ============================================================================
// 📦 ИНИЦИАЛИЗАЦИЯ
// ============================================================================
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020205);
    scene.fog = new THREE.Fog(0x000000, 1, 150); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    randomizeSpawn(); 

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Генерируем красивую текстуру дыма
    particleTexture = createParticleTexture();

    window.addEventListener('resize', () => {
        if (camera && renderer) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });

    controls = new THREE.PointerLockControls(camera, document.body);
    controls.pointerSpeed = sensitivity; 

    controls.addEventListener('unlock', () => {
        if (!isDead && document.getElementById('ui-overlay').style.display === 'none') {
            isPaused = true;
            document.getElementById('pause-menu').style.display = 'flex';
        }
    });

    controls.addEventListener('lock', () => {
        isPaused = false;
        document.getElementById('pause-menu').style.display = 'none';
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x050505 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    scene.add(new THREE.GridHelper(3000, 120, 0x004444, 0x111111)); 
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
    scene.add(ambientLight);
    
    const sun = new THREE.DirectionalLight(0x00f7ff, 0.8); 
    sun.position.set(5, 20, 7);
    scene.add(sun);

    loadModels();
    createWeapons();

    document.addEventListener('mousedown', (e) => {
        if (isDead) return;
        if (!controls.isLocked) {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
                controls.lock(); 
            }
        } else {
            if (e.button === 2) { 
                isAiming = true; 
            } else if (e.button === 0) {
                if (currentSlot === 3) throwMegaBomb(); 
                else if (currentSlot === 2) isShooting = true; 
                else shoot();
            }
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button === 2) { isAiming = false; }
        if (e.button === 0) { isShooting = false; }
    });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    
    setInterval(() => {
        if (socket && socket.connected && !isDead) {
             const euler = new THREE.Euler(0, 0, 0, 'YXZ');
             euler.setFromQuaternion(camera.quaternion);

             socket.emit('move', { 
                 x: camera.position.x, 
                 y: camera.position.y - 1.6, 
                 z: camera.position.z,
                 ry: euler.y, 
                 rx: euler.x, 
                 slot: currentSlot,
                 aiming: isAiming,
                 reloading: isReloading // Передача анимации
             });
        }
    }, 40);

    animate();
}

function loadModels() {
    const loader = new THREE.GLTFLoader();
    
    loader.load('models/neongranata.glb', (gltf) => {
        grenadeModelTemplate = gltf.scene;
        // Уменьшено на 15% (было 0.3)
        grenadeModelTemplate.scale.set(0.255, 0.255, 0.255);
        
        animGrenadeMesh = grenadeModelTemplate.clone();
        // Сделано чуточку ниже
        animGrenadeMesh.position.set(0.3, -0.3, -0.5);
        animGrenadeMesh.visible = false;
        camera.add(animGrenadeMesh);
    }, undefined, () => {});

    loader.load('models/megabomba.glb', (gltf) => {
        megaBombTemplate = gltf.scene;
        megaBombTemplate.scale.set(0.7, 0.7, 0.7); 
        
        const pointLight = new THREE.PointLight(0x0088ff, 0, 15);
        pointLight.name = "bombLight";
        megaBombTemplate.add(pointLight);

        megaBombTemplate.traverse((child) => {
            if(child.isMesh) {
                // Оставляем цвет текстуры нетронутым, делаем только синее свечение (мигание)
                child.material.emissive = new THREE.Color(0x0088ff); 
                child.material.emissiveIntensity = 0.0; 
            }
        });
        
        megaBombWeapon = megaBombTemplate.clone();
        megaBombWeapon.position.set(0.4, -0.5, -0.7); 
        megaBombWeapon.visible = false;
        camera.add(megaBombWeapon);
    }, undefined, () => {
        megaBombTemplate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({color: 0x222222, emissive: 0x0088ff, emissiveIntensity: 0.0}));
        const light = new THREE.PointLight(0x0088ff, 0, 15);
        light.name = "bombLight";
        megaBombTemplate.add(light);
        
        megaBombWeapon = megaBombTemplate.clone();
        megaBombWeapon.position.set(0.4, -0.5, -0.7); 
        megaBombWeapon.visible = false;
        camera.add(megaBombWeapon);
    });
}

function createFaceTexture() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffcc00'; ctx.fillRect(0,0,128,128);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(35, 45, 12, 0, Math.PI*2); ctx.fill(); 
    ctx.beginPath(); ctx.arc(93, 45, 12, 0, Math.PI*2); ctx.fill(); 
    ctx.beginPath(); ctx.arc(64, 75, 25, 0, Math.PI, false); 
    ctx.lineWidth = 6; ctx.stroke();
    return new THREE.CanvasTexture(canvas);
}

function addRemotePlayer(id, nickname) {
    const group = new THREE.Group();
    
    const bodyGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00f7ff });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.75;
    group.add(body);

    const headGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const faceTex = createFaceTexture();
    const headMats =[
        bodyMat, bodyMat, bodyMat, bodyMat, new THREE.MeshStandardMaterial({ map: faceTex }), bodyMat
    ];
    const head = new THREE.Mesh(headGeo, headMats);
    head.position.y = 2.1; 
    group.add(head);

    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0, 1.2, 1.0); 
    group.add(weaponGroup);
    remoteWeapons[id] = weaponGroup;

    const handGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const handMat = new THREE.MeshStandardMaterial({color: 0xffcc00});

    const loader = new THREE.GLTFLoader();
    
    // Добавляем гранату удаленному игроку
    const gGroup = new THREE.Group(); gGroup.name = 'grenade';
    let gMesh = grenadeModelTemplate ? grenadeModelTemplate.clone() : new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({color: 0x00ff00}));
    gMesh.position.set(0, -0.1, 0.4); 
    gGroup.add(gMesh);
    gGroup.visible = false;
    weaponGroup.add(gGroup);

    loader.load('models/neonpistolet.glb', (gltf) => {
        // Развернули оружие на 180 (Math.PI / 2 вместо -Math.PI / 2)
        const mRight = gltf.scene; mRight.scale.set(0.4, 0.4, 0.4); mRight.rotation.y = Math.PI / 2;
        const mLeft = gltf.scene.clone(); mLeft.scale.set(0.4, 0.4, 0.4); mLeft.rotation.y = Math.PI / 2;
        
        mRight.position.set(0.35, 0, 0); 
        mLeft.position.set(-0.35, 0, 0); 
        
        const pGroup = new THREE.Group();
        pGroup.name = 'pistol';
        pGroup.add(mRight, mLeft);
        weaponGroup.add(pGroup);
        
        const rHand = new THREE.Mesh(handGeo, handMat); rHand.position.set(0, -0.05, 0.15); mRight.add(rHand);
        const lHand = new THREE.Mesh(handGeo, handMat); lHand.position.set(0, -0.05, 0.15); mLeft.add(lHand);
    }, undefined, () => {
        const boxR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 1.2), new THREE.MeshStandardMaterial({ color:0x00f7ff }));
        boxR.position.set(0.35, 0, 0);
        const boxL = boxR.clone(); boxL.position.set(-0.35, 0, 0);
        const pGroup = new THREE.Group(); pGroup.name = 'pistol'; pGroup.add(boxR, boxL);
        weaponGroup.add(pGroup);
    });
    
    loader.load('models/neonavtomat.glb', (gltf) => {
        // Тоже разворот
        const model = gltf.scene; model.scale.set(0.9, 0.9, 0.9); model.rotation.y = Math.PI / 2;
        model.name = 'rifle'; model.visible = false; weaponGroup.add(model);
        
        const aHand = new THREE.Mesh(handGeo, handMat); aHand.position.set(-0.15, -0.05, 0.2); model.add(aHand);
        const aHand2 = new THREE.Mesh(handGeo, handMat); aHand2.position.set(0.2, -0.05, -0.2); model.add(aHand2);
    }, undefined, () => {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 1.8), new THREE.MeshStandardMaterial({ color:0xff0000 }));
        box.name = 'rifle'; box.visible = false; weaponGroup.add(box);
    });

    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = '#00f7ff'; ctx.textAlign = 'center'; ctx.fillText(nickname, 128, 40);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.position.y = 3.0; sprite.scale.set(4, 1, 1); group.add(sprite);

    scene.add(group); 
    remotePlayers[id] = group;
}

function createWeapons() {
    const loader = new THREE.GLTFLoader();
    leftGun = new THREE.Group(); rightGun = new THREE.Group(); autoRifle = new THREE.Group();
    
    const handGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const handMat = new THREE.MeshStandardMaterial({color: 0xffcc00});

    loader.load('models/neonpistolet.glb', (gltf) => {
        const m1 = gltf.scene.clone(); m1.scale.set(0.2, 0.2, 0.2); m1.rotation.y = -Math.PI / 2; leftGun.add(m1);
        const m2 = gltf.scene.clone(); m2.scale.set(0.2, 0.2, 0.2); m2.rotation.y = -Math.PI / 2; rightGun.add(m2);
        
        const lh = new THREE.Mesh(handGeo, handMat); lh.position.set(-0.05, -0.1, 0.15); leftGun.add(lh);
        const rh = new THREE.Mesh(handGeo, handMat); rh.position.set(0.05, -0.1, 0.15); rightGun.add(rh);
    }, undefined, () => {});
    
    loader.load('models/neonavtomat.glb', (gltf) => {
        const model = gltf.scene; model.scale.set(0.6, 0.6, 0.6); model.rotation.y = -Math.PI / 2; autoRifle.add(model);
        
        const ah1 = new THREE.Mesh(handGeo, handMat); ah1.position.set(-0.1, -0.05, 0.2); autoRifle.add(ah1);
        const ah2 = new THREE.Mesh(handGeo, handMat); ah2.position.set(0.1, -0.05, -0.2); autoRifle.add(ah2);
    }, undefined, () => {});

    leftGun.position.set(-0.4, -0.35, -0.6); rightGun.position.set(0.4, -0.35, -0.6);
    autoRifle.position.set(0.3, -0.35, -0.8); autoRifle.visible = false;
    camera.add(leftGun, rightGun, autoRifle); scene.add(camera);
}

function switchWeapon(slot) {
    if (isThrowing) return;
    currentSlot = slot;
    leftGun.visible = (slot === 1);
    rightGun.visible = (slot === 1);
    autoRifle.visible = (slot === 2);
    if(megaBombWeapon) megaBombWeapon.visible = (slot === 3);
    updateHUD();
}

// --- ФИЗИКА ВЕТРА/УДАРНОЙ ВОЛНЫ НА ДЫМ ---
function pushExistingSmoke(centerPos, forceRadius, forceMultiplier) {
    explosions.forEach(exp => {
        if (exp.isSmoke) {
            const positions = exp.mesh.geometry.attributes.position.array;
            for (let j = 0; j < exp.vels.length; j++) {
                // Перевод локальной координаты частицы в мировую для проверки дистанции
                let px = positions[j*3] + exp.mesh.position.x;
                let py = positions[j*3+1] + exp.mesh.position.y;
                let pz = positions[j*3+2] + exp.mesh.position.z;
                
                let dx = px - centerPos.x;
                let dy = py - centerPos.y;
                let dz = pz - centerPos.z;
                let dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                // Если дым оказался в радиусе ЧУЖОГО взрыва
                if (dist < forceRadius && dist > 0.1) {
                    let force = (forceRadius - dist) / forceRadius; // 1 в центре, 0 на краю
                    
                    // Добавляем дыму скорость от ударной волны, он отлетает
                    exp.vels[j].x += (dx/dist) * force * forceMultiplier;
                    exp.vels[j].y += (dy/dist) * force * forceMultiplier;
                    exp.vels[j].z += (dz/dist) * force * forceMultiplier;
                    
                    // Заставляем дым, который был сдут, рассеиваться чуть быстрее
                    exp.decay *= 1.002; 
                }
            }
        }
    });
}

// --- МЕГА-БОМБА ---
function spawnMegaBombOnMap(data) {
    if (activeMegaBombs[data.id]) return;
    let m = megaBombTemplate ? megaBombTemplate.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6), new THREE.MeshStandardMaterial({color:0xff00ff}));
    m.position.set(data.x, data.y, data.z);
    m.userData = { id: data.id };
    scene.add(m);
    activeMegaBombs[data.id] = m;
    
    if (!data.dropped) showNotification("МЕГА-БОМБА ПОЯВИЛАСЬ НА КАРТЕ!");
}

function interactMegaBomb() {
    if (currentSlot === 3) {
        dropMegaBomb();
        return;
    }
    let nearestDist = 3;
    let targetId = null;
    for (let id in activeMegaBombs) {
        let dist = camera.position.distanceTo(activeMegaBombs[id].position);
        if (dist < nearestDist) { nearestDist = dist; targetId = id; }
    }
    if (targetId) {
        scene.remove(activeMegaBombs[targetId]);
        delete activeMegaBombs[targetId];
        switchWeapon(3);
        if (socket && socket.connected) socket.emit('pickupMegaBomb', { bombId: targetId });
    }
}

function dropMegaBomb() {
    switchWeapon(1);
    const dropPos = camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    dropPos.y = 0.5;
    const bombId = 'bomb_' + Date.now();
    spawnMegaBombOnMap({ id: bombId, x: dropPos.x, y: dropPos.y, z: dropPos.z, dropped: true });
    if (socket && socket.connected) socket.emit('dropMegaBomb', { bombId: bombId, x: dropPos.x, y: dropPos.y, z: dropPos.z });
}

function throwMegaBomb() {
    switchWeapon(1);
    const id = 'fbomb_' + Date.now();
    const throwDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const initialVel = throwDir.multiplyScalar(0.5).add(new THREE.Vector3(0, 0.3, 0));
    
    spawnPhysicsMegaBomb({ id: id, px: camera.position.x, py: camera.position.y, pz: camera.position.z, vx: initialVel.x, vy: initialVel.y, vz: initialVel.z }, true);
    
    if (socket && socket.connected) {
        socket.emit('throwMegaBomb', { id: id, px: camera.position.x, py: camera.position.y, pz: camera.position.z, vx: initialVel.x, vy: initialVel.y, vz: initialVel.z });
    }
}

function spawnPhysicsMegaBomb(data, isLocal) {
    let m = megaBombTemplate ? megaBombTemplate.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6), new THREE.MeshStandardMaterial({color:0xff00ff}));
    m.position.set(data.px, data.py, data.pz);
    // Таймер изменен на 6.5 секунд (6500 мс)
    m.userData = { id: data.id, vel: new THREE.Vector3(data.vx, data.vy, data.vz), timer: 6500, nextBeep: 6500, isLocal: isLocal, attachedTo: null };
    scene.add(m); flyingMegaBombs.push(m);
}

function attachMegaBombToPlayer(bombId, playerId, offset) {
    let bombIndex = flyingMegaBombs.findIndex(b => b.userData.id === bombId);
    if(bombIndex !== -1 && remotePlayers[playerId]) {
        let b = flyingMegaBombs[bombIndex];
        scene.remove(b);
        
        if (offset) {
            b.position.set(offset.x, offset.y, offset.z);
        } else {
            b.position.set(0, 1.5, 0); 
        }
        
        remotePlayers[playerId].add(b);
        b.userData.attachedTo = playerId;
    }
}

function explodeMegaBomb(pos) {
    if (megaVibuhSound && megaVibuhSound.buffer) {
        if (megaVibuhSound.isPlaying) megaVibuhSound.stop();
        megaVibuhSound.play();
    }

    // Раскидываем старый дым, даем иммунитет своему дыму (так как он появится только после этой функции)
    pushExistingSmoke(pos, 100, 4.0);

    // Рандомизация размера, густоты и времени (±20%)
    let randomSizeMod = 0.8 + Math.random() * 0.4;
    let randomDecayMod = 0.8 + Math.random() * 0.4;

    // Красивые сияющие искры
    const count = 1500;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels =[];
    for(let i=0; i<count; i++) {
        positions[i*3] = 0; 
        positions[i*3+1] = 0; 
        positions[i*3+2] = 0;
        vels.push(new THREE.Vector3((Math.random()-0.5)*15, (Math.random()-0.5)*15, (Math.random()-0.5)*15));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ 
        color: 0x0088ff, 
        size: 1.5, 
        map: particleTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }); 
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(pos);
    scene.add(pts);
    explosions.push({ mesh: pts, vels: vels, life: 1.0, decay: 0.02 });

    // Густой дым (в 4 раза меньше базовых частиц для оптимизации = 47, плюс рандомизация)
    const baseSmokeCount = 47; 
    const smokeCount = Math.floor(baseSmokeCount * randomSizeMod);
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(smokeCount * 3);
    const sVels =[];
    for(let i=0; i<smokeCount; i++) {
        
        // Создаем огромный цилиндр тумана сразу в локальных координатах
        let r = Math.random() * 60 * randomSizeMod; // В 2 РАЗА БОЛЬШЕ РАДИУС
        let theta = Math.random() * Math.PI * 2;
        let h = Math.random() * 20 * randomSizeMod;

        sPos[i*3] = Math.cos(theta)*r; 
        sPos[i*3+1] = h - 2; 
        sPos[i*3+2] = Math.sin(theta)*r;
        
        // Легкий разлет по сторонам, как просили
        let spread = 0.8 + Math.random() * 0.5;
        sVels.push(new THREE.Vector3((Math.random()-0.5)*spread, (Math.random()-0.5)*0.1, (Math.random()-0.5)*spread));
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sMat = new THREE.PointsMaterial({ 
        color: 0x111111, // Темный, густой дым
        size: 15.0 * randomSizeMod, // Огромные частицы
        map: particleTexture,
        transparent: true, 
        opacity: 0.4, // Еще менее густой
        depthWrite: false,
        blending: THREE.NormalBlending
    });
    const sPts = new THREE.Points(sGeo, sMat);
    sPts.position.copy(pos); // Перемещаем сетку в центр взрыва! Больше не улетит вбок!
    scene.add(sPts);
    
    // В 2 раза дольше затухает (0.0015 -> 0.00075). И случайная скорость (±20%)
    let decayVal = 0.00075 * randomDecayMod;
    explosions.push({ mesh: sPts, vels: sVels, life: 1.0, decay: decayVal, isSmoke: true, targetScale: 40.0 * randomSizeMod, initialOpacity: 0.4 }); 

    // Взрывная волна в виде прозрачной светящейся пленки (пузырь)
    const shockwaveMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 32),
        new THREE.MeshBasicMaterial({ 
            color: 0x00aaff, 
            transparent: true, 
            opacity: 0.3, 
            side: THREE.DoubleSide, 
            depthWrite: false,
            blending: THREE.AdditiveBlending 
        })
    );
    shockwaveMesh.position.copy(pos);
    scene.add(shockwaveMesh);
    shockwaves.push({ mesh: shockwaveMesh, scale: 1.0, opacity: 0.4 });

    const dist = Math.hypot(camera.position.x - pos.x, camera.position.z - pos.z);
    if (dist < 60 && !isDead) {
        let dmg = 0;
        let knockbackForce = 0;

        if (dist <= 20) { 
            dmg = 1000; 
            knockbackForce = 15.0; 
        } else if (dist <= 60) { 
            dmg = 90; 
            knockbackForce = 10.0; 
        } 

        health -= dmg; 
        
        // Отбрасывание НАЗАД от взрыва
        if (knockbackForce > 0) {
            let dir = new THREE.Vector3().subVectors(camera.position, pos).normalize();
            dir.y = 0.8; // Приподнимаем игрока в воздух для лучшего эффекта
            velocity.add(dir.multiplyScalar(knockbackForce));
        }

        updateHUD(); checkDeath();
    }

    if (socket && socket.connected) {
        for (let id in remotePlayers) {
            const pDist = Math.hypot(remotePlayers[id].position.x - pos.x, remotePlayers[id].position.z - pos.z);
            if (pDist < 60) {
                let sDmg = pDist <= 20 ? 1000 : 90;
                let kForce = pDist <= 60 ? (pDist <= 20 ? 15.0 : 10.0) : 0;
                let kVec = {x:0, y:0, z:0};
                
                if (kForce > 0) {
                    let dir = new THREE.Vector3().subVectors(remotePlayers[id].position, pos).normalize();
                    dir.y = 0.8;
                    dir.multiplyScalar(kForce);
                    kVec = {x: dir.x, y: dir.y, z: dir.z};
                }
                
                socket.emit('hitPlayer', { targetId: id, damage: sDmg, knockback: kVec });
            }
        }
    }
}
// --- КОНЕЦ МЕГА-БОМБА ---

function shoot() {
    if (isReloading || isDead || isPaused || isThrowing) return;
    let currentMag = currentSlot === 1 ? ammo1 : ammo2;
    if (currentMag <= 0) { reload(); return; }
    const now = Date.now();
    if (now - lastShot < (currentSlot === 2 ? 100 : 250)) return;
    lastShot = now;
    if (currentSlot === 1) ammo1--; else ammo2--;
    updateHUD();
    if (shootSound && shootSound.buffer) { if (shootSound.isPlaying) shootSound.stop(); shootSound.play(); }
    
    let activeWeapon = (currentSlot === 1) ? (shotSide ? rightGun : leftGun) : autoRifle;
    const weaponWorldPos = new THREE.Vector3(); activeWeapon.getWorldPosition(weaponWorldPos);
    const shootDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    
    // Пули вылетают чуточку дальше назад (точка выстрела ближе к дулу/камере)
    const spawnPos = weaponWorldPos.clone().add(shootDir.clone().multiplyScalar(currentSlot === 1 ? -0.25 : -0.25));
    if (isAiming) {
        spawnPos.copy(camera.position).add(shootDir.clone().multiplyScalar(-0.25));
    }
    
    const bullet = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), new THREE.MeshBasicMaterial({ color: 0x00f7ff }));
    bullet.position.copy(spawnPos); 
    bullet.quaternion.copy(camera.quaternion);
    
    const dmg = currentSlot === 1 ? 15 : 10;
    bullet.userData = { velocity: shootDir.multiplyScalar(3.5), dist: 0, damage: dmg }; 
    bullets.push(bullet); scene.add(bullet);

    if (socket && socket.connected) {
        socket.emit('shoot', {
            px: spawnPos.x, py: spawnPos.y, pz: spawnPos.z,
            qx: camera.quaternion.x, qy: camera.quaternion.y, qz: camera.quaternion.z, qw: camera.quaternion.w,
            damage: dmg
        });
    }
    
    if (currentSlot === 1) { 
        if (shotSide) rightGun.position.z += 0.15; else leftGun.position.z += 0.15; 
        shotSide = !shotSide; 
    } else { autoRifle.position.z += 0.12; }
}

function throwGrenade() {
    if (grenadesAmmo <= 0 || isDead || isPaused || !controls.isLocked || isThrowing || isReloading || currentSlot === 3) return;
    grenadesAmmo--;
    updateHUD();
    
    isThrowing = true;
    throwAnimT = 1.0; 
    if (socket && socket.connected) socket.emit('startGrenadeAnim', {});
}

function spawnPhysicsGrenade() {
    let g = grenadeModelTemplate ? grenadeModelTemplate.clone() : new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({color: 0x00ff00}));
    g.position.copy(camera.position);
    
    const throwDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const initialVel = throwDir.multiplyScalar(0.6).add(new THREE.Vector3(0, 0.2, 0));
    
    g.userData = { vel: initialVel, timer: 3000 };
    scene.add(g); grenades.push(g);

    if (socket && socket.connected) {
        socket.emit('throwGrenade', {
            px: g.position.x, py: g.position.y, pz: g.position.z,
            vx: initialVel.x, vy: initialVel.y, vz: initialVel.z
        });
    }
}

function createBulletImpact(pos) {
    const count = 10;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels =[];
    for(let i = 0; i < count; i++) {
        positions[i*3] = 0; 
        positions[i*3+1] = 0; 
        positions[i*3+2] = 0;
        vels.push(new THREE.Vector3((Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x00f7ff, size: 0.1 });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(pos);
    scene.add(pts);
    impactVFX.push({ mesh: pts, vels: vels, life: 1.0 });
}

function explode(pos) {
    if (grenadeSound && grenadeSound.buffer) {
        if (grenadeSound.isPlaying) grenadeSound.stop();
        grenadeSound.play();
    }

    // Раскидываем старый дым (своему даем иммунитет)
    pushExistingSmoke(pos, 35, 1.5);

    // Рандомизация размера, густоты и времени (±20%)
    let randomSizeMod = 0.8 + Math.random() * 0.4;
    let randomDecayMod = 0.8 + Math.random() * 0.4;

    // Искры
    const count = 250; 
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels =[];
    for(let i=0; i<count; i++) {
        positions[i*3] = 0; 
        positions[i*3+1] = 0; 
        positions[i*3+2] = 0;
        vels.push(new THREE.Vector3((Math.random()-0.5)*3.5, (Math.random()-0.5)*3.5, (Math.random()-0.5)*3.5));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ 
        color: 0xffaa00, 
        size: 0.8, 
        map: particleTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(pos);
    scene.add(pts);
    explosions.push({ mesh: pts, vels: vels, life: 1.0, decay: 0.05 });

    // Дым от гранаты - Меньше густоты с учетом рандома
    const baseSmokeCount = 75;
    const smokeCount = Math.floor(baseSmokeCount * randomSizeMod);
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(smokeCount * 3);
    const sVels =[];
    for(let i=0; i<smokeCount; i++) {
        let r = Math.random() * 8 * randomSizeMod;
        let theta = Math.random() * Math.PI * 2;
        
        sPos[i*3] = Math.cos(theta)*r; 
        sPos[i*3+1] = Math.random()*6 * randomSizeMod; 
        sPos[i*3+2] = Math.sin(theta)*r;
        
        sVels.push(new THREE.Vector3(0, 0, 0)); // Нулевая начальная скорость
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sMat = new THREE.PointsMaterial({ 
        color: 0x333333, 
        size: 6.0 * randomSizeMod, 
        map: particleTexture,
        transparent: true, 
        opacity: 0.35, // Снижена густота
        depthWrite: false,
        blending: THREE.NormalBlending
    });
    const sPts = new THREE.Points(sGeo, sMat);
    sPts.position.copy(pos); // Перемещаем сетку!
    scene.add(sPts);
    
    // Замедляем рассеивание на 18% (0.003 * 1.18 = ~0.00354) + случайное время
    let decayVal = 0.00354 * randomDecayMod;
    explosions.push({ mesh: sPts, vels: sVels, life: 1.0, decay: decayVal, isSmoke: true, targetScale: 15.0 * randomSizeMod, initialOpacity: 0.35 });

    // Увеличен радиус урона с 12 до 20
    if (pos.distanceTo(camera.position) < 20 && !isDead) {
        health -= 40; updateHUD(); checkDeath();
    }
    
    enemies.forEach((drone, j) => {
        if (pos.distanceTo(drone.position) < 20) {
            drone.userData.hp -= 5;
            if (drone.userData.hp <= 0) { scene.remove(drone); enemies.splice(j, 1); }
        }
    });

    if (socket && socket.connected) {
        for (let id in remotePlayers) {
            if (pos.distanceTo(remotePlayers[id].position) < 20) {
                socket.emit('hitPlayer', { targetId: id, damage: 40 });
            }
        }
    }
}

function reload() {
    if (isReloading || isDead || isPaused || isThrowing || currentSlot === 3) return;
    let currentMag = currentSlot === 1 ? ammo1 : ammo2;
    let maxMag = currentSlot === 1 ? 100 : 30;
    if (currentMag >= maxMag) return; 
    let inv = currentSlot === 1 ? ammoInventory1 : ammoInventory2;
    if (inv <= 0) return; 
    
    isReloading = true; reloadAnimT = 1.0; 
    
    setTimeout(() => {
        if (currentSlot === 1) { let take = Math.min(100 - ammo1, ammoInventory1); ammo1 += take; ammoInventory1 -= take; } 
        else { let take = Math.min(30 - ammo2, ammoInventory2); ammo2 += take; ammoInventory2 -= take; }
        updateHUD(); isReloading = false; reloadAnimT = 0;
    }, 1275); 
}

function updateHUD() {
    const ammoUI = document.getElementById('ammo-count');
    if (ammoUI) {
        if (currentSlot === 3) ammoUI.innerText = `BOMB / --`;
        else ammoUI.innerText = `${currentSlot === 1 ? ammo1 : ammo2} / ${currentSlot === 1 ? ammoInventory1 : ammoInventory2}`;
    }
    const hBar = document.getElementById('health-bar');
    if (hBar) hBar.style.width = health + '%';
    const grenUI = document.getElementById('grenade-count');
    if (grenUI) grenUI.innerText = grenadesAmmo;
}

// НОВАЯ СИСТЕМА КОЛЛИЗИЙ - с хитбоксом головы и правильным скольжением
function checkCollision() { 
    const pR = 0.8; 
    
    for (let obs of obstacles) {
        const obsPos = obs.parent.position;
        const dx = Math.abs(camera.position.x - obsPos.x);
        const dz = Math.abs(camera.position.z - obsPos.z);
        if (dx < 2.0 + pR && dz < 2.0 + pR) {
            return true;
        }
    }

    for (let id in remotePlayers) {
        const p = remotePlayers[id].position;
        const dx = Math.abs(camera.position.x - p.x);
        const dz = Math.abs(camera.position.z - p.z);
        
        // Хитбокс тела и головы. Ноги: y - 1.6. Голова игрока: p.y + 2.7
        if (dx < 1.2 && dz < 1.2 && (camera.position.y - 1.6) < (p.y + 2.7) && (camera.position.y + 0.2) > p.y) return true;
    }

    return false;
}

function animate() {
    requestAnimationFrame(animate);
    if (!controls || !scene || !camera) return;

    // Мигалка на полу и в воздухе, но в руке она не светится
    let blink = Math.abs(Math.sin(Date.now() * 0.005));
    let allBombs = Object.values(activeMegaBombs).concat(flyingMegaBombs);
    allBombs.forEach(b => {
        if(b) {
            b.children.forEach(c => {
                if (c.isPointLight && c.name === "bombLight") c.intensity = blink * 3;
                if (c.isMesh) c.material.emissiveIntensity = blink;
            });
        }
    });
    if (megaBombWeapon) {
        megaBombWeapon.children.forEach(c => {
            if (c.isPointLight && c.name === "bombLight") c.intensity = 0.0;
            if (c.isMesh) c.material.emissiveIntensity = 0.0; // В руке без мигания
        });
    }

    let canPickBomb = false;
    if (currentSlot !== 3) {
        for (let id in activeMegaBombs) {
            if (camera.position.distanceTo(activeMegaBombs[id].position) < 3) canPickBomb = true;
        }
    } else { canPickBomb = true; }
    document.getElementById('interaction-text').style.display = canPickBomb ? 'block' : 'none';

    // --- ЛОГИКА ЛОКАЛЬНОГО ИГРОКА ---
    if (controls.isLocked && !isDead && !isPaused) {
        if (isShooting && currentSlot === 2) shoot();
        
        if (isAiming && currentSlot !== 3 && !isReloading && !isThrowing) {
            camera.fov = THREE.MathUtils.lerp(camera.fov, 40, 0.2);
            document.getElementById('crosshair').style.transform = 'translate(-50%, -50%) scale(0.5)';
        } else {
            camera.fov = THREE.MathUtils.lerp(camera.fov, 75, 0.2);
            document.getElementById('crosshair').style.transform = 'translate(-50%, -50%) scale(1)';
        }
        camera.updateProjectionMatrix();

        let speedMult = isAiming ? 0.5 : 1; 
        
        // --- СТАМИНА ---
        if (isSprinting && stamina > 0 && (moveForward || moveBackward || moveLeft || moveRight) && !isAiming) {
            speedMult = 1.6; 
            stamina -= 0.2; // Меньше тратится (было 0.4)
        } else if (stamina < 100) { 
            stamina += 0.4; // Быстрее восстанавливается (было 0.25)
        }
        
        const staminaBar = document.getElementById('stamina-bar');
        if (staminaBar) staminaBar.style.width = Math.max(0, stamina) + '%';
        
        const delta = 0.05 * speedMult;
        velocity.x -= velocity.x * 10 * 0.05; velocity.z -= velocity.z * 10 * 0.05;
        direction.z = Number(moveForward) - Number(moveBackward); direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); 
        
        if (moveForward || moveBackward) velocity.z -= direction.z * 40 * 0.05;
        if (moveLeft || moveRight) velocity.x -= direction.x * 40 * 0.05;

        // ПЛАВНОЕ СКОЛЬЖЕНИЕ (Мировые координаты)
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        camDir.y = 0; camDir.normalize();
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        camRight.y = 0; camRight.normalize();

        const moveX = camRight.x * (-velocity.x * delta) + camDir.x * (-velocity.z * delta);
        const moveZ = camRight.z * (-velocity.x * delta) + camDir.z * (-velocity.z * delta);

        camera.position.x += moveX;
        if (checkCollision()) { 
            camera.position.x -= moveX; 
            velocity.x *= 0.5; // Гасим импульс об стену
        }

        camera.position.z += moveZ;
        if (checkCollision()) { 
            camera.position.z -= moveZ; 
            velocity.z *= 0.5; 
        }
        
        let floorY = 1.6; 
        for (let id in remotePlayers) {
            const p = remotePlayers[id].position;
            const dist = Math.hypot(camera.position.x - p.x, camera.position.z - p.z);
            if (dist < 1.2) {
                const playerTop = p.y + 2.5; 
                if (camera.position.y >= playerTop - 0.5) {
                    floorY = Math.max(floorY, playerTop);
                }
            }
        }

        velocityY -= 0.008; 
        camera.position.y += velocityY;
        if (camera.position.y <= floorY) {
            camera.position.y = floorY;
            if (velocityY < 0) { velocityY = 0; canJump = true; }
        }

        const time = Date.now() * 0.003;
        const bob = Math.sin(time) * ((moveForward || moveBackward || moveLeft || moveRight) ? (isAiming ? 0.003 : 0.012) : 0.001);
        
        if (isReloading) reloadAnimT -= 0.013; 
        if (reloadAnimT < 0) reloadAnimT = 0;

        // Анимация рука тянется к чеке -> выдергивает -> замах -> бросок
        if (isThrowing) {
            throwAnimT -= 0.015; 
            leftGun.visible = true; rightGun.visible = false; autoRifle.visible = false;
            
            // Временно прячем пистолет в левой руке
            let pGroup = leftGun.children[0]; 
            if(pGroup) pGroup.visible = false; 

            if (animGrenadeMesh) {
                animGrenadeMesh.visible = true;
                if (throwAnimT > 0.8) {
                    // 1. Рука тянется к чеке (к центру)
                    animGrenadeMesh.position.lerp(new THREE.Vector3(0, -0.3, -0.4), 0.2);
                    leftGun.position.lerp(new THREE.Vector3(-0.2, -0.3, -0.4), 0.2);
                    leftGun.rotation.z = THREE.MathUtils.lerp(leftGun.rotation.z, Math.PI / 4, 0.2);
                } else if (throwAnimT > 0.5) {
                    // 2. Выдергивает чеку (рука отдергивается влево)
                    animGrenadeMesh.position.lerp(new THREE.Vector3(0, -0.3, -0.4), 0.2);
                    leftGun.position.lerp(new THREE.Vector3(-0.4, -0.4, -0.3), 0.4); 
                    leftGun.rotation.z = THREE.MathUtils.lerp(leftGun.rotation.z, 0, 0.4);
                } else if (throwAnimT > 0.25) {
                    // 3. Замах (граната уходит вверх и назад)
                    animGrenadeMesh.position.lerp(new THREE.Vector3(0.3, 0.2, -0.2), 0.3);
                    animGrenadeMesh.rotation.x = THREE.MathUtils.lerp(animGrenadeMesh.rotation.x, -0.5, 0.3);
                } else {
                    // 4. Бросок вперед
                    animGrenadeMesh.position.lerp(new THREE.Vector3(0, -0.1, -0.8), 0.4);
                    animGrenadeMesh.rotation.x -= 0.4;
                }
            }

            if (throwAnimT <= 0.25 && throwAnimT + 0.015 > 0.25) {
                spawnPhysicsGrenade(); 
            }
            if (throwAnimT <= 0) {
                isThrowing = false;
                if(pGroup) pGroup.visible = true;
                leftGun.rotation.z = 0;
                if (animGrenadeMesh) {
                    animGrenadeMesh.visible = false;
                    animGrenadeMesh.position.set(0.3, -0.3, -0.5); // Сброс позиции
                }
                switchWeapon(currentSlot);
            }
        } else {
            if (animGrenadeMesh) animGrenadeMesh.visible = false;
            
            let aimTargetLeft = new THREE.Vector3(-0.4, -0.35, -0.6);
            let aimTargetRight = new THREE.Vector3(0.4, -0.35, -0.6);
            let aimTargetRifle = new THREE.Vector3(0.3, -0.35, -0.8);

            if (isAiming) {
                aimTargetLeft.set(-0.15, -0.2, -0.5);
                aimTargetRight.set(0.15, -0.2, -0.5);
                aimTargetRifle.set(0, -0.25, -0.6);
            }

            leftGun.position.lerp(aimTargetLeft, 0.2);
            rightGun.position.lerp(aimTargetRight, 0.2);
            autoRifle.position.lerp(aimTargetRifle, 0.2);[leftGun, rightGun, autoRifle].forEach(g => { 
                if(g) {
                    let reloadY = 0; let reloadRot = 0;
                    if (isReloading && reloadAnimT > 0) {
                        const cycle = Math.sin((1.0 - reloadAnimT) * Math.PI);
                        reloadY = -0.4 * cycle; reloadRot = -0.6 * cycle; 
                    }
                    g.position.y += bob + reloadY; 
                    g.rotation.x = reloadRot;
                }
            });
        }

        leftGun.position.z += (-0.6 - leftGun.position.z) * 0.1; 
        rightGun.position.z += (-0.6 - rightGun.position.z) * 0.1; 
        autoRifle.position.z += (-0.8 - autoRifle.position.z) * 0.1;

        for (let i = pickups.length - 1; i >= 0; i--) {
            if (camera.position.distanceTo(pickups[i].position) < 2) {
                const item = pickups[i];
                if (item.userData.type === 'health') {
                    health = Math.min(100, health + item.userData.amount);
                } else { 
                    ammoInventory1 += item.userData.amount; 
                    ammoInventory2 += 30; 
                    grenadesAmmo += 1; 
                }
                updateHUD(); 
                if(socket && socket.connected) socket.emit('pickupItem', { id: item.userData.id });
                scene.remove(item); pickups.splice(i, 1);
            }
        }
    }

    // --- ЛОГИКА МИРА И МУЛЬТИПЛЕЕРА ---
    for (let id in remotePlayers) {
        if (targetPositions[id]) {
            const target = targetPositions[id];
            
            remotePlayers[id].position.lerp(new THREE.Vector3(target.x, target.y, target.z), 0.2);
            remotePlayers[id].rotation.y = lerpAngle(remotePlayers[id].rotation.y, target.ry + Math.PI, 0.3);
            
            if (remoteWeapons[id]) {
                const pistol = remoteWeapons[id].getObjectByName('pistol');
                const rifle = remoteWeapons[id].getObjectByName('rifle');
                const grenadeItem = remoteWeapons[id].getObjectByName('grenade');
                
                // Анимация броска гранаты у удаленных игроков
                if (target.throwing && target.throwing > 0) {
                    target.throwing -= 0.015;
                    
                    if (pistol) pistol.visible = false;
                    if (rifle) rifle.visible = false;
                    if (grenadeItem) grenadeItem.visible = true;

                    // Анимация: тянется, выдергивает, замах, бросок
                    if (target.throwing > 0.7) {
                        remoteWeapons[id].rotation.x = lerpAngle(remoteWeapons[id].rotation.x, 0, 0.3);
                    } else if (target.throwing > 0.4) {
                        remoteWeapons[id].rotation.x = lerpAngle(remoteWeapons[id].rotation.x, Math.PI / 4, 0.3);
                    } else if (target.throwing > 0.2) {
                        remoteWeapons[id].rotation.x = lerpAngle(remoteWeapons[id].rotation.x, -Math.PI / 2, 0.3);
                    }
                } else if (target.reloading) {
                    if (grenadeItem) grenadeItem.visible = false;
                    remoteWeapons[id].rotation.x = lerpAngle(remoteWeapons[id].rotation.x, -0.6, 0.3);
                    remoteWeapons[id].position.y = THREE.MathUtils.lerp(remoteWeapons[id].position.y, 0.8, 0.3);
                } else {
                    if (grenadeItem) grenadeItem.visible = false;
                    remoteWeapons[id].rotation.x = lerpAngle(remoteWeapons[id].rotation.x, target.rx || 0, 0.3);
                    if (target.aiming) {
                        remoteWeapons[id].position.y = THREE.MathUtils.lerp(remoteWeapons[id].position.y, 1.8, 0.2);
                    } else {
                        remoteWeapons[id].position.y = THREE.MathUtils.lerp(remoteWeapons[id].position.y, 1.2, 0.2);
                    }
                }

                // Видимость оружия, если не кидает гранату
                if (pistol && rifle && (!target.throwing || target.throwing <= 0)) {
                    if (target.slot === 2) { pistol.visible = false; rifle.visible = true; }
                    else if (target.slot === 1) { pistol.visible = true; rifle.visible = false; }
                    else { pistol.visible = false; rifle.visible = false; }
                }
            }
        }
    }

    grenades.forEach((g, i) => {
        let nextPos = g.position.clone().add(g.userData.vel);
        
        // Коллизия гранат со стенами
        let ray = new THREE.Raycaster(g.position, g.userData.vel.clone().normalize(), 0, g.userData.vel.length());
        let intersects = ray.intersectObjects(obstacles, false); // проверяем препятствия
        
        if (intersects.length > 0) {
            // Отскок от стены
            let n = intersects[0].face.normal;
            g.userData.vel.reflect(n).multiplyScalar(0.6); 
            g.position.add(g.userData.vel);
        } else {
            g.position.copy(nextPos);
        }

        g.userData.vel.y -= 0.01; 
        
        if (g.position.y < 0.2) { 
            g.position.y = 0.2; 
            g.userData.vel.y *= -0.5; 
            g.userData.vel.x *= 0.8; 
            g.userData.vel.z *= 0.8; 
        }
        
        g.userData.timer -= 16; 
        if (g.userData.timer <= 0) {
            explode(g.position);
            scene.remove(g); 
            grenades.splice(i, 1);
        }
    });

    // Летающие мега-бомбы
    flyingMegaBombs.forEach((b, i) => {
        if (!b.userData.attachedTo) {
            b.position.add(b.userData.vel);
            b.userData.vel.y -= 0.01; 

            // Проверка на прилипание к игрокам и СТЕНАМ
            if (b.userData.isLocal) {
                let hitTarget = false;
                for (let pid in remotePlayers) {
                    let pPos = remotePlayers[pid].position;
                    let dx = Math.abs(b.position.x - pPos.x);
                    let dz = Math.abs(b.position.z - pPos.z);
                    let dy = b.position.y - pPos.y;

                    // Цилиндрическая проверка (учитываем голову и тело игрока)
                    if (dx < 1.0 && dz < 1.0 && dy > -0.5 && dy < 3.0) {
                        let localOffset = b.position.clone().sub(remotePlayers[pid].position);
                        localOffset.applyAxisAngle(new THREE.Vector3(0,1,0), -remotePlayers[pid].rotation.y);
                        
                        attachMegaBombToPlayer(b.userData.id, pid, localOffset);
                        
                        if(socket && socket.connected) {
                            socket.emit('megaBombAttach', { 
                                bombId: b.userData.id, 
                                playerId: pid, 
                                offset: {x: localOffset.x, y: localOffset.y, z: localOffset.z} 
                            });
                        }
                        hitTarget = true; break;
                    }
                }
                
                if (!hitTarget) {
                    for (let obs of obstacles) {
                        const obsPos = obs.parent.position;
                        if (Math.abs(b.position.x - obsPos.x) < 2.3 && Math.abs(b.position.z - obsPos.z) < 2.3 && b.position.y < 50) {
                            b.userData.attachedTo = 'world'; // Прилипает к стене
                            b.userData.vel.set(0,0,0);
                            break;
                        }
                    }
                }
            }
            
            if (!b.userData.attachedTo && b.position.y < 0.3) { 
                b.position.y = 0.3; 
                b.userData.vel.y *= -0.3; 
                b.userData.vel.x *= 0.5; 
                b.userData.vel.z *= 0.5; 
            }
        }

        b.userData.timer -= 16; 
        
        if (b.userData.timer < b.userData.nextBeep) {
            if(pikSound) { if(pikSound.isPlaying) pikSound.stop(); pikSound.play(); }
            // Ускоряем пиканье перед взрывом
            let step = b.userData.timer < 2000 ? 250 : 500;
            b.userData.nextBeep -= step; 
        }

        if (b.userData.timer <= 0) {
            let expPos = new THREE.Vector3();
            b.getWorldPosition(expPos);
            explodeMegaBomb(expPos);
            if(b.parent) b.parent.remove(b); else scene.remove(b);
            flyingMegaBombs.splice(i, 1);
        }
    });

    for (let id in activeMegaBombs) {
        activeMegaBombs[id].rotation.y += 0.02;
        activeMegaBombs[id].position.y = 0.5 + Math.sin(Date.now() * 0.003) * 0.1;
    }

    // Обработка рассеивания дыма и физики ветра от взрывов
    for (let i = explosions.length - 1; i >= 0; i--) {
        let exp = explosions[i];
        const positions = exp.mesh.geometry.attributes.position.array;
        for (let j = 0; j < exp.vels.length; j++) {
            positions[j*3] += exp.vels[j].x;
            positions[j*3+1] += exp.vels[j].y;
            positions[j*3+2] += exp.vels[j].z;
            
            if(exp.isSmoke) {
                // Броуновское движение (дыхание и дрожь тумана в воздухе)
                exp.vels[j].x += (Math.random() - 0.5) * 0.008;
                exp.vels[j].y += (Math.random() - 0.5) * 0.008 + 0.001; // легкий подъем
                exp.vels[j].z += (Math.random() - 0.5) * 0.008;

                // Плавная остановка дыма. Если его сдуло другой бомбой, он плавно затормозит.
                exp.vels[j].x *= 0.92;
                exp.vels[j].y *= 0.92; 
                exp.vels[j].z *= 0.92;
            } else {
                exp.vels[j].y -= 0.05; // Искры падают вниз
            }
        }
        exp.mesh.geometry.attributes.position.needsUpdate = true;

        if (exp.isSmoke) {
            // Плавное увеличение размера самой текстуры частицы (туман пухнет, оставаясь на месте!)
            exp.mesh.material.size = THREE.MathUtils.lerp(exp.mesh.material.size, exp.targetScale || 15.0, 0.01);
        }

        // Жизнь дыма линейно уходит в ноль
        exp.life -= exp.decay;
        
        // Линейное и абсолютно плавное затухание от начала до конца
        if (exp.isSmoke) {
            exp.mesh.material.opacity = Math.max(0, exp.life * (exp.initialOpacity || 0.7));
        } else {
            exp.mesh.material.opacity = Math.max(0, exp.life);
        }

        if (exp.life <= 0) {
            scene.remove(exp.mesh);
            explosions.splice(i, 1);
        }
    }

    for (let i = shockwaves.length - 1; i >= 0; i--) {
        let sw = shockwaves[i];
        sw.scale += 2.0; // Волны плёнки расширяются быстрее
        sw.mesh.scale.set(sw.scale, sw.scale, sw.scale);
        sw.opacity -= 0.002; // Медленнее пропадает
        sw.mesh.material.opacity = sw.opacity;
        if (sw.opacity <= 0) {
            scene.remove(sw.mesh);
            shockwaves.splice(i, 1);
        }
    }

    impactVFX.forEach((imp, i) => {
        const positions = imp.mesh.geometry.attributes.position.array;
        for (let j = 0; j < imp.vels.length; j++) {
            positions[j*3] += imp.vels[j].x; positions[j*3+1] += imp.vels[j].y; positions[j*3+2] += imp.vels[j].z;
        }
        imp.mesh.geometry.attributes.position.needsUpdate = true;
        imp.mesh.material.opacity = imp.life;
        imp.life -= 0.1;
        if (imp.life <= 0) { scene.remove(imp.mesh); impactVFX.splice(i, 1); }
    });

    enemies.forEach(drone => {
        drone.position.y += Math.sin(Date.now() * 0.002 + drone.userData.offset) * 0.02;
        if (drone.position.distanceTo(camera.position) < 80) {
            drone.lookAt(camera.position);
            if (Date.now() - drone.userData.lastShot > 1500) { enemyShoot(drone); drone.userData.lastShot = Date.now(); }
        }
    });

    bullets.forEach((b, i) => {
        const nextPos = b.position.clone().add(b.userData.velocity);
        
        const ray = new THREE.Raycaster(b.position, b.userData.velocity.clone().normalize(), 0, b.userData.velocity.length());
        const intersects = ray.intersectObjects(obstacles);
        if (intersects.length > 0) {
            createBulletImpact(intersects[0].point); 
            scene.remove(b); bullets.splice(i, 1); return;
        }

        if (!b.userData.isRemote) {
            for (let id in remotePlayers) {
                const pPos = remotePlayers[id].position;
                const dx = Math.abs(b.position.x - pPos.x);
                const dz = Math.abs(b.position.z - pPos.z);
                
                if (dx < 0.8 && dz < 0.8) { 
                    if (b.position.y > pPos.y + 1.5 && b.position.y <= pPos.y + 2.8) {
                        socket.emit('hitPlayer', { targetId: id, damage: b.userData.damage * 2 });
                        scene.remove(b); bullets.splice(i, 1); return;
                    } else if (b.position.y > pPos.y && b.position.y <= pPos.y + 1.5) {
                        socket.emit('hitPlayer', { targetId: id, damage: b.userData.damage });
                        scene.remove(b); bullets.splice(i, 1); return;
                    }
                }
            }
        }

        b.position.copy(nextPos); 
        b.userData.dist += b.userData.velocity.length();
        
        enemies.forEach((drone, j) => {
            if (b.position.distanceTo(drone.position) < 2.5) {
                drone.userData.hp -= 1; scene.remove(b); bullets.splice(i, 1);
                if (drone.userData.hp <= 0) { scene.remove(drone); enemies.splice(j, 1); }
            }
        });
        if (b.userData.dist > 250) { scene.remove(b); bullets.splice(i, 1); }
    });

    enemyBullets.forEach((eb, i) => {
        eb.position.add(eb.userData.velocity);
        if (eb.position.distanceTo(camera.position) < 1.5 && !isDead && !isPaused) { 
            health -= 10; updateHUD(); checkDeath();
            scene.remove(eb); enemyBullets.splice(i, 1);
        } else if (eb.position.distanceTo(camera.position) > 200) { scene.remove(eb); enemyBullets.splice(i, 1); }
    });

    renderer.render(scene, camera);
}

function enemyShoot(drone) {
    const eb = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    eb.position.copy(drone.position);
    eb.userData = { velocity: new THREE.Vector3().subVectors(camera.position, drone.position).normalize().multiplyScalar(1.2) };
    enemyBullets.push(eb); scene.add(eb);
}

function spawnAdvancedEnemies(count) {
    for (let i = 0; i < count; i++) {
        const drone = new THREE.Group();
        drone.add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 16), new THREE.MeshStandardMaterial({ color: 0xff0000 })));
        const angle = Math.random() * Math.PI * 2; const radius = 60 + Math.random() * 200;
        drone.position.set(Math.cos(angle) * radius, 10, Math.sin(angle) * radius);
        drone.userData = { lastShot: 0, offset: Math.random() * 100, hp: 2 };
        enemies.push(drone); scene.add(drone);
    }
}

function onKeyDown(e) {
    if (isDead) return;
    if (e.code === 'Escape') {
        if (isPaused) resumeGame(); else controls.unlock();
        return;
    }
    if (isPaused) return; 
    if (e.code === 'KeyW') moveForward = true; if (e.code === 'KeyS') moveBackward = true;
    if (e.code === 'KeyA') moveLeft = true; if (e.code === 'KeyD') moveRight = true;
    if (e.code === 'ShiftLeft') isSprinting = true; if (e.code === 'KeyR') reload();
    
    if (e.code === 'Space' && canJump) { velocityY = 0.15; canJump = false; }
    if (e.code === 'KeyG') throwGrenade();
    if (e.code === 'KeyE') interactMegaBomb();

    if (e.code === 'Digit1' && !isThrowing) { switchWeapon(1); }
    if (e.code === 'Digit2' && !isThrowing) { switchWeapon(2); }
}

function onKeyUp(e) {
    if (e.code === 'KeyW') moveForward = false; if (e.code === 'KeyS') moveBackward = false;
    if (e.code === 'KeyA') moveLeft = false; if (e.code === 'KeyD') moveRight = false;
    if (e.code === 'ShiftLeft') isSprinting = false;
}