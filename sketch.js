/*
 * COIN MAZE / 中期作业 / p5.js 2.3.4
 * 直接把这个文件全部复制到 p5.js 编辑器的 sketch.js 即可运行。
 * 将 dark_place.mp3 上传到 sketch.js 同一级。UI 样式也在本文件中。
 * WASD / 方向键移动；鼠标照明；P 暂停；M 静音；R 重新开始。
 * 声音替换位置：文件末尾的 Sound 类。
 */

// ---------- 1. 可调整参数 ----------
const SETTINGS = {
  columns: 19,             // 奇数：迷宫宽度
  rows: 15,                // 奇数：迷宫高度
  cell: 38,               // 每格大小
  wallHeight: 22,          // 矮墙厚度 / 2.5D 外观
  tilt: 0.58,             // 俯视倾角，0 = 完全俯视
  stepSeconds: 0.15,       // 移动一格所需时间
  beamLength: 245,         // 手电长度
  beamHalfAngle: 0.63,     // 手电半角，弧度
  firstCoins: 6,
  musicFile: 'dark_place.mp3', // 与左侧上传的完整音频文件名保持一致
  musicVolume: 0.18,       // 背景音乐音量：0～1
  maxMonsters: 5,          // 第一关 1 只，每过一关 +1，最多 5 只
  monsterStepSeconds: 0.48, // 第一关怪兽移动一格的时间
  monsterSpeedGrowth: 0.90, // 每升一关，移动时间缩短 10%
  monsterMinStep: 0.19,     // 速度上限，仍稍慢于玩家
  contactDistance: 20,     // 两个角色身体接触的距离
  trailWidth: 3,          // 冰蓝轨迹核心宽度，远小于 38px 格子
  trailGlowWidth: 12      // 柔光总宽度，不铺满整格
};
let maze, walls, coins, player, floorLight, glowTexture, monsterGlow, trailLayer;
let monsters = [];
let visitedTrail = new Set(), trailEdges = new Set(), lastTrailCell = null;
let phase = 'intro', level = 1, totalCoins = 0, collected = 0;
let elapsed = 0, transition = 0, aim = 0, fit = 1, boardOffset = 28;
let particles = [], touchDirection = null, pointerAim = false;
let sound, ui, lastBump = -1;
const W = SETTINGS.columns * SETTINGS.cell;
const H = SETTINGS.rows * SETTINGS.cell;
const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 1.5));
  noStroke();
  textureMode(NORMAL);
  floorLight = createGraphics(W, H);
  floorLight.pixelDensity(1);
  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  glowTexture = createGraphics(64, 64);
  glowTexture.pixelDensity(1);
  const ctx = glowTexture.drawingContext;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,198,86,0.55)');
  gradient.addColorStop(0.23, 'rgba(255,178,63,0.18)');
  gradient.addColorStop(1, 'rgba(255,170,55,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  monsterGlow = createGraphics(96, 96);
  monsterGlow.pixelDensity(1);
  const redContext = monsterGlow.drawingContext;
  const redGlow = redContext.createRadialGradient(48, 48, 0, 48, 48, 48);
  redGlow.addColorStop(0, 'rgba(255,70,96,0.55)');
  redGlow.addColorStop(0.28, 'rgba(255,48,79,0.24)');
  redGlow.addColorStop(1, 'rgba(255,48,79,0)');
  redContext.fillStyle = redGlow;
  redContext.fillRect(0, 0, 96, 96);
  sound = new Sound();
  createInterface();
  newLevel();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') pauseGame();
    if (document.hidden) sound.pauseMusic();
    else sound.playMusic();
  });
  window.addEventListener('blur', () => {
    touchDirection = null;
    if (phase === 'playing') pauseGame();
    else sound.pauseMusic();
  });
  window.addEventListener('focus', () => sound.playMusic());
}

// ---------- 2. 随机迷宫：深度优先生成 + 少量环路 ----------
// 所有通路从同一起点挖出，所以每枚金币都可到达。
function newLevel() {
  maze = Array.from({length: SETTINGS.rows}, () => Array(SETTINGS.columns).fill(1));
  const stack = [[1, 1]];
  maze[1][1] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const choices = dirs.filter(([dx, dy]) => {
      const nx = x + dx * 2, ny = y + dy * 2;
      return nx > 0 && ny > 0 && nx < SETTINGS.columns - 1 &&
        ny < SETTINGS.rows - 1 && maze[ny][nx] === 1;
    });
    if (!choices.length) { stack.pop(); continue; }
    const [dx, dy] = random(choices);
    maze[y + dy][x + dx] = 0;
    maze[y + dy * 2][x + dx * 2] = 0;
    stack.push([x + dx * 2, y + dy * 2]);
  }
  for (let y = 1; y < SETTINGS.rows - 1; y++) {
    for (let x = 1; x < SETTINGS.columns - 1; x++) {
      if (maze[y][x] && ((x % 2 === 0) !== (y % 2 === 0)) && random() < 0.12) {
        maze[y][x] = 0;
      }
    }
  }
  walls = [];
  const spaces = [];
  for (let y = 0; y < SETTINGS.rows; y++) {
    for (let x = 0; x < SETTINGS.columns; x++) {
      if (maze[y][x]) walls.push({x, y, brightness: 0});
      else if (x + y > 5) spaces.push({x, y});
    }
  }
  // 尽量分散金币；回退分支保证数量，不会重复。
  coins = [];
  const count = Math.min(SETTINGS.firstCoins + level - 1, 12, spaces.length);
  const pool = shuffle(spaces);
  for (const space of pool) {
    if (coins.length >= count) break;
    if (coins.every(c => Math.hypot(c.x - space.x, c.y - space.y) >= 3)) {
      coins.push({...space, taken: false, seed: random(TWO_PI)});
    }
  }
  for (const space of pool) {
    if (coins.length >= count) break;
    if (!coins.some(c => c.x === space.x && c.y === space.y)) {
      coins.push({...space, taken: false, seed: random(TWO_PI)});
    }
  }
  player = {x: 1, y: 1, px: worldX(1), py: worldY(1), move: null};
  resetTrail();
  spawnMonsters();
  aim = isOpen(2, 1) ? 0 : HALF_PI;
  pointerAim = false;
  collected = 0;
  particles = [];
  updateHud();
}

