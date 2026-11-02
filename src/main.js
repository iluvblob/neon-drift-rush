const app = document.querySelector('#app');

app.innerHTML = `
  <div class="shell">
    <canvas id="gameCanvas" width="1280" height="720"></canvas>

    <div class="hud">
      <div class="panel score-panel">
        <span class="label">Score</span>
        <span id="scoreValue">0</span>
      </div>

      <div class="panel center-panel">
        <span class="label">Lap</span>
        <span id="lapValue">1</span>
      </div>

      <div class="panel time-panel">
        <span class="label">Time</span>
        <span id="timeValue">00:00.0</span>
      </div>
    </div>

    <div class="drift-box">
      <div class="meter-header">
        <span>Drift</span>
        <span id="driftPercent">0%</span>
      </div>
      <div class="meter-track">
        <div id="meterFill" class="meter-fill"></div>
      </div>
    </div>

    <div class="message-box" id="messageBox">
      Slide through the gates to keep the combo alive.
    </div>

    <div class="touch-controls" aria-label="Touch controls">
      <button class="touch-btn" data-key="ArrowLeft">◀</button>
      <button class="touch-btn" data-key="ArrowUp">▲</button>
      <button class="touch-btn" data-key="ArrowRight">▶</button>
      <button class="touch-btn" data-key="ArrowDown">▼</button>
    </div>
  </div>
`;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreValue = document.getElementById('scoreValue');
const lapValue = document.getElementById('lapValue');
const timeValue = document.getElementById('timeValue');
const driftPercent = document.getElementById('driftPercent');
const meterFill = document.getElementById('meterFill');
const messageBox = document.getElementById('messageBox');
const touchButtons = document.querySelectorAll('.touch-btn');
const keys = {};

const state = {
  score: 0,
  laps: 1,
  elapsed: 0,
  driftMeter: 0,
  driftGoal: 100,
  checkpointIndex: 0,
  lastTime: 0,
  combo: 1,
  messageTimer: 0,
};

const course = {
  outer: [
    { x: 180, y: 130 },
    { x: 440, y: 80 },
    { x: 900, y: 180 },
    { x: 1040, y: 420 },
    { x: 840, y: 610 },
    { x: 430, y: 620 },
    { x: 160, y: 520 },
    { x: 90, y: 290 },
  ],
  checkpoints: [
    { x: 212, y: 122, r: 58, color: '#6fe7ff' },
    { x: 530, y: 115, r: 60, color: '#ff5ec7' },
    { x: 910, y: 236, r: 72, color: '#ffd166' },
    { x: 1014, y: 466, r: 68, color: '#8ef7a1' },
    { x: 714, y: 600, r: 78, color: '#6fe7ff' },
    { x: 280, y: 560, r: 68, color: '#ff5ec7' },
    { x: 138, y: 374, r: 60, color: '#ffd166' },
  ],
};

const player = {
  x: 220,
  y: 170,
  vx: 0,
  vy: 0,
  angle: -Math.PI / 2,
  speed: 0,
  radius: 16,
  trail: [],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function setMessage(text, duration = 1200) {
  messageBox.textContent = text;
  state.messageTimer = duration;
}

function onKeyChange(event, value) {
  const key = event.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault();
  }

  keys[key] = value;
  keys[event.key] = value;
}

window.addEventListener('keydown', (event) => onKeyChange(event, true));
window.addEventListener('keyup', (event) => onKeyChange(event, false));

function bindTouchControls() {
  touchButtons.forEach((button) => {
    const key = button.dataset.key;

    const press = (event) => {
      event.preventDefault();
      keys[key.toLowerCase()] = true;
      keys[key] = true;
      button.style.transform = 'scale(0.96)';
      button.style.background = 'rgba(111, 231, 255, 0.15)';
    };

    const release = () => {
      keys[key.toLowerCase()] = false;
      keys[key] = false;
      button.style.transform = 'scale(1)';
      button.style.background = 'rgba(8, 17, 26, 0.7)';
    };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
  });
}

function circleHit(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) <= radius + player.radius + 10;
}

