/**
 * Herd — clickable mock.
 *
 * Everything here is fake: the other five players, their answers, the pot, the
 * payouts. The point is to judge the loop by feel before committing to a
 * rollup design.
 *
 * The one thing the mock takes seriously is the moment that matters: while the
 * window is open you can see that other people have answered but not what they
 * said. That property is the entire game, and it is why the real version needs
 * confidential state rather than a public chain.
 *
 * Format: everyone stakes once, then each round the smallest group is culled.
 * You stay in by staying with the herd. Last one standing takes the pot.
 */

const STAKE = 0.05;
const MAX_ROUNDS = 8;

// ?fast shortens rounds for demoing without waiting out the clock.
const ROUND_SECONDS = new URLSearchParams(location.search).has("fast") ? 5 : 15;

const BOTS = [
  { name: "mila.sol", colour: "#ffcf3d" },
  { name: "0xTeo", colour: "#4ade80" },
  { name: "raj", colour: "#60a5fa" },
  { name: "quietfox", colour: "#f472b6" },
  { name: "dega", colour: "#c084fc" },
];

/**
 * Answer pools, weighted so a crowd actually forms.
 *
 * Real players cluster hard on the obvious answer - that is what makes the game
 * work, and what makes it unbottable, since there is nothing to look up. The
 * long tail is what gets people killed.
 */
const QUESTIONS = [
  { text: "Name a fruit.", pool: [["apple", 6], ["banana", 4], ["orange", 2], ["mango", 1], ["grape", 1]] },
  { text: "An excuse for being late.", pool: [["traffic", 6], ["train", 3], ["overslept", 3], ["alarm", 1]] },
  { text: "Something you'd never eat cold.", pool: [["pizza", 5], ["soup", 4], ["rice", 2], ["eggs", 1]] },
  { text: "A reason to leave a party early.", pool: [["tired", 6], ["work", 3], ["boring", 2], ["headache", 1]] },
  { text: "Name a colour.", pool: [["blue", 6], ["red", 5], ["green", 2], ["black", 1]] },
  { text: "Something in every kitchen.", pool: [["fridge", 5], ["kettle", 3], ["sink", 3], ["oven", 2]] },
  { text: "A thing people lie about.", pool: [["age", 5], ["money", 4], ["weight", 3], ["work", 1]] },
  { text: "Name an animal.", pool: [["dog", 6], ["cat", 5], ["lion", 2], ["horse", 1]] },
  { text: "Somewhere you'd never swim.", pool: [["river", 4], ["sea", 3], ["pond", 3], ["lake", 2]] },
];

/* --------------------------------------------------------------- helpers */

