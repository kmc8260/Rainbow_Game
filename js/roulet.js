const roulette = document.getElementById("roulette");
const spinBtn = document.getElementById("rotated");

const prizes = ["100", "200", "300", "400", "500", "600", "700", "800"];

const rouletSize = prizes.length;
const partSize = 360 / rouletSize;

let Rotation = 0;
let isSpinning = false;