function worldX(x) { return (x + 0.5) * SETTINGS.cell - W / 2; }
function worldY(y) { return (y + 0.5) * SETTINGS.cell - H / 2; }
function isOpen(x, y) { return maze[y]?.[x] === 0; }
function blockedAt(x, y) {
  return !isOpen(Math.floor((x + W / 2) / SETTINGS.cell), Math.floor((y + H / 2) / SETTINGS.cell));
}

// 路径只在首次踩到格子 / 首次走过连接时绘制，回头不会叠加变亮。
function resetTrail() {
  visitedTrail.clear();
  trailEdges.clear();
  lastTrailCell = null;
  trailLayer.clear();
  recordTrail(player.x, player.y);
}
function recordTrail(x, y) {
  if (!isOpen(x, y)) return;
  const key = `${x},${y}`, cx = (x + 0.5) * SETTINGS.cell, cy = (y + 0.5) * SETTINGS.cell;
  const ctx = trailLayer.drawingContext;
  ctx.save();
  ctx.lineCap = 'round';
  if (lastTrailCell && Math.abs(lastTrailCell.x - x) + Math.abs(lastTrailCell.y - y) === 1) {
    const edge = [lastTrailCell.key, key].sort().join('|');
    if (!trailEdges.has(edge)) {
      trailEdges.add(edge);
      const sx = (lastTrailCell.x + 0.5) * SETTINGS.cell, sy = (lastTrailCell.y + 0.5) * SETTINGS.cell;
      // 硬限制光带总宽，避免模糊阴影溢出、照亮整个格子。
      for (const [width, color] of [[SETTINGS.trailGlowWidth, 'rgba(100,218,250,0.06)'],
        [8, 'rgba(112,225,255,0.13)'], [5, 'rgba(127,232,255,0.28)'],
        [SETTINGS.trailWidth, 'rgba(152,239,255,0.8)'], [1, 'rgba(210,250,255,0.82)']]) {
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx, cy); ctx.stroke();
      }
    }
  }
  if (!visitedTrail.has(key)) {
    visitedTrail.add(key);
    const radius = SETTINGS.trailGlowWidth / 2;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, 'rgba(190,247,255,0.8)');
    glow.addColorStop(0.3, 'rgba(140,235,255,0.5)');
    glow.addColorStop(1, 'rgba(110,220,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  lastTrailCell = {x, y, key};
}

