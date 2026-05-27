/**
 * pvpModule.js
 * Module PvP ultra-complet pour bot Mineflayer
 * Dépendances : mineflayer-pvp, mineflayer-pathfinder
 *
 * Usage :
 *   const pvpModule = require('./pvpModule');
 *   pvpModule.load(bot);
 */

'use strict';

const { goals: { GoalFollow } } = require('mineflayer-pathfinder');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION DES NIVEAUX DE DIFFICULTÉ (1 → 10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la configuration d'IA adaptée au niveau demandé.
 * @param {number} level - Niveau de difficulté (1-10)
 * @returns {Object} config
 */
function getDifficultyConfig(level) {
  // Niveaux 1-3 : Débutant — lent, statique, ne saute pas
  if (level <= 3) {
    return {
      attackDelayMs:    1400 - (level - 1) * 100, // 1400ms, 1300ms, 1200ms
      strafeEnabled:    false,
      strafeIntervalMs: null,
      strafeStrength:   0,
      criticalJumps:    false,
      jumpChance:       0,        // probabilité de saut par tick de strafe
      label:            'Débutant',
    };
  }

  // Niveaux 4-6 : Intermédiaire — rythme correct, strafe, sauts occasionnels
  if (level <= 6) {
    return {
      attackDelayMs:    700 - (level - 4) * 80,   // 700ms, 620ms, 540ms
      strafeEnabled:    true,
      strafeIntervalMs: 600 - (level - 4) * 60,   // 600ms, 540ms, 480ms
      strafeStrength:   0.4 + (level - 4) * 0.05, // 0.40, 0.45, 0.50
      criticalJumps:    false,
      jumpChance:       0.15 + (level - 4) * 0.05,// 15 %, 20 %, 25 %
      label:            'Intermédiaire',
    };
  }

  // Niveaux 7-9 : Tryhard — rapide, strafe fluide, coups critiques systématiques
  if (level <= 9) {
    return {
      attackDelayMs:    300 - (level - 7) * 50,   // 300ms, 250ms, 200ms
      strafeEnabled:    true,
      strafeIntervalMs: 250 - (level - 7) * 30,   // 250ms, 220ms, 190ms
      strafeStrength:   0.7 + (level - 7) * 0.05, // 0.70, 0.75, 0.80
      criticalJumps:    true,
      jumpChance:       0.75,
      label:            'Tryhard',
    };
  }

  // Niveau 10 : Divin / Hacker — vitesse max, strafe imprévisible, critiques parfaits
  return {
    attackDelayMs:    80,
    strafeEnabled:    true,
    strafeIntervalMs: 100,
    strafeStrength:   1.0,
    criticalJumps:    true,
    jumpChance:       1.0,   // saute à chaque opportunité
    label:            'Divin',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉQUIPEMENT — commandes /give puis auto-équipement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Donne le même stuff diamant au joueur ET au bot via /give,
 * puis équipe le bot automatiquement depuis son inventaire.
 * @param {Object} bot        - Instance Mineflayer
 * @param {string} playerName - Nom du joueur cible
 */
async function mirrorEquipment(bot, playerName) {
  const items = [
    'diamond_helmet',
    'diamond_chestplate',
    'diamond_leggings',
    'diamond_boots',
    'diamond_sword',
    'shield',
  ];

  // Donne chaque item au joueur ET au bot
  for (const item of items) {
    bot.chat(`/give ${playerName} minecraft:${item} 1`);
    bot.chat(`/give ${bot.username} minecraft:${item} 1`);
    // Petite pause pour ne pas flooder le serveur
    await sleep(120);
  }

  // Laisse le serveur le temps de traiter les /give
  await sleep(800);

  // ── Équipement automatique du bot ──────────────────────────────────────────
  await autoEquipBot(bot);
}

/**
 * Parcourt l'inventaire du bot et équipe :
 *  - Armure sur les slots dédiés
 *  - Épée en main principale
 *  - Bouclier en main secondaire (off-hand)
 * @param {Object} bot
 */
async function autoEquipBot(bot) {
  const armorMap = {
    diamond_helmet:     'head',
    diamond_chestplate: 'torso',
    diamond_leggings:   'legs',
    diamond_boots:      'feet',
  };

  for (const [itemName, destination] of Object.entries(armorMap)) {
    const item = bot.inventory.items().find(i => i.name === itemName);
    if (item) {
      try {
        await bot.equip(item, destination);
        await sleep(100);
      } catch (err) {
        console.warn(`[PvP] Impossible d'équiper ${itemName} : ${err.message}`);
      }
    }
  }

  // Épée en main principale
  const sword = bot.inventory.items().find(i => i.name === 'diamond_sword');
  if (sword) {
    try {
      await bot.equip(sword, 'hand');
      await sleep(100);
    } catch (err) {
      console.warn(`[PvP] Impossible d'équiper l'épée : ${err.message}`);
    }
  }

  // Bouclier en off-hand
  const shield = bot.inventory.items().find(i => i.name === 'shield');
  if (shield) {
    try {
      await bot.equip(shield, 'off-hand');
      await sleep(100);
    } catch (err) {
      console.warn(`[PvP] Impossible d'équiper le bouclier : ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOUVEMENT — Strafe latéral autour de la cible
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Démarre la boucle de strafe latéral autour de la cible.
 * Change aléatoirement de direction à chaque intervalle.
 * @param {Object} bot
 * @param {Object} config  - Configuration du niveau
 * @returns {Object} handle - { intervalId, stop() }
 */
function startStrafe(bot, config) {
  let strafeDir   = 1;            // 1 = droite, -1 = gauche
  let tickCount   = 0;

  const intervalId = setInterval(() => {
    const target = bot.pvp?.target ?? null;
    if (!target) return;

    tickCount++;

    // Inverse la direction de strafe aléatoirement ou toutes les 4 ticks
    if (Math.random() < 0.3 || tickCount % 4 === 0) {
      strafeDir = Math.random() < 0.5 ? 1 : -1;
    }

    // Applique le déplacement latéral
    bot.setControlState('left',  strafeDir === -1);
    bot.setControlState('right', strafeDir ===  1);

    // Coup critique : saute si au sol et selon la probabilité du niveau
    if (config.criticalJumps && bot.entity.onGround && Math.random() < config.jumpChance) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 250);
    } else if (!config.criticalJumps && Math.random() < config.jumpChance) {
      // Sauts occasionnels pour les niveaux intermédiaires
      if (bot.entity.onGround) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 250);
      }
    }

  }, config.strafeIntervalMs);

  return {
    intervalId,
    stop() {
      clearInterval(intervalId);
      // Réinitialise les touches de déplacement latéral
      bot.setControlState('left',  false);
      bot.setControlState('right', false);
      bot.setControlState('jump',  false);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NETTOYAGE — Stoppe tout mouvement et combat en cours
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nettoie proprement toutes les boucles et remet les contrôles à zéro.
 * @param {Object} bot
 * @param {Object} state - État interne du module
 */
function cleanStop(bot, state) {
  // Arrête le plugin pvp
  try { bot.pvp.stop(); } catch (_) {}

  // Arrête le pathfinder
  try { bot.pathfinder.setGoal(null); } catch (_) {}

  // Arrête et supprime la boucle de strafe si elle existe
  if (state.strafeHandle) {
    state.strafeHandle.stop();
    state.strafeHandle = null;
  }

  // Arrête la boucle d'attaque manuelle si elle existe
  if (state.attackInterval) {
    clearInterval(state.attackInterval);
    state.attackInterval = null;
  }

  // Réinitialise TOUS les contrôles de mouvement
  for (const ctrl of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
    try { bot.setControlState(ctrl, false); } catch (_) {}
  }

  state.active      = false;
  state.targetName  = null;

  console.log('[PvP] Combat arrêté et nettoyé.');
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉMARRAGE DU COMBAT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise et lance le combat contre un joueur.
 * @param {Object} bot
 * @param {Object} state       - État interne partagé du module
 * @param {string} playerName  - Nom du joueur cible
 * @param {number} level       - Niveau de difficulté (1-10)
 */
async function startCombat(bot, state, playerName, level) {
  // Sécurité : évite de lancer deux combats simultanés
  if (state.active) {
    cleanStop(bot, state);
    await sleep(300);
  }

  const config = getDifficultyConfig(level);
  console.log(`[PvP] Lancement combat contre ${playerName} — Niveau ${level} (${config.label})`);
  bot.chat(`Combat lancé ! Niveau ${level} (${config.label}) contre ${playerName}.`);

  // ── 1. Équipement miroir ───────────────────────────────────────────────────
  await mirrorEquipment(bot, playerName);

  // ── 2. Récupère l'entité cible ─────────────────────────────────────────────
  const target = bot.players[playerName]?.entity;
  if (!target) {
    bot.chat(`Je ne vois pas ${playerName} près de moi.`);
    console.warn(`[PvP] Entité introuvable pour ${playerName}`);
    return;
  }

  state.active     = true;
  state.targetName = playerName;

  // ── 3. Lance le plugin pvp avec la configuration du niveau ─────────────────
  bot.pvp.attack(target);

  // Ajuste le délai d'attaque interne du plugin (si l'API l'expose)
  if (bot.pvp.options) {
    bot.pvp.options.attackDelay = config.attackDelayMs;
  }

  // ── 4. Pathfinder : suit la cible en permanence ────────────────────────────
  try {
    bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
  } catch (err) {
    console.warn('[PvP] Pathfinder non disponible :', err.message);
  }

  // ── 5. Active le sprint ────────────────────────────────────────────────────
  bot.setControlState('sprint', true);

  // ── 6. Lance la boucle de strafe (niveaux 4+) ─────────────────────────────
  if (config.strafeEnabled) {
    state.strafeHandle = startStrafe(bot, config);
  }

  // ── 7. Boucle d'attaque manuelle (complète le plugin pvp) ─────────────────
  //   Cela garantit le bon timing quel que soit le comportement interne du plugin.
  state.attackInterval = setInterval(() => {
    if (!state.active) return;

    const currentTarget = bot.players[state.targetName]?.entity;
    if (!currentTarget) return;

    const dist = bot.entity.position.distanceTo(currentTarget.position);
    if (dist <= 4) {
      try { bot.attack(currentTarget); } catch (_) {}
    }
  }, config.attackDelayMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARGEMENT DU MODULE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Charge le module PvP sur l'instance bot.
 * À appeler une seule fois après la création du bot.
 * @param {Object} bot - Instance Mineflayer avec pvp et pathfinder déjà chargés
 */
function load(bot) {
  // État interne — isolé par instance de bot
  const state = {
    active:         false,
    targetName:     null,
    strafeHandle:   null,
    attackInterval: null,
  };

  // ── Écoute des messages du chat ───────────────────────────────────────────
  bot.on('chat', async (username, message) => {
    // Ignore ses propres messages
    if (username === bot.username) return;

    // ── Commande !pvp [niveau] ───────────────────────────────────────────────
    const pvpMatch = message.match(/^!pvp\s*(\d+)?$/i);
    if (pvpMatch) {
      let level = parseInt(pvpMatch[1], 10);

      // Valide et borne le niveau entre 1 et 10
      if (isNaN(level) || level < 1)  level = 4;   // défaut : niveau 4
      if (level > 10)                  level = 10;

      await startCombat(bot, state, username, level);
      return;
    }

    // ── Commande !stop ────────────────────────────────────────────────────────
    if (message.trim().toLowerCase() === '!stop') {
      if (state.active) {
        cleanStop(bot, state);
        bot.chat('Combat arrêté.');
      } else {
        bot.chat('Aucun combat en cours.');
      }
    }
  });

  // ── Nettoyage automatique à la mort du bot ────────────────────────────────
  bot.on('death', () => {
    if (state.active) {
      console.log('[PvP] Bot mort — nettoyage des boucles.');
      cleanStop(bot, state);
    }
  });

  // ── Nettoyage si la cible se déconnecte ───────────────────────────────────
  bot.on('playerLeft', (player) => {
    if (state.active && player.username === state.targetName) {
      console.log(`[PvP] Cible ${player.username} déconnectée — arrêt du combat.`);
      cleanStop(bot, state);
      bot.chat(`${player.username} s'est déconnecté. Combat annulé.`);
    }
  });

  console.log('[PvP] Module PvP chargé. Commandes : !pvp [1-10] | !stop');
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────────────────────────

/** Pause asynchrone en millisecondes */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { load };
