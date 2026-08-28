'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#3B82F6', // I - azul
  '#F59E0B', // O - ámbar
  '#8B5CF6', // T - violeta
  '#16A34A', // S - verde
  '#DC2626', // Z - rojo
  '#192A4E', // J - azul marino
  '#EC4899', // L - rosa
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const POWERUP_INFO = {
  bomb: { color: '#ff3b3b', icon: '💣' },      // destruye un área 3x3
  lightning: { color: '#ffe14d', icon: '⚡' }, // destruye una fila o columna completa
  gravity: { color: '#9b59ff', icon: '🌀' },   // compacta los huecos del tablero
  ink: { color: '#2b1b40', icon: '🎨' },       // bloquea la vista 5 segundos
};
const POWERUP_TYPES = Object.keys(POWERUP_INFO);
const POWERUP_CHANCE = 0.10;
const POWERUP_COOLDOWN = 5; // piezas mínimas entre power-ups
const POWERUP_SPEED_MULTIPLIER = 3; // caen 3x más rápido que una pieza normal
const INK_DURATION = 5000;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, piecesSinceLastPowerUp, inkActiveUntil;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPowerUp() {
  const powerType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  const pu = { isPowerUp: true, powerType, shape: [[1]], x: Math.floor(Math.random() * COLS), y: 0 };
  if (powerType === 'bomb') {
    pu.targetRow = Math.floor(Math.random() * ROWS);
    pu.targetCol = Math.floor(Math.random() * COLS);
  } else if (powerType === 'lightning') {
    pu.orientation = Math.random() < 0.5 ? 'row' : 'col';
    pu.targetIndex = pu.orientation === 'row'
      ? Math.floor(Math.random() * ROWS)
      : Math.floor(Math.random() * COLS);
  }
  return pu;
}

function randomSpawnable() {
  piecesSinceLastPowerUp++;
  if (piecesSinceLastPowerUp >= POWERUP_COOLDOWN && Math.random() < POWERUP_CHANCE) {
    piecesSinceLastPowerUp = 0;
    return randomPowerUp();
  }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function activatePowerUp(pu) {
  switch (pu.powerType) {
    case 'bomb': activateBomb(pu); break;
    case 'lightning': activateLightning(pu); break;
    case 'gravity': activateGravity(); break;
    case 'ink': activateInk(); break;
  }
}

function activateBomb(pu) {
  for (let r = pu.targetRow - 1; r <= pu.targetRow + 1; r++)
    for (let c = pu.targetCol - 1; c <= pu.targetCol + 1; c++)
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) board[r][c] = 0;
}

function activateLightning(pu) {
  if (pu.orientation === 'row') {
    board[pu.targetIndex] = new Array(COLS).fill(0);
  } else {
    for (let r = 0; r < ROWS; r++) board[r][pu.targetIndex] = 0;
  }
}

function activateGravity() {
  for (let c = 0; c < COLS; c++) {
    const values = [];
    for (let r = 0; r < ROWS; r++)
      if (board[r][c] !== 0) values.push(board[r][c]);
    const padding = ROWS - values.length;
    for (let r = 0; r < ROWS; r++)
      board[r][c] = r < padding ? 0 : values[r - padding];
  }
}

function activateInk() {
  inkActiveUntil = performance.now() + INK_DURATION;
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.isPowerUp) {
    activatePowerUp(current);
  } else {
    merge();
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomSpawnable();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawPowerUpBlock(context, x, y, powerType, size, alpha) {
  const info = POWERUP_INFO[powerType];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = info.color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.font = `${Math.floor(size * 0.6)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(info.icon, x * size + size / 2, y * size + size / 2 + 1);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  if (current.isPowerUp) {
    const gy = ghostY();
    drawPowerUpBlock(ctx, current.x, gy, current.powerType, BLOCK, 0.25);
    drawPowerUpBlock(ctx, current.x, current.y, current.powerType, BLOCK);
  } else {
    // ghost
    const gy = ghostY();
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

    // current piece
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  }

  // tinte: bloquea la vista del tablero por unos segundos
  if (inkActiveUntil) {
    if (performance.now() < inkActiveUntil) {
      ctx.fillStyle = 'rgba(8, 6, 16, 0.98)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      inkActiveUntil = null;
    }
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (next.isPowerUp) {
    drawPowerUpBlock(nextCtx, 1, 1, next.powerType, NB);
    return;
  }
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  const effectiveInterval = current.isPowerUp ? dropInterval / POWERUP_SPEED_MULTIPLIER : dropInterval;
  if (dropAccum >= effectiveInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  piecesSinceLastPowerUp = 0;
  inkActiveUntil = null;
  next = randomSpawnable();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  if (current.isPowerUp) {
    switch (e.code) {
      case 'ArrowDown':
        softDrop();
        break;
      case 'Space':
        e.preventDefault();
        hardDrop();
        break;
    }
    updateHUD();
    return;
  }
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