// ---------- 3. 游戏状态与格子移动 ----------
function draw() {
  const dt = Math.min(deltaTime / 1000, 0.045);
  updateGame(dt);
  if (phase === 'cleared') {
    transition -= dt;
    if (transition <= 0) {
      level++;
      newLevel();
      phase = 'playing';
      ui.toast.classList.remove('visible');
    }
  }
  if (phase === 'playing' && pointerAim) {
    const mx = (mouseX - width / 2) / fit;
    const my = (mouseY - height / 2 - boardOffset) / (fit * Math.cos(SETTINGS.tilt));
    if (Math.hypot(mx - player.px, my - player.py) > 8) aim = Math.atan2(my - player.py, mx - player.px);
  }
  for (const p of particles) { if (phase !== 'paused') p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  renderScene(dt);
  if (frameCount % 15 === 0) updateHud();
}

function readDirection() {
  if (touchDirection) return touchDirection;
  // p5.js 2.x 使用字符串，不能用旧版 37/38/39/40 数字键码。
  if (keyIsDown('ArrowUp') || keyIsDown('KeyW')) return [0, -1];
  if (keyIsDown('ArrowDown') || keyIsDown('KeyS')) return [0, 1];
  if (keyIsDown('ArrowLeft') || keyIsDown('KeyA')) return [-1, 0];
  if (keyIsDown('ArrowRight') || keyIsDown('KeyD')) return [1, 0];
  return null;
}

function updatePlayer(dt) {
  if (player.move) {
    const m = player.move;
    m.t = Math.min(1, m.t + dt / SETTINGS.stepSeconds);
    const smooth = m.t * m.t * (3 - 2 * m.t);
    player.px = lerp(m.sx, worldX(player.x), smooth);
    player.py = lerp(m.sy, worldY(player.y), smooth);
    if (m.t < 1) return;
    player.move = null;
    return; // 在统一更新中先检查接触，再拾取金币。
  }
  const direction = readDirection();
  if (!direction) return;
  const [dx, dy] = direction;
  if (!pointerAim) aim = Math.atan2(dy, dx);
  if (isOpen(player.x + dx, player.y + dy)) {
    player.move = {sx: player.px, sy: player.py, t: 0};
    player.x += dx;
    player.y += dy;
    sound.step();
  } else if (elapsed - lastBump > 0.35) {
    sound.bump();
    lastBump = elapsed;
  }
}

// 每个小步同时移动双方，避免迎面走过时漏判碰撞。
function updateGame(dt) {
  while (dt > 0 && phase === 'playing') {
    const step = Math.min(dt, 1 / 120);
    const previous = monsters.map(monster => ({px: player.px, py: player.py, mx: monster.px, my: monster.py}));
    elapsed += step;
    updatePlayer(step);
    for (const monster of monsters) updateMonster(monster, step);
    if (monsters.some((monster, i) => monsterContact(monster, previous[i]))) die();
    else if (!player.move) {
      recordTrail(player.x, player.y);
      collectCoin();
    }
    dt -= step;
  }
}

// ---------- 3b. 随机巡游怪兽 ----------
function monsterStepTime(chapter = level) {
  return Math.max(SETTINGS.monsterMinStep,
    SETTINGS.monsterStepSeconds * Math.pow(SETTINGS.monsterSpeedGrowth, chapter - 1));
}
function spawnMonsters() {
  // 按通路距离选择远处出生点，不会刚开局就撞到玩家。
  const queue = [{x: 1, y: 1, distance: 0}], visited = new Set(['1,1']);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    for (const [dx, dy] of dirs) {
      const x = cell.x + dx, y = cell.y + dy, id = `${x},${y}`;
      if (isOpen(x, y) && !visited.has(id)) {
        visited.add(id);
        queue.push({x, y, distance: cell.distance + 1});
      }
    }
  }
  const farthest = Math.max(...queue.map(c => c.distance));
  let choices = queue.filter(c => c.distance >= Math.max(10, farthest * 0.5));
  const count = Math.min(level, SETTINGS.maxMonsters);
  // 自定义小地图时优先挑远处的格子；出生点仍不与玩家重合。
  if (choices.length < count) choices = queue.filter(c => c.distance > 0).sort((a, b) => b.distance - a.distance).slice(0, Math.max(count, choices.length));
  monsters = [];
  while (monsters.length < count && choices.length) {
    const spaced = choices.filter(c => monsters.every(m => Math.hypot(m.x - c.x, m.y - c.y) >= 3));
    const cell = random(spaced.length ? spaced : choices);
    monsters.push({x: cell.x, y: cell.y, px: worldX(cell.x), py: worldY(cell.y),
      move: null, dx: 0, dy: 0, angle: HALF_PI, distanceFromStart: cell.distance,
      bobOffset: monsters.length * 1.7});
    choices = choices.filter(c => c !== cell);
  }
}
function updateMonster(monster, dt) {
  if (phase !== 'playing') return;
  while (dt > 0) {
    if (!monster.move) {
      let choices = dirs.filter(([dx, dy]) => isOpen(monster.x + dx, monster.y + dy));
      // 路口随机选择；只有死胡同时才立即原路返回。
      const forward = choices.filter(([dx, dy]) => dx !== -monster.dx || dy !== -monster.dy);
      if (forward.length) choices = forward;
      if (!choices.length) return;
      const [dx, dy] = random(choices);
      monster.move = {sx: monster.px, sy: monster.py, t: 0};
      monster.x += dx; monster.y += dy;
      monster.dx = dx; monster.dy = dy;
      monster.angle = Math.atan2(dy, dx);
    }
    const m = monster.move, duration = monsterStepTime();
    const used = Math.min(dt, (1 - m.t) * duration);
    m.t = Math.min(1, m.t + used / duration);
    monster.px = lerp(m.sx, worldX(monster.x), m.t);
    monster.py = lerp(m.sy, worldY(monster.y), m.t);
    dt -= used;
    if (m.t >= 1 - 1e-8) {
      monster.px = worldX(monster.x); monster.py = worldY(monster.y);
      monster.move = null;
    } else return;
  }
}
function monsterContact(monster, previous) {
  // 相对运动线段最近点：同时换格、迎面相撞也能检测到。
  const rx = previous.px - previous.mx, ry = previous.py - previous.my;
  const vx = (player.px - monster.px) - rx, vy = (player.py - monster.py) - ry;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared ? Math.max(0, Math.min(1, -(rx * vx + ry * vy) / lengthSquared)) : 0;
  if (Math.hypot(rx + vx * t, ry + vy * t) > SETTINGS.contactDistance) return false;
  const px = lerp(previous.px, player.px, t), py = lerp(previous.py, player.py, t);
  const mx = lerp(previous.mx, monster.px, t), my = lerp(previous.my, monster.py, t);
  // 两者之间有墙时不会隔墙判死。
  const samples = Math.max(1, Math.ceil(Math.hypot(mx - px, my - py) / 2));
  for (let i = 0; i <= samples; i++) {
    if (blockedAt(lerp(px, mx, i / samples), lerp(py, my, i / samples))) return false;
  }
  return true;
}
function die() {
  if (phase !== 'playing') return;
  phase = 'dead';
  touchDirection = null;
  sound.pauseMusic(true);
  sound.death();
  ui.toast.classList.remove('visible');
  ui.state.hidden = false;
  ui.state.textContent = 'Caught!';
  ui.start.textContent = 'Try again';
  ui.overlay.classList.remove('hidden');
  ui.root.classList.add('menu-open');
  updateHud();
}

