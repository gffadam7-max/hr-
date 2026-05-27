/**
 * index.js — Point d'entrée principal du bot Mineflayer
 * Hébergé sur Railway
 */

'use strict';

const mineflayer   = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const pvpPlugin    = require('mineflayer-pvp').plugin;
const pvpModule    = require('./pvpModule');

// ── Variables d'environnement Railway ────────────────────────────────────────
const BOT_HOST     = process.env.MC_HOST     || 'ton-serveur.com';
const BOT_PORT     = parseInt(process.env.MC_PORT)     || 25565;
const BOT_USERNAME = process.env.MC_USERNAME || 'PvPBot';
const BOT_VERSION  = process.env.MC_VERSION  || '1.20.1';
const BOT_AUTH     = process.env.MC_AUTH     || 'offline'; // 'microsoft' pour un compte premium

// ── Création du bot ──────────────────────────────────────────────────────────
function createBot() {
  console.log(`[Bot] Connexion à ${BOT_HOST}:${BOT_PORT} en tant que ${BOT_USERNAME}...`);

  const bot = mineflayer.createBot({
    host:     BOT_HOST,
    port:     BOT_PORT,
    username: BOT_USERNAME,
    version:  BOT_VERSION,
    auth:     BOT_AUTH,
  });

  // Chargement des plugins
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvpPlugin);

  // Chargement du module PvP
  bot.once('spawn', () => {
    pvpModule.load(bot);
    console.log(`[Bot] Connecté et prêt ! (${BOT_USERNAME})`);
    bot.chat('Bot PvP en ligne ! Tapez !pvp [1-10] pour combattre.');
  });

  // ── Reconnexion automatique en cas de kick ou d'erreur ──────────────────
  bot.on('end', (reason) => {
    console.warn(`[Bot] Déconnecté : ${reason}. Reconnexion dans 10s...`);
    setTimeout(createBot, 10_000);
  });

  bot.on('error', (err) => {
    console.error(`[Bot] Erreur : ${err.message}`);
  });

  bot.on('kicked', (reason) => {
    console.warn(`[Bot] Kické : ${reason}`);
  });

  return bot;
}

createBot();

// ── Keepalive HTTP pour Railway (évite le sleep sur le plan Hobby) ───────────
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot Minecraft opérationnel.');
}).listen(PORT, () => {
  console.log(`[HTTP] Keepalive actif sur le port ${PORT}`);
});