function update(dt) {
  const turn = (keys.arrowleft || keys.a ? -1 : 0) + (keys.arrowright || keys.d ? 1 : 0);
  const throttle = (keys.arrowup || keys.w ? 1 : 0) - (keys.arrowdown || keys.s ? 1 : 0);

  let acceleration = 0;
  if (throttle !== 0) {
    acceleration = throttle * 260;
  } else {
    player.speed *= 0.985;
  }

  player.speed += acceleration * dt;
  player.speed = clamp(player.speed, -120, 260);

  const steerStrength = clamp(Math.abs(player.speed) / 180, 0.15, 1.2);
  const steerRate = (1.4 + steerStrength) * dt * 1.9;

  if (turn !== 0) {
    const direction = player.speed >= 0 ? 1 : -1;
    player.angle += turn * steerRate * direction;
  }

  const forwardX = Math.cos(player.angle);
  const forwardY = Math.sin(player.angle);
  const sideX = Math.cos(player.angle + Math.PI / 2);
  const sideY = Math.sin(player.angle + Math.PI / 2);

  if (Math.abs(turn) > 0 && Math.abs(player.speed) > 16) {
    const driftForce = turn * Math.abs(player.speed) * 0.28;
    player.vx += sideX * driftForce * dt * 50;
    player.vy += sideY * driftForce * dt * 50;
    state.driftMeter += Math.abs(driftForce) * dt * 1.35;
  } else {
    state.driftMeter *= 0.975;
  }

  player.vx += forwardX * player.speed * dt * 0.9;
  player.vy += forwardY * player.speed * dt * 0.9;
  player.vx *= 0.985;
  player.vy *= 0.985;

  player.x += player.vx * dt * 60;
  player.y += player.vy * dt * 60;

  const margin = 18;
  player.x = clamp(player.x, margin, canvas.width - margin);
  player.y = clamp(player.y, margin, canvas.height - margin);

  if (Math.abs(player.speed) < 0.8) player.speed = 0;

  player.trail.push({ x: player.x, y: player.y, life: 1 });
  if (player.trail.length > 26) player.trail.shift();

  for (const p of player.trail) {
    p.life -= 0.03 * dt * 60;
  }
  while (player.trail.length && player.trail[0].life <= 0) {
    player.trail.shift();
  }

  const cp = course.checkpoints[state.checkpointIndex];
  if (circleHit(player.x, player.y, cp.x, cp.y, cp.r)) {
    const driftBonus = Math.floor(state.driftMeter * 1.4);
    state.score += 150 + driftBonus + state.combo * 25;
    state.combo = Math.min(12, state.combo + 1);
    state.driftMeter = 0;
    state.checkpointIndex = (state.checkpointIndex + 1) % course.checkpoints.length;

    if (state.checkpointIndex === 0) {
      state.laps += 1;
      state.score += 500 + Math.max(0, 250 - (state.elapsed / 1000) * 4);
      setMessage(`Lap ${state.laps} clear! +${500 + Math.max(0, 250 - (state.elapsed / 1000) * 4)}`, 1600);
    } else {
      setMessage(`Gate ${state.checkpointIndex + 1}! +${150 + driftBonus}`, 900);
    }
  }

  if (state.driftMeter > state.driftGoal) {
    state.driftMeter = state.driftGoal;
  }

  state.elapsed += dt * 1000;
  if (state.messageTimer > 0) {
    state.messageTimer -= dt * 1000;
  }

  scoreValue.textContent = Math.floor(state.score);
  lapValue.textContent = state.laps;
  timeValue.textContent = formatTime(state.elapsed);
  driftPercent.textContent = `${Math.floor((state.driftMeter / state.driftGoal) * 100)}%`;
  meterFill.style.width = `${(state.driftMeter / state.driftGoal) * 100}%`;
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#081826');
  gradient.addColorStop(0.5, '#112d3b');
  gradient.addColorStop(1, '#091d25');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 9; i += 1) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(111, 231, 255, ${0.08 + i * 0.025})`;
    ctx.lineWidth = 1 + i * 0.8;
    ctx.ellipse(canvas.width * 0.5, canvas.height * 0.5, 200 + i * 72, 220 + i * 62, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTrack() {
  ctx.save();
  ctx.beginPath();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.moveTo(course.outer[0].x, course.outer[0].y);
  for (let i = 1; i < course.outer.length; i += 1) {
    const current = course.outer[i];
    const prev = course.outer[i - 1];
    const midX = (prev.x + current.x) / 2;
    const midY = (prev.y + current.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
  }
  const last = course.outer[course.outer.length - 1];
  const first = course.outer[0];
  ctx.quadraticCurveTo(last.x, last.y, first.x, first.y);

  ctx.lineWidth = 58;
  ctx.strokeStyle = 'rgba(17, 30, 47, 0.86)';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(course.outer[0].x, course.outer[0].y);
  for (let i = 1; i < course.outer.length; i += 1) {
    const current = course.outer[i];
    const prev = course.outer[i - 1];
    const midX = (prev.x + current.x) / 2;
    const midY = (prev.y + current.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
  }
  const last2 = course.outer[course.outer.length - 1];
  const first2 = course.outer[0];
  ctx.quadraticCurveTo(last2.x, last2.y, first2.x, first2.y);

  ctx.lineWidth = 30;
  ctx.strokeStyle = 'rgba(111, 231, 255, 0.2)';
  ctx.setLineDash([18, 16]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCheckpoints() {
  course.checkpoints.forEach((cp, index) => {
    const active = index === state.checkpointIndex;
    const glow = active ? 24 : 14;

    ctx.beginPath();
    ctx.fillStyle = active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
    ctx.arc(cp.x, cp.y, cp.r + 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = cp.color;
    ctx.shadowBlur = glow;
    ctx.shadowColor = cp.color;
    ctx.arc(cp.x, cp.y, cp.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.arc(cp.x, cp.y, cp.r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  });
}

function drawTrail() {
  for (const point of player.trail) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(111, 231, 255, ${0.08 + point.life * 0.4})`;
    ctx.arc(point.x, point.y, 8 + point.life * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCar() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  ctx.fillStyle = 'rgba(255, 94, 199, 0.2)';
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff5ec7';
  ctx.fillRect(-17, -10, 34, 20);

  ctx.fillStyle = '#ffd166';
  ctx.fillRect(-8, -6, 16, 12);

  ctx.fillStyle = '#90f7ff';
  ctx.fillRect(14, -4, 10, 8);

  ctx.fillStyle = '#101827';
  ctx.fillRect(-14, -18, 8, 5);
  ctx.fillRect(6, -18, 8, 5);
  ctx.fillRect(-14, 13, 8, 5);
  ctx.fillRect(6, 13, 8, 5);

  ctx.restore();
}

function drawHUDText() {
  ctx.save();
  ctx.font = '700 19px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText('WASD / Arrows to drift', canvas.width / 2, 34);
  ctx.restore();
}

function render() {
  drawBackground();
  drawTrack();
  drawCheckpoints();
  drawTrail();
  drawCar();
  drawHUDText();
}

function loop(timestamp) {
  const dt = Math.min(0.032, (timestamp - state.lastTime || 16) / 1000);
  state.lastTime = timestamp;

  update(dt);
  render();
  requestAnimationFrame(loop);
}

function start() {
  bindTouchControls();
  setMessage('Slide through the gates to keep the combo alive.', 1800);
  requestAnimationFrame(loop);
}

start();