const $ = (id) => document.getElementById(id);
const normalise = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sol = (n) => `${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
const initial = (p) => (p.isYou ? "Y" : p.name.replace(/^0x/, "")[0].toUpperCase());

function avatar(player, size) {
  const el = document.createElement("div");
  el.className = "av";
  el.style.background = player.colour;
  el.textContent = initial(player);
  if (player.isYou) {
    el.style.outline = "2px solid var(--gold)";
    el.style.outlineOffset = "1px";
  }
  if (size) {
    el.style.width = el.style.height = `${size}px`;
    el.style.fontSize = `${size * 0.4}px`;
  }
  return el;
}

/** Draw from a weighted pool. */
function pick(pool) {
  const total = pool.reduce((n, [, w]) => n + w, 0);
  let r = Math.random() * total;
  for (const [answer, weight] of pool) {
    r -= weight;
    if (r <= 0) return answer;
  }
  return pool[0][0];
}

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.hidden = s.dataset.screen !== name;
  });
}

/* ----------------------------------------------------------------- state */

const you = { name: "you", colour: "#ffffff", isYou: true };

const game = {
  players: [],
  round: 0,
  questions: [],
  answers: new Map(),
  timer: null,
  botTimers: [],
};

const alive = () => game.players.filter((p) => p.alive);
const pot = () => game.players.length * STAKE;

/* ----------------------------------------------------------------- lobby */

function renderLobby() {
  const wrap = $("lobby-avatars");
  wrap.innerHTML = "";
  BOTS.forEach((b) => wrap.appendChild(avatar(b)));
  $("stake-label").textContent = sol(STAKE);
  $("pot-preview").textContent = sol((BOTS.length + 1) * STAKE);
  show("lobby");
}

$("join").addEventListener("click", () => {
  game.players = [...BOTS.map((b) => ({ ...b, alive: true })), { ...you, alive: true }];
  game.round = 0;
  game.questions = [...QUESTIONS].sort(() => Math.random() - 0.5);
  startRound();
});

/* -------------------------------------------------------------- question */

function startRound() {
  const q = game.questions[game.round % game.questions.length];
  game.answers = new Map();

  const youAlive = game.players.find((p) => p.isYou).alive;

  $("round-label").textContent = `Round ${game.round + 1}`;
  $("alive-label").textContent = `${alive().length} left`;
  $("pot-label").textContent = sol(pot());
  $("question-text").textContent = q.text;

  $("answer-form").hidden = !youAlive;
  $("locked-note").hidden = true;
  $("out-note").hidden = youAlive;
  $("answer-input").value = "";

  renderPlayerStatus();
  show("question");
  if (youAlive) $("answer-input").focus();

  // Bots lock in at human-ish moments, spread across the window.
  game.botTimers = alive()
    .filter((p) => !p.isYou)
    .map((bot) =>
      setTimeout(() => {
        game.answers.set(bot.name, pick(q.pool));
        renderPlayerStatus();
      }, 900 + Math.random() * (ROUND_SECONDS * 1000 - 2500)),
    );

  runTimer();
}

function runTimer() {
  let left = ROUND_SECONDS;
  const fill = $("timer-fill");
  const num = $("timer-num");
  const bar = fill.parentElement;

  const tick = () => {
    fill.style.width = `${(left / ROUND_SECONDS) * 100}%`;
    num.textContent = left;
    bar.classList.toggle("low", left <= 5);
    if (left <= 0) {
      clearInterval(game.timer);
      closeRound();
      return;
    }
    left--;
  };

  tick();
  game.timer = setInterval(tick, 1000);
}

function renderPlayerStatus() {
  const wrap = $("question-players");
  wrap.innerHTML = "";
  game.players
    .filter((p) => !p.isYou)
    .forEach((bot) => {
      const answered = game.answers.has(bot.name);
      const row = document.createElement("div");
      row.className = `player${answered ? " done" : ""}${bot.alive ? "" : " out"}`;
      row.appendChild(avatar(bot, 26));
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = bot.name;
      const status = document.createElement("span");
      status.className = "status";
      // The whole product in one line: you see that they answered, never what.
      status.textContent = !bot.alive ? "out" : answered ? "answer sealed" : "thinking…";
      row.append(name, status);
      wrap.appendChild(row);
    });
}

$("answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = $("answer-input").value.trim();
  if (!value) return;

  game.answers.set("you", value);
  $("answer-form").hidden = true;
  $("locked-answer").textContent = value;
  $("locked-note").hidden = false;
});

/* ---------------------------------------------------------------- reveal */

function closeRound() {
  game.botTimers.forEach(clearTimeout);
  const q = game.questions[game.round % game.questions.length];

  // Anyone who ran out of time still answers. A mock should not punish the
  // person demoing it for reading the explainer.
  alive().forEach((p) => {
    if (!game.answers.has(p.name)) game.answers.set(p.name, pick(q.pool));
  });

  const groups = new Map();
  alive().forEach((p) => {
    const answer = game.answers.get(p.name);
    const key = normalise(answer);
    if (!groups.has(key)) groups.set(key, { label: answer, members: [] });
    groups.get(key).members.push(p);
  });

  const sorted = [...groups.values()].sort((a, b) => b.members.length - a.members.length);
  const smallest = Math.min(...sorted.map((g) => g.members.length));
  const culled = sorted.filter((g) => g.members.length === smallest);

  // Culling every remaining player would end the game with nobody standing.
  // When the field is evenly split - all singletons, or two equal groups -
  // nobody strayed, so nobody goes. A fresh question breaks the deadlock.
  const stalemate = culled.length === sorted.length;
  const eliminated = stalemate ? [] : culled.flatMap((g) => g.members);

  eliminated.forEach((p) => (p.alive = false));

  renderReveal(sorted, new Set(eliminated), stalemate, q.text);
}

function renderReveal(sorted, eliminated, stalemate, questionText) {
  $("reveal-round").textContent = `Round ${game.round + 1}`;
  $("reveal-pot").textContent = sol(pot());
  $("reveal-question").textContent = questionText;

  const wrap = $("groups");
  wrap.innerHTML = "";

  sorted.forEach((group, i) => {
    const dead = group.members.some((m) => eliminated.has(m));
    const el = document.createElement("div");
    el.className = `group${dead ? " culled" : " safe"}`;
    el.style.animationDelay = `${i * 90}ms`;

    const head = document.createElement("div");
    head.className = "group-head";
    const answer = document.createElement("span");
    answer.className = "group-answer";
    answer.textContent = group.label;
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = dead
      ? "strayed"
      : group.members.length === 1
        ? "alone, but nobody clustered"
        : `${group.members.length} together`;
    head.append(answer, count);

    const people = document.createElement("div");
    people.className = "group-people";
    group.members.forEach((m) => people.appendChild(avatar(m, 26)));

    el.append(head, people);
    wrap.appendChild(el);
  });

  const survivors = alive();
  const youAlive = survivors.some((p) => p.isYou);
  const youJustDied = [...eliminated].some((p) => p.isYou);

  const verdict = $("verdict");
  if (stalemate) {
    verdict.className = "verdict roll";
    verdict.innerHTML = `
      <h3>No herd</h3>
      <p>Nobody clustered, so nobody strayed. New question, same ${survivors.length} players.</p>`;
  } else if (youJustDied) {
    verdict.className = "verdict lose";
    verdict.innerHTML = `
      <h3>You strayed</h3>
      <p>You're out. ${survivors.length} still in, playing for ${sol(pot())}.</p>`;
  } else if (youAlive) {
    verdict.className = "verdict win";
    verdict.innerHTML = `
      <h3>Still with the herd</h3>
      <p>${eliminated.size} out. ${survivors.length} left, playing for ${sol(pot())}.</p>`;
  } else {
    verdict.className = "verdict lose";
    verdict.innerHTML = `<h3>${eliminated.size} out</h3><p>${survivors.length} left.</p>`;
  }

  const over = survivors.length <= 1 || game.round + 1 >= MAX_ROUNDS;
  $("next-btn").textContent = over
    ? "See who took it"
    : youAlive
      ? "Next round"
      : "Watch the next round";

  show("reveal");
}