function collectCoin() {
  if (phase !== 'playing') return;
  for (const c of coins) {
    if (c.taken || c.x !== player.x || c.y !== player.y) continue;
    c.taken = true;
    collected++;
    totalCoins++;
    sound.coin(collected);
    for (let i = 0; i < 14; i++) {
      particles.push({x: player.px, y: player.py, a: random(TWO_PI), speed: random(20, 65), life: 0.7});
    }
    updateHud();
    if (collected === coins.length) {
      phase = 'cleared';
      transition = 2.1;
      sound.complete();
      ui.toast.innerHTML = '<span>ALL LIGHTS FOUND</span><strong>A new maze awaits.</strong>';
      ui.toast.classList.add('visible');
    }
  }
}

// ---------- 4. 光照：射线遇墙停止，柔光边缘渐隐 ----------
function rayDistance(angle, maximum) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let d = 3; d < maximum; d += 3) {
    if (blockedAt(player.px + dx * d, player.py + dy * d)) return d;
  }
  return maximum;
}
function lineVisible(x, y) {
  const dx = x - player.px, dy = y - player.py, dist = Math.hypot(dx, dy);
  for (let d = 4; d < dist - 3; d += 5) {
    if (blockedAt(player.px + dx * d / dist, player.py + dy * d / dist)) return false;
  }
  return true;
}
function lightAmount(x, y) {
  const dx = x - player.px, dy = y - player.py, distance = Math.hypot(dx, dy);
  if (distance > SETTINGS.beamLength) return 0;
  const angle = Math.atan2(dy, dx);
  const difference = Math.abs(Math.atan2(Math.sin(angle - aim), Math.cos(angle - aim)));
  const local = Math.max(0, 1 - distance / 65) * 0.6;
  const cone = Math.pow(Math.max(0, 1 - difference / SETTINGS.beamHalfAngle), 0.7) *
    Math.pow(Math.max(0, 1 - distance / SETTINGS.beamLength), 0.65);
  return Math.max(local, cone) * (lineVisible(x, y) ? 1 : 0);
}

function paintFloor() {
  const g = floorLight, ctx = g.drawingContext;
  // 未照亮的地面、墙体使用同一种近黑色，内部结构不会泄露。
  g.background(2, 3, 5);
  g.image(trailLayer, 0, 0);
  const px = player.px + W / 2, py = player.py + H / 2;
  ctx.save();
  // 全周可见区域裁切：光不会穿过墙，金币微光则保留远方引导作用。
  ctx.beginPath();
  for (let i = 0; i <= 240; i++) {
    const a = i / 240 * TWO_PI, d = rayDistance(a, SETTINGS.beamLength);
    const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.clip();
  let halo = ctx.createRadialGradient(px, py, 0, px, py, 67);
  halo.addColorStop(0, 'rgba(102,207,218,0.28)');
  halo.addColorStop(1, 'rgba(102,207,218,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  // 多层渐变扇形叠加，形成柔软的锥形边缘。
  ctx.globalCompositeOperation = 'screen';
  for (let layer = 0; layer < 12; layer++) {
    const half = SETTINGS.beamHalfAngle * (1 - layer * 0.045);
    const reach = SETTINGS.beamLength;
    const beam = ctx.createRadialGradient(px, py, 3, px, py, reach);
    beam.addColorStop(0, 'rgba(185,222,209,0.055)');
    beam.addColorStop(0.35, 'rgba(150,196,181,0.035)');
    beam.addColorStop(1, 'rgba(150,196,181,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, reach, aim - half, aim + half);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // 不绘制全局格线：黑暗中只保留外边界、光束和已走过的细轨迹。
}

// ---------- 5. WebGL 场景：实际立体几何 + 正交相机 ----------
function renderScene(dt) {
  background(2, 3, 5);
  ortho(-width / 2, width / 2, -height / 2, height / 2, 0, 3000);
  fit = Math.max(0.15, Math.min((width - 64) / (W + 46), (height - 235) / (H * Math.cos(SETTINGS.tilt) + 75), 1.65));
  boardOffset = height < 600 ? 10 : 25;
  push();
  translate(0, boardOffset, 0);
  scale(fit);
  rotateX(SETTINGS.tilt);
  noLights();
  // 迷宫底座和桌面投影。
  push(); translate(0, 12, -22); fill(1, 2, 3); box(W + 40, H + 35, 7); pop();
  push(); translate(0, 0, -13); fill(5, 8, 12); box(W + 20, H + 20, 24); pop();
  push(); translate(0, 0, -1); fill(8, 12, 18); box(W + 7, H + 7, 3); pop();
  paintFloor();
  push(); translate(0, 0, 0.7); texture(floorLight); plane(W, H); pop();
  for (const wall of walls) {
    const x = worldX(wall.x), y = worldY(wall.y), edge = SETTINGS.cell / 2 + 0.5;
    // 在墙外侧取样，避免墙中心被自身遮挡。
    let brightness = 0;
    for (const [dx, dy] of dirs) brightness = Math.max(brightness, lightAmount(x + dx * edge, y + dy * edge));
    wall.brightness = lerp(wall.brightness, brightness, Math.min(1, dt * 14));
    drawWall(x, y, wall.brightness);
  }
  // 独立外边框高于矮墙，保证四条边在全黑环境下仍然完整可见。
  push();
  noLights(); fill(27, 39, 49);
  translate(0, 0, SETTINGS.wallHeight + 1);
  for (const sign of [-1, 1]) {
    push(); translate(0, sign * (H / 2 + 5), 0); plane(W + 12, 2); pop();
    push(); translate(sign * (W / 2 + 5), 0, 0); plane(2, H + 12); pop();
  }
  pop();
  // 地面光晕先画；实体金币和角色后画。
  noLights();
  for (const c of coins) {
    if (c.taken) continue;
    push();
    translate(worldX(c.x), worldY(c.y), 0.9);
    texture(glowTexture); plane(44, 44);
    pop();
  }
  ambientLight(55, 65, 80);
  directionalLight(150, 170, 185, -0.4, 0.6, -1);
  for (const c of coins) if (!c.taken) drawCoin(c);
  for (const monster of monsters) drawMonster(monster);
  drawPlayer();
  noLights();
  for (const p of particles) {
    const age = 0.7 - p.life;
    push();
    translate(p.x + Math.cos(p.a) * p.speed * age, p.y + Math.sin(p.a) * p.speed * age, 12 + 50 * age);
    fill(255, 210, 117, 255 * p.life / 0.7);
    sphere(1.6 * p.life / 0.7, 5, 4);
    pop();
  }
  pop();
}

function drawWall(x, y, amount) {
  const s = SETTINGS.cell, z = SETTINGS.wallHeight;
  push();
  translate(x, y, 0);
  // 分面明暗提供稳定的低矮积木质感；黑暗处接近背景色。
  const top = [2 + amount * 76, 3 + amount * 116, 5 + amount * 138];
  const side = [2 + amount * 34, 3 + amount * 60, 5 + amount * 80];
  fill(...side);
  translate(0, 0, z / 2);
  box(s - 0.7, s - 0.7, z);
  translate(0, 0, z / 2 + 0.12);
  fill(...top); plane(s - 0.7, s - 0.7);
  translate(0, 0, 0.12);
  fill(2 + amount * 91, 3 + amount * 141, 5 + amount * 161);
  // 细窄边缘模拟倒角。
  push(); translate(0, -s / 2 + 1, 0); plane(s - 1.2, 1.1); pop();
  push(); translate(-s / 2 + 1, 0, 0); plane(1.1, s - 1.2); pop();
  pop();
}

function drawCoin(c) {
  const time = millis() / 1000, x = worldX(c.x), y = worldY(c.y);
  const nearby = lightAmount(x, y);
  push();
  translate(x, y, 12 + Math.sin(time * 2 + c.seed) * 2);
  rotateX(HALF_PI);
  rotateZ(time * 0.8 + c.seed);
  ambientMaterial(150, 100, 24);
  emissiveMaterial(45 + nearby * 35, 23 + nearby * 20, 3);
  cylinder(5.5, 2.5, 16, 1);
  push(); translate(0, -1.5, 0); rotateX(HALF_PI);
  emissiveMaterial(100 + nearby * 40, 61 + nearby * 30, 12);
  torus(3.9, 0.55, 16, 6); pop();
  pop();
}

function drawMonster(monster) {
  const bob = Math.sin(elapsed * 5 + monster.bobOffset) * 1.4;
  push();
  noLights();
  translate(monster.px, monster.py, 1.1);
  texture(monsterGlow); plane(66, 66);
  pop();
  // 光晕面朝相机，实体保留深度遮挡，透过暗处也有红色预警。
  push();
  noLights();
  translate(monster.px, monster.py, 16 + bob);
  rotateX(-SETTINGS.tilt);
  texture(monsterGlow); plane(62, 62);
  pop();
  push();
  translate(monster.px, monster.py, 15 + bob);
  rotateZ(monster.angle + HALF_PI);
  noLights();
  ambientLight(120, 95, 100);
  directionalLight(180, 145, 155, -0.4, 0.3, -1);
  ambientMaterial(215, 35, 66);
  emissiveMaterial(90, 9, 20);
  push(); scale(1, 0.85, 1.1); sphere(10.5, 18, 12); pop();
  push(); translate(0, 0, -5); rotateX(HALF_PI); cylinder(10, 8, 18, 1); pop();
  for (let i = -1; i <= 1; i++) {
    push(); translate(i * 6.5, 0, -9); sphere(3.7, 10, 7); pop();
  }
  for (const side of [-1, 1]) {
    push();
    translate(side * 4.2, -7.8, 3.3);
    ambientMaterial(235, 232, 250); emissiveMaterial(20, 20, 25); sphere(3.9, 12, 8);
    translate(0, -3, 0.5); ambientMaterial(75, 43, 125); emissiveMaterial(8, 3, 18); sphere(2.2, 10, 7);
    translate(-0.5, -1.5, 0.7); emissiveMaterial(220, 230, 255); sphere(0.7, 6, 5);
    pop();
  }
  pop();
}

function drawPlayer() {
  const bounce = Math.sin(millis() / 260) * 1.2;
  push();
  translate(player.px, player.py, 1);
  noLights(); fill(2, 6, 10, 180); ellipse(0, 3, 26, 18);
  pop();
  push();
  translate(player.px, player.py, 14 + bounce);
  rotateZ(aim + HALF_PI);
  noLights();
  ambientLight(65, 85, 95);
  directionalLight(170, 190, 195, -0.4, 0.3, -1);
  ambientMaterial(85, 205, 217);
  push(); scale(1, 0.85, 1.08); sphere(10, 18, 12); pop();
  push(); translate(0, 0, -5); rotateX(HALF_PI); cylinder(9.6, 8, 18, 1); pop();
  for (let i = -1; i <= 1; i++) {
    push(); translate(i * 6.3, 0, -9); sphere(3.5, 10, 7); pop();
  }
  // 大眼睛朝向光束，保留参考图中的玩具感。
  for (const side of [-1, 1]) {
    push(); translate(side * 4.2, -7.5, 3.3);
    ambientMaterial(232, 250, 250); sphere(3.7, 12, 8);
    translate(0, -2.8, 0.6); ambientMaterial(12, 24, 44); sphere(2, 10, 7);
    translate(-0.5, -1.4, 0.8); emissiveMaterial(245); sphere(0.7, 6, 5); pop();
  }
  push(); translate(7, -6, -4); rotateX(HALF_PI);
  ambientMaterial(40, 68, 78); cylinder(2.5, 7, 10, 1);
  translate(0, -3.6, 0); emissiveMaterial(248, 239, 192); cylinder(2, 0.3, 10, 1); pop();
  pop();
}

// ---------- 6. 开始 / 暂停 / 键盘与触屏 ----------
async function startGame() {
  if (phase === 'dead') { restartGame(); return; }
  if (phase !== 'intro' && phase !== 'paused') return;
  await sound.unlock();
  phase = 'playing';
  sound.playMusic();
  ui.state.hidden = true;
  ui.overlay.classList.add('hidden');
  ui.root.classList.remove('menu-open');
  document.activeElement?.blur();
}
function pauseGame() {
  if (phase === 'playing') {
    phase = 'paused';
    sound.pauseMusic();
    ui.state.hidden = true;
    ui.start.textContent = 'Continue exploring';
    ui.overlay.classList.remove('hidden');
    ui.root.classList.add('menu-open');
  } else if (phase === 'paused') startGame();
}
function restartGame() {
  sound.pauseMusic(true);
  phase = 'intro';
  touchDirection = null;
  level = 1; totalCoins = 0; elapsed = 0; lastBump = -1;
  newLevel();
  ui.toast.classList.remove('visible');
  startGame();
}
function keyPressed(event) {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === 'Enter' || event.code === 'Space') {
    if (phase === 'intro' || phase === 'paused' || phase === 'dead') startGame();
  }
  if (event.code === 'KeyP' || event.code === 'Escape') pauseGame();
  if (event.code === 'KeyM') toggleSound();
  if (event.code === 'KeyR') restartGame();
}
function mouseMoved() { if (phase === 'playing') pointerAim = true; }
function mouseDragged() { if (phase === 'playing') pointerAim = true; }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
function toggleSound() {
  sound.setMuted(!sound.muted);
  sound.unlock();
  sound.playMusic();
  ui.sound.textContent = sound.muted ? 'Sound off' : 'Sound on';
  ui.sound.setAttribute('aria-pressed', String(!sound.muted));
}
function updateHud() {
  if (!ui) return;
  ui.level.textContent = String(level).padStart(2, '0');
  ui.coins.textContent = `${collected} / ${coins.length}`;
  ui.progress.style.width = `${collected / coins.length * 100}%`;
  ui.time.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  ui.total.textContent = `${totalCoins} collected in this journey`;
}

// 单文件自带界面，无需在编辑器另写 style.css。
function createInterface() {
  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box}body{margin:0;overflow:hidden;background:#080d15;color:#e5eceb;font-family:Arial,Helvetica,sans-serif}canvas{display:block}
    #cm-ui{position:fixed;inset:0;pointer-events:none}#cm-ui button{pointer-events:auto;font:inherit;cursor:pointer}
    .cm-header{position:absolute;top:30px;left:38px;right:38px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
    .cm-brand{font-size:12px;font-weight:700;letter-spacing:3px;display:flex;align-items:center;gap:11px}.cm-mark{width:13px;height:13px;border:2px solid #dd9c3d;border-radius:50%;box-shadow:0 0 16px #e6a33d55}
    .cm-tagline{font-size:11px;color:#768692;margin-top:9px;letter-spacing:.5px}.cm-actions{display:flex;gap:8px}.cm-actions button{background:#111b25;border:1px solid #dd9c3d66;color:#aab9c1;padding:9px 13px;border-radius:14px;font-size:11px!important}
    .cm-stats{position:absolute;top:102px;left:50%;transform:translateX(-50%);display:flex;gap:34px;align-items:center}.cm-stat label{display:block;font-size:9px;letter-spacing:2px;color:#748692;margin-bottom:6px}.cm-stat b{font-weight:400;font-size:21px;font-variant-numeric:tabular-nums}.cm-stat.gold b{color:#e8ab50}.cm-meter{width:72px;height:2px;background:#29302f;margin-top:7px}.cm-meter i{height:100%;display:block;background:#e8ab50;transition:width .2s}
    .cm-footer{position:absolute;bottom:28px;left:38px;right:38px;display:flex;align-items:end;justify-content:space-between;gap:15px;color:#7e909c;font-size:11px;line-height:1.9}.cm-footer strong{color:#acb9bf;font-weight:400}.cm-footer kbd{display:inline-block;color:#bac7cb;font:10px Arial;border:1px solid #34414b;border-radius:3px;padding:1px 5px;margin-right:4px}.cm-total{text-align:right;font-size:10px;letter-spacing:.4px}.cm-total span{color:#e8ab50;display:block}
    .cm-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:#050a126e;backdrop-filter:blur(4px);transition:opacity .3s}.cm-overlay.hidden{opacity:0;pointer-events:none;visibility:hidden}
    .menu-open>.cm-header,.menu-open>.cm-stats,.menu-open>.cm-footer,.menu-open>.cm-touch{visibility:hidden}
    .cm-start{width:250px;max-width:calc(100vw - 64px);min-height:60px;padding:18px 30px;border:1px solid #f2c77eb3;border-radius:999px;background:#dd9c3d;color:#2b1c09;font-size:16px!important;font-weight:600!important;letter-spacing:.5px;animation:cm-breathe 3.6s ease-in-out infinite;will-change:transform,box-shadow}
    @keyframes cm-breathe{0%,100%{transform:scale(.99);box-shadow:0 0 16px #e6a33d55,0 0 42px #e6a33d24,inset 0 1px 0 #ffe0a655;background:#d79738}50%{transform:scale(1.045);box-shadow:0 0 28px #e6a33d99,0 0 75px #e6a33d42,inset 0 1px 0 #ffe0a688;background:#ecad4c}}
    .cm-menu-state{position:absolute;bottom:calc(50% + 56px);left:24px;right:24px;text-align:center;font-size:18px;letter-spacing:1px;color:#e5eceb}
    .cm-overlay.hidden .cm-start{animation-play-state:paused}
    .cm-menu-controls{position:absolute;bottom:max(34px,env(safe-area-inset-bottom));left:24px;right:24px;display:flex;flex-wrap:wrap;justify-content:center;column-gap:27px;row-gap:12px;color:#8c9ba5;font-size:11px;letter-spacing:.3px;line-height:1.8;text-align:center;pointer-events:none}.cm-menu-controls b{font-weight:400;color:#b6c2c8;margin-right:7px}.cm-touch-help{display:none}
    @media(prefers-reduced-motion:reduce){.cm-start{animation:none;box-shadow:0 0 22px #e6a33d66}}
    .cm-toast{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);padding:22px 35px;border:1px solid #7f7555;background:#111c24ed;border-radius:10px;text-align:center;opacity:0;transition:opacity .4s;min-width:260px}.cm-toast.visible{opacity:1}.cm-toast span{display:block;font-size:9px;letter-spacing:2px;color:#e8ab50;margin-bottom:12px}.cm-toast strong{font-weight:400;font-size:23px}
    .cm-touch{display:none;position:absolute;bottom:72px;left:22px;grid-template-columns:repeat(3,38px);gap:4px;pointer-events:auto}.cm-touch button{height:38px;border:1px solid #46545f;border-radius:6px;background:#12212bdd;color:#e0e9ed;touch-action:none}
    button:focus-visible{outline:2px solid #e8ab50;outline-offset:4px}button:hover{filter:brightness(1.13)}
    @media(pointer:coarse){.cm-touch{display:grid}.cm-footer .cm-keys{display:none}.cm-menu-controls .cm-desktop-help{display:none}.cm-touch-help{display:inline}}
    @media(max-width:600px){.cm-header{top:20px;left:20px;right:20px}.cm-tagline{font-size:9px}.cm-actions button{padding:8px}.cm-stats{top:88px;gap:25px}.cm-footer{left:20px;right:20px;bottom:18px;font-size:9px}.cm-total{display:none}.cm-menu-controls{column-gap:18px;font-size:10px}}
    @media(max-height:550px){.cm-header{top:12px}.cm-stats{top:57px;gap:25px}.cm-stat label{font-size:8px;margin-bottom:3px}.cm-stat b{font-size:16px}.cm-footer{bottom:10px}.cm-menu-controls{bottom:16px}}
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'cm-ui';
  root.classList.add('menu-open');
  root.innerHTML = `
    <header class="cm-header"><div><div class="cm-brand"><i class="cm-mark"></i> COIN MAZE</div><div class="cm-tagline">A little light goes a long way.</div></div><div class="cm-actions"><button id="cm-sound" aria-pressed="true">Sound on</button><button id="cm-pause">Pause</button></div></header>
    <div class="cm-stats"><div class="cm-stat"><label>CHAPTER</label><b id="cm-level">01</b></div><div class="cm-stat gold"><label>LIGHTS FOUND</label><b id="cm-coins">0 / 6</b><div class="cm-meter"><i id="cm-progress"></i></div></div><div class="cm-stat"><label>WANDER TIME</label><b id="cm-time">00:00</b></div></div>
    <footer class="cm-footer"><div class="cm-keys"><kbd>W A S D</kbd> / <kbd>↑ ↓ ← →</kbd> move &nbsp; · &nbsp; <strong>Mouse</strong> aim light<br><kbd>P</kbd> pause &nbsp; <kbd>M</kbd> sound &nbsp; <kbd>R</kbd> restart</div><div class="cm-total">FOLLOW THE GOLDEN GLOW<span id="cm-total">0 collected in this journey</span></div></footer>
    <div class="cm-toast" id="cm-toast" role="status" aria-live="polite"></div>
    <div class="cm-touch" aria-label="Movement"><span></span><button data-dir="0,-1" aria-label="Move up">↑</button><span></span><button data-dir="-1,0" aria-label="Move left">←</button><button data-dir="0,1" aria-label="Move down">↓</button><button data-dir="1,0" aria-label="Move right">→</button></div>
    <div class="cm-overlay" id="cm-overlay"><div class="cm-menu-state" id="cm-state" role="status" aria-live="polite" hidden></div><button class="cm-start" id="cm-start">Enter the maze</button><div class="cm-menu-controls" aria-label="Controls"><span class="cm-desktop-help"><b>WASD / ↑ ↓ ← →</b> Move</span><span class="cm-desktop-help"><b>Mouse</b> Aim light</span><span class="cm-desktop-help"><b>P</b> Pause</span><span class="cm-desktop-help"><b>M</b> Sound</span><span class="cm-desktop-help"><b>R</b> Restart</span><span class="cm-touch-help">Use the arrow buttons to move · Light follows your direction</span></div></div>`;
  document.body.appendChild(root);
  const get = name => document.getElementById('cm-' + name);
  ui = Object.fromEntries(['level','coins','progress','time','total','toast','overlay','state','start','sound'].map(name => [name, get(name)]));
  ui.root = root;
  ui.start.onclick = startGame;
  ui.sound.onclick = toggleSound;
  get('pause').onclick = pauseGame;
  for (const button of root.querySelectorAll('[data-dir]')) {
    button.onpointerdown = e => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      pointerAim = false;
      touchDirection = button.dataset.dir.split(',').map(Number);
    };
    button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => { touchDirection = null; };
  }
}

// ---------- 7. 循环背景音乐 + 合成音效 ----------
// 背景音使用原生 Audio，音效使用 Web Audio，无需 p5.sound 插件。
// 换素材时保留 step / bump / coin / complete / death 方法名即可。
class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.bgm = new window.Audio(SETTINGS.musicFile);
    this.bgm.loop = true;
    this.bgm.preload = 'auto';
    this.bgm.volume = SETTINGS.musicVolume;
    this.musicPending = false;
    this.musicWanted = false;
    this.musicErrorReported = false;
    this.bgm.addEventListener('error', () => this.reportMusicError());
  }
  reportMusicError(error) {
    if (this.musicErrorReported) return;
    this.musicErrorReported = true;
    console.warn(`背景音乐未能加载或播放。请把 ${SETTINGS.musicFile} 放在 sketch.js 同一级；游戏和其他音效仍可使用。`, error || '');
  }
  playMusic() {
    // 开始页、暂停和死亡时不播放；过关时连续播放，不从头叠加。
    if (document.hidden || (phase !== 'playing' && phase !== 'cleared')) return;
    this.musicWanted = true;
    if (!this.bgm.paused || this.musicPending || this.bgm.error) return;
    this.bgm.muted = this.muted;
    this.musicPending = true;
    let interrupted = false;
    this.bgm.play().catch(error => {
      // 暂停或重开可以取消尚未完成的播放请求，这是正常行为。
      interrupted = error.name === 'AbortError';
      if (!interrupted) this.reportMusicError(error);
    }).finally(() => {
      this.musicPending = false;
      if (interrupted && this.musicWanted) this.playMusic();
    });
  }
  pauseMusic(reset = false) {
    this.musicWanted = false;
    this.bgm.pause();
    if (reset) this.bgm.currentTime = 0;
  }
  setMuted(value) {
    this.muted = value;
    this.bgm.muted = value;
  }
  async unlock() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!this.ctx) this.ctx = new Audio();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (error) { console.warn('Sound is unavailable; the maze still works.', error); }
  }
  tone(frequency, duration, volume, type = 'sine', delay = 0, endFrequency = frequency) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime + delay;
    const oscillator = this.ctx.createOscillator(), envelope = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope); envelope.connect(this.ctx.destination);
    oscillator.start(now); oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
  step() { this.tone(135, 0.065, 0.025, 'sine', 0, 70); }
  bump() { this.tone(82, 0.085, 0.025, 'triangle', 0, 55); }
  death() {
    this.tone(300, 0.42, 0.08, 'triangle', 0, 65);
    this.tone(150, 0.5, 0.055, 'sine', 0.12, 42);
  }
  coin(number) {
    const note = [659.25, 783.99, 880, 987.77, 1174.66, 1318.51][(number - 1) % 6];
    this.tone(note, 0.28, 0.085);
    this.tone(note * 1.5, 0.35, 0.045, 'sine', 0.075);
  }
  complete() {
    [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => this.tone(note, 0.6, 0.07, 'sine', 0.25 + i * 0.13));
  }
}