$("next-btn").addEventListener("click", () => {
  const survivors = alive();
  if (survivors.length <= 1 || game.round + 1 >= MAX_ROUNDS) {
    renderFinal(survivors);
    return;
  }
  game.round++;
  startRound();
});

/* ----------------------------------------------------------------- final */

function renderFinal(survivors) {
  const share = survivors.length ? pot() / survivors.length : 0;
  const youWon = survivors.some((p) => p.isYou);

  $("final-title").textContent = youWon
    ? survivors.length === 1
      ? "Last one standing"
      : "You made it to the end"
    : "The herd moved on without you";

  $("final-you").innerHTML = youWon
    ? `<div class="lbl">you staked ${sol(STAKE)}</div>
       <div class="big gold">+${sol(share - STAKE)}</div>
       <div class="lbl">${
         survivors.length === 1 ? "the whole pot" : `pot split ${survivors.length} ways`
       }</div>`
    : `<div class="lbl">you staked ${sol(STAKE)}</div>
       <div class="big">−${sol(STAKE)}</div>
       <div class="lbl">out in round ${game.round + 1}</div>`;

  const table = $("final-table");
  table.innerHTML = "";
  [...game.players]
    .sort((a, b) => Number(b.alive) - Number(a.alive))
    .forEach((p) => {
      const row = document.createElement("div");
      row.className = `row${p.isYou ? " you" : ""}${p.alive ? "" : " dead"}`;
      row.appendChild(avatar(p, 24));
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = p.name;
      const amt = document.createElement("span");
      amt.className = "amt";
      amt.textContent = p.alive ? `+${sol(share - STAKE)}` : `−${sol(STAKE)}`;
      row.append(name, amt);
      table.appendChild(row);
    });

  show("final");
}

$("again").addEventListener("click", renderLobby);

renderLobby();
